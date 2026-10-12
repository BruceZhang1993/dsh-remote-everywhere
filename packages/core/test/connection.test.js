import test from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { KINDS, ProtocolError, encodeHeader, encodePayload, MAX_QUEUE_BYTES } from '@dsh-remote/protocol'
import { pair, until } from './helpers.js'
import { BLAKE2S, createRemoteServer, connectTransport, SecureConnection, RecordDecoder } from '../src/index.js'
import { ReconnectingClient } from '../src/reconnect.js'
import http from 'node:http'

for (const transport of ['tcp', 'ws']) {
  test(`${transport}: authenticated RPC is encrypted and downstream failure leaves connection usable`, async t => {
    const { client, remote } = await pair(t, { transport })
    const captured = []
    const original = client.transport.send.bind(client.transport)
    client.transport.send = bytes => { captured.push(Buffer.from(bytes)); return original(bytes) }
    remote.register('diagnostic.echo', 'diagnostic', params => params)
    remote.register('diagnostic.fail', 'diagnostic', () => { throw new Error('secret downstream detail') })
    await assert.rejects(client.request('diagnostic.fail'), error => error.code === 'internal' && !error.message.includes('secret'))
    const message = 'plaintext must not appear on the wire'
    assert.deepEqual(await client.request('diagnostic.echo', { message }), { message })
    assert.equal(captured.some(bytes => bytes.includes(Buffer.from(message))), false)
    assert.equal(client.state, 'ready')
  })
}

test('wrong static pin and a mobile controlled hello fail closed', async t => {
  const clientKey = BLAKE2S.generateKeyPair()
  const hostKey = BLAKE2S.generateKeyPair()
  const server = await createRemoteServer({ keyPair: hostKey, peerPublicKey: clientKey.publicKey, transport: 'tcp' })
  t.after(() => server.close())
  const carrier = await connectTransport(server.endpoint)
  const connection = new SecureConnection(carrier, { initiator: true, keyPair: clientKey, peerPublicKey: BLAKE2S.generateKeyPair().publicKey })
  await assert.rejects(connection.ready, error => error.code === 'unauthorized')
  const mobile = await createRemoteServer({ keyPair: hostKey, peerPublicKey: clientKey.publicKey, kind: 'mobile', transport: 'tcp' })
  t.after(() => mobile.close())
  const invalid = new SecureConnection(await connectTransport(mobile.endpoint), { initiator: true, keyPair: clientKey, peerPublicKey: hostKey.publicKey })
  await assert.rejects(invalid.ready, error => error.code === 'unauthorized')
})

test('capabilities are an authorization ceiling and methods are not callable before ready', async t => {
  const { client, remote } = await pair(t, { client: { caps: ['diagnostic'] }, server: { caps: ['diagnostic', 'files'] } })
  remote.register('files.read', 'files', () => ({ secret: 'hidden' }))
  await assert.rejects(client.request('files.read'), error => error.code === 'unauthorized')
  await assert.rejects(client.request('unknown'), error => error.code === 'unsupported')
  client.close()
  await assert.rejects(client.request('files.read'), error => error.code === 'unauthorized')
})

for (const corrupt of ['header', 'ciphertext', 'sequence']) {
  test(`${corrupt} alteration closes the authenticated connection`, async t => {
    const { client, remote } = await pair(t)
    const header = encodeHeader({ kind: KINDS.REQ, streamId: 0, seq: corrupt === 'sequence' ? 0 : 1 })
    const ciphertext = client.noise.tx.encrypt(encodePayload(KINDS.REQ, { id: 'AAAAAAAAAAA', m: 'diagnostic.echo', p: {} }), header)
    const wire = Buffer.concat([header, ciphertext])
    if (corrupt === 'header') wire[3] = KINDS.RES
    if (corrupt === 'ciphertext') wire[16] ^= 1
    await client.transport.send(wire)
    assert.ok(['unauthorized', 'invalid-argument'].includes((await remote.closed).code))
  })
}

test('request deadline releases caller slot; ignored cancellation cannot create unbounded server work', async t => {
  const { client, remote } = await pair(t, { server: { requestTimeoutMs: 20 } })
  const releases = []
  remote.register('diagnostic.wait', 'diagnostic', () => new Promise(resolve => releases.push(resolve)))
  t.after(() => releases.forEach(resolve => resolve({ stopped: true })))
  await assert.rejects(client.request('diagnostic.wait', {}, { timeoutMs: 5 }), error => error.code === 'timeout')
  await delay(30)
  assert.equal(client.pending.size, 0)
  assert.equal(remote.active.size, 1)
  const results = await Promise.allSettled(Array.from({ length: 32 }, () => client.request('diagnostic.wait')))
  assert.equal(results.every(value => value.status === 'rejected'), true)
  assert.equal(remote.active.size, 32)
  releases.forEach(resolve => resolve({ done: true }))
  await until(() => remote.active.size === 0)
  remote.register('diagnostic.echo', 'diagnostic', params => params)
  assert.deepEqual(await client.request('diagnostic.echo'), {})
})

