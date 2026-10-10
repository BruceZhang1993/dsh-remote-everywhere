// Emits the deterministic cross-language test-vector file.
//
//   node src/emit-vectors.js [outPath]
//
// Default out path: ../vectors/xx25519-chachapoly-blake2s.json
//
// Everything is fixed: static keys, both ephemeral keys, all three payloads.
// The Dart test consumes this file and must reproduce every byte.

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { toHex, utf8, concat, equalBytes } from './bytes.js'
import { NoiseXX, deriveSas, prologueForSession } from './noise-xx.js'
import { BLAKE2S, sha256 } from './primitives.js'

const here = dirname(fileURLToPath(import.meta.url))
const outPath = process.argv[2] || `${here}/../../vectors/xx25519-chachapoly-blake2s.json`

// Deterministic pseudo-key material. Real devices use CSPRNG keys; these are
// only test vectors and are obviously not secret.
function detKey (mul, add) {
  const secretKey = Uint8Array.from({ length: 32 }, (_, i) => (i * mul + add) & 0xff)
  return { secretKey, publicKey: BLAKE2S.generateKeyPair(secretKey).publicKey }
}

const initiatorStatic = detKey(13, 1)
const responderStatic = detKey(17, 2)

function runSession ({ sid, label, iEph, rEph, prologueOverrideI, prologueOverrideR }) {
  const prologue = prologueForSession(sid)
  const payloads = [
    utf8(''),
    utf8('responder-msg2-payload'),
    utf8('initiator-msg3-payload')
  ]

  const init = new NoiseXX({
    initiator: true,
    staticKeyPair: initiatorStatic,
    suite: BLAKE2S,
    prologue: prologueOverrideI ?? prologue,
    ephemeralKeyPair: iEph,
    trace: true
  })
  const resp = new NoiseXX({
    initiator: false,
    staticKeyPair: responderStatic,
    suite: BLAKE2S,
    prologue: prologueOverrideR ?? prologue,
    ephemeralKeyPair: rEph,
    trace: true
  })

  const msg1 = init.writeMessage(payloads[0])
  const got1 = resp.readMessage(msg1)
  const msg2 = resp.writeMessage(payloads[1])
  const got2 = init.readMessage(msg2)
  const msg3 = init.writeMessage(payloads[2])
  const got3 = resp.readMessage(msg3)

  if (!equalBytes(got1, payloads[0]) || !equalBytes(got2, payloads[1]) || !equalBytes(got3, payloads[2])) {
    throw new Error('payload round-trip failed in session ' + label)
  }
  if (!equalBytes(init.handshakeHash, resp.handshakeHash)) {
    throw new Error('handshake hash mismatch in session ' + label)
  }

  // Transport phase: two messages in each direction, nonces 0 and 1.
  const i2r = []
  const r2i = []
  for (let i = 0; i < 2; i++) {
    const pt = utf8(`i->r message #${i + 1} ` + 'x'.repeat(48))
    i2r.push({ nonce: init.tx.n, plaintext: toHex(pt), ciphertext: toHex(init.tx.encrypt(pt)) })
  }
  for (let i = 0; i < 2; i++) {
    const pt = utf8(`r->i message #${i + 1} ` + 'y'.repeat(48))
    r2i.push({ nonce: resp.tx.n, plaintext: toHex(pt), ciphertext: toHex(resp.tx.encrypt(pt)) })
  }
  // Cross-decrypt to prove the direction keys line up.
  for (const rec of i2r) {
    const got = resp.rx.decrypt(Uint8Array.from(Buffer.from(rec.ciphertext, 'hex')))
    if (toHex(got) !== rec.plaintext) throw new Error('i->r transport decrypt failed')
  }
  for (const rec of r2i) {
    const got = init.rx.decrypt(Uint8Array.from(Buffer.from(rec.ciphertext, 'hex')))
    if (toHex(got) !== rec.plaintext) throw new Error('r->i transport decrypt failed')
  }

  const sasI = deriveSas(init.handshakeHash, initiatorStatic.publicKey, responderStatic.publicKey, sha256)
  const sasR = deriveSas(resp.handshakeHash, initiatorStatic.publicKey, responderStatic.publicKey, sha256)
  if (sasI !== sasR) throw new Error('SAS mismatch between the two local sides')

  return {
    label,
    sid,
    prologue: toHex(prologueOverrideI ?? prologue),
    prologueRos: prologueOverrideR ? toHex(prologueOverrideR) : null,
    initiatorEphemeral: { secretKey: toHex(iEph.secretKey), publicKey: toHex(iEph.publicKey) },
    responderEphemeral: { secretKey: toHex(rEph.secretKey), publicKey: toHex(rEph.publicKey) },
    payloads: payloads.map(toHex),
    messages: { msg1: toHex(msg1), msg2: toHex(msg2), msg3: toHex(msg3) },
    traceInitiator: init.trace,
    traceResponder: resp.trace,
    handshakeHash: toHex(init.handshakeHash),
    chainingKey: toHex(init.ck),
    transportKeys: {
      initiatorToResponder: toHex(init.tx.k),
      responderToInitiator: toHex(init.rx.k)
    },
    transport: { initiatorToResponder: i2r, responderToInitiator: r2i },
    sas: sasI
  }
}

