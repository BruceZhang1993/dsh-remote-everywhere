# Cloudflare Quick Tunnel SPIKE — WSS transport for a Node 22 desktop plugin

**Spike location:** `/home/bruce/Projects/dsh-remote-everywhere/spikes/tunnel/`
**Date:** 2026-10-10 (Asia/Shanghai)
**Machine:** Linux x86-64, Node **v22.23.3**, pnpm **11.28.5**, curl 8.22.0
**cloudflared:** **2026.10.0** (built 2026-10-05-17:37 UTC), official static linux-amd64 binary
**Network note:** this host egresses through a transparent proxy; `cloudflared` precheck reported
`HTTP/2 connection is blocked or unreachable … suggested_protocol=quic`, so all tunnels ran over **QUIC**
(`protocol=quic`, edge colo `nrt08`/`nrt09`/`nrt10`). Any WebSocket-level timings below include that path.

> Every number in this report comes from a command actually run in this spike, or from an official
> Cloudflare/npm doc URL. Raw logs are preserved in `spikes/tunnel/logs/` with tunnel hostnames redacted
> to `REDACTED-<random>.trycloudflare.com` (shape preserved). Honest negatives are reported as such.

---

## (a) VERDICT

> ### **CONDITIONAL YES** — Quick Tunnel is suitable as the *default free/zero-account* transport for a long-lived heartbeating WSS connection.
> It carried a heartbeated WSS connection for **13 minutes with 31/31 round-trips and zero closes**, and once
> warmed it has been **100% reliable across 150+ upgraded connections**.
>
> It is **not** suitable as the *only* transport, and it must not be presented to the user as production-grade.
> Three hard conditions gate the "yes":
>
> 1. **A heartbeat is mandatory** — Cloudflare documents an idle timeout that closes WebSockets when no data
>    flows; a ≤30 s application-level ping is the documented mitigation.
> 2. **The client must retry the upgrade** — during roughly the first 50 s of a new tunnel's life, *both*
>    Node WebSocket clients tested (`undici`'s global `WebSocket` and the `ws` package) failed **~10–25%** of
>    cold upgrades. The raw TLS handshake over the same URL at the same moment failed **0/96**. Treat early
>    failures as expected and reconnect.
> 3. **The URL must be re-shown whenever cloudflared restarts** — the hostname changes every run and
>    **every user-facing handle (QR code, deep link, session token) must be regenerated**.
>
> Plus the documented limits: **no uptime SLA**, **200 in-flight request cap (returns 429 — measured)**,
> **SSE unsupported**.

Suitability by use case:

| Use case | Verdict |
|---|---|
| Default transport for "expose my desktop to my phone", free, zero-account | **Yes**, with the three conditions above |
| Long-lived interactive WSS session (the DSH remote-access plugin) | **Yes** — 13 min survivable, 0 drops |
| Anything needing a stable URL, uptime SLA, or >200 concurrent streams | **No** — use a named Cloudflare Tunnel |
| Production default without a fallback | **No** — see §(h) |

---

## (b) EXACT WORKING RECIPE (real commands)

### 1. Install cloudflared locally (no system install)

```bash
mkdir -p spikes/tunnel && cd spikes/tunnel
curl -sSL -o cloudflared \
  https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
chmod +x cloudflared
./cloudflared --version
```

Observed:

```
$ ls -l cloudflared
-rwxr-xr-x 1 bruce bruce 40129756 10月10日 10:31 cloudflared
$ sha256sum cloudflared
d33ff2d14475178d2012c2c56beba87389ac5ded27649519f198a7d3134a99db  cloudflared
$ file cloudflared
cloudflared: ELF 64-bit LSB executable, x86-64, statically linked, Go BuildID=…, with debug_info, not stripped
$ ./cloudflared --version
cloudflared version 2026.10.0 (built 2026-10-05-17:37 UTC)
```

- **Size:** 40,129,756 bytes (38.3 MiB)
- **sha256:** `d33ff2d14475178d2012c2c56beba87389ac5ded27649519f198a7d3134a99db`
- **Self-reported checksum:** cloudflared also prints `Version 2026.10.0 (Checksum d33ff2d1…)` in its own
  logs — it **matches the sha256 of the downloaded binary**, so a parent can verify the binary at runtime.
- **Download time:** 5.36 s wall.
- Version pinned for this spike: **2026.10.0**. `latest/download/…` redirected to
  `…/releases/download/2026.10.0/cloudflared-linux-amd64` (HTTP 302 observed).

### 2. Origin WebSocket echo server (Node built-ins only)

`server.mjs` — `node:http` + manual `upgrade` handling implementing RFC6455 by hand (no `ws` dependency),
bound to **127.0.0.1:8787**. It also answers plain `GET` with `200 spike-ok` for readiness probes.

```bash
PORT=8787 node server.mjs > logs/origin-main.log 2>&1 &
```

### 3. Start the Quick Tunnel and extract the URL

```bash
./cloudflared tunnel --url http://127.0.0.1:8787 --loglevel info 2>logs/main.stderr.log >logs/main.stdout.log &
```

> ### ⚠️ Stream routing (measured, and it is NOT what you would guess)
> | invocation | logs go to | measured |
> |---|---|---|
> | default log format | **stderr** | stdout **0 B** / stderr **3002–6308 B** |
> | `--output json` (global flag) | **stderr** | stderr 8389 B, 50 valid JSON lines |
> | `TUNNEL_LOG_OUTPUT=json` env var | **stderr** | stderr 4039 B, 27 JSON lines |
> | `--logformat json` | *does not exist* | `flag provided but not defined: -logformat` |
>
> **The parent process must drain stderr**, and should drain stdout as well (see §(i) pitfall 1).
> Both a plain-text regex and the JSON `.message` field yield the URL. The JSON flag is `--output json`
> and it is a **global** flag: `cloudflared --output json tunnel --url …`, **not** after `tunnel`.

**The exact regex used** (works on both default text and JSON logformat, because the URL sits in the
`message` string either way):

```regex
https://[a-z0-9]([a-z0-9-]*[a-z0-9])?\.trycloudflare\.com
```

**Actual banner text observed** (raw, hostname redacted, `[E]` = stderr, `[O]` = stdout):

```
[E] 2026-10-10T02:32:22Z INF Requesting new quick Tunnel on trycloudflare.com...
[E] 2026-10-10T02:32:25Z INF +--------------------------------------------------------------------------------------------+
[E] 2026-10-10T02:32:25Z INF |  Your quick Tunnel has been created! Visit it at (it may take some time to be reachable):  |
[E] 2026-10-10T02:32:25Z INF |  https://REDACTED-<random>.trycloudflare.com                                       |
[E] 2026-10-10T02:32:25Z INF +--------------------------------------------------------------------------------------------+
[E] 2026-10-10T02:32:25Z INF Cannot determine default configuration path. No file [config.yml config.yaml] in […]
[E] 2026-10-10T02:32:25Z INF Version 2026.10.0 (Checksum d33ff2d14475178d2012c2c56beba87389ac5ded27649519f198a7d3134a99db)
[E] 2026-10-10T02:32:25Z INF Settings: map[ha-connections:1 protocol:quic url:http://127.0.0.1:8787]
[E] 2026-10-10T02:32:34Z INF Registered tunnel connection connIndex=0 connection=b0e550e5-… event=0 ip=198.18.26.251 location=nrt08 protocol=quic
```

The banner is ASCII-art wrapped, so **do not** anchor the regex to line starts or word boundaries — the URL
is padded with spaces inside `|` box borders. Parsing the JSON form is equivalent and more robust:

```json
{"level":"info","message":"… https://REDACTED-<random>.trycloudflare.com …","time":"2026-10-10T02:34:39Z"}
```

### 4. Convert to `wss://` and round-trip

```bash
WS_URL="wss://<host>.trycloudflare.com" node client.mjs
```

Observed real round-trip (origin server-side, showing the Cloudflare edge headers that arrived):

```
[srv …] upgrade#2 url=/ key=yes cf-ray=a482377d9bd28e04-NRT xff=16.76.22.77 proto=-
[srv …] connect#2 handshake-complete
[srv …] #2 RECV text len=20 body="ping:1-1791599573824"      <-- and the client got "echo:ping:1-…"
```

### 5. Teardown

```bash
kill -TERM <cloudflared-pid>      # cloudflared logs "Initiating graceful shutdown …"; tunnel URL then dies
kill -TERM <origin-server-pid>
```

---

## (c) REAL TIMINGS

### URL appearance → reachability

| run | seconds to URL in stderr | seconds to first HTTP 200 | probe wait |
|---|---|---|---|
| main (`webshots-…`) | **3.32** | **6.19** | 2.87 s |
| second (`mailman-…`) | **3.52** | **7.48** | 3.96 s |
| third (`deer-…`) | **3.78** | **7.58** | 3.80 s |
| fourth (`founded-…`) | **3.84** | **14.56** | 10.72 s |

**URL appears ~3.3–3.8 s after spawn; the tunnel becomes usable ~6–15 s after spawn.** The banner itself says
*"it may take some time to be reachable"* — that is accurate. `cloudflared` prints the URL **before** the edge
has finished wiring the hostname, so a readiness probe is required.

### WSS upgrade latency (through `wss://`, QUIC egress)

| population | n | min | p50 | p90 | max |
|---|---|---|---|---|---|
| main tunnel, cold connects | 20 | 368 ms | 390 ms | 433 ms | 450 ms |
| second tunnel | 15 | 434 ms | 502 ms | 706 ms | 780 ms |
| third tunnel, raw TLS | 30 | 354 ms | 380 ms | — | 976 ms |
| sixth tunnel, raw TLS (age 26 s) | 24 | 378 ms | 445 ms | — | 1541 ms |
| seventh tunnel, 3 clients | 96 | 360 ms | ~395–445 ms | — | 1541 ms |

**Cold WSS handshake ≈ 0.4 s** through the public edge (≈0.06 s locally). Application message RTT while
connected was **~120–165 ms** (§d).

### Edge→origin failure log while the origin is down (real excerpt)

```
[E] 2026-10-10T02:46:46Z ERR Request failed error="Unable to reach the origin service. The service may be
    down or it may not be responding to traffic from cloudflared: dial tcp 127.0.0.1:8787: connect:
    connection refused" connIndex=0 dest=https://REDACTED-<random>.trycloudflare.com/ event=0
    ip=198.18.26.250 type=ws
```

Note `type=ws` and `event=0` — the failed **WebSocket** upgrade is reported per-request, which a parent can
parse to distinguish "my app is down" from "the tunnel is down".

---

## (d) HEARTBEAT / LONGEVITY RESULT

**Setup:** one WSS connection through the tunnel, application-level `ping:<nonce>` every **25 s**, echo
asserted per ping, run for **13 min 0.0 s** (780 s deadline; requirement was ≥12 min).

### Result: **SURVIVED. No close, no error, no stall.**

| metric | value |
|---|---|
| duration | **13:00.004** (deadline-limited) |
| application pings sent | **31** |
| pongs received | **31** |
| unacked at any point | **0** |
| `CLOSE` events | **0** |
| `ERROR`/`WARN` events | **0** |
| reconnects | **0** |
| RTT min / p50 / p90 / max / mean | **121 / 126 / 147 / 165 / 131.4 ms** |

### Timeline (verbatim excerpts, sanitized)

```
[longevity 2026-10-10T10:33:12.129 t+00:00.001] connect attempt#1 -> wss://REDACTED-<random>.trycloudflare.com
[longevity 2026-10-10T10:33:12.701 t+00:00.573] OPEN attempt#1 after 573ms
[longevity 2026-10-10T10:33:37.702 t+00:25.574] APP-PING #1  nonce=1-1791599617702  (in-flight=1)
[longevity 2026-10-10T10:33:37.826 t+00:25.698] APP-PONG #1  nonce=1-1791599617702  rtt-tracked=true in-flight=0
[longevity 2026-10-10T10:35:17.785 t+02:05.657] APP-PING #5  … APP-PONG #5   (every ~25.0 s, no drift)
[longevity 2026-10-10T10:39:53.043 t+06:40.915] APP-PING #16 …
[longevity 2026-10-10T10:44:53.327 t+11:41.199] APP-PING #28 …
[longevity 2026-10-10T10:46:08.402 t+12:56.274] APP-PING #31 nonce=31-1791600368402 (in-flight=1)
[longevity 2026-10-10T10:46:08.537 t+12:56.409] APP-PONG #31 nonce=31-1791600368402 rtt-tracked=true in-flight=0
[longevity 2026-10-10T10:46:12.132 t+13:00.004] DEADLINE 780000ms reached: sent=31 echoed=31 unacked=0 reconnectAttempts=0
```

The 25 s cadence held to within ~150 ms for the whole run; ping `t+02:05` and ping `t+12:55` are the same
interval. Nothing in the transport interfered.

### Is this consistent with a 125-second Proxy Read Timeout, and is the "100 s" figure wrong?

Partially — and **the cited "100 s" figure is not simply wrong; Cloudflare's own docs contradict each other.**
Both statements are on official Cloudflare pages, verified in this session:

| Source | Value | Quote |
|---|---|---|
| [Error 524 doc](https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/error-524/) (last updated Jul 23 2026) | **125 s** | *"the origin did not provide an HTTP response before the default 125 seconds Proxy Read Timeout"* / *"within the Proxy Read Timeout delay, 125 seconds by default"* |
| [Connection limits reference](https://raw.githubusercontent.com/cloudflare/cloudflare-docs/39493aab2e393c1c879e83257b6841140fb46a63/content/fundamentals/reference/connection-limits.md) | **100 s** | table row: `Proxy Read Timeout | 100 | 524 | Yes` |

So the task's premise is **confirmed against the current Error 524 page** — but a maintainer reading the
connection-limits table would cite 100 s. **The honest conclusion: the exact number is disputed inside
Cloudflare's own documentation, and neither page documents a WebSocket-specific idle timeout value.**
The WebSockets page only says:

> *"Cloudflare will close a WebSocket connection when no data is transmitted in either direction for a period
> of time. Enterprise customers can contact their account team to configure a custom idle timeout. To keep
> long-lived connections alive during periods of inactivity, implement a client-side heartbeat (ping/pong)
> mechanism."* — [WebSockets](https://developers.cloudflare.com/network/websockets/)

**My measured behaviour is not explained by a 125 s read timeout at all**, and it would not be explained by a
100 s one either: after the tunnel warmed up, the connection survived **13 minutes** far past either figure,
because a ping every 25 s means the connection is never idle for even 125 s, let alone 780 s. The experiment
therefore **confirms the heartbeat is sufficient**, and does **not** discriminate between 100 s and 125 s.
It also cannot rule out an idle timeout shorter than 25 s for WebSockets specifically (not tested; no
documented value).

**Recommended reading for the plugin:** do not hard-code 125 s or 100 s. Treat the documented idle timeout as
"unknown but ≤ some minutes" and keep the heartbeat at **25 s**, which passed this test and sits comfortably
under both candidate values. A `--protocol http2` run (when HTTP/2 is not proxy-blocked) would be the natural
follow-up to separate QUIC-specific behaviour from edge behaviour.

---

## (e) THE TWO RECONNECT RESULTS

### e1. Kill the origin WebSocket server, then restart it (tunnel stays up)

Client configured with reconnect-on-close, pinging every 5 s.

```
[reconnect-origin 10:46:37.010 t+00:00.006] connect attempt#1 -> wss://REDACTED-<random>.trycloudflare.com
[reconnect-origin 10:46:38.074 t+00:01.064] OPEN attempt#1 after 1064ms
[reconnect-origin 10:46:43.201 t+00:06.191] APP-PONG #1 … in-flight=0
   <-- origin killed at 10:46:44 -->
[reconnect-origin 10:46:45.355 t+00:08.345] CLOSE code=1006 reason="" wasClean=false uptime=8345ms sent=1 echoed=1
[reconnect-origin 10:46:45.355 t+00:08.345] reconnect in 500ms (attempt 1)
[reconnect-origin 10:46:45.856 t+00:08.846] connect attempt#2 -> wss://REDACTED-<random>.trycloudflare.com
[reconnect-origin 10:46:46.238 t+00:09.228] ERROR event message="Received network error or non-101 status code."
[reconnect-origin 10:47:05.872 t+00:28.862] connect TIMEOUT after 20016ms (no open event)
[reconnect-origin 10:47:05.873 t+00:28.863] ERROR "Connection was closed before it was established."
```

- **What the client sees when the origin dies: `CLOSE code=1006`, `reason=""`, `wasClean=false`,
  ~1.3 s after the kill.** Not 1001/1006-with-reason — Cloudflare does not send a WebSocket close frame for a
  dead origin, so the socket is severed. **Code 1006 is the only signal.** The parent must treat bare 1006 as
  "origin or tunnel failed" and reconnect.
- **The tunnel URL stayed valid** — it is a property of the running `cloudflared`, not of the origin. After the
  origin came back, the *same* URL worked again: `via-tunnel http=200`, then a fresh WSS connect `OPEN … 435ms`
  with 2/2 pings echoed (test `recovery`, 10:48:09).
- **Reconnect time = the client's own backoff + handshake budget.** The client's first retry fired 500 ms after
  the close but then burned its full 20 s handshake timeout because the origin was still down, so the first
  *successful* reconnect in this trace was the separate `recovery` run ~1 min 24 s after the kill. The
  practical guidance: **retry aggressively (exp. backoff from ~0.5–1 s) and keep the per-attempt handshake
  budget short (≤10 s) so a dead window is crossed quickly.**

### e2. Kill and restart `cloudflared` itself (origin stays up)

```
=== killing cloudflared pid 1024119 at 2026-10-10T10:48:30+08:00 ===
old-url http=530                      <-- immediately after cloudflared death
=== starting NEW tunnel at 2026-10-10T10:48:36+08:00 ===
URL=https://REDACTED-<random>.trycloudflare.com      <-- DIFFERENT hostname
url_appeared_after=3.52s   http_status=200   reachable_after=7.48s
=== is old url still 530 a minute on? ===
old-url http=530                      <-- permanently dead, not a transient
```

- **The URL changes on every `cloudflared` restart** (measured `webshots-…` → `mailman-…`; and 7 distinct
  hostnames across the session). Confirmed by the docs: *"The hostname changes each time you create a Quick
  Tunnel."*
- **The old URL is permanently dead** — it returned **HTTP 530** immediately and still **530** ~1 minute later.
  Cloudflare serves a `Cloudflare Tunnel error` page with **`error code: 1033`** in the body (captured when a
  tunnel process died mid-test). This is a hard, non-retryable signal: `530` + `1033` = the tunnel behind that
  hostname no longer exists.
- **Client impact:** a client still holding the old `wss://` URL cannot recover by retrying — it must be handed
  the new URL. In one trace the still-open WebSocket even kept working for ~24 s after the old `cloudflared`
  was signalled (graceful shutdown drains streams), then died with `CLOSE code=1006`, and every subsequent
  attempt on the old URL failed with `non-101`. **So: restarting cloudflared invalidates every QR code,
  deep link and stored URL in the system.**

---

## (f) CONSTRAINTS TABLE (with official citations)

| Constraint | Value observed / documented | Evidence |
|---|---|---|
| Uptime SLA | **None.** Banner: *"these account-less Tunnels have no uptime guarantee"*; docs: *"Quick Tunnels have no uptime guarantee."* | real stderr banner; [Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/) |
| Hostname stability | **Changes every run** — 7 distinct hostnames measured | measured; docs: *"The hostname changes each time you create a Quick Tunnel."* |
| URL lifetime | Dies with the `cloudflared` process. Measured: old URL → **530** immediately and 1 min later | measured; docs: *"The URL stops working when you stop the cloudflared process."* |
| In-flight request cap | **200.** Measured: 220 attempts → **exactly 200 opened**, 20 refused; 260 → **200 opened**, 60 refused; the 201st returns **`HTTP/1.1 429 Too Many Requests`** | measured; docs: *"Each Quick Tunnel supports up to 200 in-flight requests. Additional requests return a 429 response."* |
| Does the cap count **WebSockets**? | **YES — measured.** 200 concurrent WSS held open; the 201st got a real `429`. (The WebSockets page only says the *upgrade* counts as one HTTP request — technically true, but the long-lived socket still occupies a slot.) | measured; [WebSockets](https://developers.cloudflare.com/network/websockets/) *"Cloudflare recognizes only the initial upgrade request per WebSocket connection as an HTTP request."* |
| 200 concurrent **plain HTTP** GETs | All returned **200** (no 429) — the cap is about *in-flight/simultaneous* streams, and short HTTP requests drain | measured (260 concurrent GET → 260×200) |
| SSE | **Unsupported.** | docs: *"Quick Tunnels do not support Server-Sent Events (SSE)."* |
| WebSockets | **Officially supported, all plans.** *"Cloudflare supports proxied WebSocket connections without additional configuration."* / *"WebSockets are supported on all Cloudflare plans."* | [WebSockets](https://developers.cloudflare.com/network/websockets/) |
| Idle timeout | Exists; **value not documented.** *"Cloudflare will close a WebSocket connection when no data is transmitted in either direction for a period of time."* Mitigation: client heartbeat. | [WebSockets](https://developers.cloudflare.com/network/websockets/) |
| Proxy Read Timeout | **Docs conflict: 125 s** (Error 524 page) **vs 100 s** (connection-limits table) | [Error 524](https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/error-524/) ; [connection limits](https://developers.cloudflare.com/fundamentals/reference/connection-limits/) |
| Proxy Write Timeout | **30 s**, not adjustable | [Error 524](https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/error-524/) |
| Cloudflare-side restarts | *"When Cloudflare releases new code to its global network, we may restart servers, which terminates WebSockets connections."* → **unexpected drops are expected; reconnect logic is not optional** | [WebSockets](https://developers.cloudflare.com/network/websockets/) |
| WAF on upgrade | The initial `101` request is subject to WAF managed/custom/rate-limit rules; after establishment the WAF does not inspect further | [WebSockets](https://developers.cloudflare.com/network/websockets/) |
| Argo | Not compatible with WebSockets | [WebSockets](https://developers.cloudflare.com/network/websockets/) |
| Access restriction (optional) | `--allowed-mail alice@example.com` adds email OTP gating; **requires an interactive browser session**, so it is *not* usable for a non-interactive CLI/QR client | [Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/) |
| Terms | *"subject to the Cloudflare Online Services Terms of Use … Cloudflare reserves the right to investigate your use of Tunnels for violations"* | real stderr banner |
| Who can reach it | Docs: *"Anyone with the URL can access your local service."* — the URL is the only secret | [Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/) |

URLs cited (all fetched this session):
- https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/
- https://developers.cloudflare.com/network/websockets/
- https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/error-524/
- https://developers.cloudflare.com/fundamentals/reference/connection-limits/
- https://docs.npmjs.com/cli/v11/using-npm/scripts

---

## (g) PLATFORM ASSET TABLE (release 2026.10.0)

Sizes are the **displayed sizes on the official release page** (`/releases/expanded_assets/2026.10.0`);
names are the exact asset names. Only `linux-amd64` was downloaded (verified size 40,129,756 B = 38.3 MB,
so the displayed figures are trustworthy). The SHA256SUMS file was **not** fetched.

| Platform | Arch | Asset name | Size | Notes |
|---|---|---|---|---|
| Linux | x64 | `cloudflared-linux-amd64` | **38.3 MB** | **downloaded + verified in this spike** |
| Linux | arm64 | `cloudflared-linux-arm64` | 35.9 MB | |
| Linux | 386 | `cloudflared-linux-386` | 35.7 MB | |
| Linux | arm | `cloudflared-linux-arm` | 34.9 MB | |
| Linux | armhf | `cloudflared-linux-armhf` | 34.8 MB | |
| macOS | x64 (Intel) | `cloudflared-darwin-amd64.tgz` | 20.7 MB | **`.tgz` — must be un-tarred** |
| macOS | arm64 (Apple Silicon) | `cloudflared-darwin-arm64.tgz` | 18.9 MB | **`.tgz` — must be un-tarred** |
| Windows | x64 | `cloudflared-windows-amd64.exe` | 52.8 MB | `.exe`, not `.zip` |
| Windows | 386 | `cloudflared-windows-386.exe` | 36 MB | |
| **Windows** | **arm64** | **— NO ASSET —** | — | **not published; must run x64 under emulation or ship a fallback** |

Also published (not recommended for bundling): `.deb`/`.rpm` packages, FIPS builds
(`cloudflared-fips-linux-amd64`, 40.8 MB), macOS `.pkg` installers, Windows `.msi` installers, and
`.deb`/`.rpm` at 16.9–19.1 MB each. **26 assets total.**

**Licensing — verified Apache-2.0:**
```
$ curl -sSL https://raw.githubusercontent.com/cloudflare/cloudflared/2026.10.0/LICENSE | head -3
                                 Apache License
                           Version 2.0, January 2004
```
The repo `LICENSE` at the exact release tag is the **Apache License, Version 2.0** (sha256 of that file:
`58d1e17ffe5109a7ae296caafcadfdbe6a7d176f0bc4ab01e12a689b0499d8bd`). Apache-2.0 permits redistribution,
including bundling the binary in an npm package, **provided** you retain the license/notice and state changes.
cloudflared is a Go binary that statically links its dependencies, so the package should also carry the
upstream `LICENSE` (and ideally a NOTICE) for the bundled binary.

**Does bundling a prebuilt binary avoid npm install-script approval? Yes.**
npm's lifecycle docs state that `npm install` runs, in order, **`preinstall` → `install` → `postinstall`**,
and that *"These are run from the scripts of `<pkg-name>`"*, plus node-gyp auto-compiles only *"if there is a
binding.gyp file in the root of your package and you haven't defined your own install or preinstall scripts"*
([npm scripts docs](https://docs.npmjs.com/cli/v11/using-npm/scripts)). If the package ships the correct
per-platform binary inside the tarball and declares **no `install`/`postinstall`/`preinstall` script and no
`binding.gyp`**, then **nothing is executed at install time**, so there is no script for a package manager to
prompt about (pnpm's build-script approval, npm's `--ignore-scripts` concerns, etc.). The trade-offs are size
(one ~38 MB binary per platform, or ~76 MB if you embed several) and the fact that you must select the right
binary at runtime rather than download-time.

---

## (h) THE COLD-START ANOMALY (a negative result worth acting on)

I found a reproducible intermittent failure that is **not** in any doc, and it materially shapes the recipe.

**Method:** three independent clients repeatedly performed a full cold WebSocket upgrade through the same
live tunnel URL, at the same tunnel age:
- `ws` library (`ws@8.22.0`, installed locally) — real handshake, exposes `unexpected-response`
- `undici` global `WebSocket` (Node 22 built-in)
- raw `node:tls` socket writing the RFC6455 handshake by hand (proves what the **edge** does, independent of
  any client library)

**Result — synchronized runs against a freshly created tunnel (`bronze-rangers-…`, 8 attempts per cell):**

| tunnel age | `ws` | `undici` | raw TLS |
|---|---|---|---|
| 0 s | **6/8 (75%)** | 8/8 (100%) | 8/8 (100%) |
| 16 s | **7/8 (87.5%)** | 8/8 (100%) | 8/8 (100%) |
| 31 s | 8/8 (100%) | **7/8 (87.5%)** | 8/8 (100%) |
| 46 s | 8/8 (100%) | **7/8 (87.5%)** | 8/8 (100%) |

Aggregated across the whole session:

| client | total cold upgrades | failures | rate |
|---|---|---|---|
| raw TLS handshake | **96** | **0** | **0%** |
| `undici` global `WebSocket` | — | 3 (fresh tunnel) + 2 + 3 | ~**10–12.5%** in early windows |
| `ws` library | 46 | 3 | ~**6.5%**, concentrated in the first ~50 s |

Representative failures (the `ws` library surfaces the status; `undici` hides it as a generic error):

```
client=ws attempts=8 open=6 failed=2 success_rate=75.0%       <-- age 0 s
  failure_detail=["SOCK-ERR ECONNRESET", ...]
client=ws attempts=8 open=7 failed=1 success_rate=87.5%       <-- age 16 s
undici: failure_outcomes=["ERROR(Received network error or non-101 status code.)", ...]
```

**Interpretation (careful, and deliberately hedged):**
- The **edge itself accepted every upgrade the raw client sent (96/96)**. So this is **not** a Quick-Tunnel
  hard limit and **not** an edge rejection of the `wss` route.
- **Both JS WebSocket clients were intermittently unreliable for roughly the first 50 s of a tunnel's life**
  (`ECONNRESET` / non-101), and both became flawless once the tunnel was ~1 min old and thereafter
  (aged-tunnel tests: `ws` 30/30, `undici` 30/30 and 20/20 and 15/15, raw 30/30 and 20/20 and 10/10 and 10/10).
- This is consistent with **edge-side propagation of a brand-new trycloudflare hostname**: the hostname and
  its tunnel route take tens of seconds to reach every anycast node, so a client that lands on a not-yet-warm
  node gets a refusal. Because the failure is client-visible only as a generic error in `undici`, it is easy
  to misread as flakiness in your own server.
- **I am not claiming a definite root cause.** The sample is small (few hundred attempts across 7 tunnels) and
  the cold window overlapped with other load on this machine. What is solid: **early cold WSS connects fail
  a non-trivial fraction of the time, and the failure disappears after warm-up.**

**Practical consequences (already baked into §i):** do not treat readiness as "URL printed"; require an HTTP
200 probe **and** tolerate a failed first WSS upgrade; retry cold upgrades ~5–10 times with short backoff
before surfacing "cannot connect" to the user; consider a client that lets you distinguish a refused upgrade
(`ws`, which reports the HTTP status) from a socket error.

---

## (i) RECOMMENDED INTEGRATION RECIPE FOR THE PLUGIN

### Spawn

```js
const child = spawn(binaryPath, [
  '--output', 'json',                       // GLOBAL flag: before the subcommand; JSON on stderr
  '--loglevel', 'info',
  'tunnel',
  '--url', `http://127.0.0.1:${localPort}`,
  // Optional hardening, only if you accept the UX cost:
  //   '--allowed-mail', user.email,        // needs an interactive browser: NOT usable for a QR client
  //   '--protocol', 'http2',               // only if QUIC is unavailable; QUIC worked here
], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });   // detached:true so you can kill the GROUP
```

- Put the binary in the plugin's own directory (`node_modules/<pkg>/vendor/cloudflared-<platform>`) and
  `chmod 0755` it at install time — **ship a prebuilt binary and declare no install script** (§g).
- **Drain BOTH `stdout` and `stderr` immediately and forever.** In this build the banner is on **stderr**, and
  `--output json` also goes to stderr — but stdout was empty only for the default format, and a full pipe will
  eventually wedge the child. Tag and merge both streams into one line-oriented buffer.
- **Do not pass `--logformat`** (it does not exist). `--output json` is global and must precede `tunnel`.

### URL extraction (with JSON fallback)

```js
const URL_RE = /https:\/\/[a-z0-9]([a-z0-9-]*[a-z0-9])?\.trycloudflare\.com/;

function extractUrl(line) {
  // 1) JSON logformat (--output json / TUNNEL_LOG_OUTPUT=json)
  if (line.startsWith('{')) {
    try {
      const rec = JSON.parse(line);
      const m = String(rec.message ?? '').match(URL_RE);
      if (m) return { url: m[0], level: rec.level, time: rec.time, json: true };
    } catch { /* fall through to text */ }
  }
  // 2) default text format: banner is ASCII-padded, so match anywhere in the line
  const m = line.match(URL_RE);
  return m ? { url: m[0], json: false } : null;
}
```

Regexes/caveats: match **anywhere** in the line (the banner pads with spaces inside `|` borders); do **not**
require a trailing `/` or word boundary; ignore the earlier
`Requesting new quick Tunnel on trycloudflare.com...` line, which also contains `trycloudflare.com` but **no**
`https://` prefix — the `https://…\.trycloudflare\.com` pattern excludes it.

### Readiness probe

1. Wait for the regex to yield a URL (~3.3–3.8 s observed).
2. Then poll `GET <url>` until **HTTP 200** (observed total 6.2–14.6 s). Use `fetch(url, { signal: AbortSignal.timeout(5000) })`.
3. **Do not stop at 200.** Treat readiness as "HTTP 200 **and** the first WSS upgrade succeeds". Because cold
   upgrades fail ~10 % of the time for the first ~50 s, either
   - wait ~5 s and pre-warm the WSS route yourself with a throwaway upgrade, or
   - let the client retry (below) and only declare failure after N attempts.
4. On failure to get a URL in **60 s**, kill the child and surface an error (a healthy run produced the URL
   in <4 s every time; a long wait means the QUIC/HTTP2 path to the edge is blocked — the precheck lines
   `precheck component="TCP Connectivity" … status=fail` and `suggested_protocol=` are your diagnostics).

### Heartbeat

- Send an **application-level** ping (your own JSON frame) every **25 s**; assert a pong and count unacked.
  Measured: 31/31 over 13 min, RTT p50 126 ms.
- Do **not** rely solely on protocol-level WS ping/pong: Cloudflare's documented mitigation is a client
  heartbeat, and an application-level ping also proves the *origin* is alive, not just the tunnel.
- Consider also sending WS-level pings (the origin server here logged `ws-pings=0` because the client only
  sent app-level frames, and that was **sufficient** — 13 min, zero drops).
- **Escalate when unacked > 2:** the socket can stay `OPEN` while the tunnel is stalled. In this session a
  stalled/unreachable origin produced `1006` rather than a silent stall, but do not depend on that.

### Backoff / reconnect

- Treat **`close` code 1006 with empty reason** as the normal "origin or tunnel went away" signal.
- Reconnect with exponential backoff **0.5 s → 1 s → 2 s → 4 s → 8 s, cap 30 s, jitter ±20 %**.
- **Keep the per-attempt handshake budget short (≤10 s)** — a dead origin left an attempt hanging for the full
  20 s in this spike, and the client cannot start backing off until the attempt resolves.
- Retry failed *cold* upgrades 5–10 times before declaring the tunnel dead (cold-start §h).
- **On `530` (body containing `1033`) stop retrying and re-create the tunnel** — that URL is permanently gone.
- If the *tunnel* (not the origin) died, do **not** retry the old URL. Tear down, spawn a new `cloudflared`,
  and **re-publish the new URL and QR code to the user**.

### Teardown

- Spawn with `detached: true` and kill the **process group** (`process.kill(-child.pid, 'SIGTERM')`), then
  wait for `exit`; escalate to `SIGKILL` after ~3 s.
  **Measured pitfall:** killing only the direct `cloudflared` PID left the stream-drain helper processes
  orphaned in this spike, and a `detached` child can keep running after its direct parent is signalled. Always
  signal the group **and** await `exit`.
- `cloudflared` handles `SIGTERM` gracefully (*"Initiating graceful shutdown due to signal terminated"*) and
  **exits 0**; still, never treat the URL as valid after teardown — it 530s.
- Kill the local origin server too, and clear the stored URL/QR so a stale QR cannot be scanned.

### Surfacing errors to the user

| Signal | Meaning | User-facing action |
|---|---|---|
| No URL within 60 s | egress to the edge blocked (QUIC/HTTP2 precheck failed) | "Can't reach the tunnel network — check firewall/VPN/proxy"; offer LAN mode |
| HTTP probe never 200 | `cloudflared` up but edge→origin path broken | retry once, then recreate the tunnel |
| **530 / `1033`** | tunnel process gone / URL expired | auto-recreate; **regenerate the QR code** |
| **429** | **>200 concurrent streams on this tunnel** | "Too many simultaneous connections"; tell the user to close other sessions, not to retry |
| Cold WSS upgrade refused (non-101 / `ECONNRESET`) | brand-new tunnel still propagating | silent retry with backoff; do not alarm the user |
| WS `1006` + app heartbeat unacked | origin app died or session dropped | auto-reconnect; if it persists, tell the user the desktop app stopped |
| `--allowed-mail` | requires interactive browser OTP | unusable for non-interactive clients — do not enable by default |

---

## (j) RISKS AND FALLBACK PLAN

### Top risks

1. **The URL changes on every `cloudflared` restart, and the old URL dies permanently (530/1033)** — measured.
   Every user-facing artifact (QR code, deep link, bookmarked URL, any token derived from the hostname) is
   invalidated. *Mitigation:* treat the URL as ephemeral session state; regenerate + re-display the QR on every
   tunnel (re)start; have the client refuse to cache it; show an explicit "this code has expired" state rather
   than a generic connection error.
2. **No uptime SLA, no warning on drops, and Cloudflare may terminate sockets on its own schedule** — the docs
   explicitly say network code releases *"may restart servers, which terminates WebSockets connections"*, and
   the banner says no uptime guarantee. *Mitigation:* mandatory heartbeat + automatic reconnect + a visible
   "reconnecting" state; never let the UI imply a stable connection.
3. **The 200 in-flight cap returns a hard 429 and applies to WebSockets (measured)** — 200 concurrent WSS
   occupied the budget exactly; the 201st upgrade got `HTTP/1.1 429 Too Many Requests`. A many-device or
   tab-happy user can hit this. *Mitigation:* cap concurrent streams client-side, surface 429 distinctly, and
   remember a 429 is **not** fixed by retrying — it needs streams to close. (Note `undici` hides the 429 as a
   generic "non-101" error, so use `ws` or a raw upgrade if you need to distinguish 429 from 530.)

### Additional risks

4. **Cold-start upgrade failures (~10–25 % in the first ~50 s; 96/96 for a raw handshake)** — not documented
   anywhere; both `ws` and `undici` exhibited it. *Mitigation:* retry cold upgrades; pre-warm; keep the
   handshake budget short. **Needs more measurement before shipping** (see "what I did not prove").
5. **The idle-timeout value is undocumented and Cloudflare's own docs disagree (125 s vs 100 s)** — a future
   change could make a 25 s heartbeat insufficient. *Mitigation:* keep the heartbeat well under the lower
   figure, make the interval configurable, and monitor server-side for unacked heartbeats.
6. **Security: the URL is the only secret** — *"Anyone with the URL can access your local service."*
   `--allowed-mail` needs an interactive browser and is unusable for a headless client. *Mitigation:* put
   application-level auth (a short-lived token) **inside** the WebSocket handshake/first frame; never rely on
   URL obscurity; make the QR single-use and short-lived.
7. **Bundling size + Windows arm64 gap** — ~38 MB (Linux x64) / ~20 MB (macOS `.tgz`) / ~53 MB (Windows x64)
   per platform, macOS ships **only `.tgz`** (must be un-tarred at build time), and **no Windows arm64 asset
   exists**. *Mitigation:* download per-platform at build time and repackage; declare no install script;
   document the Windows-arm64 fallback (x64 emulation) or a different transport.
8. **Environment sensitivity** — this host's egress proxy blocked the HTTP/2 edge path
   (`precheck … HTTP/2 connection is blocked or unreachable`), forcing QUIC. Corporate networks that block
   QUIC as well will fail entirely. *Mitigation:* surface the `precheck` lines as the actionable diagnostic.
9. **Terms of use** — account-less tunnels are *"subject to the Cloudflare Online Services Terms of Use"* and
   Cloudflare *"reserves the right to investigate your use"*. *Mitigation:* don't build a paid product's only
   transport on it without review.

### Fallback plan (ordered)

1. **Primary:** Cloudflare Quick Tunnel (this recipe), presented as "free & temporary", with heartbeat,
   reconnect and QR regeneration.
2. **Fallback A — named Cloudflare Tunnel** (`cloudflared tunnel create` + your own domain): stable hostname,
   no 200-request quick-tunnel cap, same binary and same spawn/parse code path. Recommended upgrade path for
   anyone who wants reliability; costs a domain + Cloudflare account.
3. **Fallback B — LAN / mDNS direct `wss://`** on the local network (no tunnel at all): zero third parties,
   works offline, QR points at `wss://192.168.x.x:port`. Best degraded mode when the tunnel cannot be created
   or keeps 530-ing; already the natural "same Wi-Fi" case.
4. **Fallback C — other zero-account tunnels** (e.g. `localhost.run`, `serveo`, Tailscale Funnel): keep the
   spawn/parse layer pluggable behind a `TunnelProvider` interface so the transport can be swapped. Not tested
   here; do not assume behavioural parity — each will need its own heartbeat/limit recon.
5. **Fallback D — user-supplied reverse proxy / static port-forward**: last resort, manual, but always works.

Design implication: put the tunnel behind a **provider interface** (`start() → {url, stop()}`) from day one.
Nothing in this spike's measurements depends on a detail that would be hard to abstract, and the fallbacks are
all "give me a public `wss://` URL for a local port".

---

## (k) WHAT I DID NOT PROVE / OPEN QUESTIONS

Stated plainly so nobody over-reads this report:

- **The 125 s vs 100 s question is not experimentally resolved.** A 25 s heartbeat never lets the connection
  idle long enough to hit either, so the test cannot distinguish them. To discriminate, run a deliberately
  idle connection (no pings) and time the close. I did not do this.
- **No idle-timeout measurement.** I never let the connection go quiet, so I have **no** data on the actual
  WebSocket idle timeout (shorter than 25 s would contradict the 13 min survival; anything ≥25 s is untested).
- **The cold-start failure root cause is unproven.** The raw-TLS-never-fails / JS-clients-sometimes-fail
  asymmetry is solid, but whether it is anycast propagation, TLS session handling in the JS clients, or the
  egress proxy is not determined. Sample size was small (~24 attempts per fresh-tunnel cell).
- **Only QUIC was exercised.** HTTP/2 was blocked by this host's proxy, so nothing here speaks to the
  `--protocol http2` path.
- **The 200-connection cap test held idle sockets only** (no traffic). Behaviour under 200 *chatty* WebSockets
  was not measured.
- **Only `linux-amd64` was downloaded.** Other platform sizes are the release page's displayed values, and no
  per-asset SHA256 was verified (the `SHA256SUMS` file was not fetched).
- **No long-duration (hours) soak, no >1 tunnel concurrency test, no mobile-network/roaming test.**
- **`undici` hides the failing HTTP status**; I could only surface 429/530 with the `ws` library or a raw
  socket. If the plugin uses the built-in `WebSocket`, it cannot distinguish "cap exceeded" from "tunnel gone"
  without extra work.

---

## APPENDIX — Files kept in the spike directory

| File | Purpose |
|---|---|
| `cloudflared` | **kept** — v2026.10.0 linux-amd64, sha256 `d33ff2d1…`, 40,129,756 B |
| `server.mjs` | zero-dependency RFC6455 echo server + HTTP readiness endpoint (`PORT`, default 8787) |
| `client.mjs` | heartbeating WSS client (`WS_URL`, `PING_MS`, `MAX_MS`, `RECONNECT`, `LABEL`) |
| `start-tunnel.sh` | spawn + dual-stream drain + regex URL extraction + readiness probe + timing meta |
| `probe-reliability.mjs` | N cold upgrades via undici global `WebSocket` |
| `probe-upgrade.mjs` | N cold upgrades via raw `node:tls`, captures the **exact** HTTP status on refusal |
| `probe-concurrency.mjs` | N simultaneous WebSockets held open (used for the 200-cap test) |
| `wsclient/` | local `ws@8.22.0` install + `probe-ws.mjs` (surfaces `unexpected-response` status) |
| `warmup-curve.sh`, `coldstart-compare.sh` | the warm-up / cold-start experiments |
| `logs/` | raw evidence, hostnames redacted to `REDACTED-<random>.trycloudflare.com` |

Reproduce the core result:

```bash
cd spikes/tunnel
PORT=8787 node server.mjs > logs/origin.log 2>&1 &
./start-tunnel.sh myrun                      # prints URL + url_appeared_after + reachable_after
WS_URL="wss://$(grep -oE '[a-z0-9-]+\.trycloudflare\.com' logs/myrun.meta | head -1)" \
  PING_MS=25000 MAX_MS=780000 LABEL=longevity node client.mjs
```

All background processes started during this spike were terminated; ports 8787/8799/8801/8802/8803 are free
and no `cloudflared` processes remain.
