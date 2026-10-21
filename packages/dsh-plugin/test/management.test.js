import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { RemoteRuntime } from '../src/runtime.js'
import { RemoteManagement, registerManagement } from '../src/management.js'

async function hosts(t) {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-management-'))
  const instances = []
  t.after(async () => {
    for (const { runtime, management } of instances) { await management.close(); await runtime.close() }
    rmSync(directory, { recursive: true, force: true })
  })
  for (const name of ['a', 'b']) {
    const sessionController = Object.fromEntries(['list', 'search', 'create', 'fork', 'rename', 'prompt', 'cancel', 'updateQueue', 'attachment', 'projections', 'follow', 'page', 'control'].map(method => [method, async () => ({ items: [] })]))
    const runtime = await new RemoteRuntime({ sessionController, on: () => () => {}, get: () => null }, { directory: join(directory, name), name }).start()
    instances.push({ runtime, management: new RemoteManagement(runtime) })
  }
  return instances
}
async function until(read, predicate) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const value = await read()
    if (predicate(value)) return value
    await delay(5)
  }
  throw new Error('management transition did not settle')
}

test('UI pairing preserves both human confirmations, rejects stale windows, and supports revoke/reconnect', async t => {
  const [a, b] = await hosts(t)
  const { sid } = await b.management.call('pair.begin')
  const before = await b.management.snapshot()
  assert.match(before.incoming.image, /^data:image\/png;base64,/)
  const { id } = await a.management.call('pair.connect', { qr: before.incoming.qr })
  const challenge = await until(() => a.management.snapshot(), value => value.outgoing?.state === 'confirming')
  assert.equal(challenge.outgoing.sas, (await b.management.snapshot()).incoming.sas)
  assert.equal(a.runtime.store.devices.length, 0)
  assert.equal(b.runtime.store.devices.length, 0)
  await assert.rejects(b.management.call('pair.confirm', { sid: 'old-window', sas: challenge.outgoing.sas }), { code: 'unauthorized' })
  await assert.rejects(a.management.call('pair.accept', { id, sas: 'invalid' }), { code: 'unauthorized' })
  await a.management.call('pair.accept', { id, sas: challenge.outgoing.sas })
  assert.equal((await a.management.snapshot()).outgoing.state, 'waiting')
  assert.equal(b.runtime.store.devices.length, 0)
  await b.management.call('pair.confirm', { sid, sas: challenge.outgoing.sas })
  const done = await until(() => a.management.snapshot(), value => value.outgoing?.state === 'paired')
  assert.equal(done.outgoing.sas, undefined)
  assert.deepEqual(done.devices[0].caps, [])
  assert.deepEqual(done.devices[0].remoteCaps, ['session', 'stream', 'approval'])
  const deviceId = done.devices[0].deviceId
  await a.management.call('device.connect', { deviceId })
  assert.equal((await a.management.snapshot()).devices[0].outbound, true)
  await assert.rejects(a.management.call('device.connect', { deviceId, endpoint: 'ws://unverified.invalid/remote/ws' }), { code: 'busy' })
  await a.management.call('device.disconnect', { deviceId })
  assert.equal((await a.management.snapshot()).devices[0].outbound, false)
  const publicKey = a.runtime.store.devices[0].publicKey
  await a.management.call('device.connect', { deviceId, endpoint: b.runtime.endpoint })
  assert.equal(a.runtime.store.devices[0].publicKey, publicKey)
  assert.equal(a.runtime.store.devices[0].endpoint, b.runtime.endpoint)
  await a.management.call('device.rename', { deviceId, name: 'My desktop' })
  assert.equal((await a.management.snapshot()).devices[0].name, 'My desktop')
  await a.management.call('device.revoke', { deviceId })
  await assert.rejects(a.management.call('device.connect', { deviceId }), { code: 'unauthorized' })
  assert.equal(a.runtime.clients.size, 0)
  assert.equal(JSON.stringify(done).includes('secretKey'), false)
})

test('cancelled outgoing pairing releases its task; stale cancel cannot stop a later pairing', async t => {
  const [a, b] = await hosts(t)
  await b.management.call('pair.begin')
  const first = await a.management.call('pair.connect', { qr: (await b.management.snapshot()).incoming.qr })
  await until(() => a.management.snapshot(), value => value.outgoing?.state === 'confirming')
  await a.management.call('pair.disconnect', first)
  await a.management.outgoing.task
  assert.equal(a.management.outgoing.state, 'cancelled')
  assert.equal(b.runtime.store.devices.length, 0)
  await until(() => b.management.snapshot(), value => value.incoming?.state === 'cancelled')
  const second = await b.management.call('pair.begin')
  await assert.rejects(b.management.call('pair.cancel', { sid: 'stale' }), { code: 'unauthorized' })
  assert.equal((await b.management.snapshot()).incoming.sid, second.sid)
  await b.management.call('pair.cancel', second)
  assert.equal((await b.management.snapshot()).incoming.state, 'cancelled')
})

