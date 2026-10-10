#!/usr/bin/env node
// ws-library prober. Unlike undici's WebSocket, `ws` surfaces the origin's HTTP response via
// the 'unexpected-response' event, so we can record the EXACT status code of a refused upgrade.
import { WebSocket } from 'ws';

const URL_ = process.env.WS_URL;
const N = Number(process.env.N || 20);
const DELAY = Number(process.env.DELAY_MS || 250);
const TIMEOUT = Number(process.env.TIMEOUT_MS || 12000);
if (!URL_) { console.error('WS_URL required'); process.exit(2); }

function attempt(i) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    let settled = false;
    const ws = new WebSocket(URL_);
    const done = (outcome, detail) => {
      if (settled) return; settled = true;
      clearTimeout(timer);
      try { ws.terminate(); } catch {}
      resolve({ i, outcome, ms: Date.now() - t0, detail });
    };
    const timer = setTimeout(() => done('TIMEOUT'), TIMEOUT);
    ws.on('open', () => done('OPEN'));
    ws.on('unexpected-response', (_req, res) => {
      let body = '';
      res.on('data', (d) => { body += d.toString('utf8').slice(0, 120); });
      res.on('end', () => done(`HTTP-${res.statusCode}`, `${res.statusMessage || ''} cf-ray=${res.headers['cf-ray'] || '-'} body=${JSON.stringify(body.replace(/\s+/g, ' ').slice(0, 120))}`));
      setTimeout(() => done(`HTTP-${res.statusCode}`, 'no-body'), 1500);
    });
    ws.on('error', (e) => done('SOCK-ERR', e.code || e.message));
  });
}

const out = [];
for (let i = 1; i <= N; i++) {
  const r = await attempt(i);
  out.push(r);
  console.log(`#${String(i).padStart(2)} ${r.outcome.padEnd(9)} ${String(r.ms).padStart(5)}ms ${r.detail || ''}`);
  await new Promise((r2) => setTimeout(r2, DELAY));
}
const ok = out.filter((r) => r.outcome === 'OPEN');
const lat = ok.map((r) => r.ms).sort((a, b) => a - b);
console.log('---');
console.log(`client=ws attempts=${N} open=${ok.length} failed=${N - ok.length} success_rate=${(ok.length / N * 100).toFixed(1)}%`);
if (lat.length) console.log(`latency_ms min=${lat[0]} p50=${lat[Math.floor(lat.length / 2)]} max=${lat[lat.length - 1]}`);
const bad = out.filter((r) => r.outcome !== 'OPEN');
if (bad.length) {
  console.log('failure_detail=' + JSON.stringify(bad.map((b) => `${b.outcome} ${b.detail}`)));
}
