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
if [[ "${1:-}" == --release-candidate ]]; then
  shift
  node "$TASK_ROOT/tools/release-candidate.mjs" "$@"
  TASK_PACKAGES="$TASK_ROOT/.cache/release-0.1.0"
  if [[ "${1:-}" == --github-packages ]]; then TASK_PACKAGES="$TASK_ROOT/.cache/github-packages-0.1.0"; fi
  TASK_IS_CANDIDATE=1
elif [[ -n "${1:-}" ]]; then
  printf '用法: tools/package-smoke.sh [--release-candidate [--github-packages OWNER/REPO]]\n' >&2
  exit 2
else
  for package in protocol core tunnel cli dsh-plugin; do
    (cd "$TASK_ROOT/packages/$package" && pnpm pack --pack-destination "$TASK_PACKAGES")
  done
fi
TASK_ARCHIVES=()
for package in protocol core tunnel cli dsh-plugin; do
  TASK_MANIFEST="$TASK_ROOT/packages/$package/package.json"
  if [[ "${TASK_IS_CANDIDATE:-0}" == 1 ]]; then TASK_MANIFEST="$TASK_PACKAGES/staging/$package/package.json"; fi
  TASK_NAME="$(node -p 'JSON.parse(require("node:fs").readFileSync(process.argv[1])).name' "$TASK_MANIFEST")"
  if [[ "$package" == cli ]]; then TASK_CLI_NAME="$TASK_NAME"; fi
  if [[ "$package" == dsh-plugin ]]; then TASK_PLUGIN_NAME="$TASK_NAME"; fi
  TASK_ARCHIVE="$(node -p 'const p=JSON.parse(require("node:fs").readFileSync(process.argv[1])); p.name.replace(/^@/, "").replace("/", "-") + "-" + p.version + ".tgz"' "$TASK_MANIFEST")"
  TASK_ARCHIVES+=("$TASK_PACKAGES/$TASK_ARCHIVE")
done
printf '{"private":true,"type":"module"}\n' > "$TASK_CONSUMER/package.json"
npm install --prefix "$TASK_CONSUMER" --ignore-scripts --no-audit --no-fund \
  "${TASK_ARCHIVES[@]}" \
  @deepseek-ai/dsh@0.1.7-rc.2
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
