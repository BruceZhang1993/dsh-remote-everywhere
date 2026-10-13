import { once } from 'node:events'
import { localRequest } from './local.js'

const tools = [
  { name: 'remote_devices', description: 'List explicitly paired DSH devices.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'remote_call', description: 'Manage remote sessions and read authorized files. No automated approval decisions.', inputSchema: { type: 'object', properties: { deviceId: { type: 'string' }, method: { type: 'string' }, params: { type: 'object' } }, required: ['deviceId', 'method', 'params'], additionalProperties: false } },
  { name: 'remote_run', description: 'Prompt a remote DSH session and return bounded output. Human approvals stay in the target native GUI. Use a stable requestId for retries.', inputSchema: { type: 'object', properties: { deviceId: { type: 'string' }, sessionId: { type: 'string' }, text: { type: 'string' }, requestId: { type: 'string' } }, required: ['deviceId', 'sessionId', 'text'], additionalProperties: false } },
  { name: 'remote_operation', description: 'Write workspace text or execute a bounded command. Each operation requires fresh human approval in the target native GUI.', inputSchema: { type: 'object', properties: { deviceId: { type: 'string' }, method: { enum: ['files.write', 'terminal.exec'] }, params: { type: 'object' } }, required: ['deviceId', 'method', 'params'], additionalProperties: false } },
]

/** Bounded newline framing, including peers that never send a newline. */
export async function* mcpMessages(input) {
  let bytes = Buffer.alloc(0)
  for await (const chunk of input) {
    let start = 0
    const value = Buffer.from(chunk)
    while (start < value.length) {
      const end = value.indexOf(10, start)
      const part = value.subarray(start, end < 0 ? value.length : end)
      if (bytes.length + part.length > 65536) throw new Error('MCP message exceeds 64 KiB')
      bytes = Buffer.concat([bytes, part])
      if (end < 0) break
      if (bytes.length) yield new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      bytes = Buffer.alloc(0)
      start = end + 1
    }
  }
  if (bytes.length) throw new Error('incomplete MCP message')
}

export async function serveMcp(state, input = process.stdin, output = process.stdout) {
  const pending = new Map()
  let writes = Promise.resolve()
  const send = value => {
    writes = writes.then(async () => {
      if (!output.write(`${JSON.stringify({ jsonrpc: '2.0', ...value })}\n`)) await once(output, 'drain')
    })
    return writes
  }
  try {
    for await (const line of mcpMessages(input)) {
      let message
      try { message = JSON.parse(line) }
      catch { await send({ id: null, error: { code: -32700, message: 'invalid JSON' } }); continue }
      if (!message || typeof message !== 'object' || Array.isArray(message) || message.jsonrpc !== '2.0') { await send({ id: null, error: { code: -32600, message: 'invalid request' } }); continue }
      if (message.method === 'notifications/cancelled') { pending.get(message.params?.requestId)?.abort.abort(); continue }
      if (message.id === undefined) continue
      if (pending.size >= 32 || pending.has(message.id)) { await send({ id: message.id, error: { code: -32000, message: 'busy' } }); continue }
      const abort = new AbortController()
      const task = Promise.resolve().then(async () => {
        if (message.method === 'initialize') return { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'dsh-remote-everywhere', version: '0.1.0-alpha.2' } }
        if (message.method === 'ping') return {}
        if (message.method === 'tools/list') return { tools }
        if (message.method !== 'tools/call') throw new Error('unknown MCP method')
        const name = message.params?.name
        if (!tools.some(tool => tool.name === name)) throw new Error('unknown MCP tool')
        const method = { remote_devices: 'device.list', remote_call: 'remote.call', remote_run: 'remote.run', remote_operation: 'remote.operation' }[name]
        try {
          const result = await localRequest(state, method, message.params.arguments ?? {}, { signal: abort.signal })
          return { content: [{ type: 'text', text: JSON.stringify(result) }] }
        } catch (error) { return { isError: true, content: [{ type: 'text', text: error.code ?? 'operation failed' }] } }
      }).then(result => send({ id: message.id, result }), () => send({ id: message.id, error: { code: -32601, message: 'unknown MCP method' } })).finally(() => pending.delete(message.id))
      pending.set(message.id, { abort, task })
    }
    await Promise.allSettled([...pending.values()].map(item => item.task))
    await writes
  } catch (error) {
    for (const item of pending.values()) item.abort.abort()
    await Promise.allSettled([...pending.values()].map(item => item.task))
    throw error
  }
}
