# 变更日志 — DSH Remote Everywhere

本项目在 v0.1.0 之前采用"决策 + 进度"式记录，重点是**结论的变更**（尤其是被推翻的假设），
因为这比文件级 diff 更能反映项目认知的演进。

---

## 2026-10-10 — M0 已发现问题全部收口（未发布）

M0 的四个 spike 不只给出结论，还暴露出若干"文档写了但实现没有"的缺口。本阶段把它们**落地为
代码与测试**，而不是停留在文档里。

### 收口项

| # | 问题 | 收口方式 | 验证 |
|---|---|---|---|
| 1 | **X25519 低阶点攻击无防护（T16）** | 在 Noise 的**唯一 DH 入口**加全零检查：Node `NoiseXX._dh`、Dart `dh()`。守卫刻意**不下沉**到密钥生成函数（`publicKeyFromSecret` 用基点 `u=9`，已实测不会全零） | 两侧 7 个标准低阶点 + **线路层伪造低阶临时公钥**均被中止；Dart JIT/AOT 各 31 项、Node 自测全过 |
| 2 | **`ignorable` 语义只在文档里** | 协议 §9.1 明确为强制分支：未知 `type` 且无 `ignorable: true` 时必须**拒绝重建会话** | 文档已定稿；实现检查列入 M1 |
| 3 | **手机角色未定，协议 `role` 悬空** | 产品决策：**手机只做控制端**。协议 §4.2 定义 `role`/`kind`，被控端在 `hello` 阶段强制校验并拒绝非法角色，拒绝须审计 | 写入 protocol.md §4.2、security.md §5.4（T18）、architecture.md §3.1 |
| 4 | **低阶点防护的两侧不对称未被发现** | 实测发现 Node 的 `@noble/curves` **本来就会拒绝**（抛 `invalid private or public key received`），而 Dart 的 `cryptography` **完全不拒绝**。记录为对等性风险：负向测试必须两侧都跑，且断言"握手被中止"而非具体错误消息 | 两侧错误类型不同已被测试固化 |

### 收口后的完整回归（`spikes/noise-interop/scripts/run-all.sh`）

```
1/9 npm install                 OK
2/9 dart pub get                OK
3/9 Node self-tests             ALL SELFTESTS PASSED
4/9 Dart self-tests (JIT)       ALL 31 SELFTESTS PASSED
4b   Dart self-tests (AOT)      ALL 31 SELFTESTS PASSED
5/9 Node vs noise-handshake     ALL CHECKS PASSED
6/9 emit vectors                OK
7/9 Dart verifies vectors       ALL 94 CHECKS PASSED
8/9 live TCP Node <-> Dart      PASS / PASS / PASS
9/9 sodium-native layout probe  OK
=> ALL SPIKE STEPS PASSED
```

**结论**：安全强制项已从"识别"推进到"实现并验证"，且新增守卫未破坏任何既有验证
（向量 94 项、oracle 对照、真实 TCP 互操作 3/3 全部保持通过）。

### 仍未收口（需要 M1 实现时落地，非文档缺口）

- 帧层、流控、重连状态机的实现尚不存在（M1 范围）
- `ignorable` 强制分支、并发流上限、就绪探测、进程组清理等实现检查项（M1/M2 范围）

---

## 2026-10-10 — M0 风险验证：四个 spike 全部通过（未发布）

### M0 验证结果

| Spike | 结论 | 决定性问题 |
|---|---|---|
| M0-1 Flutter Android | ✅ 通过 | 项目内冷构建 **40 s**、增量 **19 s**、release/AOT **90 s**；APK 合规、签名有效；`analyze`/`test` 干净。（443 s 是本机首次构建，含引擎产物与 Gradle/AGP 全量下载，不代表常态） |
| M0-1b 密码学栈 | ✅ 通过 | 26 测试 / 129 断言在 `flutter test` 与**纯 `dart test`** 下全过；**无 C 工具链**；已在真实 Android 13 模拟器上运行并核对设备端输出 |
| M0-2 隧道 | ✅ 通过 | 13 分钟挂机 **31/31 心跳往返、0 重连**；进程重启后旧 URL 返回 **530/1033** |
| M0-3 Noise 互操作 | ✅ 通过 | 真实 TCP 上 **byte-identical** 握手，双向角色 3/3；Dart 对向量 **94/94**；Node driver 对第三方实现 **26/26** |

