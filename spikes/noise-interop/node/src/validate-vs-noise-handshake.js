// Cross-implementation validation of the hand-written XX pattern driver.
//
// Problem: no Node library implements BLAKE2s, so we cannot byte-compare our
// Noise_XX_..._BLAKE2s driver against a third party directly.
//
// Solution: drive BOTH implementations with the BLAKE2b cipher set (which
// `noise-handshake@4.2.0` does natively) and fixed ephemeral keys. The pattern
// driver, DH ordering, token ordering, HKDF shape, AEAD nonce encoding and
// split() are all hash-agnostic; only HASHLEN/BLOCKLEN and the hash function
// change between the BLAKE2b and BLAKE2s runs. So if our driver and
// `noise-handshake` agree byte-for-byte on BLAKE2b, the driver is correct for
// BLAKE2s too.
//
// It also cross-checks the @noble primitives against libsodium (the primitives
// `noise-handshake` uses), so a primitive-level difference cannot hide a
// driver-level difference.

import { createRequire } from 'node:module'
import { x25519 } from '@noble/curves/ed25519.js'
import { blake2b } from '@noble/hashes/blake2.js'
import { hmac } from '@noble/hashes/hmac.js'

import { toHex, equalBytes, utf8 } from './bytes.js'
import { NoiseXX, prologueForSession, hkdf } from './noise-xx.js'
import { BLAKE2S, BLAKE2B, aeadEncrypt } from './primitives.js'

const require = createRequire(import.meta.url)
const Noise = require('noise-handshake')
const sodiumDh = require('noise-handshake/dh')
const sodium = require('sodium-universal')
const b4a = require('b4a')

let failures = 0
function check (name, ok, detail = '') {
  if (!ok) failures++
  console.log(`  [${ok ? 'ok  ' : 'FAIL'}] ${name}${detail ? ' :: ' + detail : ''}`)
}

console.log('noise-interop :: validate-vs-noise-handshake')
console.log('  noise-handshake default curve ALG =', sodiumDh.ALG, '(X25519 via crypto_scalarmult)')

// ---------------------------------------------------------------------------
// 1. primitive-level cross-check: @noble vs libsodium
// ---------------------------------------------------------------------------
console.log('\n[1] primitive cross-check: @noble vs libsodium')

const seedA = Uint8Array.from({ length: 32 }, (_, i) => (i * 7 + 3) & 0xff)
const seedB = Uint8Array.from({ length: 32 }, (_, i) => (i * 11 + 5) & 0xff)

const noblePub = x25519.getPublicKey(seedA)
const sodiumPub = b4a.alloc(32)
sodium.crypto_scalarmult_base(sodiumPub, seedA)
check('X25519 public key derivation (noble == libsodium)', equalBytes(noblePub, new Uint8Array(sodiumPub)))

const nobleSs = x25519.getSharedSecret(seedA, noblePub)
const sodiumSs = b4a.alloc(32)
sodium.crypto_scalarmult(sodiumSs, seedA, noblePub)
check('X25519 shared secret (noble == libsodium)', equalBytes(nobleSs, new Uint8Array(sodiumSs)))

const msg = utf8('the quick brown fox jumps over the lazy dog')
const nobleB2b = blake2b(msg, { dkLen: 64 })
const sodiumB2b = b4a.alloc(64)
sodium.crypto_generichash(sodiumB2b, msg)
check('BLAKE2b-512 (noble == libsodium crypto_generichash)',
  equalBytes(nobleB2b, new Uint8Array(sodiumB2b)), toHex(nobleB2b).slice(0, 32) + '...')

const nobleHmac = hmac(blake2b, seedA, msg, { dkLen: 64 })
const sodiumHmac = b4a.alloc(64)
require('noise-handshake/hmac')(sodiumHmac, [msg], seedA)
check('HMAC-BLAKE2b-512 (noble == noise-handshake/hmac)', equalBytes(nobleHmac, new Uint8Array(sodiumHmac)))

const nobleHkdf = hkdf(BLAKE2B, seedA, seedB, 2)
const refHkdf = require('noise-handshake/hkdf').hkdf(seedA, seedB)
check('HKDF-BLAKE2b (noble == noise-handshake/hkdf)',
  equalBytes(nobleHkdf[0], new Uint8Array(refHkdf[0])) && equalBytes(nobleHkdf[1], new Uint8Array(refHkdf[1])))

