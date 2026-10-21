import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { releaseVersion, releaseTag, prerelease } from './release-config.mjs'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const directory = join(root, '.cache/mobile-release')
const args = process.argv.slice(2)
if (args.length && (args.length !== 1 || args[0] !== '--publish')) throw new Error('usage: github-release.mjs [--publish]')
function run(command, parameters) {
  const result = spawnSync(command, parameters, { cwd: root, encoding: 'utf8', timeout: 120000 })
  if (result.error || result.status !== 0) throw new Error(`${command} ${parameters[0]} failed: ${result.stderr}`)
  return result.stdout.trim()
}
const sha = run('git', ['rev-parse', 'HEAD'])
const manifest = JSON.parse(readFileSync(join(directory, 'release-manifest.json')))
const apk = `dsh-remote-android-${releaseVersion}.apk`
const names = [apk, 'release-manifest.json', 'LICENSE.txt', 'ANDROID-NOTICES.md', 'ANDROID-LICENSE-REVIEW.md', 'SHA256SUMS'].sort()
if (JSON.stringify(readdirSync(directory).sort()) !== JSON.stringify(names)) throw new Error('unexpected or missing release assets')
const hashes = Object.fromEntries(names.map(name => [name, createHash('sha256').update(readFileSync(join(directory, name))).digest('hex')]))
if (manifest.version !== releaseVersion || manifest.sourceCommit !== sha || manifest.android?.file !== apk
  || manifest.android.applicationId !== 'dev.dshremote.dsh_remote_mobile' || manifest.android.sha256 !== hashes[apk]
  || manifest.android.signatureV2 !== true || !Number.isSafeInteger(manifest.android.versionCode) || manifest.android.versionCode <= 0
  || !/^[a-f\d]{64}$/.test(manifest.android.certificateSha256 ?? '')) throw new Error('Android release manifest differs from verified source/assets')
const checksums = readFileSync(join(directory, 'SHA256SUMS'), 'utf8').trim().split('\n').map(line => {
  const match = line.match(/^([a-f\d]{64})  (?:\.\/)?([^/]+)$/)
  if (!match || match[2] === 'SHA256SUMS' || hashes[match[2]] !== match[1]) throw new Error('release asset checksum mismatch')
  return match[2]
})
if (JSON.stringify(checksums.sort()) !== JSON.stringify(names.filter(name => name !== 'SHA256SUMS'))) throw new Error('release checksums are incomplete or duplicated')
if (!args.length) {
  console.log(JSON.stringify({ validated: true, offline: true, tag: releaseTag, assets: names }))
} else {
  const repository = process.env.GITHUB_REPOSITORY
  if (process.env.GITHUB_ACTIONS !== 'true' || !/^[a-z\d-]+\/[a-z\d_.-]+$/i.test(repository ?? '')
    || process.env.GITHUB_SHA !== sha || process.env.GITHUB_REF !== `refs/tags/${releaseTag}`
    || process.env.DSH_RELEASE_APPROVED_SHA !== sha || !process.env.GH_TOKEN || run('git', ['status', '--porcelain'])) throw new Error('GitHub publication requires a clean verified release tag')
  const endpoint = `repos/${repository}/releases/tags/${releaseTag}`
  const lookup = () => {
    const result = spawnSync('gh', ['api', endpoint], { encoding: 'utf8', timeout: 60000 })
    if (result.error) throw result.error
    if (result.status === 0) return JSON.parse(result.stdout)
    if (/\(HTTP 404\)/.test(result.stderr)) return null
    throw new Error(`GitHub release lookup failed: ${result.stderr}`)
  }
  let release = lookup()
  if (!release) {
    const notesPath = join(root, '.cache/release-notes.md')
    const source = `https://github.com/${repository}/blob/${releaseTag}`
    const plugin = `@${repository.split('/')[0].toLowerCase()}/dsh-remote-everywhere@${releaseVersion}`
    writeFileSync(notesPath, `## Install / 安装\n\n- DSH Desktop **0.2.1-rc.2**: Plugins → Add plugin / 插件 → 添加插件; official npm registry: \`https://registry.npmjs.org\`; package: \`${plugin}\`.\n- Android **7.0+**: download \`${apk}\` and the other five assets below. In the download directory run \`sha256sum --check SHA256SUMS\` (macOS: \`shasum -a 256 --check SHA256SUMS\`).\n- [中文安装、配对与回滚](${source}/docs/install.md) · [English installation, pairing and rollback](${source}/docs/install.en.md).\n- The Android app is installed separately; no iOS IPA is distributed. / 手机 App 需单独安装，暂不提供 iOS IPA。\n\n`)
    run('gh', ['release', 'create', releaseTag, '--repo', repository, '--verify-tag', '--draft', '--title', `DSH Remote ${releaseVersion}`, '--notes-file', notesPath, '--generate-notes'])
    release = lookup()
  }
  function verifyAssets(value, complete) {
    if (!value || value.tag_name !== releaseTag) throw new Error('GitHub release tag mismatch')
    const seen = new Set()
    for (const asset of value.assets) {
      if (!names.includes(asset.name) || seen.has(asset.name) || asset.digest !== `sha256:${hashes[asset.name]}`) throw new Error(`GitHub release asset differs: ${asset.name}`)
      seen.add(asset.name)
    }
    if (complete && seen.size !== names.length) throw new Error('GitHub release assets are incomplete')
    return seen
  }
  const uploaded = verifyAssets(release, !release.draft)
  if (release.draft) {
    for (const name of names) if (!uploaded.has(name)) run('gh', ['release', 'upload', releaseTag, join(directory, name), '--repo', repository])
    verifyAssets(lookup(), true)
    run('gh', ['release', 'edit', releaseTag, '--repo', repository, '--draft=false', `--prerelease=${prerelease}`, `--latest=${!prerelease}`])
    const published = lookup()
    verifyAssets(published, true)
    if (published.draft || published.prerelease !== prerelease) throw new Error('GitHub release publication was not confirmed')
  } else if (release.prerelease !== prerelease) throw new Error('published GitHub release type differs')
  console.log(`Verified GitHub Release ${repository}@${releaseTag}`)
}
