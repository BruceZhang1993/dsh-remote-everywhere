#!/usr/bin/env bash
# Investigates whether the native `sodium-native` path (which `noise-handshake`
# uses for DH and hashing) works without any approval-gated build step, and
# whether it survives isolated vs. hoisted node_modules layouts.
#
#   1. npm   (default, flat layout)
#   2. pnpm  (default, isolated/symlinked layout)
#   3. pnpm  (nodeLinker: hoisted)
#
# It also records whether the package manager reported any build script it
# wanted to run, and which prebuilt .node file Node actually dlopen()ed.
#
# Everything is created under spikes/noise-interop/sodium-tests/.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE="$ROOT/sodium-tests"
PROBE="$BASE/probe.mjs"
rm -rf "$BASE"
mkdir -p "$BASE"

cat > "$PROBE" <<'EOF'
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
EOF

run_layout () {
  local label="$1"; local dir="$2"; local installer="$3"; local log="$BASE/${dir}-install.log"
  echo "=============================================================="
  echo "$label"
  echo "=============================================================="
  mkdir -p "$BASE/$dir" && cp "$PROBE" "$BASE/$dir/"
  ( cd "$BASE/$dir" && npm init -y >/dev/null 2>&1 && eval "$installer" ) >"$log" 2>&1
  echo "--- installer output (filtered) ---"
  grep -vE "^\s*(Progress:|Downloading|Resolving)" "$log" | sed 's/^/    /' | head -20
  echo "--- install-script / compile markers ---"
  if grep -iE "ignored build|approve-builds|postinstall|preinstall|node-gyp|gyp ERR|cmake|cc1|g\+\+ " "$log"; then
    :
  else
    echo "    (none - no build script was requested or run)"
  fi
  echo "--- probe ($dir) ---"
  ( cd "$BASE/$dir" && node probe.mjs "$dir" ) | sed 's/^/    /'
  echo
}

run_layout "1) npm (flat layout)" "npm-flat" \
  "npm install --no-audit --no-fund --foreground-scripts noise-handshake@4.2.0"

run_layout "2) pnpm (default isolated layout)" "pnpm-isolated" \
  "pnpm install --config.confirmModulesPurge=false noise-handshake@4.2.0"

mkdir -p "$BASE/pnpm-hoisted" && printf 'nodeLinker: hoisted\n' > "$BASE/pnpm-hoisted/.npmrc"
echo "=============================================================="
echo "3) pnpm (nodeLinker: hoisted)"
echo "=============================================================="
cp "$PROBE" "$BASE/pnpm-hoisted/"
( cd "$BASE/pnpm-hoisted" && npm init -y >/dev/null 2>&1 && pnpm install --config.confirmModulesPurge=false noise-handshake@4.2.0 ) >"$BASE/pnpm-hoisted-install.log" 2>&1
grep -vE "^\s*(Progress:|Downloading|Resolving)" "$BASE/pnpm-hoisted-install.log" | sed 's/^/    /' | head -20
echo "--- install-script / compile markers ---"
grep -iE "ignored build|approve-builds|postinstall|preinstall|node-gyp|gyp ERR" "$BASE/pnpm-hoisted-install.log" || echo "    (none)"
echo "--- probe (pnpm-hoisted) ---"
( cd "$BASE/pnpm-hoisted" && node probe.mjs "pnpm-hoisted" ) | sed 's/^/    /'
echo

echo "=============================================================="
echo "prebuilt binaries shipped inside the sodium-native 5.1.0 tarball"
echo "=============================================================="
find "$BASE/npm-flat/node_modules/sodium-native/prebuilds" -name '*.node' 2>/dev/null \
  | sed "s|$BASE/npm-flat/node_modules/||" | sort | sed 's/^/    /'
echo "    linux-x64 payload:"
ls -la "$BASE/npm-flat/node_modules/sodium-native/prebuilds/linux-x64/" 2>/dev/null | tail -n +2 | sed 's/^/        /'
