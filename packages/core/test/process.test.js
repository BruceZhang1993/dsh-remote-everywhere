import test from 'node:test'
import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import { once } from 'node:events'
import { BLAKE2S, ReconnectingClient, JournalFollower } from '../src/index.js'
import { until } from './helpers.js'

test('two independent Node processes recover events produced while transport is disconnected', async t => {
  const child = fork(new URL('./fixtures/journal-server.js', import.meta.url), [], { execArgv: [], stdio: ['ignore', 'ignore', 'pipe', 'ipc'] })
  t.after(async () => { if (child.exitCode === null) { const closed = once(child, 'close'); child.kill('SIGTERM'); await closed } })
  const [ready] = await once(child, 'message')
  const client = new ReconnectingClient({ endpoint: ready.endpoint, keyPair: BLAKE2S.generateKeyPair(new Uint8Array(32).fill(9)), peerPublicKey: Buffer.from(ready.publicKey, 'hex'), retryBaseMs: 20, retryMaxMs: 40 })
  const follower = new JournalFollower(client, { knownTypes: ['diagnostic/event'], maxMessages: 2 })
  const records = []
  let synchronized = 0
  follower.on('event', event => records.push(event.seq))
  follower.on('synced', () => { synchronized++ })
  follower.on('failure', error => assert.fail(error.code))
  t.after(() => { follower.stop(); client.stop() })
  const send = async message => { const reply = once(child, 'message'); child.send(message); return (await reply)[0] }
  await send({ type: 'append', count: 5 })
  client.start()
  await until(() => synchronized === 1)
  await send({ type: 'drop' })
  await send({ type: 'append', count: 25 })
  await until(() => synchronized >= 2 && follower.cursor === 29)
  assert.deepEqual(records, Array.from({ length: 30 }, (_, index) => index))
})
