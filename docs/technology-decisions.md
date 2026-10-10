# 技术选型记录 — DSH Remote Everywhere

> 每条记录包含：选择、依据（证据等级）、被否决的替代方案、以及残余风险。
> 证据等级：**[实测]** 本机实际运行验证 / **[源码]** 直接阅读源码确认 /
> **[官方文档]** 官方文档确认 / **[推断]** 基于上述事实的推理，尚未实测。

最后更新：2026-10-10（M0 进行中）

---

## TD-1：被控端形态 —— in-process Cordis 插件

**选择**：运行在 DSH 宿主进程内的 Cordis 插件，打包为 profile bundle。
**否决**：SDK stdio 子进程（`packages/sdk/client`）；修改 DSH 核心。

**依据** **[源码]**：

| 需求 | in-process | SDK 子进程 |
|---|---|---|
| 看到宿主真实会话 | ✅ | ❌ 只能看到自己的运行时 |
| 列出/搜索会话 | ✅ | ❌ 无此 RPC |
| 文本 delta | ✅ `agent/assistant-stream` | ❌ 仅持久 `session.event` |
| 响应审批 | ✅ `approval/request` | ❌ **完全无审批通道** |
| cancel / steer | ✅ | ❌ 无此 RPC |
| 版本耦合 | 宿主服务 peer deps | 与 `@deepseek-ai/dsh` **必须完全同版本** |

**另有官方先例** **[源码]**：`packages/acp/acp/src/index.ts:155` 正是"在进程内驱动宿主会话并
通过外部传输代理审批"的实现。它被选为本项目的架构模板。

**残余风险**：宿主的 alpha 版本 API 漂移 → 只用 `ctx` 服务与线上协议，加运行时特性探测。

---

## TD-2：传输端点 —— 自有监听，不复用 `/api`

**选择**：插件自起 HTTP 监听（默认 `127.0.0.1`），注册 `register(prefix '/remote')` 与
`registerUpgrade('/remote/ws')`，自行实现配对鉴权。

**否决**：复用 DSH 的 `/api` 通道。

**依据** **[源码]**：

1. `connection.rpc.intercept` 每个通道**只允许一个**拦截器，`ctx.typertGateway` 已占用 `/api`
   （`packages/client/connection/src/rpc-host.ts:198`）。
2. `typertGateway.registerRemoteEvents()` 是单例，已被 `api-remotes` 在 web/desktop profile
   注册；重复调用抛 `already registered`（`packages/api/gateway/src/index.ts:243`）。
3. `packages/host/webserver` 的 Config 只接受 `127.0.0.1` 或 `0.0.0.0`，且其 README 明确说明
   服务器**自身不提供 TLS、认证或 origin 策略** → 绝不能把 DSH GUI 暴露到公网。

**正面副作用**：协议完全自持，Flutter 端无需理解 Typert 的生成产物。

**残余风险**：需要自己实现鉴权（不能借用 `BrowserAuth`，它是 connection 插件的私有实现）。

---

## TD-3：线上协议以 DSH 事件词汇为中心

**选择**：帧载荷包裹宿主自己的 `SessionWireEvent`（`{type, seq, time, data, …}`），并复用
`replace/prepend/append/settle-assistant` 流语义与 gap 修复机制。

**否决**：自定义一套独立的事件模型。

**依据** **[源码]**：`packages/api/session-controller/src/types.ts:428`；
`packages/api/session-controller/README.md` 描述了完整的 `SessionEventStream` 行为（opening
快照、`loadOlder`/`loadThrough`、gap 触发重开 follow、仅物理载体丢失才自动恢复）。

**收益**：不自创重连逻辑（这是最容易出错的部分）；宿主新增事件类型时插件天然兼容。

**已验证的兼容性条件（开放项 O2 已关闭）** **[源码]**：

- `SessionEvent.data` 的每个成员类型最终由 `JsonValue` 构成
  （`packages/util/values/src/index.ts:4`：`null | boolean | number | string | JsonValue[] |
  { [key: string]: JsonValue }`），**不含** `bigint`/`undefined`/`Map`/`Date`/`Buffer`
  → 标准 JSON 可无损承载，不需要自定义编解码层。
- `seq: SessionSeq` 是 branded number，`time` 是 epoch 毫秒，均远小于 `2^53` → 无精度风险。

