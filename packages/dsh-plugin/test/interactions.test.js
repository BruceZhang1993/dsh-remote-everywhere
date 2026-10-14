import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { InteractionBridge } from '../src/interactions.js'

// Load the genuine Cordis package without adding host dependencies to core.
const { Context } = await import(process.env.DSH_HOST_MODULE_ROOT
  ? `${process.env.DSH_HOST_MODULE_ROOT}/@deepseek-ai/cordis/lib/index.js`
  : '@deepseek-ai/cordis')

function fixture(timeoutMs = 200, audit) {
  const ctx = new Context()
  const client = Object.assign(new EventEmitter(), { state: 'ready', peerHello: { deviceId: 'fixture-device' }, events: [], sendFrame: async function(kind, value) { this.events.push(value) }, close() {} })
  const bridge = new InteractionBridge(ctx, () => [client], { timeoutMs, audit })
  const request = Object.freeze({ agent: { session: { id: 'session-1' } }, toolName: 'bash', signal: new AbortController().signal })
  return { ctx, client, bridge, request }
}

test('real Cordis: remote win withdraws native local request, dispatches locally once and leaves original request untouched', async () => {
  const { ctx, client, bridge, request } = fixture()
  let localCalls = 0
  let withdrawn = false
  ctx.on('approval/request', local => {
    localCalls++
    assert.notEqual(local, request)
    return new Promise(resolve => local.signal.addEventListener('abort', () => { withdrawn = true; resolve('cancelled') }, { once: true }))
  })
  const result = ctx.waterfall(ctx, 'approval/request', request, () => 'unavailable')
  await new Promise(resolve => setImmediate(resolve))
  const id = client.events[0].data.approvalId
  bridge.decide(id, 'allowed-once', client)
  assert.equal(await result, 'allowed-once')
  assert.equal(localCalls, 1)
  assert.equal(withdrawn, true)
  assert.equal(request.signal.aborted, false)
  assert.throws(() => bridge.decide(id, 'rejected', client), { code: 'not-found' })
  bridge.close()
  await ctx.fiber.dispose()
})

test('audit failure cannot turn a human allow into an executable grant or skip cleanup', async () => {
  const { ctx, client, bridge, request } = fixture(200, event => {
    if (event === 'interaction.decided') throw new Error('disk unavailable')
  })
  ctx.on('approval/request', local => new Promise(resolve => {
    local.signal.addEventListener('abort', () => resolve('cancelled'), { once: true })
  }))
  const pending = ctx.waterfall(ctx, 'approval/request', request, () => 'unavailable')
  await new Promise(resolve => setImmediate(resolve))
  bridge.decide(client.events[0].data.approvalId, 'allowed-once', client)
  assert.equal(await pending, 'cancelled')
  assert.equal(client.events.at(-1).data.outcome, 'cancelled')
  assert.equal(bridge.pending.size, 0)
  bridge.close()
  await ctx.fiber.dispose()
})

test('real Cordis: native local win, downstream throw, timeout and no remote preserve fail-closed semantics', async () => {
  const { ctx, client, bridge, request } = fixture(30)
  const disposeLocal = ctx.on('approval/request', async () => 'rejected')
  assert.equal(await ctx.waterfall(ctx, 'approval/request', request, () => 'unavailable'), 'rejected')
  assert.equal(client.events.at(-1).data.by, 'local')
  disposeLocal()
  ctx.on('approval/request', () => { throw new Error('local unavailable') })
  assert.equal(await ctx.waterfall(ctx, 'approval/request', request, () => 'unavailable'), 'cancelled')
  bridge.close()
  await ctx.fiber.dispose()
})
