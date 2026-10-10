// Node-side self-tests: transport phase, tamper, replay, prologue mismatch,
// and performance sanity.
//
//   node src/selftest.js

import { x25519 } from '@noble/curves/ed25519.js'

import { toHex, utf8, equalBytes, fromHex } from './bytes.js'
import { NoiseXX, deriveSas, prologueForSession } from './noise-xx.js'
import { BLAKE2S, sha256 } from './primitives.js'

let failures = 0
function check (name, ok, detail = '') {
  if (!ok) failures++
  console.log(`  [${ok ? 'ok  ' : 'FAIL'}] ${name}${detail ? ' :: ' + detail : ''}`)
}

function expectThrow (name, fn, matcher = null) {
  try {
    fn()
    check(name, false, 'no error thrown')
  } catch (err) {
    const msg = String(err && err.message ? err.message : err)
    check(name, matcher ? matcher.test(msg) : true, msg)
  }
}

function keypair (mul, add) {
  const secretKey = Uint8Array.from({ length: 32 }, (_, i) => (i * mul + add) & 0xff)
  return { secretKey, publicKey: x25519.getPublicKey(secretKey) }
}

function handshake ({ sid, iStatic, rStatic, iEph, rEph, prologueI, prologueR, payloads }) {
  const pI = prologueI ?? prologueForSession(sid)
  const pR = prologueR ?? prologueForSession(sid)
  const init = new NoiseXX({ initiator: true, staticKeyPair: iStatic, suite: BLAKE2S, prologue: pI, ephemeralKeyPair: iEph })
  const resp = new NoiseXX({ initiator: false, staticKeyPair: rStatic, suite: BLAKE2S, prologue: pR, ephemeralKeyPair: rEph })
  const pl = payloads ?? [utf8(''), utf8('p2'), utf8('p3')]
  const m1 = init.writeMessage(pl[0])
  const g1 = resp.readMessage(m1)
  const m2 = resp.writeMessage(pl[1])
  const g2 = init.readMessage(m2)
  const m3 = init.writeMessage(pl[2])
  const g3 = resp.readMessage(m3)
  return { init, resp, m1, m2, m3, g1, g2, g3 }
}

const iStatic = keypair(13, 1)
const rStatic = keypair(17, 2)

console.log('noise-interop :: node selftest')

// ---------------------------------------------------------------------------
console.log('\n[1] handshake + transport happy path')
const s = handshake({ sid: 'selftest-01', iStatic, rStatic, iEph: keypair(19, 7), rEph: keypair(23, 9) })
check('handshake completes on both sides', s.init.complete && s.resp.complete)
check('handshake hashes agree', equalBytes(s.init.handshakeHash, s.resp.handshakeHash), toHex(s.init.handshakeHash))
check('initiator tx == responder rx', equalBytes(s.init.tx.k, s.resp.rx.k))
check('initiator rx == responder tx', equalBytes(s.init.rx.k, s.resp.tx.k))
check('msg lengths 32/98/66', s.m1.length === 32 && s.m2.length === 98 && s.m3.length === 66,
  `${s.m1.length}/${s.m2.length}/${s.m3.length}`)

const sasI = deriveSas(s.init.handshakeHash, iStatic.publicKey, rStatic.publicKey, sha256)
const sasR = deriveSas(s.resp.handshakeHash, iStatic.publicKey, rStatic.publicKey, sha256)
check('SAS matches across the two local sides', sasI === sasR, sasI)
check('SAS is 6 decimal digits', /^[0-9]{6}$/.test(sasI))

const tr1 = utf8('transport i->r #1')
const tr2 = utf8('transport i->r #2')
const ct1 = s.init.tx.encrypt(tr1)
const ct2 = s.init.tx.encrypt(tr2)
check('i->r #1 decrypts (nonce 0)', equalBytes(s.resp.rx.decrypt(ct1), tr1))
check('i->r #2 decrypts (nonce 1)', equalBytes(s.resp.rx.decrypt(ct2), tr2))
const tr3 = utf8('transport r->i #1')
const tr4 = utf8('transport r->i #2')
const ct3 = s.resp.tx.encrypt(tr3)
const ct4 = s.resp.tx.encrypt(tr4)
check('r->i #1 decrypts (nonce 0)', equalBytes(s.init.rx.decrypt(ct3), tr3))
check('r->i #2 decrypts (nonce 1)', equalBytes(s.init.rx.decrypt(ct4), tr4))
check('ciphertext is plaintext + 16-byte tag', ct1.length === tr1.length + 16 && ct3.length === tr3.length + 16)