### M0 期间发现的关键问题（全部已定论并写入文档）

| # | 问题 | 处理 |
|---|---|---|
| 1 | **没有任何库实现 `Noise_XX_25519_ChaChaPoly_BLAKE2s`** —— `noise-handshake`/`noise-protocol` 硬编码 BLAKE2b，`@chainsafe/libp2p-noise` 硬编码 SHA256，libsodium **根本没有 BLAKE2s 原语**，Dart `noise_protocol_framework` 无 XX 模式 | 两端自实现 XX 状态机（Node ~230 行、Dart ~330 行），原语用 `@noble/*` 与 `cryptography`；见 TD-4 |
| 2 | **`cryptography` 2.9.0 的 `Hmac.blake2s()` 不是 RFC 2104 HMAC**（`blockLengthInBytes` 返回 32，真实 64）——HMAC-BLAKE2s("secret","abc") 它给 `773a1d7d…`，OpenSSL 给 `38441ee1…` | 自实现 HMAC-BLAKE2s（`B=64`），对 OpenSSL 逐字节验证；并把**错误值写成表征测试**，依赖升级时立即变红；见 security.md §4.2 |
| 3 | **`DartX25519` 不拒绝低阶点** —— 7 个标准低阶 u 坐标全部静默返回 32 个零字节 | **强制** DH 后全零检查并中止握手（T16）—— 这是真实攻击路径，且 Noise 自测**不会**暴露它 |
| 4 | **`cryptography` 的 `Blake2b` 有同类 bug**（返回 64，真实 128），且被包自身测试固化 | 否掉了"改用 BLAKE2b 以简化实现"的建议 —— Dart 侧依然要自实现 HMAC；见 TD-4a |
| 5 | **`pointycastle` 4.0.0 完全没有 BLAKE2s**，其 `ChaCha20Poly1305.process()` 对 >1 block 的消息损坏输出（后 58 字节为零、MAC 恒零） | 完全移出运行时依赖；AEAD 改用 `cryptography` |
| 6 | **Electron 44.6.0 不支持 `blake2s256`**（BoringSSL 无该摘要），而 Node 22 支持 | 生产路径改用纯 JS 的 `@noble/*`；禁止在生产路径依赖 `node:crypto` 的 BLAKE2s —— 否则会出现"CLI 能跑、Desktop 崩" |
| 7 | **隧道重启后旧 URL 返回 530 / error 1033** | 实证了"隧道 URL 建模为**一次性会话数据**（随二维码下发，不入持久配置）"的架构决定；见 TD-5 |
| 8 | 挂机日志显示 `ws-pings=0` | HTTP/2 CONNECT 承载下 WebSocket 控制帧不透传 → **必须用应用层心跳**；协议 §5.2 的 25 秒心跳据此确定 |

### 同时确认的正面结论

- 两侧**全纯实现**：零编译工具链、零 install script、零原生模块 → 不触发 pnpm `approvedBuilds`，
  也无 Electron 原生模块加载风险（与 TD-10 一致）。
- `sodium-native` 5.1.0 虽不被采用，但已实测其预编译二进制在 npm flat / pnpm isolated /
  pnpm `nodeLinker: hoisted` 三种布局下**都能加载且无需构建步骤** —— 若将来改用 BLAKE2b 套件，
  这条路是通的（代价：18 个包 / 约 18 MB）。
- 交付吞吐量实测：握手 3.4–5.3 ms/方；加密传输 Node 47–51 MiB/s、**Dart 仅 8–10 MiB/s** →
  移动端流式传输需注意，可选用 `cryptography_flutter` 做原生加速（未在真机验证）。

---

## 2026-10-10 — M0 启动，设计文档定稿（未发布）

### 新增

- 项目骨架与完整设计文档：
  - `docs/roadmap.md` —— 路线图、里程碑、验收标准、风险登记
  - `docs/architecture.md` —— 架构、集成缝隙、会话能力映射、关键决策
  - `docs/protocol.md` —— DSH Remote Protocol v1 草案
  - `docs/security.md` —— 威胁模型与安全设计
  - `docs/technology-decisions.md` —— TD-1 至 TD-11 技术选型记录
  - `docs/development.md` —— 环境事实与复现手册
