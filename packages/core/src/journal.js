import { EventEmitter } from 'node:events'
import { assertValue, KINDS, MAX_PAGE_RECORDS, MAX_QUEUE_MESSAGES, MAX_QUEUE_BYTES, ProtocolError } from '@dsh-remote/protocol'

function pageSize(value = 64) {
  if (!Number.isInteger(value) || value < 1 || value > MAX_PAGE_RECORDS) throw new ProtocolError('invalid-argument', 'invalid page size')
  return value
}

/** Bounded diagnostic replay source. M2 supplies durable DSH history through the same methods. */
export class EventJournal extends EventEmitter {
  constructor({ maxRecords = 4096, maxBytes = 4 * 1024 * 1024 } = {}) {
    super()
    if (!Number.isInteger(maxRecords) || maxRecords < 1 || maxRecords > 65536 || !Number.isInteger(maxBytes) || maxBytes < 8192 || maxBytes > 64 * 1024 * 1024) throw new Error('invalid journal retention bounds')
    this.maxRecords = maxRecords
    this.maxBytes = maxBytes
    this.bytes = 0
    this.records = []
    this.nextSeq = 0
  }

  append(type, data, { ignorable } = {}) {
    const record = JSON.parse(JSON.stringify({ type, seq: this.nextSeq, time: Date.now(), data, ...(ignorable ? { ignorable: true } : {}) }))
    assertValue('SessionEvent', record)
    const size = Buffer.byteLength(JSON.stringify(record))
    if (size > 8192) throw new ProtocolError('invalid-argument', 'diagnostic event exceeds 8192 bytes')
    this.nextSeq++
    this.records.push({ record, size })
    this.bytes += size
    while (this.records.length > this.maxRecords || this.bytes > this.maxBytes) this.bytes -= this.records.shift().size
    this.emit('append', record)
    return record
  }

  page({ throughSeq, beforeSeq = throughSeq + 1, maxMessages = 64 }) {
    pageSize(maxMessages)
    if (!Number.isSafeInteger(throughSeq) || throughSeq < -1 || throughSeq >= this.nextSeq || !Number.isSafeInteger(beforeSeq) || beforeSeq < 0 || beforeSeq > throughSeq + 1) {
      throw new ProtocolError('invalid-argument', 'invalid history cursor')
    }
    const firstSeq = this.records[0]?.record.seq ?? this.nextSeq
    if (throughSeq >= 0 && throughSeq < firstSeq) throw new ProtocolError('history/unavailable', 'history cut is no longer retained')
    const selected = []
    let size = 0
    for (let index = this.records.length - 1; index >= 0; index--) {
      const item = this.records[index]
      if (item.record.seq > throughSeq || item.record.seq >= beforeSeq) continue
      if (selected.length >= maxMessages || size + item.size > 60000) break
      selected.unshift(item.record)
      size += item.size
    }
    return { records: selected, hasMore: (selected[0]?.seq ?? beforeSeq) > firstSeq, firstSeq }
  }

  snapshot(maxMessages) {
    const cursor = this.nextSeq - 1
    return { kind: 'snapshot', cursor, ...this.page({ throughSeq: cursor, maxMessages }) }
  }

  subscribe(listener) { this.on('append', listener); return () => this.removeListener('append', listener) }
}

/** Subscribe before taking the opening cut. One disposer owns every source subscription. */
export function serveJournal(connection, journal) {
  const subscriptions = new Map()
  const unregister = [
    connection.register('stream.open', 'stream', params => {
      pageSize(params.maxMessages)
      if (!Number.isSafeInteger(params.sinceSeq) || params.sinceSeq < -1) throw new ProtocolError('invalid-argument', 'invalid resume cursor')
      connection.registerStream(params.streamId, true)
      const send = record => { void connection.sendFrame(KINDS.EVT, { kind: 'append', records: [record] }, params.streamId).catch(error => connection.close(error)) }
      const dispose = journal.subscribe(send)
      subscriptions.set(params.streamId, dispose)
      try {
        const snapshot = journal.snapshot(params.maxMessages)
        if (params.sinceSeq >= snapshot.firstSeq - 1 && params.sinceSeq <= snapshot.cursor) {
          void connection.sendFrame(KINDS.EVT, snapshot, params.streamId).catch(error => connection.close(error))
          return { streamId: params.streamId }
        }
        throw new ProtocolError('history/unavailable', 'resume cursor is outside available history')
      } catch (error) {
        dispose()
        subscriptions.delete(params.streamId)
        connection.releaseStream(params.streamId)
        throw error
      }
    }),
    connection.register('history.page', 'stream', params => journal.page(params)),
    connection.register('stream.close', 'stream', async params => {
      const dispose = subscriptions.get(params.streamId)
      if (!dispose) throw new ProtocolError('not-found', 'stream not found')
      dispose()
      subscriptions.delete(params.streamId)
      await connection.sendFrame(KINDS.SEND, {}, params.streamId)
      connection.releaseStream(params.streamId)
      return { ok: true }
    }),
  ]
  const dispose = () => {
    for (const unsubscribe of subscriptions.values()) unsubscribe()
    subscriptions.clear()
    for (const remove of unregister) remove()
    connection.removeListener('closed', dispose)
  }
  connection.once('closed', dispose)
  return dispose
}

