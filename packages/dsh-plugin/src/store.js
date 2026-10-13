import { mkdirSync, readFileSync, writeFileSync, renameSync, statSync, lstatSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { BLAKE2S, deviceId } from '@dsh-remote/core'
import { ProtocolError } from '@dsh-remote/protocol'

export const DEFAULT_CAPS = ['session', 'stream', 'approval']
export const DEVICE_CAPS = [...DEFAULT_CAPS, 'files', 'terminal', 'admin']
const fail = message => { throw new ProtocolError('invalid-argument', message) }
export function validCaps(caps) {
  if (!Array.isArray(caps) || !caps.length || new Set(caps).size !== caps.length || caps.some(cap => !DEVICE_CAPS.includes(cap))) fail('invalid capabilities')
  return [...caps]
}

/** One profile owns the private identity and atomic, bounded trust table. */
export class DeviceStore {
  constructor(directory) {
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    if (lstatSync(directory).isSymbolicLink() || (statSync(directory).mode & 0o077) !== 0) throw new Error('remote state directory must have mode 0700 and not be a symlink')
    this.directory = directory
    const keyPath = join(directory, 'identity.key')
    try { writeFileSync(keyPath, randomBytes(32), { flag: 'wx', mode: 0o600 }) }
    catch (error) { if (error.code !== 'EEXIST') throw error }
    if (lstatSync(keyPath).isSymbolicLink() || (statSync(keyPath).mode & 0o077) !== 0) throw new Error('identity must have mode 0600 and not be a symlink')
    const secret = readFileSync(keyPath)
    if (secret.length !== 32) throw new Error('invalid stored identity')
    this.keyPair = BLAKE2S.generateKeyPair(secret)
    secret.fill(0)
    this.path = join(directory, 'devices.json')
    this.read()
  }
  read() {
    let devices
    try {
      if (lstatSync(this.path).isSymbolicLink() || statSync(this.path).size > 1024 * 1024) throw new Error('invalid device table file')
      devices = JSON.parse(readFileSync(this.path, 'utf8'))
    } catch (error) { if (error.code !== 'ENOENT') throw error; devices = [] }
    if (!Array.isArray(devices) || devices.length > 128) throw new Error('invalid device table')
    for (const record of devices) {
      if (record.caps?.length) validCaps(record.caps)
      else if (!Array.isArray(record.caps) || !record.remoteCaps?.length) throw new Error('invalid stored capabilities')
      if (record.remoteCaps) validCaps(record.remoteCaps)
      if (!/^[A-Za-z0-9_-]{43}$/.test(record.publicKey) || deviceId(Buffer.from(record.publicKey, 'base64url')) !== record.deviceId) throw new Error('invalid stored public identity')
    }
    return devices
  }
  get devices() { return this.read() }
  find(publicKey) { return this.devices.find(record => record.publicKey === Buffer.from(publicKey).toString('base64url') && !record.revokedAt && record.caps.length) }
  list() { return this.devices.map(({ publicKey, ...record }) => ({ ...record })) }
  save(next) {
    const temporary = `${this.path}.${randomBytes(8).toString('hex')}.tmp`
    writeFileSync(temporary, JSON.stringify(next), { flag: 'wx', mode: 0o600 })
    renameSync(temporary, this.path)
  }
  update(change) {
    const lock = `${this.path}.lock`
    try { writeFileSync(lock, String(process.pid), { flag: 'wx', mode: 0o600 }) }
    catch (error) {
      if (error.code !== 'EEXIST') throw error
      const pid = Number(readFileSync(lock, 'utf8'))
      if (Number.isSafeInteger(pid) && pid > 0) {
        try { process.kill(pid, 0) }
        catch (probe) { if (probe.code === 'ESRCH') unlinkSync(lock) }
      }
      throw new ProtocolError('busy', 'device table is being updated; retry')
    }
    try { return change() } finally { unlinkSync(lock) }
  }
  grant(publicKey, name, caps, endpoint) {
    return this.update(() => {
      validCaps(caps)
      if (typeof name !== 'string' || name.length > 80) fail('invalid device name')
      const id = deviceId(publicKey)
      const previous = this.devices.find(record => record.deviceId === id && !record.revokedAt)
      const next = this.devices.filter(record => record.deviceId !== id)
      if (next.length >= 128) throw new ProtocolError('busy', 'device table full')
      const record = { deviceId: id, publicKey: Buffer.from(publicKey).toString('base64url'), name,
        caps: endpoint ? previous?.caps ?? [] : [...caps], pairedAt: Date.now(),
        ...(endpoint ? { endpoint, remoteCaps: [...caps] } : previous?.endpoint ? { endpoint: previous.endpoint, remoteCaps: previous.remoteCaps } : {}) }
      this.save([...next, record])
      return record
    })
  }
  revoke(id) {
    return this.update(() => {
      if (!this.devices.some(record => record.deviceId === id)) throw new ProtocolError('not-found', 'device not found')
      this.save(this.devices.map(record => record.deviceId === id ? { ...record, revokedAt: Date.now() } : record))
    })
  }
  rename(id, name) {
    return this.update(() => {
      if (typeof name !== 'string' || !name.trim() || name.length > 80) fail('invalid device name')
      if (!this.devices.some(record => record.deviceId === id)) throw new ProtocolError('not-found', 'device not found')
      this.save(this.devices.map(record => record.deviceId === id ? { ...record, name } : record))
    })
  }
  close() { this.keyPair.secretKey.fill(0) }
}
