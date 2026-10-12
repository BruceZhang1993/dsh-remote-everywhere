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
for package in protocol core tunnel cli; do
  (cd "$TASK_ROOT/packages/$package" && pnpm pack --pack-destination "$TASK_ROOT/.cache/packages")
done
printf '{"private":true,"type":"module"}\n' > "$TASK_CONSUMER/package.json"
npm install --prefix "$TASK_CONSUMER" --ignore-scripts --no-audit --no-fund \
  "$TASK_ROOT/.cache/packages/dsh-remote-protocol-0.1.0-alpha.1.tgz" \
  "$TASK_ROOT/.cache/packages/dsh-remote-core-0.1.0-alpha.1.tgz" \
  "$TASK_ROOT/.cache/packages/dsh-remote-tunnel-0.1.0-alpha.1.tgz" \
  "$TASK_ROOT/.cache/packages/dsh-remote-cli-0.1.0-alpha.1.tgz"
TASK_CLI="$TASK_CONSUMER/node_modules/@dsh-remote/cli/src/index.js"
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
