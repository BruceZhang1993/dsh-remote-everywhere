import { existsSync, readFileSync, writeFileSync, mkdirSync, realpathSync, readdirSync } from 'node:fs'
import { resolve, join, dirname, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'

const root = fileURLToPath(new URL('..', import.meta.url))
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const licenseAt = directory => readdirSync(directory).filter(name => /^licen[sc]e(?:[.-].*)?$/i.test(name)).map(name => join(directory, name))[0]
const installed = new Map(), unresolved = []
function visit(path) {
  path = realpathSync(path)
  if (installed.has(path)) return
  const pkg = JSON.parse(readFileSync(path)), directory = dirname(path)
  const license = licenseAt(directory) ?? (directory.startsWith(join(root, 'packages/')) ? join(root, 'LICENSE') : null)
  installed.set(path, { name: pkg.name, version: pkg.version, license: pkg.license ?? null,
    licenseSha256: license ? sha256(readFileSync(license)) : null,
    installHooks: Object.keys(pkg.scripts ?? {}).filter(name => ['preinstall', 'install', 'postinstall'].includes(name)) })
  const require = createRequire(path)
  for (const name of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies, ...pkg.peerDependencies })) {
    const found = require.resolve.paths(name)?.map(base => join(base, name, 'package.json')).find(existsSync)
    if (found) visit(found)
    else unresolved.push({ parent: pkg.name, name, optional: Boolean(pkg.optionalDependencies?.[name] || pkg.peerDependenciesMeta?.[name]?.optional) })
  }
}
for (const name of ['protocol', 'core', 'tunnel', 'cli', 'dsh-plugin']) visit(join(root, 'packages', name, 'package.json'))
const node = { scope: 'installed runtime dependencies and peers of five workspace packages',
  lockSha256: sha256(readFileSync(join(root, 'pnpm-lock.yaml'))), packages: [...installed.values()], unresolved }
const inventories = []
for (const project of ['packages/core/dart', 'apps/mobile']) {
  const configPath = resolve(root, project, '.dart_tool/package_config.json')
  const config = JSON.parse(readFileSync(configPath))
  const packages = config.packages.map(pkg => {
    const directory = fileURLToPath(new URL(pkg.rootUri, pathToFileURL(configPath)))
    const pubspec = join(directory, 'pubspec.yaml')
    const source = existsSync(pubspec) ? readFileSync(pubspec, 'utf8') : ''
    let license = ['LICENSE', 'LICENSE.md', 'LICENSE.txt'].map(name => join(directory, name)).find(existsSync)
    if (!license && directory.startsWith(root)) license = join(root, 'LICENSE')
    if (!license) license = [dirname(directory), dirname(dirname(directory))].map(licenseAt).find(Boolean)
    return { name: pkg.name, version: /^version:\s*['"]?([^\s'"]+)/m.exec(source)?.[1] ?? null,
      languageVersion: pkg.languageVersion, pubspecSha256: existsSync(pubspec) ? sha256(readFileSync(pubspec)) : null,
      licenseSha256: license ? sha256(readFileSync(license)) : null,
      licenseRelativeToPackage: license ? relative(directory, license) : null,
      buildHooks: ['hook', 'hooks'].filter(name => existsSync(join(directory, name))),
      ffiPlugin: /ffiPlugin:\s*true/.test(source), flutterPlugin: /plugin:\s*\n/.test(source) }
  })
  inventories.push({ project, scope: 'all resolved packages, including dev/SDK packages',
    generatorVersion: config.generatorVersion, lockSha256: sha256(readFileSync(resolve(root, project, 'pubspec.lock'))), packages })
}
mkdirSync(resolve(root, '.cache/m4'), { recursive: true })
writeFileSync(resolve(root, '.cache/m4/node-dependencies.json'), `${JSON.stringify(node, null, 2)}\n`)
writeFileSync(resolve(root, '.cache/m4/dart-dependencies.json'), `${JSON.stringify(inventories, null, 2)}\n`)
console.log(JSON.stringify({ node: { count: node.packages.length, unresolved: node.unresolved }, dart: inventories.map(({ project, packages }) => ({ project, count: packages.length,
  missingLicenses: packages.filter(pkg => !pkg.licenseSha256).map(pkg => pkg.name),
  hooks: packages.filter(pkg => pkg.buildHooks.length).map(pkg => pkg.name) })) }))
