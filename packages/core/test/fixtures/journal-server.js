import { BLAKE2S, createRemoteServer, EventJournal, serveJournal } from '../../src/index.js'

// Public deterministic fixture keys; never used by the product CLI.
const keyPair = BLAKE2S.generateKeyPair(new Uint8Array(32).fill(7))
const clientKey = BLAKE2S.generateKeyPair(new Uint8Array(32).fill(9))
const journal = new EventJournal()
const server = await createRemoteServer({ keyPair, peerPublicKey: clientKey.publicKey, transport: 'tcp' })
server.on('connection', connection => serveJournal(connection, journal))
process.on('message', message => {
  if (message.type === 'append') {
    for (let index = 0; index < message.count; index++) journal.append('diagnostic/event', { value: index })
    process.send({ type: 'appended', cursor: journal.nextSeq - 1 })
  } else if (message.type === 'drop') {
    for (const connection of server.connections) connection.transport.close()
    process.send({ type: 'dropped' })
  }
})
process.on('SIGTERM', () => { void server.close().then(() => process.disconnect()) })
process.send({ type: 'ready', endpoint: server.endpoint, publicKey: Buffer.from(keyPair.publicKey).toString('hex') })
