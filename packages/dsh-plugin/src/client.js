import { EventEmitter } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import { SecureConnection, connectTransport, deviceId } from '@dsh-remote/core'
import { KINDS, ProtocolError, assertValue } from '@dsh-remote/protocol'

export async function pairDevice(store, qr, confirm, name = 'DSH Remote') {
  assertValue('PairingPayload', qr)
  if (qr?.v !== 1 || !/^[A-Za-z0-9_-]{22}$/.test(qr.sid) || !/^[A-Za-z0-9+/]{43}=$/.test(qr.pk) ||
      !Number.isSafeInteger(qr.exp) || qr.exp * 1000 <= Date.now() || qr.exp * 1000 > Date.now() + 300000) throw new ProtocolError('invalid-argument', 'invalid or expired pairing payload')
  const endpoint = new URL(qr.relay)
  if (!['ws:', 'wss:'].includes(endpoint.protocol) || endpoint.username || endpoint.password) throw new ProtocolError('invalid-argument', 'invalid pairing endpoint')
  endpoint.searchParams.set('sid', qr.sid)
  const peer = Buffer.from(qr.pk, 'base64')
  const connection = new SecureConnection(await connectTransport(endpoint.href), { initiator: true, keyPair: store.keyPair, peerPublicKey: peer, pairSid: qr.sid, caps: ['admin'], name, kind: 'dsh', requestTimeoutMs: 180000 })
  try {
    await connection.ready
    if (await confirm({ sas: connection.sas, name: qr.name, deviceId: deviceId(peer) }) !== true) throw new ProtocolError('cancelled', 'SAS not confirmed')
    const result = await connection.request('pair.confirm', { deviceId: deviceId(store.keyPair.publicKey), sas: connection.sas })
    if (result.ok !== true || result.deviceId !== deviceId(peer)) throw new ProtocolError('unauthorized', 'invalid pair receipt')
    return store.grant(peer, connection.peerHello.name, result.caps, qr.relay)
  } finally { connection.close() }
}

