import { EventEmitter } from 'node:events'
import { ProtocolError } from '@dsh-remote/protocol'
import { SecureConnection } from './connection.js'
import { connectTransport } from './transport.js'

/** One active attempt and one backoff timer; endpoint refresh preserves the identity pin. */
export class ReconnectingClient extends EventEmitter {
  constructor({ endpoint, retryBaseMs = 500, retryMaxMs = 30000, ...connectionOptions }) {
    super()
    if (!Number.isSafeInteger(retryBaseMs) || retryBaseMs < 1 || !Number.isSafeInteger(retryMaxMs) || retryMaxMs < retryBaseMs) {
      throw new Error('invalid retry bounds')
    }
    this.endpoint = endpoint
    this.retryBaseMs = retryBaseMs
    this.retryMaxMs = retryMaxMs
    this.connectionOptions = connectionOptions
    this.running = false
    this.attempt = 0
    this.generation = 0
    this.connection = null
  }

  start() {
    if (this.running) return
    this.running = true
    this.attempt = 0
    this.generation++
    void this.connect(this.generation)
  }

  async connect(generation) {
    const abort = new AbortController()
    this.abort = abort
    this.emit('state', 'connecting')
    let connection
    try {
      const carrier = await connectTransport(this.endpoint, { signal: abort.signal, timeoutMs: this.connectionOptions.handshakeTimeoutMs })
      if (!this.running || generation !== this.generation) { carrier.close(); return }
      connection = new SecureConnection(carrier, { ...this.connectionOptions, initiator: true })
      this.connection = connection
      await connection.ready
      if (!this.running || generation !== this.generation) { connection.close(); return }
      this.emit('state', 'connected')
      this.emit('connection', connection)
      const error = await connection.closed
      if (!this.running || generation !== this.generation) return
      this.connection = null
      this.retry(error, generation)
    } catch (error) {
      connection?.close()
      if (!this.running || generation !== this.generation) return
      this.connection = null
      this.retry(error, generation)
    }
  }

  retry(error, generation) {
    if (!['transport/lost', 'tunnel/busy'].includes(error.code)) {
      this.running = false
      this.emit('state', error.code === 'tunnel/expired' ? 'address-expired' : 'failed')
      this.emit('failure', error)
      return
    }
    // Backoff remains bounded even when a peer repeatedly opens and immediately drops.
    const ceiling = Math.min(this.retryMaxMs, this.retryBaseMs * 2 ** Math.min(this.attempt++, 16))
    const delay = Math.round(ceiling * (0.5 + Math.random() * 0.5))
    this.emit('state', 'reconnecting')
    this.timer = setTimeout(() => { void this.connect(generation) }, delay)
  }

  updateEndpoint(endpoint) {
    new URL(endpoint)
    this.stop()
    this.endpoint = endpoint
    this.start()
  }

  stop() {
    this.running = false
    this.generation++
    clearTimeout(this.timer)
    this.abort?.abort()
    this.connection?.close(new ProtocolError('cancelled', 'client stopped'))
    this.connection = null
    this.emit('state', 'stopped')
  }
}
