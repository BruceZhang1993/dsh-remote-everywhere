import { EventEmitter } from 'node:events'
import { randomBytes } from 'node:crypto'
import { ProtocolError, assertMethod } from '@dsh-remote/protocol'
import { deviceId } from '@dsh-remote/core'
import { DEFAULT_CAPS, validCaps } from './store.js'

/** Only the owner can begin/confirm. A slot accepts one handshake, then expires. */
export class PairingHost extends EventEmitter {
  constructor(store, name, { audit = () => {} } = {}) { super(); this.store = store; this.name = name; this.audit = audit }
  begin(endpoint, caps = DEFAULT_CAPS) {
    validCaps(caps)
    this.cancel()
    this.lastResult = null
    this.audit('pairing.opened')
    const slot = { sid: randomBytes(16).toString('base64url'), exp: Date.now() + 180000, caps, state: 'open' }
    this.slot = slot
    this.timer = setTimeout(() => this.cancel('expired'), 180000)
    slot.qr = { v: 1, sid: slot.sid, exp: Math.floor(slot.exp / 1000), relay: endpoint, pk: Buffer.from(this.store.keyPair.publicKey).toString('base64'), name: this.name, caps }
    this.emit('change')
    return slot.qr
  }
  claim(sid) {
    const slot = this.slot
    if (!slot || slot.sid !== sid || slot.state !== 'open' || Date.now() >= slot.exp) throw new ProtocolError('unauthorized', 'pairing is not open')
    slot.state = 'claimed'
    this.emit('change')
    this.audit('pairing.claimed')
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
      this.emit('change')
    }).catch(() => {})
    let confirming = false
    connection.register('pair.confirm', 'admin', async (params, { signal }) => {
      assertMethod('pair.confirm', params)
      if (this.slot !== slot || slot.state !== 'confirming' || confirming || params.sas !== slot.sas || params.deviceId !== slot.peer.deviceId) throw new ProtocolError('unauthorized', 'pair confirmation mismatch')
      confirming = true
      await slot.local
      if (signal.aborted || this.slot !== slot || Date.now() >= slot.exp || connection.state !== 'ready') throw new ProtocolError('unauthorized', 'pair confirmation expired')
      this.audit('pairing.grant', { deviceId: slot.peer.deviceId })
      const record = this.store.grant(connection.peerPublicKey, slot.peer.name, slot.caps)
      slot.state = 'consumed'
      clearTimeout(this.timer)
      this.emit('paired', { deviceId: record.deviceId })
      this.emit('change')
      return { ok: true, deviceId: deviceId(this.store.keyPair.publicKey), caps: record.caps }
    })
  }
  pending() {
    const slot = this.slot
    return slot ? { sid: slot.sid, exp: slot.exp, state: slot.state, sas: slot.sas, peer: slot.peer, caps: slot.caps, localConfirmed: Boolean(slot.localConfirmed) } : null
  }
  confirm(sas) {
    const slot = this.slot
    if (!slot || slot.state !== 'confirming' || sas !== slot.sas || Date.now() >= slot.exp) throw new ProtocolError('unauthorized', 'local SAS mismatch')
    this.audit('pairing.local-confirmed', { deviceId: slot.peer.deviceId })
    slot.localConfirmed = true
    slot.resolveLocal()
    this.emit('change')
    return { ok: true }
  }
  cancel(reason = 'cancelled') {
    clearTimeout(this.timer)
    const slot = this.slot
    if (slot) this.lastResult = { sid: slot.sid, exp: slot.exp, state: slot.state === 'consumed' ? 'consumed' : reason,
      peer: slot.peer ? { name: slot.peer.name, deviceId: slot.peer.deviceId } : null, caps: slot.caps }
    this.slot = null
    slot?.rejectLocal?.(new ProtocolError('cancelled', 'pairing cancelled'))
    slot?.connection?.close()
    if (slot && slot.state !== 'consumed') this.emit('cancelled', { deviceId: slot.peer?.deviceId })
    if (slot) this.emit('change')
  }
}
