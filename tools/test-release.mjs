import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

import { releaseVersion, releaseRegistries } from './release-config.mjs'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const candidate = join(root, `.cache/github-packages-${releaseVersion}`)
test('packed candidates retain the selected publication registry', () => {
  for (const [target, registry] of Object.entries(releaseRegistries)) {
    const directory = join(root, `.cache/${target}-${releaseVersion}`)
    const manifest = JSON.parse(readFileSync(join(directory, 'manifest.json')))
    for (const artifact of manifest.artifacts) {
      const result = spawnSync('tar', ['-xOf', join(directory, artifact.file), 'package/package.json'], { encoding: 'utf8', timeout: 10000 })
      assert.equal(result.status, 0, result.stderr)
      assert.deepEqual(JSON.parse(result.stdout).publishConfig, { registry, access: 'public', tag: 'next' }, `${target}: ${artifact.name}`)
    }
  }
})
// The fake npm never accesses a registry. Test copies are isolated from the candidate.
function fixture(target = 'github-packages', stable = false) {
  const version = stable ? '0.2.0' : '0.2.0-dev.0'
  const directory = mkdtempSync(join(tmpdir(), 'dsh-release-test-'))
  mkdirSync(join(directory, 'tools')); mkdirSync(join(directory, 'bin'))
  cpSync(join(root, 'tools/publish-packages.mjs'), join(directory, 'tools/publish-packages.mjs'))
  cpSync(join(root, 'tools/release-config.mjs'), join(directory, 'tools/release-config.mjs'))
  cpSync(join(root, 'pnpm-lock.yaml'), join(directory, 'pnpm-lock.yaml'))
  if (version !== releaseVersion) {
    const config = join(directory, 'tools/release-config.mjs')
    writeFileSync(config, readFileSync(config, 'utf8').replace(`'${releaseVersion}'`, `'${version}'`))
  }
  const destination = join(directory, `.cache/${target}-${version}`)
  mkdirSync(destination, { recursive: true })
  const manifest = JSON.parse(readFileSync(join(candidate, 'manifest.json'), 'utf8'))
  manifest.sourceDirty = false
  manifest.registry = target === 'npm' ? 'https://registry.npmjs.org' : manifest.registry
  manifest.version = version
  const integrities = {}
  for (const artifact of manifest.artifacts) {
    const originalFile = artifact.file
    artifact.version = version
    artifact.file = artifact.file.replace(releaseVersion, version)
    cpSync(join(candidate, originalFile), join(destination, artifact.file))
    integrities[artifact.name] = `sha512-${createHash('sha512').update(readFileSync(join(destination, artifact.file))).digest('base64')}`
  }
  const registry = { integrities, existing: [], latest: {}, error: null, failPublish: null, failPromote: null, wrongLatest: false, metadataMismatch: false }
  const state = join(directory, 'registry.json'), calls = join(directory, 'calls.jsonl')
  writeFileSync(join(directory, 'bin/git'), `#!/usr/bin/env node
if (process.argv[2] === 'rev-parse') console.log(process.env.GITHUB_SHA);
else if (process.argv[2] === 'status') console.log(process.env.TEST_GIT_DIRTY || '');
else process.exit(2);
`, { mode: 0o700 })
  writeFileSync(join(directory, 'bin/npm'), `#!/usr/bin/env node
const fs = require('node:fs'), path = require('node:path');
const state = JSON.parse(fs.readFileSync(process.env.TEST_REGISTRY));
const args = process.argv.slice(2); fs.appendFileSync(process.env.TEST_CALLS, JSON.stringify(args)+'\\n');
if (args[0] === 'view') {
  const name = args[1].endsWith('@${version}') ? args[1].slice(0, -'@${version}'.length) : args[1];
  const error = state.error || (!state.existing.includes(name) ? 'E404' : null);
  if (error) { console.log(JSON.stringify({error:{code:error}})); process.exit(1); }
  const manifest = JSON.parse(fs.readFileSync(process.env.TEST_MANIFEST));
  const metadata = state.metadataMismatch ? {} : manifest.artifacts.find(a=>a.name===name)?.dsh;
  console.log(JSON.stringify(args[2] === 'dsh' ? metadata : args[2] === 'dist-tags.latest' ? (state.wrongLatest ? '0.0.0' : state.latest[name] ?? null) : state.integrities[name]));
} else if (args[0] === 'publish') {
  const name = JSON.parse(fs.readFileSync(process.env.TEST_MANIFEST)).artifacts.find(a=>a.file===path.basename(args[1])).name;
  if (state.failPublish === name) process.exit(1);
  state.existing.push(name); fs.writeFileSync(process.env.TEST_REGISTRY, JSON.stringify(state));
} else if (args[0] === 'dist-tag' && args[1] === 'add') {
  const name = args[2].endsWith('@${version}') ? args[2].slice(0, -'@${version}'.length) : args[2];
  if (state.failPromote === name) process.exit(1);
  state.latest[name] = '${version}'; fs.writeFileSync(process.env.TEST_REGISTRY, JSON.stringify(state));
} else process.exit(2);
`, { mode: 0o700 })
  const manifestPath = join(destination, 'manifest.json')
  const run = (publish = true, overrides = {}) => {
    writeFileSync(manifestPath, JSON.stringify(manifest)); writeFileSync(state, JSON.stringify(registry))
    return spawnSync(process.execPath, [join(directory, 'tools/publish-packages.mjs'), ...(target === 'npm' ? ['--npm'] : []), ...(publish ? [publish === 'promote' ? '--promote' : '--publish'] : [])], {
      encoding: 'utf8', timeout: 10000, env: { ...process.env, PATH: `${join(directory, 'bin')}:${process.env.PATH}`,
        GITHUB_ACTIONS: 'true', NODE_AUTH_TOKEN: 'synthetic-test-only',
        GITHUB_REPOSITORY: manifest.repository, GITHUB_SHA: manifest.sourceCommit, GITHUB_REF: `refs/tags/v${version}`,
        DSH_RELEASE_APPROVED_SHA: manifest.sourceCommit, DSH_RELEASE_PROMOTION_APPROVED_SHA: manifest.sourceCommit,
        TEST_REGISTRY: state, TEST_CALLS: calls, TEST_MANIFEST: manifestPath, ...overrides },
    })
  }
  const recorded = (command) => {
    try { return readFileSync(calls, 'utf8').trim().split('\n').map(line => JSON.parse(line)).filter(args => args[0] === command) }
    catch (error) { if (error.code === 'ENOENT') return []; throw error }
  }
  return { directory, destination, version, manifest, registry, run, published: () => recorded('publish'), promoted: () => recorded('dist-tag') }
}
function scenario(name, body, target, stable) {
  test(name, () => { const context = fixture(target, stable); try { body(context) } finally { rmSync(context.directory, { recursive: true, force: true }) } })
}
scenario('offline validation performs no registry writes', context => {
  assert.equal(context.run(false).status, 0); assert.equal(context.published().length, 0)
})
scenario('tarball tampering stops before publishing', context => {
  writeFileSync(join(context.destination, context.manifest.artifacts[0].file), 'tampered')
  assert.match(context.run().stderr, /hash\/size mismatch/); assert.equal(context.published().length, 0)
})
scenario('unsafe artifact paths are rejected', context => {
  context.manifest.artifacts[0].file = '../other.tgz'
  assert.match(context.run().stderr, /identity\/order/); assert.equal(context.published().length, 0)
})
scenario('dirty, unapproved and wrong-repository candidates cannot publish', context => {
  context.manifest.sourceDirty = true; assert.notEqual(context.run().status, 0)
  context.manifest.sourceDirty = false
  assert.notEqual(context.run(true, { DSH_RELEASE_APPROVED_SHA: '' }).status, 0)
  assert.notEqual(context.run(true, { GITHUB_REPOSITORY: 'other/repo' }).status, 0)
  assert.notEqual(context.run(true, { GITHUB_ACTIONS: 'false' }).status, 0)
  assert.notEqual(context.run(true, { TEST_GIT_DIRTY: ' M tools/publish-packages.mjs' }).status, 0)
  assert.equal(context.published().length, 0)
})
scenario('approved candidates publish in dependency order with next tag', context => {
  assert.equal(context.run().status, 0)
  assert.deepEqual(context.published().map(args => args[1].split('/').at(-1)), context.manifest.artifacts.map(a => a.file))
  for (const args of context.published()) { assert.ok(args.includes('--tag=next')); assert.ok(args.includes('--ignore-scripts')) }
})
scenario('authentication and network errors never become missing versions', context => {
  for (const error of ['E401', 'E403', 'ENOTFOUND']) {
    context.registry.error = error; assert.notEqual(context.run().status, 0)
  }
  assert.equal(context.published().length, 0)
})
scenario('mismatched existing version aborts before the first write', context => {
  const name = context.manifest.artifacts[2].name
  context.registry.existing.push(name); context.registry.integrities[name] = 'sha512-mismatch'
  assert.match(context.run().stderr, /integrity differs/); assert.equal(context.published().length, 0)
})
scenario('identical partially published candidates resume without republishing', context => {
  context.registry.existing = context.manifest.artifacts.slice(0, 2).map(a => a.name)
  assert.equal(context.run().status, 0); assert.equal(context.published().length, context.manifest.artifacts.length - 2)
})
scenario('partial publication failure stops dependent packages', context => {
  context.registry.failPublish = context.manifest.artifacts[2].name
  assert.notEqual(context.run().status, 0); assert.equal(context.published().length, 3)
})
scenario('promotion needs separate approval and the reviewed release context', context => {
  context.registry.existing = context.manifest.artifacts.map(a => a.name)
  for (const overrides of [{ DSH_RELEASE_PROMOTION_APPROVED_SHA: '' }, { DSH_RELEASE_PROMOTION_APPROVED_SHA: 'other' },
    { DSH_RELEASE_APPROVED_SHA: '' }, { GITHUB_REF: 'refs/heads/master' }, { TEST_GIT_DIRTY: ' M package.json' }]) {
    assert.notEqual(context.run('promote', overrides).status, 0)
  }
  assert.equal(context.promoted().length, 0); assert.equal(context.published().length, 0)
})
scenario('promotion checks every published integrity before changing any tag', context => {
  context.registry.existing = context.manifest.artifacts.map(a => a.name)
  const name = context.manifest.artifacts[4].name
  context.registry.integrities[name] = 'sha512-mismatch'
  assert.match(context.run('promote').stderr, /integrity differs/)
  assert.equal(context.promoted().length, 0); assert.equal(context.published().length, 0)
})
scenario('missing versions and registry failures cannot promote', context => {
  for (const error of [null, 'E401', 'E403', 'ENOTFOUND']) {
    context.registry.error = error; assert.notEqual(context.run('promote').status, 0)
  }
  assert.equal(context.promoted().length, 0); assert.equal(context.published().length, 0)
})
scenario('promotion changes only latest tags in dependency order and is repeatable', context => {
  context.registry.existing = context.manifest.artifacts.map(a => a.name)
  assert.equal(context.run('promote').status, 0)
  assert.deepEqual(context.promoted().map(args => args[2]), context.manifest.artifacts.map(a => `${a.name}@${context.version}`))
  assert.ok(context.promoted().every(args => args[3] === 'latest'))
  assert.equal(context.run('promote').status, 0); assert.equal(context.published().length, 0)
})
scenario('partial promotion failure stops dependent tags and can resume', context => {
  context.registry.existing = context.manifest.artifacts.map(a => a.name)
  context.registry.failPromote = context.manifest.artifacts[2].name
  assert.notEqual(context.run('promote').status, 0); assert.equal(context.promoted().length, 3)
  const stateAfterFailure = JSON.parse(readFileSync(join(context.directory, 'registry.json')))
  assert.deepEqual(Object.keys(stateAfterFailure.latest), context.manifest.artifacts.slice(0, 2).map(a => a.name))
  context.registry.latest = stateAfterFailure.latest; context.registry.failPromote = null
  assert.equal(context.run('promote').status, 0); assert.equal(context.published().length, 0)
})
scenario('latest tag verification failure stops subsequent promotions', context => {
  context.registry.existing = context.manifest.artifacts.map(a => a.name); context.registry.wrongLatest = true
  assert.match(context.run('promote').stderr, /latest tag verification failed/)
  assert.equal(context.promoted().length, 1); assert.equal(context.published().length, 0)
})

