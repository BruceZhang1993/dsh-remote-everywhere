# M1 底座 — 执行总结

> 状态：**已完成（2026-10-12，本地验收）**。Node 34/34、Dart 单测 5/5、自测 31/31、Noise 向量 94/94、真实跨语言 DR RPC、两轮公网隧道起停、独立包安装与 Android AOT 门禁通过。远程 GitHub CI 已配置，尚未触发验证。

## 1. 交付内容

| 包 | 已实现 |
|---|---|
| `packages/protocol` | v1 schema、运行时验证、16 字节大端头、生成 TS/Dart DTO、冻结 Noise 与认证帧向量 |
| `packages/core` | 显式公钥绑定的 Noise XX、TCP/WS 分帧、双向 AEAD、版本/角色/能力校验、RPC、心跳、重连、逻辑流与历史补页 |
| `packages/core/dart` | 纯 Dart Noise/frame 参考、精确依赖、已知 HMAC 缺陷表征、规范/跨语言向量及真实 Node DR RPC smoke |
| `packages/tunnel` | cloudflared 进程组所有权、双管道持续排空、有限日志解析、HTTP + 实际 WS 就绪探测、停止/超时/强制清理 |
| `packages/cli` | `keygen`、`serve`、`connect`、`doctor`；诊断事件订阅与可选公网隧道 |
| 仓库验证 | 依赖锁、宿主 import 边界、公共 TS 类型消费、生成文件一致性、Node/Dart/互操作、打包安装、Android AOT 与 CI 配置 |

运行入口和具体命令见 [development.md](development.md)。M1 没有安装或修改 DSH 宿主，也没有生成、存储真实业务设备密钥。

## 2. 对 M1 验收标准的证据

| 标准 | 本轮结果 | 可复现入口 |
|---|---|---|
| 双 Node 进程加密互通 | CLI server + doctor 两独立进程完成 pinned Noise RPC；测试同时检查明文不出现在传输记录中 | `pnpm test` 的 CLI/connection 用例 |
| 断线不丢事件 | 独立 Node 服务进程产生 5 条事件，断开物理连接后再产生 25 条；控制端多页补齐，收到严格连续且无重复的 `0..29` | `packages/core/test/process.test.js` |
| 重连与 gap 修复 | opening 快照、冻结历史 cut、逆向分页、事件去重；缺失保留历史、未知必需类型、超页数明确失败 | `packages/core/test/journal.test.js` |
| 安全失败与容量边界 | 错误公钥、角色、能力越权、密文/AAD/序号篡改、心跳失联、发送积压、RPC 超时、忽略取消的下游槽位、nonce 预算耗尽均覆盖 | Node **34/34** 通过 |
| 跨语言互操作 | 正式实现复现冻结 Noise 向量；BLAKE2b 第三方 oracle 对照；Dart 与正式 Node SecureConnection 进行实际 DR hello/RPC，拒绝密文重放与错误 prologue | `pnpm test:interop`；Dart **94/94** 向量、**31/31** 自测、**5/5** 单测 |
| 隧道一键起停 | 最终真实 Quick Tunnel 两轮启动、HTTP/WS 就绪、公网加密 echo、停止，耗时 **12,900 ms / 13,563 ms**；停止后 URL 清空，无遗留活动进程 | `pnpm test:tunnel`（真实网络，非默认 CI） |
| 安装可用 | 四个本地 tarball 在独立临时目录用 `npm install --ignore-scripts` 安装，安装后的 CLI 完成两进程加密自检 | `pnpm test:package` |
| Android 可编译正式核心 | 临时 Flutter 工程直接使用正式 `dsh_remote_core` 完整 XX 握手与认证帧，release/AOT **35.6 s**；APK **43.4 MB**，`minSdk 24`、`targetSdk/compileSdk 36`，签名验证 exit 0 | `tools/android-gate.sh` |

Android 门禁产物：`.cache/m1-android-gate.apk`，SHA-256：

```text
31e3114458229b8808824b8ed7e04fd1f0e93e57ff4ec025a09fecf72512eba6
```

构建、检查和测试均在 user systemd scope 内串行执行，每次整个进程树内存 8 GiB / swap 4 GiB；未遇到 OOM 或放宽限制。该 systemd 不接受 `--scope --wait`，使用同步等待的 scope，移除不兼容的 `--wait`；包装器见 `tools/run-limited.sh`。

## 3. 本阶段修正的协议与安全结论

- 将帧序号、Noise nonce 和持久事件游标分开；WS/TCP 明确记录边界、字节序、长度与缓冲上限。
- v1 采用消息预算耗尽后新握手，禁止重置旧 nonce；不引入尚未验证的在线 Rekey 协商。
- 握手证明持有私钥，授权仍需绑定设备公钥与能力。M1 用可信本地交换的显式 pin，扫码/SAS 授权状态机留到 M2。
- `ws-pings=0` 仅证明 M0 客户端没有发送 WS 控制帧，撤回“不透传”的因果结论；应用层心跳仍验证业务路径存活。
- 隧道物理连接与协议逻辑流分别限额；429 等待容量，530 停止并请求更新地址。地址刷新保留设备公钥信任。
- 手机仅控制端减少实现范围，但不能消除已授权手机失窃后的桌面访问风险。
- DSH `follow` 没有 `sinceSeq`。M2 必须组合真实 opening snapshot 与 `page`，不能直接透传文档假设字段。

## 4. M2/M3 的边界

1. **事件存储**：M1 `EventJournal` 为有界内存诊断源，只验证断网恢复；没有声称服务进程重启后仍保留历史。M2 接入真实 DSH 持久事件、会话投影、assistant delta 与写操作幂等。
2. **配对与权限**：二维码、双方人工 SAS、本机确认、设备表、吊销、管理能力尚未实现；CLI 不接受未绑定公钥的对端。
3. **宿主功能**：真实会话、双向审批竞速、提问、子代理、文件与终端在 M2；不得将诊断 echo 当成 DSH 集成已通过。
4. **移动端与平台**：Dart 包与 Android AOT 成功不等于移动 App 可用；未运行 ARM 真机或 iOS。Windows 进程树清理还需要平台验证，密码学独立审查留作发布门禁。
5. **交付状态**：已配置 `.github/workflows/ci.yml`，本地对应检查通过；没有远程 CI 成功记录，没有 npm 发布、Git 推送或环境部署。

下一阶段应先完成一个真实 DSH 会话的配对、提示、流式输出、取消与一次审批闭环，再扩展完整能力。
