import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { BLAKE2S } from '@dsh-remote/core'
import { RemoteClient } from '../src/client.js'

test('closing a client cancels an unfinished WebSocket upgrade and leaves no late connection', async () => {
  let accepted
  const upgrade = new Promise(resolve => { accepted = resolve })
  const sockets = new Set()
  const server = http.createServer()
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)) })
  server.on('upgrade', () => accepted()) // Deliberately never completes the upgrade.
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const keyPair = BLAKE2S.generateKeyPair()
  const peer = { publicKey: Buffer.from(BLAKE2S.generateKeyPair().publicKey).toString('base64url'), remoteCaps: ['session'], endpoint: `ws://127.0.0.1:${server.address().port}/remote/ws` }
  const client = new RemoteClient({ keyPair }, peer)
  try {
    const first = client.connect()
    const second = client.connect()
    first.catch(() => {}); second.catch(() => {})
    await upgrade
    await client.close()
    await assert.rejects(first, { code: 'cancelled' })
    await assert.rejects(second, { code: 'cancelled' })
    assert.equal(client.connection, null)
    assert.equal(client.establishing, null)
  } finally { await client.close(); for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); keyPair.secretKey.fill(0) }
})