- M0 三个验证 spike：`spikes/flutter-android/`、`spikes/tunnel/`、`spikes/noise-interop/`

### 决策

| # | 决策 | 依据 |
|---|---|---|
| TD-1 | 被控端为 in-process Cordis 插件，否决 SDK 子进程 | SDK 无审批通道、看不到宿主会话、无 cancel/steer |
| TD-2 | 自有 `/remote` + `/remote/ws` 传输，不复用 `/api` | `/api` 拦截器与 `registerRemoteEvents` 均为单例且已被占用 |
| TD-3 | 线上事件沿用宿主 `SessionWireEvent` | 复用宿主已验证的 follow/gap-repair 语义 |
| TD-4 | `Noise_XX_25519_ChaChaPoly_BLAKE2s` | Node 与 Dart 无单一 Noise 库，两端实现 + 向量互验 |
| TD-5 | Cloudflare Quick Tunnel 为默认隧道 | 官方确认零账号、支持 WebSocket |
| TD-6 | 自建中继采用 rathole，不自研 | 其内置 Noise 传输与需求几乎重合 |
| TD-7 | Flutter 单代码库双端 | 用户选择；iOS 仍需 macOS 出包 |
| TD-9 | 宿主服务声明为 `peerDependencies` | profile 的模块回退按 deps + peerDeps 生成 |
| TD-10 | 预编译二进制随包分发 | 避免 install script 触发 `approvedBuilds` 审批 |
| TD-11 | 核心包禁止 import `@deepseek-ai/*` | 保证核心逻辑可在无 DSH 环境下测试 |

### 被推翻的假设（重要）

| 假设 | 实际情况 | 影响 |
|---|---|---|
| 根文件系统只读，Flutter/Gradle/pub 无法写缓存 | 用户放开权限后 `/` 为 `rw`，全部可写 | 之前提出的"重定向缓存 / remount / 补装 JDK"方案**全部作废** |
| Flutter 3.35.7 / Dart 3.9.2 | 实际为 **Flutter 3.47.7 / Dart 3.13.5** | 旧报告里"`drift`/`sqflite`/`sqlite3` 需锁旧版"的结论失效，M3 需重新评估依赖 |
| Flutter SDK 在 `~/Projects/FlutterSDK` | 实际在 `/home/bruce/Android/flutter`；`~/Projects/FlutterSDK` 是空壳 | 路径必须以 `docs/development.md` 为准 |
| Android SDK 在 `/opt/android-sdk` | 实际在 `/home/bruce/Android/Sdk`；`/opt/android-sdk` 只有 platform-tools | — |
| JDK 只有 1.8，需补装 | 17 / 21 早已存在，只是 shell 默认指向 Java 8 | 无需补装 |

### 已关闭的开放项

- **O2（跨语言序列化）**：`SessionEvent.data` 由 `JsonValue` 构成
  （`packages/util/values/src/index.ts:4`），**不含** `bigint`/`Map`/`Date`/`Buffer`
  → 标准 JSON 可无损承载；`seq`/`time` 均远小于 `2^53`，无精度风险。

### 协议勘误（已修正）

- XX 模式的消息序列被改正为规范原文：`-> e` / `<- e, ee, s, es` / `-> s, se`。
  早先草案中 `es`/`se` 的所在消息位置有误，按错误顺序实现会导致两端握手均失败。
- 明确 SAS 使用的 `handshake_hash` 必须在 `Split()` **之后**通过 `GetHandshakeHash()` 取得
  （规范硬性要求）。取值过早会导致两端 SAS 永远不一致。

### 新增的强制语义

- **`ignorable` 语义**：遇到无法识别的 `type` 且没有 `ignorable: true` 时，客户端必须**拒绝
  重建会话**，不得静默丢弃（`packages/core/session/src/types.ts:477` 的注释要求）。

### M0 状态

**已完成。** 四个 spike 全部通过，结论汇总见 [docs/m0-summary.md](docs/m0-summary.md)：

- ✅ M0-1 Flutter Android 构建门禁
- ✅ M0-1b 密码学依赖验证（Dart 3.13.5 + Android 实机模拟器）
- ✅ M0-2 隧道长连接与重连、并发上限验证（条件性通过）
- ✅ M0-3 Noise 跨语言互操作验证

下一步进入 M1（`packages/{protocol,core,tunnel}` + CLI）。
