import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { KINDS, encodeHeader, decodeHeader, encodePayload, decodePayload, assertValue, assertMethod } from '../src/index.js'

test('DR header uses network byte order and preserves the v1 safe integer ceiling', () => {
  const header = encodeHeader({ kind: KINDS.EVT, streamId: 0x12345678, seq: Number.MAX_SAFE_INTEGER })
  assert.equal(header.toString('hex'), '4452010412345678001fffffffffffff')
  assert.deepEqual(decodeHeader(header), { kind: 4, streamId: 0x12345678, seq: Number.MAX_SAFE_INTEGER })
  for (const value of [Buffer.alloc(15), Buffer.alloc(16)]) assert.throws(() => decodeHeader(value))
  const unsafe = Buffer.from(header)
  unsafe.writeBigUInt64BE(9007199254740992n, 8)
  assert.throws(() => decodeHeader(unsafe))
  assert.throws(() => encodeHeader({ kind: 255, streamId: 0, seq: 0 }))
})

test('schema rejects malformed control payloads, invalid UTF-8 and oversized values', () => {
  const request = { id: 'AAAAAAAAAAA', m: 'diagnostic.echo', p: { text: '你好' } }
  assert.deepEqual(decodePayload(KINDS.REQ, encodePayload(KINDS.REQ, request)), request)
  assert.throws(() => encodePayload(KINDS.REQ, { ...request, extra: true }))
  assert.throws(() => encodePayload(KINDS.REQ, { ...request, id: 'short' }))
  assert.throws(() => encodePayload(KINDS.REQ, { ...request, p: { text: 'x'.repeat(65535) } }))
  assert.throws(() => decodePayload(KINDS.REQ, Buffer.from([0xff])))
  assert.throws(() => assertValue('SessionEvent', { type: 'x', seq: 0, time: 1, data: {}, ignorable: false }))
})

test('frozen frame vector headers and plaintext match protocol encoding', () => {
  const vectors = JSON.parse(readFileSync(new URL('../vectors/dr-v1.json', import.meta.url)))
  for (const frame of vectors.frames) assert.equal(encodeHeader(frame).toString('hex'), frame.header)
})

test('listing stream ids are optional, bounded and do not relax other method parameters', () => {
  for (const params of [{}, { streamId: 1 }, { streamId: 0xffffffff }]) assertMethod('session.list', params)
  for (const streamId of [0, -1, 1.5, 0x100000000, '1']) {
    assert.throws(() => assertMethod('session.list', { streamId }))
    assert.throws(() => assertMethod('session.search', { streamId, query: 'x' }))
  }
  assertMethod('session.search', { streamId: 1, query: '中文' })
  assertMethod('session.search', { query: '中文' })
  assert.throws(() => assertMethod('session.search', { streamId: 1 }))
  assert.throws(() => assertMethod('session.list', { query: 'x' }))
  assert.throws(() => assertMethod('workspace.list', { streamId: 1 }))
})
