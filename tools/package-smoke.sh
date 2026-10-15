#!/usr/bin/env bash
set -euo pipefail
TASK_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TASK_CONSUMER="$(mktemp -d -t dsh-remote-consumer-XXXXXX)"
TASK_SERVER_PID=''
cleanup() {
  if [ -n "$TASK_SERVER_PID" ]; then kill -TERM "$TASK_SERVER_PID" 2>/dev/null || true; wait "$TASK_SERVER_PID" || true; fi
  rm -rf "$TASK_CONSUMER"
}
trap cleanup EXIT
mkdir -p "$TASK_ROOT/.cache/packages"
TASK_PACKAGES="$TASK_ROOT/.cache/packages"
if [[ "${1:-}" == --registry && "$#" == 1 ]]; then
  : "${NODE_AUTH_TOKEN:?registry installation requires NODE_AUTH_TOKEN}"
  TASK_REGISTRY=1
  TASK_PACKAGES="$TASK_ROOT/.cache/github-packages-0.1.0"
  node "$TASK_ROOT/tools/publish-packages.mjs"
elif [[ "${1:-}" == --release-candidate ]]; then
  shift
  node "$TASK_ROOT/tools/release-candidate.mjs" "$@"
  TASK_PACKAGES="$TASK_ROOT/.cache/release-0.1.0"
  if [[ "${1:-}" == --github-packages ]]; then TASK_PACKAGES="$TASK_ROOT/.cache/github-packages-0.1.0"; fi
  TASK_IS_CANDIDATE=1
elif [[ -n "${1:-}" ]]; then
  printf '用法: tools/package-smoke.sh [--release-candidate [--github-packages OWNER/REPO] | --registry]\n' >&2
  exit 2
else
  for package in protocol core tunnel cli dsh-plugin; do
    (cd "$TASK_ROOT/packages/$package" && pnpm pack --pack-destination "$TASK_PACKAGES")
  done
fi
TASK_ARCHIVES=()
if [[ "${TASK_REGISTRY:-0}" == 1 ]]; then
  TASK_NAMES="$(node -p 'JSON.parse(require("node:fs").readFileSync(process.argv[1])).artifacts.map(a => a.name).join("\n")' "$TASK_PACKAGES/manifest.json")"
  while IFS= read -r TASK_NAME; do TASK_ARCHIVES+=("$TASK_NAME@0.1.0"); done <<< "$TASK_NAMES"
  TASK_SCOPE="${TASK_ARCHIVES[0]%%/*}"
  TASK_CLI_NAME="$TASK_SCOPE/dsh-remote-cli"
  TASK_PLUGIN_NAME="$TASK_SCOPE/dsh-remote-everywhere"
  # Persist only an environment reference, never the actual credential.
  printf '%s:registry=https://npm.pkg.github.com\n' "$TASK_SCOPE" > "$TASK_CONSUMER/.npmrc"
  printf '//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}\n' >> "$TASK_CONSUMER/.npmrc"
  mkdir -p "$TASK_ROOT/.cache/registry-0.1.0"
  printf '{"passed":false,"stage":"registry-install"}\n' > "$TASK_ROOT/.cache/registry-0.1.0/acceptance.json"
else
for package in protocol core tunnel cli dsh-plugin; do
  TASK_MANIFEST="$TASK_ROOT/packages/$package/package.json"
  if [[ "${TASK_IS_CANDIDATE:-0}" == 1 ]]; then TASK_MANIFEST="$TASK_PACKAGES/staging/$package/package.json"; fi
  TASK_NAME="$(node -p 'JSON.parse(require("node:fs").readFileSync(process.argv[1])).name' "$TASK_MANIFEST")"
  if [[ "$package" == cli ]]; then TASK_CLI_NAME="$TASK_NAME"; fi
  if [[ "$package" == dsh-plugin ]]; then TASK_PLUGIN_NAME="$TASK_NAME"; fi
  TASK_ARCHIVE="$(node -p 'const p=JSON.parse(require("node:fs").readFileSync(process.argv[1])); p.name.replace(/^@/, "").replace("/", "-") + "-" + p.version + ".tgz"' "$TASK_MANIFEST")"
  TASK_ARCHIVES+=("$TASK_PACKAGES/$TASK_ARCHIVE")