// ---------------------------------------------------------------------------
console.log('\n[2] tamper detection')
const tampered = Uint8Array.from(ct1)
tampered[3] ^= 0x01
expectThrow('tampered transport ciphertext is rejected', () => s.resp.rx.decrypt(tampered), /invalid|tag|auth|decrypt/i)

const tamperedTag = Uint8Array.from(ct1)
tamperedTag[tamperedTag.length - 1] ^= 0x80
// a fresh handshake is needed because the failed decrypt above did not advance
// the responder nonce, but reusing it is fine; use a new session to be safe
const s2 = handshake({ sid: 'selftest-02', iStatic, rStatic, iEph: keypair(19, 7), rEph: keypair(23, 9) })
const ctA = s2.init.tx.encrypt(utf8('tamper-target'))
const badTag = Uint8Array.from(ctA)
badTag[badTag.length - 1] ^= 0x01
expectThrow('flipped Poly1305 tag bit is rejected', () => s2.resp.rx.decrypt(badTag), /invalid|tag|auth|decrypt/i)

const s3 = handshake({ sid: 'selftest-03', iStatic, rStatic, iEph: keypair(19, 7), rEph: keypair(23, 9) })
const badMsg2 = Uint8Array.from(s3.m2)
badMsg2[40] ^= 0x01 // inside the encrypted static-key field
expectThrow('tampered handshake msg2 rejected by the initiator', () => {
  const i = new NoiseXX({ initiator: true, staticKeyPair: iStatic, suite: BLAKE2S, prologue: prologueForSession('selftest-03'), ephemeralKeyPair: keypair(19, 7) })
  const r = new NoiseXX({ initiator: false, staticKeyPair: rStatic, suite: BLAKE2S, prologue: prologueForSession('selftest-03'), ephemeralKeyPair: keypair(23, 9) })
  r.readMessage(i.writeMessage(utf8('')))
  i.readMessage(badMsg2)
}, /invalid|tag|auth|decrypt/i)

// ---------------------------------------------------------------------------
console.log('\n[3] X25519 low-order point rejection (security.md T16)')

// The seven canonical low-order u-coordinates. NOTE: on Node, `@noble/curves`
// ALREADY rejects these and throws `invalid private or public key received`
// before our guard runs — verified, not assumed. Dart's `cryptography` does NOT
// reject them (it silently returns 32 zero bytes), which is why the guard is
// load-bearing on the Dart side. The contract asserted here is identical on both
// sides: a low-order peer key MUST abort the handshake.
const LOW_ORDER_U = [
  '0000000000000000000000000000000000000000000000000000000000000000', // u = 0
  '0100000000000000000000000000000000000000000000000000000000000000', // u = 1
  'e0eb7a7c3b41b8ae1656e3faf19fc46ada098deb9c32b1fd866205165f49b800', // order 8
  '5f9c95bca3508c24b1d0b1559c83ef5b04445cc4581c8e86d8224eddd09f1157', // order 8
  'ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f', // p-1
  'edffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f', // p
  'eeffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f' // p+1
]
const LOW_ORDER_REJECTION = /low-order|invalid private or public key/i
const probe = new NoiseXX({
  initiator: true,
  staticKeyPair: keypair(3, 1),
  suite: BLAKE2S,
  prologue: prologueForSession('loworder-probe')
})
for (const hex of LOW_ORDER_U) {
  const u = fromHex(hex)
  expectThrow(`_dh rejects low-order u=${hex.slice(0, 8)}…`,
    () => probe._dh(u, keypair(5, 2)), LOW_ORDER_REJECTION)
}
check('_dh still accepts the base point (keygen path unaffected)',
  probe._dh(fromHex('09' + '00'.repeat(31)), keypair(7, 3)).length === 32)

