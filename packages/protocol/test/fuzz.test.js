import test from 'node:test'
import assert from 'node:assert/strict'
import { ProtocolError, KINDS, encodeHeader, decodeHeader, encodePayload, decodePayload, MAX_WIRE_BYTES } from '../src/index.js'
import { RecordDecoder } from '../../core/src/transport.js'

const rounds = Number(process.env.DSH_FUZZ_ROUNDS ?? 10000)
if (!Number.isSafeInteger(rounds) || rounds < 1000 || rounds > 1000000) throw new Error('DSH_FUZZ_ROUNDS must be 1000..1000000')

// Fixed seeds make a CI failure exactly reproducible, without external fuzz tools.
function random(seed) {
  return maximum => {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5
    return (seed >>> 0) % maximum
  }
}
function acceptsOrRejects(operation) {
  try { return operation() }
  catch (error) { assert.ok(error instanceof ProtocolError, `unexpected parser failure: ${error}`) }
}

test(`seed 0x4452: ${rounds} arbitrary DR headers and UTF-8 JSON payloads fail cleanly`, () => {
  const next = random(0x4452)
  for (let i = 0; i < rounds; i++) {
    const bytes = Buffer.from(Array.from({ length: next(128) }, () => next(256)))
    const header = acceptsOrRejects(() => decodeHeader(bytes))
    if (header) assert.deepEqual(decodeHeader(encodeHeader(header)), header)
    const kind = 1 + next(6)
    const value = acceptsOrRejects(() => decodePayload(kind, bytes))
    if (value !== undefined) assert.deepEqual(decodePayload(kind, encodePayload(kind, value)), value)
  }
})

test(`seed 0x4d34: ${rounds / 5} TCP streams preserve records under split/coalesced chunks`, () => {
  const next = random(0x4d34)
  for (let i = 0; i < Math.floor(rounds / 5); i++) {
    const records = Array.from({ length: 1 + next(5) }, () => Buffer.from(Array.from({ length: 1 + next(300) }, () => next(256))))
    const wire = Buffer.concat(records.flatMap(record => {
      const header = Buffer.alloc(4); header.writeUInt32BE(record.length)
      return [header, record]
    }))
    const received = []
    const decoder = new RecordDecoder(record => received.push(record))
    for (let position = 0; position < wire.length;) {
      const end = Math.min(wire.length, position + 1 + next(97))
      decoder.push(wire.subarray(position, end)); position = end
    }
    assert.deepEqual(received, records)
  }
})

test(`seed 0x7631: ${rounds} mutations of valid DR headers exercise version, kind, stream and sequence`, () => {
  const next = random(0x7631)
  for (let index = 0; index < rounds; index++) {
    const bytes = encodeHeader({ kind: 1 + next(6), streamId: next(0xffffffff), seq: next(0xffffffff) })
    bytes[next(16)] ^= 1 + next(255)
    const value = acceptsOrRejects(() => decodeHeader(bytes))
    if (value) assert.deepEqual(encodeHeader(value), bytes)
  }
})

test('TCP length mutations are rejected before allocation or callback', () => {
  for (const length of [0, MAX_WIRE_BYTES + 1, 0x7fffffff, 0xffffffff]) {
    const prefix = Buffer.alloc(4); prefix.writeUInt32BE(length)
    let calls = 0
    const decoder = new RecordDecoder(() => calls++)
    for (let i = 0; i < 3; i++) decoder.push(prefix.subarray(i, i + 1))
    assert.throws(() => decoder.push(prefix.subarray(3)), ProtocolError)
    assert.equal(calls, 0)
    assert.equal(decoder.record, null)
  }
})

test('mutated required fields cannot become a valid RPC request', () => {
  const request = { id: 'AAAAAAAAAAA', m: 'session.list', p: {} }
  for (const id of [null, 0, [], {}, '', 'A'.repeat(12)]) {
    const bytes = Buffer.from(JSON.stringify({ ...request, id }))
    assert.throws(() => decodePayload(KINDS.REQ, bytes), ProtocolError)
  }
  for (const key of ['id', 'm', 'p']) {
    const mutated = { ...request }; delete mutated[key]
    assert.throws(() => decodePayload(KINDS.REQ, Buffer.from(JSON.stringify(mutated))), ProtocolError)
  }
})
