import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync, symlinkSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { DeviceStore } from '../packages/dsh-plugin/src/store.js'
import { pairDevice, RemoteClient } from '../packages/dsh-plugin/src/client.js'
import { localRequest } from '../packages/dsh-plugin/src/local.js'
import { deviceId } from '../packages/core/src/index.js'
import { ProtocolError } from '../packages/protocol/src/index.js'

const root = resolve(import.meta.dirname, '..')
const modules = process.env.DSH_HOST_MODULE_ROOT
if (!modules) throw new Error('set DSH_HOST_MODULE_ROOT to the installed DSH node_modules directory')
const directory = mkdtempSync(join(tmpdir(), 'dsh-m2-host-'))
const processes = []
const clients = []
const stores = []
const liveModel = process.env.M2_LIVE_MODEL
const liveProvider = process.env.M2_LIVE_PROVIDER
const pluginRoot = process.env.DSH_PLUGIN_PACKAGE_ROOT ?? join(root, 'packages/dsh-plugin')
const pluginName = JSON.parse(readFileSync(join(pluginRoot, 'package.json'), 'utf8')).name
function profile(label) {
  const home = join(directory, label)
  const profile = join(home, 'profiles', 'remote-test')
  mkdirSync(join(profile, 'node_modules'), { recursive: true, mode: 0o700 })
  mkdirSync(join(home, 'workspace'), { recursive: true, mode: 0o700 })
  symlinkSync(join(modules, '@deepseek-ai'), join(profile, 'node_modules', '@deepseek-ai'))
  mkdirSync(join(profile, 'node_modules', pluginName, '..'), { recursive: true })
  symlinkSync(pluginRoot, join(profile, 'node_modules', pluginName))
  const bundles = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', pluginName]
  if (liveProvider === 'workbuddy') {
    if (!process.env.M2_WORKBUDDY_PLUGIN) throw new Error('M2_WORKBUDDY_PLUGIN is required for the existing WorkBuddy model provider')
    symlinkSync(process.env.M2_WORKBUDDY_PLUGIN, join(profile, 'node_modules', 'dsh-workbuddy-connect'))
    bundles.push('dsh-workbuddy-connect')
  }
  writeFileSync(join(profile, 'package.json'), JSON.stringify({ name: `dsh-m2-${label}`, private: true, dependencies: { [pluginName]: `file:${pluginRoot}`, ...(liveProvider === 'workbuddy' ? { 'dsh-workbuddy-connect': `file:${process.env.M2_WORKBUDDY_PLUGIN}` } : {}) }, dsh: { profile: { bundles } } }))
  writeFileSync(join(profile, 'cordis.patch.yml'), `- id: agent-default-model\n  config:\n    provider: ${liveProvider ?? 'm2-fixture'}\n    model: ${liveModel ?? 'fixture'}\n${liveModel ? '    reasoningEffort: low\n' : ''}${process.env.M2_SEARCH_DISABLED === '1' ? '' : '- id: session-query-sqlite\n  config:\n    path: \":memory:\"\n    openAt: first-search\n'}- id: remote-everywhere\n  config:\n    cloudflared: ${join(root, 'spikes/tunnel/cloudflared')}\n- id: session-title-llm\n  disabled: true\n- insert:\n    - id: m2-test-model\n      name: ${join(root, 'tools/fixtures/m2-host.js')}\n`)
  return { home, profile, state: join(profile, 'remote'), workspace: join(home, 'workspace') }
}
async function start(config) {
  const child = spawn(process.execPath, [join(modules, '@deepseek-ai/dsh/lib/bin.js'), '--profile', 'remote-test', '--no-open', '--port', '0'], { cwd: config.workspace, env: { ...process.env, DSH_HOME: config.home, DSH_TELEMETRY_DISABLED: '1' }, stdio: ['ignore', 'pipe', 'pipe'] })
  let logs = ''
  const capture = chunk => { logs = (logs + chunk).slice(-12000) }
  child.stdout.on('data', capture); child.stderr.on('data', capture)
  child.once('error', error => { logs += error.code })
  child.logTail = () => logs.replace(/(token|key)=[^\s&]+/gi, '$1=[redacted]').slice(-3000)
  child.webUrl = () => logs.replace(/\x1b\[[0-9;]*m/g, '').match(/http:\/\/(?:localhost|127\.0\.0\.1):\d+[^\s]*/)?.[0]
  processes.push(child)
  for (let attempt = 0; attempt < 200; attempt++) {
    try {
      const status = await localRequest(config.state, 'status')
      const infoPath = join(config.home, 'm2-model-info.json')
      if (!liveModel || existsSync(infoPath)) {
        if (liveModel) console.log(JSON.stringify({ liveModelCapabilities: JSON.parse(readFileSync(infoPath, 'utf8')) }))
        return status
      }
    } catch {}
    if (child.exitCode !== null) break
    await delay(100)
  }
  throw new Error(`DSH ${config.home.split('/').at(-1)} failed startup${liveModel ? '' : `: ${child.logTail()}`}`)
}
async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise(resolve => child.once('exit', resolve))
  child.kill('SIGTERM')
  await Promise.race([exited, delay(5000)])
  if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await exited }
}
async function pair(source, target, caps) {
  const store = new DeviceStore(source.state)
  stores.push(store)
  const qr = await localRequest(target.state, 'pair.begin', { caps })
  const peer = await pairDevice(store, qr, async ({ sas }) => {
    for (let attempt = 0; attempt < 50; attempt++) {
      const pending = await localRequest(target.state, 'pair.pending')
      if (pending?.sas) { assert.equal(sas, pending.sas); await localRequest(target.state, 'pair.confirm', { sas }); return true }
      await delay(10)
    }
    throw new Error('pairing SAS unavailable')
  }, 'M2 smoke controller')
  const client = await new RemoteClient(store, peer).connect()
  clients.push(client)
  return client
}
async function mcp(state, messages) {
  const packageRoot = process.env.DSH_PLUGIN_PACKAGE_ROOT ?? join(root, 'packages/dsh-plugin')
  const child = spawn(process.execPath, [join(packageRoot, 'src/cli.js'), 'mcp', '--state', state], { stdio: ['pipe', 'pipe', 'pipe'] })
  let output = ''
  child.stdout.on('data', chunk => { output += chunk; if (Buffer.byteLength(output) > 1024 * 1024) child.kill('SIGKILL') })
  child.stderr.resume()
  const timer = setTimeout(() => child.kill('SIGKILL'), 20000)
  const completed = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', code => code === 0 ? resolve() : reject(new Error('MCP process failed'))) })
  child.stdin.end(messages.map(message => JSON.stringify({ jsonrpc: '2.0', ...message })).join('\n') + '\n')
  try { await completed; return output.trim().split('\n').map(line => JSON.parse(line)) }
  finally { clearTimeout(timer) }
}
async function run(client, workspace, approval = false, probe) {
  const created = await client.request('session.create', { cwd: workspace })
  const abort = new AbortController()
  const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(liveModel ? 60000 : 15000)])
  const events = []
  let approved = false
  const onApproval = data => {
    approved = true
    client.request('approval.decide', { approvalId: data.approvalId, outcome: 'allowed-once' }).catch(error => abort.abort(error))
  }
  if (approval) client.on('approval.request', onApproval)
  let answered = false
  const onQuestion = data => {
    answered = true
    client.request('question.answer', { questionId: data.questionId, answer: { answers: [{ id: 'm2-question', selected: ['Proceed'] }] } }).catch(error => abort.abort(error))
  }
  if (probe === 'QUESTION_PROBE') client.on('question.request', onQuestion)
  try {
    const stream = await client.open('stream.open', { address: { kind: 'session', sessionId: created.sessionId }, assistantStream: true, maxMessages: 4 }, { signal })
    const requestId = `m2-smoke-${Date.now()}`
    await client.request('session.prompt', { sessionId: created.sessionId, requestId, mode: 'queue', content: [{ type: 'text', text: probe ?? (approval ? 'APPROVAL_PROBE' : '只回复 M2_SMOKE_OK，不调用工具。') }] })
    for await (const frame of stream) {
      if (events.length >= 1024) throw new Error('smoke event budget exceeded')
      events.push(frame)
      if (frame.kind === 'append' && frame.records.some(record => record.event.type === 'turn/end')) break
    }
    const records = events.flatMap(frame => frame.records ?? []).map(record => record.event)
    if (!records.some(event => event.type === 'assistant/message')) {
      const codes = []
      const inspect = value => {
        if (!value || typeof value !== 'object') return
        for (const [key, item] of Object.entries(value)) {
          if (['code', 'kind', 'type'].includes(key) && typeof item === 'string' && /^[A-Za-z0-9_/-]{1,80}$/.test(item)) codes.push({ key, value: item })
          else if (typeof item === 'object') inspect(item)
        }
      }
      records.forEach(event => inspect(event))
      console.error(JSON.stringify({ modelFailure: codes.slice(-40) }))
      const failure = records.findLast(event => event.type === 'turn/end')?.data.reason?.error
      if (failure?.code === 'INVALID_REQUEST') console.error(JSON.stringify({ invalidRequest: String(failure.message).replace(/https?:\/\/\S+|Bearer\s+\S+|(?:token|key|secret|authorization)[=:]\s*\S+/gi, '[redacted]').slice(0, 240) }))
    }
    assert(records.some(event => event.type === 'user/message'))
    assert(records.some(event => event.type === 'assistant/message'))
    assert(events.some(frame => frame.kind === 'assistant-stream'))
    if (approval) {
      if (!approved) console.error(JSON.stringify({ fixtureEvents: records.map(event => ({ type: event.type, ...(event.type === 'tool/result' || event.type === 'tool/call' || event.type === 'agent/error' ? { data: event.data } : {}) })) }))
      assert(approved, 'remote approval was not requested')
      assert(records.some(event => event.type === 'approval/decided' && event.data.outcome === 'allowed-once'))
    }
    if (probe === 'QUESTION_PROBE') assert.equal(answered, true)
    await client.request('session.prompt', { sessionId: created.sessionId, requestId, mode: 'queue', content: [{ type: 'text', text: 'M2 retry same prompt' }] })
    return { sessionId: created.sessionId, requestId, cursor: records.at(-1).seq, events: records.length, liveFrames: events.filter(frame => frame.kind === 'assistant-stream').length }
  } finally { abort.abort(); client.off('approval.request', onApproval); client.off('question.request', onQuestion) }
}

