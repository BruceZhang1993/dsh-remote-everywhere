import test from 'node:test'
import assert from 'node:assert/strict'
import { KINDS } from '@dsh-remote/protocol'
import WebSocket, { WebSocketServer } from 'ws'
import { once } from 'node:events'
import { BLAKE2S, SecureConnection, connectTransport, createRemoteServer } from '../src/index.js'
import { pair, until } from './helpers.js'

test('replaying an authenticated write never dispatches it twice', async t => {
  const { client, remote } = await pair(t)
  let writes = 0
  let record
  remote.register('diagnostic.write', 'diagnostic', () => ({ writes: ++writes }))
  const send = client.transport.send.bind(client.transport)
  client.transport.send = bytes => { record = Buffer.from(bytes); return send(bytes) }
  assert.deepEqual(await client.request('diagnostic.write'), { writes: 1 })
  await send(record)
  assert.equal((await remote.closed).code, 'invalid-argument')
  assert.equal(writes, 1)
})

test('physical connection capacity rejects before upgrade and recovers after release', async t => {
  const { client, remote, server, clientKey, serverKey } = await pair(t, { transport: 'ws', server: { maxConnections: 1 } })
  await assert.rejects(connectTransport(server.endpoint), { code: 'tunnel/busy' })
  assert.equal(server.connections.size, 1)
  client.close()
  await remote.closed
  await until(() => server.connections.size === 0)
  const next = new SecureConnection(await connectTransport(server.endpoint), {
    initiator: true, keyPair: clientKey, peerPublicKey: serverKey.publicKey,
  })
  t.after(() => next.close())
  await next.ready
  assert.equal(next.state, 'ready')
})

test('old-session ciphertext with a matching sequence fails on a fresh Noise session', async t => {
  const first = await pair(t)
  let record
  const send = first.client.transport.send.bind(first.client.transport)
  first.client.transport.send = bytes => { record = Buffer.from(bytes); return send(bytes) }
  first.remote.register('diagnostic.write', 'diagnostic', () => ({ ok: true }))
  await first.client.request('diagnostic.write')
  first.client.close()
  const accepted = new Promise(resolve => first.server.once('connection', resolve))
  const client = new SecureConnection(await connectTransport(first.server.endpoint), {
    initiator: true, keyPair: first.clientKey, peerPublicKey: first.serverKey.publicKey,
  })
  t.after(() => client.close())
  const remote = await accepted
  await Promise.all([client.ready, remote.ready])
  assert.equal(record.readBigUInt64BE(8), BigInt(remote.streams.get(0).rx))
  let writes = 0
  remote.register('diagnostic.write', 'diagnostic', () => ++writes)
  await client.transport.send(record)
  assert.equal((await remote.closed).code, 'unauthorized')
  assert.equal(writes, 0)
})

test('moving an authenticated request to another physical stream fails before dispatch', async t => {
  const { client, remote } = await pair(t)
  let writes = 0
  remote.register('diagnostic.write', 'diagnostic', () => ++writes)
  const send = client.transport.send.bind(client.transport)
  client.transport.send = bytes => {
    const altered = Buffer.from(bytes)
    altered.writeUInt32BE(1, 4)
    return send(altered)
  }
  await assert.rejects(client.request('diagnostic.write'))
  assert.equal((await remote.closed).code, 'invalid-argument')
  assert.equal(writes, 0)
})

for (const [name, changes] of [
  ['protocol downgrade', { vmin: 0, vmax: 0 }],
  ['unsupported future version', { vmin: 2, vmax: 2 }],
  ['controller masquerading as controlled peer', { role: 'controller' }],
  ['empty capability intersection', { caps: ['files'] }],
  ['device identity confusion', { deviceId: 'AAAAAAAAAAAAAAAAAAAAAA' }],
]) {
  test(`${name} fails during hello without accepting business requests`, async t => {
    const clientKey = BLAKE2S.generateKeyPair()
    const hostKey = BLAKE2S.generateKeyPair()
    const server = await createRemoteServer({ keyPair: hostKey, peerPublicKey: clientKey.publicKey })
    t.after(() => server.close())
    let writes = 0
    server.on('connection', remote => {
      remote.register('diagnostic.write', 'diagnostic', () => ++writes)
      const sendFrame = remote.sendFrame.bind(remote)
      remote.sendFrame = (kind, value, streamId) => sendFrame(kind,
        kind === KINDS.EVT && value.type === 'hello' ? { ...value, ...changes } : value, streamId)
    })
    const client = new SecureConnection(await connectTransport(server.endpoint), {
      initiator: true, keyPair: clientKey, peerPublicKey: hostKey.publicKey,
    })
    t.after(() => client.close())
    await assert.rejects(client.ready)
    await assert.rejects(client.request('diagnostic.write'), { code: 'unauthorized' })
    assert.equal(client.state, 'closed')
    assert.equal(writes, 0)
  })
}

for (const direction of ['server', 'client']) {
  test(`${direction} rejects 1025 tiny WebSocket fragments before FIN or Noise authentication`, async t => {
    let peer, transport
    if (direction === 'server') {
      const server = await createRemoteServer({ keyPair: BLAKE2S.generateKeyPair(), peerPublicKey: BLAKE2S.generateKeyPair().publicKey })
      t.after(() => server.close())
      const accepted = once(server, 'connection')
      peer = new WebSocket(server.endpoint)
      peer.on('error', () => {})
      t.after(() => peer.terminate())
      await once(peer, 'open')
      transport = (await accepted)[0].transport
    } else {
      const server = new WebSocketServer({ port: 0, host: '127.0.0.1', perMessageDeflate: false })
      t.after(() => new Promise(resolve => server.close(resolve)))
      await once(server, 'listening')
      const accepted = once(server, 'connection')
      transport = await connectTransport(`ws://127.0.0.1:${server.address().port}`)
      peer = (await accepted)[0]
      peer.on('error', () => {})
      t.after(() => { transport.close(); peer.terminate() })
    }
    const closed = once(transport, 'closed')
    for (let index = 0; index < 1025; index++) peer.send(Buffer.from([7]), { binary: true, fin: false })
    const timeout = AbortSignal.timeout(1000)
    await Promise.race([closed, new Promise((_, reject) => timeout.addEventListener('abort', () => reject(new Error('fragment flood was not rejected before FIN')), { once: true }))])
    assert.equal(transport.closed, true)
  })
}
