import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RemoteRuntime } from '../src/runtime.js'
import { DeviceStore } from '../src/store.js'
import { RemoteClient } from '../src/client.js'
import { MAX_PLAINTEXT_BYTES, ProtocolError } from '@dsh-remote/protocol'

async function fixture(t, caps = ['session', 'stream']) {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-listing-'))
  const items = Array.from({ length: 120 }, (_, i) => ({ sessionId: `s-${i}`, title: '中文标题'.repeat(180) }))
  const calls = []
  let result = { items }
  const sessionController = Object.fromEntries(['list', 'search', 'create', 'fork', 'rename', 'prompt', 'cancel', 'updateQueue', 'attachment', 'projections', 'follow', 'page', 'control'].map(method => [method, async (params, signal) => {
    calls.push({ method, params, signal })
    if (result instanceof Error) throw result
    return result
  }]))
  const runtime = await new RemoteRuntime({ sessionController, on: () => () => {}, get: () => null }, { directory: join(directory, 'host') }).start()
  const store = new DeviceStore(join(directory, 'client'))
  runtime.store.grant(store.keyPair.publicKey, 'listing test', caps)
  const peer = store.grant(runtime.store.keyPair.publicKey, 'host', caps, runtime.endpoint)
  const client = await new RemoteClient(store, peer).connect()
  t.after(async () => {
    await client.close()
    await runtime.close()
    store.close()
    rmSync(directory, { recursive: true, force: true })
  })
  return { runtime, client, items, calls, result: value => { result = value } }
}

for (const method of ['session.list', 'session.search']) {
  test(`${method}: large UTF-8 listings use bounded chunks and preserve the complete result`, async t => {
    const { client, items, calls } = await fixture(t)
    const params = method === 'session.search' ? { query: '中文' } : {}
    assert.ok(Buffer.byteLength(JSON.stringify({ items })) > MAX_PLAINTEXT_BYTES)
    await assert.rejects(client.request(method, params), { code: 'invalid-argument', message: 'payload requires chunking' })
    const values = []
    for await (const value of await client.open(method, params)) values.push(value)
    assert.deepEqual(values, [{ items }])
    assert.deepEqual(calls.at(-1).params, params)
    assert.equal(calls.at(-1).signal.aborted, false)
    assert.equal(client.connection.state, 'ready')
    assert.equal(client.streams.size, 0)
    assert.equal(client.connection.streams.size, 1)
  })
}

test('legacy RPC, empty streamed result and downstream failure leave the connection usable', async t => {
  const f = await fixture(t)
  f.result({ items: [] })
  assert.deepEqual(await f.client.request('session.list'), { items: [] })
  for await (const value of await f.client.open('session.list', {})) assert.deepEqual(value, { items: [] })
  f.result(new ProtocolError('unsupported', 'search unavailable'))
  await assert.rejects(async () => {
    for await (const value of await f.client.open('session.search', { query: 'x' })) {}
  }, { code: 'unsupported' })
  f.result({ items: [] })
  assert.deepEqual(await f.client.request('session.list'), { items: [] })
})

test('streamed listings enforce stream permission and the existing 4 MiB value budget', async t => {
  const restricted = await fixture(t, ['session'])
  await assert.rejects(restricted.client.open('session.list', {}), { code: 'unauthorized' })
  const f = await fixture(t)
  f.result({ items: [{ title: 'x'.repeat(4 * 1024 * 1024) }] })
  await assert.rejects(async () => {
    for await (const value of await f.client.open('session.list', {})) {}
  }, { code: 'busy' })
  f.result({ items: [] })
  assert.deepEqual(await f.client.request('session.list'), { items: [] })
})

test('cancelling a streamed listing aborts the host read and releases its stream', async t => {
  const f = await fixture(t)
  let started
  const reading = new Promise(resolve => { started = resolve })
  f.runtime.ctx.sessionController.list = (params, signal) => new Promise((resolve, reject) => {
    started(signal)
    signal.addEventListener('abort', () => reject(new ProtocolError('cancelled', 'read cancelled')), { once: true })
  })
  const abort = new AbortController()
  const stream = await f.client.open('session.list', {}, { signal: abort.signal })
  const signal = await reading
  abort.abort()
  for await (const value of stream) {}
  const streams = f.runtime.connections.values().next().value.streams
  await streams.settled()
  assert.equal(signal.aborted, true)
  assert.equal(streams.running.size, 0)
  assert.equal(f.client.connection.streams.size, 1)
})
