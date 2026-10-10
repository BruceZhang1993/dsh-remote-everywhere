# 架构设计 — DSH Remote Everywhere

> 本文档描述组件划分、与 DSH 的集成缝隙、会话能力映射、仓库结构。
> 协议细节见 [protocol.md](protocol.md)，安全模型见 [security.md](security.md)。

---

## 1. 总体形态

**一个进程、一套协议、三种客户端。**

被控端不是一个独立服务进程，而是**运行在 DSH 宿主进程内的 in-process Cordis 插件**。这是
最重要的架构决定，理由见 §4。

```
┌─ 被控端 DSH 宿主进程 ───────────────────────────────────────────────┐
│                                                                     │
│  dsh-remote-everywhere (host half, Cordis plugin)                   │
│                                                                     │
│   ├─ ctx.sessionController ──► 真实会话：list/create/prompt/cancel   │
│   │                            follow()/control() 流                │
│   ├─ ctx.on('session/event') ─► 持久事件（turn/step/tool/assistant） │
│   ├─ ctx.on('agent/assistant-stream') ─► 文本增量                    │
│   ├─ ctx.on('agent/status') ──► idle/running                        │
│   ├─ ctx.on('approval/request', …) ─► 审批代理（保留宿主审计）        │
│   ├─ ctx.on('user-questions/request', …) ─► 交互式提问代理            │
│   ├─ RemoteServer ──► 127.0.0.1:PORT  自有 HTTP/WSS 端点             │
│   │                   register(prefix '/remote')                     │
│   │                   registerUpgrade('/remote/ws')                  │
│   └─ TunnelManager ──► cloudflared quick tunnel ⇒ wss://…trycloudflare.com
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
                    ▲                        ▲
                    │ Noise_XX E2E (内层)     │  局域网直连（零隧道）
                    │                        │
        ┌───────────┴──────────┐   ┌─────────┴──────────┐
        │ 控制端 DSH 实例       │   │ Flutter App         │
        │ (controller half)     │   │ (Android / iOS)     │
        │  MCP 工具 remote_*    │   │  Dart 协议实现       │
        │  + bundled skill      │   │  局域网/公网均可      │
        └──────────────────────┘   └────────────────────┘
```

关键点：**控制端 DSH 与 Flutter App 使用完全相同的线上协议**。Flutter 不需要理解 DSH 内部的
Typert 声明合并机制，只需要实现 [protocol.md](protocol.md)。

---

## 2. 与 DSH 的集成缝隙（seams）

全部基于已核实的源码事实（编号对应 [roadmap.md](roadmap.md) §2 的 F1–F12）。

### 2.1 会话驱动

| 需求 | 使用的缝隙 |
|---|---|
| 列出会话 | `ctx.sessionController.list({}, signal)` → `SessionListValue { items: SessionSummary[] }` |
| 新建 / 复用会话 | `ctx.sessionController.create({ workspaceId?, cwd?, sessionId?, agentPreset? })` |
| 提交提示 | `ctx.sessionController.prompt({ requestId, sessionId, mode: 'queue'\|'steer', content }, signal)` |
| 取消 | `ctx.sessionController.cancel({ sessionId })` |
| 队列编辑 / steer | `ctx.sessionController.updateQueue({ sessionId, itemId, action: { kind } })` |
| 单次拉取流 | `ctx.sessionController.follow({ address, maxMessages?, assistantStream?: true }, signal)` → `AsyncIterable<SessionFollowFrame>` |
| 进程级控制流 | `ctx.sessionController.control(signal)` → 基线 / jobs / projection |

`requestId` 是幂等键：宿主本身按 `rpcId` 去重，重复提交返回原受理结果而不重复入队。因此
**远端重试是安全的**，我们的协议只需透传一个稳定的 `requestId`。

### 2.2 事件观察

