# M0 风险验证 — 执行总结

> 状态：**已完成（2026-10-10）**。四个 spike 全部通过，产出 4 份实测报告与 1 份依赖验证报告。
> 本文档是 M0 的收口文档：结论、被推翻的假设、架构修正、以及进入 M1 的前置条件。

---

## 1. 结论一览

| Spike | 结论 | 关键量测 | 报告 |
|---|---|---|---|
| **M0-1** Flutter Android 构建门禁 | ✅ **通过** | 项目内冷构建 **40 s**、增量 **19 s**、release/AOT **90 s**；debug 150,418,140 B / release 44,103,444 B；`minSdk 24`、`targetSdk 36`；ABI arm64-v8a + armeabi-v7a + x86_64；`apksigner verify` exit 0；`analyze` 干净 | [`spikes/flutter-android/REPORT.md`](../spikes/flutter-android/REPORT.md) |
| **M0-1b** 密码学依赖验证 | ✅ **通过** | 26 测试 / **129 断言**在 `flutter test` 与**纯 `dart test`** 下全通过；**无 C 工具链 / 无 build hook / 无 install script**；已在真实 Android 13（API 33 x86_64）模拟器上运行并核对设备端输出 | [`spikes/flutter-android/verify-crypto/REPORT.md`](../spikes/flutter-android/verify-crypto/REPORT.md) |
| **M0-2** 隧道传输 | ✅ **条件性通过** | **13 分钟挂机 31/31 心跳往返、0 未确认、0 断开**；URL 出现在 **stderr**，3.32–3.84 s 出现、6.2–14.6 s 首次 200；实测 **429**（220 次 → 200 开 / 20 拒）；冷启动前 ~50 s 有 **10–25%** 升级失败 | [`spikes/tunnel/REPORT.md`](../spikes/tunnel/REPORT.md) |
| **M0-3** Noise 跨语言互操作 | ✅ **通过** | 真实 TCP 上 **byte-identical** 握手，**双向角色 3/3**；Dart 对向量 **94/94 断言**；Node 自实现 driver 对第三方实现 **26/26 字节级**一致；篡改/重放/prologue 负向测试全部拒绝；**无需编译工具链**；握手 3.4–5.3 ms/方 | [`spikes/noise-interop/REPORT.md`](../spikes/noise-interop/REPORT.md) |

**总判定：M0 门禁全部通过，可以进入 M1。** 但 M0-2 的"条件性"是真实的：Quick Tunnel 只能作为
**默认的免费零账号通道**，不能作为有 SLA 的生产通道 —— 这一点已写入架构与安全文档。

---

## 2. 被推翻的假设（对后续开发最重要）

| 早期假设 | 实际情况 | 后果 |
|---|---|---|
| 根文件系统只读，需重定向缓存 / remount / 补装 JDK | 用户放开权限后 `/` 为 `rw`，缓存全部可写 | 先前一整套"绕开只读"方案**作废** |
| Flutter 3.35.7 / Dart 3.9.2 | **Flutter 3.47.7 / Dart 3.13.5** | "依赖需要锁旧版"的结论全部失效 |
| Flutter SDK 在 `~/Projects/FlutterSDK` | 实际在 **`/home/bruce/Android/flutter`**（旧路径是空壳） | 路径以 `development.md` 为准 |
| Android SDK 在 `/opt/android-sdk` | 实际在 **`/home/bruce/Android/Sdk`**（`/opt/android-sdk` 只有 platform-tools，是诱饵） | 同上 |
| JDK 只有 1.8 | 17 / 21 早已存在，且 **Flutter 会自动选用 Android Studio JBR 25** | **不要**设置 `JAVA_HOME` 指向 Java 8，会破坏 Gradle 9 |
| 首次构建 443 s 代表常态 | 那是本机**有史以来第一次** Android 构建（含引擎产物 + Gradle/AGP 全量下载） | 常态是 40 s 冷 / 19 s 增量 |
| 用 `noise-handshake` / `noise_protocol_framework` 现成实现 | **两侧都不存在可用的 `XX_..._BLAKE2s` 实现** | 两端自实现状态机；见 TD-4 |
| 用 `pointycastle` 提供 BLAKE2s | **`pointycastle` 完全没有 BLAKE2s**（只有 blake2b）；其 ChaCha20Poly1305 AEAD 对 >1 block 消息损坏 | 移出运行时依赖 |
| 用 Node 内置 `crypto` 的 `blake2s256` 省掉依赖 | **Electron 44.6.0 不支持该摘要**（BoringSSL 无 BLAKE2s），而 Node 22 支持 | 生产路径必须用纯 JS `@noble/*` |
| Cloudflare 空闲超时是 125 s（"100 s 是谣言"） | **Cloudflare 自家文档互相矛盾**（125 s vs 100 s） | 25 s 心跳对两者都安全；表述改为"文档矛盾" |
| 200 in-flight 上限只影响初次升级 | **对 WebSocket 同样生效**，实测到真实 429 | 客户端必须限制并发流 |
| JSON 日志参数是 `--logformat json` | 实际是 `--output json`（全局参数，写在 `tunnel` 之前） | 修正集成配方 |

