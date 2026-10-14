# 项目路线图 — DSH Remote Everywhere

> 本文档是项目的权威进度与计划来源。状态随里程碑推进更新。
> 最后更新：2026-10-13（M3 开发实现复核通过，平台验收延期；M4 首批安全加固已开始）

---

## 1. 目标

一个 DSH 插件，同时具备**控制端**与**被控端**能力：

1. **控制端**：本 DSH 实例可以连接其他已安装并启用该插件的 DSH 实例，驱动其真实会话。
2. **被控端**：本 DSH 实例接受其他 DSH 实例或手机 App 的连接，暴露自身完整会话能力。
3. **移动端**：Android + iOS 原生 App（Flutter 单代码库），可配对并操控任意开启该能力的被控端。
4. **公网可达**：被控端支持免费、零账号、一键开启的隧道服务，无需手动配置端口转发或 VPN。
5. **完整会话能力**：对标 Codex remote access —— 实时对话、流式输出、工具调用、审批交互、
   文件读写、终端、子代理、多会话管理。
6. **安全性优先**：端到端加密、设备级密钥与授权、可吊销、审批双向且不静默放行。

**明确的非目标**（至少到 v1.0）：

- 不做账号体系、不做云端中继服务运营、不做遥测。
- 不把长期密钥交给隧道/中继方。
- 不做"手机作为被控端"（手机只做控制端）。
- 不替代 DSH 自带的 Web GUI，也不修改 DSH 核心。

---

## 2. 已核实的技术前提

以下事实在 M0 阶段通过直接阅读 DSH 源码 / 本机实测确认，是路线图的地基。**任何一条被推翻
都要重新评估对应里程碑。**

| # | 事实 | 证据 |
|---|---|---|
| F1 | 插件可在宿主进程内注册自有 WebSocket 升级路由 | `ctx.webServer.registerUpgrade({path, handler})`，DSH 源码 `packages/host/webserver/src/index.ts:51`；DSH 自身 API Gateway 即以此挂载远程流 `packages/api/gateway/src/index.ts:223` |
| F2 | 宿主会话能力是现成服务，无需黑盒驱动 | `ctx.sessionController`：`list`/`create`/`prompt`/`cancel`/`updateQueue`/`follow`/`control`，`packages/api/session-controller/README.md` |
| F3 | 审批是瀑布事件，插件可插入并代理 | answerer = `approval/request` waterfall listener，返回 `'allowed-once' \| 'rejected' \| 'cancelled' \| 'unavailable'`；审计落在被控端会话（`approval/asked`/`approval/decided`），`packages/interaction/user-approval/README.md` |
| F4 | 已有"通过外部传输代理宿主会话与审批"的官方先例 | `packages/acp/acp/src/index.ts:155`：`ctx.on('approval/request', (request, next) => …)` 过滤 ownership 后转发给外部客户端 |
| F5 | 线上事件信封已存在、JSON 安全、可版本化 | `SessionWireEvent { type, seq, time, data, ignorable?, sourceEventSeqs?, surfaceOp? }`，`packages/api/session-controller/src/types.ts:428` |
| F6 | live 流语义为 `replace`/`prepend`/`append`/`settle-assistant`，且已有重连补页机制 | `packages/api/session-controller/README.md`（`SessionEventStream`、`loadOlder`/`loadThrough`、gap 修复） |
| F7 | 网关提供与载体无关的派发入口 | `ctx.typertGateway.invoke/stream/wireStream.open`，`packages/api/gateway/src/types.ts` |
| F8 | 插件必须把宿主服务声明为 `peerDependencies`，不能自带第二份 core | profile 以 `nodeLinker: hoisted` 创建，并按 `dependencies` **和** `peerDependencies` 做 BFS 生成模块回退目录，`packages/boot/app-boot/src/profile.ts:466` |
| F9 | 交付与安装路径 | `package.json` 的 `dsh.bundle.patch` + `dsh plugin --profile <name> add <package>`，`packages/bundle/README.md` |
| F10 | 预编译二进制可随 npm 包分发，且不触发审批流 | tarball `files` 原样安装、可执行位保留；只有 install script 才走 `approvedBuilds` 审批，`packages/boot/plugin-manager/src/build-approval.ts` |
| F11 | 本机具备 Flutter Android 构建能力 | Flutter 3.47.7 stable / Dart 3.13.5（`/home/bruce/Android/flutter`），Android SDK `/home/bruce/Android/Sdk`，JDK 17/21 可用；根文件系统已是 `rw` |
| F12 | iOS 无法在本机构建 | Flutter 工具硬性限制 `bool get supported => globals.platform.isMacOS`，Linux 上直接 `throwToolExit`；本机无 Xcode/Swift/Apple SDK |

