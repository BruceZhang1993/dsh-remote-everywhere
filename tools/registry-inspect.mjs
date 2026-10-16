import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { releaseVersion, releaseRegistries, scopedPackageName, validateVersion } from './release-config.mjs'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const target = process.env.REGISTRY_TARGET ?? 'npm'
const version = process.env.REGISTRY_VERSION || releaseVersion
if (!releaseRegistries[target]) throw new Error('unknown registry target')
if (!['next', 'latest'].includes(version)) validateVersion(version)
const owner = process.env.GITHUB_REPOSITORY?.split('/')[0].toLowerCase()
if (!/^[a-z\d-]+$/.test(owner ?? '')) throw new Error('repository owner is required')
const directory = join(root, '.cache/registry-install-check')
mkdirSync(directory, { recursive: true })
function run(command, args) {
  const result = spawnSync(command, args, { cwd: directory, encoding: 'utf8', timeout: 120000 })
  if (result.error || result.status !== 0) throw new Error(`${command} lookup failed: ${result.stderr}`)
  return result.stdout
}
for (const pkg of ['dsh-ui', 'dsh-plugin']) {
  const spec = `${scopedPackageName(owner, pkg)}@${version}`
  const metadata = JSON.parse(run('npm', ['view', spec, '--json', `--registry=${releaseRegistries[target]}`]))
  // Resolve a mutable dist-tag once, then compare the exact immutable version.
  const packed = JSON.parse(run('npm', ['pack', `${metadata.name}@${metadata.version}`, '--ignore-scripts', '--json', `--registry=${releaseRegistries[target]}`]))[0]
  const manifest = JSON.parse(run('tar', ['-xOf', packed.filename, 'package/package.json']))
  writeFileSync(join(directory, `${pkg}.json`), JSON.stringify({ spec, metadata, manifest, integrity: packed.integrity }, null, 2))
  assert.equal(packed.integrity, metadata.dist.integrity)
  assert.equal(manifest.name, metadata.name)
  assert.equal(manifest.version, metadata.version)
  if (pkg === 'dsh-plugin') assert.equal(manifest.dsh?.bundle?.patch, './cordis.patch.yml')
  else assert.equal(manifest.dsh?.client?.platform, 'web')
  assert.deepEqual(metadata.dsh, manifest.dsh, 'registry preflight must expose the published DSH bundle')
}
console.log('Registry bundle metadata matches both published package manifests.')
