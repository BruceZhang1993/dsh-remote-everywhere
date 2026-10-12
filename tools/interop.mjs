import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { BLAKE2S, createRemoteServer } from '@dsh-remote/core'

const root = fileURLToPath(new URL('../', import.meta.url))
function run(command, args, cwd = root) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' })
    let output = '', errors = ''
    const terminate = () => {
      try { process.platform === 'win32' ? child.kill('SIGKILL') : process.kill(-child.pid, 'SIGKILL') }
      catch (error) { if (error.code !== 'ESRCH') throw error }
    }
    const timer = setTimeout(terminate, 30000)
    child.stdout.on('data', bytes => { output += bytes; if (output.length > 128 * 1024) terminate() })
    child.stderr.on('data', bytes => { errors += bytes; if (errors.length > 128 * 1024) terminate() })
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('close', code => { clearTimeout(timer); resolve({ code, output, errors }) })
  })
}

const temporary = mkdtempSync(join(tmpdir(), 'dsh-remote-vectors-'))
let server
try {
  const vectorPath = join(root, 'packages/protocol/vectors/xx25519-chachapoly-blake2s.json')
  const generatedPath = join(temporary, 'noise.json')
  const emitted = await run(process.execPath, ['tools/emit-vectors.js', generatedPath])
  if (emitted.code !== 0 || readFileSync(generatedPath, 'utf8') !== readFileSync(vectorPath, 'utf8')) throw new Error('promoted Noise no longer reproduces the frozen M0 vectors')
  const oracle = await run(process.execPath, ['tools/validate-vs-noise-handshake.js'])
  if (oracle.code !== 0) throw new Error(`BLAKE2b oracle failed: ${oracle.errors}\n${oracle.output}`)
  console.log('frozen Noise vectors and BLAKE2b third-party oracle passed')
  const vectors = JSON.parse(readFileSync(vectorPath))
  const keyPair = value => BLAKE2S.generateKeyPair(Buffer.from(value.secretKey, 'hex'))
  const hostKey = keyPair(vectors.applicationBindings.responderStatic)
  const clientKey = keyPair(vectors.applicationBindings.initiatorStatic)
  server = await createRemoteServer({ keyPair: hostKey, peerPublicKey: clientKey.publicKey, transport: 'tcp' })
  server.on('connection', connection => connection.register('diagnostic.echo', 'diagnostic', params => params))
  const port = new URL(server.endpoint).port
  const args = ['run', 'bin/interoperate.dart', port, Buffer.from(hostKey.publicKey).toString('hex'), vectorPath]
  const success = await run(process.env.DART_BIN ?? 'dart', args, join(root, 'packages/core/dart'))
  if (success.code !== 0 || !success.output.includes('"passed":true')) throw new Error(`Node↔Dart application-wire test failed: ${success.errors}`)
  const negative = await run(process.env.DART_BIN ?? 'dart', [...args, '--mismatch'], join(root, 'packages/core/dart'))
  if (negative.code !== 1) throw new Error('mismatched prologue was not rejected')
  console.log('live Node↔Dart encrypted DR RPC, ciphertext replay and wrong-prologue rejection passed')
} finally { await server?.close(); rmSync(temporary, { recursive: true, force: true }) }