### 2.1 三条必须遵守的架构约束

1. **不要调用 `typertGateway.registerRemoteEvents()`** —— 该单例已被 `api-remotes` 在 web/desktop
   profile 占用，重复注册抛 `already registered`。插件必须在 `ctx.on(...)` 上自行订阅。
2. **不要拦截 `/api`** —— `connection.rpc.intercept` 每个通道仅允许一个拦截器，核心已占用。
   插件使用自有前缀路由（`/remote`）+ 自有升级路由（`/remote/ws`），`webServer` 的注册是追加式的。
3. **不要走 SDK 子进程路线** —— `packages/sdk/client` 版本锁死、看不到宿主已有会话、没有
   cancel/steer RPC、**完全没有审批通道**。它是"创建隔离运行时"的工具，不是"暴露宿主"的工具。

---

## 3. 里程碑

| 阶段 | 内容 | 验收标准 | 预估 | 状态 |
|---|---|---|---|---|
| **M0** | 风险验证 spike：Flutter 构建门禁、隧道长连接、Noise 跨语言互操作；并持久化设计文档 | 三个 spike 各有可运行脚本与书面结论；文档定稿 | 3–5 天 | ✅ **已完成**（4 个 spike 全通过，见 §4.1） |
| **M1** | 底座：`packages/{protocol,core,tunnel}` + CLI；握手、加密、分帧、重连、gap 修复 | 双 Node 进程加密互通；断网期间事件补齐（源保留范围内）；隧道一键起停 | 1–2 周 | ✅ **已完成**（本地验收；见 [M1 总结](m1-summary.md)） |
| **M2** | 插件完整能力：被控端 server/配对/设备管理/审批代理 + 控制端 MCP 工具与 skill + 完整会话映射 + 文件/终端 | 两个真实 DSH 实例互控跑通全部会话能力，含双向审批流 | 2–4 周 | ✅ **已完成本地验收**（Linux / DSH 0.1.7-rc.2；见 [M2 总结](m2-summary.md)，未发布） |
| **M3** | Flutter 双端：密钥存储、扫码配对、Dart 协议实现、聊天/工具/审批 UI、会话管理 | Android APK 装机可用；iOS 在 macOS CI 出未签名产物 + Xcode 工程可用 | 3–6 周 | **开发实现完成，最终验收延期**；实现提交 `475ea94`，用户确认进入 M4；[开发复核](m3-plan.md)，[延期项](m3-summary.md) |
| **M4** | 加固与发布：威胁模型测试、模糊测试、审计、双语文档、GitHub Actions / Packages | 安全用例全绿；README 双语；v0.1.0 发布 | 1–2 周 | **本地开发与发布流收口，最终门禁待验收**：接收/审计、340000 样本压力、Node 覆盖率 fuzz 10 分钟和 scoped 五包独立安装通过；[步骤](m4-plan.md)，[验证](m4-summary.md)；独立/平台审查与持续长期结果待完成，仓库已接入；首次推送/远端执行与正式发布待完成 |

**排序理由**：M0–M2 完全不依赖移动端。先把"两个 DSH 实例互控"跑通，即使移动端进度落后，
插件自身已经是可用产品。移动端是同一协议之上的第二个客户端，不阻塞主线。

---

## 4. M0 执行清单与门禁

