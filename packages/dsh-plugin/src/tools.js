import { randomBytes } from 'node:crypto'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { ProtocolError, assertMethod } from '@dsh-remote/protocol'

export const CALL_METHODS = ['workspace.list', 'session.list', 'session.search', 'session.create', 'session.fork', 'session.rename', 'session.cancel', 'session.queue.update', 'session.projections', 'subagent.list', 'subagent.cancel', 'files.list', 'files.read', 'changes.summary']

export function registerTools(ctx, runtime) {
  const guard = ctx.on('tools/pre-execute', async (exec, next) => {
    if (/^mcp__.*__remote_(?:call|run|operation)$/.test(exec.name) && await runtime.remoteDriven(exec.agent, exec.signal)) return { kind: 'deny', reason: 'Remote-driven sessions cannot initiate another remote-control hop.' }
    return next()
  }, { prepend: true })
  const register = (name, description, parameters, execute) => ctx.tools.register(defineTool({ name, description, parameters,
    output: { schema: { type: 'object', additionalProperties: true }, render: (args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: async (params, exec) => {
      if (await runtime.remoteDriven(exec.agent, exec.signal)) throw new ProtocolError('unauthorized', 'remote-driven sessions cannot initiate remote control')
      return execute(params, exec)
    },
  }))
  const peer = { type: 'string', required: true, description: 'Explicit paired remote device id. Never infer a target.' }
  const stops = [
    register('remote_devices', 'List paired DSH devices and capabilities.', {}, async () => ({ devices: runtime.devices() })),
    register('remote_call', 'Manage remote sessions or read authorized files. Pairing and approval decisions require human management commands.', {
      deviceId: peer, method: { type: 'string', required: true, enum: CALL_METHODS }, params: { type: 'object', required: true, additionalProperties: true, properties: {} },
    }, async ({ deviceId, method, params }, exec) => (await runtime.connect(deviceId)).request(method, params, { signal: exec.signal })),
    register('remote_run', 'Prompt a paired DSH session and follow its output; route each approval or question to this DSH user. Returns a bounded event window.', {
      deviceId: peer, sessionId: { type: 'string', required: true }, text: { type: 'string', required: true }, requestId: { type: 'string', description: 'Stable identity when retrying the same prompt.' },
    }, (params, exec) => runRemote(ctx, runtime, params, exec)),
    register('remote_operation', 'Write a workspace text file or execute a bounded command after a fresh human approval.', {
      deviceId: peer, method: { type: 'string', required: true, enum: ['files.write', 'terminal.exec'] }, params: { type: 'object', required: true, additionalProperties: true, properties: {} },
    }, (params, exec) => operateRemote(ctx, runtime, params, exec)),
  ]
  return () => { guard(); stops.forEach(stop => stop()) }
}

/** MCP uses the target native GUI; DSH tools additionally present interactions locally. */
export async function runRemote(ctx, runtime, { deviceId, sessionId, text, requestId }, exec = {}) {
  requestId ??= randomBytes(16).toString('hex')
  const prompt = { sessionId, requestId, mode: 'queue', content: [{ type: 'text', text }] }
  assertMethod('session.prompt', prompt)
  const client = await runtime.connect(deviceId)
  return withInteractions(ctx, client, sessionId, exec, async signal => {
    const records = []
    let bytes = 0
    let cursor = -1
    let promptObserved = false
    let stream
    try {
      stream = client.follow({ address: { kind: 'session', sessionId }, assistantStream: true, maxMessages: 4 }, { signal })
      const opening = await stream.next()
      await client.request('session.prompt', prompt, { signal })
      const frames = (async function* () { if (!opening.done) yield opening.value; yield* stream })()
      for await (const value of frames) {
        const frame = value.records ? { ...value, records: value.records.filter(record => !record.event.type.startsWith('request/')) } : value
        const size = Buffer.byteLength(JSON.stringify(frame))
        if (records.length >= 128 || bytes + size > 48000) return { requestId, cursor, records, truncated: true }
        records.push(frame); bytes += size
        if (frame.cursor !== undefined) cursor = frame.cursor
        for (const record of frame.records ?? []) {
          cursor = Math.max(cursor, record.event.seq)
          if (record.event.type === 'user/message' && record.event.data?.source?.rpcId === requestId) promptObserved = true
          if (promptObserved && record.event.type === 'turn/end') return { requestId, cursor, records, truncated: false }
        }
      }
      return { requestId, cursor, records, truncated: true }
    } finally {
      await stream?.return()
    }
  })
}

async function withInteractions(ctx, client, sessionId, exec, action) {
  const abort = new AbortController()
  const signal = AbortSignal.any([exec.signal, abort.signal, AbortSignal.timeout(120000)].filter(Boolean))
  const activeInteractions = new Map()
  const onApproval = async data => {
    if (!exec.agent || data.sessionId !== sessionId || activeInteractions.has(data.approvalId)) return
    const cancellation = new AbortController()
    activeInteractions.set(data.approvalId, cancellation)
    try {
      const outcome = await ctx.approval.request({ agent: exec.agent, toolName: data.toolName, reason: data.reason, signal: AbortSignal.any([signal, cancellation.signal]) })
      if (!cancellation.signal.aborted) await client.request('approval.decide', { approvalId: data.approvalId, outcome }, { signal })
    } catch { /* Target/local cancellation closes both presentations. */ }
    finally { activeInteractions.delete(data.approvalId) }
  }
  const onQuestion = async data => {
    if (!exec.agent || data.sessionId !== sessionId || activeInteractions.has(data.questionId)) return
    const cancellation = new AbortController()
    activeInteractions.set(data.questionId, cancellation)
    try {
      const answer = await ctx.get('userQuestions').ask({ agent: exec.agent, questions: data.questions, signal: AbortSignal.any([signal, cancellation.signal]) })
      if (!cancellation.signal.aborted) await client.request('question.answer', { questionId: data.questionId, answer }, { signal })
    } catch { /* Target/local cancellation closes both presentations. */ }
    finally { activeInteractions.delete(data.questionId) }
  }
  const responded = data => activeInteractions.get(data.id)?.abort()
  client.on('approval.request', onApproval)
  client.on('question.request', onQuestion)
  client.on('approval.responded', responded)
  client.on('question.responded', responded)
  try { return await action(signal) }
  finally {
    abort.abort()
    for (const cancellation of activeInteractions.values()) cancellation.abort()
    client.off('approval.request', onApproval); client.off('question.request', onQuestion)
    client.off('approval.responded', responded); client.off('question.responded', responded)
  }
}

export async function operateRemote(ctx, runtime, { deviceId, method, params }, exec = {}) {
  const prepared = { ...params, method }
  assertMethod('operation.prepare', prepared)
  const client = await runtime.connect(deviceId)
  return withInteractions(ctx, client, params.sessionId, exec, async signal => {
    const abort = new AbortController()
    const stream = await client.open('stream.open', { address: { kind: 'session', sessionId: params.sessionId }, maxMessages: 1 }, { signal: AbortSignal.any([signal, abort.signal]) })
    const consumed = (async () => { for await (const frame of stream) {} })()
    consumed.catch(() => {})
    try {
      const grant = await client.request('operation.prepare', prepared, { signal })
      return await client.request(method, { ...params, approvalId: grant.approvalId }, { signal })
    } finally { abort.abort(); await consumed }
  })
}
