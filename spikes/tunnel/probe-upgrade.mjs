#!/usr/bin/env node
// Raw TLS WebSocket-upgrade prober: writes an RFC6455 handshake by hand and reports the exact
// HTTP status line + body when the edge refuses the upgrade (something undici's WebSocket hides).
import tls from 'node:tls';
import crypto from 'node:crypto';

const HOST = process.env.HOST;
const N = Number(process.env.N || 20);
const DELAY = Number(process.env.DELAY_MS || 300);
if (!HOST) { console.error('HOST required (e.g. x.trycloudflare.com)'); process.exit(2); }

function attempt(i) {
  return new Promise((resolve) => {
    const key = crypto.randomBytes(16).toString('base64');
    const t0 = Date.now();
    const sock = tls.connect({ host: HOST, port: 443, servername: HOST, ALPNProtocols: ['http/1.1'] });
    let buf = '';
    let settled = false;
    const done = (rec) => { if (settled) return; settled = true; try { sock.destroy(); } catch {}; resolve({ i, ms: Date.now() - t0, ...rec }); };
    const timer = setTimeout(() => done({ status: 'TIMEOUT' }), 15000);
    sock.on('secureConnect', () => {
      sock.write(
        `GET / HTTP/1.1\r\nHost: ${HOST}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
        `Sec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\nUser-Agent: spike-prober/1.0\r\n\r\n`
      );
    });
    sock.on('data', (d) => {
      buf += d.toString('latin1');
      const headEnd = buf.indexOf('\r\n\r\n');
      if (headEnd < 0) return;
      clearTimeout(timer);
      const head = buf.slice(0, headEnd);
      const body = buf.slice(headEnd + 4).slice(0, 160).replace(/\s+/g, ' ');
      const statusLine = head.split('\r\n')[0];
      const code = Number((statusLine.match(/HTTP\/1\.1 (\d+)/) || [])[1] || 0);
      if (code === 101) return done({ status: 101, detail: 'upgrade-ok' });
      const ray = (head.match(/cf-ray: (\S+)/i) || [])[1] || '-';
      const server = (head.match(/server: (\S+)/i) || [])[1] || '-';
      done({ status: code, detail: `${statusLine} | server=${server} cf-ray=${ray} body=${JSON.stringify(body)}` });
    });
    sock.on('error', (e) => { clearTimeout(timer); done({ status: 'SOCK-ERR', detail: e.code || e.message }); });
  });
}

const out = [];
for (let i = 1; i <= N; i++) {
  const r = await attempt(i);
  out.push(r);
  const ok = r.status === 101;
  console.log(`#${String(i).padStart(2)} ${ok ? 'OPEN ' : 'FAIL '} ${String(r.ms).padStart(5)}ms http=${r.status} ${r.detail || ''}`);
  await new Promise((r2) => setTimeout(r2, DELAY));
}
const ok = out.filter((r) => r.status === 101);
const lat = ok.map((r) => r.ms).sort((a, b) => a - b);
console.log('---');
console.log(`HOST=${HOST} attempts=${N} upgraded=${ok.length} refused=${N - ok.length} success_rate=${(ok.length / N * 100).toFixed(1)}%`);
if (lat.length) console.log(`upgrade_latency_ms min=${lat[0]} p50=${lat[Math.floor(lat.length / 2)]} max=${lat[lat.length - 1]}`);
const refused = out.filter((r) => r.status !== 101);
for (const r of refused) console.log(`REFUSED #${r.i}: ${r.detail}`);
if (refused.length) {
  const codes = {};
  refused.forEach((r) => { codes[r.status] = (codes[r.status] || 0) + 1; });
  console.log('refusal_status_codes=' + JSON.stringify(codes));
}
