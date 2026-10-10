// A from-the-spec implementation of the Noise XX handshake for the
// Noise_XX_25519_ChaChaPoly_BLAKE2s suite (Noise Protocol Framework rev 34).
//
// Why hand-written: no Node.js Noise library implements BLAKE2s.
//   - noise-handshake 4.2.0          -> hardcodes BLAKE2b (libsodium crypto_generichash)
//   - noise-protocol 3.0.2           -> hardcodes BLAKE2b (hmac-blake2b)
//   - @chainsafe/libp2p-noise 17.0.0 -> hardcodes Noise_XX_25519_ChaChaPoly_SHA256
//   - libsodium itself exposes no BLAKE2s primitive at all (only BLAKE2b)
// See REPORT.md.
//
// The pattern driver is deliberately written as a small explicit state machine
// (not a generic pattern engine) so it can be reviewed line-by-line against
// section 7 of the spec. src/validate-vs-noise-handshake.js byte-compares this
// driver against `noise-handshake` using the BLAKE2b cipher set.

import { concat, zeros, equalBytes } from './bytes.js'
import { aeadEncrypt, aeadDecrypt, sha256 } from './primitives.js'

// --- HKDF (Noise spec section 4.2) -----------------------------------------
//
// HKDF(chaining_key, input_key_material, num_outputs):
//   temp_key    = HMAC-HASH(chaining_key, input_key_material)
//   output[1]   = HMAC-HASH(temp_key, 0x01)
//   output[i]   = HMAC-HASH(temp_key, output[i-1] || i)
export function hkdf (suite, chainingKey, inputKeyMaterial, numOutputs) {
  const tempKey = suite.hmac(chainingKey, [inputKeyMaterial])
  const outputs = []
  let prev = zeros(0)
  for (let i = 1; i <= numOutputs; i++) {
    prev = suite.hmac(tempKey, [prev, new Uint8Array([i])])
    outputs.push(prev)
  }
  return outputs
}

// --- CipherState (Noise spec section 5.1) ----------------------------------
//
// CipherState keys are always 32 bytes (ChaChaPoly KEYLEN). For BLAKE2s,
// HASHLEN == 32 so this never truncates; for BLAKE2b, HASHLEN == 64 and the
// spec requires taking the first 32 bytes of every HKDF output.
const CIPHER_KEY_LENGTH = 32

export class CipherState {
  constructor (key = null) {
    this.k = key ? Uint8Array.from(key.subarray(0, CIPHER_KEY_LENGTH)) : null
    this.n = 0
  }

  get hasKey () {
    return this.k !== null
  }

  initializeKey (key) {
    this.k = Uint8Array.from(key.subarray(0, CIPHER_KEY_LENGTH))
    this.n = 0
  }

  encrypt (plaintext, ad = zeros(0)) {
    if (!this.hasKey) return plaintext
    // Noise permits 2^64-1 messages; we refuse to leave the safe integer range.
    if (this.n >= 0xffffffff) throw new Error('CipherState nonce exhausted (>= 2^32)')
    if (plaintext.length + 16 > 65535) {
      throw new Error(`Noise message too long: ${plaintext.length} plaintext bytes exceed the 65535-byte Noise message limit`)
    }
    const ciphertext = aeadEncrypt(this.k, this.n, ad, plaintext)
    this.n++
    return ciphertext
  }

  decrypt (ciphertext, ad = zeros(0)) {
    if (!this.hasKey) return ciphertext
    if (this.n >= 0xffffffff) throw new Error('CipherState nonce exhausted (>= 2^32)')
    if (ciphertext.length > 65535) {
      throw new Error(`Noise message too long: ${ciphertext.length} bytes exceed the 65535-byte Noise message limit`)
    }
    const plaintext = aeadDecrypt(this.k, this.n, ad, ciphertext)
    this.n++
    return plaintext
  }
}

// --- SymmetricState (Noise spec section 5.2) -------------------------------
export class SymmetricState {
  constructor (suite, prologue = zeros(0), trace = null) {
    this.suite = suite
    this.trace = trace

    const protocolName = new TextEncoder().encode(suite.name)
    let h
    if (protocolName.length <= suite.HASHLEN) {
      h = zeros(suite.HASHLEN)
      h.set(protocolName)
    } else {
      h = suite.hash(protocolName)
    }
    this.h = h
    this.ck = Uint8Array.from(h)
    this.cipher = new CipherState()
    this.mixHash(prologue, 'prologue')
  }

  _note (label) {
    if (this.trace) this.trace.push({ label, h: hex(this.h), ck: hex(this.ck), k: this.cipher.hasKey ? hex(this.cipher.k) : null })
  }

