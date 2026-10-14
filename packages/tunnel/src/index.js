import { EventEmitter } from 'node:events'
import { spawn, execFile } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import WebSocket from 'ws'

export class TunnelError extends Error {
  constructor(code, message) { super(message); this.code = code }
}

function checkOrigin(origin) {
  const url = new URL(origin)
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new TunnelError('invalid-argument', 'tunnel origin must be a dedicated loopback HTTP listener')
  }
  return url.origin
}

/** Validate both HTTP health and an upgrade using the same WS library as the client. */
export async function probeTunnel(url, { signal }) {
  const response = await fetch(new URL('/health', url), { signal, redirect: 'error' })
  await response.body?.cancel()
  if (response.status !== 200) throw new TunnelError(response.status === 429 ? 'tunnel/busy' : 'tunnel/not-ready', 'public health check failed')
  const endpoint = new URL('/remote/ws', url)
  endpoint.protocol = 'wss:'
  await new Promise((resolve, reject) => {
    let done = false
    const socket = new WebSocket(endpoint, { handshakeTimeout: 5000, maxPayload: 65551, maxFragments: 1024, maxBufferedChunks: 1024, perMessageDeflate: false })
    const finish = error => {
      if (done) return
      done = true
      signal.removeEventListener('abort', aborted)
      socket.terminate()
      error ? reject(error) : resolve()
    }
    const aborted = () => finish(new TunnelError('cancelled', 'readiness check cancelled'))
    socket.on('error', () => finish(new TunnelError('tunnel/not-ready', 'public WebSocket upgrade failed')))
    socket.once('open', () => finish())
    socket.once('close', () => finish(new TunnelError('tunnel/not-ready', 'public WebSocket closed before ready')))
    socket.on('unexpected-response', (_request, response) => { response.destroy(); finish(new TunnelError('tunnel/not-ready', 'public WebSocket upgrade refused')) })
    if (signal.aborted) aborted()
    else signal.addEventListener('abort', aborted, { once: true })
  })
}

/** Own exactly one cloudflared process group. URLs are exposed only after readiness. */
export class TunnelManager extends EventEmitter {
  constructor({ binary = 'cloudflared', startupTimeoutMs = 60000, stopTimeoutMs = 5000, probe = probeTunnel } = {}) {
    super()
    for (const value of [startupTimeoutMs, stopTimeoutMs]) {
      if (!Number.isSafeInteger(value) || value < 1) throw new Error('invalid tunnel deadline')
    }
    this.binary = binary
    this.startupTimeoutMs = startupTimeoutMs
    this.stopTimeoutMs = stopTimeoutMs
    this.probe = probe
    this.state = 'stopped'
    this.url = null
    this.generation = 0
  }

  start(origin) {
    origin = checkOrigin(origin)
    if (this.stopping) return Promise.reject(new TunnelError('busy', 'tunnel is stopping'))
    if (this.starting) return this.starting
    if (this.state === 'ready') return Promise.resolve(this.url)
    const generation = ++this.generation
    this.starting = this.restartProcess(origin, generation).finally(() => { this.starting = null })
    return this.starting
  }

  async restartProcess(origin, generation) {
    if (this.child) {
      this.abort?.abort(new TunnelError('cancelled', 'reclaiming previous tunnel'))
      this.stopping = this.stopProcess().finally(() => { this.stopping = null })
      await this.stopping
    }
    if (generation !== this.generation) throw new TunnelError('cancelled', 'tunnel restart cancelled')
    return this.startProcess(origin)
  }

