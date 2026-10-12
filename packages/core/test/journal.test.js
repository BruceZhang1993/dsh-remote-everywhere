import test from 'node:test'
import assert from 'node:assert/strict'
import { ProtocolError } from '@dsh-remote/protocol'
import { BLAKE2S, createRemoteServer, EventJournal, serveJournal, ReconnectingClient, JournalFollower } from '../src/index.js'
import { until } from './helpers.js'

async function follow(t, journal, options = {}) {
  const hostKey = BLAKE2S.generateKeyPair()
  const clientKey = BLAKE2S.generateKeyPair()
  const server = await createRemoteServer({ keyPair: hostKey, peerPublicKey: clientKey.publicKey, transport: 'tcp' })
  const client = new ReconnectingClient({ endpoint: server.endpoint, keyPair: clientKey, peerPublicKey: hostKey.publicKey, retryBaseMs: 10, retryMaxMs: 20 })
  const follower = new JournalFollower(client, { knownTypes: ['diagnostic/event'], maxMessages: 2, ...options })
  const events = []
  const failures = []
  let synced = 0
  server.on('connection', connection => serveJournal(connection, journal))
  follower.on('event', record => events.push(record.seq))
  follower.on('failure', error => failures.push(error.code))
  client.on('failure', error => failures.push(error.code))
  follower.on('synced', () => { synced++ })
  t.after(async () => { follower.stop(); client.stop(); await server.close() })
  client.start()
  return { server, client, follower, events, failures, synced: () => synced }
}

test('reconnect repairs multiple pages, deduplicates opening history and preserves the identity pin', async t => {
  const journal = new EventJournal()
  for (let index = 0; index < 5; index++) journal.append('diagnostic/event', { index })
  const state = await follow(t, journal)
  await until(() => state.synced() === 1)
  assert.deepEqual(state.events, [0, 1, 2, 3, 4])
  for (const connection of state.server.connections) connection.close(new ProtocolError('transport/lost', 'test disconnect'))
  for (let index = 5; index < 20; index++) journal.append('diagnostic/event', { index })
  await until(() => state.synced() === 2)
  journal.append('diagnostic/event', { index: 20 })
  await until(() => state.events.length === 21)
  assert.deepEqual(state.events, Array.from({ length: 21 }, (_, index) => index))
  assert.equal(state.follower.cursor, 20)
  assert.deepEqual(state.failures, [])
  assert.equal(journal.listenerCount('append'), 1)
  state.client.stop()
  await until(() => journal.listenerCount('append') === 0)
})

test('retention loss is explicit and never silently advances the cursor', async t => {
  const journal = new EventJournal({ maxRecords: 2 })
  for (let index = 0; index < 5; index++) journal.append('diagnostic/event', {})
  const state = await follow(t, journal)
  await until(() => state.failures.length > 0)
  assert.deepEqual(state.failures, ['history/unavailable'])
  assert.equal(state.follower.cursor, -1)
  assert.deepEqual(state.events, [])
})

test('unknown required events fail reconstruction; ignorable events still advance durable cursor', async t => {
  const invalid = new EventJournal()
  invalid.append('future/required', {})
  const rejected = await follow(t, invalid)
  await until(() => rejected.failures.length > 0)
  assert.deepEqual(rejected.failures, ['unsupported'])
  const valid = new EventJournal()
  valid.append('future/optional', {}, { ignorable: true })
  valid.append('diagnostic/event', {})
  const accepted = await follow(t, valid)
  await until(() => accepted.synced() > 0)
  assert.deepEqual(accepted.events, [1])
  assert.equal(accepted.follower.cursor, 1)
})

test('backwards repair rejects non-progressing pages and enforces the page budget', async t => {
  const journal = new EventJournal()
  for (let index = 0; index < 10; index++) journal.append('diagnostic/event', {})
  const state = await follow(t, journal, { maxReplayPages: 1 })
  await until(() => state.failures.length > 0)
  assert.deepEqual(state.failures, ['busy'])
  assert.equal(state.follower.cursor, -1)
  assert.throws(() => journal.page({ throughSeq: 9, maxMessages: 257 }), ProtocolError)
})

test('stopping only the follower closes its source subscription while the connection remains usable', async t => {
  const journal = new EventJournal()
  journal.append('diagnostic/event', {})
  const state = await follow(t, journal)
  await until(() => state.synced() === 1)
  state.follower.stop()
  await until(() => journal.listenerCount('append') === 0 && state.client.connection.streams.size === 1 && state.client.connection.pending.size === 0)
  assert.equal(state.client.connection.state, 'ready')
  assert.equal(state.client.connection.pending.size, 0)
})
