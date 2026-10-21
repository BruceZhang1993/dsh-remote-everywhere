import { readFileSync } from 'node:fs'
import Ajv from 'ajv'

export const VERSION = 1
export const HEADER_BYTES = 16
export const MAX_NOISE_BYTES = 65535
export const MAX_PLAINTEXT_BYTES = MAX_NOISE_BYTES - 16
export const MAX_WIRE_BYTES = HEADER_BYTES + MAX_NOISE_BYTES
export const MAX_STREAMS = 32
export const MAX_PENDING_REQUESTS = 32
export const MAX_QUEUE_BYTES = 1024 * 1024
export const MAX_QUEUE_MESSAGES = 128
export const MAX_PAGE_RECORDS = 256
export const KINDS = Object.freeze({ REQ: 1, RES: 2, ERR: 3, EVT: 4, SDATA: 5, SEND: 6 })

const schema = JSON.parse(readFileSync(new URL('../schema.json', import.meta.url), 'utf8'))
const ajv = new Ajv({ strict: true })
ajv.addSchema(schema)
const validators = new Map(Object.keys(schema.$defs).map(name => [
  name, ajv.compile({ $ref: `${schema.$id}#/$defs/${name}` }),
]))

export class ProtocolError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

export function assertValue(name, value) {
  const validate = validators.get(name)
  if (!validate || !validate(value)) throw new ProtocolError('invalid-argument', `invalid ${name}`)
  return value
}

const methodSchemas = {
  'workspace.list': 'EmptyParams',
  'changes.summary': 'ChangesSummaryParams', 'changes.diff': 'ChangesDiffParams',
  'subagent.list': 'SessionIdentityParams', 'subagent.prompt': 'SubagentPromptParams', 'subagent.cancel': 'SubagentIdentityParams',
  'session.upload.begin': 'UploadBeginParams', 'session.upload.chunk': 'UploadChunkParams', 'session.upload.finish': 'UploadFinishParams',
  'session.list': 'SessionListParams', 'session.search': 'SessionSearchParams', 'session.create': 'SessionCreateParams',
  'session.fork': 'SessionForkParams', 'session.rename': 'SessionRenameParams', 'session.prompt': 'SessionPromptParams',
  'session.cancel': 'SessionIdentityParams', 'session.queue.update': 'SessionQueueParams', 'session.attachment': 'SessionAttachmentParams', 'session.projections': 'SessionIdentityParams',
  'stream.open': 'SessionStreamParams', 'history.page': 'HistoryPageParams', 'stream.close': 'StreamIdentityParams', 'control.subscribe': 'StreamIdentityParams',
  'approval.pending': 'ApprovalPendingParams', 'approval.decide': 'ApprovalDecisionParams', 'question.answer': 'QuestionAnswerParams',
  'device.list': 'EmptyParams', 'device.revoke': 'DeviceIdentityParams', 'device.rename': 'DeviceRenameParams', 'pair.begin': 'PairBeginParams', 'pair.confirm': 'PairConfirmParams',
  'files.list': 'FileListParams', 'files.read': 'FileReadParams', 'files.write': 'FileWriteParams', 'terminal.exec': 'TerminalExecParams', 'operation.prepare': 'OperationPrepareParams',
}
export function assertMethod(method, params) {
  if (!methodSchemas[method]) throw new ProtocolError('unsupported', 'unknown application method')
  return assertValue(methodSchemas[method], params)
}

/** Header sequence is a physical-stream counter, never a SessionEvent cursor. */
export function encodeHeader({ kind, streamId = 0, seq }) {
  if (!Object.values(KINDS).includes(kind) || !Number.isInteger(streamId) || streamId < 0 || streamId > 0xffffffff ||
      !Number.isSafeInteger(seq) || seq < 0) throw new ProtocolError('invalid-argument', 'invalid frame header')
  const header = Buffer.alloc(HEADER_BYTES)
  header.writeUInt16BE(0x4452)
  header[2] = VERSION
  header[3] = kind
  header.writeUInt32BE(streamId, 4)
  header.writeBigUInt64BE(BigInt(seq), 8)
  return header
}

export function decodeHeader(bytes) {
  if (bytes.length < HEADER_BYTES) throw new ProtocolError('invalid-argument', 'truncated frame header')
  const header = Buffer.from(bytes.buffer, bytes.byteOffset, HEADER_BYTES)
  if (header.readUInt16BE() !== 0x4452 || header[2] !== VERSION) {
    throw new ProtocolError('unsupported', 'unsupported frame version or magic')
  }
  const seq = header.readBigUInt64BE(8)
  if (seq > BigInt(Number.MAX_SAFE_INTEGER)) throw new ProtocolError('invalid-argument', 'frame sequence exceeds v1 range')
  const value = { kind: header[3], streamId: header.readUInt32BE(4), seq: Number(seq) }
  encodeHeader(value)
  return value
}

const jsonDecoder = new TextDecoder('utf-8', { fatal: true })
export function encodePayload(kind, value) {
  validatePayload(kind, value)
  const bytes = kind === KINDS.SDATA ? Buffer.from(value) : Buffer.from(JSON.stringify(value))
  if (bytes.length > MAX_PLAINTEXT_BYTES) throw new ProtocolError('invalid-argument', 'payload requires chunking')
  return bytes
}

export function decodePayload(kind, bytes) {
  let value
  try { value = kind === KINDS.SDATA ? bytes : JSON.parse(jsonDecoder.decode(bytes)) }
  catch { throw new ProtocolError('invalid-argument', 'invalid UTF-8 JSON payload') }
  validatePayload(kind, value)
  return value
}

function validatePayload(kind, value) {
  const name = { 1: 'Request', 2: 'Response', 3: 'ErrorResponse', 6: 'StreamEnd' }[kind]
  if (name) return assertValue(name, value)
  if (kind === KINDS.SDATA && value instanceof Uint8Array) return
  if (kind === KINDS.EVT) {
    const eventName = { hello: 'Hello', ping: 'Heartbeat', pong: 'Heartbeat', bye: 'Bye', application: 'ApplicationEvent', 'authentication-rejected': 'AuthenticationRejected' }[value?.type]
    if (eventName) return assertValue(eventName, value)
    if (value?.kind === 'snapshot') return assertValue('JournalSnapshot', value)
    if (value?.kind === 'append') return assertValue('JournalAppend', value)
  }
  throw new ProtocolError('unsupported', 'unsupported frame payload')
}
