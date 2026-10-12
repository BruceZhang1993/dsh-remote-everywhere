import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TunnelManager } from '../src/index.js'
import { setTimeout as delay } from 'node:timers/promises'

async function fixture(t, source) {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-remote-cloudflared-'))
  const binary = join(directory, 'cloudflared')
  await writeFile(binary, '#!/usr/bin/env node\n' + source, { mode: 0o755 })
  t.after(() => rm(directory, { recursive: true, force: true }))
  return { binary, directory }
}

test('URL remains private until readiness; concurrent start/stop share one child owner', async t => {
  const { binary } = await fixture(t, "console.error('ready https://fixture.trycloudflare.com'); setInterval(() => {}, 1000)")
  let release
  const gate = new Promise(resolve => { release = resolve })
  let probed
  const called = new Promise(resolve => { probed = resolve })
  const manager = new TunnelManager({ binary, probe: async () => { probed(); await gate } })
  t.after(() => manager.stop())
  const first = manager.start('http://127.0.0.1:8787')
  const second = manager.start('http://127.0.0.1:8787')
  assert.equal(first, second)
  await called
  assert.equal(manager.url, null)
  release()
  assert.equal(await first, 'https://fixture.trycloudflare.com')
  const pid = manager.child.pid
  await Promise.all([manager.stop(), manager.stop()])
  assert.equal(manager.url, null)
  assert.equal(manager.state, 'stopped')
  assert.throws(() => process.kill(pid, 0), error => error.code === 'ESRCH')
})

test('startup timeout and explicit cancellation terminate the process group', async t => {
  const { binary } = await fixture(t, 'setInterval(() => {}, 1000)')
  const manager = new TunnelManager({ binary, startupTimeoutMs: 100 })
  t.after(() => manager.stop())
  await assert.rejects(manager.start('http://127.0.0.1:8787'), error => error.code === 'tunnel/timeout')
  assert.equal(manager.state, 'stopped')
  const pending = manager.start('http://127.0.0.1:8787')
  const rejected = assert.rejects(pending)
  await manager.stop()
  await rejected
  assert.equal(manager.url, null)
})

test('missing binary and non-loopback origin fail without publishing an endpoint', async () => {
  const manager = new TunnelManager({ binary: '/does-not-exist/dsh-cloudflared' })
  assert.throws(() => manager.start('http://0.0.0.0:8787'), error => error.code === 'invalid-argument')
  await assert.rejects(manager.start('http://127.0.0.1:8787'), error => error.code === 'tunnel/spawn')
  assert.equal(manager.url, null)
})

test('SIGKILL escalation removes a helper that outlives its direct parent', { skip: process.platform === 'win32' }, async t => {
  const { binary, directory } = await fixture(t, `
    const {spawn}=require('node:child_process'); const fs=require('node:fs');
    const helper=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});process.send({ready:true});setInterval(()=>{},1000)"],{stdio:['ignore','inherit','inherit','ipc']});
    fs.writeFileSync(__filename+'.pid',String(helper.pid));
    helper.once('message',()=>console.error('https://fixture.trycloudflare.com'));
    setInterval(()=>{},1000);
  `)
  const manager = new TunnelManager({ binary, probe: async () => {}, stopTimeoutMs: 100 })
  t.after(() => manager.stop())
  await manager.start('http://127.0.0.1:8787')
  const helper = Number(await readFile(join(directory, 'cloudflared.pid'), 'utf8'))
  await manager.stop()
  const alive = () => { try { process.kill(helper, 0); return true } catch { return false } }
  // A reaped group member can briefly be visible as a zombie; it must not execute further work.
  if (alive()) {
    const status = await readFile(`/proc/${helper}/stat`, 'utf8').catch(() => '')
    assert.ok(status === '' || /\) Z /.test(status))
  }
})

test('readiness retries are bounded by one startup deadline, and long logs do not accumulate', async t => {
  const { binary } = await fixture(t, "console.error('x'.repeat(100000));console.error('https://fixture.trycloudflare.com');setInterval(()=>{},1000)")
  const manager = new TunnelManager({ binary, startupTimeoutMs: 200, probe: async () => { throw new Error('not ready') } })
  let truncated = false
  manager.on('diagnostic', event => { truncated ||= event.truncated })
  await assert.rejects(manager.start('http://127.0.0.1:8787'))
  assert.equal(truncated, true)
  assert.equal(manager.state, 'stopped')
})

test('stop cancels a readiness provider that ignores its signal', async t => {
  const { binary } = await fixture(t, "console.error('https://fixture.trycloudflare.com');setInterval(()=>{},1000)")
  let entered
  const started = new Promise(resolve => { entered = resolve })
  const manager = new TunnelManager({ binary, probe: () => { entered(); return new Promise(() => {}) } })
  t.after(() => manager.stop())
  const starting = manager.start('http://127.0.0.1:8787')
  const failed = assert.rejects(starting, error => error.code === 'cancelled')
  await started
  await manager.stop()
  await failed
  assert.equal(manager.child, null)
})

test('unexpected exit invalidates URL; restart reclaims old owner and concurrent stop prevents a late spawn', async t => {
  const { binary } = await fixture(t, "console.error('https://fixture.trycloudflare.com');setTimeout(()=>process.exit(0),50)")
  const manager = new TunnelManager({ binary, probe: async () => {} })
  t.after(() => manager.stop())
  await manager.start('http://127.0.0.1:8787')
  await manager.exited
  assert.equal(manager.url, null)
  assert.equal(manager.state, 'failed')
  const oldPid = manager.child.pid
  await manager.start('http://127.0.0.1:8787')
  assert.notEqual(manager.child.pid, oldPid)
  await manager.exited
  const restarting = manager.start('http://127.0.0.1:8787')
  const cancelled = assert.rejects(restarting, error => error.code === 'cancelled')
  await manager.stop()
  await cancelled
  await delay(10)
  assert.equal(manager.child, null)
  assert.equal(manager.state, 'stopped')
})
