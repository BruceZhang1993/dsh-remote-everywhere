import { resolve } from 'node:path'
import { BLAKE2S, createRemoteServer, connectTransport, SecureConnection } from '@dsh-remote/core'
import { TunnelManager } from '@dsh-remote/tunnel'

const hostKey = BLAKE2S.generateKeyPair()
const clientKey = BLAKE2S.generateKeyPair()
const server = await createRemoteServer({ keyPair: hostKey, peerPublicKey: clientKey.publicKey })
server.on('connection', connection => connection.register('diagnostic.echo', 'diagnostic', params => params))
const manager = new TunnelManager({ binary: process.env.CLOUDFLARED ?? resolve('spikes/tunnel/cloudflared') })
try {
  for (let cycle = 1; cycle <= 2; cycle++) {
    const started = Date.now()
    const url = await manager.start(server.origin)
    let connection
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const carrier = await connectTransport(url.replace('https:', 'wss:') + '/remote/ws')
        connection = new SecureConnection(carrier, { initiator: true, keyPair: clientKey, peerPublicKey: hostKey.publicKey, heartbeatMs: 1000 })
        await connection.ready
        break
      } catch (error) {
        connection?.close()
        if (attempt === 4 || error.code !== 'transport/lost') throw error
      }
    }
    try {
      const result = await connection.request('diagnostic.echo', { cycle, message: 'M1 public Noise smoke' })
      if (result.cycle !== cycle) throw new Error('public encrypted RPC failed')
    } finally { connection.close() }
    await manager.stop()
    if (manager.url !== null || manager.state !== 'stopped') throw new Error('tunnel did not clear endpoint on stop')
    console.log(JSON.stringify({ cycle, readyAndEncryptedRpc: true, stopped: true, elapsedMs: Date.now() - started }))
  }
} finally {
  await manager.stop()
  await server.close()
  hostKey.secretKey.fill(0)
  clientKey.secretKey.fill(0)
}
