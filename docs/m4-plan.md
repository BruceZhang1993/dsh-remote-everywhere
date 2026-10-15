# M4 加固与发布步骤

日期：2026-10-15。开发基线：M3 提交 `475ea94`；工作分支：`feature/20261013-m4Hardening`。
用户已确认按 **M3 开发实现完成、平台验收延期** 进入 M4；远程仓库已创建并接入 origin，CI 按 GitHub Actions、发布按 GitHub Packages 准备。此决定不改变最终验收门禁，也不代表实际发布授权。

## 实施顺序与门禁

| 步骤 | 交付 | 验证 | 当前状态 |
|---|---|---|---|
| M4-0 基线复核 | 对照 M3 计划、提交、APK 和模拟器记录，保留延期项 | 原有 Node/Dart/Flutter 检查通过，APK 哈希一致 | 已完成 |
| M4-1 接收与资源加固 | Dart 在消息组装前检查声明长度、累计分片和分片数；Node 限制分片与缓冲块 | 无正文/无 FIN 的攻击提前关闭；控制帧交错、边界值、取消和普通 RPC 不退化 | **本地收口**；修复带载荷 ping 导致 Dart SDK 丢前片 |
| M4-2 威胁模型与模糊测试 | 重放、降级、身份/流混淆；固定 seed 回归及 Node/Dart 覆盖率反馈 | 不重复派发写入，鉴权失败不进入业务；非法输入只产生预期错误 | 本地矩阵、340000 样本压力通过；Node DR/TCP 首次远端 900 秒通过；Dart DR/Noise/WS guard 入口、4 项故障注入/回放及短跑 CI 通过；串行长跑见 [M4 记录](m4-summary.md)，持续周期及未覆盖范围保留 |
| M4-3 审计与供应链 | 精确锁定修复依赖；核对审计内容、容量、轮转与鉴权事件；独立审查 Noise | 依赖公告复核，轮转回归、敏感字段排除、第三方书面审查 | **审计本地收口**；Node audit 0、Node/Dart 库存及 Android 86 坐标哈希/OSV 0 已记录；六项声明补证、Maven/native 声明和 JNI 来源材料已准备；完整分发审查、平台二进制与第三方 Noise 审查待完成 |
| M4-4 发布准备 | LICENSE、SECURITY.md、双语安装/回滚，GitHub owner-scoped 候选、来源/哈希门禁 | 独立安装、不启用 install scripts；workflow 静态与发布拒绝路径回归 | **本地与首次远端 CI 收口**：scoped 五包、actionlint 与 15/15 发布/晋级门禁回归通过；`e4a1b32` 两条 workflow 全绿，候选来源/哈希与 APK 签名/对齐已复核；私密入口和发布 environment 已配置，收件与批准 SHA 待验收 |
| M4-5 正式发布 | 手动标签门禁、保护 environment、批准 SHA、依赖顺序、next 发布与 latest 晋级 | 注册表 SHA-512 与发布后独立安装；操作前获得具体发布授权 | 脚本/workflow 已准备，实际发布未执行 |

本地命令始终通过 `tools/run-limited.sh`，8 GiB 内存 / 4 GiB swap，重任务串行；不提高或绕过限制。
新安全用例已纳入 `pnpm test` 和 Dart 默认测试，现有 CI 会执行它们；workflow 配置不等于远端执行结果。

## 首批修复的调用链与终止条件

`RemoteConnection.connect → _openSocket → BoundedWebSocketSocket → WebSocketReceiveGuard → dart:io WebSocket → _receive`。
guard 先检查最多 10 字节帧头与累计计数，再有界重组最多一条 65551-byte DR 记录；控制载荷独立，最多 125 bytes。SDK 接收规范化数据帧和独立控制帧，继续管理掩码、pong、关闭和写回压。
违规产生格式错误并销毁原始 socket，SDK 结束订阅后进入 `RemoteConnection.close`，结算 RPC/逻辑流并清理密钥和定时器。
关闭幂等，接收路径不调用 prompt、不重试写入，不启动新连接。HttpClient、原始 socket 与逻辑连接仍由同一 owner 管理。

审计调用链：connection/dispatch、PairingHost、InteractionBridge 和 WorkspaceOperations → runtime 的单一 AuditLog → 本地同步追加。
审计不调用 RPC、审批 waterfall 或同步状态服务。RPC 收到时先记录，审计不可用则关闭连接并停止 dispatch；结果记录不会重新执行 handler。
人工交互仅在首次 finish 时记一次决定；记录失败转 cancelled，仍清理 pending/定时器并撤回另一端。精确 local clone 的 WeakSet 终止路径不变。
AuditLog 失败锁定并告警一次；observe 失败后的 close 是幂等终点。紧急本机 revoke 和 teardown 不受失败阻塞。

WS message 累计上限仍为 65551 字节；每条 message 最多 1024 个数据分片（含空分片），Node 最多缓存 1024 个原始输入块。
Node/Dart 的 DR/Noise 字节格式和版本不变。旧端与新端可混用；旧端没有新增接收保护，安全修复要分别升级宿主插件与移动 App。
正常客户端每条 DR 记录发送一条完整二进制 message，新增限额不改变业务分块的 32 KiB SDATA。

## 延期验收与发布条件

- M3 的 Android ARM 真机、实际相机解码/网络切换、完整 UI、真实模型和 iOS/macOS 门禁仍见 [M3 总结](m3-summary.md)。未通过前不能宣称双端产品验收完成。
- origin 已指向公开仓库 `BruceZhang1993/dsh-remote-everywhere`；实现及 CI 修复已推送 master，验证提交 `e4a1b32` 的协议/安全与移动 Android workflow 均通过，iOS 跳过。候选与发布流从该仓库 owner/repo 获取 `@brucezhang1993` namespace；environment 审核与私密报告入口已配置；注册表权限、最终批准 SHA 和私密收件验收须在正式发布前落实。
- Node 注册表 audit 不覆盖 Dart/Flutter 平台插件、系统工具或自实现 Noise；公告清零不代替密码学第三方审查。
- WS 分片与带载荷控制帧交错已专项修复/验证，详细矩阵与供应链边界见 [安全验证](security-validation.md)。
- 独立 Noise 审查的实现范围、证据与报告要求已准备在 [交接材料](noise-review.md)，不是签署的第三方报告。

本轮结果见 [M4 首批记录](m4-summary.md)。
