#!/usr/bin/env bash
# Warm-up curve: probe raw WSS upgrades repeatedly from tunnel creation onward.
D=/home/bruce/Projects/dsh-remote-everywhere/spikes/tunnel
cd "$D"
H=$(sed 's|https://||' logs/fifth.url)
START=$(date +%s)
: > logs/warmup2.log
echo "host=$H start=$(date -Is)" >> logs/warmup2.log
for round in $(seq 1 30); do
  AGE=$(( $(date +%s) - START ))
  OUT=$(HOST="$H" N=6 DELAY_MS=150 node probe-upgrade.mjs 2>&1 | grep -E '^HOST=|^REFUSED|refusal_status')
  printf 'age=%3ss %s\n' "$AGE" "$(echo "$OUT" | tr '\n' ' | ')" >> logs/warmup2.log
  sleep 10
done
echo "DONE" >> logs/warmup2.log