done
fi
printf '{"private":true,"type":"module"}\n' > "$TASK_CONSUMER/package.json"
if [[ "${TASK_REGISTRY:-0}" == 1 ]]; then
  NPM_CONFIG_USERCONFIG="$TASK_CONSUMER/.npmrc" NPM_CONFIG_CACHE="$TASK_CONSUMER/npm-cache" \
    npm install --prefix "$TASK_CONSUMER" --registry=https://registry.npmjs.org --ignore-scripts --no-audit --no-fund \
    "${TASK_ARCHIVES[@]}" @deepseek-ai/dsh@0.1.7-rc.2
  unset NODE_AUTH_TOKEN
  node --input-type=module - "$TASK_CONSUMER" "$TASK_PACKAGES" <<'JS'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
const [consumer, candidate] = process.argv.slice(2)
const manifest = JSON.parse(readFileSync(join(candidate, 'manifest.json')))
const lock = JSON.parse(readFileSync(join(consumer, 'package-lock.json')))
for (const artifact of manifest.artifacts) {
  const installed = lock.packages[`node_modules/${artifact.name}`]
  const integrity = `sha512-${createHash('sha512').update(readFileSync(join(candidate, artifact.file))).digest('base64')}`
  assert.equal(installed.version, '0.1.0')
  assert.equal(new URL(installed.resolved).hostname, 'npm.pkg.github.com')
  assert.equal(installed.integrity, integrity)
}
console.log('five registry installations match the approved tarball integrities')
JS
else
npm install --prefix "$TASK_CONSUMER" --ignore-scripts --no-audit --no-fund \
  "${TASK_ARCHIVES[@]}" \
  @deepseek-ai/dsh@0.1.7-rc.2
fi
TASK_CLI="$TASK_CONSUMER/node_modules/$TASK_CLI_NAME/src/index.js"
node "$TASK_CLI" keygen --out "$TASK_CONSUMER/host.key" > "$TASK_CONSUMER/host-public.json"
node "$TASK_CLI" keygen --out "$TASK_CONSUMER/client.key" > "$TASK_CONSUMER/client-public.json"
TASK_HOST_PIN="$(node -p "JSON.parse(require('node:fs').readFileSync(process.argv[1])).publicKey" "$TASK_CONSUMER/host-public.json")"
TASK_CLIENT_PIN="$(node -p "JSON.parse(require('node:fs').readFileSync(process.argv[1])).publicKey" "$TASK_CONSUMER/client-public.json")"
node "$TASK_CLI" serve --key "$TASK_CONSUMER/host.key" --peer "$TASK_CLIENT_PIN" --port 0 > "$TASK_CONSUMER/server.json" &
TASK_SERVER_PID=$!
for attempt in $(seq 1 100); do
  [ -s "$TASK_CONSUMER/server.json" ] && break
  sleep 0.05
done
TASK_ENDPOINT="$(node -p "JSON.parse(require('node:fs').readFileSync(process.argv[1])).endpoint" "$TASK_CONSUMER/server.json")"
node "$TASK_CLI" doctor --key "$TASK_CONSUMER/client.key" --peer "$TASK_HOST_PIN" --endpoint "$TASK_ENDPOINT"
kill -TERM "$TASK_SERVER_PID"
wait "$TASK_SERVER_PID"
TASK_SERVER_PID=''
printf 'standalone packed CLI passed with install scripts disabled\n'

DSH_HOST_MODULE_ROOT="$TASK_CONSUMER/node_modules" DSH_PLUGIN_PACKAGE_ROOT="$TASK_CONSUMER/node_modules/$TASK_PLUGIN_NAME" node "$TASK_ROOT/tools/m2-host-smoke.mjs"
printf 'standalone packed DSH plugin passed with install scripts disabled\n'
if [[ "${TASK_REGISTRY:-0}" == 1 ]]; then
  node --input-type=module - "$TASK_CONSUMER" "$TASK_PACKAGES" "$TASK_ROOT" <<'JS'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
const [consumer, candidate, root] = process.argv.slice(2)
const manifest = JSON.parse(readFileSync(join(candidate, 'manifest.json')))
const lock = JSON.parse(readFileSync(join(consumer, 'package-lock.json')))
const evidence = { passed: true, sourceCommit: manifest.sourceCommit, registry: manifest.registry,
  runId: process.env.GITHUB_RUN_ID ?? null, node: process.version, installScripts: false, freshCache: true,
  diagnostic: true, genuineDshProcesses: 2, deterministicModelFixture: true,
  packages: manifest.artifacts.map(a => ({ name: a.name, version: '0.1.0', integrity: lock.packages[`node_modules/${a.name}`].integrity })),
  cleanup: 'isolated profile removed on exit; upgrade and previous-version rollback not tested' }
writeFileSync(join(root, '.cache/registry-0.1.0/acceptance.json'), `${JSON.stringify(evidence, null, 2)}\n`)
console.log('registry consumer acceptance passed')
JS
fi