scenario('npm OIDC publishes public provenance under next', context => {
  const result = context.run(true, { NODE_AUTH_TOKEN: '', ACTIONS_ID_TOKEN_REQUEST_URL: 'https://oidc.test', ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'synthetic' })
  assert.equal(result.status, 0, result.stderr)
  assert.ok(context.published().every(args => args.includes('--provenance') && args.includes('--access=public') && args.includes('--tag=next')))
}, 'npm')
scenario('npm refuses publication without OIDC or a bootstrap token', context => {
  assert.notEqual(context.run(true, { NODE_AUTH_TOKEN: '', ACTIONS_ID_TOKEN_REQUEST_URL: '', ACTIONS_ID_TOKEN_REQUEST_TOKEN: '' }).status, 0)
  assert.equal(context.published().length, 0)
}, 'npm')
scenario('registry metadata mismatch stops writes even when tarball integrity matches', context => {
  context.registry.existing = context.manifest.artifacts.map(a => a.name)
  context.registry.metadataMismatch = true
  assert.match(context.run().stderr, /DSH metadata differs/)
  assert.equal(context.published().length, 0)
}, 'npm')
scenario('npm prerelease cannot be promoted to latest', context => {
  assert.match(context.run('promote').stderr, /prereleases cannot/)
  assert.equal(context.promoted().length, 0)
}, 'npm')
scenario('stable npm version can be promoted after separate acceptance approval', context => {
  context.registry.existing = context.manifest.artifacts.map(a => a.name)
  const result = context.run('promote')
  assert.equal(result.status, 0, result.stderr)
  assert.equal(context.promoted().length, context.manifest.artifacts.length)
}, 'npm', true)
scenario('stable npm promotion refuses rollback before changing any tag', context => {
  context.registry.existing = context.manifest.artifacts.map(a => a.name)
  context.registry.latest[context.manifest.artifacts.at(-1).name] = '99.0.0'
  assert.match(context.run('promote').stderr, /latest backwards/)
  assert.equal(context.promoted().length, 0)
}, 'npm', true)