/** Controller owns each connection and bounded stream receive buffer. */
export class RemoteClient extends EventEmitter {
  constructor(store, peer) { super(); this.store = store; this.peer = peer; this.streams = new Map(); this.generation = 0 }
  async connect(endpoint = this.peer.endpoint, { signal } = {}) {
    if (this.establishing) return this.establishing
    this.establishing = this.establish(endpoint, { signal }).finally(() => { this.establishing = null })
    return this.establishing
  }
  async establish(endpoint, { signal } = {}) {
    const generation = this.generation
    if (this.connection) { this.connection.close(); await this.connection.closed; this.connection = null }
    if (generation !== this.generation) throw new ProtocolError('cancelled', 'client closed during connection')
    const abort = new AbortController()
    this.establishAbort = abort
    signal = AbortSignal.any([signal, abort.signal].filter(Boolean))
    try {
      const transport = await connectTransport(endpoint, { signal })
      if (signal.aborted || generation !== this.generation) { transport.close(); throw new ProtocolError('cancelled', 'client closed during connection') }
      const connection = new SecureConnection(transport, { initiator: true, keyPair: this.store.keyPair, peerPublicKey: Buffer.from(this.peer.publicKey, 'base64url'), caps: this.peer.remoteCaps, kind: 'dsh', requestTimeoutMs: 120000 })
      this.connection = connection
      const interrupted = () => connection.close(new ProtocolError('cancelled', 'connection cancelled'))
      signal?.addEventListener('abort', interrupted, { once: true })
      if (signal?.aborted) interrupted()
      connection.on('event', event => this.emit(event.name, event.data))
      connection.on('stream', frame => {
        try { this.receive(frame) } catch (error) { connection.close(error) }
      })
      connection.once('closed', error => {
        for (const stream of this.streams.values()) stream.fail(error)
        this.streams.clear()
        this.emit('disconnected', error.code)
      })
      try { await connection.ready } finally { signal?.removeEventListener('abort', interrupted) }
      return this
    } finally { if (this.establishAbort === abort) this.establishAbort = null }
  }
  request(method, params, options) { return this.connection.request(method, params, options) }
  async upload(sessionId, bytes, name, { signal } = {}) {
    const { uploadId } = await this.request('session.upload.begin', { sessionId, bytes: bytes.length, ...(name ? { name } : {}) }, { signal })
    for (let offset = 0; offset < bytes.length; offset += 32768) {
      await this.request('session.upload.chunk', { uploadId, offset, data: Buffer.from(bytes.subarray(offset, offset + 32768)).toString('base64') }, { signal })
    }
    return this.request('session.upload.finish', { uploadId }, { signal })
  }
  async *follow(params, { signal, endpoint = this.peer.endpoint } = {}) {
    let cursor = params.sinceSeq ?? -1
    let attempts = 0
    while (!signal?.aborted) {
      try {
        if (this.connection?.state !== 'ready') await this.connect(endpoint)
        const source = await this.open('stream.open', { ...params, sinceSeq: cursor }, { signal })
        for await (const frame of source) {
          attempts = 0
          if (frame.kind === 'snapshot') {
            const records = cursor < 0 ? frame.records : frame.records.filter(record => record.event.seq > cursor)
            if (cursor >= 0 && records.length && records[0].event.seq !== cursor + 1) throw new ProtocolError('history/unavailable', 'resume gap not repaired')
            cursor = frame.cursor
            yield { ...frame, records }
          } else if (frame.kind === 'append') {
            const records = frame.records.filter(record => record.event.seq > cursor)
            if (records.some((record, index) => record.event.seq !== cursor + index + 1)) throw new ProtocolError('history/unavailable', 'live event gap')
            if (records.length) { cursor = records.at(-1).event.seq; yield { ...frame, records } }
          } else yield frame
        }
        return
      } catch (error) {
        if (signal?.aborted) return
        if (!['transport/lost', 'tunnel/busy'].includes(error.code)) throw error
        if (++attempts > 8) throw new ProtocolError('transport/lost', 'automatic reconnect budget exhausted')
        this.emit('reconnecting', { cursor, attempt: attempts })
        try { await delay(Math.min(10000, 500 * 2 ** (attempts - 1)), undefined, { signal }) }
        catch (cancelled) { if (signal?.aborted) return; throw cancelled }
      }
    }
  }
  receive(frame) {
    const stream = this.streams.get(frame.streamId)
    if (!stream) throw new ProtocolError('invalid-argument', 'unknown application stream')
    if (frame.kind === KINDS.SDATA) {
      stream.bytes += frame.value.length
      if (stream.bytes > 4 * 1024 * 1024) throw new ProtocolError('busy', 'incoming application frame exceeds 4 MiB')
      stream.chunks.push(frame.value)
    } else if (frame.kind === KINDS.EVT && frame.value.type === 'application') {
      if (frame.value.data.bytes !== stream.bytes || !stream.bytes) throw new ProtocolError('invalid-argument', 'incomplete application frame')
      const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(stream.chunks)))
      stream.chunks = []
      stream.bytes = 0
      stream.push(value)
    } else if (frame.kind === KINDS.SEND) {
      if (stream.bytes) throw new ProtocolError('invalid-argument', 'truncated application frame')
      frame.value.error ? stream.fail(new ProtocolError(frame.value.error, 'remote stream failed')) : stream.end()
    } else throw new ProtocolError('invalid-argument', 'unexpected application stream frame')
  }
  async open(method, params, { signal } = {}) {
    const connection = this.connection
    const id = connection.allocateStream()
    const queue = []
    let bytes = 0
    let wake
    let done = false
    let error
    const stream = {
      chunks: [], bytes: 0,
      push(value) {
        const size = Buffer.byteLength(JSON.stringify(value))
        if (queue.length >= 128 || bytes + size > 4 * 1024 * 1024) throw new ProtocolError('busy', 'incoming stream queue full')
        queue.push({ value, size }); bytes += size; wake?.()
      },
      fail(reason) { error = reason; done = true; wake?.() },
      end() { done = true; wake?.() },
    }
    this.streams.set(id, stream)
    try { await connection.request(method, { ...params, streamId: id }, { signal }) }
    catch (failure) { this.streams.delete(id); connection.releaseStream(id); throw failure }
    const owner = this
    const abort = () => stream.end()
    signal?.addEventListener('abort', abort, { once: true })
    return (async function* () {
      try {
        while (!done || queue.length) {
          if (signal?.aborted) return
          if (error) throw error
          if (queue.length) { const item = queue.shift(); bytes -= item.size; yield item.value }
          else await new Promise(resolve => { wake = resolve })
        }
        if (error) throw error
      } finally {
        signal?.removeEventListener('abort', abort)
        if (connection.state === 'ready') await connection.request('stream.close', { streamId: id }).catch(() => {})
        if (owner.streams.get(id) === stream) owner.streams.delete(id)
        connection.releaseStream(id)
      }
    })()
  }
  async close() {
    this.generation++
    this.establishAbort?.abort()
    this.connection?.close()
    await this.establishing?.catch(() => {})
    if (this.connection) await this.connection.closed
    this.connection = null
  }
}
