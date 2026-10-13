# M3 开发步骤与验收门禁

日期：2026-10-13。前置基线：M2 本地提交 `7967cae`，DSH **0.1.7-rc.2**，插件 **0.1.0-alpha.2**。M2 完成度复核已通过，详见 [M2 总结](m2-summary.md)。移动端已在 `feature/20261013-m3Mobile` 开始实现；本文件保留开发顺序与最终门槛。用户最新要求：可使用子代理并行开发，**真机验收暂不执行**，独立记录为延期验收。

## 1. 范围与实现原则

- 沿用 Flutter，创建正式 `apps/mobile`，Android/iOS 共用业务代码；手机只做 `controller`，不实现被控端。
- 直接接入 M2 插件的 Noise + 二进制 WebSocket 协议，复用 `packages/core/dart` 的密码学与分帧；不通过诊断 CLI 或 SDK 子进程间接驱动宿主。
- 移动端依赖纯 Dart core，平台密钥库、相机、文件选择及 UI 留在 App。先用 Flutter 自带状态通知机制实现少量状态对象，不提前引入复杂框架。
- 首版会话正文、工具输出及附件仅在有界内存中保留；冷启动从宿主重新读取。持久化仅包含平台保护的设备身份和信任资料，暂不引入聊天数据库或离线写队列。以后若缓存正文，必须加密。
- 功能按授权能力呈现；不默认申请 `files/terminal/admin`。保留逐次审批、吊销、路径围栏、帧与输出限额，不增加自动审批。
- 不在 M3 引入账号、推送服务、后台常驻保活或发布渠道；前后台恢复与审批撤回必须有明确行为。

## 2. 开工前已确认的缺口

| 已有基础 | M3 要补的部分 |
|---|---|
| Dart Noise、DR 帧、固定向量和一次 TCP echo | 可复用的二进制 WS 连接、hello/能力协商、RPC、心跳、逻辑流、取消及资源关闭 |
| schema 与生成 Dart 字段访问器（含 PairingPayload） | 结果与应用事件 data 仍缺少具体类型，字段访问器不提供运行时校验；补最小必要契约与校验，不能把已生成类型当完整协议客户端 |
| Node `RemoteClient` 与 `HostStreams` | Dart 对等客户端；SDATA 拼接、恢复游标、历史分页及流式 assistant 状态还原 |
| M2 支持双向审批和提问 | 手机人工 UI、竞速撤回、订阅重建后的 pending 恢复、超时和重复点击处理 |
| M0 Android 验证 App | 正式 App 工程、平台权限与密钥存储、设备验收；spike APK 不能作为 M3 产物 |
| 既有 Linux/Android CI 配置 | macOS/iOS 编译与插件验证；当前没有 Git remote，远端与 macOS runner 需在执行 CI 前落实 |

DSH listener 当前默认只绑定 `127.0.0.1`。Android 模拟器可通过测试端口转发访问，真机首先走宿主已就绪的公网 WSS 隧道。不能让手机直接使用指向桌面 `localhost` 的二维码，也不在本轮规划中假定局域网监听已开放。

## 3. 实施顺序

预计 17–26 个开发工作日，约 3–6 周；为工作量估算，macOS runner、设备和平台插件问题可能增加等待时间。每步通过门禁后再推进依赖它的步骤。

| 步骤 | 预计 | 交付与验证 |
|---|---|---|
| M3-0 工程与双端门禁 | 1–2 天 | Flutter 工程、依赖核查、Android APK 和 macOS 未签名 iOS 编译入口；验证两端平台插件能够加载 |
| M3-1 Dart 完整协议客户端 | 3–4 天 | 二进制 WS、握手、RPC/逻辑流/心跳与生命周期；验证与真实 Node 插件互通及负向拒绝 |
| M3-2 安全存储、扫码与设备连接 | 2–3 天 | 长期身份、SAS 双方确认、设备页、端点刷新与重连；验证杀进程、过期、吊销和错误公钥 |
| M3-3 会话状态与聊天界面 | 4–6 天 | 会话列表/工作区/历史、流式文本与工具结果、提示和取消；验证分页、断网补齐及 assistant 结算不重复 |
| M3-4 审批与提问闭环 | 2–3 天 | 人工卡片、pending 恢复、竞速撤回；验证本机/手机分别胜出、超时与后台恢复 |
| M3-5 完整会话能力 | 3–4 天 | 队列、fork、子代理、附件/图片、文件/diff、有界终端；验证权限与限额、审批参数绑定 |
| M3-6 真机与双端收口 | 2–4 天 | Android 装机验收、真实模型/公网回归、macOS iOS 构建与模拟器检查、使用文档和验收记录 |

