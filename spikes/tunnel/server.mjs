#!/usr/bin/env node
// Minimal RFC6455 WebSocket echo server using ONLY Node built-ins.
// Binds 127.0.0.1:PORT. Logs connect/disconnect/frame events with ISO timestamps + monotonic offset.
import http from 'node:http';
import crypto from 'node:crypto';

const PORT = Number(process.env.PORT || 8787);
const HOST = '127.0.0.1';
const T0 = Date.now();

const pad = (n) => String(n).padStart(2, '0');
function stamp() {
  const d = new Date();
  const iso = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getTime ? pad(d.getHours()) : 0)}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`;
  return `${iso} +${String(Date.now() - T0).padStart(7)}ms`;
}
const log = (...a) => console.log(`[srv ${stamp()}]`, ...a);

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const server = http.createServer((req, res) => {
  // Plain HTTP readiness probe target for the tunnel.
  log(`http ${req.method} ${req.url} ua=${req.headers['user-agent'] || '-'} cf-ray=${req.headers['cf-ray'] || '-'}`);
  res.writeHead(200, { 'content-type': 'text/plain', 'x-spike': 'tunnel' });
  res.end('spike-ok\n');
});

let connSeq = 0;
server.on('upgrade', (req, socket, head) => {
  const id = ++connSeq;
  const key = req.headers['sec-websocket-key'];
  log(`upgrade#${id} url=${req.url} key=${key ? 'yes' : 'NO'} cf-ray=${req.headers['cf-ray'] || '-'} xff=${req.headers['x-forwarded-for'] || '-'} proto=${req.headers['sec-websocket-protocol'] || '-'}`);
  if (!key) { socket.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
  );
  log(`connect#${id} handshake-complete`);

  let buf = Buffer.alloc(0);
  if (head && head.length) buf = Buffer.concat([buf, head]);
  let msgs = 0, bytes = 0, pings = 0, pongs = 0;

  function send(opcode, payload) {
    const len = payload.length;
    let header;
    if (len < 126) { header = Buffer.alloc(2); header[1] = len; }
    else if (len < 65536) { header = Buffer.alloc(4); header[1] = 126; header.writeUInt16BE(len, 2); }
    else { header = Buffer.alloc(10); header[1] = 127; header.writeBigUInt64BE(BigInt(len), 2); }
    header[0] = 0x80 | opcode;
    socket.write(Buffer.concat([header, payload]));
  }
  const sendText = (s) => send(0x1, Buffer.from(s, 'utf8'));

  socket.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      if (buf.length < 2) return;
      const b0 = buf[0], b1 = buf[1];
      const fin = (b0 & 0x80) !== 0;
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f, off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      let mask = null;
      if (masked) { if (buf.length < off + 4) return; mask = buf.subarray(off, off + 4); off += 4; }
      if (buf.length < off + len) return;
      const payload = Buffer.from(buf.subarray(off, off + len));
      if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
      buf = buf.subarray(off + len);

      if (!fin) { log(`#${id} WARN fragmented frame (fin=0) opcode=${opcode} - not handled`); }
      if (opcode === 0x8) {
        const code = payload.length >= 2 ? payload.readUInt16BE(0) : null;
        const reason = payload.length > 2 ? payload.subarray(2).toString('utf8') : '';
        log(`#${id} RECV close code=${code} reason="${reason}" msgs=${msgs} pings=${pings} pongs=${pongs}`);
        send(0x8, payload.length >= 2 ? payload.subarray(0, 2) : Buffer.alloc(0));
        socket.end();
        return;
      }
      if (opcode === 0x9) { pings++; log(`#${id} RECV ws-ping len=${len} -> pong`); send(0xA, payload); continue; }
      if (opcode === 0xA) { pongs++; log(`#${id} RECV ws-pong len=${len}`); continue; }
      if (opcode === 0x1 || opcode === 0x2) {
        msgs++; bytes += len;
        const text = payload.toString('utf8');
        log(`#${id} RECV ${opcode === 0x1 ? 'text' : 'binary'} len=${len} body="${text.slice(0, 120)}"`);
        sendText(`echo:${text}`);
      }
    }
  });

  const ka = setInterval(() => { log(`#${id} alive msgs=${msgs} bytes=${bytes} ws-pings=${pings} ws-pongs=${pongs}`); }, 60000);
  const done = (why) => {
    clearInterval(ka);
    log(`disconnect#${id} reason=${why} msgs=${msgs} bytes=${bytes} uptime=${Date.now() - T0}ms`);
  };
  socket.on('close', () => done('socket-close'));
  socket.on('error', (e) => { log(`#${id} socket-error ${e.code || e.message}`); done('error'); });
  socket.on('end', () => log(`#${id} socket-end (peer FIN)`));
  socket.setNoDelay(true);
  socket.setTimeout(0);
});

server.on('error', (e) => { log('SERVER ERROR', e.code, e.message); process.exit(1); });
server.listen(PORT, HOST, () => log(`listening ws+http on ${HOST}:${PORT} pid=${process.pid}`));

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { log(`signal ${sig} -> exit`); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 300); });
}