/** Replay missing durable events across physical connections; unknown required types stop reconstruction. */
export class JournalFollower extends EventEmitter {
  constructor(client, { knownTypes, cursor = -1, maxMessages = 64, maxReplayRecords = 4096, maxReplayPages = 128 } = {}) {
    super()
    if (!knownTypes || !Number.isSafeInteger(cursor) || cursor < -1 || !Number.isInteger(maxReplayRecords) || maxReplayRecords < 1 || maxReplayRecords > 65536 || !Number.isInteger(maxReplayPages) || maxReplayPages < 1 || maxReplayPages > 1024) throw new Error('invalid follower bounds or event vocabulary')
    this.client = client
    this.knownTypes = new Set(knownTypes)
    this.cursor = cursor
    this.maxMessages = pageSize(maxMessages)
    this.maxReplayRecords = maxReplayRecords
    this.maxReplayPages = maxReplayPages
    this.generation = 0
    this.onConnection = connection => this.attach(connection)
    client.on('connection', this.onConnection)
    if (client.connection?.state === 'ready') this.attach(client.connection)
  }

  attach(connection) {
    this.detach?.()
    const generation = ++this.generation
    const streamId = connection.allocateStream()
    this.connection = connection
    this.streamId = streamId
    let tail = Promise.resolve()
    let queued = 0
    let queuedBytes = 0
    let opened = false
    const failed = error => {
      if (generation !== this.generation || connection.state === 'closed') return
      this.client.stop()
      this.emit('failure', error)
    }
    const listener = frame => {
      if (frame.streamId !== streamId) return
      const size = Buffer.byteLength(JSON.stringify(frame.value))
      if (queued >= MAX_QUEUE_MESSAGES || queuedBytes + size > MAX_QUEUE_BYTES) { failed(new ProtocolError('busy', 'replay queue is full')); return }
      queued++
      queuedBytes += size
      tail = tail.then(async () => {
        if (generation !== this.generation || connection.state === 'closed') return
        if (frame.kind === KINDS.SEND) throw new ProtocolError(frame.value.error ?? 'cancelled', 'event stream ended')
        if (frame.kind !== KINDS.EVT) throw new ProtocolError('invalid-argument', 'unexpected journal frame')
        if (!opened) {
          if (frame.value.kind !== 'snapshot') throw new ProtocolError('invalid-argument', 'event stream requires opening snapshot')
          await this.repair(connection, frame.value, generation)
          opened = true
          if (generation === this.generation && connection.state !== 'closed') this.emit('synced', this.cursor)
        } else {
          if (frame.value.kind !== 'append') throw new ProtocolError('invalid-argument', 'unexpected journal update')
          this.apply(frame.value.records)
        }
      }).catch(failed).finally(() => { queued--; queuedBytes -= size })
    }
    connection.on('stream', listener)
    this.detach = () => connection.removeListener('stream', listener)
    void connection.request('stream.open', { streamId, sinceSeq: this.cursor, maxMessages: this.maxMessages }).catch(failed)
  }

  async repair(connection, snapshot, generation) {
    assertValue('JournalSnapshot', snapshot)
    if (snapshot.cursor < this.cursor || snapshot.firstSeq > this.cursor + 1) throw new ProtocolError('history/unavailable', 'history no longer covers resume cursor')
    let records = snapshot.records
    this.checkOrder(records)
    let pages = 0
    let bytes = Buffer.byteLength(JSON.stringify(records))
    const signal = AbortSignal.timeout(30000)
    while (snapshot.cursor > this.cursor && (records[0]?.seq ?? snapshot.cursor + 1) > this.cursor + 1) {
      if (++pages > this.maxReplayPages) throw new ProtocolError('busy', 'history repair page limit reached')
      const beforeSeq = records[0]?.seq ?? snapshot.cursor + 1
      const page = await connection.request('history.page', { throughSeq: snapshot.cursor, beforeSeq, maxMessages: this.maxMessages }, { signal })
      if (generation !== this.generation || connection.state === 'closed') return
      if (!Array.isArray(page.records) || page.records.length === 0 || page.records.length > MAX_PAGE_RECORDS) throw new ProtocolError('history/unavailable', 'history repair made no progress')
      this.checkOrder(page.records)
      if (page.records.at(-1).seq !== beforeSeq - 1) throw new ProtocolError('history/unavailable', 'history page is not contiguous')
      records = [...page.records, ...records]
      bytes += Buffer.byteLength(JSON.stringify(page.records))
      if (records.length > this.maxReplayRecords || bytes > 4 * 1024 * 1024) throw new ProtocolError('busy', 'history repair memory limit reached')
    }
    if (generation !== this.generation || connection.state === 'closed') return
    if (records.length > this.maxReplayRecords || bytes > 4 * 1024 * 1024 || (records.at(-1)?.seq ?? -1) !== snapshot.cursor) throw new ProtocolError('history/unavailable', 'opening page did not reach its cursor')
    this.apply(records)
  }

  checkOrder(records) {
    let previous
    for (const record of records) {
      assertValue('SessionEvent', record)
      if (previous !== undefined && record.seq !== previous + 1) throw new ProtocolError('history/unavailable', 'event page has a gap')
      if (!this.knownTypes.has(record.type) && record.ignorable !== true) throw new ProtocolError('unsupported', 'unknown required session event')
      previous = record.seq
    }
  }

  apply(records) {
    this.checkOrder(records)
    for (const record of records) {
      if (record.seq <= this.cursor) continue
      if (record.seq !== this.cursor + 1) throw new ProtocolError('history/unavailable', 'durable event sequence has a gap')
      if (this.knownTypes.has(record.type)) this.emit('event', record)
      this.cursor = record.seq
    }
  }

  stop() {
    this.generation++
    this.detach?.()
    this.client.removeListener('connection', this.onConnection)
    if (this.connection?.state === 'ready') {
      // The owner may stop its transport immediately after stopping this follower.
      void this.connection.request('stream.close', { streamId: this.streamId }).catch(() => {})
    }
    this.connection = null
  }
}
