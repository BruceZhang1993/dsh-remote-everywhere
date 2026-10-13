import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TunnelManager } from '@dsh-remote/tunnel'
import { deviceId } from '@dsh-remote/core'
import { ProtocolError } from '@dsh-remote/protocol'
import { RemoteRuntime } from './runtime.js'
import { localServer } from './local.js'
import { registerTools, CALL_METHODS, runRemote, operateRemote } from './tools.js'

export const name = 'remote-everywhere'
export const inject = ['sessionController', 'tools', 'skills', 'approval']
export function apply(ctx, config = {}) {
  if (!ctx.profileContext?.dir && !config.directory) throw new Error('remote plugin requires a profile state directory')
  const directory = config.directory ?? join(ctx.profileContext.dir, 'remote')
  ctx.effect(async () => {
    const runtime = new RemoteRuntime(ctx, { directory, name: config.name, port: config.port })
    let stopLocal
    let stopTools
    let stopSkill
    try {
      await runtime.start()
      stopTools = registerTools(ctx, runtime)
      const skillPath = join(dirname(fileURLToPath(import.meta.url)), '../skills/remote-control/SKILL.md')
      stopSkill = ctx.skills.register({ name: 'remote-control', description: 'Control an explicitly paired DSH instance, follow sessions, and route human approvals.', source: 'bundled', path: skillPath, content: readFileSync(skillPath, 'utf8') })
      stopLocal = await localServer(directory, async ({ method, params = {} }, { signal }) => {
        switch (method) {
          case 'status': return { endpoint: runtime.endpoint, deviceId: deviceId(runtime.store.keyPair.publicKey), devices: runtime.devices() }
          case 'host.info': {
            try { return { presets: await ctx.get('agentPresets')?.list() } }
            catch (error) { throw new ProtocolError('internal', error.message.slice(0, 256)) }
          }
          case 'pair.begin': return runtime.pairing.begin(runtime.endpoint, params.caps)
          case 'pair.pending': return runtime.pairing.pending()
          case 'pair.confirm': return runtime.pairing.confirm(params.sas)
          case 'pair.cancel': runtime.pairing.cancel(); return { ok: true }
          case 'device.list': return { devices: runtime.devices() }
          case 'device.revoke': runtime.revoke(params.deviceId); return { revoked: true }
          case 'device.rename': runtime.store.rename(params.deviceId, params.name); return { ok: true }
          case 'remote.call': {
            if (!CALL_METHODS.includes(params.method)) throw new Error('method is not exposed to automation')
            return (await runtime.connect(params.deviceId, params.endpoint)).request(params.method, params.params, { signal })
          }
          case 'remote.run': return runRemote(ctx, runtime, params, { signal })
          case 'remote.operation': return operateRemote(ctx, runtime, params, { signal })
          case 'tunnel.start': {
            runtime.tunnelManager ??= new TunnelManager({ binary: config.cloudflared })
            const url = await runtime.tunnelManager.start(runtime.server.origin)
            return { endpoint: `wss://${new URL(url).host}/remote/ws` }
          }
          case 'tunnel.stop': await runtime.tunnelManager?.stop(); return { ok: true }
          default: throw new Error('unknown local operation')
        }
      })
      ctx.logger.info('remote plugin ready at %s; local management %s', runtime.server.endpoint, directory)
    } catch (error) {
      await stopLocal?.(); stopTools?.(); stopSkill?.(); await runtime.close(); throw error
    }
    return async () => {
      await stopLocal?.(); stopTools?.(); stopSkill?.(); await runtime.tunnelManager?.stop(); await runtime.close()
    }
  }, 'remote-everywhere: listener, local control, tools and skill')
}
