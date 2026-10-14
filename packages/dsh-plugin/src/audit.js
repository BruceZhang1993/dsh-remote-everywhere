import { constants, openSync, closeSync, fstatSync, lstatSync, writeSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { isIP } from 'node:net'
import { ProtocolError } from '@dsh-remote/protocol'

export const MAX_AUDIT_BYTES = 1024 * 1024
export const MAX_AUDIT_RECORD_BYTES = 4096
const fields = { deviceId: 64, sessionId: 256, requestId: 64, operationId: 64, interactionId: 64,
  method: 128, toolName: 128, outcome: 32, by: 16, direction: 16, role: 16, kind: 16, status: 32, code: 64 }
const clip = (value, bytes) => Buffer.from(value.replace(/[\u0000-\u001f\u007f]/g, '?')).subarray(0, bytes).toString('utf8')

/** One runtime owns one synchronous, bounded writer. No request payloads enter it. */
export class AuditLog {
  constructor(directory, onFailure = () => {}) {
    this.path = join(directory, 'audit.jsonl')
    this.previous = `${this.path}.previous`
    this.onFailure = onFailure
    this.checkPrevious()
    this.open()
  }
  checkFile(stat) {
    if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o077) !== 0 || stat.size > MAX_AUDIT_BYTES) throw new Error('invalid audit file')
  }
  checkPrevious() {
    try { this.checkFile(lstatSync(this.previous)) }
    catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  open() {
    this.fd = openSync(this.path, constants.O_CREAT | constants.O_APPEND | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600)
    try { this.checkFile(fstatSync(this.fd)) }
    catch (error) { closeSync(this.fd); this.fd = undefined; throw error }
  }
  record(event, data = {}) {
    if (this.failed || this.closed) throw new ProtocolError('internal', 'remote audit unavailable')
    if (!/^[a-z][a-z.-]{0,63}$/.test(event)) throw new Error('invalid audit event')
    const record = { time: Date.now(), pid: process.pid, event }
    for (const [key, limit] of Object.entries(fields)) {
      if (typeof data[key] !== 'string') continue
      const value = key === 'code' && !/^[a-z][a-z0-9_/-]{0,63}$/.test(data[key]) ? 'internal' : data[key]
      record[key] = clip(value, limit)
      if (Buffer.byteLength(value) > limit) record.truncated = true
    }
    if (typeof data.address === 'string' && isIP(data.address)) record.address = data.address
    for (const key of ['bytes', 'exitCode']) if (Number.isSafeInteger(data[key])) record[key] = data[key]
    let line = `${JSON.stringify(record)}\n`
    if (Buffer.byteLength(line) > MAX_AUDIT_RECORD_BYTES) {
      record.recordBytes = Buffer.byteLength(line)
      record.truncated = true
      for (const key of Object.keys(fields)) if (record[key]) record[key] = clip(record[key], 32)
      line = `${JSON.stringify(record)}\n`
    }
    try {
      const stat = fstatSync(this.fd), path = lstatSync(this.path)
      this.checkFile(stat)
      this.checkFile(path)
      if (stat.ino !== path.ino || stat.dev !== path.dev) throw new Error('audit file replaced')
      const bytes = Buffer.from(line)
      if (stat.size + bytes.length > MAX_AUDIT_BYTES) {
        this.checkPrevious()
        closeSync(this.fd)
        this.fd = undefined
        renameSync(this.path, this.previous)
        this.open()
      }
      let offset = 0
      while (offset < bytes.length) {
        const written = writeSync(this.fd, bytes, offset, bytes.length - offset)
        if (written === 0) throw new Error('audit write made no progress')
        offset += written
      }
    } catch {
      this.failed = true
      this.close()
      this.onFailure()
      throw new ProtocolError('internal', 'remote audit unavailable')
    }
  }
  close() {
    if (this.fd !== undefined) { closeSync(this.fd); this.fd = undefined }
    this.closed = true
  }
}
