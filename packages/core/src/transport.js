import { EventEmitter } from 'node:events'
import net from 'node:net'
import WebSocket from 'ws'
import { MAX_WIRE_BYTES, ProtocolError } from '@dsh-remote/protocol'

/** Decode length-prefixed TCP records without buffering an unbounded advertised size. */
export class RecordDecoder {
  constructor(onRecord) {
    this.onRecord = onRecord
    this.header = Buffer.alloc(4)
    this.offset = 0
    this.record = null
  }

  push(chunk) {
    let position = 0
    while (position < chunk.length) {
      const target = this.record ?? this.header
      const count = Math.min(target.length - this.offset, chunk.length - position)
      target.set(chunk.subarray(position, position + count), this.offset)
      position += count
      this.offset += count
      if (this.offset !== target.length) continue
      this.offset = 0
      if (!this.record) {
        const length = this.header.readUInt32BE()
        if (length < 1 || length > MAX_WIRE_BYTES) throw new ProtocolError('invalid-argument', 'invalid TCP record length')
        this.record = Buffer.alloc(length)
      } else {
        const record = this.record
        this.record = null
        this.onRecord(record)
      }
    }
  }
}

class Transport extends EventEmitter {
  constructor(socket) {
    super()
    this.socket = socket
    this.closed = false
    socket.on('error', () => this.fail(new ProtocolError('transport/lost', 'transport failed')))
    socket.once('close', () => {
      if (!this.closed) this.fail(new ProtocolError('transport/lost', 'transport closed'))
    })
  }

  fail(error) {
    if (this.closed) return
    this.closed = true
    this.emit('closed', error)
    this.destroySocket()
  }

  close() { this.fail(new ProtocolError('cancelled', 'transport stopped')) }
}

export class TcpTransport extends Transport {
  constructor(socket) {
    super(socket)
    const decoder = new RecordDecoder(record => {
      if (!this.closed) this.emit('message', record)
    })
    socket.setNoDelay(true)
    socket.on('data', chunk => {
      try { decoder.push(chunk) }
      catch (error) { this.fail(error) }
    })
    socket.once('end', () => this.fail(new ProtocolError('transport/lost', 'TCP peer ended')))
  }

  destroySocket() { this.socket.destroy() }

  send(bytes) {
    if (this.closed) return Promise.reject(new ProtocolError('transport/lost', 'transport closed'))
    if (bytes.length < 1 || bytes.length > MAX_WIRE_BYTES) return Promise.reject(new ProtocolError('invalid-argument', 'invalid TCP record length'))
    const prefix = Buffer.alloc(4)
    prefix.writeUInt32BE(bytes.length)
    return new Promise((resolve, reject) => {
      this.socket.write(Buffer.concat([prefix, bytes]), error => error ? reject(error) : resolve())
    })
  }
}

export class WebSocketTransport extends Transport {
  constructor(socket) {
    super(socket)
    socket.on('message', (bytes, binary) => {
      if (!binary || bytes.length < 1 || bytes.length > MAX_WIRE_BYTES) {
        this.fail(new ProtocolError('invalid-argument', 'expected bounded binary WebSocket message'))
      } else if (!this.closed) this.emit('message', bytes)
    })
  }

  destroySocket() { this.socket.terminate() }

  send(bytes) {
    if (this.closed) return Promise.reject(new ProtocolError('transport/lost', 'transport closed'))
    if (bytes.length < 1 || bytes.length > MAX_WIRE_BYTES) return Promise.reject(new ProtocolError('invalid-argument', 'invalid WebSocket record length'))
    return new Promise((resolve, reject) => this.socket.send(bytes, { binary: true }, error => error ? reject(error) : resolve()))
  }
}

/** Connect once; timeout and abort destroy the owned socket, including failed upgrades. */
export function connectTransport(endpoint, { signal, timeoutMs = 10000 } = {}) {
  const url = new URL(endpoint)
  if (!['tcp:', 'ws:', 'wss:'].includes(url.protocol) || url.username || url.password || url.hash) {
    return Promise.reject(new ProtocolError('invalid-argument', 'unsupported endpoint'))
  }
  if (url.protocol === 'ws:' && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    return Promise.reject(new ProtocolError('invalid-argument', 'unencrypted WS is limited to loopback; use TCP+Noise or WSS'))
  }
  return new Promise((resolve, reject) => {
    let socket
    let done = false
    const finish = (error, transport) => {
      if (done) return
      done = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      socket?.removeListener('error', onError)
      if (error) {
        socket?.on('error', () => {}) // Destruction of a connecting socket may emit its own expected error.
        if (url.protocol === 'tcp:') socket?.destroy()
        else socket?.terminate()
        reject(error)
      } else resolve(transport)
    }
    const onError = () => finish(new ProtocolError('transport/lost', 'connection failed'))
    const onAbort = () => finish(new ProtocolError('cancelled', 'connection cancelled'))
    const timer = setTimeout(() => finish(new ProtocolError('transport/lost', 'connection timed out')), timeoutMs)
    if (signal?.aborted) { finish(new ProtocolError('cancelled', 'connection cancelled')); return }
    if (url.protocol === 'tcp:') {
      socket = net.connect({ host: url.hostname, port: Number(url.port) })
      socket.once('connect', () => finish(null, new TcpTransport(socket)))
    } else {
      socket = new WebSocket(url, { maxPayload: MAX_WIRE_BYTES, perMessageDeflate: false, handshakeTimeout: timeoutMs })
      socket.once('open', () => finish(null, new WebSocketTransport(socket)))
      socket.on('unexpected-response', (_request, response) => {
        const code = response.statusCode === 429 ? 'tunnel/busy' : response.statusCode === 530 ? 'tunnel/expired' : 'transport/lost'
        response.destroy()
        finish(new ProtocolError(code, 'WebSocket upgrade refused'))
      })
    }
    socket.once('error', onError)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