---

## 3. 因 M0 而发生的架构修正

| # | 修正 | 影响范围 | 收口状态 |
|---|---|---|---|
| A1 | **两端自实现 Noise XX 状态机**（Node ~230 行 / Dart ~330 行），原语用成熟库 | TD-4、`packages/core` | 已验证（向量 94 + TCP 3/3 + oracle 26/26） |
| A2 | **X25519 低阶点守卫** | security.md T16、`packages/core` 的 DH 封装 | ✅ **已实现并验证**（见 §3.1） |
| A3 | **自实现 HMAC-BLAKE2s（B=64）**，禁用 `Hmac.blake2s()`/`Hkdf(Hmac.blake2s())` | security.md T17、TD-8 | 已实现，对 OpenSSL 逐字节验证 |
| A4 | **改用应用层心跳**（HTTP/2 CONNECT 下 WebSocket 控制帧不透传，实测 `ws-pings=0`） | protocol.md §5.2 | 参数已定（25 s） |
| A5 | **握手预算 ≤10 s**、重连指数退避 | protocol.md §5.3 | 参数已定 |
| A6 | **客户端并发流上限 32**，服务端超限返回 `busy`，429 与 530 分开显示 | protocol.md §5.4、security.md T12b | 参数已定 |
| A7 | **就绪探测通过前不展示隧道 URL**（冷启动窗口 10–25% 失败） | security.md T12c、TD-5 | 流程已定 |
| A8 | **隧道 URL 作为一次性会话数据**（cloudflared 重启后旧 URL 永久 530/1033） | TD-5、architecture.md D4 | 已确定 |
| A9 | **保留 BLAKE2s 而非改 BLAKE2b**（Blake2b 有同类 bug，Dart 侧仍须自实现 HMAC） | TD-4a | 已决策并记录依据 |
| A10 | **cloudflared 必须按进程组清理**（只 kill 直接 PID 会遗留流排空辅助进程） | 实现注意项 | 已记录 |
| A11 | `packages/core` 的测试必须能在纯 Dart VM 下跑（不得 import `flutter_test`） | TD-8、TD-11 | 已记录 |
| **A12** | **手机只做控制端**（协议在 `hello` 强制 `role`，被控端拒绝 mobile 作为被控） | security.md T18、protocol.md §4.2、architecture.md §3.1 | 已决策并写入协议 |

### 3.1 A2 的收口细节（值得单独记录）

补齐守卫时发现一个**两侧不对称**，这本身就是需要长期防御的风险：

| 端 | 库行为 | 我们的守卫 |
|---|---|---|
| Node（`@noble/curves`） | **本来就拒绝低阶点**，抛 `invalid private or public key received` | 仍保留，作为对库退化的防御；实际不会被执行 |
| Dart（`cryptography`） | **完全不拒绝**，静默返回 32 个零字节 | **唯一防线** |

含义：这条负向测试**必须在两侧都跑**。若只在一侧实现，另一侧可能因为换库而静默失去防护。
由于两侧错误来源与措辞都不同，跨语言一致性测试必须断言**"握手被中止"**，而不是断言具体消息。

收口验证（`spikes/noise-interop/scripts/run-all.sh`，全绿）：

