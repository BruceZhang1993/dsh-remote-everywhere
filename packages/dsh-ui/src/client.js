window.__ModuleLoader__.load({
  id: '@dsh-remote/ui',
  factory: require => {
    const React = require('react')
    const { Button } = require('@deepseek-ai/dsh-client-ui-primitives')
    const h = React.createElement
    const BUNDLE = 'dsh-remote-everywhere'
    const NS = 'remoteEverywhere'
    const zh = {
      title: '远程设备', welcome: '远程管理已就绪', introduction: '连接另一台 DSH，或让手机和其他 DSH 连接本机。配对始终需要双方人工确认。',
      open: '打开远程管理', dismiss: '稍后', loading: '正在读取远程服务状态…', unavailable: '远程服务暂不可用。请在插件页确认后台已启用，必要时重启 DSH。', retry: '重试',
      devices: '设备', network: '公网访问', help: '使用帮助', running: '服务运行中', incoming: '让其他设备连接本机', outgoing: '连接其他 DSH',
      noDevices: '还没有配对设备', noDevicesHint: '先选择连接方向。配对后即可在 DSH 对话中指定设备，查看和继续远程会话。',
      inbound: '它能控制本机', outbound: '我能控制它', noAccess: '未授权', paired: '已配对 · 未连接', connected: '已连接', revoked: '已吊销',
      connect: '连接', disconnect: '断开连接', rename: '改名', revoke: '吊销', revokeConfirm: '吊销此设备的信任并断开当前连接？重新使用需要再次配对。',
      name: '设备名称', save: '保存', cancel: '取消', back: '返回', copy: '复制设备 ID', copied: '已复制', copyFailed: '复制失败，请手动选择并复制。',
      pairedAt: '配对时间', advanced: '高级诊断', cliHint: '需要进一步排查时，在本机运行以下命令；将路径替换为该 profile 的 remote 状态目录。',
      localOnly: '当前端点只允许本机连接。手机或另一台电脑连接前，请先开启公网访问，再生成配对码。',
      caps: '允许对方使用的能力', session: '会话', stream: '流式输出', approval: '人工审批', files: '文件', terminal: '终端', admin: '设备管理',
      generate: '生成配对码', regenerate: '重新配对', copyPair: '复制配对信息', expiry: '有效时间（秒）', waitingPeer: '等待对方扫码或导入配对信息',
      sas: '六位安全码', sasHint: '请人工核对两端显示的安全码完全一致，再确认。名称仅供识别，不代替安全码核对。', confirm: '安全码一致，确认配对', reject: '取消配对',
      waiting: '本端已确认，等待另一端确认', success: '配对成功', expired: '配对信息已过期，请重新生成。', cancelled: '配对已取消或连接已关闭。',
      pairingText: '配对信息 JSON', import: '导入配对文件', startPair: '连接并核对安全码', connecting: '正在建立加密连接…',
      tunnelIntro: '公网隧道只转发加密的远程协议，不公开 DSH 管理界面。隧道地址可能变化，停止后旧地址不可用。',
      stopped: '未开启', starting: '启动中', stopping: '停止中', ready: '已就绪', failed: '连接失败', startTunnel: '开启公网访问', stopTunnel: '停止公网访问',
      check: '检测 cloudflared', installed: '已检测到 cloudflared', missing: '未检测到可用的 cloudflared。请先安装，或在后台配置 cloudflared 的绝对路径，再重启插件。',
      endpoint: '当前连接地址', endpointHint: '仅在旧隧道地址失效时填写新地址；设备公钥保持不变。',
      usage: '配对完成后，在本机 DSH 对话中发送：', prompt: '请使用 remote-control，连接设备 ', promptEnd: '，列出它的会话。',
      mobile: '手机使用独立的 DSH Remote Mobile App 扫码或粘贴配对信息。npm 插件不会安装手机 App；当前尚未分发正式签名 App。',
      permissions: '文件、终端和设备管理需在配对时单独授权；写文件和执行命令仍需逐次人工审批。修改授权请吊销后重新配对。',
      direction: '两个方向分别授权。连接另一台 DSH 不会自动允许它控制本机。',
      invalid: '配对信息格式不正确，请粘贴完整 JSON。', busy: '有操作正在进行，请稍后重试。', unauthorized: '配对已被替换、过期或安全码不匹配，请重新核对。',
      operationFailed: '操作失败，请检查连接或服务状态后重试。', tunnelFailed: '公网隧道未就绪，请检查 cloudflared 和网络。', done: '操作已完成',
    }
    const en = { title: 'Remote devices', welcome: 'Remote management is ready', open: 'Open remote management', dismiss: 'Later',
      devices: 'Devices', network: 'Public access', help: 'Help', running: 'Service running', incoming: 'Let another device connect', outgoing: 'Connect to another DSH',
      noDevices: 'No paired devices', connect: 'Connect', disconnect: 'Disconnect', rename: 'Rename', revoke: 'Revoke', save: 'Save', cancel: 'Cancel', retry: 'Retry',
      loading: 'Loading remote service…', success: 'Pairing completed', sas: 'Six-digit safety code', confirm: 'Codes match; confirm pairing', reject: 'Cancel pairing',
      startTunnel: 'Enable public access', stopTunnel: 'Stop public access', ready: 'Ready', stopped: 'Stopped', starting: 'Starting', stopping: 'Stopping', failed: 'Failed',
      introduction: 'Connect to another DSH, or let a phone or DSH connect here. Both sides must confirm pairing manually.',
      unavailable: 'Remote service is unavailable. Check that the backend is enabled on the Plugins page, then restart DSH if necessary.',
      noDevicesHint: 'Choose a connection direction first. After pairing, select the device in a DSH conversation to continue its sessions.',
      inbound: 'It can control this host', outbound: 'I can control it', noAccess: 'Not authorized', paired: 'Paired · not connected', connected: 'Connected', revoked: 'Revoked',
      revokeConfirm: 'Revoke this device and disconnect it? Using it again requires a new pairing.', name: 'Device name', back: 'Back',
      pairedAt: 'Paired at', advanced: 'Advanced diagnostics', cliHint: 'For further diagnosis, run this locally with the remote state directory of this profile.',
      copy: 'Copy device ID', copied: 'Copied', copyFailed: 'Could not copy. Please select and copy the text manually.',
      localOnly: 'This endpoint accepts connections on this computer only. Enable public access before generating a code for a phone or another computer.',
      caps: 'Capabilities granted to the other device', session: 'Sessions', stream: 'Streaming', approval: 'Human approvals', files: 'Files', terminal: 'Terminal', admin: 'Device administration',
      generate: 'Generate pairing code', regenerate: 'Pair another device', copyPair: 'Copy pairing information', expiry: 'Time remaining (seconds)', waitingPeer: 'Waiting for the other device to scan or import this code',
      sasHint: 'Compare the codes on both devices before confirming. Device names do not replace safety-code verification.',
      waiting: 'Confirmed here; waiting for the other device', expired: 'Pairing expired. Please generate a new code.', cancelled: 'Pairing was cancelled or disconnected.',
      pairingText: 'Pairing JSON', import: 'Import pairing file', startPair: 'Connect and compare safety codes', connecting: 'Establishing an encrypted connection…',
      tunnelIntro: 'The public tunnel forwards only the encrypted remote protocol, not the DSH management UI. Its address may change and stops working when the tunnel closes.',
      check: 'Check cloudflared', installed: 'cloudflared is available', missing: 'cloudflared is unavailable. Install it or configure its absolute path in the backend, then restart the plugin.',
      endpoint: 'Current endpoint', endpointHint: 'Enter a new endpoint only when the previous tunnel address expires. The pinned public key stays unchanged.',
      usage: 'After pairing, send this in a local DSH conversation:', prompt: 'Use remote-control to connect to device ', promptEnd: ' and list its sessions.',
      mobile: 'Use the separate DSH Remote Mobile app to scan or paste pairing information. The npm plugin does not install the mobile app; a signed app release is not yet distributed.',
      permissions: 'Files, terminal and device administration require explicit grants during pairing. File writes and commands still require individual human approval. Revoke and pair again to change grants.',
      direction: 'Each direction is authorized separately. Connecting to another DSH does not let it control this host.',
      invalid: 'Invalid pairing information. Paste the complete JSON.', busy: 'Another operation is running. Please wait.',
      unauthorized: 'Pairing was replaced, expired or the code did not match. Please verify again.', operationFailed: 'Operation failed. Check the connection or service and retry.',
      tunnelFailed: 'The public tunnel is not ready. Check cloudflared and your network.', done: 'Operation completed',
    }
    const css = `
      .dsh-remote{max-width:960px;margin:0 auto;padding:24px 16px;color:var(--dsw-alias-label-primary);font-size:14px;line-height:1.6}
      .dsh-remote *{box-sizing:border-box}.dsh-remote h2,.dsh-remote h3{margin:0 0 8px;font-weight:600}.dsh-remote p{margin:8px 0}
      .dsh-remote .muted{color:var(--dsw-alias-label-secondary)}.dsh-remote .row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
      .dsh-remote .spread{justify-content:space-between}.dsh-remote .card{border:1px solid var(--dsw-alias-border-l3,#8885);border-radius:14px;padding:18px;margin:14px 0}
      .dsh-remote .stack{display:grid;gap:12px}.dsh-remote .columns{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px}
      .dsh-remote input:not([type=checkbox]),.dsh-remote textarea{width:100%;color:inherit;background:transparent;border:1px solid var(--dsw-alias-border-l3,#8885);border-radius:8px;padding:9px;font:inherit}
      .dsh-remote textarea{min-height:110px;resize:vertical}.dsh-remote code{overflow-wrap:anywhere;font-size:12px}.dsh-remote label{display:block}
      .dsh-remote .badge{font-size:12px;padding:3px 9px;border:1px solid var(--dsw-alias-border-l3,#8885);border-radius:20px}
      .dsh-remote .empty{text-align:center;padding:32px 16px}.dsh-remote .qr{max-width:100%;width:280px;border-radius:12px;background:white}
      .dsh-remote .sas{font-size:32px;letter-spacing:8px;font-variant-numeric:tabular-nums;font-weight:600}.dsh-remote .notice{border-left:3px solid #5895c7;padding:8px 12px}
      .dsh-remote [role=alert]{border-left:3px solid #ce6868;padding:8px 12px}.dsh-remote [role=tablist]{margin-top:20px;border-bottom:1px solid var(--dsw-alias-border-l3,#8885);padding-bottom:8px}
      .dsh-remote button:focus-visible,.dsh-remote input:focus-visible,.dsh-remote textarea:focus-visible{outline:2px solid #5895c7;outline-offset:2px}
      .dsh-remote .danger{color:var(--dsw-alias-status-danger-label,#ce6868)}.dsh-remote .pair-grid{display:grid;grid-template-columns:280px minmax(0,1fr);gap:20px}
      @media(max-width:620px){.dsh-remote{padding:14px 8px}.dsh-remote .card{padding:14px}.dsh-remote .pair-grid{grid-template-columns:1fr}.dsh-remote .qr{width:240px}}
    `
    class Controller {
      constructor(ctx) {
        this.ctx = ctx
        this.listeners = new Set()
        this.state = { data: null, error: null, busy: false, message: null }
        this.source = { getSnapshot: () => this.state, subscribe: listener => {
          this.listeners.add(listener)
          if (this.listeners.size === 1) this.start()
          return () => { this.listeners.delete(listener); if (!this.listeners.size) this.stop() }
        } }
      }
      update(value) { this.state = { ...this.state, ...value }; for (const listener of this.listeners) listener() }
      async call(method, params, signal) {
        const result = await this.ctx.connection.rpc.call('/api', 'dsh-remote/manage', { method, params }, signal)
        if (!result.ok) throw Object.assign(new Error(result.error.message), { code: result.error.code })
        return result.value
      }
      accept(data) { if (!this.state.data || data.revision >= this.state.data.revision) this.update({ data }) }
      start() {
        this.stop()
        const abort = new AbortController()
        this.abort = abort
        const signal = abort.signal
        this.acceptReset = true
        this.loop = (async () => {
          while (!signal.aborted) {
            try {
              const data = await this.call(this.acceptReset ? 'status' : 'watch', this.acceptReset ? {} : { revision: this.state.data.revision }, signal)
              if (signal.aborted) return
              if (this.acceptReset) { this.update({ data, error: null }); this.acceptReset = false }
              else this.accept(data)
            } catch (error) {
              if (signal.aborted) return
              this.acceptReset = true
              this.update({ error: error.code ?? 'unavailable' })
              await new Promise(resolve => {
                const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve() }
                const timer = setTimeout(finish, 3000)
                signal.addEventListener('abort', finish, { once: true })
              })
            }
          }
        })()
      }
      stop() { this.abort?.abort() }
      async command(method, params = {}) {
        if (this.state.busy && !(method === 'tunnel.stop' && this.state.busy === 'tunnel.start')) return
        const action = this.action = (this.action ?? 0) + 1
        this.update({ busy: method, error: null, message: null })
        try {
          const result = await this.call(method, params)
          const data = await this.call('status', {})
          if (this.action !== action) return
          this.accept(data)
          this.update({ message: 'done', error: null })
          return result
        } catch (error) { if (this.action === action) this.update({ error: error.code ?? 'operationFailed' }) }
        finally { if (this.action === action) this.update({ busy: false }) }
      }
    }
    const button = (label, onClick, disabled = false, variant = 'outline') => h(Button, { onClick, disabled: Boolean(disabled), variant, size: 'sm' }, label)
    const capText = (caps, t) => caps?.length ? caps.map(cap => t(cap)).join(' / ') : t('noAccess')
    function Countdown({ exp, t }) {
      const [now, setNow] = React.useState(Date.now())
      React.useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer) }, [])
      const seconds = Math.max(0, Math.ceil((exp - now) / 1000))
      return h('p', { className: 'muted', role: 'timer' }, seconds ? `${t('expiry')}：${seconds}` : t('expired'))
    }
    function Device({ device, t, command, busy, copy }) {
      const [editing, setEditing] = React.useState(false)
      const [name, setName] = React.useState(device.name)
      const [revoke, setRevoke] = React.useState(false)
      const [endpoint, setEndpoint] = React.useState('')
      return h('article', { className: 'card' },
        h('div', { className: 'row spread' }, h('strong', null, device.name), h('span', { className: 'badge' }, t(device.revokedAt ? 'revoked' : device.inbound || device.outbound ? 'connected' : 'paired'))),
        h('code', null, device.deviceId),
        h('p', { className: 'muted' }, t('pairedAt'), '：', new Date(device.pairedAt).toLocaleString()),
        h('div', { className: 'columns' }, h('p', null, t('outbound'), '：', capText(device.remoteCaps, t)), h('p', null, t('inbound'), '：', capText(device.caps, t))),
        editing ? h('form', { className: 'stack', onSubmit: async event => { event.preventDefault(); if (await command('device.rename', { deviceId: device.deviceId, name })) setEditing(false) } },
          h('label', null, t('name'), h('input', { value: name, onChange: event => setName(event.target.value), maxLength: 80, required: true, autoFocus: true })),
          h('div', { className: 'row' }, h(Button, { type: 'submit', disabled: busy || !name.trim(), variant: 'primary', size: 'sm' }, t('save')), button(t('cancel'), () => setEditing(false)))) :
          h('div', { className: 'row' }, button(t('copy'), () => copy(device.deviceId)), !device.revokedAt && button(t('rename'), () => setEditing(true)), !device.revokedAt && button(t('revoke'), () => setRevoke(true))),
        !device.revokedAt && device.remoteCaps?.length > 0 && h('div', { className: 'stack', style: { marginTop: 12 } },
          !device.outbound && h('label', { className: 'muted' }, t('endpointHint'), h('input', { value: endpoint, placeholder: device.endpoint ?? 'wss://…/remote/ws', onChange: event => setEndpoint(event.target.value), maxLength: 2048 })),
          h('div', null, button(t(device.outbound ? 'disconnect' : 'connect'), () => command(device.outbound ? 'device.disconnect' : 'device.connect', { deviceId: device.deviceId, ...(endpoint.trim() ? { endpoint: endpoint.trim() } : {}) }), busy))),
        revoke && h('div', { className: 'notice', role: 'alertdialog', 'aria-label': t('revoke') }, h('p', null, t('revokeConfirm')), h('div', { className: 'row' },
          button(t('revoke'), async () => { if (await command('device.revoke', { deviceId: device.deviceId })) setRevoke(false) }, busy), button(t('cancel'), () => setRevoke(false), busy))))
    }
    function Incoming({ data, t, command, busy, copy, network }) {
      const [caps, setCaps] = React.useState(['session', 'stream', 'approval'])
      const pair = data.incoming
      const pending = pair && ['open', 'claimed', 'confirming'].includes(pair.state)
      const ended = pair && ['expired', 'cancelled'].includes(pair.state)
      return h('section', { className: 'card stack', 'aria-label': t('incoming') }, h('h3', null, t('incoming')),
        data.tunnel.state !== 'ready' && h('div', { className: 'notice' }, h('p', null, t('localOnly')), button(t('network'), network)),
        ended && h('p', { role: 'status' }, t(pair.state)),
        (!pair || ended) && h(React.Fragment, null, h('p', null, t('caps')), h('div', { className: 'row' }, ['session', 'stream', 'approval', 'files', 'terminal', 'admin'].map(cap => h('label', { key: cap },
          h('input', { type: 'checkbox', checked: caps.includes(cap), onChange: event => setCaps(event.target.checked ? [...caps, cap] : caps.filter(value => value !== cap)) }), ' ', t(cap)))),
          button(t('generate'), () => command('pair.begin', { caps }), busy || !caps.length, 'primary')),
        pair?.state === 'consumed' && h('div', { role: 'status' }, h('strong', null, t('success')), h('p', null, pair.peer?.name), button(t('regenerate'), () => command('pair.begin', { caps }), busy)),
        pending && h(React.Fragment, null, h(Countdown, { exp: pair.exp, t }), h('div', { className: 'pair-grid' },
          pair.image && h('img', { className: 'qr', src: pair.image, alt: t('copyPair') }),
          h('div', { className: 'stack' }, h('p', null, t('waitingPeer')), h('p', null, capText(pair.caps, t)),
            pair.qr && button(t('copyPair'), () => copy(JSON.stringify(pair.qr))),
            pair.state === 'confirming' && h('div', null, h('strong', null, pair.peer?.name), h('p', { className: 'muted' }, pair.peer?.deviceId), h('p', null, t('sas')), h('div', { className: 'sas', 'aria-label': t('sas') }, pair.sas), h('p', null, t('sasHint')),
              pair.localConfirmed ? h('p', { role: 'status' }, t('waiting')) : button(t('confirm'), () => command('pair.confirm', { sid: pair.sid, sas: pair.sas }), busy, 'primary')),
            button(t('reject'), () => command('pair.cancel', { sid: pair.sid }), busy)))))
    }
    function Outgoing({ data, t, command, busy }) {
      const [raw, setRaw] = React.useState('')
      const [error, setError] = React.useState('')
      const [another, setAnother] = React.useState(false)
      const pair = data.outgoing
      const pending = pair && ['connecting', 'confirming', 'waiting'].includes(pair.state)
      const submit = async event => {
        event.preventDefault(); setError('')
        let qr
        try { qr = JSON.parse(raw) } catch { setError(t('invalid')); return }
        if (await command('pair.connect', { qr })) { setRaw(''); setAnother(false) }
      }
      return h('section', { className: 'card stack', 'aria-label': t('outgoing') }, h('h3', null, t('outgoing')), h('p', { className: 'muted' }, t('direction')),
        !pending && (pair?.state !== 'paired' || another) && h('form', { className: 'stack', onSubmit: submit }, h('label', null, t('pairingText'), h('textarea', { value: raw, maxLength: 8192, onChange: event => setRaw(event.target.value), required: true, spellCheck: false })),
          h('label', null, t('import'), h('input', { type: 'file', accept: '.json,application/json', onChange: async event => {
            const file = event.target.files[0]
            if (!file) return
            if (file.size > 8192) { setError(t('invalid')); return }
            try { setRaw(await file.text()) } catch { setError(t('invalid')) }
          } })), h('div', null, h(Button, { type: 'submit', variant: 'primary', size: 'sm', disabled: busy || !raw.trim() }, t('startPair')))),
        error && h('p', { role: 'alert' }, error),
        pair && h('div', null, h('strong', null, pair.name), pair.deviceId && h('p', null, h('code', null, pair.deviceId)), h('p', null, t('outbound'), '：', capText(pair.caps, t)), pending && h(Countdown, { exp: pair.exp, t }),
          pair.state === 'connecting' && h('p', { role: 'status' }, t('connecting')),
          pair.state === 'confirming' && h(React.Fragment, null, h('p', null, t('sas')), h('div', { className: 'sas', 'aria-label': t('sas') }, pair.sas), h('p', null, t('sasHint')), button(t('confirm'), () => command('pair.accept', { id: pair.id, sas: pair.sas }), busy, 'primary')),
          pair.state === 'waiting' && h('p', { role: 'status' }, t('waiting')),
          pair.state === 'paired' && h('div', { className: 'stack' }, h('p', { role: 'status' }, t('success')), h('p', null, t('usage')), h('code', null, `${t('prompt')}${pair.deviceId}${t('promptEnd')}`), !another && button(t('outgoing'), () => setAnother(true))),
          ['failed', 'expired', 'cancelled'].includes(pair.state) && h('p', { role: 'alert' }, t(pair.state === 'failed' ? 'operationFailed' : pair.state)),
          pending && button(t('reject'), () => command('pair.disconnect', { id: pair.id }), busy)))
    }
    function Panel({ useManagement, command, retry, t }) {
      const state = useManagement(value => value)
      const [tab, setTab] = React.useState('devices')
      const [mode, setMode] = React.useState(null)
      const [notice, setNotice] = React.useState('')
      const [installed, setInstalled] = React.useState(null)
      const data = state.data
      const copy = async value => { try { await navigator.clipboard.writeText(value); setNotice(t('copied')) } catch { setNotice(t('copyFailed')) } }
      const errorKey = state.error === 'busy' ? 'busy' : state.error === 'unauthorized' ? 'unauthorized' : state.error?.startsWith('tunnel/') ? 'tunnelFailed' : 'operationFailed'
      return h('div', { className: 'dsh-remote' }, h('style', null, css),
        h('div', { className: 'row spread' }, h('h2', null, t('title')), data && !state.error && h('span', { className: 'badge' }, t('running'))),
        h('p', { className: 'muted' }, t('introduction')),
        state.error && h('div', { role: 'alert' }, t(data ? errorKey : 'unavailable'), ' ', button(t('retry'), retry, state.busy)),
        notice && h('p', { role: 'status' }, notice),
        !data ? h('p', { role: 'status' }, t('loading')) : h(React.Fragment, null,
          h('div', { className: 'card' }, h('strong', null, data.name), h('p', null, h('code', null, data.deviceId)), button(t('copy'), () => copy(data.deviceId)), h('div', { className: 'row' },
            button(t('outgoing'), () => { setTab('devices'); setMode('outgoing') }, state.busy, 'primary'), button(t('incoming'), () => { setTab('devices'); setMode('incoming') }, state.busy))),
          h('div', { className: 'row', role: 'tablist', 'aria-label': t('title'), onKeyDown: event => {
            const tabs = ['devices', 'network', 'help']
            const key = event.key
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(key)) return
            event.preventDefault()
            const index = key === 'Home' ? 0 : key === 'End' ? 2 : (tabs.indexOf(tab) + (key === 'ArrowRight' ? 1 : 2)) % 3
            setTab(tabs[index]); event.currentTarget.querySelectorAll('[role=tab]')[index].focus()
          } }, ['devices', 'network', 'help'].map(value => h(Button, { key: value, role: 'tab', tabIndex: tab === value ? 0 : -1, id: `remote-tab-${value}`, 'aria-controls': `remote-panel-${value}`, 'aria-selected': tab === value, variant: tab === value ? 'outline' : 'ghost', size: 'sm', onClick: () => setTab(value) }, t(value)))),
          h('section', { role: 'tabpanel', id: `remote-panel-${tab}`, 'aria-labelledby': `remote-tab-${tab}` },
            tab === 'devices' && h(React.Fragment, null,
              mode && button(t('back'), () => setMode(null)),
              mode === 'incoming' && h(Incoming, { data, t, command, busy: state.busy, copy, network: () => setTab('network') }),
              mode === 'outgoing' && h(Outgoing, { data, t, command, busy: state.busy }),
              data.devices.length ? data.devices.map(device => h(Device, { key: device.deviceId, device, t, command, busy: state.busy, copy })) : h('div', { className: 'card empty' }, h('h3', null, t('noDevices')), h('p', { className: 'muted' }, t('noDevicesHint')))),
            tab === 'network' && h('div', { className: 'card stack' }, h('h3', null, t('network')), h('p', null, t('tunnelIntro')), h('span', null, t(data.tunnel.state)),
              data.tunnel.endpoint && h('code', null, data.tunnel.endpoint),
              h('div', { className: 'row' }, button(t('check'), async () => { const result = await command('tunnel.check'); if (result) setInstalled(result.available) }, state.busy),
                ['stopped', 'failed'].includes(data.tunnel.state) ? button(t('startTunnel'), () => command('tunnel.start'), state.busy, 'primary') : button(t('stopTunnel'), () => command('tunnel.stop'), data.tunnel.state === 'stopping')),
              installed !== null && h('p', { role: 'status' }, t(installed ? 'installed' : 'missing'))),
            tab === 'help' && h('div', { className: 'card stack' }, h('h3', null, t('help')), h('p', null, t('usage')), h('code', null, `${t('prompt')}<deviceId>${t('promptEnd')}`), h('p', null, t('mobile')), h('p', null, t('permissions')), h('p', null, t('direction')),
              h('details', null, h('summary', null, t('advanced')), h('p', null, t('cliHint')), h('code', null, 'dsh-remote status --state <profile/remote>'), h('p', null, h('code', null, data.endpoint)))))))
    }
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'remote UI: dictionaries')
      const controller = new Controller(ctx)
      ctx.effect(() => () => controller.stop(), 'remote UI: observer lifetime')
      const inject = () => ({ hooks: { management: controller.source }, command: (method, params) => controller.command(method, params), retry: () => controller.start() })
      ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({ name: 'plugins.bundle.config', key: BUNDLE, locale: NS, inject }, Panel))
      ctx.slots.inject('plugins.bundle.activation', () => ctx.slots.register({ name: 'plugins.bundle.activation', key: BUNDLE, locale: NS },
        ({ t, onDismiss, onOpenDetails }) => h('div', { className: 'dsh-remote' }, h('h3', null, t('welcome')), h('p', null, t('introduction')), button(t('open'), onOpenDetails), button(t('dismiss'), onDismiss))))
      ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({ name: 'sidebar.footer.action', id: 'remote-everywhere', locale: NS,
        inject: () => ({ open: () => ctx.pluginNavigation.openBundle(BUNDLE) }) }, ({ t, open, wide }) => h(Button, { onClick: open, title: t('title'), 'aria-label': t('title'), size: 'sm' }, wide ? t('title') : '↔')))
    }
    return { inject: ['slots', 'locale', 'connection', 'pluginNavigation'], apply }
  },
})