| 层次 | 缝隙 | 用途 |
|---|---|---|
| 持久事件 | `ctx.on('session/event', (session, event) => …)` | turn/step/tool/assistant 落盘事件，最终一致的事实来源 |
| 文本增量 | `ctx.on('agent/assistant-stream', ({agent, frame}) => …)` | 打字机效果，进程内、非持久 |
| 状态 | `ctx.on('agent/status', ({agent, status}) => …)` | idle / running |
| 空闲等待 | `agent.whenIdle()` | 需要"跑完再回话"的场景 |
| 工具流水线 | `tools/pre-execute` / `tools/execute` / `tools/post-execute` / `tools/result` | 只读观察（**不用于**拦截，拦截走审批缝） |
| 子代理 | `subagent.started` 语义可用 `session/created` + `parentSessionId` 推导 | 子代理树 |

### 2.3 审批代理（本项目的核心交互）

```ts
// 概念示意，非最终实现
ctx.on('approval/request', async (req, next) => {
  // req: { agent, toolName, callId?, reason?, signal? }
  if (!ownsAgent(req.agent)) return next()          // 不是我们负责的 agent，交回原链
  if (!hasActiveAuthorizedClient()) return next()   // 没有远端在听，落回本机审批
  const outcome = await askRemoteAndLocal(req)      // 本机 UI 与远端竞速，先到先得
  return outcome                                    // 'allowed-once' | 'rejected' | 'cancelled'
})
```

- 返回值必须是四值词汇之一；抛异常或返回非词汇值会被规范化成 `'unavailable'`（fail-closed）。
- `'never'` 策略在 answerer **之前**短路，插件无权旁路 —— 这是我们要保留的安全语义。
- 审计（`approval/asked` / `approval/decided`）仍由宿主写入被控端会话，远端审批不产生"无记录"
  的授权。

### 2.4 传输

| 项 | 决定 | 理由 |
|---|---|---|
| 端点 | 自有 HTTP 监听 `127.0.0.1:PORT`（默认 loopback） | `host/webserver` 只允许 `127.0.0.1` 或 `0.0.0.0`，且**自身无 TLS、无认证、无 origin 策略**；绝不能把 DSH GUI 暴露到公网 |
| 升级路由 | `webServer.registerUpgrade({ path: '/remote/ws', handler })` | 追加式注册，与 DSH 的 `/api/remote.mux` 不冲突 |
| 隧道 | `cloudflared tunnel --url http://127.0.0.1:PORT` | 零账号、WebSocket 官方支持；URL 是**临时数据**，随二维码下发，不入持久配置 |
| 内层加密 | Noise_XX_25519_ChaChaPoly_BLAKE2s | 隧道/中继只看到密文 |

> 当以 DSH Desktop（Electron）形态运行时，宿主使用 `os.homedir()` 下的 profile；插件不应假设
> 一定存在 Web GUI 的 webServer（headless profile 可能没有），因此**默认自起监听**，把
> `webServer` 仅作为"复用已有端口"的可选路径。

### 2.5 交付与依赖

- npm 包声明 `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`，patch 插入一行入口。
- 安装：`dsh plugin --profile <name> add <package>`（或 Plugin Manager 的 `install_bundle`）。
- **宿主服务声明为 `peerDependencies`**（`@deepseek-ai/cordis`、`@deepseek-ai/dsh-session`、
  `@deepseek-ai/dsh-api-session-controller`、`@deepseek-ai/dsh-user-approval`、
  `@deepseek-ai/dsh-host-webserver` 等），以命中宿主那一份实例。
- **自带第二份 core 是不允许的**（F8）。
- cloudflared 预编译二进制作为 `files` 内资产分发（F10），避免 install script 触发审批流。

---

## 3. 会话能力映射（"完整会话"的验收清单）

