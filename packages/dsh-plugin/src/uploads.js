import { randomBytes } from 'node:crypto'
import { ProtocolError } from '@dsh-remote/protocol'

/** Four uploads per connection, one acknowledged chunk in flight per upload. */
export class UploadReceiver {
  constructor(connection, ctx) { this.connection = connection; this.ctx = ctx; this.pending = new Map(); connection.once('closed', () => this.close()) }
  begin(params) {
    const service = this.ctx.get('fileUploads')
    if (!service) throw new ProtocolError('unsupported', 'attachment upload unavailable')
    if (this.pending.size >= 4) throw new ProtocolError('busy', 'too many attachment uploads')
    const id = randomBytes(16).toString('base64url')
    const abort = new AbortController()
    const item = { id, abort, offset: 0, declaredBytes: params.bytes, done: false }
    const fail = error => {
      if (item.error) return
      item.error = error; item.done = true; item.ack?.reject(error); item.wake?.(); abort.abort()
      clearTimeout(item.timer)
    }
    item.fail = fail
    item.timer = setTimeout(() => fail(new ProtocolError('timeout', 'attachment upload expired')), 120000)
    const data = (async function* () {
      while (!item.done || item.chunk) {
        if (item.error) throw item.error
        if (item.chunk) {
          const chunk = item.chunk
          const ack = item.ack
          item.chunk = null
          yield chunk
          ack.resolve()
          if (item.ack === ack) item.ack = null
        } else await new Promise(resolve => { item.wake = resolve })
      }
      if (item.error) throw item.error
    })()
    item.task = Promise.resolve().then(() => service.uploadStream({ sessionId: params.sessionId, name: params.name, data, signal: abort.signal })).catch(error => { fail(error); throw error }).finally(() => {
      // Failed uploads keep their slot until the backend has released its resources.
      if (item.error) this.pending.delete(id)
    })
    item.task.catch(() => {})
    this.pending.set(id, item)
    return { uploadId: id }
  }
  async chunk(params) {
    const item = this.pending.get(params.uploadId)
    if (!item || item.done) throw new ProtocolError('not-found', 'upload is not active')
    if (item.ack || params.offset !== item.offset) throw new ProtocolError('invalid-argument', 'upload offset or ordering mismatch')
    const bytes = Buffer.from(params.data, 'base64')
    if (!bytes.length || bytes.length > 32768 || bytes.toString('base64') !== params.data || item.offset + bytes.length > item.declaredBytes) throw new ProtocolError('invalid-argument', 'invalid upload chunk')
    item.offset += bytes.length
    item.chunk = bytes
    const acknowledged = new Promise((resolve, reject) => { item.ack = { resolve, reject } })
    item.wake?.()
    await acknowledged
    return { bytes: item.offset }
  }
  async finish(params) {
    const item = this.pending.get(params.uploadId)
    if (!item) throw new ProtocolError('not-found', 'upload is not active')
    if (item.ack || item.offset !== item.declaredBytes) throw new ProtocolError('invalid-argument', 'attachment upload incomplete')
    item.done = true
    item.wake?.()
    try { return await item.task }
    finally { clearTimeout(item.timer); this.pending.delete(item.id) }
  }
  close() {
    for (const item of this.pending.values()) { clearTimeout(item.timer); item.fail(new ProtocolError('cancelled', 'attachment upload stopped')) }
  }
  async settled() { await Promise.allSettled([...this.pending.values()].map(item => item.task)) }
}
