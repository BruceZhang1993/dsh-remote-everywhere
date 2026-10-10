#!/usr/bin/env bash
# Live Node <-> Dart interop over TCP, both role assignments, plus a
# mismatched-prologue negative run.
#
#   scripts/run-interop.sh
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="/home/bruce/Android/flutter/bin:$PATH"
RESULTS="$ROOT/results"
mkdir -p "$RESULTS"

free_port () {
  python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1]);s.close()'
}

PASS=0
FAIL=0

run_combo () {
  local name="$1"; shift
  local node_role="$1"; shift
  local dart_role="$1"; shift
  local node_sid="$1"; shift
  local dart_sid="$1"; shift
  local expect_fail="${1:-no}"

  local port; port="$(free_port)"
  local nlog="$RESULTS/${name}-node.log"
  local dlog="$RESULTS/${name}-dart.log"

  ( cd "$ROOT/node" && node src/tcp-interop.js server "$port" $node_role --sid "$node_sid" --json ) >"$nlog" 2>&1 &
  local npid=$!
  # wait for the listener marker (never probe with a real TCP connect: the
  # single-connection server would treat the probe as the peer)
  for _ in $(seq 1 100); do
    grep -q '^DSH_LISTENING' "$nlog" 2>/dev/null && break
    sleep 0.1
  done
  ( cd "$ROOT/dart" && dart run bin/tcp_interop.dart client "$port" $dart_role --sid "$dart_sid" ) >"$dlog" 2>&1 &
  local dpid=$!

  wait $dpid; local drc=$?
  wait $npid; local nrc=$?

  local nline dline
  nline="$(grep -m1 '^DSH_INTEROP_RESULT ' "$nlog" | sed 's/^DSH_INTEROP_RESULT //')"
  dline="$(grep -m1 '^DSH_INTEROP_RESULT ' "$dlog" | sed 's/^DSH_INTEROP_RESULT //')"

  echo "=============================================================="
  echo "combo: $name   (node=$node_role, dart=$dart_role)"
  echo "  node exit=$nrc  dart exit=$drc   port=$port"
  echo "  node: $nline"
  echo "  dart: $dline"
  if [ -z "$nline" ] || [ -z "$dline" ]; then
    echo "  RESULT: FAIL (missing result line)"
    FAIL=$((FAIL+1)); return
  fi

  python3 - "$name" "$nline" "$dline" "$expect_fail" <<'PY'
import json, sys
name, nraw, draw, expect_fail = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
n = json.loads(nraw); d = json.loads(draw)
checks = []
def ck(label, cond, detail=''):
    checks.append((label, bool(cond), detail))

if expect_fail == 'yes':
    ck('node reports handshake failure', n['handshakeFailed'] is True, str(n.get('failureReason'))[:70])
    ck('dart reports handshake failure', d['handshakeFailed'] is True, str(d.get('failureReason'))[:70])
    ck('no session established on either side', not n['ok'] and not d['ok'])
else:
    ck('both sides completed the handshake', n['ok'] and d['ok'], f"node.ok={n['ok']} dart.ok={d['ok']}")
    ck('handshake hash identical across languages', n['handshakeHash'] == d['handshakeHash'], str(n['handshakeHash']))
    ck('both sides saw the peer hash', n['hashMatchesPeer'] and d['hashMatchesPeer'])
    ck('SAS identical across languages', n['sas'] == d['sas'], f"node={n['sas']} dart={d['sas']}")
    ck('SAS is 6 decimal digits', isinstance(n['sas'], str) and len(n['sas']) == 6 and n['sas'].isdigit(), str(n['sas']))
    ck('each side independently reports the peer SAS matches', n['sasMatchesPeer'] and d['sasMatchesPeer'])
    ck('transport phase ok on both sides', n['transportOk'] and d['transportOk'])
    responder = n if n['role'] == 'responder' else d
    ck('tampered ciphertext rejected by the responder (' + responder['side'] + ')',
       responder['tamperRejected'] is True)
    ck('post-tamper message still decrypts (nonce not advanced)', n['postTamperOk'] and d['postTamperOk'])
    ck('suite name agrees', n['suite'] == d['suite'] == 'Noise_XX_25519_ChaChaPoly_BLAKE2s')
    ck('wire bytes non-trivial in both directions', n['bytesSent'] > 0 and d['bytesSent'] > 0)

bad = [c for c in checks if not c[1]]
for label, ok, detail in checks:
    print(f"  [{'ok  ' if ok else 'FAIL'}] {label}{(' :: ' + detail) if detail else ''}")
print(f"  RESULT: {'PASS' if not bad else 'FAIL'}")
sys.exit(0 if not bad else 1)
PY
  if [ $? -eq 0 ]; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); fi
}

# 1) Node responder  <-> Dart initiator
run_combo "A-node-responder-dart-initiator" "" "--initiator" "live-sid-A" "live-sid-A" no
# 2) Node initiator  <-> Dart responder
run_combo "B-node-initiator-dart-responder" "--initiator" "" "live-sid-B" "live-sid-B" no
# 3) mismatched prologue / session id: must fail on both sides
run_combo "C-mismatched-prologue" "--initiator" "" "live-sid-C1" "live-sid-C2" yes

echo
echo "=============================================================="
echo "combos passed: $PASS, failed: $FAIL"
echo "logs in $RESULTS"
exit $([ "$FAIL" -eq 0 ] && echo 0 || echo 1)
