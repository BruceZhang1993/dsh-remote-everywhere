import test from 'node:test'
import assert from 'node:assert/strict'
import { RemoteRuntime } from '../src/runtime.js'

const agent = (id, parentSession) => ({ session: { header: { id, parentSession } } })
test('remote control cycles are stopped for live and cold descendants and fork lineage', async () => {
  const live = new Map([['remote', agent('remote')]])
  let closed = 0
  const runtime = { remotelyDriven: new Set(['remote']), ctx: { get: () => ({ get: id => live.get(id) }), sessionController: { async *follow() { try { yield { header: { id: 'cold', parentSession: 'remote' } } } finally { closed++ } } } } }
  const check = value => RemoteRuntime.prototype.remoteDriven.call(runtime, value)
  assert.equal(await check(agent('child', 'remote')), true)
  assert.equal(await check(agent('fork', 'cold')), true)
  assert.equal(closed, 1)
  assert.equal(await check(agent('local')), false)
  live.set('cycle', agent('cycle', 'cycle'))
  await assert.rejects(check(agent('child', 'cycle')), { code: 'unauthorized' })
})
