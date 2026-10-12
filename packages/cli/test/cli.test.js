import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm, stat, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const cli = fileURLToPath(new URL('../src/index.js', import.meta.url))
function execute(args) {
  const child = spawn(process.execPath, [cli, ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = '', stderr = ''
  child.stdout.on('data', bytes => { stdout += bytes })
  child.stderr.on('data', bytes => { stderr += bytes })
  return { child, done: once(child, 'close').then(([code]) => ({ code, stdout, stderr })) }
}

test('CLI creates private identity files and two processes perform a real pinned encrypted RPC', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-remote-cli-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const hostPath = join(directory, 'host.key')
  const clientPath = join(directory, 'client.key')
  const host = await execute(['keygen', '--out', hostPath]).done
  const client = await execute(['keygen', '--out', clientPath]).done
  assert.equal(host.code, 0)
  assert.equal(client.code, 0)
  const hostPublic = JSON.parse(host.stdout).publicKey
  const clientPublic = JSON.parse(client.stdout).publicKey
  const privateHex = JSON.parse(await readFile(hostPath, 'utf8')).secretKey
  assert.equal(host.stdout.includes(privateHex), false)
  if (process.platform !== 'win32') assert.equal((await stat(hostPath)).mode & 0o777, 0o600)
  assert.equal((await execute(['keygen', '--out', hostPath]).done).code, 1)
  const serving = execute(['serve', '--key', hostPath, '--peer', clientPublic, '--port', '0'])
  t.after(async () => { if (serving.child.exitCode === null) serving.child.kill('SIGTERM'); await serving.done })
  const ready = await new Promise((resolve, reject) => {
    let buffer = ''
    serving.child.stdout.on('data', bytes => {
      buffer += bytes
      const lines = buffer.split('\n')
      buffer = lines.pop()
      for (const line of lines) { const value = JSON.parse(line); if (value.type === 'ready') resolve(value) }
    })
    serving.child.once('close', code => reject(new Error(`server exited before ready: ${code}`)))
  })
  const result = await execute(['doctor', '--key', clientPath, '--peer', hostPublic, '--endpoint', ready.endpoint]).done
  assert.equal(result.code, 0, result.stderr)
  assert.equal(JSON.parse(result.stdout).encrypted, true)
  assert.equal(JSON.parse(result.stdout).result.message, 'DSH Remote M1')
  const refused = await execute(['doctor', '--key', clientPath, '--peer', '00'.repeat(32), '--endpoint', ready.endpoint]).done
  assert.equal(refused.code, 1)
  assert.equal(refused.stdout, '')
  serving.child.kill('SIGTERM')
  assert.equal((await serving.done).code, 0)
})