**必须实现的语义（否则是正确性缺陷）** **[源码]**：`ignorable` 缺失表示**必需**事件。
`packages/core/session/src/types.ts:477` 的注释明确要求：遇到无法识别的 `type` 且没有
`ignorable: true` 时，读取方 **MUST refuse to reconstruct the session**，而不是静默丢弃。
详见 [protocol.md](protocol.md) §9.1。

**残余风险**：无（序列化层面已确认）。仍需注意宿主新增**帧 kind** 时才需要递增主协议版本。

---

## TD-4：端到端加密 —— Noise_XX_25519_ChaChaPoly_BLAKE2s

**选择**：Noise Protocol Framework，XX 模式（互相认证静态密钥，无需预先交换公钥）。

**否决**：
- **libsodium `crypto_kx` + `crypto_secretbox`**：原语简单，但 `crypto_kx` 本身不提供认证与
  前向保密，等于自己设计一个类 TLS 协议 —— 正是自研密码学最常出事的地方。
- **WireGuard**：协议设计优秀，但 Node 需 `wg`/`wireguard-go` 且要 root/TUN；Dart/Flutter
  没有官方可嵌入实现。
- **TLS 1.3 + 双向客户端证书**：两端平台原生支持最好，但 Dart 在移动端的客户端证书路径较
  繁琐，且"relay 完全盲"的叙事需要额外在应用层再做一层 AEAD。

**依据** **[源码/实测]**：调研与 M0-3 spike 共同证明了一件事 —— **Node 与 Dart 都不存在可用的
现成 Noise_XX_25519_ChaChaPoly_BLAKE2s 实现**，两端都必须自己实现 XX 状态机：

| 端 | 候选 | 实测结论 |
|---|---|---|
| Node | `noise-handshake` 4.2.0 | ❌ **硬编码 BLAKE2b**（libsodium `crypto_generichash`），不是 BLAKE2s |
| Node | `noise-protocol` 3.0.2 | ❌ **硬编码 BLAKE2b**（`hmac-blake2b`），且已停止维护 |
| Node | `@chainsafe/libp2p-noise` 17.0.0 | ❌ **硬编码 Noise_XX_25519_ChaChaPoly_SHA256** |
| Node | libsodium / `sodium-native` | ❌ **根本不提供 BLAKE2s 原语**，只有 BLAKE2b |
| Dart | `noise_protocol_framework` 1.2.0 | ❌ **只实现 NKpsk0/KNpsk0，没有 XX 模式**，且硬编码 HKDF-SHA256 |
| Dart | `noise_protocol` 0.1.1 | ❌ SDK 约束 `<3.0.0`，在 Dart 3.x 上**无法解析**，已死 |

**最终方案 —— 两端自实现状态机，原语复用成熟实现**：

| 端 | Noise 状态机 | 原语来源 | 依赖性质 |
|---|---|---|---|
| Node | **自实现**（约 230 行，按规范 §5–§7） | `@noble/hashes` 2.4.0（BLAKE2s/HMAC/SHA-256）、`@noble/curves` 2.4.0（X25519）、`@noble/ciphers` 2.4.0（ChaCha20-Poly1305） | **纯 JS**，3 个包，无原生依赖 |
| Dart | **自实现**（约 330 行） | `cryptography` 2.9.0（`DartX25519`、`DartBlake2s`、`DartChacha20.poly1305Aead()`）、`crypto` 3.0.7（SHA-256） | **纯 Dart**，无 FFI / 无平台通道 |

**M0-3 实测**：两侧自实现在**真实 TCP 连接**上完成了 byte-identical 握手（3/3 驱动组合通过），
Dart 侧对 Node 生成的向量文件通过 **94 项断言**；Node 侧的自实现 driver 另与第三方
`noise-handshake` 在 BLAKE2b 套件上做过 **26/26 项字节级交叉验证**，证明状态机逻辑（token 顺序、
DH 顺序、HKDF 形状、AEAD nonce 编码、`Split()`）正确 —— 这正是"自实现"能站得住脚的依据。

### ⚠️ 两个必须绕开的库缺陷（实测发现）

