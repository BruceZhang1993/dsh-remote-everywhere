#!/usr/bin/env node
// Heartbeating WSS client through the quick tunnel. Node 22 built-in global WebSocket (undici).
// App-level ping every PING_MS (default 25000). Logs every close/error with code+reason and elapsed time.
const URL_ = process.env.WS_URL;
const PING_MS = Number(process.env.PING_MS || 25000);
const MAX_MS = Number(process.env.MAX_MS || 0);         // 0 = run forever
const RECONNECT = process.env.RECONNECT === '1';
const LABEL = process.env.LABEL || 'client';
const T0 = Date.now();

const pad = (n) => String(n).padStart(2, '0');
function stamp() {
  const d = new Date();
  const iso = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`;
  const el = Date.now() - T0;
  const mm = String(Math.floor(el / 60000)).padStart(2, '0');
  return `${iso} t+${mm}:${pad(Math.floor((el % 60000) / 1000))}.${String(el % 1000).padStart(3, '0')}`;
}
const log = (...a) => console.log(`[${LABEL} ${stamp()}]`, ...a);

if (!URL_) { console.error('WS_URL required'); process.exit(2); }

let attempt = 0;
let pingTimer = null, deadlineTimer = null;
let sent = 0, echoed = 0, missed = 0;
const inFlight = new Set();

function connect() {
  attempt++;
  const started = Date.now();
  log(`connect attempt#${attempt} -> ${URL_}`);
  let ws;
  try { ws = new WebSocket(URL_); }
  catch (e) { log(`ctor-throw ${e.message}`); return scheduleReconnect(); }

  const connectTimer = setTimeout(() => {
    log(`connect TIMEOUT after ${Date.now() - started}ms (no open event) -> terminating socket`);
    try { ws.close(); } catch {}
    try { ws.terminate?.(); } catch {}
  }, 20000);

  ws.onopen = () => {
    clearTimeout(connectTimer);
    log(`OPEN attempt#${attempt} after ${Date.now() - started}ms`);
    pingTimer = setInterval(() => {
      sent++;
      const nonce = `${sent}-${Date.now()}`;
      inFlight.add(nonce);
      log(`APP-PING #${sent} nonce=${nonce} (in-flight=${inFlight.size})`);
      try { ws.send(`ping:${nonce}`); }
      catch (e) { log(`send-failed ${e.message}`); }
      if (inFlight.size > 3) {
        missed = inFlight.size - 1;
        log(`WARN unacked pings=${inFlight.size - 1} (tunnel looks stalled but socket still open)`);
      }
    }, PING_MS);
  };

  ws.onmessage = (ev) => {
    const data = typeof ev.data === 'string' ? ev.data : '[binary]';
    if (data.startsWith('echo:ping:')) {
      const nonce = data.slice('echo:ping:'.length);
      const ok = inFlight.delete(nonce);
      echoed++;
      log(`APP-PONG #${echoed} nonce=${nonce} rtt-tracked=${ok} unmatched=${!ok} in-flight=${inFlight.size}`);
    } else {
      log(`MSG ${data.slice(0, 160)}`);
    }
  };

  ws.onerror = (ev) => {
    log(`ERROR event message="${ev.message || ''}" type=${ev.type || 'error'} err=${ev.error ? (ev.error.code || ev.error.message) : '-'}`);
  };

  ws.onclose = (ev) => {
    clearTimeout(connectTimer);
    if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
    const up = Date.now() - started;
    log(`CLOSE code=${ev.code} reason="${ev.reason}" wasClean=${ev.wasClean} uptime=${up}ms sent=${sent} echoed=${echoed} unacked=${inFlight.size}`);
    if (RECONNECT) scheduleReconnect();
  };
}

let reconnectAttempt = 0;
function scheduleReconnect() {
  reconnectAttempt++;
  const delay = Math.min(30000, 500 * 2 ** Math.min(reconnectAttempt - 1, 6));
  log(`reconnect in ${delay}ms (attempt ${reconnectAttempt})`);
  setTimeout(connect, delay);
}

process.on('SIGINT', () => { log(`SIGINT sent=${sent} echoed=${echoed}`); process.exit(0); });
process.on('SIGTERM', () => { log(`SIGTERM sent=${sent} echoed=${echoed}`); process.exit(0); });

if (MAX_MS > 0) {
  deadlineTimer = setTimeout(() => {
    log(`DEADLINE ${MAX_MS}ms reached: sent=${sent} echoed=${echoed} unacked=${inFlight.size} reconnectAttempts=${reconnectAttempt}`);
    process.exit(0);
  }, MAX_MS);
}

connect();
