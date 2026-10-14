import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const candidate = join(root, '.cache/github-packages-0.1.0')
// The fake npm never accesses a registry. Test copies are isolated from the candidate.
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-release-test-'))
  mkdirSync(join(directory, 'tools')); mkdirSync(join(directory, 'bin'))
  cpSync(join(root, 'tools/publish-packages.mjs'), join(directory, 'tools/publish-packages.mjs'))
  cpSync(join(root, 'pnpm-lock.yaml'), join(directory, 'pnpm-lock.yaml'))
  const destination = join(directory, '.cache/github-packages-0.1.0')
  mkdirSync(destination, { recursive: true })
  const manifest = JSON.parse(readFileSync(join(candidate, 'manifest.json'), 'utf8'))
  manifest.sourceDirty = false
  const integrities = {}
  for (const artifact of manifest.artifacts) {
    cpSync(join(candidate, artifact.file), join(destination, artifact.file))
    integrities[artifact.name] = `sha512-${createHash('sha512').update(readFileSync(join(destination, artifact.file))).digest('base64')}`
  }
  const registry = { integrities, existing: [], error: null, failPublish: null }
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
  const name = args[1].replace(/@0\\.1\\.0$/, '');
  const error = state.error || (!state.existing.includes(name) ? 'E404' : null);
  if (error) { console.log(JSON.stringify({error:{code:error}})); process.exit(1); }
  console.log(JSON.stringify(state.integrities[name]));
} else if (args[0] === 'publish') {
  const name = JSON.parse(fs.readFileSync(process.env.TEST_MANIFEST)).artifacts.find(a=>a.file===path.basename(args[1])).name;
  if (state.failPublish === name) process.exit(1);
  state.existing.push(name); fs.writeFileSync(process.env.TEST_REGISTRY, JSON.stringify(state));
} else process.exit(2);
`, { mode: 0o700 })
  const manifestPath = join(destination, 'manifest.json')
  const run = (publish = true, overrides = {}) => {
    writeFileSync(manifestPath, JSON.stringify(manifest)); writeFileSync(state, JSON.stringify(registry))
    return spawnSync(process.execPath, [join(directory, 'tools/publish-packages.mjs'), ...(publish ? ['--publish'] : [])], {
      encoding: 'utf8', timeout: 10000, env: { ...process.env, PATH: `${join(directory, 'bin')}:${process.env.PATH}`,
        GITHUB_ACTIONS: 'true', NODE_AUTH_TOKEN: 'synthetic-test-only',
        GITHUB_REPOSITORY: manifest.repository, GITHUB_SHA: manifest.sourceCommit, GITHUB_REF: 'refs/tags/v0.1.0',
        DSH_RELEASE_APPROVED_SHA: manifest.sourceCommit, TEST_REGISTRY: state, TEST_CALLS: calls, TEST_MANIFEST: manifestPath, ...overrides },
    })
  }
  const published = () => {
    try { return readFileSync(calls, 'utf8').trim().split('\n').map(line => JSON.parse(line)).filter(args => args[0] === 'publish') }
    catch (error) { if (error.code === 'ENOENT') return []; throw error }
  }
  return { directory, destination, manifest, registry, run, published }
}
function scenario(name, body) {
  test(name, () => { const context = fixture(); try { body(context) } finally { rmSync(context.directory, { recursive: true, force: true }) } })
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
  assert.equal(context.run().status, 0); assert.equal(context.published().length, 3)
})
scenario('partial publication failure stops dependent packages', context => {
  context.registry.failPublish = context.manifest.artifacts[2].name
  assert.notEqual(context.run().status, 0); assert.equal(context.published().length, 3)
})