| # | 宿主概念 | 远端能力 | 协议方法 | 备注 |
|---|---|---|---|---|
| C1 | 会话列表 / 搜索 | ✅ | `session.list` / `session.search` | 冷会话只读，不激活 Agent |
| C2 | 新建 / 恢复 / fork / 重命名 | ✅ | `session.create` / `session.fork` / `session.rename` | fork 以完成的 turn 为锚 |
| C3 | 提交提示（文本 / 图片 / 文件引用） | ✅ | `session.prompt` | 透传稳定 `requestId` 保证幂等 |
| C4 | 队列编辑 / steer / 取消 | ✅ | `session.queue.update` / `session.cancel` | |
| C5 | 流式 assistant 输出 | ✅ | `stream.open { assistantStream: true }` | delta 语义 `replace/prepend/append/settle-assistant` |
| C6 | 工具调用与结果 | ✅ | 同 C5 的事件流 | `tool/call` / `tool/result` |
| C7 | turn / step 边界、运行状态 | ✅ | 事件流 + `session.control` 订阅 | `turn/start|end`、`step/start|end`、`agent/status` |
| C8 | 审批交互 | ✅ 双向 | `approval.request` / `approval.decide` / `approval.pending` | 本机与远端竞速，绝不静默放行 |
| C9 | 交互式提问 | ✅ | `question.request` / `question.answer` | `user-questions/request` 缝 |
| C10 | 文件读写 | ✅ 带审批 + 路径围栏 | `files.read` / `files.write` / `files.list` | 默认受宿主 workspace 边界约束 |
| C11 | 终端直通 | ✅ 默认每次审批 | `terminal.exec` | 不设"全权代批"默认值 |
| C12 | 子代理 | ✅ | 事件流中的子会话地址 `{kind:'subagent'}` | |
| C13 | 工作区切换 | ✅ | `workspace.list` / `session.create { cwd }` | |
| C14 | 会话历史分页 / 代码 diff | ✅ | `history.page` / `history.throughSeq` | 复用 `loadOlder`/`loadThrough` 语义 |

### 3.1 角色约束：手机只做控制端

**产品决策（2026-10-10）**：移动端 App **只做控制端**，被控端仅限 DSH 实例。

| 对端 | 可做控制端 | 可做被控端 |
|---|---|---|
| DSH 实例 | ✅ | ✅（由部署配置决定） |
| 移动端 App（Android/iOS） | ✅ | ❌ **禁止** |

理由与强制方式见 [security.md](security.md) §5.4（T18）：手机丢失的风险特征与桌面机不同，
一部失窃手机不应等于交出桌面会话。协议在 `hello` 阶段校验 `role`，被控端拒绝声明为
`controlled` 的对端（[protocol.md](protocol.md) §4.2）。

对架构的影响：`packages/dsh-plugin` 的 host half 同时实现两种角色；移动端只实现 controller
侧，因此 Dart 代码库**不需要**实现设备表、审批代理、文件写入围栏等服务端能力 —— 这实质减少了
M3 的工作面与攻击面。

---

## 4. 关键架构决策及理由

### D1：in-process Cordis 插件，而非 SDK 子进程

| 维度 | in-process 插件 | SDK 子进程 |
|---|---|---|
| 看到宿主真实会话 | ✅ | ❌（只能看到自己的运行时） |
| 列出 / 搜索会话 | ✅ | ❌ |
| 文本增量与工具调用实时性 | ✅ `follow` + `assistant-stream` | ⚠️ 仅持久 `session.event`，无 delta |
| 响应审批 | ✅ | ❌ **完全没有审批通道** |
| cancel / steer | ✅ | ❌ |
| 耦合 | 需解析宿主单例服务 + peer deps | 独立进程但版本锁死（client 与 `@deepseek-ai/dsh` 必须完全同版本） |

结论：SDK 子进程是"创建隔离运行时"的工具，不是"暴露宿主"的工具。**明确排除。**

### D2：自有传输，而非复用 `/api`

`connection.rpc.intercept` 每通道单拦截器，核心已占用 `/api`；`registerRemoteEvents` 也被
`api-remotes` 独占。因此插件走自己的 `/remote` + `/remote/ws`，并自行实现配对鉴权。
副作用（正面的）：协议对外完全自持，Flutter 端无需理解 Typert 的生成产物，只需实现
[protocol.md](protocol.md)。

