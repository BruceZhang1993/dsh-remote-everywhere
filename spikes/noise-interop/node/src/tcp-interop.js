// Live interop driver: a real Noise_XX_25519_ChaChaPoly_BLAKE2s handshake over
// TCP between this Node implementation and the Dart implementation.
//
//   node src/tcp-interop.js server <port> [--initiator] [--sid <sid>] [--json]
//   node src/tcp-interop.js client <port> [--initiator] [--sid <sid>] [--json]
//
// Wire format: 4-byte big-endian length prefix + payload on every message.
//
// Protocol (byte-identical in dart/bin/tcp_interop.dart):
//   1..3  handshake messages in XX pattern order
//   4     initiator -> responder  transport #1 = JSON {handshakeHash, sas, role}
//   5     initiator -> responder  transport #2 = "i->r payload #2"
//   6     responder -> initiator  transport #1 = JSON {handshakeHash, sas, role}
//   7     responder -> initiator  transport #2 = "r->i payload #2"
//   8     initiator -> responder  a corrupted ciphertext (tamper probe)
//   9     initiator -> responder  transport #3 = "i->r payload #3"
//   10    responder -> initiator  transport #3 = "r->i payload #3"
//
// The responder must reject step 8 and still decrypt step 9, which proves the
// failed AEAD open did not advance the receive nonce.
//
// Each side prints one machine-readable line:  DSH_INTEROP_RESULT <json>

import net from 'node:net'
import { x25519 } from '@noble/curves/ed25519.js'

import { toHex, utf8, concat, bytesToUtf8 } from './bytes.js'
import { NoiseXX, deriveSas, prologueForSession } from './noise-xx.js'
import { BLAKE2S } from './primitives.js'

function parseArgs (argv) {
  const mode = argv[0]
  const port = Number(argv[1])
  const flags = new Map()
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const next = argv[i + 1]
      if (next && !next.startsWith('--')) { flags.set(a.slice(2), next); i++ } else flags.set(a.slice(2), 'true')
    }
  }
  return { mode, port, flags }
}

function frame (buf) {
  const out = new Uint8Array(4 + buf.length)
  new DataView(out.buffer).setUint32(0, buf.length, false)
  out.set(buf, 4)
  return out
}

function makeReader (onMessage) {
  let acc = new Uint8Array(0)
  return (chunk) => {
    acc = concat(acc, chunk)
    for (;;) {
      if (acc.length < 4) return
      const len = new DataView(acc.buffer, acc.byteOffset, 4).getUint32(0, false)
      if (acc.length < 4 + len) return
      const msg = acc.slice(4, 4 + len)
      acc = acc.slice(4 + len)
      onMessage(msg)
    }
  }
}

