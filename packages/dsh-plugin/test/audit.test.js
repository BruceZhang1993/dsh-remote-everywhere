import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, lstatSync, symlinkSync, unlinkSync, linkSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AuditLog, MAX_AUDIT_BYTES, MAX_AUDIT_RECORD_BYTES } from '../src/audit.js'
import { RemoteRuntime } from '../src/runtime.js'
import { DeviceStore } from '../src/store.js'
import { pairDevice } from '../src/client.js'
import { BLAKE2S, SecureConnection, connectTransport, deviceId } from '@dsh-remote/core'

function directory(t) {
  const path = mkdtempSync(join(tmpdir(), 'dsh-audit-'))
  t.after(() => rmSync(path, { recursive: true, force: true }))
  return path
}
const records = path => readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line))

test('audit records whitelist bounded metadata and never request/response secrets', t => {
  const path = directory(t), audit = new AuditLog(path)
  t.after(() => audit.close())
  const secret = 'SECRET-MUST-NOT-ENTER-AUDIT'
  audit.record('rpc.completed', { deviceId: 'device', method: 'session.prompt', bytes: 123,
    params: { prompt: secret }, response: secret, sid: secret, sas: secret, privateKey: secret, reason: secret,
    endpoint: `https://example.test/?sid=${secret}`, name: secret, code: `Error: ${secret}` })
  audit.record('interaction.decided', { toolName: '\u0000'.repeat(20000), sessionId: '\\'.repeat(20000) })
  const text = readFileSync(audit.path, 'utf8')
  assert.equal(text.includes(secret), false)
  assert.equal(records(audit.path)[0].code, 'internal')
  assert.equal(records(audit.path)[0].pid, process.pid)
  assert.equal(records(audit.path)[1].truncated, true)
  assert.ok(text.split('\n').every(line => Buffer.byteLength(`${line}\n`) <= MAX_AUDIT_RECORD_BYTES))
  assert.equal(lstatSync(audit.path).mode & 0o777, 0o600)
})

test('audit rotates before exceeding 1 MiB and retains only one bounded previous file', t => {
  const path = directory(t), audit = new AuditLog(path)
  t.after(() => audit.close())
  for (const marker of ['old', 'new']) {
    writeFileSync(audit.path, `${marker}\n${' '.repeat(MAX_AUDIT_BYTES - 8)}`)
    audit.record('rpc.completed', { method: 'session.list' })
    assert.ok(lstatSync(audit.path).size <= MAX_AUDIT_BYTES)
    assert.ok(lstatSync(audit.previous).size <= MAX_AUDIT_BYTES)
    assert.ok(readFileSync(audit.previous, 'utf8').startsWith(marker))
    assert.equal(records(audit.path).length, 1)
  }
  audit.close()
  const reopened = new AuditLog(path)
  reopened.record('runtime.started')
  reopened.close()
  assert.equal(records(audit.path).length, 2)
})

test('unsafe current/previous files, permissions, hardlinks and oversized legacy logs refuse startup', t => {
  const root = directory(t)
  for (const mode of ['symlink', 'previous-symlink', 'permissions', 'hardlink', 'oversized']) {
    const path = join(root, mode)
    mkdirSync(path)
    const target = join(root, `${mode}-target`)
    writeFileSync(target, 'unchanged', { mode: 0o600 })
    const current = join(path, 'audit.jsonl')
    if (mode === 'symlink') symlinkSync(target, current)
    if (mode === 'previous-symlink') symlinkSync(target, `${current}.previous`)
    if (mode === 'permissions') { writeFileSync(current, '', { mode: 0o600 }); chmodSync(current, 0o644) }
    if (mode === 'hardlink') linkSync(target, current)
    if (mode === 'oversized') writeFileSync(current, ' '.repeat(MAX_AUDIT_BYTES + 1), { mode: 0o600 })
    assert.throws(() => new AuditLog(path))
    assert.equal(readFileSync(target, 'utf8'), 'unchanged')
  }
})

test('replacement after open latches failure, alerts once and never follows a symlink', t => {
  const path = directory(t)
  let alerts = 0
  const audit = new AuditLog(path, () => alerts++)
  const target = join(path, 'unrelated')
  writeFileSync(target, 'unchanged')
  unlinkSync(audit.path)
  symlinkSync(target, audit.path)
  for (let i = 0; i < 3; i++) assert.throws(() => audit.record('rpc.received'), { code: 'internal' })
  assert.equal(alerts, 1)
  assert.equal(readFileSync(target, 'utf8'), 'unchanged')
  audit.close()
})

