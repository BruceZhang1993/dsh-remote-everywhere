#!/usr/bin/env node
// Cold-connect reliability probe: N sequential WSS handshakes, records outcome + latency.
const URL_ = process.env.WS_URL;
const N = Number(process.env.N || 20);
const TIMEOUT = Number(process.env.TIMEOUT_MS || 12000);
if (!URL_) { console.error('WS_URL required'); process.exit(2); }

const results = [];
function once(i) {
  return new Promise((resolve) => {
    const t = Date.now();
    let done = false;
    let ws;
    const finish = (outcome, detail) => {
      if (done) return; done = true;
      clearTimeout(timer);
      try { ws && ws.close(); } catch {}
      const ms = Date.now() - t;
      results.push({ i, outcome, ms, detail });
      console.log(`#${String(i).padStart(2)} ${outcome.padEnd(8)} ${String(ms).padStart(5)}ms ${detail || ''}`);
      resolve();
    };
    const timer = setTimeout(() => { try { ws && ws.close(); } catch {} finish('TIMEOUT', `>${TIMEOUT}ms`); }, TIMEOUT);
    try { ws = new WebSocket(URL_); } catch (e) { return finish('CTOR-ERR', e.message); }
    ws.onopen = () => finish('OPEN');
    ws.onerror = (ev) => finish('ERROR', ev.message || 'network error');
  });
}
for (let i = 1; i <= N; i++) { await once(i); await new Promise(r => setTimeout(r, 400)); }
const ok = results.filter(r => r.outcome === 'OPEN');
const lat = ok.map(r => r.ms).sort((a, b) => a - b);
const pct = (p) => lat.length ? lat[Math.min(lat.length - 1, Math.floor(p / 100 * lat.length))] : -1;
console.log('---');
console.log(`URL=${URL_}`);
console.log(`attempts=${N} open=${ok.length} failed=${N - ok.length} success_rate=${(ok.length / N * 100).toFixed(1)}%`);
console.log(`latency_ms min=${lat[0]} p50=${pct(50)} p90=${pct(90)} max=${lat[lat.length - 1]}`);
const fails = results.filter(r => r.outcome !== 'OPEN');
if (fails.length) console.log('failure_outcomes=' + JSON.stringify(fails.map(f => `${f.outcome}(${f.detail})`)));
