# M2 交付与验收

基线：M1 本地提交 `c3f64df`。实现分支 `feature/20261012-m2Plugin`，插件 `dsh-remote-everywhere@0.1.0-alpha.2`，宿主锁定 **0.1.7-rc.2**。M2 已纳入本地提交 `7967cae`，当前 `master` 与实现分支指向该提交；仓库尚未配置 Git remote。本轮未执行推送或 npm 发布。

## 实现

- 被控端独立 `/remote/ws` listener；本地 Unix 管理 socket 与公网分离。
- 一次性二维码、双方 SAS 人工确认、固定公钥、方向独立授权、设备改名和即时吊销。
- 会话创建/恢复、搜索、fork、重命名、提示、附件上传、队列编辑/steer/取消、投影与控制流。
- 历史冻结分页、流式 assistant 与工具事件、断线游标补齐；可继续与一次性子代理的读取/控制。
- 本机与远端审批/提问竞速，受控二次瀑布只派发一次本机 clone，获胜后取消另一端。
- 工作区文件围栏、分块读取、UTF-8 写入、逐次审批的有界终端、宿主变更摘要与代码 diff。
- 原生 DSH 四工具、标准 MCP stdio、CLI 人工响应及随包 skill；远端驱动会话和后代禁止再次控制远端。

## 验证证据

| 验证 | 结果与边界 |
|---|---|
| 静态检查/协议生成 | `pnpm check`：语法、exports、生成一致性、TS 消费者、core 无宿主依赖 |
| Node 回归 | 配对、真实 Cordis 竞速、资源/取消、MCP framing、上传失败回收、后代重入防护等；44/44 通过 |
| Node/Dart | 固定向量、真实加密 RPC、重放及错误 prologue 拒绝通过；Dart analyze 无问题、5/5 测试通过 |
| 两个真实 DSH 进程 | `tools/m2-host-smoke.mjs`：同版真实 loader/services，不修改 DSH 核心 |
| 确定性模型夹具 | 双向会话与审批、提问、附件上传、图片提示/回读及跨会话拒绝、设备改名、控制流、启用后的全文搜索、队列、一次性/可继续子代理、文件/终端、代码 diff、MCP 进程、重启与吊销、双订阅同时自动恢复且不重复事件；夹具不进入交付 tarball |
| 真实模型 | WorkBuddy / `deepseek-v4.1-flash` / low：双向真实 assistant 消息与流、文件终端审批、MCP run、重启和吊销；曾在 provider 初始化阶段遇到 UNSUPPORTED_REASONING_EFFORT；后续查询明确声明 off/low/high/max，选择 low 后复验通过。夹具与真实模型证据分列 |
| 原生 GUI | Chrome，临时 loopback profile：本机允许胜出、远端拒绝撤回；原生 `remote_run` 从本机 GUI 发起，两端同时出现审批，控制端人工允许后两端完成；提问在控制端选择 Proceed 后答案返回目标；截图及宿主 decided/tool-result 事件核验 |
| GUI 基础检查 | 页面身份、非空、无框架错误覆盖、审批交互通过。审批验收时控制端 console 无错误；早期被控端仅有浏览器翻译扩展的无关报错。提问完成并自动关闭临时宿主后出现 connection lost 重连警告，与测试进程清理对应 |
| 独立安装 | 五包 tarball，在 workspace 外 `npm --ignore-scripts` 安装完整同版宿主；真实插件 bundle 加载与双实例链路通过 |
| 公网 WSS | 临时被控 DSH 经真实 Quick Tunnel 完成配对、加密会话、审批、文件终端与重启；第一次业务通过后测试 harness 的重复进程回收等待失效，已修正 signalCode/exit 竞态并复验 |

所有构建/测试/安装均使用用户确认的 systemd scope，整棵命令树限制 8 GiB 内存 / 4 GiB swap，重任务串行。

## 已明确的限制

- Linux 是本轮验收平台；Windows/macOS 管理入口及移动端未验收。
- 宿主默认关闭内容全文搜索，`session.search` 沿用宿主 `gateway/internal`；显式配置 `session-query-sqlite` 的索引路径及 `openAt: first-search` 后已验证查询。会话列表无需启用全文索引。
- 直接工作区写入限 32 KiB UTF-8；分块附件二进制上传限 4 MiB。内联图片提示和图片回读受单 RPC 64 KiB 帧上限约束；读取可用字节窗口；终端 30 秒、输出有上限。
- 原生工具可把审批呈现到控制端；标准 MCP 无主动人机交互协议，使用被控端原生 GUI，CLI follow 也可人工响应。
- diff 快照由宿主保留，重启/释放后明确不可用。直接文件/终端审计单独保存，模型工具审批继续落宿主会话。
- Quick Tunnel URL 重启后失效；地址刷新仍绑定原公钥，不能用网络重试绕过吊销。
- 本机原有全局 DSH 存在 rc.1/rc.2 混装；本轮只在隔离目录安装完整 rc.2 验证，未修补全局安装。

## 2026-10-13 完成度复核

结论：**M2 达到既定的 Linux 本地验收门槛，可以进入 M3**。这不代表跨平台验收、远程 CI 或正式发布完成。

复核对象是提交 `7967cae`；开始复核时工作区干净。核对了设备授权、配对、会话映射、流恢复、审批/提问竞速、文件/终端以及远程调用的后代重入防护实现，并重新执行以下检查：

| 本次复验 | 结果 |
|---|---|
| `pnpm check` / `pnpm test` | 静态检查通过；Node 44/44 通过，无跳过 |
| Dart analyze / test / selftest / vectors | 无问题；5/5、31/31、94/94 通过 |
| `pnpm test:interop` | 固定向量、第三方 oracle、真实 Node↔Dart 加密 RPC、重放和错误 prologue 拒绝通过 |
| `tools/m2-host-smoke.mjs` | 两个真实同版 DSH 进程 + 确定性模型夹具；双向配对/会话/审批、提问、队列、子代理、附件及图片权限、diff、MCP、文件/终端、双订阅断线恢复、重启历史和即时吊销通过 |
| `pnpm test:package` | 重新打包五包；workspace 外以 `--ignore-scripts` 安装同版宿主；CLI 加密自检及上述双宿主链路通过 |

所有复验命令均在 8 GiB 内存 / 4 GiB swap 的用户 systemd scope 内串行执行，临时宿主及消费者已清理。

本次没有重跑真实模型、人工 GUI 或公网 WSS；这些结论沿用上方原验收记录。本次也未构建 Android/iOS、执行真机验收或验证远程 CI。当前 `.github/workflows/ci.yml` 只有既有 Linux/Android 门禁，没有 macOS/iOS job；`apps/mobile` 尚不存在，Dart 包仍只有密码学、分帧、生成类型和 TCP 诊断互操作程序，不能算移动客户端已完成。

安装与回滚见 [m2-install.md](m2-install.md)。M3 按 [开发计划](m3-plan.md) 推进，M4 安全审查/正式发布继续独立推进。