  mixKey (inputKeyMaterial, label) {
    const [ck, tempK] = hkdf(this.suite, this.ck, inputKeyMaterial, 2)
    this.ck = ck
    this.cipher.initializeKey(tempK)
    this._note(label || 'mixKey')
  }

  mixHash (data, label) {
    this.h = this.suite.hash(this.h, data)
    this._note(label || 'mixHash')
  }

  mixKeyAndHash (inputKeyMaterial, label) {
    const [ck, tempH, tempK] = hkdf(this.suite, this.ck, inputKeyMaterial, 3)
    this.ck = ck
    this.mixHash(tempH)
    this.cipher.initializeKey(tempK)
    this._note(label || 'mixKeyAndHash')
  }

  encryptAndHash (plaintext, label) {
    const ciphertext = this.cipher.encrypt(plaintext, this.h)
    this.mixHash(ciphertext, label)
    return ciphertext
  }

  decryptAndHash (ciphertext, label) {
    const plaintext = this.cipher.decrypt(ciphertext, this.h)
    this.mixHash(ciphertext, label)
    return plaintext
  }

  split () {
    const [k1, k2] = hkdf(this.suite, this.ck, zeros(0), 2)
    return [k1, k2]
  }

  getHandshakeHash () {
    return Uint8Array.from(this.h)
  }
}

function hex (b) {
  if (!b) return null
  let s = ''
  for (const x of b) s += x.toString(16).padStart(2, '0')
  return s
}

// --- HandshakeState for the XX pattern -------------------------------------
//
// XX:
//   -> e
//   <- e, ee, s, es
//   -> s, se
//
// This class only implements XX on purpose.
export class NoiseXX extends SymmetricState {
  /**
   * @param {object} opts
   * @param {boolean} opts.initiator
   * @param {{secretKey:Uint8Array,publicKey:Uint8Array}} opts.staticKeyPair
   * @param {Uint8Array} [opts.prologue]
   * @param {object} opts.suite                 cipher set, e.g. BLAKE2S
   * @param {{secretKey:Uint8Array,publicKey:Uint8Array}} [opts.ephemeralKeyPair]
   *        fixed local ephemeral (for deterministic test vectors only)
   * @param {boolean} [opts.trace]              record h/ck/k after every mix
   */
  constructor ({ initiator, staticKeyPair, prologue, suite, ephemeralKeyPair, trace = false }) {
    super(suite, prologue, trace ? [] : null)
    this.initiator = initiator
    this.s = staticKeyPair
    this._fixedE = ephemeralKeyPair || null
    this.e = null
    this.re = null
    this.rs = null
    this.messageIndex = 0
    this.complete = false
    this.tx = null
    this.rx = null
    this.handshakeHash = null
  }

  _ephemeral () {
    if (this._fixedE) {
      const kp = this._fixedE
      this._fixedE = null // only the first ephemeral is caller-fixed
      return { secretKey: Uint8Array.from(kp.secretKey), publicKey: Uint8Array.from(kp.publicKey) }
    }
    return this.suite.generateKeyPair()
  }

  /**
   * Noise's single DH entry point. ALL handshake DH operations go through here
   * so the low-order-point guard below cannot be bypassed by a new call site.
   *
   * X25519 returns an all-zero shared secret whenever the peer's public key is a
   * low-order point (including u=0 and u=1). Neither @noble/curves nor libsodium
   * rejects those, so without this guard an attacker could force a known shared
   * secret and predict the derived keys. See docs/security.md T16.
   *
   * Do NOT move this guard down into `suite.dh`: key generation uses the base
   * point (X25519(sk, 9)), and while that never yields all-zero for a valid
   * secret, keeping keygen and handshake DH on separate paths avoids coupling
   * the two behaviours.
   */
  _dh (publicKey, keyPair) {
    const shared = this.suite.dh(publicKey, keyPair)
    if (shared.every((byte) => byte === 0)) {
      throw new Error(
        'Noise: X25519 low-order point rejected (all-zero shared secret)',
      )
    }
    return shared
  }

  _finish () {
    const [k1, k2] = this.split()
    this.tx = new CipherState(this.initiator ? k1 : k2)
    this.rx = new CipherState(this.initiator ? k2 : k1)
    this.handshakeHash = this.getHandshakeHash()
    this.complete = true
    this._note('split')
  }

