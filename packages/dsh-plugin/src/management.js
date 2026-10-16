import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { deviceId } from '@dsh-remote/core'
import { ProtocolError, assertValue } from '@dsh-remote/protocol'
import { TunnelManager } from '@dsh-remote/tunnel'
import QRCode from 'qrcode'
import { pairDevice } from './client.js'

const active = value => value && ['connecting', 'confirming', 'waiting'].includes(value.state)
const fail = (code, message) => { throw new ProtocolError(code, message) }
const text = (value, limit = 256) => typeof value === 'string' && value.length > 0 && value.length <= limit

/** One profile owns management tasks; views only observe and issue explicit commands. */
export class RemoteManagement extends EventEmitter {
  constructor(runtime, config = {}) {
    super()
    this.setMaxListeners(16)
    this.runtime = runtime
    this.config = config
    this.revision = 0
    this.watchers = 0
    this.images = new WeakMap()
    this.changed = () => { this.revision++; this.emit('change') }
    this.tunnelChanged = () => { runtime.pairing.cancel(); this.changed() }
    runtime.on('change', this.changed)
    runtime.pairing.on('change', this.changed)
  }
  tunnel() {
    if (!this.runtime.tunnelManager) {
      this.runtime.tunnelManager = new TunnelManager({ binary: this.config.cloudflared })
      this.runtime.tunnelManager.on('state', this.tunnelChanged)
    }
    return this.runtime.tunnelManager
  }
  async snapshot() {
    const runtime = this.runtime
    const revision = this.revision
    const incoming = runtime.pairing.pending() ?? runtime.pairing.lastResult
    let image
    const qr = runtime.pairing.slot?.qr
    if (qr && incoming?.state !== 'consumed') {
      if (!this.images.has(qr)) this.images.set(qr, QRCode.toDataURL(JSON.stringify(qr), { width: 280, margin: 2 }))
      image = await this.images.get(qr)
    }
    return {
      revision, name: runtime.name, deviceId: deviceId(runtime.store.keyPair.publicKey),
      endpoint: runtime.endpoint,
      devices: runtime.devices().map(device => ({ ...device,
        inbound: [...runtime.connections.values()].some(value => value.device.deviceId === device.deviceId),
        outbound: runtime.clients.get(device.deviceId)?.connection?.state === 'ready',
      })),
      tunnel: { state: runtime.tunnelManager?.state ?? 'stopped', endpoint: runtime.tunnelManager?.url ? runtime.endpoint : null },
      incoming: incoming ? { ...incoming, peer: incoming.peer ? { name: incoming.peer.name, deviceId: incoming.peer.deviceId } : null,
        sas: incoming.state === 'confirming' ? incoming.sas : undefined,
        ...(image ? { qr, image } : {}) } : null,
      outgoing: this.outgoing ? { id: this.outgoing.id, state: this.outgoing.state, exp: this.outgoing.exp,
        sas: this.outgoing.sas, name: this.outgoing.name, caps: this.outgoing.caps, deviceId: this.outgoing.deviceId, code: this.outgoing.code } : null,
    }
  }
  async watch(revision, signal) {
    if (!Number.isSafeInteger(revision) || revision < 0) fail('invalid-argument', 'invalid revision')
    if (this.watchers >= 16) fail('busy', 'too many management observers')
    this.watchers++
    try {
      if (revision === this.revision && !signal?.aborted) await new Promise(resolve => {
        const finish = () => { clearTimeout(timer); this.off('change', finish); signal?.removeEventListener('abort', finish); resolve() }
        const timer = setTimeout(finish, 20000)
        this.on('change', finish)
        signal?.addEventListener('abort', finish, { once: true })
        if (revision !== this.revision || signal?.aborted || this.closed) finish()
      })
      return await this.snapshot()
    } finally { this.watchers-- }
  }
  incoming(sid) {
    const slot = this.runtime.pairing.slot
    if (!text(sid) || !slot || slot.sid !== sid) fail('unauthorized', 'pairing was replaced or expired')
    return slot
  }
  async beginOutgoing(qr) {
    if (active(this.outgoing)) fail('busy', 'a pairing task is already active')
    if (!qr || typeof qr !== 'object' || Buffer.byteLength(JSON.stringify(qr)) > 8192) fail('invalid-argument', 'invalid pairing information')
    assertValue('PairingPayload', qr)
    const slot = { id: randomUUID(), state: 'connecting', exp: Math.min(qr.exp * 1000, Date.now() + 180000), name: qr.name, caps: qr.caps, abort: new AbortController() }
    if (!Number.isSafeInteger(slot.exp) || slot.exp <= Date.now()) fail('invalid-argument', 'pairing information expired')
    this.outgoing = slot
    const timer = setTimeout(() => this.cancelOutgoing(slot.id, 'expired'), slot.exp - Date.now())
    slot.task = pairDevice(this.runtime.store, qr, challenge => {
      if (slot.abort.signal.aborted) fail('cancelled', 'pairing cancelled')
      Object.assign(slot, challenge, { state: 'confirming' })
      this.changed()
      return new Promise((resolve, reject) => { slot.resolve = resolve; slot.reject = reject })
    }, this.runtime.name, { signal: slot.abort.signal }).then(record => {
      Object.assign(slot, { state: 'paired', name: record.name, deviceId: record.deviceId })
    }).catch(error => {
      if (!slot.abort.signal.aborted) { slot.state = 'failed'; slot.code = error instanceof ProtocolError ? error.code : 'transport/lost' }
    }).finally(() => { clearTimeout(timer); slot.sas = undefined; slot.resolve = null; slot.reject = null; this.changed() })
    this.changed()
    return { id: slot.id }
  }
  cancelOutgoing(id, state = 'cancelled') {
    const slot = this.outgoing
    if (!text(id) || slot?.id !== id) fail('unauthorized', 'pairing was replaced or expired')
    if (!active(slot)) return { ok: true }
    slot.state = state
    slot.sas = undefined
    slot.abort.abort()
    slot.reject?.(new ProtocolError('cancelled', 'pairing cancelled'))
    this.changed()
    return { ok: true }
  }
  async call(method, params = {}, { signal } = {}) {
    if (this.closed) fail('cancelled', 'management is stopped')
    if (!params || typeof params !== 'object' || Array.isArray(params)) fail('invalid-argument', 'invalid management parameters')
    const runtime = this.runtime
    switch (method) {
      case 'status': return this.snapshot()
      case 'watch': return this.watch(params.revision, signal)
      case 'pair.begin': {
        if (runtime.pairing.slot && runtime.pairing.slot.state !== 'consumed') fail('busy', 'a pairing task is already active')
        const qr = runtime.pairing.begin(runtime.endpoint, params.caps)
        return { sid: qr.sid }
      }
      case 'pair.confirm': this.incoming(params.sid); runtime.pairing.confirm(params.sas); break
      case 'pair.cancel': this.incoming(params.sid); runtime.pairing.cancel(); break
      case 'pair.connect': return this.beginOutgoing(params.qr)
      case 'pair.accept': {
        const slot = this.outgoing
        if (!text(params.id) || slot?.id !== params.id || slot.state !== 'confirming' || slot.exp <= Date.now() || params.sas !== slot.sas) fail('unauthorized', 'pairing confirmation mismatch')
        slot.state = 'waiting'; slot.resolve(true); break
      }
      case 'pair.disconnect': return this.cancelOutgoing(params.id)
      case 'device.rename': runtime.store.rename(params.deviceId, params.name); break
      case 'device.revoke': runtime.revoke(params.deviceId); break
      case 'device.connect': {
        if (!text(params.deviceId) || params.endpoint !== undefined && !text(params.endpoint, 2048)) fail('invalid-argument', 'invalid device target')
        const previous = runtime.clients.get(params.deviceId)
        if (params.endpoint && (previous?.connecting || previous?.connection?.state === 'ready')) fail('busy', 'disconnect before updating the endpoint')
        const client = await runtime.connect(params.deviceId, params.endpoint)
        if (params.endpoint) { runtime.store.setEndpoint(params.deviceId, params.endpoint); client.peer.endpoint = params.endpoint }
        break
      }
      case 'device.disconnect': {
        if (!text(params.deviceId)) fail('invalid-argument', 'invalid device target')
        const client = runtime.clients.get(params.deviceId)
        await client?.close()
        if (runtime.clients.get(params.deviceId) === client) runtime.clients.delete(params.deviceId)
        break
      }
      case 'tunnel.check': return new Promise(resolve => execFile(this.config.cloudflared ?? 'cloudflared', ['--version'], { timeout: 3000, maxBuffer: 4096, windowsHide: true }, error => resolve({ available: !error })))
      case 'tunnel.start': {
        runtime.pairing.cancel()
        try { await this.tunnel().start(runtime.server.origin) } finally { this.changed() }
        break
      }
      case 'tunnel.stop': runtime.pairing.cancel(); await this.tunnel().stop(); break
      default: fail('unsupported', 'unknown management operation')
    }
    this.changed()
    return { ok: true }
  }
  async close() {
    this.closed = true
    if (active(this.outgoing)) this.cancelOutgoing(this.outgoing.id)
    await this.outgoing?.task
    this.runtime.off('change', this.changed)
    this.runtime.pairing.off('change', this.changed)
    this.runtime.tunnelManager?.off('state', this.tunnelChanged)
    this.changed()
  }
}

