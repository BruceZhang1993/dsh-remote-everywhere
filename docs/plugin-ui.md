# 插件 UI 首版：使用与验收

当前候选面向 **DSH Desktop 0.2.1-rc.2**，对应本机 `/usr/lib/deepseek-harness-desktop`。本地候选版本为 **0.2.0-rc.4**，尚未发布。已发布的 `0.2.0-rc.3` 面向旧基线 `0.2.1-alpha.2`；`0.1.0` 不含此界面。

## 从哪里进入

安装并启用主插件后，打开侧栏 **远程设备**，或进入 **插件 → DSH Remote Everywhere** 的详情页。首次启用还会显示“打开远程管理”。主插件自动依赖 UI 伴生包，无需再装一个独立应用。

页面包括本机身份、设备、公网访问和使用帮助。后台不可用时显示重试与启用检查提示。界面使用宿主主题与语言；关闭页面只停止状态观察，不会停止连接或隧道。

## 配对和使用

1. 在被连接的一端选择“让其他设备连接本机”。跨电脑或手机连接前，先在“公网访问”开启隧道并等待“已就绪”。默认 loopback 地址只允许本机连接。
2. 选择授予对端的权限并生成配对码。二维码/JSON 有效期最多 180 秒，可随时取消。
3. 在另一端选择“连接其他 DSH”，粘贴完整配对 JSON 或导入 JSON 文件。手机使用独立 DSH Remote Mobile App；npm 插件不安装手机 App，正式签名 APK 通过 GitHub Releases 单独分发，版本尚未出现时需等待发布；见[安装指引](install.md)。
4. 人工比较两端六位安全码，双方分别确认。单端确认后显示“等待另一端确认”，双方成功后才保存信任。
5. 在本机 DSH 对话中发送：`请使用 remote-control，连接设备 <deviceId>，列出它的会话。` 成功页和“使用帮助”提供同样的指引。此版本提供管理 UI，完整远程聊天界面留待下一阶段。

两个方向分别授权。设备卡片分别显示“我能控制它”和“它能控制本机”。默认授权会话、流式输出和人工审批；文件、终端、设备管理需另行选择，写文件与执行命令仍需逐次人工审批。修改权限请吊销后重新配对。

“已配对 · 未连接”表示保留信任；“已连接”来自当前真实连接。可改名、连接、断开及吊销，吊销需再次确认并立即断开连接。旧地址失效后，可填写新端点再连接：握手仍校验原公钥，成功后才保存地址；更新地址前须断开现有出站连接。

## 公网访问

“检测 cloudflared”只检查可执行文件，不安装系统软件。若未找到，先由本机维护者安装，或在 profile 的 `cordis.patch.yml` 配置绝对路径并重启插件：

```yaml
- id: remote-everywhere
  config:
    cloudflared: /absolute/path/to/cloudflared
```

隧道只公开专用远程协议监听器，不公开宿主管理界面。“已就绪”要求公网 HTTP 健康检查和 WebSocket upgrade 都成功。启动中可停止；隧道状态改变会取消未完成配对，需重新生成二维码。停止隧道不会撤销已保存的设备信任。

## 本地候选安装

候选包含 protocol、core、tunnel、cli、ui、everywhere 六包。GitHub scoped 候选目录为 `.cache/github-packages-0.2.0-dev.0`；普通候选为 `.cache/release-0.2.0-dev.0`。仅是本地产物，不代表注册表已经存在该版本。

在仓库中生成并验证候选（整个命令树限额 8 GiB 内存、4 GiB swap）：

```bash
systemd-run --user --scope --collect --same-dir -p MemoryMax=8G -p MemorySwapMax=4G -- bash -lc \
  'pnpm check && pnpm test && pnpm test:release-candidate --github-packages BruceZhang1993/dsh-remote-everywhere'
```

手动安装时，在独立的 Desktop 测试 profile 内同时安装 manifest 列出的六个 tarball，禁用安装脚本。保留同版宿主的原有 bundle 配置，追加 `@brucezhang1993/dsh-remote-everywhere` 到 `dsh.profile.bundles`；普通未 scoped 候选使用 `dsh-remote-everywhere`。不要从源码目录复制文件到系统安装目录。

升级现用 profile 前备份其配置和锁文件，保留原 `remote` 状态目录中的 `identity.key`、`devices.json`。本次不改变身份或设备表格式；停止候选、恢复旧配置/锁文件与旧包即可回滚。跨宿主版本的现用 profile 升级、其他系统和真实手机验收仍需单独进行。

## 可复现 UI 检查

`tools/ui-smoke.mjs` 使用 Playwright 和隔离 profile。`DSH_HOST_MODULE_ROOT` 指向同版宿主的 `node_modules`，`DSH_PLAYWRIGHT` 可指定现有 Playwright 模块入口；默认导入 `playwright`，Chrome 默认 `/usr/bin/google-chrome-stable`。

```bash
systemd-run --user --scope --collect --same-dir -p MemoryMax=8G -p MemorySwapMax=4G -- bash -lc \
  'DSH_HOST_MODULE_ROOT=/path/to/dsh/node_modules node tools/ui-smoke.mjs'
```

添加 `--desktop` 使用本机系统 Electron，独立 `DSH_HOME` 和 Electron 用户目录；不改现用 profile。可用 `DSH_ELECTRON` 指定同版本桌面二进制。桌面测试仅传入明显的合成凭据满足首次欢迎页检查，不调用模型或读取真实凭据。

完整打包消费者 UI 检查使用 `DSH_UI_SMOKE=1 DSH_UI_DESKTOP=1` 运行上面的候选测试命令，并配置 `DSH_PLAYWRIGHT`。它先执行既有双宿主会话回归，再从临时消费者安装目录验证 Web 与系统 Desktop UI，不借用源码 UI 包。测试退出会清理 profile 和子进程。

另设 `DSH_UI_PUBLIC=1 DSH_UI_CLOUDFLARED=/absolute/path/to/cloudflared` 可验证真实公网启停、旧二维码失效及公网管理路由返回 404。该检查需要可用外网；额外探测使用 `curl` 遵循本机代理环境。

实现边界及验收记录见仓库的 `docs/plugin-ui-plan.md`。正式发布仍受既有来源、审批 SHA、注册表完整性及环境审批门禁约束；本地验证不会发布、晋级或安装到用户现用 profile。
