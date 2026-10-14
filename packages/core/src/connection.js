import { EventEmitter } from 'node:events'
import { randomBytes } from 'node:crypto'
import {
  VERSION, HEADER_BYTES, KINDS, MAX_STREAMS, MAX_PENDING_REQUESTS,
  MAX_QUEUE_BYTES, MAX_QUEUE_MESSAGES, ProtocolError, encodeHeader, decodeHeader,
  encodePayload, decodePayload,
} from '@dsh-remote/protocol'
import { NoiseXX, deriveSas } from './noise-xx.js'
import { BLAKE2S, sha256 } from './primitives.js'
import { equalBytes, utf8 } from './bytes.js'

export const deviceId = publicKey => Buffer.from(sha256(publicKey).subarray(0, 16)).toString('base64url')
const requestId = () => randomBytes(8).toString('base64url')

/** One pinned Noise session. The owner closes it; it never reconnects or reuses a nonce. */
export class SecureConnection extends EventEmitter {
  constructor(transport, {
    initiator, keyPair, peerPublicKey, verifyPeer, pairSid, caps = ['diagnostic', 'stream'], kind = 'cli', name = 'DSH Remote',
    handshakeTimeoutMs = 10000, requestTimeoutMs = 10000, heartbeatMs = 25000, sendTimeoutMs = 10000,
  }) {
    super()
    if ((peerPublicKey?.length !== 32 && (initiator || typeof verifyPeer !== 'function')) || keyPair?.secretKey?.length !== 32 || keyPair?.publicKey?.length !== 32 ||
        pairSid !== undefined && !/^[A-Za-z0-9_-]{22}$/.test(pairSid)) {
      transport.close()
      throw new ProtocolError('invalid-argument', 'explicit 32-byte identity and peer pin required')
    }
    for (const value of [handshakeTimeoutMs, requestTimeoutMs, heartbeatMs, sendTimeoutMs]) {
      if (!Number.isSafeInteger(value) || value < 1) { transport.close(); throw new ProtocolError('invalid-argument', 'timeouts must be positive integers') }
    }
    this.transport = transport
    this.initiator = initiator
    this.peerPublicKey = peerPublicKey ? Uint8Array.from(peerPublicKey) : null
    this.verifyPeer = verifyPeer
    this.pairSid = pairSid
    this.caps = new Set(caps)
    this.negotiatedCaps = new Set()
    this.kind = kind
    this.name = name
    this.keyPair = keyPair
    this.requestTimeoutMs = requestTimeoutMs
    this.sendTimeoutMs = sendTimeoutMs
    this.state = 'handshaking'
    this.streams = new Map([[0, { tx: 0, rx: 0 }]])
    this.nextStream = initiator ? 1 : 2
    this.lastLocalStream = 0
    this.lastRemoteStream = 0
    this.handlers = new Map()
    this.pending = new Map()
    this.active = new Map()
    this.queueBytes = 0
    this.queueMessages = 0
    this.tail = Promise.resolve()
    this.heartbeats = new Set()
    this.noise = new NoiseXX({
      initiator, staticKeyPair: keyPair, suite: BLAKE2S,
      prologue: utf8(pairSid ? `dsh-remote/v1/pair:${pairSid}` : `dsh-remote/v1/resume:${deviceId(initiator ? peerPublicKey : keyPair.publicKey)}`),
    })
    this.ready = new Promise((resolve, reject) => { this.resolveReady = resolve; this.rejectReady = reject })
    this.ready.catch(() => {}) // An accepted peer may disconnect before its owner awaits ready.
    this.closed = new Promise(resolve => { this.resolveClosed = resolve })
    this.onMessage = bytes => {
      try { this.receive(bytes) }
      catch (error) { this.close(error instanceof ProtocolError ? error : new ProtocolError('unauthorized', 'Noise authentication failed')) }
    }
    this.onTransportClose = error => this.close(error)
    transport.on('message', this.onMessage)
    transport.once('closed', this.onTransportClose)
    this.handshakeTimer = setTimeout(() => this.close(new ProtocolError('transport/lost', 'handshake timed out')), handshakeTimeoutMs)
    this.heartbeatTimer = setInterval(() => {
      if (this.state !== 'ready') return
      if (this.heartbeats.size >= 3) { this.close(new ProtocolError('transport/lost', 'heartbeat timed out')); return }
      const id = requestId()
      this.heartbeats.add(id)
      this.sendFrame(KINDS.EVT, { type: 'ping', id }).catch(error => this.close(error))
    }, heartbeatMs)
    if (initiator) this.enqueue(this.noise.writeMessage()).catch(error => this.close(error))
  }