### M3-0：先建立可持续验证的正式工程

1. 核查并锁定仓库已有 Flutter/Dart 工具链；平台插件从既定候选核查官方兼容性后选定精确版本，不照搬早期 pub-cache 版本。
2. 创建 `apps/mobile`，通过本地 path 引用纯 Dart core；补密钥存储、扫码所需权限及最小设备页。分别记录 Android 和 iOS 的部署目标。
3. 在现有门禁上增加移动端 analyze/test、Android 构建与 macOS `flutter build ios --release --no-codesign` 的执行入口。先验证安全存储和扫码插件的双端集成，再扩展业务 UI。

验收：正式工程可构建 Android APK；macOS job 能产出未签名 `.app`，Xcode 工程可加载，平台插件无编译/加载错误。当前 Linux 主机不能执行 iOS 构建；runner 未落实时可继续独立的 Dart/Android 工作，但 iOS 门禁保持未通过，不能宣布 M3 完成。

### M3-1：把参考实现补成可复用客户端

1. 在 `packages/core/dart` 实现 controller 连接与 RPC/流管理。参考 Node `SecureConnection`/`RemoteClient`，复用现有 Noise 与帧编解码，不另写一套密码学。
2. 保持三类计数独立：Noise 方向 nonce、物理流 frame seq、持久会话 event seq。hello 声明 `kind: mobile, role: controller`，核验版本、被控端角色及固定公钥。
3. 实现单一连接 owner、串行发送、RPC 超时、订阅取消、断开清理；关闭时释放会话密钥、定时器与待处理任务。每次重连重新握手，不重置旧 cipher nonce。
4. 对齐现有边界：32 个逻辑流、32 个待处理 RPC，发送队列 128 条/1 MiB，应用值及接收队列最大 4 MiB，SDATA 单块 32 KiB。收到完整 bytes 标记后才解码 JSON，拒绝错误 UTF-8、截断与未知流。
5. 将移动端实际消费的 snapshot/assistant/control、审批/提问及方法结果补入最小协议契约和解析校验；保持现有线上字段兼容，更新生成一致性检查。

验收：纯 `dart test` 仍可运行；真实 Node↔Dart WS 握手、会话 list/prompt/follow、分块重组和并发订阅通过。篡改、重放、错误 pin/prologue、角色/版本错误、认证拒绝、超大帧、取消与连接中途关闭均有负向用例；普通 RPC 失败后连接仍可用。

### M3-2：安全存储与配对

1. 由平台安全存储保护 32 字节长期身份及信任资料；Noise 运算需要在 Dart 内存使用私钥，不声称已实现不可导出的硬件 X25519 密钥。验证平台备份/恢复、卸载重装与存储失败语义；不记录私钥或含 sid 的完整二维码。
2. 校验 M2 `{v,sid,exp,relay,pk,name,caps}`：`exp` 为 Unix 秒、`pk` 是标准 base64，信任记录的公钥编码另行规范化。向用户显示设备身份、申请能力与六位 SAS，双方确认成功后才写入信任。
3. 配对成功后关闭临时连接，以 `resume:<hostDeviceId>` prologue 重连；正常连接仍固定公钥。设备改名/移除首先是本机操作；宿主吊销仍通过本机管理入口，远端管理需另有 admin 授权。
4. 同一设备仅一条连接尝试；网络丢失/429 有界退避，530 显示地址失效，认证拒绝立即停止。更新端点必须保持原公钥；扫码若公钥变化，进入重新人工配对。持久信任与临时端点分离，重启后可重新输入或扫描端点。

验收：手机与真实插件配对、冷启动保留原身份、取消/过期/重复二维码拒绝、SAS 不一致不授权、宿主即时吊销后不可自动重连；相机权限拒绝与安全存储不可用均有可见结果。

### M3-3：正确还原会话，再接聊天 UI

1. 实现纯 Dart 会话状态归并，再将其连接到设备→会话列表→聊天页面。支持新建、工作区选择、重命名、恢复已有会话；使用 `control.subscribe` 更新投影，会话目录按需重新读取。
2. 采用 M2 实际线协议：`snapshot/append`、`assistant-stream` 的 `start/chunk/end` 和快照 `assistantStream` baseline。按 attemptId/revision/index 还原临时输出，与持久 assistant/message 或 assistant/attempt 结算关联；不用早期设计中的 replace/settle DTO。
3. 活跃会话断网恢复时复用 sinceSeq，由宿主冻结 opening cursor 并补页，再按持久 seq 去重；较早历史通过 `history.page` 的 throughSeq/beforeSeq 请求。历史缺失明确显示，不静默移动游标；只跳过显式 ignorable 的未知事件。
4. 提示使用稳定 requestId；结果未知时标记待确认，用户重试同一提示仍用原 requestId。先订阅后发提示；页面退出只取消订阅，停止任务必须显式调用 session.cancel。
5. 文本/代码块、工具调用和结果、turn/step 与运行状态各自展示；列表使用有界历史窗口与惰性渲染。App 后台暂停活跃订阅并清理临时交互，回前台重连补历史；不承诺后台实时审批。

