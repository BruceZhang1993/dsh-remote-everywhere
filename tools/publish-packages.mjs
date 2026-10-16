import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { setTimeout as delay } from 'node:timers/promises'
import { parseNpmView } from './npm-json.mjs'
import { releaseVersion, releasePackages, scopedPackageName, releaseRegistries, candidateDirectory, releaseTag, prerelease, compareVersions } from './release-config.mjs'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const args = process.argv.slice(2)
const target = args.includes('--npm') ? 'npm' : 'github-packages'
const operation = args.filter(value => value !== '--npm')
if (args.filter(value => value === '--npm').length > 1 || operation.length > 1 || operation[0] && !['--publish', '--promote'].includes(operation[0])) throw new Error('usage: publish-packages.mjs [--npm] [--publish|--promote] (default: offline validation)')
const directory = join(root, candidateDirectory(target))
const manifest = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8'))
const publish = operation[0] === '--publish'
const promote = operation[0] === '--promote'
const digest = (data, algorithm = 'sha256', encoding = 'hex') => createHash(algorithm).update(data).digest(encoding)
const commit = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' })
if (commit.status !== 0 || manifest.sourceCommit !== commit.stdout.trim()) throw new Error('candidate source does not match checkout')
if (manifest.lockSha256 !== digest(readFileSync(join(root, 'pnpm-lock.yaml')))) throw new Error('candidate lockfile mismatch')
if (manifest.registry !== releaseRegistries[target] || !/^[a-z\d-]+\/[a-z\d_.-]+$/i.test(manifest.repository ?? '')) throw new Error('invalid registry destination')
const scope = manifest.repository.split('/')[0].toLowerCase()
const expected = releasePackages.map(name => scopedPackageName(scope, name))
if (manifest.version !== releaseVersion || manifest.candidateOnly !== true || manifest.artifacts?.length !== expected.length) throw new Error('unexpected release version or artifact count')
const artifacts = manifest.artifacts.map((artifact, index) => {
  const file = `${artifact.name.replace(/^@/, '').replace('/', '-')}-${releaseVersion}.tgz`
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
  const authenticated = process.env.NODE_AUTH_TOKEN || target === 'npm' && process.env.ACTIONS_ID_TOKEN_REQUEST_URL && process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN
  if (process.env.GITHUB_ACTIONS !== 'true' || !authenticated || manifest.sourceDirty !== false
    || process.env.GITHUB_REPOSITORY !== manifest.repository || process.env.GITHUB_SHA !== manifest.sourceCommit
    || process.env.GITHUB_REF !== `refs/tags/${releaseTag}` || process.env.DSH_RELEASE_APPROVED_SHA !== manifest.sourceCommit) {
    throw new Error('publication requires a clean approved release tag in its own GitHub Actions repository')
  }
  if (promote && process.env.DSH_RELEASE_PROMOTION_APPROVED_SHA !== manifest.sourceCommit) {
    throw new Error('promotion requires separate approval after registry installation acceptance')
  }
  if (target === 'npm' && promote && prerelease) throw new Error('prereleases cannot become latest')
  const registry = [`--registry=${releaseRegistries[target]}`, `--@${scope}:registry=${releaseRegistries[target]}`]
  function view(artifact, allowMissing = false) {
    const result = spawnSync('npm', ['view', `${artifact.name}@${releaseVersion}`, 'dist.integrity', '--json', ...registry], { encoding: 'utf8', timeout: 60000 })
    if (result.error) throw result.error
    if (result.status !== 0) {
      // Authentication/network errors must stop the release, never become "missing".
      let code
      try { code = JSON.parse(result.stdout).error?.code } catch {}
      if (allowMissing && code === 'E404') return false
      throw new Error(`registry lookup failed: ${artifact.name} (${code ?? result.status})`)
    }
    if (parseNpmView(result.stdout) !== artifact.integrity) throw new Error(`registry integrity differs: ${artifact.name}`)
    if (artifact.dsh) {
      const metadata = spawnSync('npm', ['view', `${artifact.name}@${releaseVersion}`, 'dsh', '--json', ...registry], { encoding: 'utf8', timeout: 60000 })
      let actual
      try { actual = parseNpmView(metadata.stdout) } catch {}
      if (metadata.status !== 0 || !isDeepStrictEqual(actual, artifact.dsh)) throw new Error(`registry DSH metadata differs: ${artifact.name}`)
    }
    return true
  }
  // Check all existing versions before the first write; matching packages can resume.
  const existing = artifacts.map(artifact => view(artifact, !promote))
  if (target === 'npm' && promote) for (const artifact of artifacts) {
    const result = spawnSync('npm', ['view', artifact.name, 'dist-tags.latest', '--json', ...registry], { encoding: 'utf8', timeout: 60000 })
    if (result.status !== 0) throw new Error(`latest lookup failed: ${artifact.name}`)
    const latest = parseNpmView(result.stdout)
    if (!latest) continue
    if (!/^\d+\.\d+\.\d+$/.test(latest)) throw new Error('latest must reference a stable version')
    const old = latest.split('.').map(Number), next = releaseVersion.split('.').map(Number)
    const differing = old.findIndex((value, index) => value !== next[index])
    if (differing >= 0 && old[differing] > next[differing]) throw new Error('refusing to move latest backwards')
  }
  for (const [index, artifact] of artifacts.entries()) {
    if (promote) {
      const result = spawnSync('npm', ['dist-tag', 'add', `${artifact.name}@${releaseVersion}`, 'latest', ...registry], { stdio: 'inherit', timeout: 60000 })
      if (result.error) throw result.error
      if (result.status !== 0) throw new Error(`promotion failed: ${artifact.name}; preserve already promoted tags`)
      const tag = spawnSync('npm', ['view', artifact.name, 'dist-tags.latest', '--json', ...registry], { encoding: 'utf8', timeout: 60000 })
      if (tag.error) throw tag.error
      if (tag.status !== 0 || parseNpmView(tag.stdout) !== manifest.version) throw new Error(`latest tag verification failed: ${artifact.name}`)
      console.log(`promoted ${artifact.name}@${releaseVersion} to latest`)
      continue
    }
    if (!existing[index]) {
      const result = spawnSync('npm', ['publish', artifact.path, '--ignore-scripts', '--tag=next', ...(target === 'npm' ? ['--access=public', '--provenance'] : []), ...registry], { stdio: 'inherit', timeout: 120000 })
      if (result.error) throw result.error
      if (result.status !== 0) throw new Error(`publication failed: ${artifact.name}; preserve already published packages`)
    }
  }
  if (publish) {
    // Upload in dependency order, then wait for npm's asynchronous processing.
    // An authentication, network, integrity or metadata error still fails immediately.
    for (const artifact of artifacts) {
      const deadline = Date.now() + 6 * 60_000
      while (!view(artifact, true)) {
        if (Date.now() >= deadline) throw new Error(`registry visibility timed out: ${artifact.name}; preserve uploaded packages`)
        console.log(`waiting for registry visibility: ${artifact.name}`)
        await delay(5000)
      }
      console.log(`verified ${artifact.name}@${releaseVersion}`)
    }
    if (target === 'npm' && prerelease) for (const artifact of artifacts) {
      const tags = () => {
        const result = spawnSync('npm', ['view', `${artifact.name}@${releaseVersion}`, 'dist-tags', '--json', ...registry], { encoding: 'utf8', timeout: 60000 })
        if (result.error) throw result.error
        if (result.status !== 0) throw new Error(`dist-tags lookup failed: ${artifact.name}`)
        const value = parseNpmView(result.stdout)
        if (!value || typeof value !== 'object') throw new Error(`invalid dist-tags: ${artifact.name}`)
        return value
      }
      const latest = tags().latest
      // First publication can create latest; also clear an older failed RC's tag.
      // Keep an existing stable latest and never remove a newer version's tag.
      if (!latest?.includes('-') || compareVersions(latest, releaseVersion) > 0) continue
      const result = spawnSync('npm', ['dist-tag', 'rm', artifact.name, 'latest', ...registry], { stdio: 'inherit', timeout: 60000 })
      if (result.error) throw result.error
      if (result.status !== 0 || tags().latest) throw new Error(`prerelease latest cleanup failed: ${artifact.name}`)
      console.log(`removed prerelease latest: ${artifact.name}@${latest}`)
    }
  }
}
