import assert from 'node:assert/strict'
import { Session } from 'node:inspector/promises'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { ProtocolError, KINDS, encodeHeader, decodeHeader, encodePayload, decodePayload } from '../packages/protocol/src/index.js'
import { RecordDecoder } from '../packages/core/src/transport.js'

const seconds = Number(process.env.DSH_FUZZ_SECONDS ?? 60)
const limit = Number(process.env.DSH_FUZZ_ITERATIONS ?? 1000000)
if (!Number.isInteger(seconds) || seconds < 10 || seconds > 3600
  || !Number.isInteger(limit) || limit < 100 || limit > 1000000) throw new Error('fuzz budget: seconds 10..3600, iterations 100..1000000')
const directory = fileURLToPath(new URL('../.cache/coverage-fuzz/', import.meta.url))
mkdirSync(directory, { recursive: true })
writeFileSync(`${directory}report.json`, JSON.stringify({ passed: false, status: 'running' }))
const targets = ['../packages/protocol/src/index.js', '../packages/core/src/transport.js'].map(path => new URL(path, import.meta.url))
const sourceHashes = targets.map(url => createHash('sha256').update(readFileSync(url)).digest('hex'))
const corpusPath = `${directory}corpus.json`
const seeds = [Buffer.alloc(0), Buffer.from([0xff]), ...Object.values(KINDS).map(kind => encodeHeader({ kind, seq: 0 })),
  ...[{ id: 'AAAAAAAAAAA', m: 'session.list', p: {} }, { id: 'AAAAAAAAAAA', r: {} },
    { type: 'ping' }, { type: 'bye' }, { kind: 'snapshot', records: [] }, null].map(value => Buffer.from(JSON.stringify(value))),
  Buffer.from([0, 0, 0, 1, 0x44]), Buffer.from([0, 0, 0, 0]), Buffer.from([0xff, 0xff, 0xff, 0xff])]
if (existsSync(corpusPath)) {
  const saved = JSON.parse(readFileSync(corpusPath, 'utf8'))
  if (saved.format !== 1 || !Array.isArray(saved.inputs) || saved.inputs.length > 512) throw new Error('invalid persisted fuzz corpus')
  for (const input of saved.inputs) {
    if (typeof input !== 'string' || input.length > 1368) throw new Error('oversized corpus entry')
    const bytes = Buffer.from(input, 'base64')
    if (bytes.length > 1024) throw new Error('oversized decoded corpus entry')
    seeds.push(bytes)
  }
}
const corpus = [], seen = new Set(), ranges = new Set()
let state = 0x4d344356, iterations = 0, discoveries = 0, input = Buffer.alloc(0)
const next = maximum => {
  state ^= state << 13; state ^= state >>> 17; state ^= state << 5
  return (state >>> 0) % maximum
}
const expectedError = operation => {
  try { return operation() }
  catch (error) { assert.ok(error instanceof ProtocolError, `unexpected parser error: ${error}`); return undefined }
}
function records(bytes, split) {
  const received = [], decoder = new RecordDecoder(record => received.push(record.toString('hex')))
  let error
  try {
    for (let offset = 0; offset < bytes.length;) {
      const end = split ? Math.min(bytes.length, offset + 1 + bytes[offset] % 31) : bytes.length
      decoder.push(bytes.subarray(offset, end)); offset = end
    }
  } catch (failure) {
    assert.ok(failure instanceof ProtocolError, `unexpected TCP error: ${failure}`)
    error = failure.code
  }
  return { received, error, offset: decoder.offset, pending: decoder.record?.length ?? null }
}
function exercise(bytes) {
  const header = expectedError(() => decodeHeader(bytes))
  if (header) assert.deepEqual(encodeHeader(header), bytes.subarray(0, 16))
  for (let kind = 0; kind <= 8; kind++) {
    const value = expectedError(() => decodePayload(kind, bytes))
    if (value !== undefined) assert.deepEqual(decodePayload(kind, encodePayload(kind, value)), value)
  }
  assert.deepEqual(records(bytes, true), records(bytes, false))
}
function mutate(bytes) {
  const position = next(bytes.length + 1)
  switch (next(4)) {
    case 0: {
      const result = Buffer.from(bytes.length ? bytes : Buffer.from([0]))
      result[next(result.length)] ^= 1 + next(255)
      return result
    }
    case 1: return Buffer.concat([bytes.subarray(0, position), Buffer.from([next(256)]), bytes.subarray(position)]).subarray(0, 1024)
    case 2: return Buffer.concat([bytes.subarray(0, position), bytes.subarray(position + 1)])
    default: return Buffer.concat([bytes.subarray(0, position), corpus[next(corpus.length)]]).subarray(0, 1024)
  }
}
const inspector = new Session()
inspector.connect()
const started = Date.now()
let lastProgress = started, seededRanges = 0
try {
  await inspector.post('Profiler.enable')
  await inspector.post('Profiler.startPreciseCoverage', { callCount: true, detailed: true })
  for (let index = 0; index < seeds.length || (iterations < limit && Date.now() - started < seconds * 1000); index++) {
    const isSeed = index < seeds.length
    input = isSeed ? seeds[index] : mutate(corpus[next(corpus.length)])
    exercise(input)
    // Coverage counters reset after each input; only target source ranges guide retention.
    const coverage = await inspector.post('Profiler.takePreciseCoverage')
    let gained = false
    for (const script of coverage.result) {
      if (!targets.some(url => url.href === script.url)) continue
      for (const fn of script.functions) for (const range of fn.ranges) {
        const key = `${script.url}:${fn.functionName}:${range.startOffset}:${range.endOffset}`
        if (range.count > 0 && !ranges.has(key)) { ranges.add(key); gained = true }
      }
    }
    const key = input.toString('base64')
    if ((isSeed || gained) && !seen.has(key) && corpus.length < 512) { corpus.push(Buffer.from(input)); seen.add(key) }
    if (isSeed) seededRanges = ranges.size
    else { iterations++; if (gained) discoveries++ }
    if (Date.now() - lastProgress >= 15000) {
      console.log(JSON.stringify({ iterations, ranges: ranges.size, discoveries, corpus: corpus.length }))
      lastProgress = Date.now()
    }
  }
  assert.ok(seededRanges > 0, 'V8 target coverage is unavailable')
  writeFileSync(corpusPath, JSON.stringify({ format: 1, sourceHashes, inputs: corpus.map(bytes => bytes.toString('base64')) }))
  const report = { passed: true, engine: 'V8 precise block ranges', node: process.version, sourceHashes,
    seed: '0x4d344356', secondsBudget: seconds, iterationBudget: limit, elapsedMs: Date.now() - started,
    iterations, seededRanges, executedRanges: ranges.size, discoveries, corpus: corpus.length,
    scope: 'Node DR headers/payloads and TCP record decoding; excludes Dart, Noise and WebSocket state machines' }
  writeFileSync(`${directory}report.json`, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify(report))
} catch (error) {
  writeFileSync(`${directory}failure.json`, JSON.stringify({ input: input.toString('base64'), iterations, state: state >>> 0, sourceHashes, error: String(error) }))
  throw error
} finally {
  inspector.disconnect()
}