  // ---- writer side --------------------------------------------------------
  writeMessage (payload = zeros(0)) {
    if (this.complete) throw new Error('handshake already complete')
    if (this.messageIndex === 0 && this.initiator) return this._writeMsg1(payload)
    if (this.messageIndex === 1 && !this.initiator) return this._writeMsg2(payload)
    if (this.messageIndex === 2 && this.initiator) return this._writeMsg3(payload)
    throw new Error(`writeMessage: wrong role/messageIndex (${this.messageIndex}, initiator=${this.initiator})`)
  }

  readMessage (buf) {
    if (this.complete) throw new Error('handshake already complete')
    if (this.messageIndex === 0 && !this.initiator) return this._readMsg1(buf)
    if (this.messageIndex === 1 && this.initiator) return this._readMsg2(buf)
    if (this.messageIndex === 2 && !this.initiator) return this._readMsg3(buf)
    throw new Error(`readMessage: wrong role/messageIndex (${this.messageIndex}, initiator=${this.initiator})`)
  }

  // -> e
  _writeMsg1 (payload) {
    this.e = this._ephemeral()
    this.mixHash(this.e.publicKey, 'e1:e')
    const out = concat(this.e.publicKey, this.encryptAndHash(payload, 'e1:payload'))
    this.messageIndex++
    return out
  }

  _readMsg1 (buf) {
    this.re = Uint8Array.from(buf.subarray(0, this.suite.PKLEN))
    this.mixHash(this.re, 'e1:re')
    const payload = this.decryptAndHash(buf.subarray(this.suite.PKLEN), 'e1:payload')
    this.messageIndex++
    return payload
  }

  // <- e, ee, s, es
  _writeMsg2 (payload) {
    this.e = this._ephemeral()
    this.mixHash(this.e.publicKey, 'e2:e')
    const parts = [this.e.publicKey]

    this.mixKey(this._dh(this.re, this.e), 'e2:ee') // DH(e_initiator, e_responder)
    parts.push(this.encryptAndHash(this.s.publicKey, 'e2:s'))

    this.mixKey(this._dh(this.re, this.s), 'e2:es') // DH(e_initiator, s_responder)
    parts.push(this.encryptAndHash(payload, 'e2:payload'))

    this.messageIndex++
    return concat(...parts)
  }

  _readMsg2 (buf) {
    let offset = 0
    this.re = Uint8Array.from(buf.subarray(offset, offset + this.suite.PKLEN))
    offset += this.suite.PKLEN
    this.mixHash(this.re, 'e2:re')

    this.mixKey(this._dh(this.re, this.e), 'e2:ee') // DH(e_initiator, e_responder)

    const encryptedStatic = buf.subarray(offset, offset + this.suite.PKLEN + 16)
    offset += this.suite.PKLEN + 16
    this.rs = this.decryptAndHash(encryptedStatic, 'e2:s')

    this.mixKey(this._dh(this.rs, this.e), 'e2:es') // DH(e_initiator, s_responder)

    const payload = this.decryptAndHash(buf.subarray(offset), 'e2:payload')
    this.messageIndex++
    return payload
  }

  // -> s, se
  _writeMsg3 (payload) {
    const parts = [this.encryptAndHash(this.s.publicKey, 'e3:s')]

    this.mixKey(this._dh(this.re, this.s), 'e3:se') // DH(s_initiator, e_responder)
    parts.push(this.encryptAndHash(payload, 'e3:payload'))

    this.messageIndex++
    this._finish()
    return concat(...parts)
  }

  _readMsg3 (buf) {
    let offset = 0
    const encryptedStatic = buf.subarray(offset, offset + this.suite.PKLEN + 16)
    offset += this.suite.PKLEN + 16
    this.rs = this.decryptAndHash(encryptedStatic, 'e3:s')

    this.mixKey(this._dh(this.rs, this.e), 'e3:se') // DH(s_initiator, e_responder)

    const payload = this.decryptAndHash(buf.subarray(offset), 'e3:payload')
    this.messageIndex++
    this._finish()
    return payload
  }
}

// --- SAS ------------------------------------------------------------------
//
// See REPORT.md section (f). Exported so both the vector emitter and the
// self-tests share one definition.
export function deriveSas (handshakeHash, initiatorStaticPub, responderStaticPub, sha256fn = sha256, digits = 6) {
  const digest = sha256fn(concat(handshakeHash, initiatorStaticPub, responderStaticPub))
  const view = new DataView(digest.buffer, digest.byteOffset, 8)
  const v = view.getBigUint64(0, false) // big-endian
  const modulus = BigInt(10) ** BigInt(digits)
  return (v % modulus).toString().padStart(digits, '0')
}

export function prologueForSession (sid) {
  return new TextEncoder().encode('dsh-remote/v1/pair:' + sid)
}

export { equalBytes }
