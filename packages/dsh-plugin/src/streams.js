import { KINDS, ProtocolError } from '@dsh-remote/protocol'

const MAX_BYTES = 4 * 1024 * 1024
export async function sendValue(connection, streamId, name, value) {
  const bytes = Buffer.from(JSON.stringify(value))
  if (bytes.length > MAX_BYTES) throw new ProtocolError('busy', 'application value exceeds 4 MiB')
  for (let offset = 0; offset < bytes.length; offset += 32768) await connection.sendFrame(KINDS.SDATA, bytes.subarray(offset, offset + 32768), streamId)
  await connection.sendFrame(KINDS.EVT, { type: 'application', name, data: { bytes: bytes.length } }, streamId)
}

/** Streams own cancellation independently of the short opening RPC. */
export class HostStreams {
  constructor(connection, controller, subscribed) {
    this.connection = connection
    this.controller = controller
    this.subscribed = subscribed
    this.running = new Map()
    connection.once('closed', () => this.close())
  }
  open(params, method, source) {
    this.connection.registerStream(params.streamId, true)
    const abort = new AbortController()
    const task = this.run(params, method, abort.signal, source)
      .then(() => this.end(params.streamId), error => this.end(params.streamId, error.code ?? 'internal'))
      .finally(() => { this.running.delete(params.streamId); this.subscribed() })
    this.running.set(params.streamId, { abort, task, sessionId: params.address?.sessionId ?? params.address?.childSessionId })
    this.subscribed()
    return { streamId: params.streamId }
  }
  async run(params, method, signal, source) {
    const { streamId, sinceSeq, ...request } = params
    if (source) {
      for await (const value of source(signal)) await sendValue(this.connection, streamId, method === 'terminal.exec' ? 'terminal.output' : 'files.chunk', value)
      return
    }
    if (method === 'history.page') {
      await sendValue(this.connection, streamId, 'session.frame', await this.controller.page(request, signal))
      return
    }
    if (method === 'control.subscribe') {
      for await (const value of this.controller.control(signal)) await sendValue(this.connection, streamId, 'control.frame', value)
      return
    }
    if (sinceSeq !== undefined && (!Number.isSafeInteger(sinceSeq) || sinceSeq < -1)) throw new ProtocolError('invalid-argument', 'invalid resume cursor')
    let first = true
    for await (const frame of this.controller.follow(request, signal)) {
      if (first) {
        if (frame.type !== 'snapshot') throw new ProtocolError('internal', 'host stream has no opening snapshot')
        first = false
        const opening = await this.repair(frame, request, sinceSeq, signal)
        await sendValue(this.connection, streamId, 'session.frame', { ...opening, kind: 'snapshot' })
      } else if (frame.type === 'event') {
        await sendValue(this.connection, streamId, 'session.frame', { kind: 'append', records: [frame] })
      } else if (frame.type === 'assistant-stream') {
        await sendValue(this.connection, streamId, 'session.frame', { kind: 'assistant-stream', frame: frame.frame })
      } else throw new ProtocolError('unsupported', 'unknown required host frame')
    }
  }
  async repair(frame, request, cursor, signal) {
    if (cursor === undefined || cursor === -1) return frame
    if (cursor > frame.cursor) throw new ProtocolError('history/unavailable', 'resume cursor exceeds host history')
    const records = [...frame.records]
    let earliest = records[0]?.event.seq ?? frame.cursor + 1
    let bytes = Buffer.byteLength(JSON.stringify(records))
    let pages = 0
    const deadline = Date.now() + 30000
    let hasMore = frame.hasMore
    while (earliest > cursor + 1) {
      if (!hasMore) throw new ProtocolError('history/unavailable', 'resume history is unavailable')
      if (++pages > 128 || records.length > 4096 || bytes > MAX_BYTES || Date.now() > deadline) throw new ProtocolError('history/unavailable', 'resume repair budget exceeded')
      const page = await this.controller.page({ address: request.address, throughSeq: frame.cursor, beforeSeq: earliest, maxMessages: 64 }, signal)
      const next = page.records[0]?.event.seq
      if (next === undefined || next >= earliest || page.records.at(-1).event.seq !== earliest - 1) throw new ProtocolError('history/unavailable', 'history page does not progress')
      records.unshift(...page.records)
      bytes += Buffer.byteLength(JSON.stringify(page.records))
      earliest = next
      hasMore = page.hasMore
    }
    if (records.length > 4096 || bytes > MAX_BYTES) throw new ProtocolError('history/unavailable', 'resume repair budget exceeded')
    for (let index = 1; index < records.length; index++) if (records[index].event.seq !== records[index - 1].event.seq + 1) throw new ProtocolError('history/unavailable', 'history has a gap')
    return { ...frame, records, hasMore }
  }
  async end(id, error) {
    if (this.connection.state !== 'ready' || !this.connection.streams.has(id)) return
    try { await this.connection.sendFrame(KINDS.SEND, error ? { error } : {}, id) }
    catch (failure) { this.connection.close(failure) }
    this.connection.releaseStream(id)
  }
  stop(id) { this.running.get(id)?.abort.abort(); return { ok: true } }
  sessions() { return new Set([...this.running.values()].map(value => value.sessionId).filter(Boolean)) }
  close() { for (const { abort } of this.running.values()) abort.abort() }
  async settled() { await Promise.allSettled([...this.running.values()].map(value => value.task)) }
}
