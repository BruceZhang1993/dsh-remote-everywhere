// Isolated Node host for the Flutter controller regression tests.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RemoteRuntime } from '../../packages/dsh-plugin/src/runtime.js'
import { ProtocolError } from '../../packages/protocol/src/index.js'

const directory = mkdtempSync(join(tmpdir(), 'dsh-mobile-listing-'))
const mode = process.argv[3]
const legacy = mode === 'legacy'
const caps = mode === 'sessionOnly' ? ['session'] : ['session', 'stream']
const items = Array.from({ length: legacy || caps.length === 1 || mode === 'pairing' ? 1 : 120 }, (_, i) => ({ sessionId: `s-${i}`, title: '中文标题'.repeat(180) }))
const calls = []
const controller = Object.fromEntries(['list', 'search', 'create', 'fork', 'rename', 'prompt', 'cancel', 'updateQueue', 'attachment', 'projections', 'follow', 'page', 'control'].map(method => [method, async (params, signal) => {
  calls.push({ method, params })
  if (method === 'projections') return { calls }
  if (mode === 'delayed' && method === 'list') {
    if (!signal.aborted) await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }))
    throw new ProtocolError('cancelled', 'listing stopped')
  }
  if (params.query === 'fail') throw new ProtocolError('unsupported', 'search unavailable')
  return { items: method === 'search' && params.query !== 'all' ? items.filter(item => item.sessionId === params.query) : items }
}]))
controller.control = async function* (signal) {
  yield { type: 'baseline', value: { projections: {} } }
  if (!signal.aborted) await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }))
}
const ctx = {
  sessionController: controller,
  on: () => () => {},
  get: name => name === 'workspaceController' ? {
    async *follow() { yield { type: 'baseline', value: { items: [{ workspaceId: 'test', path: '/tmp/test' }] } } },
  } : null,
}
const runtime = await new RemoteRuntime(ctx, { directory }).start()
if (mode !== 'pairing') runtime.store.grant(Buffer.from(process.argv[2], 'base64url'), 'mobile fixture', caps)
let qr
if (mode === 'pairing') {
  qr = runtime.pairing.begin(runtime.endpoint, caps)
  runtime.pairing.on('pending', pending => runtime.pairing.confirm(pending.sas))
}
if (legacy) {
  const attach = runtime.attach.bind(runtime)
  runtime.attach = connection => {
    attach(connection)
    for (const method of ['session.list', 'session.search']) {
      const registered = connection.handlers.get(method)
      const handler = registered.handler
      registered.handler = (params, options) => {
        if (params.streamId !== undefined) throw new ProtocolError('invalid-argument', 'invalid legacy params')
        return handler(params, options)
      }
    }
  }
}
process.stdout.write(`${JSON.stringify({ endpoint: runtime.endpoint, publicKey: Buffer.from(runtime.store.keyPair.publicKey).toString('base64url'), caps, qr })}\n`)
process.stdin.resume()
await new Promise(resolve => process.stdin.once('end', resolve))
await runtime.close()
rmSync(directory, { recursive: true, force: true })
