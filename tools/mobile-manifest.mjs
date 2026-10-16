import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const directory = join(root, '.cache/mobile-release')
const metadata = JSON.parse(readFileSync(join(directory, 'version.json')))
const signature = readFileSync(join(directory, 'signature.txt'), 'utf8')
const badging = readFileSync(join(directory, 'badging.txt'), 'utf8')
const expected = process.env.ANDROID_SIGNING_CERT_SHA256?.replaceAll(':', '').toLowerCase()
const actual = signature.match(/^Signer #1 certificate SHA-256 digest: ([a-f\d]+)$/mi)?.[1].toLowerCase()
if (!expected || !/^[a-f\d]{64}$/.test(expected) || actual !== expected || /CN=Android Debug/i.test(signature)) throw new Error('APK release signing certificate mismatch or debug certificate')
if (!/^Verified using v2 scheme.*: true$/m.test(signature)) throw new Error('APK signature v2 verification is required')
const pkg = badging.match(/^package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'/m)
if (!pkg || pkg[1] !== 'dev.dshremote.dsh_remote_mobile' || pkg[2] !== metadata.android_build || pkg[3] !== metadata.version) throw new Error('APK package/version does not match release metadata')
const apk = `dsh-remote-android-${metadata.version}.apk`
const sha256 = createHash('sha256').update(readFileSync(join(directory, apk))).digest('hex')
writeFileSync(join(directory, 'release-manifest.json'), `${JSON.stringify({ version: metadata.version, sourceCommit: metadata.source_sha,
  android: { file: apk, applicationId: pkg[1], versionCode: Number(pkg[2]), certificateSha256: actual, sha256, signatureV2: true } }, null, 2)}\n`)