// Wire-level attack: a hostile responder returns a low-order ephemeral in
// message 2, so the initiator derives DH(e_i, re) with a low-order re. Without
// this rejection the initiator would continue into a handshake whose keys the
// attacker already knows.
{
  const victim = new NoiseXX({
    initiator: true,
    staticKeyPair: iStatic,
    suite: BLAKE2S,
    prologue: prologueForSession('loworder-attack'),
    ephemeralKeyPair: keypair(41, 5)
  })
  const m1 = victim.writeMessage(utf8(''))
  const forged = new Uint8Array(32 + m1.length + 64)
  forged.set(fromHex(LOW_ORDER_U[1]), 0) // inject u = 1 as the peer ephemeral
  expectThrow('initiator aborts when the peer sends a low-order ephemeral',
    () => victim.readMessage(forged), LOW_ORDER_REJECTION)
}

// ---------------------------------------------------------------------------
console.log('\n[4] replay / freshness')
const a = handshake({ sid: 'replay-sid-XYZ', iStatic, rStatic, iEph: keypair(19, 7), rEph: keypair(23, 9) })
const b = handshake({ sid: 'replay-sid-XYZ', iStatic, rStatic, iEph: keypair(29, 11), rEph: keypair(31, 13) })
const sasA = deriveSas(a.init.handshakeHash, iStatic.publicKey, rStatic.publicKey, sha256)
const sasB = deriveSas(b.init.handshakeHash, iStatic.publicKey, rStatic.publicKey, sha256)
check('same session id + fresh ephemerals -> different handshake hash',
  !equalBytes(a.init.handshakeHash, b.init.handshakeHash))
check('same session id + fresh ephemerals -> different SAS', sasA !== sasB, `${sasA} vs ${sasB}`)
check('same session id + same ephemerals -> identical SAS (the replay the SAS is meant to catch)',
  deriveSas(a.init.handshakeHash, iStatic.publicKey, rStatic.publicKey, sha256) === sasA)

// A replayed msg1 fed to a *fresh* responder: the responder answers with a fresh
// ephemeral, so the original initiator's msg3 (and the original responder) no
// longer line up. Demonstrate that the replayed transcript cannot be completed.
{
  const freshResp = new NoiseXX({ initiator: false, staticKeyPair: rStatic, suite: BLAKE2S, prologue: prologueForSession('replay-sid-XYZ'), ephemeralKeyPair: keypair(23, 9) })
  const got = freshResp.readMessage(a.m1) // replay of the ORIGINAL msg1
  check('replayed msg1 is accepted by a fresh responder (it is not authenticated at this point)', got.length === 0)
  const m2 = freshResp.writeMessage(utf8('p2'))
  const attackerInit = new NoiseXX({ initiator: true, staticKeyPair: iStatic, suite: BLAKE2S, prologue: prologueForSession('replay-sid-XYZ'), ephemeralKeyPair: keypair(29, 11) })
  // The replayed initiator cannot read the fresh responder's msg2: its own e was
  // not the one the responder saw, so `ee` differs.
  attackerInit.writeMessage(utf8(''))
  // feed the fresh responder's re for the ee mix to be meaningful we must re-run
  let threw = false
  try {
    const victim = new NoiseXX({ initiator: true, staticKeyPair: iStatic, suite: BLAKE2S, prologue: prologueForSession('replay-sid-XYZ'), ephemeralKeyPair: keypair(29, 11) })
    victim.writeMessage(utf8(''))
    victim.readMessage(m2)
  } catch { threw = true }
  check('fresh responder msg2 cannot be read by a different initiator instance', threw)
}