// -- session A: the canonical vector ---------------------------------------
const sessionA = runSession({
  sid: 'pair-session-A-7f3c1d92',
  label: 'A-canonical',
  iEph: detKey(19, 7),
  rEph: detKey(23, 9)
})

// -- session B: same static keys, *different* ephemerals + different sid ----
// Used by the Dart test to prove the SAS is bound to the fresh ephemerals
// (replay of a previously captured handshake does not reproduce the SAS).
const sessionB = runSession({
  sid: 'pair-session-B-0a11ee44',
  label: 'B-replay-different-ephemerals',
  iEph: detKey(29, 11),
  rEph: detKey(31, 13)
})

// -- session C: identical everything except one byte of the session id -----
// Same statics AND same ephemerals as A, different sid -> different prologue.
const sessionC = runSession({
  sid: 'pair-session-A-7f3c1d93',
  label: 'C-prologue-changed-by-one-byte',
  iEph: detKey(19, 7),
  rEph: detKey(23, 9)
})

// -- session D: ephemeral reuse across sessions (what a QR replay would do) -
// Identical to A, so the SAS is identical: this is what a *successful* replay
// of both ephemerals would look like, which is why ephemerals must be fresh.
const sessionD = runSession({
  sid: 'pair-session-A-7f3c1d92',
  label: 'D-identical-replay-same-ephemerals',
  iEph: detKey(19, 7),
  rEph: detKey(23, 9)
})

// -- tamper vector: flip one byte of the first i->r transport ciphertext ----
const good = Uint8Array.from(Buffer.from(sessionA.transport.initiatorToResponder[0].ciphertext, 'hex'))
const tampered = Uint8Array.from(good)
tampered[3] ^= 0x01

const doc = {
  formatVersion: 1,
  generatedBy: 'spikes/noise-interop/node/src/emit-vectors.js',
  suite: 'Noise_XX_25519_ChaChaPoly_BLAKE2s',
  protocolName: BLAKE2S.name,
  hash: 'BLAKE2s',
  hashLen: 32,
  blockLen: 64,
  cipher: 'ChaCha20-Poly1305 (IETF, 96-bit nonce = 4 zero bytes || LE64(counter))',
  dh: 'X25519 (RFC 7748, raw 32-byte public keys, no point compression)',
  hkdf: 'RFC 5869 HMAC-BLAKE2s; Noise truncates each output to the first 32 bytes',
  prologueRule: 'utf8("dsh-remote/v1/pair:" + sid)',
  sasRule: 'be_u64(SHA256(handshakeHash || initiatorStaticPub || responderStaticPub)[0..8]) mod 10^6, zero-padded to 6',
  applicationBindings: {
    initiatorStatic: { secretKey: toHex(initiatorStatic.secretKey), publicKey: toHex(initiatorStatic.publicKey) },
    responderStatic: { secretKey: toHex(responderStatic.secretKey), publicKey: toHex(responderStatic.publicKey) }
  },
  sessions: {
    A: sessionA,
    B: sessionB,
    C: sessionC,
    D: sessionD
  },
  negativeVectors: {
    tamperedTransportCiphertext: {
      direction: 'initiatorToResponder',
      nonce: 0,
      originalCiphertext: toHex(good),
      tamperedCiphertext: toHex(tampered),
      modifiedByteIndex: 3,
      expectation: 'decrypt must fail authentication'
    }
  }
}

mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, JSON.stringify(doc, null, 2) + '\n')

console.log('wrote', outPath)
console.log('  suite          :', doc.suite)
console.log('  session A hash :', sessionA.handshakeHash)
console.log('  session A SAS  :', sessionA.sas)
console.log('  session B SAS  :', sessionB.sas)
console.log('  session C SAS  :', sessionC.sas)
console.log('  session D SAS  :', sessionD.sas)
console.log('  A==D (same ephemerals+prologue) :', sessionA.sas === sessionD.sas)
console.log('  A==B (different ephemerals)     :', sessionA.sas === sessionB.sas)
console.log('  A==C (prologue differs 1 byte)  :', sessionA.sas === sessionC.sas)
console.log('  msg lengths    :', sessionA.messages.msg1.length / 2, sessionA.messages.msg2.length / 2, sessionA.messages.msg3.length / 2)
void concat
