import { EventEmitter } from 'node:events'
import { existsSync, readFileSync, writeFileSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createRemoteServer, deviceId } from '@dsh-remote/core'
import { ProtocolError, KINDS, assertMethod } from '@dsh-remote/protocol'
import { DeviceStore, DEVICE_CAPS } from './store.js'
import { PairingHost } from './pairing.js'
import { InteractionBridge } from './interactions.js'
import { HostStreams } from './streams.js'
import { RemoteClient } from './client.js'
import { WorkspaceOperations } from './operations.js'
import { UploadReceiver } from './uploads.js'
import { AuditLog } from './audit.js'

const SESSION_METHODS = { list: 'list', search: 'search', create: 'create', fork: 'fork', rename: 'rename', prompt: 'prompt', cancel: 'cancel', 'queue.update': 'updateQueue', attachment: 'attachment', projections: 'projections' }

export class RemoteRuntime extends EventEmitter {
  constructor(ctx, { directory, name = 'DSH Remote', port = 0 } = {}) {
    super()
    this.ctx = ctx
    this.name = name
    this.port = port
    this.connections = new Map()
    this.clients = new Map()
    this.attempts = new Map()
    this.sessionTrackingPath = join(directory, 'controlled-sessions.json')
    if (existsSync(this.sessionTrackingPath) && statSync(this.sessionTrackingPath).size > 1024 * 1024) throw new Error('remote session tracking exceeds limit')
    const tracked = existsSync(this.sessionTrackingPath) ? JSON.parse(readFileSync(this.sessionTrackingPath, 'utf8')) : []
    if (!Array.isArray(tracked) || tracked.length > 4096 || tracked.some(id => typeof id !== 'string' || id.length > 256)) throw new Error('invalid remote session tracking')
    this.remotelyDriven = new Set(tracked)
    this.store = new DeviceStore(directory)
    try { this.audit = new AuditLog(directory, () => ctx.logger?.error('remote audit unavailable; new operations are blocked')) }
    catch (error) { this.store.close(); throw error }
    this.pairing = new PairingHost(this.store, name, { audit: (event, data) => this.audit.record(event, data) })
    this.pairing.on('paired', data => this.observe('pairing.completed', data))
    this.pairing.on('cancelled', data => this.observe('pairing.cancelled', data))
    this.operations = new WorkspaceOperations(ctx, this)
    this.pairing.on('pending', value => this.emit('pairing', value))
    this.interactions = new InteractionBridge(ctx, sessionId => [...this.connections.entries()]
      .filter(([connection, value]) => connection.state === 'ready' && connection.negotiatedCaps.has('approval') && value.streams.sessions().has(sessionId))
      .map(([connection]) => connection), { audit: (event, data) => this.audit.record(event, data) })
  }
  observe(event, data, connection) {
    if (this.audit.closed && this.stopping) return false
    try { this.audit.record(event, data); queueMicrotask(() => this.emit('change')); return true }
    catch { connection?.close(new ProtocolError('internal', 'remote audit unavailable')); return false }
  }
  async start() {
    for (const method of [...Object.values(SESSION_METHODS), 'follow', 'page', 'control']) {
      if (typeof this.ctx.sessionController?.[method] !== 'function') throw new Error(`unsupported DSH sessionController.${method}`)
    }
    this.server = await createRemoteServer({
      keyPair: this.store.keyPair, name: this.name, kind: 'dsh', caps: DEVICE_CAPS, port: this.port, requestTimeoutMs: 120000,
      connectionOptionsForRequest: request => {
        const address = request.socket.remoteAddress ?? 'unknown'
        const now = Date.now()
        for (const [key, value] of this.attempts) if (value.until <= now) this.attempts.delete(key)
        const attempt = this.attempts.get(address) ?? { count: 0, until: now + 60000 }
        if (this.attempts.size >= 1024 || ++attempt.count > 10) throw new ProtocolError('busy', 'handshake rate exceeded')
        this.attempts.set(address, attempt)
        const url = new URL(request.url, 'http://localhost')
        if (url.pathname !== '/remote/ws') throw new ProtocolError('not-found', 'unknown endpoint')
        const sid = url.searchParams.get('sid')
        return sid ? this.pairing.claim(sid) : { verifyPeer: publicKey => Boolean(this.store.find(publicKey)) }
      },
    })
    this.server.on('upgrade-rejected', data => this.observe('connection.rejected', { ...data, direction: 'inbound' }))
    this.server.on('connection', (connection, { address } = {}) => {
      const metadata = () => ({ address, direction: 'inbound',
        ...(connection.noise.rs ? { deviceId: deviceId(connection.noise.rs) } : {}),
        ...(connection.peerHello ? { deviceId: connection.peerHello.deviceId, role: connection.peerHello.role, kind: connection.peerHello.kind } : {}) })
      connection.once('closed', error => this.observe('connection.closed', { ...metadata(), code: error.code, status: this.stopping ? 'normal-shutdown' : 'disconnected' }))
      connection.on('request', data => this.observe('rpc.received', { ...metadata(), ...data }, connection))
      connection.on('request-result', data => this.observe('rpc.completed', { ...metadata(), ...data }, connection))
      if (!this.observe('connection.accepted', metadata(), connection)) return
      connection.ready.then(() => {
        if (!this.observe('connection.authenticated', metadata(), connection)) return
        if (!connection.pairSid) this.attach(connection)
      }).catch(error => this.observe('connection.rejected', { ...metadata(), code: error.code }))
      if (connection.pairSid) this.pairing.attach(connection)
    })
    this.audit.record('runtime.started')
    return this
  }
  attach(connection) {
    const device = this.store.find(connection.peerPublicKey)
    if (!device) { connection.close(); return }
    connection.negotiatedCaps = new Set([...connection.negotiatedCaps].filter(cap => device.caps.includes(cap)))
    const streams = new HostStreams(connection, this.ctx.sessionController, () => {
      for (const pending of this.interactions.list(connection)) {
        connection.sendFrame(KINDS.EVT, { type: 'application', name: pending.approvalId ? 'approval.request' : 'question.request', data: pending }).catch(error => connection.close(error))
      }
    })
    const uploads = new UploadReceiver(connection, this.ctx)
    this.connections.set(connection, { device, streams, uploads })
    connection.once('closed', () => this.connections.delete(connection))
    const register = (method, cap, handler) => connection.register(method, cap, async (params, options) => {
      assertMethod(method, params)
      const current = this.store.find(connection.peerPublicKey)
      if (!current?.caps.includes(cap)) throw new ProtocolError('unauthorized', 'device authorization removed')
      try { return await handler(params, options) }
      catch (error) {
        if (error instanceof ProtocolError) throw error
        if (typeof error.code === 'string') throw new ProtocolError(error.code, 'DSH operation failed')
        throw error
      }
    })
    for (const [suffix, method] of Object.entries(SESSION_METHODS)) {
      register(`session.${suffix}`, 'session', async (params, { signal }) => {
        const previouslyTracked = this.remotelyDriven.has(params.sessionId)
        if (suffix === 'prompt') {
          if (this.remotelyDriven.size >= 4096 && !this.remotelyDriven.has(params.sessionId)) throw new ProtocolError('busy', 'remote session tracking full')
          this.remotelyDriven.add(params.sessionId)
          this.saveTrackedSessions()
        }
        try { return await this.ctx.sessionController[method](params, signal) }
        catch (error) {
          if (suffix === 'prompt' && !previouslyTracked) { this.remotelyDriven.delete(params.sessionId); this.saveTrackedSessions() }
          throw error
        }
      })
    }
    for (const method of ['stream.open', 'history.page', 'control.subscribe']) register(method, 'stream', params => streams.open(params, method))
    register('session.upload.begin', 'session', params => uploads.begin(params))
    register('session.upload.chunk', 'session', params => uploads.chunk(params))
    register('session.upload.finish', 'session', params => uploads.finish(params))
    for (const method of ['subagent.list', 'subagent.prompt', 'subagent.cancel']) register(method, 'session', async (params, { signal }) => {
      const service = this.ctx.get('subagents')
      if (!service) throw new ProtocolError('unsupported', 'subagent service unavailable')
      if (method === 'subagent.list') {
        const items = await service.listChildren(params.sessionId, signal)
        if (items.length > 256) throw new ProtocolError('busy', 'subagent listing exceeds budget')
        return { items }
      }
      if (method === 'subagent.cancel') return service.interruptByParent(params.childSessionId, params.parentSessionId, params.mode)
      const tracked = this.remotelyDriven.has(params.childSessionId)
      if (this.remotelyDriven.size >= 4096 && !tracked) throw new ProtocolError('busy', 'remote session tracking full')
      this.remotelyDriven.add(params.childSessionId)
      this.saveTrackedSessions()
      try { return await service.prompt(params, signal) }
      catch (error) { if (!tracked) { this.remotelyDriven.delete(params.childSessionId); this.saveTrackedSessions() }; throw error }
    })
    register('workspace.list', 'session', async (params, { signal }) => {
      const controller = this.ctx.get('workspaceController')
      if (!controller) throw new ProtocolError('unsupported', 'workspace registry unavailable')
      const source = controller.follow(signal)[Symbol.asyncIterator]()
      try {
        const frame = (await source.next()).value
        if (frame?.type !== 'baseline') throw new ProtocolError('internal', 'workspace baseline unavailable')
        if (frame.value.items.length > 256) throw new ProtocolError('busy', 'workspace listing exceeds budget')
        return { items: frame.value.items.map(({ workspaceId, path, title }) => ({ workspaceId, path, title })) }
      } finally { await source.return?.() }
    })
    register('stream.close', 'stream', params => streams.stop(params.streamId))
    register('approval.pending', 'approval', params => ({ items: this.interactions.list(connection, params.sessionId).filter(item => item.approvalId) }))
    register('approval.decide', 'approval', params => this.interactions.decide(params.approvalId, params.outcome, connection))
    register('question.answer', 'approval', params => this.interactions.decide(params.questionId, params.answer, connection))
    register('device.list', 'admin', () => ({ devices: this.devices() }))
    register('device.rename', 'admin', params => { this.store.rename(params.deviceId, params.name); this.emit('change'); return { ok: true } })
    register('device.revoke', 'admin', params => {
      if (params.deviceId === device.deviceId) throw new ProtocolError('invalid-argument', 'revoke current device locally')
      this.revoke(params.deviceId)
      return { revoked: true }
    })
    register('pair.begin', 'admin', params => ({ qr: this.pairing.begin(this.endpoint, params.caps), sasLen: 6 }))
    register('files.list', 'files', (params, { signal }) => this.operations.list(params, signal))
    register('changes.summary', 'files', (params, { signal }) => this.operations.summary(params, signal))
    register('changes.diff', 'files', params => streams.open(params, 'changes.diff', signal => this.operations.diff(params, signal)))
    register('files.read', 'files', (params, { signal }) => params.streamId
      ? streams.open(params, 'files.read', streamSignal => this.operations.readStream(params, streamSignal)) : this.operations.read(params, signal))
    if (device.caps.includes('files') || device.caps.includes('terminal')) {
      register('operation.prepare', device.caps.includes('files') ? 'files' : 'terminal', (params, { signal }) => this.operations.approve(connection, params, signal))
    }
    register('files.write', 'files', (params, { signal }) => this.operations.write(connection, params, signal))
    register('terminal.exec', 'terminal', (params, { signal }) => params.streamId
      ? streams.open(params, 'terminal.exec', streamSignal => this.operations.execStream(connection, params, streamSignal)) : this.operations.exec(connection, params, signal))
    this.emit('connected', { deviceId: device.deviceId })
  }
  get endpoint() { return this.tunnelManager?.url ? `wss://${new URL(this.tunnelManager.url).host}/remote/ws` : this.server?.endpoint }
  saveTrackedSessions() {
    writeFileSync(`${this.sessionTrackingPath}.tmp`, JSON.stringify([...this.remotelyDriven]), { mode: 0o600 })
    renameSync(`${this.sessionTrackingPath}.tmp`, this.sessionTrackingPath)
  }
  async remoteDriven(agent, signal) {
    let header = agent?.session.header
    const visited = new Set()
    while (header) {
      if (this.remotelyDriven.has(header.id)) return true
      if (!header.parentSession) return false
      if (visited.has(header.parentSession) || visited.size >= 16) throw new ProtocolError('unauthorized', 'remote-control ancestry is cyclic or too deep')
      visited.add(header.parentSession)
      const live = this.ctx.get('agents')?.get(header.parentSession)
      if (live) header = live.session.header
      else {
        const source = this.ctx.sessionController.follow({ address: { kind: 'session', sessionId: header.parentSession }, maxMessages: 1 }, signal)[Symbol.asyncIterator]()
        try { header = (await source.next()).value?.header }
        finally { await source.return?.() }
        if (!header) throw new ProtocolError('unauthorized', 'remote-control ancestry unavailable')
      }
    }
    return false
  }
  devices() {
    const online = new Set([...this.connections.values()].map(value => value.device.deviceId))
    return this.store.list().map(device => ({ ...device, online: online.has(device.deviceId) }))
  }
  revoke(id) {
    // Emergency local revocation and resource teardown remain available if audit fails.
    this.observe('device.revoke-requested', { deviceId: id })
    this.store.revoke(id)
    for (const [connection, value] of this.connections) if (value.device.deviceId === id) connection.close(new ProtocolError('unauthorized', 'device revoked'))
    this.clients.get(id)?.close()
    this.clients.delete(id)
    this.observe('device.revoked', { deviceId: id })
  }
  async connect(id, endpoint) {
    const peer = this.store.devices.find(device => device.deviceId === id && !device.revokedAt && device.remoteCaps?.length)
    if (!peer) throw new ProtocolError('unauthorized', 'unknown remote device')
    const previous = this.clients.get(id)
    if (previous?.connection?.state === 'ready') return previous
    if (previous?.connecting) return previous.connecting
    const client = new RemoteClient(this.store, peer)
    this.audit.record('connection.connecting', { deviceId: id, direction: 'outbound' })
    client.on('disconnected', code => this.observe('connection.closed', { deviceId: id, direction: 'outbound', code, status: this.stopping ? 'normal-shutdown' : 'disconnected' }))
    this.clients.set(id, client)
    client.connecting = client.connect(endpoint).finally(() => { client.connecting = null })
    try {
      const connected = await client.connecting
      this.audit.record('connection.authenticated', { deviceId: id, direction: 'outbound' })
      this.emit('change')
      return connected
    }
    catch (error) {
      client.close()
      this.observe('connection.rejected', { deviceId: id, direction: 'outbound', code: error.code })
      if (this.clients.get(id) === client) this.clients.delete(id)
      throw error
    }
  }
  async close() {
    this.stopping = true
    this.pairing.cancel()
    this.interactions.close()
    this.operations.close()
    const streams = [...this.connections.values()].map(value => value.streams)
    const uploads = [...this.connections.values()].map(value => value.uploads)
    for (const stream of streams) stream.close()
    for (const upload of uploads) upload.close()
    await Promise.allSettled([this.server?.close(), ...[...this.clients.values()].map(client => client.close())])
    await Promise.allSettled(streams.map(stream => stream.settled()))
    await Promise.allSettled(uploads.map(upload => upload.settled()))
    this.store.close()
    this.clients.clear()
    this.observe('runtime.stopped')
    this.audit.close()
  }
}