/** Connection's exact /api routes run behind its browser auth and desktop carrier. */
export function registerManagement(ctx, management) {
  let pending = 0
  return ctx.connection.fetch.register({ path: '/api/dsh-remote/manage', methods: ['POST'], requestBody: 'streaming',
    async fetch(request) {
      if (pending >= 32) return new Response(null, { status: 429 })
      pending++
      const reader = request.body?.getReader()
      let timedOut = false
      const timer = setTimeout(() => { timedOut = true; reader?.cancel().catch(() => {}) }, 10000)
      try {
        if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') return new Response(null, { status: 415 })
        const chunks = []
        let size = 0
        while (reader) {
          const { done, value } = await reader.read()
          if (done) break
          size += value.byteLength
          if (size > 16384) return new Response(null, { status: 413 })
          chunks.push(value)
        }
        clearTimeout(timer)
        if (timedOut) return new Response(null, { status: 408 })
        let message
        try { message = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))) } catch { return new Response(null, { status: 400 }) }
        if (message?.type !== 'client-request' || !text(message.rpcId, 128) || message.method !== 'dsh-remote/manage' || !text(message.payload?.method, 64)) return new Response(null, { status: 400 })
        let result
        try { result = { ok: true, value: await management.call(message.payload.method, message.payload.params, { signal: request.signal }) } }
        catch (error) { result = { ok: false, error: { code: error.code ?? 'internal', message: error instanceof ProtocolError ? error.message : 'remote management failed' } } }
        return Response.json({ type: 'server-response', rpcId: message.rpcId, result }, { headers: { 'cache-control': 'no-store' } })
      } finally { clearTimeout(timer); await reader?.cancel().catch(() => {}); pending-- }
    },
  })
}