  async startProcess(origin) {
    this.state = 'starting'
    this.emit('state', this.state)
    this.abort = new AbortController()
    const signal = this.abort.signal
    const deadline = setTimeout(() => this.abort.abort(new TunnelError('tunnel/timeout', 'tunnel startup timed out')), this.startupTimeoutMs)
    try {
      const child = spawn(this.binary, ['--no-autoupdate', 'tunnel', '--url', origin, '--loglevel', 'info'], {
        detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
      })
      this.child = child
      this.exited = new Promise(resolve => child.once('close', (code, exitSignal) => {
        this.url = null
        if (this.state === 'ready') { this.state = 'failed'; this.emit('state', this.state) }
        resolve({ code, signal: exitSignal })
      }))
      const url = await new Promise((resolve, reject) => {
        const aborted = () => reject(signal.reason instanceof TunnelError ? signal.reason : new TunnelError('cancelled', 'tunnel startup cancelled'))
        signal.addEventListener('abort', aborted, { once: true })
        let found = false
        for (const [source, stream] of [['stdout', child.stdout], ['stderr', child.stderr]]) {
          let pending = ''
          stream.on('data', chunk => {
            const text = pending + chunk.toString('utf8')
            const lines = text.split('\n')
            pending = lines.pop().slice(-8192)
            this.emit('diagnostic', { source, bytes: chunk.length, truncated: text.length > 8192 })
            if (source !== 'stderr' || found) return
            // Every complete/partial line is bounded; never retain a full child log.
            for (const line of [...lines, pending]) {
              const match = line.slice(0, 8192).match(/https:\/\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.trycloudflare\.com\b/)
              if (match) { found = true; signal.removeEventListener('abort', aborted); resolve(match[0]); break }
            }
          })
        }
        child.once('error', () => reject(new TunnelError('tunnel/spawn', 'could not start cloudflared')))
        void this.exited.then(() => { signal.removeEventListener('abort', aborted); reject(new TunnelError('tunnel/exited', 'cloudflared exited before readiness')) })
      })
      for (let attempt = 0; ; attempt++) {
        if (signal.aborted) throw signal.reason
        const probeSignal = AbortSignal.any([signal, AbortSignal.timeout(5000)])
        try {
          await new Promise((resolve, reject) => {
            const aborted = () => reject(probeSignal.reason)
            probeSignal.addEventListener('abort', aborted, { once: true })
            Promise.resolve().then(() => this.probe(url, { signal: probeSignal })).then(resolve, reject)
              .finally(() => probeSignal.removeEventListener('abort', aborted))
          })
          break
        }
        catch (error) {
          if (signal.aborted) throw signal.reason
          await delay(Math.min(2000, 200 * 2 ** Math.min(attempt, 4)), undefined, { signal })
        }
      }
      if (signal.aborted || child.exitCode !== null || child.signalCode !== null) throw new TunnelError('tunnel/exited', 'cloudflared stopped before readiness')
      this.url = url
      this.state = 'ready'
      this.emit('state', this.state)
      return url
    } catch (error) {
      await this.stop()
      throw error
    } finally { clearTimeout(deadline) }
  }

  stop() {
    this.generation++
    if (this.stopping) return this.stopping
    this.url = null
    this.abort?.abort(new TunnelError('cancelled', 'tunnel stopped'))
    this.stopping = this.stopProcess().finally(() => { this.stopping = null })
    return this.stopping
  }

  async stopProcess() {
    const child = this.child
    if (!child) { this.state = 'stopped'; return }
    this.state = 'stopping'
    this.emit('state', this.state)
    const signalGroup = async force => {
      if (!child.pid) return
      if (process.platform === 'win32') {
        await new Promise(resolve => execFile('taskkill', ['/PID', String(child.pid), '/T', ...(force ? ['/F'] : [])], { windowsHide: true }, () => resolve()))
      } else {
        try { process.kill(-child.pid, force ? 'SIGKILL' : 'SIGTERM') }
        catch (error) { if (error.code !== 'ESRCH') throw error }
      }
    }
    await signalGroup(false)
    const wait = async () => {
      let timer
      try { return await Promise.race([this.exited.then(() => true), new Promise(resolve => { timer = setTimeout(() => resolve(false), this.stopTimeoutMs) })]) }
      finally { clearTimeout(timer) }
    }
    if (!await wait()) { await signalGroup(true); if (!await wait()) throw new TunnelError('tunnel/stop-timeout', 'cloudflared process group did not exit') }
    // Also remove helpers when the direct child already exited before stop().
    await signalGroup(true)
    this.child = null
    this.state = 'stopped'
    this.emit('state', this.state)
  }
}
