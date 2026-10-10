#!/usr/bin/env bash
# One command to reproduce every artefact of the noise-interop spike.
#
#   spikes/noise-interop/scripts/run-all.sh
#
# Steps:
#   1. npm install (Node side)                - no build scripts, no compiler
#   2. dart pub get (Dart side)               - no native toolchain
#   3. Node node<->node self-tests + perf
#   4. Dart self-tests + perf (JIT and AOT)
#   5. Node XX driver vs noise-handshake (BLAKE2b oracle) + noble vs libsodium
#   6. emit the deterministic vector file
#   7. Dart verifies the vector file byte-for-byte
#   8. live Node<->Dart handshake over TCP, both role assignments + negative run
#   9. sodium-native layout probe (npm flat / pnpm isolated / pnpm hoisted)
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="/home/bruce/Android/flutter/bin:$PATH"
FAIL=0
step () { echo; echo "############ $* ############"; }
run () { "$@" || { echo "!!! FAILED: $*"; FAIL=1; }; }

step "1/9 npm install (Node)"
run bash -c "cd '$ROOT/node' && npm install --no-audit --no-fund"

step "2/9 dart pub get (Dart)"
run bash -c "cd '$ROOT/dart' && dart pub get"

step "3/9 Node self-tests + perf"
run bash -c "cd '$ROOT/node' && node src/selftest.js"

step "4/9 Dart self-tests + perf (JIT)"
run bash -c "cd '$ROOT/dart' && dart run bin/selftest.dart"

step "4b/9 Dart self-tests + perf (AOT, release-style)"
run bash -c "mkdir -p '$ROOT/dart/build' && cd '$ROOT/dart' && dart compile exe bin/selftest.dart -o build/selftest_aot && ./build/selftest_aot"

step "5/9 Node driver vs noise-handshake (BLAKE2b oracle)"
run bash -c "cd '$ROOT/node' && node src/validate-vs-noise-handshake.js"

step "6/9 emit deterministic test vectors (Node)"
run bash -c "cd '$ROOT/node' && node src/emit-vectors.js"

step "7/9 Dart verifies the Node vectors byte-for-byte"
run bash -c "cd '$ROOT/dart' && dart run bin/verify_vectors.dart"

step "8/9 live Node <-> Dart handshake over TCP"
run bash -c "'$ROOT/scripts/run-interop.sh'"

step "9/9 sodium-native layout probe"
run bash -c "'$ROOT/scripts/test-sodium-native.sh' > '$ROOT/results/sodium-native-layouts.txt' 2>&1 && echo 'wrote results/sodium-native-layouts.txt'"

echo
if [ "$FAIL" -eq 0 ]; then echo "ALL SPIKE STEPS PASSED"; else echo "SOME SPIKE STEPS FAILED"; fi
exit $FAIL
