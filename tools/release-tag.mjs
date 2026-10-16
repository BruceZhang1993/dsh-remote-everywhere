import { spawnSync } from 'node:child_process'
import { releaseVersion, releaseTag, compareVersions } from './release-config.mjs'

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 60000 })
  if (result.error || result.status !== 0) throw new Error(`${command} ${args[0]} failed: ${result.stderr}`)
  return result.stdout.trim()
}
if (process.env.GITHUB_ACTIONS !== 'true' || process.env.GITHUB_EVENT_NAME !== 'push' || process.env.GITHUB_REF !== 'refs/heads/master') throw new Error('automatic tagging requires a master push')
const before = process.env.RELEASE_BEFORE_SHA
if (!/^[a-f\d]{40}$/.test(before ?? '') || /^0+$/.test(before)) throw new Error('previous master commit is required')
// Adding the release configuration initially does not start a publication.
const files = run('git', ['ls-tree', '--name-only', before, 'tools/release-config.mjs'])
if (!files) {
  console.log('Initial release configuration; no tag created.')
} else {
  const previous = run('git', ['show', `${before}:tools/release-config.mjs`]).match(/export const releaseVersion = '([^']+)'/)?.[1]
  if (!previous) throw new Error('previous release version is missing')
  if (previous === releaseVersion) {
    console.log('Release version unchanged; no tag created.')
  } else {
    if (compareVersions(releaseVersion, previous) <= 0) throw new Error('release version must increase')
    const sha = run('git', ['rev-parse', 'HEAD'])
    if (sha !== process.env.GITHUB_SHA || run('git', ['status', '--porcelain'])) throw new Error('release checkout differs from the master push')
    // This also checks that the Android and npm versions agree.
    const metadata = JSON.parse(run(process.execPath, ['tools/release-version.mjs']))
    const previousBuild = run('git', ['show', `${before}:apps/mobile/pubspec.yaml`]).match(/^version: [^\s+]+\+(\d+)$/m)?.[1]
    if (!previousBuild || Number(metadata.android_build) <= Number(previousBuild)) throw new Error('Android version code must increase before tagging')
    const existing = run('git', ['tag', '--list', releaseTag])
    if (existing) {
      if (run('git', ['rev-list', '-n', '1', releaseTag]) !== sha) throw new Error('release tag already points to another commit')
    } else {
      run('git', ['tag', '-a', releaseTag, '-m', `Release ${releaseVersion}`])
      run('git', ['push', 'origin', `refs/tags/${releaseTag}`])
    }
    // GITHUB_TOKEN-created tags do not trigger push workflows. Dispatch explicitly.
    run('gh', ['workflow', 'run', 'release.yml', '--ref', releaseTag])
  }
}
