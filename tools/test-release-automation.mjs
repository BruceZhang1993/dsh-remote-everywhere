import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { releaseVersion, compareVersions, validateVersion } from './release-config.mjs'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const hash = data => createHash('sha256').update(data).digest('hex')
function fixture(body) {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-automation-test-'))
  mkdirSync(join(directory, 'tools')); mkdirSync(join(directory, 'bin'))
  mkdirSync(join(directory, 'apps/mobile'), { recursive: true })
  mkdirSync(join(directory, '.cache/mobile-release'), { recursive: true })
  for (const name of ['release-config', 'release-version', 'mobile-manifest', 'github-release', 'release-tag']) cpSync(join(root, `tools/${name}.mjs`), join(directory, `tools/${name}.mjs`))
  cpSync(join(root, 'apps/mobile/pubspec.yaml'), join(directory, 'apps/mobile/pubspec.yaml'))
  writeFileSync(join(directory, '.gitignore'), '.cache/\n')
  const stateFile = join(directory, '.cache/github-state.json')
  writeFileSync(join(directory, 'bin/gh'), `#!/usr/bin/env node
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const file = process.env.TEST_GH_STATE, state = JSON.parse(fs.readFileSync(file)), args = process.argv.slice(2);
state.calls.push(args); fs.writeFileSync(file, JSON.stringify(state));
if (args[0] === 'api') {
  if (state.error) { console.error(state.error); process.exit(1); }
  if (args[1].includes('/releases?')) {
    console.log(JSON.stringify(state.fullPages ? Array(100).fill({tag_name:'other'}) : state.release ? [state.release] : []));
    process.exit(0);
  }
  if (state.tagLookup404) { console.error('gh: Not Found (HTTP 404)'); process.exit(1); }
  if (!state.release) { console.error('gh: Not Found (HTTP 404)'); process.exit(1); }
  console.log(JSON.stringify(state.release));
} else if (args[0] === 'workflow') {
  // Dispatch only; never contact GitHub from the test.
} else if (args[1] === 'create') {
  state.release = {tag_name: args[2], draft: true, prerelease: false, assets: []};
} else if (args[1] === 'upload') {
  if (state.failUpload === path.basename(args[3])) process.exit(1);
  state.release.assets.push({name: path.basename(args[3]), digest: 'sha256:'+crypto.createHash('sha256').update(fs.readFileSync(args[3])).digest('hex')});
} else if (args[1] === 'edit') {
  state.release.draft = false; state.release.prerelease = args.includes('--prerelease=true');
} else process.exit(2);
fs.writeFileSync(file, JSON.stringify(state));
`, { mode: 0o700 })
  const command = (name, args, env = {}) => spawnSync(name, args, { cwd: directory, encoding: 'utf8', timeout: 20000, env: { ...process.env, ...env } })
  const git = (...args) => { const result = command('git', args); assert.equal(result.status, 0, result.stderr); return result.stdout.trim() }
  git('init', '-b', 'master'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid')
  git('add', '.'); git('commit', '-m', 'test: fixture')
  const sha = git('rev-parse', 'HEAD')
  const state = { calls: [], release: null, error: null, failUpload: null }
  writeFileSync(stateFile, JSON.stringify(state))
  const run = (script, args = [], overrides = {}) => command(process.execPath, [join(directory, `tools/${script}.mjs`), ...args], {
    PATH: `${join(directory, 'bin')}:${process.env.PATH}`, TEST_GH_STATE: stateFile,
    GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'owner/repo', GITHUB_SHA: sha,
    GITHUB_REF: `refs/tags/v${releaseVersion}`, GH_TOKEN: 'synthetic-test-only', DSH_RELEASE_APPROVED_SHA: sha, ...overrides,
  })
  const output = join(directory, '.cache/mobile-release')
  const metadata = JSON.parse(run('release-version').stdout)
  const mobile = () => {
    writeFileSync(join(output, 'version.json'), JSON.stringify(metadata))
    writeFileSync(join(output, 'signature.txt'), `Signer #1 certificate DN: CN=Fixture Distribution\nSigner #1 certificate SHA-256 digest: ${'a'.repeat(64)}\nVerified using v2 scheme (APK Signature Scheme v2): true\n`)
    writeFileSync(join(output, 'badging.txt'), `package: name='dev.dshremote.dsh_remote_mobile' versionCode='${metadata.android_build}' versionName='${releaseVersion}'\n`)
    writeFileSync(join(output, `dsh-remote-android-${releaseVersion}.apk`), 'synthetic APK bytes')
  }
  const sums = () => {
    const names = [`dsh-remote-android-${releaseVersion}.apk`, 'release-manifest.json', 'LICENSE.txt', 'ANDROID-NOTICES.md', 'ANDROID-LICENSE-REVIEW.md']
    writeFileSync(join(output, 'SHA256SUMS'), names.map(name => `${hash(readFileSync(join(output, name)))}  ./${name}\n`).join(''))
  }
  const assets = () => {
    mobile()
    const result = run('mobile-manifest', [], { ANDROID_SIGNING_CERT_SHA256: 'a'.repeat(64) })
    assert.equal(result.status, 0, result.stderr)
    for (const name of ['version.json', 'signature.txt', 'badging.txt']) rmSync(join(output, name))
    for (const name of ['LICENSE.txt', 'ANDROID-NOTICES.md', 'ANDROID-LICENSE-REVIEW.md']) writeFileSync(join(output, name), name)
    sums()
  }
  try { body({ directory, output, run, sha, git, mobile, assets, sums, metadata, state, command,
    save: () => writeFileSync(stateFile, JSON.stringify(state)), read: () => JSON.parse(readFileSync(stateFile)) }) }
  finally { rmSync(directory, { recursive: true, force: true }) }
}

test('versions accept canonical semver and preserve prerelease ordering', () => {
  for (const value of ['01.0.0', '1.2', '1.0.0-dev.01', '1.0.0+build', '1.0.0/../../']) assert.throws(() => validateVersion(value))
  for (const [left, right] of [['0.2.0-dev.0', '0.2.0-rc.1'], ['0.2.0-rc.1', '0.2.0'], ['0.2.0', '0.2.1'], ['0.9.0', '0.10.0']]) assert.ok(compareVersions(left, right) < 0)
})
test('preparing a version increases Android build and rejects rollback/dirty checkouts', () => fixture(c => {
  assert.match(c.run('release-version', ['--set', '0.1.0']).stderr, /must increase/)
  const result = c.run('release-version', ['--set', '9.0.0-rc.1'])
  assert.equal(result.status, 0, result.stderr)
  const metadata = JSON.parse(c.run('release-version').stdout)
  assert.equal(metadata.version, '9.0.0-rc.1'); assert.equal(Number(metadata.android_build), Number(c.metadata.android_build) + 1)
  assert.match(c.run('release-version', ['--set', '9.0.0']).stderr, /clean checkout/)
}))
test('Android version drift prevents release metadata generation', () => fixture(c => {
  const path = join(c.directory, 'apps/mobile/pubspec.yaml')
  writeFileSync(path, readFileSync(path, 'utf8').replace(releaseVersion, '99.0.0'))
  assert.match(c.run('release-version').stderr, /versions differ/)
}))
test('Android certificate, debug key, signature scheme and package version are verified', () => fixture(c => {
  for (const [file, change, pattern] of [
    ['signature.txt', text => text.replace('a'.repeat(64), 'b'.repeat(64)), /certificate mismatch/],
    ['signature.txt', text => text.replace('Fixture Distribution', 'Android Debug'), /debug certificate/],
    ['signature.txt', text => text.replace(': true', ': false'), /v2 verification/],
    ['badging.txt', text => text.replace("versionCode='", "versionCode='999"), /package\/version/],
  ]) {
    c.mobile(); const path = join(c.output, file); writeFileSync(path, change(readFileSync(path, 'utf8')))
    assert.match(c.run('mobile-manifest', [], { ANDROID_SIGNING_CERT_SHA256: 'a'.repeat(64) }).stderr, pattern)
  }
  c.mobile(); assert.equal(c.run('mobile-manifest', [], { ANDROID_SIGNING_CERT_SHA256: 'AA:'.repeat(31) + 'AA' }).status, 0)
}))
function signingBuild(c, overrides = {}) {
  cpSync(join(root, 'tools/mobile-release.sh'), join(c.directory, 'tools/mobile-release.sh'))
  mkdirSync(join(c.directory, '.signing/android'), { recursive: true })
  writeFileSync(join(c.directory, '.signing/android/key.properties'), `certificateSha256=${'a'.repeat(64)}\n`)
  mkdirSync(join(c.directory, 'docs'), { recursive: true })
  for (const name of ['android-notices.md', 'android-license-review.md']) writeFileSync(join(c.directory, 'docs', name), 'fixture')
  writeFileSync(join(c.directory, 'LICENSE'), 'fixture')
  writeFileSync(join(c.directory, 'bin/flutter'), `#!/usr/bin/env bash
set -euo pipefail
case "$1" in
  --version) echo 'Flutter 3.47.7 / Dart 3.13.5 ' ;;
  pub) ;;
  build) mkdir -p build/app/outputs/flutter-apk; printf 'synthetic APK bytes' > build/app/outputs/flutter-apk/app-release.apk ;;
  *) exit 2 ;;
esac
`, { mode: 0o700 })
  writeFileSync(join(c.directory, 'bin/zipalign'), '#!/usr/bin/env bash\nexit 0\n', { mode: 0o700 })
  writeFileSync(join(c.directory, 'bin/apksigner'), `#!/usr/bin/env bash
printf '%s\\n' 'Signer #1 certificate DN: CN=Fixture Distribution' 'Signer #1 certificate SHA-256 digest: ${'a'.repeat(64)}' 'Verified using v2 scheme (APK Signature Scheme v2): true'
`, { mode: 0o700 })
  writeFileSync(join(c.directory, 'bin/aapt'), `#!/usr/bin/env bash
echo "package: name='dev.dshremote.dsh_remote_mobile' versionCode='${c.metadata.android_build}' versionName='${releaseVersion}'"
`, { mode: 0o700 })
  return c.command('bash', ['tools/mobile-release.sh', '--inside-scope'], {
    CI: '', ANDROID_KEYSTORE_PATH: '', ANDROID_KEYSTORE_PASSWORD: '', ANDROID_KEY_ALIAS: '', ANDROID_KEY_PASSWORD: '',
    ANDROID_SIGNING_CERT_SHA256: 'b'.repeat(64), DSH_FLUTTER_BIN: join(c.directory, 'bin/flutter'),
    ANDROID_BUILD_TOOLS: join(c.directory, 'bin'), ...overrides,
  })
}
test('local release entry loads the local certificate without manually sourcing credentials', () => fixture(c => {
  const result = signingBuild(c)
  assert.equal(result.status, 0, result.stderr)
  const manifest = JSON.parse(readFileSync(join(c.output, 'release-manifest.json')))
  assert.equal(manifest.android.certificateSha256, 'a'.repeat(64))
  assert.ok(readFileSync(join(c.output, 'SHA256SUMS'), 'utf8').includes(`dsh-remote-android-${releaseVersion}.apk`))
}))
test('CI ignores local signing and fails without environment credentials', () => fixture(c => {
  const result = signingBuild(c, { CI: 'true' })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /release keystore path is required/)
}))
test('CI verifies its environment certificate instead of the local certificate', () => fixture(c => {
  const env = { CI: 'true', ANDROID_KEYSTORE_PATH: '/synthetic.jks', ANDROID_KEYSTORE_PASSWORD: 'synthetic', ANDROID_KEY_ALIAS: 'fixture', ANDROID_KEY_PASSWORD: 'synthetic' }
  assert.match(signingBuild(c, env).stderr, /certificate mismatch/)
  const result = signingBuild(c, { ...env, ANDROID_SIGNING_CERT_SHA256: 'a'.repeat(64) })
  assert.equal(result.status, 0, result.stderr)
}))
test('GitHub release offline validation does not contact the network', () => fixture(c => {
  c.assets(); const result = c.run('github-release'); assert.equal(result.status, 0, result.stderr); assert.equal(c.read().calls.length, 0)
}))
test('GitHub release rejects tampered and extra secret files before any API call', () => fixture(c => {
  c.assets(); writeFileSync(join(c.output, 'release.jks'), 'synthetic secret')
  assert.match(c.run('github-release', ['--publish']).stderr, /unexpected or missing/)
  rmSync(join(c.output, 'release.jks')); writeFileSync(join(c.output, `dsh-remote-android-${releaseVersion}.apk`), 'tampered')
  assert.match(c.run('github-release', ['--publish']).stderr, /manifest differs/)
  assert.equal(c.read().calls.length, 0)
}))
test('GitHub publication requires the verified tag and source SHA', () => fixture(c => {
  c.assets()
  for (const env of [{ GITHUB_REF: 'refs/heads/master' }, { DSH_RELEASE_APPROVED_SHA: 'other' }, { GITHUB_SHA: 'other' }]) assert.notEqual(c.run('github-release', ['--publish'], env).status, 0)
  assert.equal(c.read().calls.length, 0)
}))
test('GitHub authentication and network errors never create releases', () => fixture(c => {
  c.assets()
  for (const error of ['Forbidden (HTTP 403)', 'network timeout']) {
    c.state.error = error; c.save(); assert.match(c.run('github-release', ['--publish']).stderr, /lookup failed/)
    assert.equal(c.read().calls.filter(a => a[1] === 'create').length, 0)
  }
}))
test('GitHub draft assets are verified before publish and published releases are idempotent', () => fixture(c => {
  c.assets(); let result = c.run('github-release', ['--publish']); assert.equal(result.status, 0, result.stderr)
  let state = c.read(); assert.equal(state.release.draft, false); assert.equal(state.release.assets.length, 6)
  const edit = state.calls.findIndex(a => a[1] === 'edit'), lastUpload = state.calls.findLastIndex(a => a[1] === 'upload')
  assert.ok(edit > lastUpload)
  result = c.run('github-release', ['--publish']); assert.equal(result.status, 0, result.stderr)
  state = c.read(); assert.equal(state.calls.filter(a => a[1] === 'upload').length, 6); assert.equal(state.calls.filter(a => a[1] === 'edit').length, 1)
}))
test('GitHub drafts absent from tag lookup are found in the authenticated release list', () => fixture(c => {
  c.assets(); c.state.tagLookup404 = true; c.save()
  const result = c.run('github-release', ['--publish']); assert.equal(result.status, 0, result.stderr)
  const state = c.read()
  assert.equal(state.release.draft, false); assert.equal(state.release.assets.length, 6)
  assert.equal(state.calls.filter(a => a[1] === 'create').length, 1)
  assert.ok(state.calls.some(a => a[0] === 'api' && a[1].includes('/releases?')))
}))
test('GitHub draft recovery does not create a duplicate release and bounds pagination', () => fixture(c => {
  c.assets(); c.state.tagLookup404 = true
  c.state.release = { tag_name: `v${releaseVersion}`, draft: true, assets: [] }; c.save()
  assert.equal(c.run('github-release', ['--publish']).status, 0)
  assert.equal(c.read().calls.filter(a => a[1] === 'create').length, 0)
  c.state.release = null; c.state.fullPages = true; c.state.calls = []; c.save()
  assert.match(c.run('github-release', ['--publish']).stderr, /lookup budget exceeded/)
  assert.equal(c.read().calls.filter(a => a[0] === 'api' && a[1].includes('/releases?')).length, 10)
  assert.equal(c.read().calls.filter(a => a[1] === 'create').length, 0)
}))
test('partial GitHub draft upload failure can resume without overwriting assets', () => fixture(c => {
  c.assets(); c.state.failUpload = 'release-manifest.json'; c.save()
  assert.notEqual(c.run('github-release', ['--publish']).status, 0)
  const partial = c.read(); assert.equal(partial.release.draft, true); assert.ok(partial.release.assets.length > 0)
  partial.failUpload = null; writeFileSync(join(c.directory, '.cache/github-state.json'), JSON.stringify(partial))
  const result = c.run('github-release', ['--publish']); assert.equal(result.status, 0, result.stderr)
  assert.equal(c.read().release.assets.length, 6)
}))
test('existing mismatched GitHub assets stop publication without overwriting', () => fixture(c => {
  c.assets(); c.state.release = { tag_name: `v${releaseVersion}`, draft: true, assets: [{ name: 'LICENSE.txt', digest: 'sha256:wrong' }] }; c.save()
  assert.match(c.run('github-release', ['--publish']).stderr, /asset differs/)
  assert.equal(c.read().calls.filter(a => a[1] === 'upload' || a[1] === 'edit').length, 0)
}))
test('unchanged master version does not auto-tag or dispatch', () => fixture(c => {
  const result = c.run('release-tag', [], { GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/master', RELEASE_BEFORE_SHA: c.sha })
  assert.equal(result.status, 0, result.stderr); assert.equal(c.git('tag', '--list'), ''); assert.equal(c.read().calls.length, 0)
}))
test('merged increasing version creates one immutable tag and explicitly dispatches release', () => fixture(c => {
  assert.equal(c.run('release-version', ['--set', '9.0.0-rc.1']).status, 0)
  c.git('add', '.'); c.git('commit', '-m', 'chore: version')
  const sha = c.git('rev-parse', 'HEAD')
  // A local bare origin proves the tag push without touching any external repository.
  c.git('init', '--bare', join(c.directory, '.cache/origin.git')); c.git('remote', 'add', 'origin', join(c.directory, '.cache/origin.git'))
  const env = { GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/master', RELEASE_BEFORE_SHA: c.sha, GITHUB_SHA: sha }
  let result = c.run('release-tag', [], env); assert.equal(result.status, 0, result.stderr)
  assert.equal(c.git('rev-list', '-n', '1', 'v9.0.0-rc.1'), sha)
  result = c.run('release-tag', [], env); assert.equal(result.status, 0, result.stderr)
  assert.equal(c.read().calls.filter(a => a[0] === 'workflow').length, 2)
  c.git('tag', '-f', 'v9.0.0-rc.1', c.sha)
  assert.match(c.run('release-tag', [], env).stderr, /already points/)
}))
test('duplicate or incomplete checksum lists stop before contacting GitHub', () => fixture(c => {
  c.assets(); const path = join(c.output, 'SHA256SUMS'), original = readFileSync(path, 'utf8')
  for (const value of [original + original.split('\n')[0] + '\n', original.split('\n').slice(1).join('\n')]) {
    writeFileSync(path, value)
    assert.match(c.run('github-release', ['--publish']).stderr, /checksums are incomplete or duplicated/)
  }
  assert.equal(c.read().calls.length, 0)
}))
test('an already published release with missing assets is never mutated', () => fixture(c => {
  c.assets(); c.state.release = { tag_name: `v${releaseVersion}`, draft: false, prerelease: releaseVersion.includes('-'), assets: [] }; c.save()
  assert.match(c.run('github-release', ['--publish']).stderr, /assets are incomplete/)
  assert.equal(c.read().calls.filter(a => a[0] === 'release').length, 0)
}))
test('initial release configuration landing on master does not start publication', () => fixture(c => {
  c.git('rm', 'tools/release-config.mjs'); c.git('commit', '-m', 'test: before configuration')
  const before = c.git('rev-parse', 'HEAD')
  cpSync(join(root, 'tools/release-config.mjs'), join(c.directory, 'tools/release-config.mjs'))
  c.git('add', '.'); c.git('commit', '-m', 'ci: add configuration')
  const result = c.run('release-tag', [], { GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/master', GITHUB_SHA: c.git('rev-parse', 'HEAD'), RELEASE_BEFORE_SHA: before })
  assert.equal(result.status, 0, result.stderr); assert.equal(c.git('tag', '--list'), ''); assert.equal(c.read().calls.length, 0)
}))
test('manual version edits cannot tag an Android version code rollback', () => fixture(c => {
  assert.equal(c.run('release-version', ['--set', '9.0.0-rc.1']).status, 0)
  const path = join(c.directory, 'apps/mobile/pubspec.yaml')
  writeFileSync(path, readFileSync(path, 'utf8').replace(/^version:.*$/m, `version: 9.0.0-rc.1+${c.metadata.android_build}`))
  c.git('add', '.'); c.git('commit', '-m', 'test: invalid version code')
  const result = c.run('release-tag', [], { GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/master', RELEASE_BEFORE_SHA: c.sha, GITHUB_SHA: c.git('rev-parse', 'HEAD') })
  assert.match(result.stderr, /Android version code must increase/)
  assert.equal(c.git('tag', '--list'), ''); assert.equal(c.read().calls.length, 0)
}))
test('release notes provide pinned npm installation and APK verification before draft creation', () => fixture(c => {
  c.assets(); const result = c.run('github-release', ['--publish']); assert.equal(result.status, 0, result.stderr)
  const create = c.read().calls.find(a => a[1] === 'create')
  const notes = readFileSync(create[create.indexOf('--notes-file') + 1], 'utf8')
  assert.ok(notes.includes(`@owner/dsh-remote-everywhere@${releaseVersion}`))
  assert.ok(notes.includes(`/blob/v${releaseVersion}/docs/install.md`))
  assert.match(notes, /sha256sum --check SHA256SUMS/)
  assert.ok(create.includes('--draft') && create.includes('--generate-notes'))
}))
