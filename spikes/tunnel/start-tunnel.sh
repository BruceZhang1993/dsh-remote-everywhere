#!/usr/bin/env bash
# Start cloudflared quick tunnel, drain BOTH stdout+stderr continuously, extract URL, measure timings.
# Usage: ./start-tunnel.sh <LOGNAME>
# Writes:
#   logs/<LOGNAME>.stdout.log   raw cloudflared stdout (default logformat in 2026.10.0 goes HERE)
#   logs/<LOGNAME>.stderr.log   raw cloudflared stderr (empty in 2026.10.0 default logformat)
#   logs/<LOGNAME>.merged.log   both streams, line-tagged [O]/[E], in arrival order (what a parent should parse)
#   logs/<LOGNAME>.meta         T0, PID, URL, timings
set -uo pipefail
cd "$(dirname "$0")"
NAME="${1:?usage: start-tunnel.sh <logname>}"
ORIGIN_PORT="${PORT:-8787}"
STDOUT_LOG="logs/${NAME}.stdout.log"
STDERR_LOG="logs/${NAME}.stderr.log"
MERGED_LOG="logs/${NAME}.merged.log"
META="logs/${NAME}.meta"
: >"$STDOUT_LOG"; : >"$STDERR_LOG"; : >"$MERGED_LOG"; : >"$META"

# --- THE REGEX (see REPORT.md) -------------------------------------------------
# Matches the quick-tunnel hostname printed in the ASCII banner.
URL_RE='https://[a-z0-9]([a-z0-9-]*[a-z0-9])?\.trycloudflare\.com'
# JSON-logformat fallback: --logformat json emits {"message":"... https://x.trycloudflare.com ..."};
# the SAME regex applied to the raw line still matches, so one regex covers both formats.

T0=$(date +%s.%N)
{
  echo "T0=$(date -Is)"
  echo "T0_EPOCH=$T0"
  echo "origin=http://127.0.0.1:${ORIGIN_PORT}"
} >>"$META"

# Two drainers: a parent process MUST consume both pipes or cloudflared can block on a full pipe.
./cloudflared tunnel --url "http://127.0.0.1:${ORIGIN_PORT}" --loglevel info \
  > >(sed -u 's/^/[O] /' | tee -a "$MERGED_LOG" >>"$STDOUT_LOG") \
  2> >(sed -u 's/^/[E] /' | tee -a "$MERGED_LOG" >>"$STDERR_LOG") &
CF_PID=$!
echo "CF_PID=$CF_PID" >>"$META"
echo "cloudflared_pid=$CF_PID (T0=$T0)"

URL=""
for _ in $(seq 1 600); do   # up to 60s
  URL=$(grep -oE "$URL_RE" "$MERGED_LOG" 2>/dev/null | head -1)
  [ -n "$URL" ] && break
  kill -0 "$CF_PID" 2>/dev/null || { echo "cloudflared exited early (pid $CF_PID)"; break; }
  sleep 0.1
done
T_URL=$(date +%s.%N)
if [ -z "$URL" ]; then
  echo "NO_URL_FOUND" | tee -a "$META"
  echo "--- merged tail ---"; tail -20 "$MERGED_LOG"
  exit 1
fi
DELTA=$(awk -v a="$T0" -v b="$T_URL" 'BEGIN{printf "%.2f", b-a}')
{
  echo "URL=$URL"
  echo "T_URL_EPOCH=$T_URL"
  echo "url_appeared_after_s=$DELTA"
  echo "banner_lines:"
  grep -nE 'trycloudflare\.com' "$MERGED_LOG"
} >>"$META"
echo "URL=$URL"
echo "url_appeared_after=${DELTA}s"

# Reachability probe: retry GET until 200 (proves edge -> origin path live).
PROBE_START=$(date +%s.%N)
CODE=""
for _ in $(seq 1 240); do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$URL" || echo 000)
  [ "$CODE" = "200" ] && break
  sleep 0.25
done
PROBE_END=$(date +%s.%N)
D1=$(awk -v a="$T0" -v b="$PROBE_START" 'BEGIN{printf "%.2f", b-a}')
D2=$(awk -v a="$T0" -v b="$PROBE_END" 'BEGIN{printf "%.2f", b-a}')
DUR=$(awk -v a="$PROBE_START" -v b="$PROBE_END" 'BEGIN{printf "%.2f", b-a}')
{
  echo "T_REACHABLE_EPOCH=$PROBE_END"
  echo "http_status=$CODE"
  echo "reachable_at_s=$D2"
  echo "probe_duration_s=$DUR"
  echo "curl_version=$(curl --version | head -1)"
  echo "cloudflared_version=$(./cloudflared --version 2>&1 | head -1)"
} >>"$META"
echo "http_status=$CODE reachable_after=${D2}s (probe began ${D1}s, took ${DUR}s)"
exit 0