  receive(bytes) {
    if (this.state === 'closed') return
    if (this.state === 'denied') return
    if (this.state === 'handshaking') {
      this.noise.readMessage(bytes)
      if (this.noise.rs && this.peerPublicKey && !equalBytes(this.noise.rs, this.peerPublicKey)) throw new ProtocolError('unauthorized', 'peer identity does not match pin')
      if (!this.noise.complete) this.enqueue(this.noise.writeMessage()).catch(error => this.close(error))
      if (this.noise.complete) {
        if (this.verifyPeer && this.verifyPeer(this.noise.rs) !== true) {
          this.state = 'denied'
          const error = new ProtocolError('unauthorized', 'peer identity is not authorized')
          this.sendFrame(KINDS.EVT, { type: 'authentication-rejected', code: 'unauthorized' }).then(() => this.close(error), () => this.close(error))
          return
        }
        this.peerPublicKey = Uint8Array.from(this.noise.rs)
        this.sas = deriveSas(this.noise.handshakeHash, this.initiator ? this.keyPair.publicKey : this.peerPublicKey, this.initiator ? this.peerPublicKey : this.keyPair.publicKey)
        for (const value of [this.noise.s.secretKey, this.noise.e?.secretKey, this.noise.ck, this.noise.cipher.k]) value?.fill(0)
        this.state = 'hello'
        this.sendFrame(KINDS.EVT, {
          type: 'hello', vmin: VERSION, vmax: VERSION, caps: [...this.caps],
          role: this.initiator ? 'controller' : 'controlled', kind: this.kind,
          deviceId: deviceId(this.keyPair.publicKey), name: this.name,
        }).catch(error => this.close(error))
      }
      return
    }
    const header = decodeHeader(bytes)
    const stream = this.streams.get(header.streamId)
    if (!stream || header.seq !== stream.rx) throw new ProtocolError('invalid-argument', 'unexpected stream or physical frame sequence')
    const plaintext = this.noise.rx.decrypt(bytes.subarray(HEADER_BYTES), bytes.subarray(0, HEADER_BYTES))
    const value = decodePayload(header.kind, plaintext)
    stream.rx++
    if (this.state === 'hello') {
      if (header.streamId === 0 && header.kind === KINDS.EVT && value.type === 'authentication-rejected') throw new ProtocolError('unauthorized', 'paired host refused this device')
      if (header.streamId !== 0 || header.kind !== KINDS.EVT || value.type !== 'hello' ||
          value.role !== (this.initiator ? 'controlled' : 'controller') || value.kind === 'mobile' && value.role === 'controlled' ||
          value.vmin > VERSION || value.vmax < VERSION || value.vmin > value.vmax || value.deviceId !== deviceId(this.peerPublicKey)) {
        throw new ProtocolError('unauthorized', 'invalid peer hello')
      }
      this.negotiatedCaps = new Set(value.caps.filter(cap => this.caps.has(cap)))
      this.peerHello = value
      if (this.negotiatedCaps.size === 0) throw new ProtocolError('unsupported', 'no common capabilities')
      this.state = 'ready'
      clearTimeout(this.handshakeTimer)
      this.resolveReady(this)
      this.emit('ready')
      return
    }
    if (header.kind === KINDS.RES || header.kind === KINDS.ERR) {
      if (header.streamId !== 0) throw new ProtocolError('invalid-argument', 'RPC must use control stream')
      const pending = this.pending.get(value.id)
      if (!pending) return // A response may arrive after the caller's timeout/abort.
      pending.finish(header.kind === KINDS.ERR ? new ProtocolError(value.e.code, value.e.message) : null, value.r)
    } else if (header.kind === KINDS.REQ) {
      if (header.streamId !== 0) throw new ProtocolError('invalid-argument', 'RPC must use control stream')
      this.dispatch(value)
    } else if (header.kind === KINDS.EVT && header.streamId === 0) {
      if (value.type === 'ping') this.sendFrame(KINDS.EVT, { type: 'pong', id: value.id }).catch(error => this.close(error))
      else if (value.type === 'pong') this.heartbeats.delete(value.id)
      else if (value.type === 'bye') this.close()
      else if (value.type === 'application') this.emit('event', value)
      else throw new ProtocolError('invalid-argument', 'unexpected control event')
    } else {
      if (header.streamId === 0) throw new ProtocolError('invalid-argument', 'stream frame requires stream id')
      this.emit('stream', { ...header, value })
      if (header.kind === KINDS.SEND) this.releaseStream(header.streamId)
    }
  }

