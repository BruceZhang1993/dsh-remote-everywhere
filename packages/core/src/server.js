import { EventEmitter } from 'node:events'
import http from 'node:http'
import net from 'node:net'
import { WebSocketServer } from 'ws'
import { MAX_WIRE_BYTES, assertValue } from '@dsh-remote/protocol'
import { SecureConnection } from './connection.js'
import { TcpTransport, WebSocketTransport } from './transport.js'
import { BLAKE2S } from './primitives.js'

/** Own a listener and every accepted connection; closing the server releases both. */
export async function createRemoteServer({ keyPair, peerPublicKey, connectionOptionsForRequest, port = 0, host = '127.0.0.1', transport = 'ws', maxConnections = 32, ...connectionOptions }) {
  if (!['tcp', 'ws'].includes(transport) || !Number.isInteger(maxConnections) || maxConnections < 1 || maxConnections > 128) {
    throw new Error('invalid server transport or connection limit')
  }
  if (connectionOptionsForRequest && transport !== 'ws') throw new Error('dynamic peer authorization requires WebSocket request routing')
  if (keyPair?.secretKey?.length !== 32 || keyPair?.publicKey?.length !== 32 || (peerPublicKey?.length !== 32 && typeof connectionOptionsForRequest !== 'function') ||
      Buffer.compare(Buffer.from(BLAKE2S.generateKeyPair(keyPair.secretKey).publicKey), Buffer.from(keyPair.publicKey)) !== 0) throw new Error('invalid server identities')
  assertValue('Hello', { type: 'hello', vmin: 1, vmax: 1, caps: connectionOptions.caps ?? ['diagnostic', 'stream'],
    role: 'controlled', kind: connectionOptions.kind ?? 'cli', name: connectionOptions.name ?? 'DSH Remote', deviceId: 'A'.repeat(22) })
  for (const name of ['handshakeTimeoutMs', 'requestTimeoutMs', 'heartbeatMs', 'sendTimeoutMs']) {
    const value = connectionOptions[name]
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 1 || value > 0x7fffffff)) throw new Error(`invalid ${name}`)
  }
  const owner = new EventEmitter()
  const connections = new Set()
  const sockets = new Set()
  let stopping = false
  let closing
  const accept = (carrier, options = {}, address) => {
    if (stopping || connections.size >= maxConnections) { carrier.close(); return }
    const connection = new SecureConnection(carrier, { ...connectionOptions, ...options, initiator: false, keyPair, peerPublicKey })
    connections.add(connection)
    connection.once('closed', error => { connections.delete(connection); owner.emit('disconnected', error.code) })
    connection.ready.catch(error => owner.emit('rejected', error.code))
    owner.emit('connection', connection, { address })
  }
  const server = transport === 'tcp'
    ? net.createServer(socket => accept(new TcpTransport(socket), {}, socket.remoteAddress))
    : http.createServer((request, response) => {
      response.writeHead(request.url === '/health' ? 200 : 404, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      response.end(request.url === '/health' ? '{"ok":true}' : '{"error":"not-found"}')
    })
  server.maxConnections = maxConnections * 2
  server.on('connection', socket => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
  })
  let wss
  if (transport === 'ws') {
    server.headersTimeout = 10000
    server.requestTimeout = 10000
    wss = new WebSocketServer({ noServer: true, maxPayload: MAX_WIRE_BYTES, maxFragments: 1024, maxBufferedChunks: 1024, perMessageDeflate: false })
    server.on('upgrade', (request, socket, head) => {
      let options = {}
      try { options = connectionOptionsForRequest?.(request) ?? {} }
      catch (error) {
        owner.emit('upgrade-rejected', { address: socket.remoteAddress, code: error?.code ?? 'internal' })
        socket.end(`HTTP/1.1 ${error?.code === 'busy' ? '429 Too Many Requests' : '403 Forbidden'}\r\nConnection: close\r\n\r\n`); return
      }
      if (request.url?.split('?')[0] !== '/remote/ws' || stopping || connections.size >= maxConnections) {
        owner.emit('upgrade-rejected', { address: socket.remoteAddress, code: connections.size >= maxConnections ? 'busy' : 'not-found' })
        socket.end(`HTTP/1.1 ${connections.size >= maxConnections ? '429 Too Many Requests' : '404 Not Found'}\r\nConnection: close\r\n\r\n`)
        return
      }
      wss.handleUpgrade(request, socket, head, ws => accept(new WebSocketTransport(ws), options, socket.remoteAddress))
    })
  }
  await new Promise((resolve, reject) => {
    const failed = error => { server.removeListener('listening', listening); reject(error) }
    const listening = () => { server.removeListener('error', failed); resolve() }
    server.once('error', failed)
    server.once('listening', listening)
    server.listen(port, host)
  })
  const address = server.address()
  owner.endpoint = transport === 'tcp' ? `tcp://${host}:${address.port}` : `ws://${host}:${address.port}/remote/ws`
  owner.origin = transport === 'ws' ? `http://${host}:${address.port}` : null
  owner.connections = connections
  owner.close = () => {
    if (closing) return closing
    stopping = true
    for (const connection of connections) connection.close()
    for (const socket of sockets) socket.destroy()
    closing = new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve())
      wss?.close()
    })
    return closing
  }
  server.on('error', () => { owner.emit('failure'); void owner.close() })
  return owner
}
