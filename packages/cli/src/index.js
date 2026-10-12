#!/usr/bin/env node
import { readFile, writeFile, stat } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import {
  BLAKE2S, deviceId, createRemoteServer, EventJournal, serveJournal,
  ReconnectingClient, JournalFollower, connectTransport, SecureConnection,
} from '@dsh-remote/core'
import { TunnelManager } from '@dsh-remote/tunnel'

const print = value => process.stdout.write(JSON.stringify(value) + '\n')
const publicHex = key => Buffer.from(key).toString('hex')

async function identity(path) {
  if (!path) throw new Error('--key is required')
  const info = await stat(path)
  if (info.size > 4096 || process.platform !== 'win32' && (info.mode & 0o077) !== 0) throw new Error('identity must be a small private file (0600 on POSIX)')
  const value = JSON.parse(await readFile(path, 'utf8'))
  if (!/^[a-f0-9]{64}$/.test(value.secretKey)) throw new Error('invalid identity file')
  const pair = BLAKE2S.generateKeyPair(Buffer.from(value.secretKey, 'hex'))
  if (value.publicKey !== publicHex(pair.publicKey)) throw new Error('identity public key does not match private key')
  return pair
}

function peerPin(value) {
  if (!/^[a-f0-9]{64}$/.test(value ?? '')) throw new Error('--peer requires the trusted peer public key (64 lowercase hex characters)')
  return Buffer.from(value, 'hex')
}

async function main() {
  const command = process.argv[2]
  const { values } = parseArgs({ args: process.argv.slice(3), options: {
    out: { type: 'string' }, key: { type: 'string' }, peer: { type: 'string' },
    endpoint: { type: 'string' }, port: { type: 'string', default: '47311' },
    transport: { type: 'string', default: 'ws' }, interval: { type: 'string', default: '1000' },
    tunnel: { type: 'boolean', default: false }, cloudflared: { type: 'string' },
    follow: { type: 'boolean', default: false }, message: { type: 'string', default: 'DSH Remote M1' },
  } })
  if (command === 'keygen') {
    if (!values.out) throw new Error('--out is required')
    const pair = BLAKE2S.generateKeyPair()
    try {
      await writeFile(values.out, JSON.stringify({ secretKey: publicHex(pair.secretKey), publicKey: publicHex(pair.publicKey) }) + '\n', { mode: 0o600, flag: 'wx' })
      print({ type: 'identity', path: values.out, publicKey: publicHex(pair.publicKey), deviceId: deviceId(pair.publicKey) })
    } finally { pair.secretKey.fill(0) }
    return
  }
  if (!['serve', 'connect', 'doctor'].includes(command)) {
    process.stdout.write('用法：dsh-remote keygen --out host.key\n      dsh-remote serve --key host.key --peer PUBLIC_KEY [--port 47311] [--transport ws|tcp] [--tunnel --cloudflared PATH]\n      dsh-remote connect --key client.key --peer PUBLIC_KEY --endpoint URL [--follow]\n      dsh-remote doctor --key client.key --peer PUBLIC_KEY --endpoint URL\n')
    return
  }
  const keyPair = await identity(values.key)
  const peerPublicKey = peerPin(values.peer)
  const startup = new AbortController()
  let cleanup = async () => {}
  let stopping = false
  const shutdown = async () => {
    if (stopping) return
    stopping = true
    startup.abort()
    try { await cleanup() }
    finally { keyPair.secretKey.fill(0) }
  }
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void shutdown().catch(() => { process.exitCode = 1 }) })
  try {
    if (command === 'serve') {
      const port = Number(values.port)
      const interval = Number(values.interval)
      if (!Number.isInteger(port) || port < 0 || port > 65535 || !Number.isInteger(interval) || interval < 10 || interval > 3600000) throw new Error('invalid port or event interval')
      if (values.tunnel && values.transport !== 'ws') throw new Error('--tunnel requires --transport ws')
      const journal = new EventJournal()
      const server = await createRemoteServer({ keyPair, peerPublicKey, port, transport: values.transport })
      let timer
      let tunnel
      cleanup = async () => { clearInterval(timer); try { await tunnel?.stop() } finally { await server.close() } }
      if (stopping) { await cleanup(); return }
      server.on('connection', connection => {
        connection.register('diagnostic.echo', 'diagnostic', params => params)
        serveJournal(connection, journal)
      })
      server.on('failure', () => { process.exitCode = 1; void shutdown() })
      timer = setInterval(() => journal.append('diagnostic/event', { message: 'M1 replay source' }), interval)
      let endpoint = server.endpoint
      if (values.tunnel) {
        tunnel = new TunnelManager({ binary: values.cloudflared ?? 'cloudflared' })
        tunnel.on('state', state => { if (state === 'failed') print({ type: 'state', state: 'address-expired' }) })
        const url = await tunnel.start(server.origin)
        endpoint = url.replace('https:', 'wss:') + '/remote/ws'
      }
      if (stopping) { await cleanup(); return }
      print({ type: 'ready', endpoint, publicKey: publicHex(keyPair.publicKey), deviceId: deviceId(keyPair.publicKey) })
    } else if (command === 'doctor' || !values.follow) {
      if (!values.endpoint) throw new Error('--endpoint is required')
      const carrier = await connectTransport(values.endpoint, { signal: startup.signal })
      if (stopping) { carrier.close(); return }
      const connection = new SecureConnection(carrier, { initiator: true, keyPair, peerPublicKey })
      cleanup = async () => connection.close()
      await connection.ready
      const result = await connection.request('diagnostic.echo', { message: values.message })
      print({ type: command === 'doctor' ? 'diagnosis' : 'response', encrypted: true, peer: deviceId(peerPublicKey), result })
      await shutdown()
    } else {
      if (!values.endpoint) throw new Error('--endpoint is required')
      const client = new ReconnectingClient({ endpoint: values.endpoint, keyPair, peerPublicKey })
      const follower = new JournalFollower(client, { knownTypes: ['diagnostic/event'] })
      cleanup = async () => { follower.stop(); client.stop() }
      client.on('state', state => print({ type: 'state', state }))
      client.on('failure', error => { print({ type: 'failure', code: error.code }); process.exitCode = 1; void shutdown() })
      follower.on('failure', error => { print({ type: 'failure', code: error.code }); process.exitCode = 1; void shutdown() })
      follower.on('event', event => print({ type: 'event', event }))
      follower.on('synced', cursor => print({ type: 'synced', cursor }))
      client.start()
    }
  } catch (error) { await shutdown(); throw error }
}

main().catch(error => { process.stderr.write(JSON.stringify({ type: 'failure', code: error.code ?? 'invalid-argument', message: error.message }) + '\n'); process.exitCode = 1 })
