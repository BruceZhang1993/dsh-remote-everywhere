// Resolve everything from noise-handshake's own resolution context so the probe
// works under npm's flat layout and pnpm's isolated layout alike.
import { createRequire } from 'node:module'

const report = { layout: process.argv[2] || 'unknown' }
const rootRequire = createRequire(import.meta.url)

let hsRequire
try {
  hsRequire = createRequire(rootRequire.resolve('noise-handshake'))
  report.noiseHandshakeResolved = rootRequire.resolve('noise-handshake').replace(process.cwd(), '$DIR')
} catch (e) {
  console.log(JSON.stringify({ ...report, fatal: 'noise-handshake not resolvable: ' + e.message }, null, 2))
  process.exit(0)
}

try {
  report.sodiumNativeEntry = hsRequire.resolve('sodium-native').replace(process.cwd(), '$DIR')
} catch (e) { report.sodiumNativeResolveError = e.message }

try {
  const sodium = hsRequire('sodium-universal')
  const b4a = hsRequire('b4a')
  const pk = b4a.alloc(32); const sk = b4a.alloc(32); const out = b4a.alloc(32)
  sodium.crypto_kx_keypair(pk, sk)
  sodium.crypto_scalarmult(out, sk, pk)
  report.dhWorks = out.some(b => b !== 0)
  report.sodiumKeyCount = Object.keys(sodium).length
  report.hasBlake2s = Object.keys(sodium).some(k => /blake2s/i.test(k))
} catch (e) { report.sodiumError = String(e.message) }

// Which shared objects / addons did this process actually load?
try {
  const so = process.report.getReport().sharedObjects || []
  report.loadedNativeAddons = so.filter(p => /sodium-native|\.node$/.test(p)).map(p => p.replace(process.cwd(), '$DIR'))
} catch (e) { report.sharedObjectsError = String(e.message) }

try {
  const Noise = hsRequire('noise-handshake')
  const b4a = hsRequire('b4a')
  const i = new Noise('XX', true, null, {})
  const r = new Noise('XX', false, null, {})
  i.initialise(b4a.alloc(0)); r.initialise(b4a.alloc(0))
  const m1 = i.send(); r.recv(m1); const m2 = r.send(); i.recv(m2); const m3 = i.send(); r.recv(m3)
  report.noiseHandshakeWorks = i.complete && r.complete
  report.noiseProtocolName = i.protocol.toString()
  report.noiseHandshakeHash = b4a.from(i.hash).toString('hex').slice(0, 32) + '...'
} catch (e) { report.noiseHandshakeError = String(e.message) }

console.log(JSON.stringify(report, null, 2))
