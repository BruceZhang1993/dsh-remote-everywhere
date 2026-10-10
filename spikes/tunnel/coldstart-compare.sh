#!/usr/bin/env bash
# Synchronized three-client comparison against a freshly created quick tunnel.
D=/home/bruce/Projects/dsh-remote-everywhere/spikes/tunnel
cd "$D"
PORT=8803
setsid nohup env PORT=$PORT node server.mjs >"$D/logs/origin-8803.log" 2>&1 </dev/null & disown
sleep 1
setsid nohup "$D/cloudflared" tunnel --url http://127.0.0.1:$PORT --loglevel info >"$D/logs/seventh.stdout.log" 2>"$D/logs/seventh.stderr.log" </dev/null & disown
for i in $(seq 1 100); do H=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$D/logs/seventh.stderr.log" 2>/dev/null | head -1); [ -n "$H" ] && break; sleep 0.2; done
echo "URL=$H created=$(date -Is)" | tee "$D/logs/coldstart.log"
printf '%s' "$H" > "$D/logs/seventh.url"
WSS=${H/https:/wss:}
# Wait one round so all three start at the same tunnel age (~2-4s old).
for round in 1 2 3 4; do
  AGE=$(($(date +%s) - $(stat -c %Y "$D/logs/seventh.url")))
  A=$(WS_URL="$WSS" N=8 DELAY_MS=100 node wsclient/probe-ws.mjs 2>&1 | grep -E '^client=')
  B=$(WS_URL="$WSS" N=8 TIMEOUT_MS=10000 node probe-reliability.mjs 2>&1 | grep -E '^attempts=')
  C=$(HOST="${H#https://}" N=8 DELAY_MS=100 node probe-upgrade.mjs 2>&1 | grep -E '^HOST=')
  printf 'age=%3ss\n  ws     : %s\n  undici : %s\n  rawTLS : %s\n' "$AGE" "$A" "$B" "$C" | tee -a "$D/logs/coldstart.log"
done
echo "DONE" >> "$D/logs/coldstart.log"
