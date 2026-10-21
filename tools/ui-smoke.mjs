import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { setTimeout as delay } from 'node:timers/promises'
import { localRequest } from '../packages/dsh-plugin/src/local.js'
import { DeviceStore } from '../packages/dsh-plugin/src/store.js'
import { pairDevice, RemoteClient } from '../packages/dsh-plugin/src/client.js'

// Browser plugin not available in this session; use the installed Playwright runtime.
const { chromium } = await import(process.env.DSH_PLAYWRIGHT ?? 'playwright')
const modules = process.env.DSH_HOST_MODULE_ROOT
if (!modules) throw new Error('set DSH_HOST_MODULE_ROOT to DSH Desktop 0.2.1-rc.2 node_modules')
assert.equal(JSON.parse(readFileSync(join(modules, '@deepseek-ai/dsh/package.json'))).version, '0.2.1-rc.2')
const root = resolve(import.meta.dirname, '..')
const directory = mkdtempSync(join(tmpdir(), 'dsh-ui-smoke-'))
const children = []
const errors = []
const desktop = process.argv.includes('--desktop')
const publicTunnel = process.env.DSH_UI_PUBLIC === '1' && !desktop
if (publicTunnel && !process.env.DSH_UI_CLOUDFLARED) throw new Error('set DSH_UI_CLOUDFLARED for public tunnel UI acceptance')
const plugin = process.env.DSH_PLUGIN_PACKAGE_ROOT ?? join(root, 'packages/dsh-plugin')
const pluginName = JSON.parse(readFileSync(join(plugin, 'package.json'))).name
let browser

