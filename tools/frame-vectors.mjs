import { readFileSync, writeFileSync } from 'node:fs'
import { encodeHeader, encodePayload, KINDS } from '@dsh-remote/protocol'
import { CipherState } from '@dsh-remote/core/noise'

const key = Uint8Array.from({ length: 32 }, (_, index) => index) // Public deterministic test key only.
const examples = [
  { kind: KINDS.REQ, streamId: 0, seq: 0, payload: { id: 'AAAAAAAAAAA', m: 'diagnostic.echo', p: { text: '你好，DSH' } } },
  { kind: KINDS.EVT, streamId: 3, seq: 9007199254740991, payload: { kind: 'append', records: [{ type: 'diagnostic/event', seq: 8, time: 1, data: { value: 42 } }] } },
  { kind: KINDS.SDATA, streamId: 1, seq: 7, payload: Uint8Array.from([0, 255, 16, 32]) },
]
const contents = JSON.stringify({ version: 1, testKey: Buffer.from(key).toString('hex'), frames: examples.map(value => {
  const header = encodeHeader(value)
  const plaintext = encodePayload(value.kind, value.payload)
  return { kind: value.kind, streamId: value.streamId, seq: value.seq, header: header.toString('hex'), plaintext: plaintext.toString('hex'), wire: Buffer.concat([header, new CipherState(key).encrypt(plaintext, header)]).toString('hex') }
}) }, null, 2) + '\n'
const target = new URL('../packages/protocol/vectors/dr-v1.json', import.meta.url)
if (process.argv.includes('--check')) {
  if (readFileSync(target, 'utf8') !== contents) throw new Error('DR frame vectors are stale')
} else writeFileSync(target, contents)
