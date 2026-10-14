# M4 安全验证矩阵与审查边界

日期：2026-10-13。本文件关联威胁模型与实际验证入口；“本地通过”不代表独立安全审计或真实平台验收。

| 威胁 | 验证入口 | 当前证据/边界 |
|---|---|---|
| T1 未授权连接、T7 吊销绕过 | `audit.test.js`、`m3-mobile-smoke.mjs`、`m2-host-smoke.mjs` | 真实 Noise 连接拒绝未配对设备；吊销主动断开，重启后仍拒绝 |
| T2/T3 配对冒用/二维码重用 | `pairing.test.js`、Dart `remote_connection_test.dart` | 双方 SAS、取消/不确认不授权、错误 pin、QR 重用拒绝；真实相机操作仍延期 |
| T4 重放/重排、T5 篡改 | `security.test.js`、`connection.test.js`、Dart 连接测试、interop | 重放写不重复派发；同身份新握手拒绝旧密文；帧头/密文/序号变更失败关闭 |
| T6 降级、T15 身份混淆、T18 角色 | `security.test.js`、两端连接测试 | 无共同版本/能力、错 deviceId/pin、移动端 controlled 角色拒绝；名称不参与公钥认证 |
| T8/T9 人工审批与危险操作 | `interactions.test.js`、真实 DSH smoke | 本机/远端结算一次、撤回与超时失败关闭；许可绑定参数，一次使用后重放拒绝；审计失败不能把人工允许变成可执行许可 |
| T10 路径穿越/符号链接 | `m2-host-smoke.mjs` | `..`、工作区外 symlink 的读取及写入审批拒绝，外部模拟文件内容不变 |
| T11 握手洪泛、T12 资源 | `audit.test.js`、`security.test.js`、两端连接测试 | 10 次/分钟后返回 429 并记录 busy；物理连接/流/RPC/队列限额；释放容量后可连接；超大声明长度和 1025 小分片提前拒绝 |
| T12b/T12c 隧道容量/冷启动 | M0 公网报告、M3 公网记录 | 已有历史实测；本轮以本地 429/530 分类回归和升级探针限额验证，未重新运行公网压力测试 |
| T13 供应链 | 注册表 audit、`dependency-inventory.mjs` | 当前 Node 生产依赖公告 0；安装脚本禁用，依赖/许可证/原生 hooks 清单已记录；Apple/native 二进制完整审查未完成 |
| T14 自实现 Noise | `selftest.dart`、`verify_vectors.dart`、interop | 自测 31、向量 94、独立 BLAKE2b oracle 与跨语言互通；**第三方书面审查未完成** |
| T16 低阶点、T17 库静默错误 | 两端 Noise 测试与 Dart 自测 | 7 个低阶点、全零 DH 守卫、HMAC/BLAKE2 表征与规范向量；保留 cryptography 精确版本 |

## 分片与控制帧专项修复

新增用例发送 binary 分片 `[4,5]` → ping `[1,2,3]` → continuation `[6,7]`。
本机 Dart 3.13.5 原生 SDK 与首批 adapter 下实测只收到 `[6,7]`，前片丢失；源码 `_payload` 被数据/控制帧共享。
本轮 adapter 先检查声明与累计限额，再有界重组一条 DR message；控制载荷独立处理并立即交给 SDK。
SDK 最终收到规范化的完整 binary message，继续负责 outbound masking、pong 和写回压。
回归现在收到 `[4,5,6,7]`，并验证 masked pong 仅包含 `[1,2,3]`。网络 EOF 截断仍走 transport/lost，不误判为认证失败。
接收层最多保留一条 65551-byte DR 记录与一个 125-byte 控制载荷；片数最多 1024。此限额不表示整个 App RSS 只有这些字节。

## 模糊与压力验证

默认固定种子包含 10000 随机 DR/JSON 输入、10000 有效 DR 头变异、2000 TCP 分块，以及 Dart 10000 随机头和 2000 合法 WS 分块，共 34000 样本。
`DSH_FUZZ_ROUNDS=100000` 将同一组样本放大到 **340000**，所有测试仍在 8 GiB / 4 GiB swap 的用户 scope 内串行运行；日志位于 `.cache/m4/*-fuzz-stress.log`。
这提供可复现的压力/变异覆盖，**不等同于覆盖率引导的长期 fuzz 或穷举安全证明**。这些独立审查仍是发布前门禁。

