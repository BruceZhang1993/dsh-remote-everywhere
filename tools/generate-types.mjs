import { readFileSync, writeFileSync } from 'node:fs'

const root = new URL('../', import.meta.url)
const { $defs: definitions } = JSON.parse(readFileSync(new URL('packages/protocol/schema.json', root)))
function ts(spec) {
  if (spec.$ref) return spec.$ref.split('/').at(-1)
  if ('const' in spec) return JSON.stringify(spec.const)
  if (spec.enum) return spec.enum.map(JSON.stringify).join(' | ')
  if (spec.type === 'array') return `Array<${ts(spec.items)}>`
  if (spec.type === 'object') {
    if (!spec.properties) return 'Record<string, unknown>'
    return `{ ${Object.entries(spec.properties).map(([name, child]) => `${name}${spec.required?.includes(name) ? '' : '?'}: ${ts(child)}`).join('; ')} }`
  }
  return { string: 'string', integer: 'number', boolean: 'boolean' }[spec.type] ?? 'unknown'
}
function dart(spec) {
  if (spec.$ref) return 'Map<String, Object?>'
  if ('const' in spec) return typeof spec.const === 'boolean' ? 'bool' : 'String'
  if (spec.type === 'array') return `List<${dart(spec.items)}>`
  return { string: 'String', integer: 'int', boolean: 'bool', object: 'Map<String, Object?>' }[spec.type] ?? 'Object?'
}
const tsText = '// Generated from schema.json; run pnpm generate.\n' + Object.entries(definitions)
  .map(([name, spec]) => `export type ${name} = ${ts(spec)}\n`).join('') +
  '\nexport declare const VERSION: number\nexport declare const HEADER_BYTES: number\nexport declare const MAX_NOISE_BYTES: number\nexport declare const MAX_PLAINTEXT_BYTES: number\nexport declare const MAX_WIRE_BYTES: number\nexport declare const MAX_STREAMS: number\nexport declare const MAX_PENDING_REQUESTS: number\nexport declare const MAX_QUEUE_BYTES: number\nexport declare const MAX_QUEUE_MESSAGES: number\nexport declare const MAX_PAGE_RECORDS: number\nexport declare const KINDS: Readonly<{ REQ: 1; RES: 2; ERR: 3; EVT: 4; SDATA: 5; SEND: 6 }>\nexport declare class ProtocolError extends Error { code: string; constructor(code: string, message: string) }\nexport declare function assertValue<T>(name: string, value: T): T\nexport declare function encodeHeader(value: {kind: number; streamId?: number; seq: number}): Uint8Array\nexport declare function decodeHeader(bytes: Uint8Array): {kind: number; streamId: number; seq: number}\nexport declare function encodePayload(kind: number, value: unknown): Uint8Array\nexport declare function decodePayload(kind: number, bytes: Uint8Array): unknown\n'
const dartText = '// Generated from packages/protocol/schema.json; run pnpm generate.\n' + Object.entries(definitions)
  .map(([name, spec]) => `class ${name} {\n  const ${name}(this.values);\n  final Map<String, Object?> values;\n${Object.entries(spec.properties).map(([field, child]) => {
    const type = dart(child)
    const optional = !spec.required?.includes(field)
    const nullable = type.endsWith('?') ? type : type + (optional ? '?' : '')
    return `  ${nullable} get ${field} => ${child.type === 'array'
      ? `(values['${field}'] as List${optional ? '?' : ''})${optional ? '?' : ''}.cast<${dart(child.items)}>()`
      : `values['${field}']${nullable === 'Object?' ? '' : ` as ${nullable}`}`};\n`
  }).join('')}  Map<String, Object?> toJson() => Map.of(values);\n}\n`).join('\n')
for (const [path, content] of [['packages/protocol/types.d.ts', tsText], ['packages/core/dart/lib/protocol_types.dart', dartText]]) {
  const file = new URL(path, root)
  if (process.argv.includes('--check')) {
    if (readFileSync(file, 'utf8') !== content) throw new Error(`generated types are stale: ${path}`)
  } else writeFileSync(file, content)
}