async function main () {
  const { mode, port, flags } = parseArgs(process.argv.slice(2))
  if ((mode !== 'server' && mode !== 'client') || !Number.isFinite(port)) {
    console.error('usage: node src/tcp-interop.js server|client <port> [--initiator] [--sid s]')
    process.exit(2)
  }
  const initiator = flags.has('initiator')
  const sid = flags.get('sid') || 'live-interop-session'
  const verbose = flags.has('verbose')
  const role = initiator ? 'initiator' : 'responder'

  const secretKey = x25519.utils.randomSecretKey()
  const staticKeyPair = { secretKey, publicKey: x25519.getPublicKey(secretKey) }

  const noise = new NoiseXX({
    initiator,
    staticKeyPair,
    suite: BLAKE2S,
    prologue: prologueForSession(sid)
  })

  let sock = null
  let step = 0
  let done = false
  let handshakeFailed = false
  let failureReason = null
  let handshakeMicros = 0
  let bytesSent = 0
  let bytesReceived = 0
  let transportOk = false
  let tamperRejected = false
  let postTamperOk = false
  let peerHash = null
  let peerSas = null
  let selfSas = null
  let t0 = process.hrtime.bigint()

  const sas = () => {
    if (!noise.handshakeHash || !noise.rs) return null
    return initiator
      ? deriveSas(noise.handshakeHash, staticKeyPair.publicKey, noise.rs)
      : deriveSas(noise.handshakeHash, noise.rs, staticKeyPair.publicKey)
  }

  const send = (buf) => {
    const f = frame(buf)
    bytesSent += f.length
    sock.write(Buffer.from(f))
  }

  const sendSelfInfo = () => {
    selfSas = sas()
    send(noise.tx.encrypt(utf8(JSON.stringify({
      handshakeHash: toHex(noise.handshakeHash),
      sas: selfSas,
      role,
      staticPublicKey: toHex(staticKeyPair.publicKey)
    }))))
  }

  function finish (ok) {
    if (done) return
    done = true
    const result = {
      side: 'node',
      role,
      sid,
      suite: BLAKE2S.name,
      ok: ok && !handshakeFailed,
      handshakeFailed,
      failureReason,
      handshakeMicros: Math.round(handshakeMicros),
      handshakeHash: noise.handshakeHash ? toHex(noise.handshakeHash) : null,
      sas: selfSas,
      peerSas,
      peerHandshakeHash: peerHash,
      sasMatchesPeer: !!(peerSas && selfSas && peerSas === selfSas),
      hashMatchesPeer: !!(peerHash && noise.handshakeHash && peerHash === toHex(noise.handshakeHash)),
      transportOk,
      tamperRejected,
      postTamperOk,
      bytesSent,
      bytesReceived
    }
    console.log('DSH_INTEROP_RESULT ' + JSON.stringify(result))
    if (verbose) console.error('[node/' + role + '] ' + JSON.stringify(result))
    if (sock) sock.destroy()
    setTimeout(() => process.exit(ok ? 0 : 1), 30)
  }

  const fail = (err) => {
    if (done) return
    handshakeFailed = true
    failureReason = String(err && err.message ? err.message : err)
    finish(false)
  }

  function onMessage (msg) {
    if (done) return
    try {
      if (!noise.complete) return onHandshake(msg)
      return onTransport(msg)
    } catch (err) {
      fail(err)
    }
  }

  function onHandshake (msg) {
    if (initiator) {
      if (step === 1) {
        noise.readMessage(msg)
        send(noise.writeMessage(utf8('initiator-msg3')))
        step = 2
        handshakeMicros = Number(process.hrtime.bigint() - t0) / 1000
        sendSelfInfo()
        send(noise.tx.encrypt(utf8('i->r payload #2')))
      } else {
        throw new Error('unexpected handshake message at step ' + step)
      }
    } else {
      if (step === 0) {
        noise.readMessage(msg)
        send(noise.writeMessage(utf8('responder-msg2')))
        step = 1
      } else if (step === 1) {
        noise.readMessage(msg)
        step = 2
        handshakeMicros = Number(process.hrtime.bigint() - t0) / 1000
      } else {
        throw new Error('unexpected handshake message at step ' + step)
      }
    }
  }

  let rxIndex = 0
  function onTransport (msg) {
    if (initiator) {
      if (rxIndex === 0) {
        const info = JSON.parse(bytesToUtf8(noise.rx.decrypt(msg)))
        peerHash = info.handshakeHash; peerSas = info.sas; rxIndex = 1
      } else if (rxIndex === 1) {
        transportOk = bytesToUtf8(noise.rx.decrypt(msg)) === 'r->i payload #2'
        rxIndex = 2
        // Tamper probe: a corrupted copy of the next genuine ciphertext is put
        // on the wire first, then the untouched ciphertext itself. The
        // responder must reject the corrupted copy (without advancing its
        // receive nonce) and then successfully open the genuine one.
        const good = noise.tx.encrypt(utf8('i->r payload #3'))
        const bad = Uint8Array.from(good)
        bad[2] ^= 0x01
        send(bad)
        send(good)
      } else if (rxIndex === 2) {
        postTamperOk = bytesToUtf8(noise.rx.decrypt(msg)) === 'r->i payload #3'
        rxIndex = 3
        finish(transportOk && postTamperOk && peerSas === selfSas)
      }
    } else {
      if (rxIndex === 0) {
        const info = JSON.parse(bytesToUtf8(noise.rx.decrypt(msg)))
        peerHash = info.handshakeHash; peerSas = info.sas; rxIndex = 1
        sendSelfInfo()
        send(noise.tx.encrypt(utf8('r->i payload #2')))
      } else if (rxIndex === 1) {
        transportOk = bytesToUtf8(noise.rx.decrypt(msg)) === 'i->r payload #2'
        rxIndex = 2
      } else if (rxIndex === 2) {
        // Tamper probe first (must fail and must not advance the nonce).
        try {
          noise.rx.decrypt(msg)
          throw new Error('tampered ciphertext was accepted')
        } catch (err) {
          const text = String(err && err.message ? err.message : err)
          if (text === 'tampered ciphertext was accepted') throw err
          tamperRejected = true
        }
        rxIndex = 3
      } else if (rxIndex === 3) {
        postTamperOk = bytesToUtf8(noise.rx.decrypt(msg)) === 'i->r payload #3'
        rxIndex = 4
        send(noise.tx.encrypt(utf8('r->i payload #3')))
        finish(transportOk && tamperRejected && postTamperOk && peerSas === selfSas)
      }
    }
  }

  function attach (socket) {
    sock = socket
    t0 = process.hrtime.bigint() // measure from connection, not from process start
    const reader = makeReader(onMessage)
    socket.on('data', (chunk) => {
      bytesReceived += chunk.length
      reader(new Uint8Array(chunk))
    })
    socket.on('error', (err) => fail(err))
    socket.on('close', () => {
      if (!done) {
        handshakeFailed = true
        failureReason = failureReason || 'peer closed the connection'
        finish(false)
      }
    })
    if (initiator) {
      send(noise.writeMessage(utf8('')))
      step = 1
    }
  }

  if (mode === 'server') {
    const server = net.createServer((socket) => { attach(socket) })
    server.listen(port, '127.0.0.1', () => {
      console.error(`DSH_LISTENING ${port} ${role}`)
      if (verbose) console.error(`[node] listening on 127.0.0.1:${port} as ${role}`)
    })
    setTimeout(() => fail(new Error('timeout waiting for the peer')), 20000)
  } else {
    const socket = net.createConnection({ host: '127.0.0.1', port }, () => attach(socket))
    socket.on('error', (err) => fail(err))
    setTimeout(() => fail(new Error('timeout')), 20000)
  }
}

main()