// ChaCha20-Poly1305: @noble vs libsodium, including the Noise nonce encoding.
const ad = utf8('associated-data')
const pt = utf8('plaintext-for-aead')
const nobleAead = aeadEncrypt(seedA, 1, ad, pt)
const sodiumNonce = b4a.alloc(12)
new DataView(sodiumNonce.buffer, sodiumNonce.byteOffset, 12).setBigUint64(4, 1n, true)
const sodiumAead = b4a.alloc(pt.length + 16)
sodium.crypto_aead_chacha20poly1305_ietf_encrypt(sodiumAead, pt, ad, null, sodiumNonce, seedA)
check('ChaCha20-Poly1305 IETF w/ Noise nonce (noble == libsodium)',
  equalBytes(nobleAead, new Uint8Array(sodiumAead)), toHex(nobleAead))

// ---------------------------------------------------------------------------
// 2. full XX handshake, fixed keys, BLAKE2b: our driver vs noise-handshake
// ---------------------------------------------------------------------------
console.log('\n[2] full XX handshake, BLAKE2b cipher set, fixed ephemerals')

const iStatic = { secretKey: Uint8Array.from({ length: 32 }, (_, i) => (i * 13 + 1) & 0xff) }
const rStatic = { secretKey: Uint8Array.from({ length: 32 }, (_, i) => (i * 17 + 2) & 0xff) }
iStatic.publicKey = x25519.getPublicKey(iStatic.secretKey)
rStatic.publicKey = x25519.getPublicKey(rStatic.secretKey)

const iEph = { secretKey: Uint8Array.from({ length: 32 }, (_, i) => (i * 19 + 7) & 0xff) }
const rEph = { secretKey: Uint8Array.from({ length: 32 }, (_, i) => (i * 23 + 9) & 0xff) }
iEph.publicKey = x25519.getPublicKey(iEph.secretKey)
rEph.publicKey = x25519.getPublicKey(rEph.secretKey)

const prologue = prologueForSession('val-session-0001')
const p1 = utf8('')
const p2 = utf8('responder-msg2-payload')
const p3 = utf8('initiator-msg3-payload')

// --- our driver ---
const mineI = new NoiseXX({ initiator: true, staticKeyPair: iStatic, suite: BLAKE2B, prologue, ephemeralKeyPair: iEph })
const mineR = new NoiseXX({ initiator: false, staticKeyPair: rStatic, suite: BLAKE2B, prologue, ephemeralKeyPair: rEph })

const mineM1 = mineI.writeMessage(p1)
const mineP2 = mineR.readMessage(mineM1)
const mineM2 = mineR.writeMessage(p2)
const mineP3 = mineI.readMessage(mineM2)
const mineM3 = mineI.writeMessage(p3)
const mineP4 = mineR.readMessage(mineM3)

// --- noise-handshake ---
function fixedCurve (eph) {
  return {
    ...sodiumDh,
    generateKeyPair: () => ({ secretKey: b4a.from(eph.secretKey), publicKey: b4a.from(eph.publicKey) })
  }
}

const refI = new Noise('XX', true, { secretKey: b4a.from(iStatic.secretKey), publicKey: b4a.from(iStatic.publicKey) }, { curve: fixedCurve(iEph) })
const refR = new Noise('XX', false, { secretKey: b4a.from(rStatic.secretKey), publicKey: b4a.from(rStatic.publicKey) }, { curve: fixedCurve(rEph) })
refI.initialise(b4a.from(prologue))
refR.initialise(b4a.from(prologue))

// NOTE: copy every reference message immediately. `noise-handshake` keeps
// `this.re` as a *subarray view* into the received buffer and `_clear()` (called
// from final()) does `this.re.fill(0)`. That silently zeroes the first 32 bytes
// of the caller's msg1/msg2 buffer once the handshake completes. Do not compare
// the reference's own buffers after the handshake has finished.
const refM1 = Uint8Array.from(refI.send(b4a.from(p1)))
const refP2 = Uint8Array.from(refR.recv(b4a.from(refM1)))
const refM2 = Uint8Array.from(refR.send(b4a.from(p2)))
const refP3 = Uint8Array.from(refI.recv(b4a.from(refM2)))
const refM3 = Uint8Array.from(refI.send(b4a.from(p3)))
const refP4 = Uint8Array.from(refR.recv(b4a.from(refM3)))

