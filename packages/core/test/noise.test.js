import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { NoiseXX, CipherState, deriveSas } from '../src/noise-xx.js'
import { BLAKE2S } from '../src/primitives.js'
import { fromHex, toHex, utf8 } from '../src/bytes.js'

test('promoted Noise reproduces all frozen handshake and transport vectors', () => {
  const vectors = JSON.parse(readFileSync(new URL('../../protocol/vectors/xx25519-chachapoly-blake2s.json', import.meta.url)))
  const keyPair = value => ({ secretKey: fromHex(value.secretKey), publicKey: fromHex(value.publicKey) })
  for (const data of Object.values(vectors.sessions)) {
    const init = new NoiseXX({ initiator: true, staticKeyPair: keyPair(vectors.applicationBindings.initiatorStatic), ephemeralKeyPair: keyPair(data.initiatorEphemeral), prologue: fromHex(data.prologue), suite: BLAKE2S })
    const resp = new NoiseXX({ initiator: false, staticKeyPair: keyPair(vectors.applicationBindings.responderStatic), ephemeralKeyPair: keyPair(data.responderEphemeral), prologue: fromHex(data.prologue), suite: BLAKE2S })
    const m1 = init.writeMessage(fromHex(data.payloads[0]))
    assert.equal(toHex(m1), data.messages.msg1)
    resp.readMessage(m1)
    const m2 = resp.writeMessage(fromHex(data.payloads[1]))
    assert.equal(toHex(m2), data.messages.msg2)
    init.readMessage(m2)
    const m3 = init.writeMessage(fromHex(data.payloads[2]))
    assert.equal(toHex(m3), data.messages.msg3)
    resp.readMessage(m3)
    assert.equal(toHex(init.handshakeHash), data.handshakeHash)
    assert.equal(toHex(init.tx.k), data.transportKeys.initiatorToResponder)
    assert.equal(toHex(resp.tx.k), data.transportKeys.responderToInitiator)
    assert.equal(deriveSas(init.handshakeHash, init.s.publicKey, resp.s.publicKey), data.sas)
    for (const [writer, reader, records] of [[init.tx, resp.rx, data.transport.initiatorToResponder], [resp.tx, init.rx, data.transport.responderToInitiator]]) {
      for (const record of records) {
        const ciphertext = writer.encrypt(fromHex(record.plaintext))
        assert.equal(toHex(ciphertext), record.ciphertext)
        assert.equal(toHex(reader.decrypt(ciphertext)), record.plaintext)
      }
    }
  }
})

test('all seven low-order points abort DH and an injected wire ephemeral aborts handshake', () => {
  const points = ['00'.repeat(32), '01' + '00'.repeat(31),
    'e0eb7a7c3b41b8ae1656e3faf19fc46ada098deb9c32b1fd866205165f49b800',
    '5f9c95bca3508c24b1d0b1559c83ef5b04445cc4581c8e86d8224eddd09f1157',
    'ec' + 'ff'.repeat(30) + '7f', 'ed' + 'ff'.repeat(30) + '7f', 'ee' + 'ff'.repeat(30) + '7f']
  for (const value of points) {
    const key = BLAKE2S.generateKeyPair()
    const noise = new NoiseXX({ initiator: false, staticKeyPair: key, suite: BLAKE2S })
    assert.throws(() => noise._dh(fromHex(value), key))
    noise.readMessage(fromHex(value))
    assert.throws(() => noise.writeMessage())
  }
})

test('AEAD failure preserves nonce, handshake lengths are bounded and cleanup does not wipe caller keys', () => {
  const key = BLAKE2S.generateKeyPair()
  const before = toHex(key.secretKey)
  const noise = new NoiseXX({ initiator: true, staticKeyPair: key, suite: BLAKE2S })
  assert.throws(() => noise.writeMessage(new Uint8Array(65504)))
  noise.destroy()
  assert.equal(toHex(key.secretKey), before)
  const cipher = new CipherState(key.secretKey)
  const encrypted = new CipherState(key.secretKey).encrypt(utf8('payload'))
  encrypted[0] ^= 1
  assert.throws(() => cipher.decrypt(encrypted))
  assert.equal(cipher.n, 0)
  const reader = new NoiseXX({ initiator: false, staticKeyPair: key, suite: BLAKE2S })
  assert.throws(() => reader.readMessage(new Uint8Array(31)))
  assert.throws(() => reader.readMessage(new Uint8Array(65536)))
})