  enqueue(bytes) {
    if (this.state === 'closed') return Promise.reject(new ProtocolError('transport/lost', 'connection closed'))
    if (this.queueMessages >= MAX_QUEUE_MESSAGES || this.queueBytes + bytes.length > MAX_QUEUE_BYTES) {
      const error = new ProtocolError('busy', 'outgoing queue is full')
      this.close(error)
      return Promise.reject(error)
    }
    this.queueMessages++
    this.queueBytes += bytes.length
    const operation = this.tail.then(async () => {
      if (this.state === 'closed') throw new ProtocolError('transport/lost', 'connection closed')
      let timer
      let onClosed
      try {
        await Promise.race([
          this.transport.send(bytes),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new ProtocolError('transport/lost', 'send timed out')), this.sendTimeoutMs) }),
          new Promise((_, reject) => { onClosed = reject; this.once('closed', onClosed) }),
        ])
      } finally { clearTimeout(timer); this.removeListener('closed', onClosed) }
    }).finally(() => { this.queueMessages--; this.queueBytes -= bytes.length })
    this.tail = operation.catch(error => this.close(error))
    return operation
  }

  sendFrame(kind, value, streamId = 0) {
    if (this.state !== 'ready' && !(this.state === 'hello' && kind === KINDS.EVT && value.type === 'hello') &&
        !(this.state === 'denied' && kind === KINDS.EVT && value.type === 'authentication-rejected')) {
      return Promise.reject(new ProtocolError('unauthorized', 'connection is not authenticated'))
    }
    try {
      const stream = this.streams.get(streamId)
      if (!stream) throw new ProtocolError('invalid-argument', 'unknown stream')
      const payload = encodePayload(kind, value)
      const header = encodeHeader({ kind, streamId, seq: stream.tx })
      // The conservative v1 budget ends the connection; a fresh handshake creates new keys.
      if (this.noise.tx.n >= 0xfffffffe) throw new ProtocolError('transport/lost', 'Noise message budget exhausted; reconnect required')
      const encrypted = this.noise.tx.encrypt(payload, header)
      stream.tx++
      return this.enqueue(Buffer.concat([header, encrypted]))
    } catch (error) {
      if (error.code === 'transport/lost') this.close(error)
      return Promise.reject(error)
    }
  }

  register(method, capability, handler) {
    if (this.handlers.has(method)) throw new Error(`duplicate method: ${method}`)
    this.handlers.set(method, { capability, handler })
    return () => this.handlers.delete(method)
  }

  request(method, params = {}, { signal, timeoutMs = this.requestTimeoutMs } = {}) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) return Promise.reject(new ProtocolError('invalid-argument', 'invalid request deadline'))
    if (this.state !== 'ready') return Promise.reject(new ProtocolError('unauthorized', 'connection is not ready'))
    if (this.pending.size >= MAX_PENDING_REQUESTS) return Promise.reject(new ProtocolError('busy', 'too many pending requests'))
    if (signal?.aborted) return Promise.reject(new ProtocolError('cancelled', 'request cancelled'))
    const id = requestId()
    return new Promise((resolve, reject) => {
      const onAbort = () => finish(new ProtocolError('cancelled', 'request cancelled'))
      const finish = (error, result) => {
        if (!this.pending.delete(id)) return
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        error ? reject(error) : resolve(result)
      }
      const timer = setTimeout(() => finish(new ProtocolError('timeout', 'request timed out')), timeoutMs)
      this.pending.set(id, { finish })
      signal?.addEventListener('abort', onAbort, { once: true })
      this.sendFrame(KINDS.REQ, { id, m: method, p: params }).catch(error => finish(error))
    })
  }

  dispatch(request) {
    const registered = this.handlers.get(request.m)
    if (this.active.has(request.id)) { this.close(new ProtocolError('invalid-argument', 'duplicate active RPC id')); return }
    const metadata = { requestId: request.id, method: registered ? request.m : 'unknown' }
    this.emit('request', metadata)
    if (this.state !== 'ready') return
    const replyError = error => {
      this.emit('request-result', { ...metadata, status: 'failed', code: error instanceof ProtocolError ? error.code : 'internal' })
      if (this.state !== 'ready') return
      return this.sendFrame(KINDS.ERR, { id: request.id, e: {
      code: error instanceof ProtocolError ? error.code : 'internal',
      message: error instanceof ProtocolError ? error.message.slice(0, 256) : 'method failed',
      } }).catch(failure => this.close(failure))
    }
    if (!registered) { replyError(new ProtocolError('unsupported', 'unknown method')); return }
    if (!this.negotiatedCaps.has(registered.capability)) { replyError(new ProtocolError('unauthorized', 'capability not granted')); return }
    if (this.active.size >= MAX_PENDING_REQUESTS) { replyError(new ProtocolError('busy', 'too many active requests')); return }
    const abort = new AbortController()
    const timer = setTimeout(() => abort.abort(), this.requestTimeoutMs)
    this.active.set(request.id, abort)
    const interrupted = new Promise((_, reject) => {
      abort.signal.addEventListener('abort', () => reject(new ProtocolError('cancelled', 'request stopped')), { once: true })
    })
    // A handler that ignores cancellation retains its slot until it actually settles.
    const work = Promise.resolve().then(() => {
      if (abort.signal.aborted) throw new ProtocolError('cancelled', 'request stopped before dispatch')
      return registered.handler(request.p, { signal: abort.signal, connection: this })
    })
      .finally(() => { clearTimeout(timer); this.active.delete(request.id) })
    Promise.race([work, interrupted])
      .then(result => {
        if (this.state !== 'ready') return
        this.emit('request-result', { ...metadata, status: 'ok' })
        if (this.state === 'ready') return this.sendFrame(KINDS.RES, { id: request.id, r: result })
      })
      .catch(error => { if (this.state !== 'closed') return replyError(error) })
  }

  allocateStream() {
    const id = this.nextStream
    if (id > 0xffffffff) throw new ProtocolError('busy', 'stream ids exhausted')
    this.nextStream += 2
    this.registerStream(id)
    return id
  }

  registerStream(id, remote = false) {
    const parity = this.initiator ? 1 : 0
    const previous = remote ? this.lastRemoteStream : this.lastLocalStream
    if (!Number.isInteger(id) || id < 1 || id > 0xffffffff || id % 2 !== (remote ? 1 - parity : parity) || id <= previous || this.streams.has(id)) {
      throw new ProtocolError('invalid-argument', 'invalid stream allocation')
    }
    if (this.streams.size - 1 >= MAX_STREAMS) throw new ProtocolError('busy', 'too many logical streams')
    this.streams.set(id, { tx: 0, rx: 0 })
    if (remote) this.lastRemoteStream = id
    else this.lastLocalStream = id
  }

  releaseStream(id) { if (id !== 0) this.streams.delete(id) }

  close(error = new ProtocolError('cancelled', 'connection stopped')) {
    if (this.state === 'closed') return
    this.state = 'closed'
    clearTimeout(this.handshakeTimer)
    clearInterval(this.heartbeatTimer)
    this.transport.removeListener('message', this.onMessage)
    this.transport.removeListener('closed', this.onTransportClose)
    this.transport.close()
    this.noise.destroy()
    for (const pending of [...this.pending.values()]) pending.finish(error)
    for (const abort of this.active.values()) abort.abort()
    this.streams.clear()
    this.heartbeats.clear()
    this.rejectReady(error)
    this.resolveClosed(error)
    this.emit('closed', error)
  }
}