test('management observers are bounded, cancel without mutating runtime, and wake on changes', async t => {
  const [a] = await hosts(t)
  const { revision } = await a.management.snapshot()
  const abort = new AbortController()
  const watches = Array.from({ length: 16 }, () => a.management.watch(revision, abort.signal))
  await assert.rejects(a.management.watch(revision), { code: 'busy' })
  abort.abort()
  await Promise.all(watches)
  assert.equal(a.management.watchers, 0)
  assert.equal(a.runtime.pairing.pending(), null)
  assert.equal(a.runtime.tunnelManager, undefined)
  const updated = a.management.watch(revision)
  await a.management.call('pair.begin')
  assert.ok((await updated).revision > revision)
})

test('expiry and shutdown release pending confirmations; tunnel changes invalidate old pairing codes', async t => {
  const [a, b] = await hosts(t)
  await assert.rejects(a.management.call('pair.connect', { qr: {} }), { code: 'invalid-argument' })
  await b.management.call('pair.begin')
  const qr = (await b.management.snapshot()).incoming.qr
  await assert.rejects(a.management.call('pair.connect', { qr: { ...qr, name: { invalid: true } } }), { code: 'invalid-argument' })
  assert.equal((await a.management.snapshot()).outgoing, null)
  await a.management.call('pair.connect', { qr: { ...qr, exp: Math.floor(Date.now() / 1000) + 2 } })
  await a.management.outgoing.task
  assert.equal(a.management.outgoing.state, 'expired')
  assert.equal(a.management.outgoing.sas, undefined)
  await until(() => b.management.snapshot(), value => value.incoming?.state === 'cancelled')
  await b.management.call('pair.begin')
  await a.management.call('pair.connect', { qr: (await b.management.snapshot()).incoming.qr })
  await until(() => a.management.snapshot(), value => value.outgoing?.state === 'confirming')
  await a.management.close()
  assert.equal(a.management.outgoing.state, 'cancelled')
  await assert.rejects(a.management.call('status'), { code: 'cancelled' })
  await until(() => b.management.snapshot(), value => value.incoming?.state === 'cancelled')
  await b.management.call('pair.begin')
  const tunnel = b.management.tunnel()
  tunnel.emit('state', 'ready')
  assert.equal(b.runtime.pairing.pending(), null)
  assert.equal((await b.management.snapshot()).incoming.state, 'cancelled')
  assert.equal(b.runtime.store.devices.length, 0)
})

test('new pairing codes use the ready public endpoint and cannot reuse codes from an earlier tunnel state', async t => {
  const [a] = await hosts(t)
  await a.management.call('pair.begin')
  const local = (await a.management.snapshot()).incoming
  assert.equal(local.qr.relay, a.runtime.server.endpoint)
  const tunnel = a.management.tunnel()
  tunnel.url = 'https://pairing-test.trycloudflare.com'
  tunnel.state = 'ready'
  tunnel.emit('state', tunnel.state)
  await a.management.call('pair.begin')
  const publicState = await a.management.snapshot()
  assert.equal(publicState.incoming.qr.relay, 'wss://pairing-test.trycloudflare.com/remote/ws')
  assert.equal(publicState.incoming.qr.relay, publicState.tunnel.endpoint)
  assert.notEqual(publicState.incoming.sid, local.sid)
  assert.notEqual(publicState.incoming.image, local.image)
  assert.throws(() => a.runtime.pairing.claim(local.sid), { code: 'unauthorized' })
  tunnel.url = null
  tunnel.state = 'stopped'
  tunnel.emit('state', tunnel.state)
  const stopped = await a.management.snapshot()
  assert.equal(stopped.incoming.state, 'cancelled')
  assert.equal(stopped.incoming.image, undefined)
  assert.throws(() => a.runtime.pairing.claim(publicState.incoming.sid), { code: 'unauthorized' })
  await a.management.call('pair.begin')
  assert.equal((await a.management.snapshot()).incoming.qr.relay, a.runtime.server.endpoint)
})

test('management registers only an exact authenticated Connection route and rejects malformed envelopes', async t => {
  const [a] = await hosts(t)
  let route
  registerManagement({ connection: { fetch: { register: value => { route = value } } } }, a.management)
  assert.equal(route.path, '/api/dsh-remote/manage')
  const send = body => route.fetch(new Request('http://local/api/dsh-remote/manage', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))
  assert.equal((await send({ method: 'status' })).status, 400)
  assert.equal((await send({ padding: 'x'.repeat(17000) })).status, 413)
  const response = await send({ type: 'client-request', rpcId: 'test', method: 'dsh-remote/manage', payload: { method: 'status' } })
  const envelope = await response.json()
  assert.equal(envelope.rpcId, 'test')
  assert.equal(envelope.result.ok, true)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  const unknown = await send({ type: 'client-request', rpcId: 'test', method: 'dsh-remote/manage', payload: { method: 'approval.decide' } })
  assert.equal((await unknown.json()).result.error.code, 'unsupported')
})
