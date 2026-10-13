// Run under tools/run-limited.sh; optional M3_TUNNEL=1 checks genuine public WSS.
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync, symlinkSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { setTimeout as delay } from 'node:timers/promises'
import { localRequest } from '../packages/dsh-plugin/src/local.js'

const root = resolve(import.meta.dirname, '..')
const modules = process.env.DSH_HOST_MODULE_ROOT
if (!modules) throw new Error('DSH_HOST_MODULE_ROOT is required')
const version = JSON.parse(readFileSync(join(modules, '@deepseek-ai/dsh/package.json'), 'utf8')).version
assert.equal(version, '0.1.7-rc.2', 'M3 integration requires the validated DSH version')
const directory = mkdtempSync(join(tmpdir(), 'dsh-m3-mobile-'))
const profile = join(directory, 'profiles', 'remote-test')
const workspace = join(directory, 'workspace')
const state = join(profile, 'remote')
const hosts = []
let dart
let sequence = 0
const pending = new Map()
let baselineMode = false
const publicTunnel = process.env.M3_TUNNEL === '1'

async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise(resolve => child.once('exit', resolve))
  child.kill('SIGTERM')
  await Promise.race([exited, delay(5000)])
  if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await exited }
}

async function startHost() {
  const child = spawn(process.execPath, [join(modules, '@deepseek-ai/dsh/lib/bin.js'), '--profile', 'remote-test', '--no-open', '--port', '0'], {
    cwd: workspace,
    env: { ...process.env, DSH_HOME: directory, DSH_TELEMETRY_DISABLED: '1', M2_LIVE_MODEL: '', M2_LIVE_PROVIDER: '', M3_BASELINE_MODE: baselineMode ? '1' : '0' },
    stdio: ['ignore', 'ignore', 'ignore'],
  })
  hosts.push(child)
  let launchError
  let status
  child.once('error', error => { launchError = error })
  for (let attempt = 0; attempt < 200; attempt++) {
    try {
      const current = await localRequest(state, 'status')
      if (!baselineMode || existsSync(join(profile, 'baseline-ready'))) { status = current; break }
    } catch {}
    if (launchError || child.exitCode !== null) break
    await delay(100)
  }
  if (!status) throw new Error('isolated DSH fixture failed startup')
  // Keep tunnel errors outside the local startup probe's retry catch.
  if (publicTunnel) {
    const tunnel = await localRequest(state, 'tunnel.start')
    assert.equal(new URL(tunnel.endpoint).protocol, 'wss:')
    status = { ...status, endpoint: tunnel.endpoint }
  }
  return { child, status }
}

async function coldStart(operation) {
  for (let attempt = 0; ; attempt++) {
    try { return await operation() }
    catch (error) {
      if (!publicTunnel || attempt >= 3 || !['transport/lost', 'tunnel/busy'].includes(error.code)) throw error
      await delay(250 * 2 ** attempt)
    }
  }
}

