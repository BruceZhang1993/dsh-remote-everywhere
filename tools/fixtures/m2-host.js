import { createRequire } from 'node:module'
import { setTimeout as delay } from 'node:timers/promises'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
const require = createRequire(`${process.env.DSH_HOST_MODULE_ROOT}/@deepseek-ai/dsh/package.json`)
const { LlmAdapter } = await import(require.resolve('@deepseek-ai/dsh-llm'))
const { defineTool } = await import(require.resolve('@deepseek-ai/dsh-tools'))

export const inject = ['llm', 'tools', 'approval']
export function apply(ctx) {
  ctx.inject(['workspaceController'], async scoped => { await scoped.workspaceController.create({ path: process.cwd() }) })
  if (process.env.M2_LIVE_MODEL) ctx.effect(async () => {
    await delay(5000)
    const provider = process.env.M2_LIVE_PROVIDER
    const model = process.env.M2_LIVE_MODEL
    const info = await ctx.llm.resolveModelInfo(provider, model)
    const efforts = info.reasoning?.efforts.map(value => value.id) ?? []
    const reasoningEffort = efforts.includes('low') ? 'low' : undefined
    await ctx.get('agentDefaultModel').saveSelection({ provider, model, ...(reasoningEffort ? { reasoningEffort } : {}) })
    writeFileSync(join(process.env.DSH_HOME, 'm2-model-info.json'), JSON.stringify({ provider, model, efforts, selectedEffort: reasoningEffort ?? 'provider-default' }), { mode: 0o600 })
  })
  class FixtureAdapter extends LlmAdapter {
    providerInfo() { return { id: 'm2-fixture', name: 'Deterministic M2 test fixture' } }
    async listModels() { return [{ provider: 'm2-fixture', id: 'fixture', name: 'fixture' }] }
    async resolveModel() { return { provider: 'm2-fixture', id: 'fixture', name: 'fixture', contextWindow: 65536 } }
    async *stream(options) {
      options.signal?.throwIfAborted()
      if (options.messages.some(message => message.role === 'user' && JSON.stringify(message.content).includes('SLOW_PROBE'))) await delay(10000, undefined, { signal: options.signal })
      const lastUser = options.messages.findLastIndex(message => message.role === 'user' && /APPROVAL_PROBE|QUESTION_PROBE|SUBAGENT_PROBE|CONTINUABLE_PROBE|DIFF_PROBE|REMOTE_RUN_PROBE/.test(JSON.stringify(message.content)))
      const text = JSON.stringify(options.messages[lastUser]?.content ?? '')
      const toolDone = options.messages.slice(lastUser + 1).some(message => message.role === 'tool')
      if (/APPROVAL_PROBE|QUESTION_PROBE|SUBAGENT_PROBE|CONTINUABLE_PROBE|DIFF_PROBE|REMOTE_RUN_PROBE/.test(text) && !toolDone) {
        const name = text.includes('REMOTE_RUN_PROBE') ? 'remote_run' : text.includes('DIFF_PROBE') ? 'write' : text.includes('QUESTION_PROBE') ? 'm2_question_probe' : text.includes('SUBAGENT_PROBE') ? 'm2_subagent_probe' : text.includes('CONTINUABLE_PROBE') ? 'm2_continuable_probe' : 'm2_approval_probe'
        const arguments_ = text.includes('REMOTE_RUN_PROBE') ? JSON.stringify(JSON.parse(options.messages[lastUser].content.find(block => block.type === 'text').text.slice('REMOTE_RUN_PROBE '.length))) : text.includes('DIFF_PROBE') ? JSON.stringify({ file_path: 'm2-diff.txt', content: 'M2 diff content\n' }) : '{}'
        const block = { type: 'tool-call', id: `m2-probe-${Date.now()}`, name, arguments: arguments_ }
        yield { type: 'block-start', index: 0, blockType: 'tool-call' }
        yield { type: 'tool-call-delta', index: 0, id: block.id, name: block.name, argumentsDelta: arguments_ }
        yield { type: 'block-end', index: 0, block }
        yield { type: 'finish', reason: { kind: 'tool-calls' } }
      } else {
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text: 'M2_SMOKE_' }
        yield { type: 'text-delta', index: 0, text: 'OK' }
        yield { type: 'block-end', index: 0, block: { type: 'text', text: 'M2_SMOKE_OK' } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      }
    }
  }
  ctx.llm.registerAdapter(['m2-fixture'], new FixtureAdapter())
  ctx.tools.register(defineTool({ name: 'm2_approval_probe', description: 'Test fixture: ask once without performing an external action.', parameters: {},
    output: { schema: { type: 'object', properties: { outcome: { type: 'string', required: true } }, additionalProperties: false }, render: (args, value) => [{ type: 'text', text: value.outcome }] },
    execute: async (args, exec) => ({ outcome: await ctx.approval.request({ agent: exec.agent, toolName: 'm2_approval_probe', callId: exec.callId, reason: 'M2 isolated approval fixture; no external action', signal: exec.signal }) }),
  }))
  ctx.tools.register(defineTool({ name: 'm2_question_probe', description: 'Test fixture: ask a synthetic question.', parameters: {},
    output: { schema: { type: 'object', additionalProperties: true }, render: (args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: async (args, exec) => ctx.get('userQuestions').ask({ agent: exec.agent, signal: exec.signal, questions: [{ id: 'm2-question', question: 'M2 isolated question fixture', options: [{ label: 'Proceed' }, { label: 'Stop' }] }] }),
  }))
  ctx.tools.register(defineTool({ name: 'm2_continuable_probe', description: 'Test fixture: create one continuable child.', parameters: {},
    output: { schema: { type: 'object', additionalProperties: true }, render: (args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: async (args, exec) => {
      const run = await ctx.get('subagents').startActivation({ provider: 'spawn', label: 'M2 continuable child', request: { parent: exec.agent, prompt: [{ type: 'text', text: 'M2 continuable output' }], maxDepth: 1 }, signal: exec.signal, delivery: 'caller' })
      await run.result
      return { childId: run.childId }
    },
  }))
  ctx.tools.register(defineTool({ name: 'm2_subagent_probe', description: 'Test fixture: create one bounded in-process child.', parameters: {},
    output: { schema: { type: 'object', additionalProperties: true }, render: (args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: async (args, exec) => {
      const run = await ctx.get('subagents').startActivation({ provider: 'spawn', label: 'M2 child', request: { parent: exec.agent, prompt: [{ type: 'text', text: 'M2 child output' }], maxDepth: 1 }, signal: exec.signal, delivery: 'caller' })
      try { return { childId: run.childId, result: await run.result } }
      finally { await run.dispose() }
    },
  }))
}