验收：历史分页顺序正确；两个订阅断线恢复互不干扰；assistant 输出中途断网、end 与持久消息先后到达、取消及宿主重启后，正文不丢失也不重复；重复提交相同 requestId 只生成一次提示。搜索沿用宿主设置，不能将所有 gateway/internal 错误统一解释为搜索关闭。

### M3-4：审批与提问必须由人闭环

1. 按连接设备、sessionId 和 interactionId 管理卡片，展示线上实际提供的工具名、理由/操作详情与期限；不猜测缺失参数，也不允许模型替用户决定。
2. 监听 approval/question 的 request/responded；点击后禁用重复提交。本机或另一客户端胜出即撤回；期限到达、本页订阅取消或连接中断后不能继续点击旧卡片。
3. 恢复会话订阅时采用宿主重推的 pending 交互，审批再以 approval.pending 对账；当前没有 question.pending 方法，不能凭设计文档假定存在。迟到 not-found 视为已结算并重新同步。

验收：手机允许/拒绝、本机先决定、双方近同时决定、断网期间本机决定、超时/取消、后台恢复、未授权能力均通过；只结算一次，另一端撤回，任何无人响应路径都不产生允许。

### M3-5：补齐协议已经支持的操作

1. 队列 edit/remove/steer、取消、fork 的 atSeq，以及一次性/可继续子代理地址、历史与可用控制操作。
2. 附件按 begin/chunk/finish 上传，单块确认，总量不超过 4 MiB；文件 receipt 只用于原会话。图片提示按整条 RPC 字节预算缩放/拒绝，不能把 4 MiB 附件能力当成大图内联能力。
3. 按 files 权限接入目录、32 KiB 读取窗口/最大 4 MiB 读取流和 changes.summary/diff。快照失效显示 history/unavailable；不伪造历史 diff。
4. 文件写/终端先建立会话订阅，operation.prepare 绑定完整参数；人工审批后用一次性 approvalId 执行。直接写入最多 32 KiB UTF-8；终端每次审批、30 秒并明确显示输出截断。这里交付有界命令执行界面，不扩展为协议尚无的交互式 PTY。

验收：通过真实插件逐项验证；缺少 files/terminal 权限时不提供可执行入口；修改已批参数、重放许可、许可过期、路径越界、跨会话附件、超过限额均拒绝；退出页面取消上传/输出订阅且无遗留任务。

### M3-6：验收与产物

1. 先用两个真实同版 DSH 的确定性夹具跑移动端协议集成，再用真实模型执行手机发提示→流式工具输出→人工审批/提问→完成的闭环。
2. Android 模拟器做可重复流程检查，ARM64 真机安装 release APK 验证相机、安全存储、杀进程恢复和网络切换；至少一轮公网 WSS 与端点失效/刷新。iOS 在 macOS 模拟器检查同一组 UI/平台插件流程。
3. 保留 macOS 未签名 iOS `.app`、可用 Xcode 工程和构建日志；不把未签名 `.app` 写成可装机 IPA。iPhone 真机签名与分发单独记录可用条件，不以 Linux 构建替代。
4. 更新双端运行/调试文档和 M3 总结，分别记录本地单测、模拟器、Android 真机、真实模型/公网、macOS CI、签名/分发状态。

M3 完成必须同时满足：正式 Android APK 装机闭环通过；iOS macOS 构建及 Xcode 工程门禁通过；核心会话、审批/提问与恢复用例通过。只有计划、spike APK、Dart echo 或未运行的 workflow 均不能作为完成依据。

## 4. 每步通用约束

- 所有本地 compile/build/lint/test 完整命令树都用 `tools/run-limited.sh bash -lc '<完整命令>'`，8 GiB 内存 / 4 GiB swap；重任务串行。manager 不可用或需要提高限额时停止，不自行绕过。远程 runner 的资源约束需在建立 CI 时明确；macOS 不能照搬 Linux systemd。
- 改动配对、审批、恢复或远程写路径前先画清调用链与退出条件；客户端读取/事件归并不反向触发 prompt 或重试写入。连接、流、上传和平台资源各自只有一个 owner。
- 本轮进入 M3 实现；保持既有文档改动，不自动提交、推送或发布。真机验收暂缓，模拟器和构建记录与最终装机验收分开。