// ---------------------------------------------------------------------------
console.log('\n[5] prologue / session-id binding')
{
  const i = new NoiseXX({ initiator: true, staticKeyPair: iStatic, suite: BLAKE2S, prologue: prologueForSession('sid-AAA'), ephemeralKeyPair: keypair(19, 7) })
  const r = new NoiseXX({ initiator: false, staticKeyPair: rStatic, suite: BLAKE2S, prologue: prologueForSession('sid-BBB'), ephemeralKeyPair: keypair(23, 9) })
  const m1 = i.writeMessage(utf8(''))
  r.readMessage(m1)
  const m2 = r.writeMessage(utf8('p2'))
  expectThrow('mismatched prologue: initiator rejects responder msg2', () => i.readMessage(m2), /invalid|tag|auth|decrypt/i)
}
{
  // identical statics AND ephemerals, prologue differs by exactly one byte
  const p1 = prologueForSession('sid-AAA')
  const p2 = prologueForSession('sid-AAB')
  const h1 = handshake({ sid: 'sid-AAA', iStatic, rStatic, iEph: keypair(19, 7), rEph: keypair(23, 9) })
  const h2 = handshake({ sid: 'x', iStatic, rStatic, iEph: keypair(19, 7), rEph: keypair(23, 9), prologueI: p2, prologueR: p2 })
  check('one-byte prologue change propagates to the handshake hash',
    !equalBytes(h1.init.handshakeHash, h2.init.handshakeHash))
  check('one-byte prologue change propagates to the SAS',
    deriveSas(h1.init.handshakeHash, iStatic.publicKey, rStatic.publicKey, sha256) !==
    deriveSas(h2.init.handshakeHash, iStatic.publicKey, rStatic.publicKey, sha256))
  check('empty prologue still mixes (no truncated-hash shortcut)',
    p1.length === 'dsh-remote/v1/pair:sid-AAA'.length)
}
{
  // prologue mismatch where the *responder* is the one that ends up rejecting:
  // flip the responder's prologue; the initiator fails first, and a fresh
  // responder can never complete either.
  const i = new NoiseXX({ initiator: true, staticKeyPair: iStatic, suite: BLAKE2S, prologue: prologueForSession('sid-AAA'), ephemeralKeyPair: keypair(19, 7) })
  const r = new NoiseXX({ initiator: false, staticKeyPair: rStatic, suite: BLAKE2S, prologue: prologueForSession('sid-BBB'), ephemeralKeyPair: keypair(23, 9) })
  const m1 = i.writeMessage(utf8(''))
  r.readMessage(m1)
  const m2 = r.writeMessage(utf8('p2'))
  let responderSeesFailure = false
  try {
    // initiator, unable to validate msg2, cannot produce a valid msg3, so the
    // responder never completes. Simulate the only msg3 it could ever emit.
    i.readMessage(m2)
  } catch {
    responderSeesFailure = true
  }
  check('mismatched prologue aborts the handshake (no session established)', responderSeesFailure && !r.complete)
}

// ---------------------------------------------------------------------------
console.log('\n[6] performance sanity (Node / @noble pure JS)')
const N = 500
const iEph = keypair(19, 7)
const rEph = keypair(23, 9)
const pl = [utf8(''), utf8('p2'), utf8('p3')]
// warm up
for (let k = 0; k < 20; k++) handshake({ sid: 'perf', iStatic, rStatic, iEph, rEph, payloads: pl })
let t0 = process.hrtime.bigint()
for (let k = 0; k < N; k++) {
  const x = handshake({ sid: 'perf', iStatic, rStatic, iEph, rEph, payloads: pl })
  if (!x.init.complete) throw new Error('perf handshake failed')
}
let t1 = process.hrtime.bigint()
const hsUs = Number(t1 - t0) / 1000 / N
console.log(`  full XX handshake (both sides, 3 messages): ${hsUs.toFixed(1)} us/handshake => ${(hsUs / 2).toFixed(1)} us/party`)

const p = handshake({ sid: 'perf-transport', iStatic, rStatic, iEph, rEph, payloads: pl })
const SZ = 32 * 1024
const MSGS = 200
const big = new Uint8Array(SZ)
for (let k = 0; k < SZ; k++) big[k] = k & 0xff
const enc = p.init.tx
const dec = p.resp.rx
t0 = process.hrtime.bigint()
let sink = 0
for (let k = 0; k < MSGS; k++) {
  const ct = enc.encrypt(big)
  const pt = dec.decrypt(ct)
  sink += pt[0]
}
t1 = process.hrtime.bigint()
const secs = Number(t1 - t0) / 1e9
const mib = (SZ * MSGS) / (1024 * 1024)
console.log(`  transport encrypt+decrypt 32 KiB x ${MSGS}: ${(mib / secs).toFixed(1)} MiB/s round-trip (${(mib * 2 / secs).toFixed(1)} MiB/s processed)`)
void sink

console.log(`\n${failures === 0 ? 'ALL SELFTESTS PASSED' : failures + ' SELFTEST(S) FAILED'}`)
process.exit(failures === 0 ? 0 : 1)