test('slow outgoing transport is bounded; close releases timers, queues and caller-owned key remains intact', async t => {
  const { client, clientKey } = await pair(t)
  const secret = Buffer.from(clientKey.secretKey)
  client.transport.send = () => new Promise(() => {})
  const streamId = client.allocateStream()
  const sends = Array.from({ length: 40 }, () => client.sendFrame(KINDS.SDATA, new Uint8Array(60000), streamId))
  const results = await Promise.allSettled(sends)
  assert.equal(results.some(value => value.status === 'rejected' && value.reason.code === 'busy'), true)
  assert.equal(client.state, 'closed')
  assert.ok(client.queueBytes <= MAX_QUEUE_BYTES)
  assert.equal(client.queueMessages, 0)
  assert.deepEqual(Buffer.from(clientKey.secretKey), secret)
  assert.equal(client.listenerCount('closed'), 0)
})

test('silent peer is detected by application heartbeat', async t => {
  const { client, remote } = await pair(t, { client: { heartbeatMs: 10 }, server: { heartbeatMs: 1000 } })
  remote.transport.removeListener('message', remote.onMessage)
  assert.equal((await client.closed).code, 'transport/lost')
})

test('TCP decoder handles split/coalesced records and rejects advertised oversize immediately', () => {
  const records = []
  const decoder = new RecordDecoder(record => records.push(record.toString()))
  decoder.push(Buffer.from([0, 0]))
  decoder.push(Buffer.from([0, 3, 97]))
  decoder.push(Buffer.from([98, 99, 0, 0, 0, 1, 120]))
  assert.deepEqual(records, ['abc', 'x'])
  assert.throws(() => new RecordDecoder(() => {}).push(Buffer.from([0xff, 0xff, 0xff, 0xff])), ProtocolError)
})

test('stream capacity is bounded and v1 message budget ends the session without nonce reuse', async t => {
  const { client } = await pair(t)
  for (let index = 0; index < 32; index++) client.allocateStream()
  assert.throws(() => client.allocateStream(), error => error.code === 'busy')
  client.noise.tx.n = 0xfffffffe
  await assert.rejects(client.sendFrame(KINDS.EVT, { type: 'ping', id: 'AAAAAAAAAAA' }), error => error.code === 'transport/lost')
  assert.equal(client.state, 'closed')
})

test('retired stream ids cannot be reused and handshake secrets are released after split', async t => {
  const { client } = await pair(t)
  const id = client.allocateStream()
  client.releaseStream(id)
  assert.throws(() => client.registerStream(id), error => error.code === 'invalid-argument')
  assert.equal(client.noise.s.secretKey.every(byte => byte === 0), true)
  assert.equal(client.noise.e.secretKey.every(byte => byte === 0), true)
  assert.equal(client.noise.tx.k.every(byte => byte === 0), false)
})

test('429 waits for physical capacity; 530 stops with address-expired rather than retrying authorization', async t => {
  const { client, server, clientKey, serverKey } = await pair(t, { transport: 'ws', server: { maxConnections: 1 } })
  const waiting = new ReconnectingClient({ endpoint: server.endpoint, keyPair: clientKey, peerPublicKey: serverKey.publicKey, retryBaseMs: 10, retryMaxMs: 20 })
  const states = []
  waiting.on('state', state => states.push(state))
  t.after(() => waiting.stop())
  waiting.start()
  await until(() => states.includes('reconnecting'))
  client.close()
  await until(() => states.includes('connected'))
  waiting.stop()
  const expired = http.createServer()
  let upgrades = 0
  expired.on('upgrade', (_request, socket) => { upgrades++; socket.end('HTTP/1.1 530 Tunnel expired\r\nConnection: close\r\n\r\n') })
  await new Promise(resolve => expired.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => expired.close(resolve)))
  const stale = new ReconnectingClient({ endpoint: `ws://127.0.0.1:${expired.address().port}/remote/ws`, keyPair: clientKey, peerPublicKey: serverKey.publicKey, retryBaseMs: 10, retryMaxMs: 20 })
  let error
  stale.on('failure', failure => { error = failure })
  t.after(() => stale.stop())
  stale.start()
  await until(() => error !== undefined)
  await delay(30)
  assert.equal(error.code, 'tunnel/expired')
  assert.equal(stale.running, false)
  assert.equal(upgrades, 1)
})
