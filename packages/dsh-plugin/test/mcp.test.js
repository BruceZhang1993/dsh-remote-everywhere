import test from 'node:test'
import assert from 'node:assert/strict'
import { Readable, Writable } from 'node:stream'
import { mcpMessages, serveMcp } from '../src/mcp.js'

test('MCP framing rejects oversized unterminated input and preserves split multibyte messages', async () => {
  const utf8 = Buffer.from('{"text":"中文"}\n{"id":1}\n')
  const records = []
  for await (const value of mcpMessages(Readable.from([utf8.subarray(0, 11), utf8.subarray(11)]))) records.push(JSON.parse(value))
  assert.deepEqual(records, [{ text: '中文' }, { id: 1 }])
  await assert.rejects(async () => { for await (const value of mcpMessages(Readable.from([Buffer.alloc(65536, 65), Buffer.from('A')]))) {} }, /64 KiB/)
})

test('MCP keeps stdout valid JSON-RPC after malformed requests and advertises remote_run', async () => {
  let response = ''
  const output = new Writable({ write(chunk, encoding, done) { response += chunk; done() } })
  const input = Readable.from(['invalid\nnull\n', '{"jsonrpc":"2.0","id":1,"method":"initialize"}\n', '{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n'])
  await serveMcp('/unused', input, output)
  const values = response.trim().split('\n').map(value => JSON.parse(value))
  assert.equal(values.length, 4)
  assert.equal(values[0].error.code, -32700)
  assert.equal(values[1].error.code, -32600)
  assert(values.find(value => value.id === 2).result.tools.some(tool => tool.name === 'remote_run'))
})
