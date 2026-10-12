// Crypto primitives + Noise "CipherSet" abstractions.
//
// Everything here is pure JavaScript (no native addon, no compiler). The
// primitives come from the audited @noble family:
//   - BLAKE2s      : @noble/hashes/blake2.js
//   - HMAC-BLAKE2s : @noble/hashes/hmac.js
//   - X25519       : @noble/curves/ed25519.js
//   - ChaCha20-Poly1305 (RFC 8439 / IETF 96-bit nonce): @noble/ciphers/chacha.js
//
// We also expose a BLAKE2b CipherSet. It is NOT the suite this project ships,
// but it lets us byte-compare our hand-written XX pattern driver against the
// third-party `noise-handshake` package (which hardcodes BLAKE2b), see
// src/validate-vs-noise-handshake.js.

import { blake2s, blake2b } from '@noble/hashes/blake2.js'
import { hmac } from '@noble/hashes/hmac.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { x25519 } from '@noble/curves/ed25519.js'
import { chacha20poly1305 } from '@noble/ciphers/chacha.js'

import { concat, zeros } from './bytes.js'

// ---------------------------------------------------------------------------
// Noise CipherSet for Noise_XX_25519_ChaChaPoly_BLAKE2s
// ---------------------------------------------------------------------------

const HASHLEN_BLAKE2S = 32
const BLOCKLEN_BLAKE2S = 64

function blake2sHash (...parts) {
  return blake2s(concat(...parts), { dkLen: HASHLEN_BLAKE2S })
}

function hmacBlake2s (key, parts) {
  return hmac(blake2s, key, concat(...parts), { dkLen: HASHLEN_BLAKE2S })
}

// ---------------------------------------------------------------------------
// BLAKE2b CipherSet (validation only - matches `noise-handshake` 4.2.0)
// ---------------------------------------------------------------------------

const HASHLEN_BLAKE2B = 64
const BLOCKLEN_BLAKE2B = 128

function blake2bHash (...parts) {
  return blake2b(concat(...parts), { dkLen: HASHLEN_BLAKE2B })
}

function hmacBlake2b (key, parts) {
  return hmac(blake2b, key, concat(...parts), { dkLen: HASHLEN_BLAKE2B })
}

// ---------------------------------------------------------------------------
// X25519
// ---------------------------------------------------------------------------

const dhSuite = {
  DHLEN: 32,
  PKLEN: 32,
  SKLEN: 32,
  ALG: '25519',
  generateKeyPair (secretKey) {
    const sk = secretKey ? Uint8Array.from(secretKey) : x25519.utils.randomSecretKey()
    return { secretKey: sk, publicKey: x25519.getPublicKey(sk) }
  },
  dh (publicKey, { secretKey }) {
    if (publicKey.length !== 32) throw new Error('invalid X25519 public key length')
    if (secretKey.length !== 32) throw new Error('invalid X25519 secret key length')
    return x25519.getSharedSecret(secretKey, publicKey)
  }
}

// ---------------------------------------------------------------------------
// AEAD: Noise uses ChaCha20-Poly1305 with a 96-bit nonce built as
// 4 zero bytes || little-endian 64-bit counter.
// ---------------------------------------------------------------------------

function noiseNonce (n) {
  const nonce = new Uint8Array(12)
  const view = new DataView(nonce.buffer)
  view.setBigUint64(4, BigInt(n), true) // 4 zero bytes, then LE64(counter)
  return nonce
}

export function aeadEncrypt (key, n, ad, plaintext) {
  return chacha20poly1305(key, noiseNonce(n), ad).encrypt(plaintext)
}

export function aeadDecrypt (key, n, ad, ciphertext) {
  return chacha20poly1305(key, noiseNonce(n), ad).decrypt(ciphertext)
}

// ---------------------------------------------------------------------------
// Exported cipher sets
// ---------------------------------------------------------------------------

export const BLAKE2S = Object.freeze({
  name: 'Noise_XX_25519_ChaChaPoly_BLAKE2s',
  HASH: 'BLAKE2s',
  HASHLEN: HASHLEN_BLAKE2S,
  BLOCKLEN: BLOCKLEN_BLAKE2S,
  hash: blake2sHash,
  hmac: hmacBlake2s,
  ...dhSuite
})

export const BLAKE2B = Object.freeze({
  name: 'Noise_XX_25519_ChaChaPoly_BLAKE2b',
  HASH: 'BLAKE2b',
  HASHLEN: HASHLEN_BLAKE2B,
  BLOCKLEN: BLOCKLEN_BLAKE2B,
  hash: blake2bHash,
  hmac: hmacBlake2b,
  ...dhSuite
})

export { sha256, zeros }