async function runtimeFixture(t) {
  const path = directory(t)
  let writes = 0, alerts = 0
  const sessionController = Object.fromEntries(['list', 'search', 'create', 'fork', 'rename', 'prompt', 'cancel', 'updateQueue', 'attachment', 'projections', 'follow', 'page', 'control'].map(method => [method, async () => {
    if (method === 'prompt') writes++
    return { items: [] }
  }]))
  const ctx = { sessionController, on: () => () => {}, get: () => null, logger: { error: () => alerts++ } }
  const runtime = await new RemoteRuntime(ctx, { directory: join(path, 'host') }).start()
  t.after(() => runtime.close())
  const controller = new DeviceStore(join(path, 'client'))
  t.after(() => controller.close())
  const connect = async (key = controller.keyPair) => {
    const connection = new SecureConnection(await connectTransport(runtime.endpoint), {
      initiator: true, keyPair: key, peerPublicKey: runtime.store.keyPair.publicKey,
      caps: ['session', 'stream', 'files'], kind: 'dsh',
    })
    t.after(() => connection.close())
    await connection.ready
    return connection
  }
  return { runtime, controller, connect, writes: () => writes, alerts: () => alerts }
}

test('real server audits pair, auth, success, denied/invalid RPCs, revoke and normal teardown without payloads', async t => {
  const { runtime, controller, connect } = await runtimeFixture(t)
  runtime.pairing.on('pending', value => runtime.pairing.confirm(value.sas))
  const qr = runtime.pairing.begin(runtime.endpoint)
  await pairDevice(controller, qr, async () => true)
  const connection = await connect()
  await connection.request('session.list')
  await assert.rejects(connection.request('files.read', { sessionId: 'one', path: 'SECRET-FILE' }), { code: 'unauthorized' })
  await assert.rejects(connection.request('session.rename', { sessionId: 'one' }), { code: 'invalid-argument' })
  await assert.rejects(connection.request('SECRET-UNKNOWN-METHOD', { secret: 'SECRET-PAYLOAD' }), { code: 'unsupported' })
  await connection.request('session.list')
  await assert.rejects(connect(BLAKE2S.generateKeyPair()), { code: 'unauthorized' })
  runtime.revoke(deviceId(controller.keyPair.publicKey))
  await connection.closed
  // Audit runtime shutdown separately from an ordinary device disconnect.
  runtime.store.grant(controller.keyPair.publicKey, 'test', ['session', 'stream'])
  await connect()
  await runtime.close()
  const text = readFileSync(runtime.audit.path, 'utf8'), events = records(runtime.audit.path)
  for (const event of ['pairing.opened', 'pairing.claimed', 'pairing.local-confirmed', 'pairing.grant', 'pairing.completed',
    'connection.accepted', 'connection.authenticated', 'connection.rejected', 'rpc.received', 'rpc.completed', 'device.revoked', 'runtime.stopped']) {
    assert.ok(events.some(item => item.event === event), event)
  }
  assert.ok(events.some(item => item.event === 'rpc.completed' && item.code === 'unauthorized'))
  assert.ok(events.some(item => item.event === 'connection.closed' && item.status === 'normal-shutdown'))
  for (const secret of [qr.sid, qr.pk, 'SECRET-FILE', 'SECRET-UNKNOWN-METHOD', 'SECRET-PAYLOAD']) assert.equal(text.includes(secret), false)
})

test('audit failure blocks a write, yet local revocation and cleanup still complete', async t => {
  const fixture = await runtimeFixture(t), { runtime, controller, connect } = fixture
  runtime.store.grant(controller.keyPair.publicKey, 'test', ['session', 'stream'])
  const connection = await connect()
  unlinkSync(runtime.audit.path)
  await assert.rejects(connection.request('session.prompt', { sessionId: 'one', requestId: 'request-1', input: 'SECRET' }))
  assert.equal(fixture.writes(), 0)
  assert.equal(fixture.alerts(), 1)
  runtime.revoke(deviceId(controller.keyPair.publicKey))
  assert.equal(runtime.store.find(controller.keyPair.publicKey), undefined)
  await runtime.close()
  assert.equal(runtime.audit.closed, true)
})

test('handshake flood is bounded, returns 429 and leaves a redacted busy audit record', async t => {
  const { runtime, controller, connect } = await runtimeFixture(t)
  runtime.store.grant(controller.keyPair.publicKey, 'test', ['session', 'stream'])
  for (let index = 0; index < 10; index++) {
    const connection = await connect()
    connection.close()
  }
  await assert.rejects(connectTransport(runtime.endpoint), { code: 'tunnel/busy' })
  assert.equal(runtime.attempts.size, 1)
  assert.ok(records(runtime.audit.path).some(item => item.event === 'connection.rejected' && item.code === 'busy'))
})