try {
  const a = profile('a')
  const b = profile('b')
  await start(a); await start(b)
  if (process.env.M2_TUNNEL === '1') await localRequest(b.state, 'tunnel.start')
  console.log(JSON.stringify({ hostInfo: await localRequest(a.state, 'host.info') }))
  const ab = await pair(a, b, ['session', 'stream', 'approval', 'files', 'terminal'])
  const ba = await pair(b, a, ['session', 'stream', 'approval'])
  if (['1', 'question'].includes(process.env.M2_GUI)) {
    const input = createInterface({ input: process.stdin, output: process.stdout })
    const session = await ab.request('session.create', { cwd: b.workspace })
    const abort = new AbortController()
    const stream = await ab.open('stream.open', { address: { kind: 'session', sessionId: session.sessionId } }, { signal: abort.signal })
    const decisions = []
    const consume = (async () => { for await (const frame of stream) for (const record of frame.records ?? []) if (record.event.type === 'approval/decided') { decisions.push(record.event.data.outcome); console.log(JSON.stringify({ guiDecision: record.event.data.outcome })) } })()
    let pending
    ab.on('approval.request', value => { pending = value; console.log(JSON.stringify({ guiApproval: value.approvalId })) })
    console.log(JSON.stringify({ guiUrl: processes[1].webUrl(), sessionId: session.sessionId }))
    try {
      if (process.env.M2_GUI === '1') {
      await input.question('打开原生 GUI 并选择该会话后，输入回车发起本机胜出测试：')
      await ab.request('session.prompt', { sessionId: session.sessionId, requestId: 'gui-local', mode: 'queue', content: [{ type: 'text', text: 'APPROVAL_PROBE' }] })
      await input.question('在原生 GUI 单次允许并确认完成后，输入回车发起远端胜出测试：')
      assert.deepEqual(decisions, ['allowed-once'])
      pending = null
      await ab.request('session.prompt', { sessionId: session.sessionId, requestId: 'gui-remote', mode: 'queue', content: [{ type: 'text', text: 'APPROVAL_PROBE' }] })
      await input.question('确认 GUI 审批仍显示后，输入回车从远端拒绝：')
      assert(pending)
      await ab.request('approval.decide', { approvalId: pending.approvalId, outcome: 'rejected' })
      await input.question('确认 GUI 审批已撤回后，输入回车结束：')
      assert.deepEqual(decisions, ['allowed-once', 'rejected'])
      console.log(JSON.stringify({ nativeGuiLocalWin: true, nativeGuiRemoteWin: true }))
      }
      const target = await ab.request('session.create', { cwd: b.workspace })
      const question = process.env.M2_GUI === 'question'
      console.log(JSON.stringify({ sourceGuiUrl: processes[0].webUrl(), nativePrompt: `REMOTE_RUN_PROBE ${JSON.stringify({ deviceId: ab.peer.deviceId, sessionId: target.sessionId, text: question ? 'QUESTION_PROBE' : 'APPROVAL_PROBE', requestId: 'm2-native-tool' })}` }))
      await input.question('从源 GUI 新建本机会话并发送 nativePrompt，在源 GUI 人工批准/选择 Proceed 后输入回车结束原生控制端验收：')
      const targetProjections = await ab.request('session.projections', { sessionId: target.sessionId })
      assert(targetProjections?.asOfSeq > 0)
      const result = await ab.open('history.page', { address: { kind: 'session', sessionId: target.sessionId }, throughSeq: targetProjections.asOfSeq, maxMessages: 4 })
      let approved = false
      for await (const page of result) approved ||= page.records.some(record => question ? record.event.type === 'tool/result' && JSON.stringify(record.event.data).includes('Proceed') : record.event.type === 'approval/decided' && record.event.data.outcome === 'allowed-once')
      assert(approved)
      console.log(JSON.stringify(question ? { nativeControllerQuestion: true } : { nativeControllerApproval: true }))
    } finally { input.close(); abort.abort(); await consume }
  }
  await assert.rejects(ab.request('session.prompt', { sessionId: 'invalid', requestId: 'invalid', mode: 'invalid', content: [{ type: 'text', text: 'invalid' }] }), { code: 'invalid-argument' })
  const first = await run(ab, b.workspace, !liveModel)
  const second = await run(ba, a.workspace, !liveModel)
  assert((await ab.request('workspace.list')).items.some(item => item.path === b.workspace))
  if (process.env.M2_SEARCH_DISABLED === '1') await assert.rejects(ab.request('session.search', { query: 'APPROVAL_PROBE' }), { code: 'gateway/internal' })
  else assert((await ab.request('session.search', { query: 'APPROVAL_PROBE' })).items.length || liveModel)
  const control = await ab.open('control.subscribe', {})
  for await (const frame of control) { assert.equal(frame.type, 'baseline'); break }
  await localRequest(b.state, 'device.rename', { deviceId: deviceId(ab.store.keyPair.publicKey), name: 'M2 paired controller' })
  assert((await localRequest(b.state, 'device.list')).devices.some(peer => peer.name === 'M2 paired controller'))
  if (!liveModel) {
    const imageSession = await ab.request('session.create', { cwd: b.workspace })
    const imageStream = await ab.open('stream.open', { address: { kind: 'session', sessionId: imageSession.sessionId }, maxMessages: 4 }, { signal: AbortSignal.timeout(15000) })
    await ab.request('session.prompt', { sessionId: imageSession.sessionId, requestId: 'm2-image', mode: 'queue', content: [{ type: 'image', mediaType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWP4//8/AAX+Av5Y8msOAAAAAElFTkSuQmCC' }] })
    let image
    for await (const frame of imageStream) {
      for (const record of frame.records ?? []) if (record.event.type === 'user/message') image ??= record.event.data.content.find(part => part.type === 'image')
      if (frame.records?.some(record => record.event.type === 'turn/end')) break
    }
    assert(image)
    const imageRead = await ab.request('session.attachment', { sessionId: imageSession.sessionId, attachmentId: image.attachment.attachmentId })
    assert.equal(imageRead.attachment.attachmentId, image.attachment.attachmentId)
    assert(Buffer.from(imageRead.data, 'base64').length)
    await assert.rejects(ab.request('session.attachment', { sessionId: first.sessionId, attachmentId: image.attachment.attachmentId }), { code: 'session/attachment-invalid' })
    await run(ab, b.workspace, false, 'QUESTION_PROBE')
    const parent = await run(ab, b.workspace, false, 'SUBAGENT_PROBE')
    const children = await ab.request('subagent.list', { sessionId: parent.sessionId })
    assert.equal(children.items.length, 1)
    const child = children.items[0]
    const address = { kind: 'subagent', parentSessionId: parent.sessionId, childSessionId: child.id, mode: child.mode }
    let childCursor
    const childLive = await ab.open('stream.open', { address, maxMessages: 4 })
    for await (const frame of childLive) { childCursor = frame.cursor; assert(frame.records.some(record => record.event.type === 'assistant/message')); break }
    const childStream = await ab.open('history.page', { address, throughSeq: childCursor, maxMessages: 4 })
    for await (const page of childStream) assert(page.records.some(record => record.event.type === 'assistant/message'))
    const continuable = await run(ab, b.workspace, false, 'CONTINUABLE_PROBE')
    const activeChildren = (await ab.request('subagent.list', { sessionId: continuable.sessionId })).items
    assert.equal(activeChildren.length, 1)
    assert.equal(activeChildren[0].mode, 'continuable')
    const childAddress = { parentSessionId: continuable.sessionId, childSessionId: activeChildren[0].id, mode: 'continuable' }
    await ab.request('subagent.prompt', { ...childAddress, requestId: 'm2-child-prompt', delivery: 'queue', content: [{ type: 'text', text: 'M2 follow-up child' }] })
    await ab.request('subagent.cancel', childAddress)
    const edited = await run(ab, b.workspace, false, 'DIFF_PROBE')
    const changes = await ab.open('stream.open', { address: { kind: 'session', sessionId: edited.sessionId }, maxMessages: 4 }, { signal: AbortSignal.timeout(15000) })
    let seq
    for await (const frame of changes) {
      seq = frame.records?.find(record => record.event.type === 'workspace/changes')?.event.seq
      if (seq !== undefined) break
    }
    assert.notEqual(seq, undefined)
    const summary = await ab.request('changes.summary', { sessionId: edited.sessionId, seq })
    const changed = summary.files.find(file => file.path === 'm2-diff.txt')
    assert(changed)
    const diff = await ab.open('changes.diff', { sessionId: edited.sessionId, seq, index: changed.index })
    for await (const value of diff) assert(JSON.stringify(value).includes('M2 diff content'))
    const queued = await ab.request('session.create', { cwd: b.workspace })
    const wait = new AbortController()
    const source = await ab.open('stream.open', { address: { kind: 'session', sessionId: queued.sessionId }, maxMessages: 1 }, { signal: AbortSignal.any([wait.signal, AbortSignal.timeout(15000)]) })
    let started
    const start = new Promise(resolve => { started = resolve })
    let ended
    const end = new Promise(resolve => { ended = resolve })
    const consume = (async () => { for await (const frame of source) for (const record of frame.records ?? []) { if (record.event.type === 'step/start') started(); if (record.event.type === 'turn/end') ended() } })()
    try {
      await ab.request('session.prompt', { sessionId: queued.sessionId, requestId: 'm2-slow', mode: 'queue', content: [{ type: 'text', text: 'SLOW_PROBE' }] })
      await start
      for (const requestId of ['m2-edit', 'm2-remove']) await ab.request('session.prompt', { sessionId: queued.sessionId, requestId, mode: 'queue', content: [{ type: 'text', text: requestId }] })
      const inbox = (await ab.request('session.projections', { sessionId: queued.sessionId })).values.inbox['next-turn']
      const edit = inbox.find(item => item.source?.rpcId === 'm2-edit')
      const remove = inbox.find(item => item.source?.rpcId === 'm2-remove')
      assert(edit && remove)
      await ab.request('session.queue.update', { sessionId: queued.sessionId, itemId: edit.id, action: { kind: 'edit', content: [{ type: 'text', text: 'M2 edited queue' }] } })
      await ab.request('session.queue.update', { sessionId: queued.sessionId, itemId: edit.id, action: { kind: 'steer' } })
      await ab.request('session.queue.update', { sessionId: queued.sessionId, itemId: remove.id, action: { kind: 'remove' } })
      const after = (await ab.request('session.projections', { sessionId: queued.sessionId })).values.inbox
      assert.equal(after['next-turn'].length, 0)
      assert(after['next-step'].some(item => item.id === edit.id && JSON.stringify(item.content).includes('M2 edited queue')))
      await ab.request('session.cancel', { sessionId: queued.sessionId })
      await end
    } finally { wait.abort(); await consume }
  }
  const mcpSession = await ab.request('session.create', { cwd: b.workspace })
  const mcpResponses = await mcp(a.state, [
    { id: 1, method: 'initialize' }, { id: 2, method: 'tools/list' },
    { id: 3, method: 'tools/call', params: { name: 'remote_devices', arguments: {} } },
    { id: 4, method: 'tools/call', params: { name: 'remote_run', arguments: { deviceId: ab.peer.deviceId, sessionId: mcpSession.sessionId, text: 'M2 MCP run', requestId: 'm2-mcp-run' } } },
  ])
  assert.equal(mcpResponses.length, 4)
  assert(mcpResponses.every(message => message.result && !message.result.isError))
  const pluginInfo = JSON.parse(readFileSync(join(pluginRoot, 'package.json'), 'utf8'))
  assert.deepEqual(mcpResponses.find(message => message.id === 1).result.serverInfo, { name: pluginInfo.name, version: pluginInfo.version })
  const mcpRun = JSON.parse(mcpResponses.find(message => message.id === 4).result.content[0].text)
  assert.equal(mcpRun.requestId, 'm2-mcp-run')
  assert(mcpRun.records.length)
  if (!liveModel) assert.equal(mcpRun.truncated, false)
  const attachmentBytes = Buffer.from('M2 attachment '.repeat(4000))
  const uploaded = await ab.upload(first.sessionId, attachmentBytes, 'm2-attachment.txt')
  assert(uploaded.receiptId)
  assert.equal(uploaded.file.bytes, attachmentBytes.length)
  await ab.request('session.prompt', { sessionId: first.sessionId, requestId: 'm2-attachment-prompt', mode: 'queue', content: [{ type: 'text', text: 'M2 attachment' }, { type: 'file', receiptId: uploaded.receiptId }] })
  assert((await ab.request('session.list')).items.some(item => item.sessionId === first.sessionId || item.id === first.sessionId))
  await ab.request('session.rename', { sessionId: first.sessionId, title: 'M2 renamed' })
  const fork = await ab.request('session.fork', { sessionId: first.sessionId })
  assert(fork.sessionId)
  const pages = await ab.open('history.page', { address: { kind: 'session', sessionId: first.sessionId }, throughSeq: first.cursor, maxMessages: 4 })
  for await (const page of pages) assert(page.records.length)
  const operationsAbort = new AbortController()
  const operationStream = await ab.open('stream.open', { address: { kind: 'session', sessionId: first.sessionId }, maxMessages: 1 }, { signal: operationsAbort.signal })
  const consume = (async () => { for await (const frame of operationStream) {} })()
  const decide = data => ab.request('approval.decide', { approvalId: data.approvalId, outcome: 'allowed-once' }).catch(error => operationsAbort.abort(error))
  ab.on('approval.request', decide)
  try {
    const write = { sessionId: first.sessionId, path: 'm2-test.txt', content: 'M2 file content' }
    const grant = await ab.request('operation.prepare', { method: 'files.write', ...write })
    await assert.rejects(ab.request('files.write', { ...write, content: 'different content', approvalId: grant.approvalId }), { code: 'unauthorized' })
    await ab.request('files.write', { ...write, approvalId: grant.approvalId })
    assert.equal(readFileSync(join(b.workspace, write.path), 'utf8'), write.content)
    await assert.rejects(ab.request('files.write', { ...write, approvalId: grant.approvalId }), { code: 'approval/expired' })
    const read = await ab.request('files.read', { sessionId: first.sessionId, path: write.path })
    assert.equal(Buffer.from(read.data, 'base64').toString(), write.content)
    await assert.rejects(ab.request('files.read', { sessionId: first.sessionId, path: '..' }), { code: 'unauthorized' })
    const outside = join(directory, 'outside-workspace.txt')
    writeFileSync(outside, 'synthetic private fixture')
    symlinkSync(outside, join(b.workspace, 'outside-link.txt'))
    await assert.rejects(ab.request('files.read', { sessionId: first.sessionId, path: 'outside-link.txt' }), { code: 'unauthorized' })
    await assert.rejects(ab.request('operation.prepare', { method: 'files.write', sessionId: first.sessionId, path: 'outside-link.txt', content: 'must not overwrite' }), { code: 'unauthorized' })
    assert.equal(readFileSync(outside, 'utf8'), 'synthetic private fixture')
    const exec = { sessionId: first.sessionId, cwd: '.', command: 'printf M2_TERMINAL_OK' }
    const executeGrant = await ab.request('operation.prepare', { method: 'terminal.exec', ...exec })
    const result = await ab.request('terminal.exec', { ...exec, approvalId: executeGrant.approvalId })
    assert.equal(result.exitCode, 0)
    assert.equal(result.stdout, 'M2_TERMINAL_OK')
    const operation = await localRequest(a.state, 'remote.operation', { deviceId: ab.peer.deviceId, method: 'terminal.exec', params: exec })
    assert.equal(operation.stdout, 'M2_TERMINAL_OK')
    const streamGrant = await ab.request('operation.prepare', { method: 'terminal.exec', ...exec })
    const output = await ab.open('terminal.exec', { ...exec, approvalId: streamGrant.approvalId })
    let stdout = ''
    let exitCode
    for await (const value of output) { if (value.channel === 'stdout') stdout += value.text; if ('exitCode' in value) exitCode = value.exitCode }
    assert.equal(stdout, 'M2_TERMINAL_OK')
    assert.equal(exitCode, 0)
    const file = await ab.open('files.read', { sessionId: first.sessionId, path: write.path })
    let content = ''
    for await (const chunk of file) if (chunk.data) content += Buffer.from(chunk.data, 'base64').toString()
    assert.equal(content, write.content)
  } finally {
    ab.off('approval.request', decide)
    operationsAbort.abort()
    await consume
  }
  const repairAbort = new AbortController()
  const followers = [0, 1].map(() => ab.follow({ address: { kind: 'session', sessionId: first.sessionId }, maxMessages: 1 }, { signal: repairAbort.signal }))
  const openings = await Promise.all(followers.map(stream => stream.next()))
  const resumed = followers.map(stream => stream.next())
  ab.connection.close(new ProtocolError('transport/lost', 'M2 simulated network loss'))
  for (const [index, frame] of (await Promise.all(resumed)).entries()) {
    assert.equal(frame.value.kind, 'snapshot')
    assert(frame.value.cursor >= openings[index].value.cursor)
    assert.equal(frame.value.records.length, 0, 'reconnect must not duplicate consumed durable events')
  }
  repairAbort.abort()
  await Promise.all(followers.map(stream => stream.return()))
  await ab.close()
  await stop(processes[1])
  const reboot = await start(b)
  await ab.connect(reboot.endpoint)
  const abort = new AbortController()
  const recovered = await ab.open('stream.open', { address: { kind: 'session', sessionId: first.sessionId }, sinceSeq: first.cursor - 5, maxMessages: 1 }, { signal: abort.signal })
  for await (const frame of recovered) {
    assert.equal(frame.kind, 'snapshot')
    assert(frame.cursor >= first.cursor)
    assert(frame.records[0].event.seq <= first.cursor - 4)
    break
  }
  abort.abort()
  await ab.request('session.prompt', { sessionId: first.sessionId, requestId: first.requestId, mode: 'queue', content: [{ type: 'text', text: 'same request after restart' }] })
  await ab.request('session.cancel', { sessionId: first.sessionId })
  const revoked = ba.store.devices.find(peer => peer.deviceId === ba.peer.deviceId)
  assert(revoked)
  await localRequest(a.state, 'device.revoke', { deviceId: deviceId(ba.store.keyPair.publicKey) })
  await ba.connection.closed
  assert.equal(ba.connection.state, 'closed')
  await assert.rejects(ba.connect(), { code: 'unauthorized' })
  console.log(JSON.stringify({ genuineDshProcesses: 2, deterministicModelFixture: !liveModel, ...(liveModel ? { liveProvider, liveModel } : { questionsSubagentQueue: true, imageAttachmentAuthorization: true }), ab: first, ba: second, pairedBothDirections: true, renameForkHistory: true, attachmentUpload: true, sessionSearch: process.env.M2_SEARCH_DISABLED === '1' ? 'host-default-disabled' : 'enabled', controlBaseline: true, deviceRename: true, remoteRun: true, approvedFilesTerminal: true, rebootHistory: true, immediateRevoke: true, publicTunnel: process.env.M2_TUNNEL === '1' }))
} catch (error) {
  if (!liveModel) for (const child of processes) console.error(child.logTail?.())
  throw error
} finally {
  for (const client of clients) await client.close()
  for (const child of processes) await stop(child)
  for (const store of stores) store.close()
  rmSync(directory, { recursive: true, force: true })
}