1. **`cryptography` 2.9.0 的 `Blake2s.blockLengthInBytes` 返回 32，而 BLAKE2s 的真实 block
   是 64 字节**（已用 [RFC 7693](https://www.rfc-editor.org/rfc/rfc7693.txt) 独立核实：
   `Block bytes | bb = 128 (BLAKE2b) | bb = 64 (BLAKE2s)`）。
   后果：直接用该包的 `Hmac(Blake2s())` 会产出**错误的 HMAC tag**，进而让整个 HKDF 链错掉。
   → **必须自己实现 HMAC-BLAKE2s（约 15 行）**，用其无 key 的 BLAKE2s 哈希 + `BLOCKLEN = 64`。
   这已通过"HKDF 链在全部 12 个 trace 步骤上与 Node `@noble` 逐字节一致"得到验证。

2. **`pointycastle` 4.0.0 的 `ChaCha20Poly1305.process()` 对超过一个 block 的消息不可用**：
   实测 114 字节明文 → 输出 114 字节但**后 58 字节全为零**，`cipher.mac` 恒为零，
   Poly1305 tag 既不追加也不校验。→ 使用 `cryptography` 的 `DartChacha20.poly1305Aead()`
   （已对 RFC 8439 §2.8.2 向量验证）。另：`pointycastle` **不提供 BLAKE2s**（只有
   `blake2b.dart`），因此它在本项目中**完全不被使用**。

### 被否决的候选（逐个核查过，不是假设）

| 候选 | 版本 | 不可用原因 |
|---|---|---|
| `noise-handshake` | 4.2.0 | 硬编码 BLAKE2b（`hkdf.js` 的 `HASHLEN=64`、`hmac.js` 用 `crypto_generichash`、协议名里写死 `'BLAKE2b'`） |
| `noise-protocol` | 3.0.2 | 依赖 `hmac-blake2b`，同样只有 BLAKE2b；已停止维护 |
| `@chainsafe/libp2p-noise` | 17.0.0 | 硬编码 `Noise_XX_25519_ChaChaPoly_SHA256`，且与 libp2p 接口耦合 |
| libsodium / `sodium-native` | 5.1.0 | **根本没有 BLAKE2s 原语**（313 个导出符号逐个检查，blake2s 数量为 0）；且引入 18 个包、约 18 MB 预编译产物 |
| `noise-curve-ed` | 2.1.0 | `ALG = 'Ed25519'`，会让协议名静默变成 `Noise_XX_Ed25519_ChaChaPoly_BLAKE2b` |
| `noise_protocol_framework` (Dart) | 1.2.0 | **没有 XX**（只有 `NKpsk0`/`KNpsk0`）；`KeyDerivation.deriveKey` 硬编码 HKDF-SHA256；`CipherState.empty()` 分配 32 字节零密钥使 `hasKey` 在任何 `MixKey` 之前就为 `true`，属规范违规 |
| `noise_protocol` (Dart) | 0.1.1 | SDK 约束 `>=2.5.0 <3.0.0`，Dart 3 无法解析 |
| `pointycastle` (Dart) | 4.0.0 | 无 BLAKE2s；ChaCha20Poly1305 AEAD 不可用（见上） |
| `noise-c.wasm` | 0.4.0 | 原理可行，但需要 Emscripten/WASM 运行时与定制 JS API；纯实现已够用 |

**注**：`noise_protocol_framework` 与 `pointycastle` 仅作为"已评估"记录（spike 的 `pubspec.yaml`
里声明以取得解析版本），**提升为正式代码前必须移除**。

### 关于 `sodium-native` 的补充结论（虽不采用，但已实测）

如果将来改用 BLAKE2b 套件，`sodium-native` 5.1.0 是可行且**不触发任何审批流**的：其 `scripts`
只有 `test`/`test:node`/`test:bare`，**没有 install script**，预编译二进制直接随 tarball 分发
（linux-x64 为 919,464 字节），并且在 npm flat、pnpm isolated、pnpm `nodeLinker: hoisted`
三种布局下都能加载并完成握手。但代价是 18 个包 / 约 18 MB，而 `@noble` 只要 3 个包。既然
BLAKE2s 是选定套件，`sodium-native` 不会出现在依赖树里。


### 为什么不用 Node 内置 `crypto` 的原生 BLAKE2s（实测教训）

Node 22 的 `crypto` 确实提供 `blake2s256`（已用已知向量验证：
`BLAKE2s-256("abc") = 508c5e8c327c14e2e1a72ba34eeb452f37458b209ed63a294d999b4c86675982`），
看起来可以省掉依赖。**但这在 DSH Desktop 下会崩**：

```
$ ELECTRON_RUN_AS_NODE=1 <electron> -e "require('crypto').createHash('blake2s256')"
electron-as-node 44.6.0 v24.21.0
blake2s256: FAIL Digest method not supported
x25519: ok
```

Electron 使用 **BoringSSL**，而 BoringSSL **不提供 BLAKE2s**摘要。DSH Desktop 运行在 Electron 上，
且本插件的 bridge/子进程以 `process.execPath`（即 Electron 二进制）+ `ELECTRON_RUN_AS_NODE=1`
启动 —— 这正是 `dsh-codex-chrome` 采用的方式。因此：

- **生产路径必须使用纯 JS 的 `@noble/*`**，不能依赖 `node:crypto` 的 BLAKE2s。
- `node:crypto` 的 `x25519` 与 `chacha20-poly1305` 在 Electron 下**可用**，但为了两端行为一致与
  可审计性，统一使用 `@noble/*`，避免"CLI 能跑 Desktop 崩"这类环境相关的间歇性故障。
- 建议在测试中做一次**双实现交叉校验**（`@noble` vs `node:crypto`，仅在 `blake2s256` 可用时
  执行），把 Electron 的缺失记录下来而不是让它变成一个运行期惊喜。


这个结论比原方案更好：

1. **零编译工具链** —— 两端都是纯 JS / 纯 Dart，彻底消除了 `sodium-native` 原生模块在打包后
   profile 中加载失败的风险（原 TD-4 的残余风险直接消失）。
2. **零 install script** —— 不触发 pnpm 的 `approvedBuilds` 审批流（与 TD-10 一致）。
3. **状态机本来就要自己写** —— 既然"用某个库"的方案不存在，"自己写状态机 + 用成熟原语"是唯一
   可行路径，而不是一个更差的选择。
4. **互为验证** —— Node 侧同时保留一份 `noise-handshake`（BLAKE2b）的字节级交叉验证，用来证明
   自实现的状态机 driver 与第三方实现逐字节一致（BLAKE2b 只用于这个验证，不用于生产协议）。

**残余风险（高）**：自实现的状态机可能有实现级缺陷。缓解措施：

- 与 `noise-handshake` 做 BLAKE2b 套件的**字节级交叉验证**，证明 driver 逻辑正确；
- 生成固定的测试向量文件，Node 与 Dart 两侧逐字节互验；
- 负向测试：密文篡改、重放、prologue 不匹配、消息顺序错乱；
- 特别容易写错的点已在 [protocol.md](protocol.md) §4.1/§4.2 记录（`es`/`se` 位置、
  `GetHandshakeHash()` 必须在 `Split()` 之后取）；
- M4 前做第三方审查。

**降级方案**：若互操作无法达成，退回 TLS 1.3 双向证书 + 应用层 AEAD（两端平台原生支持最好，
代价是失去"中继完全盲"的最强叙事）。

---

## TD-4a：为什么最终保留 BLAKE2s 而不是改用 BLAKE2b

M0-3 spike 结束时提出了一个值得认真对待的反向建议：*"BLAKE2s 把我们锁在所有现成实现之外；
如果套件还能改，`Noise_XX_25519_ChaChaPoly_BLAKE2b` 会消除整个 Dart 障碍和大部分 Node 自定义
代码"*。该建议的事实前提是"`cryptography` 包有 BLAKE2b"——**这一点已核实为真**
（`lib/src/dart/blake2b.dart` 存在且 `Blake2b` 已导出）。但它**不能**消除 Dart 障碍，原因如下。

### 决定性反证：`cryptography` 的两个 BLAKE2 都有 `blockLengthInBytes` bug

该包自带测试 `test/algorithms/blake2b_test.dart` 写着：

```dart
expect(algorithm.hashLengthInBytes, 64);
expect(algorithm.blockLengthInBytes, 64);   // ← BLAKE2b 的真实 block 是 128
```

对照 [RFC 7693](https://www.rfc-editor.org/rfc/rfc7693.txt)：
`Block bytes | bb = 128 (BLAKE2b) | bb = 64 (BLAKE2s)`。

| 算法 | 真实 block | `cryptography` 2.9.0 返回 | 后果 |
|---|---|---|---|
| BLAKE2s | 64 | **32** | `Hmac(Blake2s())` 产出错误 tag |
| BLAKE2b | 128 | **64** | `Hmac(Blake2b())` 产出错误 tag |

两者的错误**恰好都是减半**，且**都被包自身的测试固化为"期望行为"**，因此短期内不会修。结论：
**换成 BLAKE2b 后，Dart 侧仍然必须自己实现 HMAC**，与套件选择无关。

### 完整取舍对比

| 维度 | BLAKE2s（选定） | BLAKE2b（被否决） |
|---|---|---|
| Node 侧 | 自实现 XX（约 230 行）+ `@noble` **3 个纯 JS 包** | 可用 `noise-handshake` 原生支持，但需引入 `sodium-native`：**18 个包 / 约 18 MB 预编译产物** |
| Dart 侧 | 自实现 XX（约 330 行）+ `cryptography`/`crypto`，**需自实现 HMAC-BLAKE2s** | **同样**需自实现 XX（`noise_protocol_framework` 无 XX）+ 自实现 HMAC-BLAKE2b |
| 依赖性质 | 两侧**全部纯 JS / 纯 Dart**，零原生、零 install script | 引入原生 `.node` 模块（Electron/打包场景有加载风险） |
| 验证状态 | **已端到端验证**：向量 + 真实 TCP 互操作 + 负向测试全部通过 | 需**全部重做**：新向量、新 oracle 对照、新负向测试 |
| 生态可用性 | 无现成实现，但已证明自实现可行 | Node 有现成实现；Dart 无 |

### 决定

**保留 `Noise_XX_25519_ChaChaPoly_BLAKE2s`。** 理由：

1. 该建议的核心卖点（"消除整个 Dart 障碍"）**不成立** —— Dart 侧仍然要自实现 XX 与 HMAC。
2. 唯一实际收益是"Node 少写约 230 行"，代价是引入 18 个包 / 18 MB 原生依赖，并让全部安全验证
   从"已通过"退回"待重做"。
3. 我们**已经**为 BLAKE2s 建立了三重证据（与第三方在 BLAKE2b 下的字节级 driver 交叉验证、
   94 项向量断言、真实 TCP 互操作 + 篡改/重放/prologue 负向测试）。改套件等于把这部分工作丢掉。
4. 两侧全纯实现是我们明确想要的属性：零编译工具链、零 install script、无 Electron 原生模块
   加载风险（而与 TD-4 记录的一致，Electron 连 `node:crypto` 的 BLAKE2s 都不提供）。

**该取舍已记录在案**；若将来出现"BLAKE2b 的 Dart 生态成熟到能直接替代自实现"的变化，应重新
评估，评估的判据是"是否仍需自实现 HMAC 与 XX 状态机"，而不是"规范名字是否常见"。


## TD-5：隧道 —— Cloudflare Quick Tunnel 为默认

**选择**：`cloudflared tunnel --url http://127.0.0.1:PORT`，零账号一键。

**依据** **[官方文档/实测]**（M0-2 spike，`spikes/tunnel/REPORT.md`）：

| 事实 | 值 |
|---|---|
| 账号要求 | **无**，官方明确"不需要 Cloudflare 账号或域名" |
| WebSocket | **官方支持** ✅ |
| SSE | **官方不支持** ❌（与本项目无关，我们用 WSS） |
| URL 输出位置 | **stderr**，不是 stdout（实测 stdout **0 字节**，stderr 6.3 KB） |
| URL 出现 / 可达耗时 | 3.32–3.84 s 出现；首次 HTTP 200 在 6.2–**14.6 s** |
| 冷 WSS 握手 | 约 0.4 s（隧道已预热时） |
| 挂机稳定性 | **13 分钟 31/31 心跳往返、0 未确认、0 断开**，RTT p50 126 ms |
| 空闲超时 | Cloudflare **自家文档互相矛盾**（Error 524 页说 125 s，connection-limits 表说 100 s）→ 25 s 心跳对两者都安全 |
| 限制 | 无 SLA；每次重启域名都变；**200 in-flight 上限**（见下） |
| 分发 | Apache-2.0（已在 release tag 核实）；linux-amd64 38.3 MB、linux-arm64 35.9 MB、darwin-amd64.tgz 20.7 MB、darwin-arm64.tgz 18.9 MB、windows-amd64.exe 52.8 MB；**无 Windows arm64 资产**，macOS 仅 `.tgz` |

### ⚠️ 四条改变插件实现的实测发现

1. **200 in-flight 上限对 WebSocket 同样生效，且实测到了真实的 429。**
   220 次尝试 → 恰好 **200 成功 / 20 被拒**；260 次 → 200/60；保持 200 条连接时，第 201 条 raw
   upgrade 返回 `HTTP/1.1 429 Too Many Requests`。官方文档"只有初次升级计入"的说法与实测不符。
   → **必须客户端限制并发流数量**；且 429 **重试无法解决**（需要已有流关闭），必须与 530 区分对待。
   注意 `undici` 会把 429 伪装成泛化的 "non-101" 错误，因此错误处理应使用 `ws` 或 raw upgrade。

2. **未文档化的冷启动窗口** —— 新隧道建立后的**前约 50 秒**，`ws` 与 undici 的冷升级失败率
   **10–25%**；而在**同一 URL、同一时刻**，raw `node:tls` 的 RFC6455 握手 **0/96 失败**（边缘端
   接受每一次 raw upgrade）。→ **"URL 打印 + HTTP 200" 不等于就绪**。集成必须：
   预热度探测 + 短退避重试，且**在确认就绪之前不要把 URL 展示给用户**。

3. **两种重连故障必须区分处理**：

   | 故障 | 客户端观察 | URL | 恢复 |
   |---|---|---|---|
   | **origin 被杀**（DSH 宿主/插件重启） | ~1.3 s 后 `CLOSE code=1006, reason="", wasClean=false` | **保持有效** | 同一 URL 即可复用（实测 http 200 + WSS OPEN 435 ms） |
   | **cloudflared 被杀** | 连接断开 | **永久失效**，返回 `HTTP 530` / body `error code: 1033` | 必须重新建隧道并**重新发布 URL** |

   → 握手预算应 **≤10 s**（spike 用 20 s 预算时，一次尝试被死 origin 白白耗尽）。

4. **JSON 日志参数是 `--output json`（全局参数，必须写在 `tunnel` 之前），不存在 `--logformat`。**
   另外 URL 解析依赖 stderr，且**必须持续 drain stderr**，否则管道缓冲会写满并**卡死 cloudflared**。

### 其它集成陷阱

- **进程组清理**：只 kill cloudflared 的直接 PID 会**遗留流排空辅助进程**（孤儿）。必须
  detached spawn + kill **进程组**，然后 await 退出。
- **`--allowed-mail` 不可用**：官方明确其邮箱认证"需要交互式浏览器会话，不支持非交互客户端"，
  与程序化 WSS 客户端不兼容。

**否决**：
- **ngrok 免费版**：**需要账号 + authtoken**，不满足"零账号"。
- **localtunnel**：npm 2.0.2（2023-11 最后发布），事实上已失维护，长期 502/503 报告。
- **Tailscale Funnel**：需要 tailnet + 账号，且端口受限（443/8443/10000）。
- **zrok**：托管免费层需要账号。

**备选 seam**（架构上保留可插拔）：`ssh -R`（Pinggy / srv.us，零账号）、named tunnel 或自定义
域名（稳定 URL）、自建中继（见 TD-6）。

**残余风险**：无 SLA + 域名漂移不适合当生产级默认 → 已把 URL 建模为**一次性会话数据**（随
二维码下发，不入持久配置），并为回头用户保留稳定通道。

---

## TD-6：自建中继 —— 不自研，采用 rathole

**选择**：自建中继场景直接采用 **rathole**（Apache-2.0，Rust，~500 KiB）。

**依据** **[源码/官方文档]**：rathole 内置
`Noise_NK_25519_ChaChaPoly_BLAKE2s` 传输，且支持按服务的强制 token —— 与本项目需求几乎完全
重合。`frp` 功能更全（HTTP vhost、XTCP 打洞、dashboard，v0.50.0 起默认启用 TLS），作为需要
HTTP 路由时的备选。

**否决**：从零写中继（无谓的工作量）；把裸 TCP 转发（`bore`）当中继而不在其上做 E2E ——
`bore` 的 README 明确"默认不对后续流量加密"。

**残余风险**：自建中继的运维成本由用户承担；成本驱动因素是 egress 字节数（交互式控制通道
本身极轻，屏幕/文件传输才是大头）→ 设计中需要按设备字节配额。

---

## TD-7：移动端 —— Flutter 单代码库（Android + iOS）

**选择**：Flutter，一份代码双端。

**依据** **[实测]**（本次会话推翻了一次早期错误报告）：

| 事实 | 值 |
|---|---|
| Flutter | **3.47.7 stable**，位于 `/home/bruce/Android/flutter`（`~/Projects/FlutterSDK` 是空壳） |
| Dart | **3.13.5** |
| Android SDK | `/home/bruce/Android/Sdk`（**不是** `/opt/android-sdk`，后者只有 platform-tools） |
| JDK | 17 / 21 均可用（`/usr/lib/jvm/`），另有 Android Studio JBR 25 |
| 根文件系统 | **已是 `rw`**（早期报告中的 `ro` 前提已失效） |
| iOS | **本机不可能**：Flutter 工具硬性 `bool get supported => globals.platform.isMacOS`，无 Xcode/Swift/Apple SDK |

**iOS 现实约束**：必须 macOS + Xcode。免费 Apple ID 可做 7 天开发签名（限 3 个 App、仅注册
设备），**Ad-hoc / TestFlight / App Store 需要 99 美元/年**。→ M3 起即建 macOS CI，不留到最后。

**否决**：两端各自真原生（Swift + Kotlin）—— 用户明确选择 Flutter；虽然 iOS 侧仍需 Mac 出包，
但业务逻辑与协议实现可共享一份，这是净收益。

**残余风险**：iOS 的插件（相机扫码、Keychain、SQLite）只能在 Mac 上验证正确性。

---

## TD-8：Dart 侧网络与密码学库

| 用途 | 选择 | 依据 |
|---|---|---|
| WebSocket | `web_socket_channel`（纯 Dart） | 无平台通道；本地 pub-cache 已有 |
| X25519 / ChaCha20-Poly1305 | `cryptography` **精确锁定 `2.9.0`（不用 `^`）** | 已在 Dart 3.13.5 与 Android 上验证；但**必须**外挂全零守卫（T16） |
| BLAKE2s | `cryptography` 2.9.0 的 `Blake2s` / `DartBlake2s` | `pointycastle` **完全没有 BLAKE2s**（只有 `blake2b.dart`），不可用 |
| SHA-256（SAS） | `crypto` 3.0.7 | 已在向量下验证 |
| HMAC-BLAKE2s | **自实现**（RFC 2104，`B = 64`，约 20 行） | 包的 `Hmac.blake2s()` **不是 RFC 2104 HMAC**（见下） |
| Noise HKDF | **自实现** | 依赖自实现的 HMAC，并含 HASHLEN=64 时取前 32 字节的截断规则 |
| Noise 96-bit AEAD nonce | **自实现**（`4 零字节 \|\| LE64(counter)`） | 已对 Python 独立实现核对 counter 0/1/2/`0x0102030405060708` |
| Noise 实现 | **自实现 XX 状态机**（见 TD-4） | 无任何 Dart 库实现 XX + BLAKE2s 组合 |
| 二维码扫描 | `mobile_scanner` | 需要平台通道（CameraX / AVFoundation） |
| 每设备密钥 | `flutter_secure_storage`（Keychain / Keystore） | 需要平台通道 |
| 本地消息存储 | 待定（M3） | 早期"必须锁旧版"的结论随 Dart 3.13.5 已失效，需重新评估 |

**已排除**：
- `pointycastle` 4.0.0 —— **无 BLAKE2s**；且其 `ChaCha20Poly1305.process()` 对超过一个 block 的
  消息不可用（114 字节输入 → 输出后 58 字节为零、MAC 恒零、tag 既不追加也不校验）。
  仅可作为 CI 中 SHA-256 的第二意见，**不进运行时依赖**。
- `cryptography_flutter` 2.3.4 —— 可选原生加速插件，会把 `packages/core` 变成 Flutter 依赖，
  且**同样没有 BLAKE2s**。仅移动端可选，不进 core。
- `noise_protocol_framework` 1.2.0、`noise_protocol` 0.1.1 —— 见 TD-4。

**`packages/core` 的依赖卫生要求**：测试必须能在**纯 Dart VM** 下跑（`dart test`），因此 core 的
测试目录里**不得**出现 import `flutter_test` 的文件（Flutter 应用目录无法 `dart test` 整棵树）。

### `cryptography` 2.9.0 的两个强制缓解措施

| # | 问题 | 缓解 |
|---|---|---|
| 1 | `Hmac.blake2s()` **不是 RFC 2104 HMAC**：`Blake2s.blockLengthInBytes` 返回 32（真实 64），DartHmac 用它作为 ipad/opad 的补长。实测 HMAC-BLAKE2s("secret","abc")：OpenSSL = `38441ee1…`，本包 = `773a1d7d…`；HKDF 同样错。危险在于**自测自洽**：与自己的实现互通，与第三方实现静默不通 | 自实现 HMAC-BLAKE2s（`B = 64`），已对 OpenSSL 在 key 长度 6/32/100（含 >64 需先哈希的分支）下逐字节验证；并把错误值写成**表征测试**，依赖升级时立即变红 |
| 2 | `DartX25519` **不拒绝低阶点**：7 个标准低阶 u 坐标全部静默返回 32 个零字节 | 每次 DH 后强制全零检查并中止握手（统一封装，不允许调用点绕过）——详见 [security.md](security.md) §4.1 |

**否决**：`flutter_webrtc` —— 重量级原生二进制、无纯 Dart 回退、iOS 侧无法本机验证；对
加密控制通道而言普通 WebSocket 更合适。仅在将来需要媒体或 P2P 打洞时再考虑。

---

## TD-9：插件依赖模型 —— 宿主服务用 peerDependencies

**选择**：`@deepseek-ai/cordis`、`@deepseek-ai/dsh-session`、`@deepseek-ai/dsh-api-session-controller`、
`@deepseek-ai/dsh-user-approval`、`@deepseek-ai/dsh-host-webserver` 等声明为 `peerDependencies`。

**依据** **[源码]**：profile 以 `nodeLinker: hoisted` 创建，并按 `dependencies` **和**
`peerDependencies` 做 BFS 生成模块回退目录（`packages/boot/app-boot/src/profile.ts:466`；
源码注释明确："Peer dependencies participate: Service Definition packages … are peers of their
implementations, never plain dependencies, yet out-of-tree plugins import them directly"）。

**禁止**：插件自带第二份 core 副本。

**残余风险**：这些包目前都是 `0.1.6-alpha.2`，插件必须声明支持版本区间并做运行时探测。

---

## TD-10：预编译二进制随包分发

**选择**：cloudflared 二进制作为 npm 包的 `files` 内资产，不做 postinstall 下载。

**依据** **[源码]**：pnpm 11 把依赖 install script 收在 profile 的 `allowBuilds` 下，
`plugin_manager` 以 `pendingBuilds` 暴露并要求调用方通过 `approvedBuilds` 显式批准
（`packages/boot/plugin-manager/src/build-approval.ts`）。预编译资产没有 install script →
**不触发审批弹窗**，安装体验干净。tarball 的 `files` 原样安装且保留可执行位。

**备选**：`optionalDependencies` + `os`/`cpu` 做按平台选择（体积更小，但包管理复杂度略高）。
postinstall 下载器是最后的兜底，代价是每次安装都要用户批准一次构建脚本。

---

## TD-11：核心包不依赖宿主

**选择**：`packages/{protocol,core,tunnel}` **禁止** import 任何 `@deepseek-ai/*`。
只有 `packages/dsh-plugin` 依赖宿主。

**理由**：让握手、加密、分帧、重连等最容易出错且最需要测试的逻辑，能够在**没有 DSH 的环境**
下被完整单测 —— 包括在 CI 里、在移动端参考实现里、在被控端之外。这也让"协议单一事实源"
（TD-3）真正落地：`packages/protocol` 可以被 Node 与 Dart 两边共同消费。

**残余风险**：需要自律（或 lint 规则）防止这条边界被逐渐侵蚀。建议在 M1 加一条仓库级检查。