2026-10-14 新增 `tools/coverage-fuzz.mjs`，调用 V8 precise block coverage，每条输入后测量项目 DR/TCP 源码的执行范围；只有初始语料或新增范围的输入才进入后续变异语料。
10 秒短跑通过（5564 次变异）；随后复用语料运行 **600 秒、147123 次变异**，初始执行范围 34 → 38，2 个变异输入产生新范围，最终保留 21 条语料。范围数不是覆盖率百分比。
输入最多 1024 字节、语料最多 512 条；对 DR 头/载荷做编解码往返，对 TCP 解码比较分块/合并结果，只有 ProtocolError 可作为预期拒绝。失败保留可复现 base64 输入与 PRNG 状态。
报告记录 Node 版本、源文件哈希、预算和范围，日志 `.cache/m4/coverage-fuzz-{smoke,10min}.log`，语料/报告 `.cache/coverage-fuzz`。本地 scope 内存峰值观测约 234 MiB，限额仍为 8 GiB / 4 GiB swap。
`fuzz.yml` 已准备每日 900 秒、最多 100 万变异的远端入口，但尚无远端运行结果。该入口只覆盖 Node DR 解析与 TCP 解码；Dart/Noise/WS 状态机的覆盖率引导与持续长期证据仍未完成。

## 供应链复核

库存来自实际解析/安装结果，不只依赖 manifest 的直接依赖：Node 121 个 runtime/peer 包；Dart core 50、Flutter App 75 个解析包（含 dev/SDK）。
版本、锁文件与许可证文件的 SHA-256、缺失的可选包和原生 hooks 记录在 `.cache/m4/node-dependencies.json` 与 `dart-dependencies.json`。
Node 缺失项均为可选 peer/其他 OS 二进制；库存不代表这些平台已验收。Flutter SDK 子包继承 SDK 根许可证，在清单中明确记录相对路径。

- Node 密码学原语仍为 `@noble/{ciphers,curves,hashes}` 2.4.0，精确锁定；未增加执行安装脚本的插件。
- Dart `cryptography` 2.9.0 / `crypto` 3.0.7 保持精确版本。核对实际包与项目 DH/HMAC 封装，继续走纯 Dart 原语和全零 DH 防护；原生密钥库只保护持久身份，不能称为不可导出硬件 X25519。
- `objective_c` 有 build hook，实际源码限定 iOS/macOS；不能从 Android 通过推导该 hook 已验收。
- `mobile_scanner` Android 原生依赖包含 MLKit 和 CameraX；此清单未覆盖所有 Maven/CocoaPods 二进制的漏洞、许可证与供应链保证，iOS/macOS 与平台依赖审查仍未通过。

2026-10-14 补充从实际 `releaseRuntimeClasspath` 解析的 **91 个外部 artifact / 86 个 Maven 坐标**，已记录全部 artifact SHA-256；补齐官方 Google Maven/Maven Central POM，86 个坐标的 POM 哈希均存在。OSV 对全部 86 个坐标查询，当前匹配 **0**，快照在 `.cache/m4/android-osv.json`，不是“无漏洞”证明。
80 个坐标有直接 POM 许可证声明；`auto-value-annotations`/`listenablefuture` 与 Flutter engine/embedding 的 6 个坐标缺直接声明，前两者有 parent POM，仍需继承关系与发布所需 notice 的复核。缺声明不会被库存判定为已审查通过。
Flutter 本地 plugin project 列在 `excludedProjectComponents`，不混入 Maven 公告扫描；Gradle/SDK 工具链、Apple 解析结果和平台二进制独立审查仍在范围外。日志/库存 `.cache/m4/android-{inventory.log,artifacts.json,dependencies.json,osv.log}`。

规范/包来源：[Noise 规范](https://noiseprotocol.org/noise.html)、[cryptography 2.9.0](https://pub.dev/packages/cryptography/versions/2.9.0)、[flutter_secure_storage 10.3.4](https://pub.dev/packages/flutter_secure_storage/versions/10.3.4)。本文件的实现判断来自本机源码与运行结果，不将上游包介绍当安全审计结论。

## 发布与审查边界

GitHub Actions 的 action 引用按官方仓库 tag 实际解析为 commit SHA；CI/workflow、本地候选和注册表发布分开记录。`publish-packages.mjs` 默认离线校验；写入只接受同仓库 Actions 的干净 `v0.1.0` 标签、同 SHA 的批准变量与准确 tarball 哈希。
发布回归使用独立临时目录中的 mock git/npm，检查篡改、路径越界、脏来源、错误仓库/批准、鉴权/网络失败、已有不匹配版本与部分失败，不能把 mock 成功当注册表实际发布。
私密报告表单只写入配置文件，尚未启用；独立 Noise 审查范围见 [交接材料](noise-review.md)，尚无第三方签署结论。
