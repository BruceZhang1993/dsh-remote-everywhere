import { readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { releaseVersion, releaseTag, prerelease, validateVersion, compareVersions, candidateDirectory } from './release-config.mjs'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const args = process.argv.slice(2)
const configPath = resolve(root, 'tools/release-config.mjs')
const pubspecPath = resolve(root, 'apps/mobile/pubspec.yaml')
const config = readFileSync(configPath, 'utf8')
const pubspec = readFileSync(pubspecPath, 'utf8')
const mobile = pubspec.match(/^version: ([^\s+]+)\+(\d+)$/m)
if (!mobile) throw new Error('mobile version/build is missing')
if (mobile[1] !== releaseVersion) throw new Error('mobile and package release versions differ')
if (args[0] === '--set' && args.length === 2) {
  const version = validateVersion(args[1])
  if (compareVersions(version, releaseVersion) <= 0) throw new Error('release version must increase')
  const status = spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' })
  if (status.status || status.stdout.trim()) throw new Error('prepare a version from a clean checkout')
  const build = Number(mobile[2]) + 1
  if (!Number.isSafeInteger(build) || build > 2100000000) throw new Error('invalid Android version code')
  writeFileSync(configPath, config.replace(`export const releaseVersion = '${releaseVersion}'`, `export const releaseVersion = '${version}'`))
  writeFileSync(pubspecPath, pubspec.replace(mobile[0], `version: ${version}+${build}`))
  console.log(`Prepared ${version}, Android build ${build}; review and merge the version PR to release.`)
} else if (!args.length || args.length === 1 && args[0] === '--github-output') {
  const sha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' })
  if (sha.status !== 0) throw new Error('cannot resolve release source')
  const metadata = { version: releaseVersion, tag: releaseTag, prerelease: String(prerelease), source_sha: sha.stdout.trim(),
    android_build: mobile[2], npm_directory: candidateDirectory('npm'), github_directory: candidateDirectory(),
    npm_artifact: `npm-${releaseVersion}-candidates`, github_artifact: `github-packages-${releaseVersion}-candidates` }
  if (args.length) {
    if (!process.env.GITHUB_OUTPUT) throw new Error('GITHUB_OUTPUT is required')
    appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(metadata).map(([key, value]) => `${key}=${value}\n`).join(''))
  } else console.log(JSON.stringify(metadata))
} else throw new Error('usage: release-version.mjs [--set VERSION|--github-output]')