function profile(label, name) {
  const home = join(directory, label)
  const profile = join(home, 'profiles', name)
  mkdirSync(join(profile, 'node_modules', pluginName, '..'), { recursive: true })
  symlinkSync(join(modules, '@deepseek-ai'), join(profile, 'node_modules/@deepseek-ai'))
  symlinkSync(plugin, join(profile, 'node_modules', pluginName))
  writeFileSync(join(profile, 'package.json'), JSON.stringify({ private: true, dependencies: { [pluginName]: `file:${plugin}` }, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', pluginName] } } }))
  writeFileSync(join(profile, 'cordis.patch.yml'), `- id: remote-everywhere\n  config:\n    name: UI ${label}\n${publicTunnel ? `    cloudflared: ${JSON.stringify(process.env.DSH_UI_CLOUDFLARED)}\n` : ''}- id: locale\n  config:\n    language: zh\n- id: ui-settings-models\n  config:\n    credentialOnboarding: false\n`)
  return { home, profile, name, state: join(profile, 'remote') }
}
function launch(command, args, config) {
  const child = spawn(command, args, { env: { ...process.env, DSH_HOME: config.home, DSH_TELEMETRY_DISABLED: '1',
    // Satisfy the Desktop welcome metadata check without borrowing a real credential or calling a model.
    ...(config.native ? { DEEPSEEK_API_KEY: 'synthetic-ui-test-only-not-a-real-key' } : {}),
  }, stdio: ['ignore', 'pipe', 'pipe'] })
  child.output = ''
  const capture = chunk => { child.output = (child.output + chunk).slice(-18000) }
  child.stdout.on('data', capture); child.stderr.on('data', capture)
  children.push(child)
  return child
}
async function wait(read, accept) {
  for (let attempt = 0; attempt < 400; attempt++) {
    const value = await read()
    if (accept(value)) return value
    await delay(100)
  }
  throw new Error('UI smoke readiness timed out')
}
async function start(label, native = false) {
  const config = profile(label, native ? 'desktop' : 'remote-ui')
  config.native = native
  return boot(config)
}
async function boot(config) {
  const native = config.native
  const child = native
    ? launch(process.env.DSH_ELECTRON ?? '/usr/lib/deepseek-harness-desktop/deepseek-harness', [`--user-data-dir=${join(directory, 'electron')}`, '--remote-debugging-port=0', '--no-first-run', '--disable-renderer-backgrounding'], config)
    : launch(process.execPath, [join(modules, '@deepseek-ai/dsh/lib/bin.js'), '--profile', config.name, '--no-open', '--port', '0'], config)
  config.child = child
  try {
    await wait(async () => {
      if (child.exitCode !== null) throw new Error('host exited')
      try { return await localRequest(config.state, 'status') } catch { return null }
    }, Boolean)
    if (native) config.debug = await wait(() => child.output.match(/DevTools listening on (ws:\/\/[^\s]+)/)?.[1], Boolean)
    else config.url = await wait(() => child.output.replace(/\x1b\[[0-9;]*m/g, '').match(/http:\/\/(?:127\.0\.0\.1|localhost):\d+\/\?token=[^\s]+/)?.[0], Boolean)
    return config
  } catch (error) {
    throw new Error(`${config.name}: ${error.message}\n${child.output.replace(/token=[^\s&]+/g, 'token=[redacted]').slice(-6000)}`)
  }
}
async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise(resolve => child.once('exit', resolve))
  child.kill('SIGTERM')
  const timer = setTimeout(() => child.kill('SIGKILL'), 5000)
  await exited
  clearTimeout(timer)
}
function capture(page) {
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
}
async function open(config, native) {
  let page
  if (native) {
    browser = await chromium.connectOverCDP(config.debug)
    const context = browser.contexts()[0]
    page = await wait(() => context.pages().find(page => page.url().startsWith('dsh-app://app')), Boolean)
    capture(page)
    await page.bringToFront()
  } else {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'zh-CN' })
    page = await context.newPage()
    capture(page)
    await page.goto(config.url)
  }
  await page.getByRole('button', { name: '远程设备', exact: true }).waitFor({ timeout: 45000 })
  const preview = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: '预览版说明', exact: true }) })
  try { await preview.waitFor({ state: 'visible', timeout: 5000 }) } catch (error) { if (error.name !== 'TimeoutError') throw error }
  if (await preview.isVisible()) await preview.getByRole('button', { name: '继续', exact: true }).click({ timeout: 10000 })
  const later = page.getByRole('button', { name: /^(稍后配置|Configure later)$/ })
  try { await later.click({ timeout: 3000 }) } catch (error) { if (error.name !== 'TimeoutError') throw error }
  return page
}
async function management(page, method, params = {}) {
  return page.evaluate(async ({ method, params }) => {
    const response = await fetch('api/dsh-remote/manage', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-request', rpcId: 'ui-smoke', method: 'dsh-remote/manage', payload: { method, params } }) })
    return response.json()
  }, { method, params })
}

try {
  const a = await start('A', desktop)
  if (!desktop) browser = await chromium.launch({ executablePath: process.env.CHROME_EXECUTABLE ?? (existsSync('/usr/bin/google-chrome-stable') ? '/usr/bin/google-chrome-stable' : chromium.executablePath()), headless: true })
  const pageA = await open(a, desktop)
  await pageA.getByRole('button', { name: '远程设备', exact: true }).click({ timeout: 45000 })
  const uiA = pageA.locator('.dsh-remote').filter({ has: pageA.getByRole('heading', { name: '远程设备', exact: true }) })
  await uiA.getByText('还没有配对设备', { exact: true }).waitFor()
  assert((await pageA.title()).length > 0)
  if (!desktop) {
    const unauthenticated = await fetch(new URL('/api/dsh-remote/manage', a.url), { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    assert.equal(unauthenticated.status, 401)
  }
  await uiA.getByRole('button', { name: '让其他设备连接本机', exact: true }).click()
  await uiA.getByRole('button', { name: '生成配对码', exact: true }).click()
  await uiA.getByRole('img').waitFor()
  const incoming = (await management(pageA, 'status')).result.value.incoming
  assert.match(incoming.image, /^data:image\/png;base64,/)
  await pageA.screenshot({ path: desktop ? '/tmp/dsh-remote-ui-desktop.png' : '/tmp/dsh-remote-ui-pairing.png' })
  if (desktop) {
    // Exercise real Desktop carrier, slot loading and pairing state without driving another browser into it.
    await uiA.getByRole('button', { name: '取消配对', exact: true }).click()
    await uiA.getByRole('button', { name: '生成配对码', exact: true }).waitFor()
    await uiA.getByRole('button', { name: '返回', exact: true }).click()
    await uiA.getByRole('heading', { name: '远程设备', exact: true }).evaluate(element => element.scrollIntoView({ block: 'start' }))
    await pageA.screenshot({ path: '/tmp/dsh-remote-ui-desktop.png' })
  } else {
    const b = await start('B')
    const pageB = await open(b)
    await pageB.getByRole('button', { name: '远程设备', exact: true }).click({ timeout: 45000 })
    const uiB = pageB.locator('.dsh-remote').filter({ has: pageB.getByRole('heading', { name: '远程设备', exact: true }) })
    await uiB.getByRole('button', { name: '连接其他 DSH', exact: true }).click()
    await uiB.getByLabel('配对信息 JSON').fill(JSON.stringify({ ...incoming.qr, name: { invalid: true } }))
    await uiB.getByRole('button', { name: '连接并核对安全码', exact: true }).click()
    await uiB.getByRole('alert').waitFor()
    // A successful observer update must not erase a failed command's actionable error.
    await management(pageB, 'pair.begin')
    await uiB.getByRole('button', { name: '让其他设备连接本机', exact: true }).click()
    await uiB.getByRole('img').waitFor()
    assert.equal(await uiB.getByRole('alert').isVisible(), true)
    await uiB.getByRole('button', { name: '取消配对', exact: true }).click()
    await uiB.getByRole('button', { name: '连接其他 DSH', exact: true }).click()
    await uiB.getByLabel('配对信息 JSON').fill(JSON.stringify(incoming.qr))
    await uiB.getByRole('button', { name: '连接并核对安全码', exact: true }).click()
    await uiB.getByLabel('六位安全码', { exact: true }).waitFor()
    await uiA.getByLabel('六位安全码', { exact: true }).waitFor()
    assert.equal(await uiA.getByLabel('六位安全码', { exact: true }).textContent(), await uiB.getByLabel('六位安全码', { exact: true }).textContent())
    await uiB.getByRole('button', { name: '安全码一致，确认配对', exact: true }).click()
    await uiB.getByText('本端已确认，等待另一端确认', { exact: true }).waitFor()
    assert.equal((await management(pageA, 'status')).result.value.devices.length, 0)
    await uiA.getByRole('button', { name: '安全码一致，确认配对', exact: true }).click()
    await uiB.getByText('配对成功', { exact: true }).waitFor()
    const device = uiB.getByRole('article')
    await device.getByRole('button', { name: '改名', exact: true }).click()
    await device.getByLabel('设备名称').fill('我的工作电脑')
    await device.getByRole('button', { name: '保存', exact: true }).click()
    await device.getByText('我的工作电脑', { exact: true }).waitFor()
    await device.getByRole('button', { name: '连接', exact: true }).click()
    await device.getByText('已连接', { exact: true }).waitFor()
    // Restart the same profile: identity and trust survive, while connection state recovers.
    const original = await localRequest(a.state, 'status')
    await pageA.context().close()
    await stop(a.child)
    await boot(a)
    const restarted = await localRequest(a.state, 'status')
    assert.equal(restarted.deviceId, original.deviceId)
    assert.deepEqual(restarted.devices.map(value => value.deviceId), original.devices.map(value => value.deviceId))
    await device.getByRole('textbox').fill(restarted.endpoint)
    await device.getByRole('button', { name: '连接', exact: true }).click()
    await device.getByText('已连接', { exact: true }).waitFor()
    await uiB.getByRole('button', { name: '返回', exact: true }).click()
    await uiB.getByRole('heading', { name: '远程设备', exact: true }).evaluate(element => element.scrollIntoView({ block: 'start' }))
    await pageB.screenshot({ path: '/tmp/dsh-remote-ui-devices.png' })
    await pageB.setViewportSize({ width: 560, height: 900 })
    await pageB.emulateMedia({ colorScheme: 'dark' })
    await uiB.getByRole('heading', { name: '远程设备', exact: true }).evaluate(element => element.scrollIntoView({ block: 'start' }))
    await pageB.screenshot({ path: '/tmp/dsh-remote-ui-narrow.png' })
    assert.equal(await uiB.evaluate(element => element.scrollWidth > element.clientWidth + 1), false)
    await device.getByRole('button', { name: '吊销', exact: true }).click()
    await device.getByRole('alertdialog').getByRole('button', { name: '吊销', exact: true }).click()
    await device.getByText('已吊销', { exact: true }).waitFor()
    await uiB.getByRole('tab', { name: '设备', exact: true }).focus()
    await pageB.keyboard.press('ArrowRight')
    await uiB.getByRole('tab', { name: '公网访问', exact: true }).waitFor()
    assert.equal(await uiB.getByRole('tab', { name: '公网访问', exact: true }).getAttribute('aria-selected'), 'true')
    await uiB.getByRole('button', { name: '检测 cloudflared', exact: true }).click()
    await uiB.getByRole('tab', { name: '使用帮助', exact: true }).click()
    await uiB.getByText('配对完成后，在本机 DSH 对话中发送：', { exact: true }).waitFor()
    if (publicTunnel) {
      const identity = (await management(pageB, 'status')).result.value.deviceId
      await uiB.getByRole('button', { name: '让其他设备连接本机', exact: true }).click()
      await uiB.getByRole('button', { name: '生成配对码', exact: true }).click()
      await uiB.getByRole('img').waitFor()
      await uiB.getByRole('tab', { name: '公网访问', exact: true }).click()
      await uiB.getByRole('button', { name: '开启公网访问', exact: true }).click()
      await uiB.getByText('已就绪', { exact: true }).waitFor({ timeout: 75000 })
      const ready = (await management(pageB, 'status')).result.value
      assert.equal(ready.incoming.state, 'cancelled')
      assert.match(ready.endpoint, /^wss:\/\/[^/]+\.trycloudflare\.com\/remote\/ws$/)
      await uiB.getByRole('tab', { name: '设备', exact: true }).click()
      await uiB.getByRole('button', { name: '生成配对码', exact: true }).click()
      await uiB.getByRole('img').waitFor()
      const publicPair = (await management(pageB, 'status')).result.value.incoming
      assert.equal(publicPair.qr.relay, ready.endpoint)
      writeFileSync('/tmp/dsh-remote-ui-public-qr.png', Buffer.from(publicPair.image.split(',')[1], 'base64'))
      await pageB.screenshot({ path: '/tmp/dsh-remote-ui-public.png' })
      const controller = new DeviceStore(join(directory, 'public-controller'))
      let client
      try {
        const peer = await pairDevice(controller, publicPair.qr, async ({ sas }) => {
          const code = uiB.getByLabel('六位安全码', { exact: true })
          await code.waitFor()
          assert.equal(await code.textContent(), sas)
          await uiB.getByRole('button', { name: '安全码一致，确认配对', exact: true }).click()
          return true
        }, 'Public QR smoke')
        client = await new RemoteClient(controller, peer).connect()
        assert.ok(Array.isArray((await client.request('session.list', {})).items))
      } finally { await client?.close(); controller.close() }
      // New tunnel edges can reset TLS during propagation (spikes/tunnel/REPORT.md).
      // This negative route probe has no mutation; retries remain inside one 45-second budget.
      const { stdout } = await promisify(execFile)('curl', ['--silent', '--show-error', '--output', '/dev/null', '--write-out', '%{http_code}', '--retry', '7', '--retry-max-time', '40', '--retry-all-errors', '--max-time', '5', '--request', 'POST', '--data', '{}', new URL('/api/dsh-remote/manage', ready.endpoint.replace(/^wss:/, 'https:')).href], { timeout: 45000, maxBuffer: 4096 })
      assert.equal(stdout.trim(), '404')
      await uiB.getByRole('tab', { name: '公网访问', exact: true }).click()
      await uiB.getByRole('button', { name: '停止公网访问', exact: true }).click()
      await uiB.getByText('未开启', { exact: true }).waitFor()
      assert.equal((await management(pageB, 'status')).result.value.deviceId, identity)
    }
  }
  const relevant = errors.filter(message => !/favicon|net::ERR_ABORTED|401 \(Unauthorized\)/.test(message))
  assert.deepEqual(relevant, [])
  console.log(JSON.stringify({ passed: true, desktop, publicTunnel, pluginName, version: '0.2.1-rc.2', screenshots: desktop ? ['/tmp/dsh-remote-ui-desktop.png'] : ['/tmp/dsh-remote-ui-pairing.png', '/tmp/dsh-remote-ui-devices.png', '/tmp/dsh-remote-ui-narrow.png'], consoleErrors: relevant.length }))
} catch (error) {
  for (const context of browser?.contexts() ?? []) for (const page of context.pages()) {
    console.error(JSON.stringify({ dialogs: await page.getByRole('dialog').allTextContents(), errors }))
    await page.screenshot({ path: '/tmp/dsh-remote-ui-failure.png' }).catch(() => {})
  }
  throw error
} finally {
  await Promise.race([browser?.close(), delay(3000)])
  for (const child of children) await stop(child)
  rmSync(directory, { recursive: true, force: true })
}