| # | Spike | 内容 | 门禁（必须得到确定结论） | 失败时的降级 |
|---|---|---|---|---|
| M0-1 | Flutter Android 门禁 | `flutter doctor` → `flutter create` → `flutter build apk --debug`/`--release` → `flutter analyze`/`test` → APK badging 校验 | 本机能否产出可用 APK，首次构建真实耗时 | 若不可用，Android 构建外移到 CI，本机只做 Dart 逻辑单测 |
| M0-2 | 隧道传输 | cloudflared 一键起隧道、stderr URL 解析、外网 WSS 心跳挂机、kill/restart 重连、429 行为、跨平台资产与许可证 | Quick Tunnel 能否作为默认一键方案；心跳与重连参数 | 降级为 named tunnel / 自建中继（rathole）/ `ssh -R` |
| M0-3 | Noise 互操作 | Node 与 Dart 各自实现 `Noise_XX_25519_ChaChaPoly_BLAKE2s`，含 prologue 绑定与 SAS 派生；测试向量逐字节互验；篡改/重放/错误 prologue 负向测试 | 两端能否互通；选定的库对与版本；是否需要编译工具链 | 降级为 TLS 1.3 双向证书 + 应用层 AEAD |

### 4.1 M0 结论汇总

| Spike | 结论 | 关键实测数据 |
|---|---|---|
| **M0-1** | ✅ **通过** | Flutter 3.47.7 / Dart 3.13.5；**GPU 无关的构建耗时**：项目内冷构建 **40 s**（裸应用对照 34 s → 密码学依赖仅 +6 s），增量 **19 s**，release/AOT **90 s**（47.0 MB）。注：443 s 是本机**有史以来第一次** Android 构建（含引擎产物 + Gradle 9.3.1 + AGP 9.1.0 全量下载），不代表常态。debug APK 150,418,140 B、release 44,103,444 B；`minSdk 24` / `targetSdk 36` / `compileSdk 36`；ABI `arm64-v8a`+`armeabi-v7a`+`x86_64`；`apksigner verify` exit 0、`zipalign -c 4` 通过；`analyze` 无问题、`test` 通过。唯一必需的修复是接受 Android SDK 许可（2.3 s）。 |
| **M0-1b** | ✅ **通过** | 密码学栈在 Dart 3.13.5 与 Android 上可用：解析版本 `cryptography 2.9.0` + `crypto 3.0.7`；**26 个测试 / 129 项断言**在 `flutter test` 与纯 `dart test` 下全通过（BLAKE2s、HMAC-BLAKE2s、HKDF 含 HASHLEN=64 截断规则、X25519 含 RFC 7748 §6.1/§5.2/1000 轮链、ChaCha20-Poly1305 含 RFC 8439 §2.8.2 与 Noise nonce、SHA-256）；**无 C 工具链、无 build hook、无 install script**；已在真实 Android 13（API 33 x86_64）模拟器上运行并核对设备端输出 |
| **M0-2** | ✅ **通过（条件性）** | cloudflared 2026.10.0（sha256 `d33ff2d1…4a99db`，40,129,756 B）；URL 在 **stderr**（stdout 0 字节），3.32–3.84 s 出现、6.2–14.6 s 首次 200；**13 分钟挂机：31/31 心跳往返、0 未确认、0 断开**，RTT p50 126 ms；`ws-pings=0`（客户端未发送控制帧）；应用层心跳已验证；origin 被杀 → `CLOSE 1006`（URL 仍有效）；cloudflared 被杀 → URL **永久** 530/1033；**实测 429**（220→200 开/20 拒，第 201 条 `HTTP/1.1 429`）；冷启动前 ~50 s 有 **10–25%** 升级失败（raw TLS 0/96） |
| **M0-3** | ✅ **通过** | **跨语言互操作达成**：向量文件 Dart 侧 **94/94 断言通过**；真实 TCP 握手 **3/3 组合**（双向角色）握手哈希与 SAS 完全一致；Node 自实现 driver 与第三方 `noise-handshake` 在 BLAKE2b 下 **26/26 字节级**一致；篡改/重放/错误 prologue 负向测试全部拒绝（含在线篡改探针）；**无需编译工具链**；握手 3.4–5.3 ms/方，传输 Node 47–51 MiB/s、Dart 8–10 MiB/s |

