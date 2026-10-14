import { cpSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const args = process.argv.slice(2)
if (args.length && (args.length !== 2 || args[0] !== '--github-packages')) throw new Error('usage: release-candidate.mjs [--github-packages OWNER/REPO]')
const repository = args[1]
if (repository && !/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?\/[a-z\d_.-]+$/i.test(repository)) throw new Error('invalid GitHub OWNER/REPO')
const scope = repository?.split('/')[0].toLowerCase()
const destination = join(root, scope ? '.cache/github-packages-0.1.0' : '.cache/release-0.1.0')
const staging = join(destination, 'staging')
const names = ['protocol', 'core', 'tunnel', 'cli', 'dsh-plugin']
const packages = names.map(name => ({ directory: name, ...JSON.parse(readFileSync(join(root, 'packages', name, 'package.json'))) }))
const workspaceNames = new Set(packages.map(pkg => pkg.name))
const packageNames = Object.fromEntries(packages.map(pkg => [pkg.name, scope
  ? `@${scope}/${pkg.directory === 'dsh-plugin' ? 'dsh-remote-everywhere' : `dsh-remote-${pkg.directory}`}` : pkg.name]))
function rewriteImports(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) rewriteImports(path)
    else if (/\.(?:js|ts|md)$/.test(entry.name)) {
      let source = readFileSync(path, 'utf8')
      for (const name of workspaceNames) {
        if (name.startsWith('@')) source = source.replaceAll(name, packageNames[name])
      }
      source = source.replaceAll('@OWNER/', `@${scope}/`)
      writeFileSync(path, source)
    }
  }
}
const run = (command, args, cwd = root) => {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr}`)
  return result.stdout
}
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
rmSync(staging, { recursive: true, force: true })
rmSync(join(destination, 'manifest.json'), { force: true })
mkdirSync(staging, { recursive: true })
const artifacts = []
for (const pkg of packages) {
  const source = join(root, 'packages', pkg.directory), target = join(staging, pkg.directory)
  mkdirSync(target)
  for (const path of pkg.files) cpSync(join(source, path), join(target, path), { recursive: true })
  for (const path of ['LICENSE', 'SECURITY.md']) cpSync(join(root, path), join(target, path))
  cpSync(join(source, 'README.md'), join(target, 'README.md'))
  const { directory, ...manifest } = pkg
  manifest.version = '0.1.0'
  manifest.name = packageNames[pkg.name]
  if (scope) {
    manifest.repository = { type: 'git', url: `https://github.com/${repository}.git`, directory: `packages/${directory}` }
    manifest.publishConfig = { registry: 'https://npm.pkg.github.com', tag: 'next' }
  }
  manifest.license = 'MIT'
  manifest.files = [...new Set([...manifest.files, 'LICENSE', 'SECURITY.md'])]
  for (const [name, version] of Object.entries(manifest.dependencies ?? {})) {
    if (!version.startsWith('workspace:')) continue
    if (!workspaceNames.has(name)) throw new Error(`unknown workspace dependency: ${name}`)
    delete manifest.dependencies[name]
    manifest.dependencies[packageNames[name]] = '0.1.0'
  }
  if (pkg.directory === 'dsh-plugin') {
    cpSync(join(root, 'docs/release.md'), join(target, 'INSTALL.zh-CN.md'))
    cpSync(join(root, 'docs/release.en.md'), join(target, 'INSTALL.md'))
    manifest.files.push('INSTALL.md', 'INSTALL.zh-CN.md')
    if (scope) {
      const patch = join(target, 'cordis.patch.yml')
      writeFileSync(patch, readFileSync(patch, 'utf8').replace('name: dsh-remote-everywhere', `name: ${JSON.stringify(manifest.name)}`))
    }
  }
  if (scope) rewriteImports(target)
  writeFileSync(join(target, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  const [packed] = Object.values(JSON.parse(run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', destination], target)))
  if (packed.name !== manifest.name || packed.version !== '0.1.0') throw new Error('unexpected packed candidate identity')
  for (const required of ['LICENSE', 'SECURITY.md', 'package.json']) {
    if (!packed.files.some(file => file.path === required)) throw new Error(`missing release file: ${required}`)
  }
  if (packed.files.some(file => /(?:\.key|\.pem|devices\.json)$|(?:^|\/)(?:test|fixtures|\.cache)\//.test(file.path))) throw new Error('unexpected private or test artifact in release')
  artifacts.push({ name: manifest.name, version: manifest.version, file: packed.filename,
    bytes: packed.size, sha256: sha256(readFileSync(join(destination, packed.filename))) })
}
const evidence = { candidateOnly: true, version: '0.1.0', sourceCommit: run('git', ['rev-parse', 'HEAD']).trim(),
  sourceDirty: Boolean(run('git', ['status', '--porcelain']).trim()),
  lockSha256: sha256(readFileSync(join(root, 'pnpm-lock.yaml'))),
  ...(scope ? { registry: 'https://npm.pkg.github.com', repository, packageNames } : {}), artifacts }
writeFileSync(join(destination, 'manifest.json'), `${JSON.stringify(evidence, null, 2)}\n`)
console.log(JSON.stringify(evidence))
