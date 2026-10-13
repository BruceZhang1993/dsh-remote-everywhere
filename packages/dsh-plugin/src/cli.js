#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'
import { localRequest } from './local.js'
import { DeviceStore } from './store.js'
import { pairDevice, RemoteClient } from './client.js'
import QRCode from 'qrcode'
import { serveMcp } from './mcp.js'

const arguments_ = process.argv.slice(2)
const command = arguments_.shift()
const options = {}
while (arguments_.length) {
  const flag = arguments_.shift()
  if (!flag.startsWith('--') || !arguments_.length) throw new Error('expected --option value')
  options[flag.slice(2)] = arguments_.shift()
}

async function main() {
  if (!command || !options.state) {
    console.log('dsh-remote <status|pair-begin|pair-pending|pair-confirm|pair|devices|revoke|rename|call|operation|follow|tunnel-start|tunnel-stop|mcp> --state <profile/remote> [--qr <file>] [--sas <digits>] [--device <id>] [--method <method>] [--params <JSON>]')
    return
  }
  if (command === 'mcp') return serveMcp(options.state)
  if (command === 'pair') {
    const store = new DeviceStore(options.state)
    const input = createInterface({ input: process.stdin, output: process.stderr })
    try {
      const qr = JSON.parse(readFileSync(options.qr, 'utf8'))
      const device = await pairDevice(store, qr, async ({ sas, name, deviceId }) => {
        const answer = await input.question(`对端 ${name} (${deviceId})，SAS ${sas}。与被控端人工核对后输入同样的 6 位数字：`)
        return answer === sas
      })
      console.log(JSON.stringify({ deviceId: device.deviceId, name: device.name, caps: device.remoteCaps }))
    } finally { input.close(); store.close() }
    return
  }
  if (command === 'follow') {
    const store = new DeviceStore(options.state)
    const peer = store.devices.find(value => value.deviceId === options.device && !value.revokedAt)
    if (!peer) throw new Error('unknown device')
    const client = new RemoteClient(store, peer)
    const input = createInterface({ input: process.stdin, output: process.stderr })
    const pending = new Map()
    let prompts = Promise.resolve()
    try {
      await client.connect(options.endpoint)
      const ask = (kind, value) => {
        const id = value.approvalId ?? value.questionId
        if (pending.has(id) || pending.size >= 32) return
        const abort = new AbortController()
        pending.set(id, abort)
        prompts = prompts.then(async () => {
          if (abort.signal.aborted) return
          console.log(JSON.stringify({ type: `${kind}.request`, ...value }))
          const answer = await input.question(kind === 'approval' ? '核对请求后输入 allow 单次允许，其他输入拒绝：' : '请输入答案 JSON {"answers":[{"id":"...","selected":["..."]}]}：', { signal: abort.signal })
          if (kind === 'approval') await client.request('approval.decide', { approvalId: id, outcome: answer === 'allow' ? 'allowed-once' : 'rejected' })
          else await client.request('question.answer', { questionId: id, answer: JSON.parse(answer) })
        }).catch(error => { if (!abort.signal.aborted) console.error(error.code ?? 'interaction failed') }).finally(() => pending.delete(id))
      }
      client.on('approval.request', value => ask('approval', value))
      client.on('question.request', value => ask('question', value))
      client.on('approval.responded', value => pending.get(value.id)?.abort())
      client.on('question.responded', value => pending.get(value.id)?.abort())
      const abort = new AbortController()
      process.once('SIGINT', () => abort.abort())
      const stream = client.follow({ address: { kind: 'session', sessionId: options.session }, sinceSeq: options.cursor === undefined ? undefined : Number(options.cursor), assistantStream: true }, { signal: abort.signal, endpoint: options.endpoint ?? peer.endpoint })
      for await (const value of stream) console.log(JSON.stringify(value))
    } finally { for (const abort of pending.values()) abort.abort(); input.close(); await client.close(); store.close() }
    return
  }
  const methods = { status: 'status', 'pair-begin': 'pair.begin', 'pair-pending': 'pair.pending', 'pair-confirm': 'pair.confirm', devices: 'device.list', revoke: 'device.revoke', rename: 'device.rename', call: 'remote.call', operation: 'remote.operation', 'tunnel-start': 'tunnel.start', 'tunnel-stop': 'tunnel.stop' }
  if (!methods[command]) throw new Error('unknown command')
  const result = await localRequest(options.state, methods[command], { sas: options.sas, deviceId: options.device, name: options.name, caps: options.caps?.split(','), method: options.method, params: options.params ? JSON.parse(options.params) : {}, endpoint: options.endpoint })
  if (command === 'pair-begin') console.error(await QRCode.toString(JSON.stringify(result), { type: 'terminal', small: true }))
  console.log(JSON.stringify(result))
}
main().catch(error => { console.error(error.code ?? 'error', error.message); process.exitCode = 1 })
