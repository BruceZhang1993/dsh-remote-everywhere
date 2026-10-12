import { setTimeout as delay } from 'node:timers/promises'
import { BLAKE2S, createRemoteServer, connectTransport, SecureConnection } from '../src/index.js'

export async function pair(t, options = {}) {
  const clientKey = BLAKE2S.generateKeyPair()
  const serverKey = BLAKE2S.generateKeyPair()
  const server = await createRemoteServer({ keyPair: serverKey, peerPublicKey: clientKey.publicKey, ...options.server, transport: options.transport ?? 'tcp' })
  t.after(() => server.close())
  const accepted = new Promise(resolve => server.once('connection', resolve))
  const carrier = await connectTransport(server.endpoint)
  const client = new SecureConnection(carrier, { initiator: true, keyPair: clientKey, peerPublicKey: serverKey.publicKey, ...options.client })
  t.after(() => client.close())
  const remote = await accepted
  await Promise.all([client.ready, remote.ready])
  return { client, remote, server, clientKey, serverKey }
}

export async function until(predicate, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('condition timed out')
    await delay(5)
  }
}