function command(command, params = {}) {
  assert(pending.size < 8, 'driver command budget exceeded')
  const id = ++sequence
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Dart ${command} timed out`)) }, 30000)
    pending.set(id, { resolve, reject, timer, command })
    dart.stdin.write(`${JSON.stringify({ id, command, params })}\n`)
  })
}

function rpc(method, params = {}) { return command('request', { method, params }) }
function first(method, params = {}) { return command('first', { method, params }) }
async function run(text, options = {}) {
  const result = await command('run', { cwd: workspace, text, requestId: `m3-${sequence}`, ...options })
  assert.equal(result.userMessages, 1)
  assert(result.assistantMessages >= 1)
  assert(result.liveFrames > 0)
  if (options.approval) { assert(result.approved); assert(result.allowed) }
  if (options.question) assert(result.answered)
  assert(result.stateMessagesVerified)
  if (options.baseline) assert(result.compactBaselineVerified)
  return result
}

try {
  mkdirSync(join(profile, 'node_modules'), { recursive: true, mode: 0o700 })
  mkdirSync(workspace, { mode: 0o700 })
  symlinkSync(join(modules, '@deepseek-ai'), join(profile, 'node_modules', '@deepseek-ai'))
  symlinkSync(join(root, 'packages/dsh-plugin'), join(profile, 'node_modules', 'dsh-remote-everywhere'))
  writeFileSync(join(profile, 'package.json'), JSON.stringify({ name: 'dsh-m3-mobile-fixture', private: true, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-remote-everywhere'] } } }))
  const baselinePlugin = join(profile, 'm3-baseline.mjs')
  writeFileSync(baselinePlugin, `
import { createRequire } from 'node:module'
import { setTimeout as delay } from 'node:timers/promises'
import { writeFileSync } from 'node:fs'
const require = createRequire(process.env.DSH_HOST_MODULE_ROOT + '/@deepseek-ai/dsh/package.json')
const { LlmAdapter } = await import(require.resolve('@deepseek-ai/dsh-llm'))
export const inject = ['llm']
export function apply(ctx) {
  class BaselineAdapter extends LlmAdapter {
    providerInfo() { return { id: 'm3-baseline', name: 'M3 compact baseline fixture' } }
    async listModels() { return [{ provider: 'm3-baseline', id: 'fixture', name: 'fixture' }] }
    async resolveModel() { return { provider: 'm3-baseline', id: 'fixture', name: 'fixture', contextWindow: 65536 } }
    async *stream(options) {
      options.signal?.throwIfAborted()
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: 'M3_' }
      yield { type: 'text-delta', index: 0, text: 'BASELINE_' }
      await delay(3000, undefined, { signal: options.signal })
      yield { type: 'text-delta', index: 0, text: 'OK' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'M3_BASELINE_OK' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  ctx.llm.registerAdapter(['m3-baseline'], new BaselineAdapter())
  if (process.env.M3_BASELINE_MODE === '1') ctx.inject(['agentDefaultModel'], async scoped => {
    await scoped.agentDefaultModel.saveSelection({ provider: 'm3-baseline', model: 'fixture' })
    writeFileSync(${JSON.stringify(join(profile, 'baseline-ready'))}, 'ready', { mode: 0o600 })
  })
}
`, { mode: 0o600 })
  writeFileSync(join(profile, 'cordis.patch.yml'), `- id: agent-default-model\n  config:\n    provider: m2-fixture\n    model: fixture\n- id: session-query-sqlite\n  config:\n    path: ":memory:"\n    openAt: first-search\n- id: remote-everywhere\n  config:\n    cloudflared: ${join(root, 'spikes/tunnel/cloudflared')}\n- id: session-title-llm\n  disabled: true\n- insert:\n    - id: m3-test-model\n      name: ${join(root, 'tools/fixtures/m2-host.js')}\n    - id: m3-baseline-model\n      name: ${baselinePlugin}\n`)
  writeFileSync(join(workspace, 'm3-read.txt'), 'x'.repeat(100000))
  let host = await startHost()
  dart = spawn(process.env.DART_BIN ?? 'dart', ['run', 'bin/mobile_smoke.dart'], {
    cwd: join(root, 'packages/core/dart'), stdio: ['pipe', 'pipe', 'pipe'],
  })
  // Never forward decrypted frames, QR payloads, SAS, or tool arguments to logs.
  dart.stderr.resume()
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Dart driver failed startup')), 30000)
    dart.once('error', reject)
    dart.once('exit', () => {
      clearTimeout(timer)
      reject(new Error('Dart driver exited'))
      for (const task of pending.values()) { clearTimeout(task.timer); task.reject(new Error('Dart driver exited')) }
      pending.clear()
    })
    const lines = createInterface({ input: dart.stdout })
    lines.on('line', line => {
      try {
        assert(line.length < 4 * 1024 * 1024, 'driver response exceeds limit')
        const message = JSON.parse(line)
        if (message.event === 'ready') { clearTimeout(timer); resolve(); return }
        if (message.event === 'sas') {
          ;(async () => {
            for (let attempt = 0; attempt < 100; attempt++) {
              const local = await localRequest(state, 'pair.pending')
              if (local?.sas) {
                assert.equal(local.sas, message.sas, 'SAS mismatch')
                await localRequest(state, 'pair.confirm', { sas: local.sas })
                await command('sas.confirm', { confirmed: true })
                return
              }
              await delay(10)
            }
            throw new Error('host pairing SAS unavailable')
          })().catch(error => {
            for (const task of pending.values()) { clearTimeout(task.timer); task.reject(error) }
            pending.clear()
          })
          return
        }
        const task = pending.get(message.id)
        if (!task) return
        pending.delete(message.id); clearTimeout(task.timer)
        message.error ? task.reject(Object.assign(new Error(`Dart command ${task.command} rejected: ${message.error.code}${message.error.detail ? ` (${message.error.detail})` : ''}`), { code: message.error.code })) : task.resolve(message.result)
      } catch (error) { reject(error); dart.kill('SIGTERM') }
    })
  })
  await ready
  const qr = await localRequest(state, 'pair.begin', { caps: ['session', 'stream', 'approval', 'files'] })
  const paired = await coldStart(() => command('pair', qr))
  assert((await localRequest(state, 'device.list')).devices.some(item => item.deviceId === paired.deviceId))
  assert.equal((await coldStart(() => command('connect', { endpoint: host.status.endpoint }))).peerRole, 'controlled')
  await assert.rejects(rpc('session.prompt', { sessionId: 'invalid', requestId: 'invalid', mode: 'invalid', content: [{ type: 'text', text: 'invalid' }] }), { code: 'invalid-argument' })
  assert((await rpc('workspace.list')).items.some(item => item.path === workspace))
  assert.equal((await first('control.subscribe')).type, 'baseline')
  const completed = await run('M3_SMOKE_OK')
  await run('APPROVAL_PROBE', { approval: true })
  await run('QUESTION_PROBE', { question: true })
  const upload = await command('upload', { sessionId: completed.sessionId })
  assert.equal(upload.file.bytes, 60000)
  assert(upload.receiptId)
  await rpc('session.prompt', { sessionId: completed.sessionId, requestId: 'm3-upload', mode: 'queue', content: [{ type: 'text', text: 'M3 attachment' }, { type: 'file', receiptId: upload.receiptId }] })
  const file = await command('read', { sessionId: completed.sessionId, path: 'm3-read.txt' })
  assert.equal(file.bytes, 100000)
  assert(file.chunks > 1)
  await assert.rejects(rpc('files.read', { sessionId: completed.sessionId, path: '..' }), { code: 'unauthorized' })
  const followed = await run('M3_RECOVERY_OK')
  const address = { kind: 'session', sessionId: followed.sessionId }
  const loss = await command('loss', { address })
  const before = loss.openings
  assert.equal(loss.lost.length, 2)
  assert(loss.lost.every(code => code === 'transport/lost'))
  await coldStart(() => command('connect', { endpoint: host.status.endpoint }))
  const recovered = await Promise.all(before.map(frame => first('stream.open', { address, sinceSeq: frame.cursor, maxMessages: 1 })))
  for (let index = 0; index < recovered.length; index++) {
    assert.equal(recovered[index].kind, 'snapshot')
    assert.equal(recovered[index].cursor, before[index].cursor)
    assert.equal(recovered[index].records.filter(record => record.event.seq > before[index].cursor).length, 0)
  }
  await command('close')
  await stop(host.child)
  baselineMode = true
  const patchPath = join(profile, 'cordis.patch.yml')
  writeFileSync(patchPath, readFileSync(patchPath, 'utf8').replace('provider: m2-fixture', 'provider: m3-baseline'))
  host = await startHost()
  assert.equal(host.status.deviceId, paired.hostDeviceId, 'restarted endpoint must retain the original device identity')
  await coldStart(() => command('connect', { endpoint: host.status.endpoint }))
  const rebooted = await first('stream.open', { address, sinceSeq: followed.cursor - 5, maxMessages: 1 })
  assert.equal(rebooted.kind, 'snapshot')
  assert(rebooted.cursor >= followed.cursor)
  assert(rebooted.records.some(record => record.event.seq > followed.cursor - 5))
  await run('M3_BASELINE_PROBE', { baseline: true })
  await localRequest(state, 'device.revoke', { deviceId: paired.deviceId })
  await command('closed')
  await assert.rejects(coldStart(() => command('connect', { endpoint: host.status.endpoint })), { code: 'unauthorized' })
  console.log(JSON.stringify({ dshVersion: version, genuineDshHost: true, dartMobileController: true, deterministicFixture: true, pairingBothSas: true, localManagementConfirmation: true, sessionPromptFollow: true, sessionStateMessages: true, userContextRows: completed.userRows - completed.userMessages, userSourceKinds: completed.userSourceKinds, realCompactBaseline: true, approval: true, question: true, uploadChunked: true, readStreamChunked: true, rpcFailureIsolation: true, twoSubscriptionResume: true, hostRestartResume: true, revokedConnectionClosed: true, revokedAuthenticationRejected: true, testHeartbeatSeconds: 1, publicTunnel }))
} finally {
  for (const task of pending.values()) { clearTimeout(task.timer); task.reject(new Error('smoke cleanup')) }
  pending.clear()
  await stop(dart)
  for (const child of hosts) await stop(child)
  rmSync(directory, { recursive: true, force: true })
}
