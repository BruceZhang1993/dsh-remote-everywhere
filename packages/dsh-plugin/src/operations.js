import { randomBytes } from 'node:crypto'
import { appendFileSync, statSync, renameSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { scopeTarget } from '@deepseek-ai/dsh-scope'
import { ProtocolError } from '@dsh-remote/protocol'

/** Direct operations use explicit one-shot approvals; they never forge Agent turns. */
export class WorkspaceOperations {
  constructor(ctx, runtime) { this.ctx = ctx; this.runtime = runtime; this.grants = new Map() }
  async target(sessionId, path, signal) {
    if (typeof sessionId !== 'string' || typeof path !== 'string' || !path || path.length > 4096) throw new ProtocolError('invalid-argument', 'session and path required')
    const iterator = this.ctx.sessionController.follow({ address: { kind: 'session', sessionId }, maxMessages: 1 }, signal)[Symbol.asyncIterator]()
    let header
    try { header = (await iterator.next()).value?.header } finally { await iterator.return?.() }
    const fs = this.ctx.get('fs')
    if (!header?.cwd || !fs) throw new ProtocolError('unsupported', 'workspace filesystem unavailable')
    const root = await fs.resolve(header.cwd, { signal })
    const target = await fs.resolve(path, { cwd: header.cwd, signal })
    if (!fs.contains(root, target)) throw new ProtocolError('unauthorized', 'path outside session workspace')
    return { root, target, fs, cwd: header.cwd }
  }
  audit(data) {
    const path = join(this.runtime.store.directory, 'audit.jsonl')
    if (existsSync(path) && statSync(path).size >= 1024 * 1024) renameSync(path, `${path}.previous`)
    appendFileSync(path, `${JSON.stringify({ time: Date.now(), ...data })}\n`, { mode: 0o600 })
  }
  async approve(connection, params, signal) {
    if (!['files.write', 'terminal.exec'].includes(params.method)) throw new ProtocolError('invalid-argument', 'invalid operation')
    const cap = params.method === 'files.write' ? 'files' : 'terminal'
    if (!connection.negotiatedCaps.has(cap) || !this.runtime.store.find(connection.peerPublicKey)?.caps.includes(cap)) throw new ProtocolError('unauthorized', 'operation capability not granted')
    if (this.grants.size >= 32) throw new ProtocolError('busy', 'too many operation grants')
    await this.target(params.sessionId, params.path ?? params.cwd ?? '.', signal)
    const agent = this.ctx.get('agents')?.get(params.sessionId)
    if (!agent) throw new ProtocolError('unsupported', 'operation approval requires a live session; resume it explicitly')
    const policy = this.ctx.approval.overrideOf(agent.session) ?? this.ctx.approval.config.policy ?? 'ask'
    if (policy === 'never') throw new ProtocolError('approval/denied', 'session approval policy forbids operation')
    if (params.method === 'terminal.exec' && (typeof params.command !== 'string' || !params.command.trim() || params.command.length > 8192)) throw new ProtocolError('invalid-argument', 'invalid command')
    if (params.method === 'files.write' && (typeof params.content !== 'string' || Buffer.byteLength(params.content) > 32768)) throw new ProtocolError('invalid-argument', 'write approval requires exact UTF-8 content up to 32 KiB')
    const id = randomBytes(16).toString('base64url')
    const approvalSignal = AbortSignal.any([signal, AbortSignal.timeout(120000)])
    const request = { agent, toolName: params.method, reason: JSON.stringify({ ...params, content: params.content }), signal: approvalSignal }
    this.audit({ operationId: id, deviceId: connection.peerHello.deviceId, sessionId: params.sessionId, action: 'asked', method: params.method })
    const outcome = await this.ctx.waterfall(scopeTarget(agent, agent), 'approval/request', request, () => 'unavailable')
    this.audit({ operationId: id, deviceId: connection.peerHello.deviceId, sessionId: params.sessionId, action: 'decided', outcome })
    if (outcome !== 'allowed-once' || approvalSignal.aborted) throw new ProtocolError('approval/denied', 'operation was not approved')
    const grant = { connection, params: JSON.parse(JSON.stringify(params)), expires: Date.now() + 60000 }
    grant.timer = setTimeout(() => this.grants.delete(id), 60000)
    this.grants.set(id, grant)
    return { approvalId: id, expiresAt: grant.expires }
  }
  consume(connection, method, params) {
    const grant = this.grants.get(params.approvalId)
    if (!grant || grant.connection !== connection || grant.expires < Date.now() || grant.params.method !== method) throw new ProtocolError('approval/expired', 'one-shot approval unavailable')
    const { approvalId, streamId, ...request } = params
    const { method: approvedMethod, ...approved } = grant.params
    if (JSON.stringify(Object.keys(request).sort().map(key => [key, request[key]])) !== JSON.stringify(Object.keys(approved).sort().map(key => [key, approved[key]]))) throw new ProtocolError('unauthorized', 'operation differs from approved request')
    this.grants.delete(approvalId)
    clearTimeout(grant.timer)
    return grant
  }
  async list(params, signal) {
    const { target, fs } = await this.target(params.sessionId, params.path, signal)
    const entries = await fs.listDir(target, signal)
    if (entries.length > 4096) throw new ProtocolError('busy', 'directory exceeds listing budget')
    const offset = params.offset ?? 0
    if (!Number.isSafeInteger(offset) || offset < 0) throw new ProtocolError('invalid-argument', 'invalid listing offset')
    return { entries: entries.slice(offset, offset + 256).map(entry => ({ name: entry.name, kind: entry.type, ...(entry.size === undefined ? {} : { size: entry.size }) })), hasMore: entries.length > offset + 256 }
  }
  async read(params, signal) {
    const { target, fs } = await this.target(params.sessionId, params.path, signal)
    const offset = params.offset ?? 0
    const length = params.maxBytes ?? 32768
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isInteger(length) || length < 1 || length > 32768) throw new ProtocolError('invalid-argument', 'invalid read window')
    const bytes = await fs.readByteRange(target, { offset, length }, signal)
    return { data: Buffer.from(bytes).toString('base64'), offset, bytes: bytes.length, eof: bytes.length < length }
  }
  async summary(params, signal) {
    const service = this.ctx.get('workspaceChanges')
    if (!service) throw new ProtocolError('unsupported', 'host workspace comparisons unavailable')
    const summary = service.summary(params.sessionId, params.seq)
    if (!summary) throw new ProtocolError('history/unavailable', 'host no longer retains this comparison')
    if (summary.files.length > 4096) throw new ProtocolError('busy', 'change listing exceeds budget')
    const files = []
    for (const [index, file] of summary.files.entries()) {
      try { await this.target(params.sessionId, file.path, signal); files.push({ ...file, index }) }
      catch (error) { if (error.code !== 'unauthorized') throw error }
    }
    return { turn: summary.turn, files, truncated: summary.total > files.length }
  }
  async *diff(params, signal) {
    const service = this.ctx.get('workspaceChanges')
    if (!service) throw new ProtocolError('unsupported', 'host workspace comparisons unavailable')
    const file = service.summary(params.sessionId, params.seq)?.files[params.index]
    if (!file) throw new ProtocolError('history/unavailable', 'host no longer retains this comparison')
    await this.target(params.sessionId, file.path, signal)
    const comparison = await service.diff(params.sessionId, params.seq, params.index, signal)
    if (!comparison) throw new ProtocolError('history/unavailable', 'comparison unavailable')
    yield comparison
  }
  async write(connection, params, signal) {
    this.consume(connection, 'files.write', params)
    const { target, fs, cwd } = await this.target(params.sessionId, params.path, signal)
    await fs.writeText(target, params.content, undefined, signal, { mode: 'workspace-write', workspaceRoot: cwd })
    this.audit({ deviceId: connection.peerHello.deviceId, sessionId: params.sessionId, action: 'written', bytes: Buffer.byteLength(params.content) })
    return { ok: true, bytes: Buffer.byteLength(params.content) }
  }
  async exec(connection, params, signal) {
    this.consume(connection, 'terminal.exec', params)
    const shell = this.ctx.get('shell')
    if (!shell) throw new ProtocolError('unsupported', 'shell executor unavailable')
    const { target, fs } = await this.target(params.sessionId, params.cwd ?? '.', signal)
    const execution = await shell.execute(shell.resolve({ command: params.command, workdir: fs.processPath(target), timeoutMs: 30000, onExpiry: 'kill', stdoutMaxBytes: 32768, signal }))
    const result = await execution.result()
    this.audit({ deviceId: connection.peerHello.deviceId, sessionId: params.sessionId, action: 'executed', exitCode: result.exitCode })
    return { exitCode: result.exitCode, timedOut: result.timedOut, aborted: result.aborted, stdout: result.stdout.text.slice(-16384), stderr: result.stderr.text.slice(-16384), truncated: result.stdout.truncated || result.stderr.truncated }
  }
  close() { for (const grant of this.grants.values()) clearTimeout(grant.timer); this.grants.clear() }
  async *execStream(connection, params, signal) {
    this.consume(connection, 'terminal.exec', params)
    const shell = this.ctx.get('shell')
    if (!shell) throw new ProtocolError('unsupported', 'shell executor unavailable')
    const { target, fs } = await this.target(params.sessionId, params.cwd ?? '.', signal)
    const execution = await shell.execute(shell.resolve({ command: params.command, workdir: fs.processPath(target), timeoutMs: 30000, onExpiry: 'kill', stdoutMaxBytes: 32768, signal }))
    const offsets = { stdout: 0, stderr: 0 }
    let total = 0
    try {
      do {
        for (const channel of ['stdout', 'stderr']) {
          const output = execution.observed[channel].readFrom(offsets[channel])
          offsets[channel] = output.nextOffset
          if (output.lossy) throw new ProtocolError('terminal/output-truncated', 'terminal output exceeded capture budget')
          total += Buffer.byteLength(output.text)
          if (total > 4 * 1024 * 1024) throw new ProtocolError('busy', 'terminal output budget exceeded')
          for (let offset = 0; offset < output.text.length; offset += 8192) yield { channel, text: output.text.slice(offset, offset + 8192) }
        }
        if (execution.status !== 'running') break
        await Promise.race([execution.done, delay(100, undefined, { signal })])
      } while (!signal.aborted)
      const result = await execution.result()
      yield { exitCode: result.exitCode, timedOut: result.timedOut, aborted: result.aborted }
      this.audit({ deviceId: connection.peerHello.deviceId, sessionId: params.sessionId, action: 'executed', exitCode: result.exitCode })
    } finally { if (execution.status === 'running') execution.kill(); await execution.done }
  }
  async *readStream(params, signal) {
    const { target, fs } = await this.target(params.sessionId, params.path, signal)
    const limit = params.maxBytes ?? 4 * 1024 * 1024
    if (!Number.isInteger(limit) || limit < 1 || limit > 4 * 1024 * 1024) throw new ProtocolError('invalid-argument', 'invalid file stream budget')
    const stat = await fs.stat(target, signal)
    if (!stat || stat.type !== 'file') throw new ProtocolError('not-found', 'regular file not found')
    if (stat.size > limit) throw new ProtocolError('busy', 'file exceeds read budget; use byte windows')
    for (let offset = 0; offset < stat.size; offset += 32768) {
      const bytes = await fs.readByteRange(target, { offset, length: Math.min(32768, stat.size - offset) }, signal)
      if (!bytes.length) throw new ProtocolError('files/changed', 'file changed during transfer')
      yield { offset, data: Buffer.from(bytes).toString('base64'), bytes: bytes.length }
    }
    yield { eof: true, bytes: stat.size }
  }
}