// noise-handshake's final() exposes tx/rx as raw 32-byte keys (not CipherStates)
const refTx = Uint8Array.from(refI.tx)
const refRx = Uint8Array.from(refI.rx)
const refTxR = Uint8Array.from(refR.tx)
const refRxR = Uint8Array.from(refR.rx)

check('message 1 bytes', equalBytes(mineM1, refM1), toHex(mineM1))
check('message 2 bytes', equalBytes(mineM2, refM2), toHex(mineM2))
check('message 3 bytes', equalBytes(mineM3, refM3), toHex(mineM3))
check('payloads delivered (2/3/4)', equalBytes(mineP2, p1) && equalBytes(mineP3, p2) && equalBytes(mineP4, p3))
check('payloads delivered (reference)', equalBytes(refP2, p1) && equalBytes(refP3, p2) && equalBytes(refP4, p3))

check('handshake hash equal (initiator)', equalBytes(mineI.handshakeHash, new Uint8Array(refI.hash)), toHex(mineI.handshakeHash))
check('handshake hash equal (responder)', equalBytes(mineR.handshakeHash, new Uint8Array(refR.hash)))
check('transport key tx (initiator) equal', equalBytes(mineI.tx.k, refTx))
check('transport key rx (initiator) equal', equalBytes(mineI.rx.k, refRx))
check('initiator tx == responder rx', equalBytes(mineI.tx.k, mineR.rx.k) && equalBytes(refTx, refRxR))
check('initiator rx == responder tx', equalBytes(mineI.rx.k, mineR.tx.k) && equalBytes(refRx, refTxR))

const tp = utf8('transport-message-01')
const mineCt = mineI.tx.encrypt(tp)
const aead = await import('@noble/ciphers/chacha.js')
const refCt = aead.chacha20poly1305(refTx, new Uint8Array(12), new Uint8Array(0)).encrypt(tp)
check('transport ciphertext (nonce 0) equal', equalBytes(mineCt, refCt), toHex(mineCt))
check('transport decrypt of reference ciphertext', equalBytes(mineR.rx.decrypt(refCt), tp))
check('transport decrypt of our ciphertext (independent primitive)', equalBytes(aead.chacha20poly1305(refRxR, new Uint8Array(12), new Uint8Array(0)).decrypt(mineCt), tp))

// ---------------------------------------------------------------------------
// 3. confirm the BLAKE2s suite we actually ship uses the same code path
// ---------------------------------------------------------------------------
console.log('\n[3] BLAKE2s suite sanity (the suite we actually ship)')
const sI = new NoiseXX({ initiator: true, staticKeyPair: iStatic, suite: BLAKE2S, prologue, ephemeralKeyPair: iEph })
const sR = new NoiseXX({ initiator: false, staticKeyPair: rStatic, suite: BLAKE2S, prologue, ephemeralKeyPair: rEph })
const sm1 = sI.writeMessage(new Uint8Array(0))
sR.readMessage(sm1)
const sm2 = sR.writeMessage(utf8('r'))
sI.readMessage(sm2)
const sm3 = sI.writeMessage(utf8('i'))
sR.readMessage(sm3)
check('BLAKE2s handshake completes', sI.complete && sR.complete)
check('BLAKE2s handshake hashes agree', equalBytes(sI.handshakeHash, sR.handshakeHash), toHex(sI.handshakeHash))
check('BLAKE2s handshake hash differs from the BLAKE2b run', !equalBytes(sI.handshakeHash, mineI.handshakeHash))
check('BLAKE2s msg1 length = 32 (e only, empty payload)', sm1.length === 32, `len=${sm1.length}`)
check('BLAKE2s msg2 length = 32 + 48 + 1 + 16', sm2.length === 32 + 48 + 1 + 16, `len=${sm2.length}`)
check('BLAKE2s msg3 length = 48 + 1 + 16', sm3.length === 48 + 1 + 16, `len=${sm3.length}`)

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`)
process.exit(failures === 0 ? 0 : 1)
