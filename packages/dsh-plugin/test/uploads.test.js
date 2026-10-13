import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { UploadReceiver } from '../src/uploads.js'

test('attachment upload enforces ordering and byte count and releases failed backend slots', async () => {
  const received = []
  const service = { async uploadStream({ data }) {
    for await (const chunk of data) received.push(chunk)
    return { receiptId: 'test-receipt', file: { bytes: Buffer.concat(received).length } }
  } }
  const connection = new EventEmitter()
  const uploads = new UploadReceiver(connection, { get: () => service })
  const { uploadId } = uploads.begin({ sessionId: 'test', bytes: 3 })
  try {
    await assert.rejects(uploads.chunk({ uploadId, offset: 1, data: 'YWJj' }), { code: 'invalid-argument' })
    await assert.rejects(uploads.finish({ uploadId }), { code: 'invalid-argument' })
    await uploads.chunk({ uploadId, offset: 0, data: 'YWJj' })
    await assert.rejects(uploads.chunk({ uploadId, offset: 0, data: 'YWJj' }), { code: 'invalid-argument' })
    assert.equal((await uploads.finish({ uploadId })).file.bytes, 3)
    assert.equal(uploads.pending.size, 0)
    service.uploadStream = async () => { throw new Error('downstream failed') }
    for (let count = 0; count < 4; count++) uploads.begin({ sessionId: 'test', bytes: 3 })
    assert.throws(() => uploads.begin({ sessionId: 'test', bytes: 3 }), { code: 'busy' })
    await uploads.settled()
    assert.equal(uploads.pending.size, 0)
  } finally { uploads.close(); await uploads.settled() }
})

test('connection close aborts active uploads and releases backend resources', async () => {
  let aborted = false
  const connection = new EventEmitter()
  const uploads = new UploadReceiver(connection, { get: () => ({ async uploadStream({ data, signal }) {
    try { for await (const chunk of data) {} }
    finally { aborted = signal.aborted }
  } }) })
  uploads.begin({ sessionId: 'test', bytes: 1 })
  connection.emit('closed')
  await uploads.settled()
  assert.equal(aborted, true)
  assert.equal(uploads.pending.size, 0)
})
