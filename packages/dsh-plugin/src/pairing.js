import { EventEmitter } from 'node:events'
import { randomBytes } from 'node:crypto'
import { ProtocolError, assertMethod } from '@dsh-remote/protocol'
import { deviceId } from '@dsh-remote/core'
import { DEFAULT_CAPS, validCaps } from './store.js'

/** Only the owner can begin/confirm. A slot accepts one handshake, then expires. */
export class PairingHost extends EventEmitter {
  constructor(store, name) { super(); this.store = store; this.name = name }
  begin(endpoint, caps = DEFAULT_CAPS) {
    validCaps(caps)
    this.cancel()
    const slot = { sid: randomBytes(16).toString('base64url'), exp: Date.now() + 180000, caps, state: 'open' }
    this.slot = slot
    this.timer = setTimeout(() => this.cancel(), 180000)
    return { v: 1, sid: slot.sid, exp: Math.floor(slot.exp / 1000), relay: endpoint, pk: Buffer.from(this.store.keyPair.publicKey).toString('base64'), name: this.name, caps }
  }
  claim(sid) {
    const slot = this.slot
    if (!slot || slot.sid !== sid || slot.state !== 'open' || Date.now() >= slot.exp) throw new ProtocolError('unauthorized', 'pairing is not open')
    slot.state = 'claimed'
    return { pairSid: sid, caps: ['admin'], handshakeTimeoutMs: 10000, requestTimeoutMs: 180000, verifyPeer: () => this.slot === slot && Date.now() < slot.exp }
  }
  attach(connection) {
    const slot = this.slot
    if (!slot || slot.sid !== connection.pairSid) { connection.close(); return }
    slot.connection = connection
    connection.once('closed', () => { if (this.slot === slot) this.cancel() })
    connection.ready.then(() => {
      if (this.slot !== slot) { connection.close(); return }
      slot.sas = connection.sas
      slot.peer = connection.peerHello
      slot.state = 'confirming'
      slot.local = new Promise((resolve, reject) => { slot.resolveLocal = resolve; slot.rejectLocal = reject })
      slot.local.catch(() => {})
      this.emit('pending', this.pending())
    }).catch(() => {})
    let confirming = false
    connection.register('pair.confirm', 'admin', async (params, { signal }) => {
      assertMethod('pair.confirm', params)
      if (this.slot !== slot || slot.state !== 'confirming' || confirming || params.sas !== slot.sas || params.deviceId !== slot.peer.deviceId) throw new ProtocolError('unauthorized', 'pair confirmation mismatch')
      confirming = true
      await slot.local
      if (signal.aborted || this.slot !== slot || Date.now() >= slot.exp || connection.state !== 'ready') throw new ProtocolError('unauthorized', 'pair confirmation expired')
      const record = this.store.grant(connection.peerPublicKey, slot.peer.name, slot.caps)
      slot.state = 'consumed'
      clearTimeout(this.timer)
      return { ok: true, deviceId: deviceId(this.store.keyPair.publicKey), caps: record.caps }
    })
  }
  pending() {
    const slot = this.slot
    return slot ? { sid: slot.sid, exp: slot.exp, state: slot.state, sas: slot.sas, peer: slot.peer, caps: slot.caps } : null
  }
  confirm(sas) {
    const slot = this.slot
    if (!slot || slot.state !== 'confirming' || sas !== slot.sas || Date.now() >= slot.exp) throw new ProtocolError('unauthorized', 'local SAS mismatch')
    slot.resolveLocal()
    return { ok: true }
  }
  cancel() {
    clearTimeout(this.timer)
    const slot = this.slot
    this.slot = null
    slot?.rejectLocal?.(new ProtocolError('cancelled', 'pairing cancelled'))
    slot?.connection?.close()
  }
}
