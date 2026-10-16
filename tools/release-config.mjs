// Development candidates use a new identity; the published 0.1.0 artifacts remain immutable.
export const releaseVersion = '0.2.0-rc.3'
export const releasePackages = ['protocol', 'core', 'tunnel', 'cli', 'dsh-ui', 'dsh-plugin']
export const scopedPackageName = (scope, directory) => `@${scope}/dsh-remote-${({ 'dsh-ui': 'ui', 'dsh-plugin': 'everywhere' })[directory] ?? directory}`
export const releaseRegistries = { 'github-packages': 'https://npm.pkg.github.com', npm: 'https://registry.npmjs.org' }
export const candidateDirectory = (target = 'github-packages') => `.cache/${target}-${releaseVersion}`
export const releaseTag = `v${releaseVersion}`
export const prerelease = releaseVersion.includes('-')
export function validateVersion(version) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[a-z][a-z0-9]*(?:\.(?:0|[1-9]\d*))?)?$/.test(version)
    || version.split(/[.-]/).filter(value => /^\d+$/.test(value)).some(value => !Number.isSafeInteger(Number(value)))) throw new Error('expected a canonical version, e.g. 0.2.0 or 0.2.0-rc.1')
  return version
}
validateVersion(releaseVersion)

export function compareVersions(left, right) {
  validateVersion(left); validateVersion(right)
  const [a, ap] = left.split('-'), [b, bp] = right.split('-')
  for (let i = 0; i < 3; i++) {
    const difference = Number(a.split('.')[i]) - Number(b.split('.')[i])
    if (difference) return Math.sign(difference)
  }
  if (ap === bp) return 0
  if (!ap || !bp) return ap ? -1 : 1
  const aa = ap.split('.'), bb = bp.split('.')
  if (aa[0] !== bb[0]) return aa[0] < bb[0] ? -1 : 1
  if (aa[1] === undefined || bb[1] === undefined) return aa[1] === undefined ? -1 : 1
  return Math.sign(Number(aa[1]) - Number(bb[1]))
}