### D3：协议以 DSH 事件词汇为中心，而非自定义一套

线上帧包裹的是 DSH 自己的 `SessionWireEvent`（`{type, seq, time, data, …}`）。好处：

- 复用宿主已验证的 live-follow 语义与重连补页机制（F6），不必自创易错的重连逻辑；
- 未来宿主新增事件类型时，插件作为**转发者**天然兼容，不需要同步升级；
- 未知事件可按 `ignorable` 语义跳过而不破坏连接。

### D4：隧道 URL 是临时会话数据，不是配置

Quick Tunnel 每次启动域名都变。因此架构上把它建模为**随二维码一次性下发的会话数据**，
不写入任何持久配置。这避免了"配置里存着一个失效 URL"这类必然出现的困惑。

### D5：协议单一事实源

`packages/protocol` 是唯一权威定义（JSON Schema + 生成的 TS/Dart 类型）。两端类型由生成器
产出，避免手写漂移。

---

## 5. 仓库结构

```
dsh-remote-everywhere/
├─ docs/                        设计文档（本目录）
├─ spikes/                      M0 验证 spike（保留证据，可提升为正式代码）
│  ├─ flutter-android/          Flutter Android 构建门禁
│  ├─ tunnel/                   cloudflared 传输验证
│  └─ noise-interop/            Noise 跨语言互操作
├─ packages/
│  ├─ protocol/                 @dsh-remote/protocol     帧 / 方法 / JSON Schema（单一事实源）
│  ├─ core/                     @dsh-remote/core         握手、加密、分帧、重连、seq 窗口
│  ├─ tunnel/                   @dsh-remote/tunnel       cloudflared 生命周期与 URL 解析
│  ├─ dsh-plugin/               dsh-remote-everywhere    control + controlled 双半
│  ├─ cli/                      @dsh-remote/cli          配对二维码、自检、协议收发工具
│  └─ relay/                    @dsh-remote/relay        （可选）自建中继
├─ apps/
│  └─ mobile/                   Flutter（Android + iOS 同一份代码）
└─ tools/
   └─ gen-dart/                 从 JSON Schema 生成 Dart 类型，防两端漂移
```

设计约束：`packages/{protocol,core,tunnel}` **不得** import 任何 `@deepseek-ai/*` 宿主包。
它们必须是可用于 CLI、测试与移动端参考实现的独立库。只有 `packages/dsh-plugin` 依赖宿主。
这条约束让核心逻辑能在没有 DSH 的环境下被完整测试。

---

## 6. 数据流（一次远端提问的完整路径）

```
Flutter/控制端               被控端插件                    DSH 宿主
    │                            │                            │
    │── session.prompt ─────────►│                            │
    │   {requestId, text}        │── sessionController.prompt ►│
    │                            │                            │ 入队（按 requestId 去重）
    │◄─ rpc.result {accepted} ───│◄─ {accepted:true} ─────────│
    │                            │                            │
    │                            │◄─ session/event turn/start ─│
    │◄─ stream.open 基线 ────────│                            │
    │◄─ stream.event append ─────│◄─ session/event tool/call ──│
    │◄─ stream.delta ────────────│◄─ agent/assistant-stream ───│
    │                            │                            │
    │                            │◄─ approval/request ─────────│
    │◄─ approval.request ────────│   （本机 UI 同时呈现）       │
    │── approval.decide ────────►│── return 'allowed-once' ───►│ 审计写入会话
    │                            │                            │
    │◄─ stream.event append ─────│◄─ session/event tool/result─│
    │◄─ stream.event turn/end ───│◄─ session/event turn/end ───│
```

断线重连时：客户端用最后确认的 `seq` 作为 `sinceSeq` 重新 `stream.open`，服务端回基线 +
缺失区间（复用宿主 gap 修复语义），客户端按 `seq` 去重合并。