| 步骤 | 结果 |
|---|---|
| Node 自测（含 7 低阶点 + 线路层伪造临时公钥） | ✅ |
| Dart 自测 JIT / AOT（各 31 项，含 7 低阶点 + 线路层攻击） | ✅ ✅ |
| Node driver vs `noise-handshake` oracle | ✅ |
| Dart 逐字节验证 Node 向量 | ✅ 94/94 |
| 真实 TCP Node↔Dart 握手（双向角色 + 负向） | ✅ 3/3 |
| 总计 | **ALL SPIKE STEPS PASSED** |

---

## 4. 可以提升为正式代码的产出物

M0 的代码不是丢弃型原型，以下产物应当直接提升进 M1 的正式包：

| 产物 | 位置 | 用途 |
|---|---|---|
| Node Noise XX 实现 | `spikes/noise-interop/node/src/noise-xx.js` | → `packages/core`（Node 侧） |
| Node 原语封装 | `spikes/noise-interop/node/src/primitives.js` | → `packages/core` |
| Dart Noise XX 实现 | `spikes/noise-interop/dart/lib/noise_xx_blake2s.dart` | → 移动端 / Dart 参考实现 |
| 测试向量 | `spikes/noise-interop/vectors/xx25519-chachapoly-blake2s.json` | → `packages/protocol` 的固定向量（CI 用） |
| 互操作与负向测试 | `spikes/noise-interop/node/src/selftest.js`、`validate-vs-noise-handshake.js`、`dart/bin/verify_vectors.dart`、`scripts/run-all.sh` | → CI 测试套件 |
| Dart 原语向量测试 | `spikes/flutter-android/verify-crypto/verify_crypto_app/test/noise_primitives_test.dart` | → `packages/core`（含表征测试，锁住库的错误值） |
| 隧道管理与 stderr 解析 | `spikes/tunnel/start-tunnel.sh`、`server.mjs`、`client.mjs`、`probe-*.mjs` | → `packages/tunnel` |
| 隧道长连接/重连/并发探针 | `spikes/tunnel/probe-reliability.mjs`、`probe-concurrency.mjs`、`probe-upgrade.mjs` | → CI 与本地诊断工具 |

**提升时的必做清理**：移除 `noise_protocol_framework` 与 `pointycastle`（spike 的 `pubspec.yaml`
里仅为记录解析版本而声明），移除 `@noble` 之外的 Node 验证用依赖（`noise-handshake`、
`sodium-native` 仅保留为 devDependency oracle）。

---

## 5. M1 进入条件（Definition of Ready）

- [x] 三个技术不确定项全部有确定结论（构建、隧道、密码学互操作）
- [x] 密码学依赖在目标运行时（Dart 3.13.5 / Android）与目标宿主形态（Electron）下均已验证
- [x] **安全强制项已落地而非仅记录**：T16（低阶点守卫）已在两端实现并通过回归测试；
  T17（HMAC 自实现 + 表征测试）已落地；T18（手机只做控制端）已写入协议
- [x] 协议草案定稿到可实现粒度（帧格式、方法表、流语义、重连参数、并发上限、角色模型）
- [x] 环境与复现流程已文档化（`development.md`）
- [ ] 把 M0 产出物提升为 `packages/{protocol,core,tunnel}` 的初始代码
- [ ] 建立仓库级检查：`packages/{protocol,core,tunnel}` 不得 import `@deepseek-ai/*`
- [ ] 建立 CI：Node 单元测试 + Dart 纯 VM 测试 + 向量互操作 + Android 构建

---

## 6. 仍然开放的风险（带入 M1/M2）

| 风险 | 等级 | 说明 |
|---|---|---|
| 自实现的密码学握手无第三方审计 | **高** | M4 前必须做审查；缓解手段已在 §3 A1–A3 落实 |
| `@noble` 与 `cryptography` 实质为单一维护者 | 中 | 已锁精确版本 + 表征测试；M4 做供应链审查 |
| DSH 核心处于 alpha（`0.1.6-alpha.2`） | **高** | 插件只依赖 `ctx` 服务与线上协议，加运行时特性探测 |
| Swift/Swift 侧 iOS 全部依赖只能在 Mac 验证 | 中 | M3 起即建 macOS CI |
| Dart 传输吞吐仅 8–10 MiB/s | 中 | 移动端大文件/长历史需分页或原生加速 |
| Quick Tunnel 无 SLA + 域名漂移 | 中 | 已建模为一次性会话数据；保留自建中继 seam |
