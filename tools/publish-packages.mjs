import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const directory = join(root, '.cache/github-packages-0.1.0')
const manifest = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8'))
const publish = process.argv[2] === '--publish'
const promote = process.argv[2] === '--promote'
if (process.argv.length > 3 || (process.argv[2] && !publish && !promote)) throw new Error('usage: publish-packages.mjs [--publish|--promote] (default: offline validation)')
const digest = (data, algorithm = 'sha256', encoding = 'hex') => createHash(algorithm).update(data).digest(encoding)
const commit = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' })
if (commit.status !== 0 || manifest.sourceCommit !== commit.stdout.trim()) throw new Error('candidate source does not match checkout')
if (manifest.lockSha256 !== digest(readFileSync(join(root, 'pnpm-lock.yaml')))) throw new Error('candidate lockfile mismatch')
if (manifest.registry !== 'https://npm.pkg.github.com' || !/^[a-z\d-]+\/[a-z\d_.-]+$/i.test(manifest.repository ?? '')) throw new Error('invalid GitHub Packages destination')
const scope = manifest.repository.split('/')[0].toLowerCase()
const expected = ['protocol', 'core', 'tunnel', 'cli', 'everywhere'].map(name => `@${scope}/dsh-remote-${name}`)
if (manifest.version !== '0.1.0' || manifest.candidateOnly !== true || manifest.artifacts?.length !== expected.length) throw new Error('unexpected release version or artifact count')
const artifacts = manifest.artifacts.map((artifact, index) => {
  const file = `${artifact.name.replace(/^@/, '').replace('/', '-')}-0.1.0.tgz`
  if (artifact.name !== expected[index] || artifact.version !== manifest.version || artifact.file !== file) throw new Error('unexpected artifact identity/order')
  const path = join(directory, file), bytes = readFileSync(path)
  if (bytes.length !== artifact.bytes || digest(bytes) !== artifact.sha256) throw new Error(`candidate hash/size mismatch: ${artifact.name}`)
  return { ...artifact, path, integrity: `sha512-${digest(bytes, 'sha512', 'base64')}` }
})
if (!publish && !promote) {
  console.log(JSON.stringify({ validated: true, offline: true, sourceDirty: manifest.sourceDirty, repository: manifest.repository, packages: expected }))
} else {
  const status = spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' })
  if (status.status !== 0 || status.stdout.trim()) throw new Error('publication checkout must be clean')
  if (process.env.GITHUB_ACTIONS !== 'true' || !process.env.NODE_AUTH_TOKEN || manifest.sourceDirty !== false
    || process.env.GITHUB_REPOSITORY !== manifest.repository || process.env.GITHUB_SHA !== manifest.sourceCommit
    || process.env.GITHUB_REF !== 'refs/tags/v0.1.0' || process.env.DSH_RELEASE_APPROVED_SHA !== manifest.sourceCommit) {
    throw new Error('publication requires a clean approved release tag in its own GitHub Actions repository')
  }
  if (promote && process.env.DSH_RELEASE_PROMOTION_APPROVED_SHA !== manifest.sourceCommit) {
    throw new Error('promotion requires separate approval after registry installation acceptance')
  }
  const registry = ['--registry=https://npm.pkg.github.com']
  function view(artifact, allowMissing = false) {
    const result = spawnSync('npm', ['view', `${artifact.name}@0.1.0`, 'dist.integrity', '--json', ...registry], { encoding: 'utf8', timeout: 60000 })
    if (result.error) throw result.error
    if (result.status !== 0) {
      // Authentication/network errors must stop the release, never become "missing".
      let code
      try { code = JSON.parse(result.stdout).error?.code } catch {}
      if (allowMissing && code === 'E404') return false
      throw new Error(`registry lookup failed: ${artifact.name} (${code ?? result.status})`)
    }
    if (JSON.parse(result.stdout) !== artifact.integrity) throw new Error(`registry integrity differs: ${artifact.name}`)
    return true
  }
  // Check all existing versions before the first write; matching packages can resume.
  const existing = artifacts.map(artifact => view(artifact, !promote))
  for (const [index, artifact] of artifacts.entries()) {
    if (promote) {
      const result = spawnSync('npm', ['dist-tag', 'add', `${artifact.name}@0.1.0`, 'latest', ...registry], { stdio: 'inherit', timeout: 60000 })
      if (result.error) throw result.error
      if (result.status !== 0) throw new Error(`promotion failed: ${artifact.name}; preserve already promoted tags`)
      const tag = spawnSync('npm', ['view', artifact.name, 'dist-tags.latest', '--json', ...registry], { encoding: 'utf8', timeout: 60000 })
      if (tag.error) throw tag.error
      if (tag.status !== 0 || JSON.parse(tag.stdout) !== manifest.version) throw new Error(`latest tag verification failed: ${artifact.name}`)
      console.log(`promoted ${artifact.name}@0.1.0 to latest`)
      continue
    }
    if (!existing[index]) {
      const result = spawnSync('npm', ['publish', artifact.path, '--ignore-scripts', '--tag=next', ...registry], { stdio: 'inherit', timeout: 120000 })
      if (result.error) throw result.error
      if (result.status !== 0) throw new Error(`publication failed: ${artifact.name}; preserve already published packages`)
    }
    view(artifact)
    console.log(`verified ${artifact.name}@0.1.0`)
  }
}
