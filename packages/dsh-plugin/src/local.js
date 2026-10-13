import net from 'node:net'
import { chmodSync, lstatSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { ProtocolError } from '@dsh-remote/protocol'

/** Filesystem-authenticated local management. Never mounted on the public listener. */
export async function localServer(directory, dispatch) {
  const path = join(directory, 'control.sock')
  try {
    if (!lstatSync(path).isSocket()) throw new Error('management path is not a socket')
    await new Promise((resolve, reject) => {
      const probe = net.connect(path)
      probe.once('connect', () => { probe.destroy(); reject(new Error('remote plugin already active for this profile')) })
      probe.once('error', error => error.code === 'ECONNREFUSED' ? resolve() : reject(error))
    })
    unlinkSync(path)
  } catch (error) { if (error.code !== 'ENOENT') throw error }
  const sockets = new Set()
  const tasks = new Set()
  const server = net.createServer(socket => {
    if (sockets.size >= 32 || tasks.size >= 32) { socket.destroy(); return }
    const abort = new AbortController()
    sockets.add(socket)
    socket.once('close', () => { sockets.delete(socket); abort.abort() })
    socket.setTimeout(180000, () => socket.destroy())
    let bytes = Buffer.alloc(0)
    socket.on('data', chunk => {
      bytes = Buffer.concat([bytes, chunk])
      if (bytes.length > 65536) { socket.destroy(); return }
      const index = bytes.indexOf(10)
      if (index < 0) return
      socket.pause()
      const task = Promise.resolve().then(() => dispatch(JSON.parse(bytes.subarray(0, index).toString('utf8')), { signal: abort.signal })).then(
        result => socket.end(`${JSON.stringify({ result })}\n`),
        error => socket.end(`${JSON.stringify({ error: { code: error.code ?? 'internal', message: error instanceof ProtocolError ? error.message : 'local operation failed' } })}\n`),
      )
      tasks.add(task)
      task.finally(() => tasks.delete(task)).catch(() => {})
    })
    socket.on('error', () => {})
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(path, resolve) })
  chmodSync(path, 0o600)
  return async () => {
    for (const socket of sockets) socket.destroy()
    await new Promise(resolve => server.close(resolve))
    await Promise.allSettled(tasks)
    try { unlinkSync(path) } catch (error) { if (error.code !== 'ENOENT') throw error }
  }
}

export async function localRequest(directory, method, params = {}, { signal } = {}) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(join(directory, 'control.sock'))
    const abort = () => socket.destroy(new ProtocolError('cancelled', 'local request cancelled'))
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
    socket.once('close', () => signal?.removeEventListener('abort', abort))
    let bytes = Buffer.alloc(0)
    socket.setTimeout(180000, () => socket.destroy(new Error('local operation timed out')))
    socket.once('connect', () => socket.write(`${JSON.stringify({ method, params })}\n`))
    socket.on('data', chunk => {
      bytes = Buffer.concat([bytes, chunk])
      if (bytes.length > 4 * 1024 * 1024) { socket.destroy(new Error('local response too large')); return }
      const index = bytes.indexOf(10)
      if (index < 0) return
      try {
        const value = JSON.parse(bytes.subarray(0, index).toString('utf8'))
        value.error ? reject(new ProtocolError(value.error.code, value.error.message)) : resolve(value.result)
      } catch (error) { reject(error) }
      socket.destroy()
    })
    socket.once('error', reject)
    socket.once('end', () => { if (!bytes.includes(10)) reject(new Error('local response incomplete')) })
  })
}
