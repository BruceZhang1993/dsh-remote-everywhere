#!/usr/bin/env node
// Concurrency probe: open N simultaneous WSS connections through the tunnel and hold them.
// Purpose: test whether long-lived WebSockets consume the documented 200 in-flight request budget
// (docs say only the initial upgrade counts as an HTTP request).
const URL_ = process.env.WS_URL;
const N = Number(process.env.N || 220);
const HOLD_MS = Number(process.env.HOLD_MS || 15000);
const OPEN_TIMEOUT = Number(process.env.OPEN_TIMEOUT_MS || 20000);
if (!URL_) { console.error('WS_URL required'); process.exit(2); }

const results = { open: 0, http429: 0, httpOther: {}, err: 0, timeout: 0 };
const open = [];
const failures = [];

function attempt(i) {
  return new Promise((resolve) => {
    let settled = false;
    let ws;
    const t0 = Date.now();
    const done = (kind, detail) => {
      if (settled) return; settled = true;
      clearTimeout(timer);
      if (kind !== 'open') { try { ws && ws.terminate(); } catch {} }
      resolve({ i, kind, ms: Date.now() - t0, detail });
    };
    const timer = setTimeout(() => done('timeout'), OPEN_TIMEOUT);
    try { ws = new WebSocket(URL_); } catch (e) { return done('err', e.message); }
    ws.onopen = () => { open.push(ws); done('open'); };
    ws.onerror = (ev) => done('err', ev.message || 'error');
  });
}

const t0 = Date.now();
const all = await Promise.all(Array.from({ length: N }, (_, k) => attempt(k + 1)));
for (const r of all) {
  if (r.kind === 'open') results.open++;
  else if (r.kind === 'timeout') results.timeout++;
  else { results.err++; failures.push(r.detail); }
}
console.log(`opened=${results.open}/${N} errors=${results.err} timeouts=${results.timeout} in ${Date.now() - t0}ms`);
if (failures.length) {
  const uniq = {};
  failures.forEach((f) => { uniq[f] = (uniq[f] || 0) + 1; });
  console.log('failure_messages=' + JSON.stringify(uniq));
}
const stat429 = failures.filter((f) => /429|too many/i.test(f)).length;
console.log(`mentions_of_429=${stat429}`);
console.log(`holding ${open.length} sockets for ${HOLD_MS}ms...`);
await new Promise((r) => setTimeout(r, HOLD_MS));
const alive = open.filter((w) => w.readyState === 1).length;
console.log(`after_hold: still_open=${alive}/${open.length}`);
open.forEach((w) => { try { w.close(); } catch {} });
