import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (entry.name === 'node_modules' || entry.name.startsWith('.') || entry.name === 'build') return []
    const path = join(directory, entry.name)
    return entry.isDirectory() ? files(path) : [path]
  })
}
for (const directory of ['packages/protocol', 'packages/core', 'packages/tunnel']) {
  for (const file of files(directory)) {
    if (!/\.(?:js|mjs|json|dart|yaml)$/.test(file)) continue
    if (readFileSync(file, 'utf8').includes('@deepseek-ai/')) throw new Error(`host dependency crossed core boundary: ${file}`)
  }
}
for (const file of [...files('packages'), ...files('tools')].filter(file => /\.(js|mjs)$/.test(file))) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`syntax check failed: ${file}\n${result.stderr}`)
}
for (const name of ['protocol', 'core', 'tunnel', 'cli']) {
  const directory = `packages/${name}`
  const pkg = JSON.parse(readFileSync(`${directory}/package.json`))
  const leaves = value => typeof value === 'string' ? [value] : Object.values(value ?? {}).flatMap(leaves)
  const targets = leaves(pkg.exports)
  for (const path of targets) if (!existsSync(join(directory, path))) throw new Error(`missing export: ${directory}/${path}`)
}
for (const generator of ['tools/generate-types.mjs', 'tools/frame-vectors.mjs']) {
  const result = spawnSync(process.execPath, [generator, '--check'], { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(result.stderr)
}
console.log('syntax, package exports, generated files and host-dependency boundaries passed')
