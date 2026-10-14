import { randomBytes } from 'node:crypto'
import { KINDS, ProtocolError } from '@dsh-remote/protocol'

const OUTCOMES = ['allowed-once', 'rejected', 'cancelled', 'unavailable']

/** A borrowed request is never mutated. Only our exact local clone enters next. */
export class InteractionBridge {
  constructor(ctx, recipients, { timeoutMs = 120000, audit = () => {} } = {}) {
    this.ctx = ctx
    this.recipients = recipients
    this.timeoutMs = timeoutMs
    this.audit = audit
    this.pending = new Map()
    this.localRequests = new WeakSet()
    this.disposers = ['approval', 'question'].map(kind => {
      const event = kind === 'approval' ? 'approval/request' : 'user-questions/request'
      const owner = this
      return ctx.on(event, function(request, next) {
        if (owner.localRequests.has(request)) return next()
        const sessionId = request.agent?.session?.id
        const clients = sessionId ? owner.recipients(sessionId) : []
        if (!clients.length) return next()
        return owner.ask(kind, request, clients, this)
      }, { prepend: true })
    })
  }
  ask(kind, request, clients, scope) {
    if (this.pending.size >= 32) return Promise.reject(new ProtocolError('busy', 'too many pending interactions'))
    const id = randomBytes(16).toString('base64url')
    const localAbort = new AbortController()
    const localRequest = { ...request, signal: request.signal ? AbortSignal.any([request.signal, localAbort.signal]) : localAbort.signal }
    this.localRequests.add(localRequest)
    const sessionId = request.agent.session.id
    const deviceIds = new Set(clients.map(client => client.peerHello?.deviceId))
    const data = kind === 'approval'
      ? { approvalId: id, sessionId, toolName: request.toolName, callId: request.callId, reason: request.reason, deadline: Date.now() + this.timeoutMs }
      : { questionId: id, sessionId, questions: request.questions, deadline: Date.now() + this.timeoutMs }
    this.audit('interaction.asked', { interactionId: id, sessionId, kind, toolName: request.toolName })
    return new Promise((resolve, reject) => {
      let settled = false
      const finish = (value, by, error, actorDeviceId) => {
        if (settled) return
        settled = true
        try { this.audit('interaction.decided', { interactionId: id, sessionId, kind, by, deviceId: actorDeviceId, ...(kind === 'approval' ? { outcome: value } : {}) }) }
        catch {
          value = 'cancelled'
          error = kind === 'question' ? new ProtocolError('internal', 'remote audit unavailable') : null
        }
        clearTimeout(timer)
        request.signal?.removeEventListener('abort', abort)
        this.pending.delete(id)
        localAbort.abort()
        const responded = { type: 'application', name: `${kind}.responded`, data: { id, sessionId, by, ...(kind === 'approval' ? { outcome: value } : {}) } }
        const listeners = new Set([...clients, ...this.recipients(sessionId).filter(client => deviceIds.has(client.peerHello?.deviceId))])
        for (const client of listeners) if (client.state === 'ready') client.sendFrame(KINDS.EVT, responded).catch(failure => client.close(failure))
        error ? reject(error) : resolve(value)
      }
      const abort = () => finish('cancelled', 'local', kind === 'question' ? new ProtocolError('cancelled', 'question stopped') : null)
      const timer = setTimeout(abort, this.timeoutMs)
      this.pending.set(id, { id, kind, data, clients, deviceIds, request, finish })
      request.signal?.addEventListener('abort', abort, { once: true })
      if (request.signal?.aborted) { abort(); return }
      for (const client of clients) client.sendFrame(KINDS.EVT, { type: 'application', name: `${kind}.request`, data }).catch(failure => client.close(failure))
      // One explicit local dispatch: the clone branch above delegates immediately,
      // never asks remotely or creates another clone. The same scope reaches native UI.
      const event = kind === 'approval' ? 'approval/request' : 'user-questions/request'
      Promise.resolve().then(() => this.ctx.waterfall(scope, event, localRequest, () => {
        if (kind === 'approval') return 'unavailable'
        throw new ProtocolError('unsupported', 'no local question answerer')
      })).then(value => {
        if (kind === 'approval' && !OUTCOMES.includes(value)) return
        if (value !== 'unavailable') finish(value, 'local')
      }).catch(() => {}) // Remote remains available; timeout/abort still fails closed.
    })
  }
  decide(id, value, connection) {
    const item = this.pending.get(id)
    if (!item) throw new ProtocolError('not-found', 'interaction already settled')
    if (!item.deviceIds.has(connection.peerHello?.deviceId) || !this.recipients(item.data.sessionId).includes(connection)) throw new ProtocolError('unauthorized', 'interaction not owned by this connection')
    if (item.kind === 'approval') {
      if (!OUTCOMES.includes(value)) throw new ProtocolError('invalid-argument', 'invalid approval outcome')
    } else {
      if (!value || !Array.isArray(value.answers) || value.answers.length !== item.request.questions.length ||
          item.request.questions.some(question => value.answers.filter(answer => answer.id === question.id).length !== 1) ||
          value.answers.some(answer => !Array.isArray(answer.selected) || answer.selected.some(label => typeof label !== 'string') || answer.custom !== undefined && typeof answer.custom !== 'string')) {
        throw new ProtocolError('invalid-argument', 'invalid question answers')
      }
    }
    item.finish(value, 'remote', undefined, connection.peerHello.deviceId)
    return { ok: true }
  }
  list(connection, sessionId) {
    return [...this.pending.values()].filter(item => item.deviceIds.has(connection.peerHello?.deviceId) && this.recipients(item.data.sessionId).includes(connection) && (!sessionId || item.data.sessionId === sessionId)).map(item => item.data)
  }
  close() {
    for (const item of [...this.pending.values()]) item.finish('cancelled', 'local', item.kind === 'question' ? new ProtocolError('cancelled', 'plugin stopped') : null)
    for (const dispose of this.disposers) dispose()
  }
}