M0 结论统一记入 [technology-decisions.md](technology-decisions.md)，spike 证据留在 `spikes/*/REPORT.md`。

---

## 5. 风险登记

| 风险 | 影响 | 等级 | 应对 |
|---|---|---|---|
| **自实现 Noise 握手无第三方审计** —— 两端共约 560 行安全关键代码 | 高危安全缺陷 | **高** | 用成熟原语而非自创；已建向量 + 真实 TCP 互操作 + 负向测试；对第三方实现做字节级交叉验证；M4 前第三方审查 |
| **X25519 低阶点无内置拒绝**（Dart 静默返回全零；Node 原语库本来拒绝） | 攻击者可预测密钥流 | **高** | 强制 DH 全零守卫，统一封装（security.md T16） |
| DSH 核心持续迭代（M2 支持 0.1.7-rc.2），API 会漂移 | 插件随宿主升级而崩 | **高** | 只依赖 `ctx` 服务与线上协议，不 import 宿主内部实现；运行时特性探测 + 声明支持版本区间 |
| **cloudflared 重启后 URL 永久失效**（实测 7 个不同主机名，旧 URL 返回 530/1033） | 用户手里的二维码/链接失效 | 中 | URL 建模为一次性会话数据，随二维码下发；重启后必须重新发布 |
| **隧道 200 in-flight 上限对 WebSocket 生效**（实测第 201 条返回 429，重试无法解决） | 并发高时连接被硬拒 | 中 | 独立限制物理连接与逻辑流；逻辑流上限 32；服务端超限返回 `busy`；UI 区分 429 与 530 |
| **新建隧道冷启动前 ~50 s 有 10–25% 升级失败** | 用户过早扫码即失败 | 中 | 就绪探测通过前不展示 URL；短退避重试；配对流程容忍一次失败 |
| Quick Tunnel 无 SLA、Cloudflare 可能自行重启 socket | 长连接意外中断 | 中 | 25 s 应用层心跳 + 指数退避重连 + 诚实的"重连中"UI；保留自建中继 seam |
| Cloudflare 官方文档对空闲超时自相矛盾（125 s vs 100 s） | 参数选择无权威依据 | 低 | 25 s 心跳对两者都安全 |
| `@noble` 与 `cryptography` 实质为单一维护者，且 `cryptography` 已发现两个真实 bug | 上游变更静默破坏互操作 | 中 | 精确锁版本（`cryptography: 2.9.0`，无 `^`）+ 表征测试锁定错误行为；M4 供应链审查 |
| **Dart 传输吞吐仅 8–10 MiB/s**（Node 47–51 MiB/s） | 大文件/长历史体验差 | 中 | 分页与流控；可选 `cryptography_flutter` 原生加速（未在真机验证） |
| 自实现密码学协议出错 | 高危 | **高** | 见首条；M4 前审查 |
| iOS 无法本地验证 | 交付风险 | 中 | M3 起即建 macOS CI，不留到最后 |
| 移动端后台保活/系统杀进程 | 通知与审批响应丢失 | 中 | 审批只在前后台活跃时呈现；被控端在无客户端时降级到本机审批 |

---

## 6. 与 Codex remote access 的对标

参考产品形态：[随时随地使用 Codex](https://openai.com/zh-Hans-CN/index/work-with-codex-from-anywhere/)，
以及一个开源同类实现（Android App + 私有网络桥接，支持 chat/approvals/session history/code diff）：
[chenhaoc/codex-remote-control](https://github.com/chenhaoc/codex-remote-control)。

我们要覆盖的能力集合：从手机查看并继续会话、实时看到 assistant 输出与工具调用、响应审批、
浏览会话历史与代码 diff、管理多会话。

**我们的差异化**：

1. **双向角色**：不只是"手机看桌面"，任意两个 DSH 实例可以互控。
2. **零账号**：没有云端账号体系，配对靠二维码 + 人工比对 SAS。
3. **端到端加密**：Noise 内层，隧道方只看到密文。
4. **审批双向**：被控端本机与远端都可审批，先到先得，且绝不静默放行。
5. **协议可复用**：DSH 控制端与 Flutter 端说同一套协议，不是两套实现。
