#!/usr/bin/env bash
set -euo pipefail
fuzz_root="$(cd "$(dirname "$0")/.." && pwd)"
if [[ "${1:-}" != --inside-scope ]]; then
  exec "$fuzz_root/tools/run-limited.sh" bash "$0" --inside-scope "$@"
fi
shift
fuzz_dart="${DART_BIN:-dart}"
if [[ "$($fuzz_dart --version 2>&1)" != 'Dart SDK version: 3.13.5 '* ]]; then
  printf 'Dart 工具链必须为 3.13.5。\n' >&2
  exit 2
fi
cd "$fuzz_root/packages/core/dart"
"$fuzz_dart" pub get --enforce-lockfile
fuzz_seconds="${DSH_DART_FUZZ_SECONDS:-60}"
if [[ ! "$fuzz_seconds" =~ ^[0-9]{1,4}$ ]] || ((10#$fuzz_seconds < 10 || 10#$fuzz_seconds > 3600)); then
  printf 'fuzz 预算必须为 10..3600 秒。\n' >&2
  exit 2
fi
# Keep the ephemeral VM service URL/auth code out of retained/public logs.
timeout --signal=TERM --kill-after=5s "$((10#$fuzz_seconds + 60))s" \
  "$fuzz_dart" --enable-vm-service=0 --no-serve-devtools run bin/coverage_fuzz.dart "$@" 2>&1 |
  sed '/^The Dart VM service is listening on /d'
