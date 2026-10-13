# 协议设计 — DSH Remote Protocol v1

> 状态：**M1 传输冻结；M2 应用实现（2026-10-13），以下差异优先于早期目标描述**。
> 线上结构以 `packages/protocol/schema.json` 为准，TS/Dart 类型由该 schema 生成。本文规定状态与流语义。

---

## M2 实现与宿主适配

线上参数以 schema 为准。支持会话、工作区、子代理、上传、审批/提问、文件终端与代码 diff。DSH 0.1.7-rc.2 的差异如下：

- fork 使用 `atSeq`；队列 edit 使用文本 `content` 数组；子会话地址含 `parentSessionId/childSessionId/mode`。
- follow opening snapshot 冻结 cursor，用历史 page 补齐 `sinceSeq`，连续 seq 有缺口时拒绝静默跳过。
- assistant live 使用宿主 `assistant-stream` start/chunk/end，持久事件使用 snapshot/append；早期设计的 replace/settle 文案不是本版线上 DTO。
- 配对 payload 为 `{v,sid,exp,relay,pk,name,caps}`：exp 为 Unix 秒，pk 为标准 base64；配对 prologue 绑定 sid，确认后普通连接恢复固定身份绑定。
- 应用流将一个最大 4 MiB JSON 值分成 32 KiB SDATA，再以 ApplicationEvent 的 `bytes` 完成标记拼接；approval/question 为控制流事件。
- 上传使用 `session.upload.begin/chunk/finish`，单块 ack，不把大 base64 放进一次 RPC。文件写与终端使用绑定完整参数的一次性审批许可。
- `changes.summary/diff` 复用宿主逐 turn 快照；diff 使用逻辑流，快照失效返回 history/unavailable。
- 已吊销身份在 Noise 认证后收到加密的 authentication-rejected，不进入 ready，也不作为可重试断网处理。

完整列表见 `packages/protocol/src/index.js` 的 methodSchemas；包边界和交付限制见 [M2 总结](m2-summary.md)。

## M1 冻结的实现子集

- Node：已绑定公钥的 XX 握手、加密 `hello`、RPC、应用心跳、逻辑流、TCP/WS 载体及重连。
- Dart：正式纯 VM Noise 参考实现、16 字节帧编解码、生成类型与跨语言向量；完整移动端连接在 M3。
- 实现方法仅为 `diagnostic.echo`、`stream.open`、`history.page`、`stream.close`；后文 `session.*`、配对、设备、审批、文件与终端属于 M2。
- 所有多字节头字段为大端。帧头 `seq` 在线上为 uint64，但 v1 限制为 `0..2^53-1`。
- TCP 每条记录增加 **4 字节大端长度**（不含长度字段本身）。WS 每条二进制 message 对应一条完整记录，禁用压缩。握手记录最多 65535 字节；传输记录最多 65551 字节（16 字节头 + 至多 65535 字节密文），明文上限 65519 字节。
- 所有 RPC 与 `hello`/`ping`/`pong` 都走流 0。initiator 分配奇数流 ID，responder 分配偶数；ID 在一次连接中递增。每个方向、每个流的物理帧序号从 0 连续递增。Noise nonce 则按整个方向的发送顺序递增，不能用会话事件序号替代。
- 每连接最多 32 个逻辑流、32 个出站 RPC 与 32 个正在执行的入站 RPC；发送队列最多 128 条或 1 MiB，单条发送期限 10 秒。关闭连接取消请求并清理订阅、定时器和会话密钥；不响应取消的下游占用原 RPC 槽位，避免超时后无界扩张。
- M1 的内存 `EventJournal` 是有界诊断源（默认 4096 条、4 MiB），只验证断网期间的事件恢复，不承诺进程重启后的存储。真实 DSH 持久历史适配属于 M2。
- M1 快照 `{kind:"snapshot", cursor, firstSeq, records, hasMore}` 为独立诊断流结构。恢复时冻结 `throughSeq=cursor`，向前补页至本地游标，再按持久 `SessionEvent.seq` 去重应用；最多 128 页、4096 条、4 MiB、30 秒，历史不覆盖游标时返回 `history/unavailable`。实时帧为 `{kind:"append", records}`。
- DSH 当前 `follow` 无 `sinceSeq` 入参。M2 必须通过 opening snapshot 与 `page` 组合适配；下文完整会话快照及 live delta 是目标语义，不能直接当成宿主返回值透传。

---

## 1. 设计原则

1. **两层清晰分离**：外层是传输（TLS/WSS 或局域网明文 TCP），内层是 Noise 端到端加密。
   外层的安全性不构成信任边界，内层才是。
2. **复用 DSH 语义**：会话事件沿用宿主 `SessionWireEvent` 信封与 `replace/prepend/append/settle`
   的流语义，避免自创重连逻辑。
3. **可版本协商、可前向兼容**：握手交换版本区间与能力位图；未知方法一律拒绝而非猜测。
4. **幂等优先**：所有可重试的写操作携带稳定 `requestId`。
5. **失败闭合**：任何鉴权、解密、序列校验失败都断开连接，不降级、不静默继续。

---

## 2. 协议分层

```
┌──────────────────────────────────────────────┐
│ 应用方法层  session.* / stream.* / approval.* │
├──────────────────────────────────────────────┤
│ 帧层  16 字节头 + 载荷                        │
├──────────────────────────────────────────────┤
│ Noise 传输阶段  ChaCha20-Poly1305 + 64bit 计数 │
├──────────────────────────────────────────────┤
│ Noise 握手  Noise_XX_25519_ChaChaPoly_BLAKE2s │
├──────────────────────────────────────────────┤
│ 传输层  WSS（公网经隧道）/ TCP（局域网直连）    │
└──────────────────────────────────────────────┘
```

---

## 3. 配对（Pairing）

### 3.1 角色与前提

- **被控端（responder）**：持有长期 X25519 静态密钥对 `(s_R, S_R)`，持久化。
- **控制端（initiator）**：持有长期 X25519 静态密钥对 `(s_I, S_I)`，持久化（移动端存
  Keychain / Keystore）。
- 首次连接前，双方互不知道对方公钥 —— 这正是选用 `Noise_XX` 的原因（互相认证静态密钥，
  无需预先交换）。

### 3.2 二维码载荷

被控端在用户点"开启配对"时生成一次性载荷：

```jsonc
{
  "v": 1,                          // 协议主版本
  "sid": "<16 字节随机，base64url>", // 配对会话 id，一次性
  "exp": 1760000000,               // Unix 秒，过期时间（建议 now + 180）
  "relay": "wss://xxx.trycloudflare.com", // 或 "lan://192.168.1.5:47311"
  "pk": "<被控端 X25519 静态公钥，base64>",
  "name": "bruce-desktop",         // 仅展示用，不可作为身份依据
  "caps": ["session", "files", "terminal", "approval"] // 被控端愿意授予的能力
}
```

**强制约束**：

- **绝不包含长期 bearer token**。载荷本身不是凭据。
- `name` 是**攻击者可控的展示字段**，任何鉴权判断都不得依赖它（KDE Connect CVE-2020-26164 的
  直接教训）。
- `sid` 一次性、短时效；重复使用必须被拒绝。

### 3.3 配对握手流程

```
被控端                                     控制端
  │ 生成 (sid, exp, pk)                      │
  │ 展示二维码                                │
  │                                          │ 扫码
  │                                          │ 校验 v / exp / 未使用过的 sid
  │◄──────────── 建立传输连接 ────────────────│
  │                                          │
  │   Noise_XX 握手，prologue =               │
  │   "dsh-remote/v1/pair:" + sid            │
  │◄────────── e (ephemeral) ────────────────│
  │─────────── e, ee, s, es ────────────────►│
  │◄────────── s, se ────────────────────────│
  │                                          │
  │  双方各自计算 SAS（见 §3.4）              │
  │  两端同时显示 6 位数字，人工比对            │
  │                                          │
  │◄────────── pair.confirm ─────────────────│  （含配对的长期身份声明）
  │ 记录 initiator 长期公钥 → 设备表            │
  │─────────── pair.ok ─────────────────────►│ 记录 responder 长期公钥
```

**prologue 的作用**：把 `sid` 绑进握手 transcript。这能拒绝使用不同 `sid` 的 transcript，
不能独自阻止同一有效二维码被抢先使用。M2 必须由被控端本机确认 SAS，并在双方确认后原子消费
`sid` 和写入授权；控制端还必须核对二维码 `pk` 与握手收到的 responder 公钥。

### 3.4 SAS（短认证串）派生

Noise 的 hash 函数是 **BLAKE2s**，因此 `handshake_hash` 是 32 字节。SAS 在其上再做一次
**SHA-256**（与 Noise 内部哈希无关，只是一段域分离的派生）：

```
handshake_hash = GetHandshakeHash()                  // BLAKE2s 输出，32 字节，必须在 Split() 之后取
material       = SHA256( handshake_hash || S_I || S_R )   // S_I/S_R 为长期静态公钥，各 32 字节
SAS            = uint64_be(material[0..8]) mod 1000000
SAS 字符串      = 十进制、左补零至 6 位
```

`S_I`、`S_R` 是双方**长期静态公钥**（不是临时公钥），因此 SAS 同时绑定到两台设备身份与本次
握手 transcript。

> 注意区分两个哈希：Noise 握手内部用 **BLAKE2s**；SAS 这一步用 **SHA-256**。
> 两者都必须在两端实现一致 —— 参考实现见 `spikes/noise-interop/node/src/noise-xx.js` 与
> 测试向量 `spikes/noise-interop/vectors/xx25519-chachapoly-blake2s.json` 的 `sasRule` 字段。

要求：

- **首次配对必须人工比对，且不提供"跳过"按钮。**
- 比对失败必须立即终止并丢弃会话密钥。
- 已知设备重连不需要 SAS（设备公钥已持久化，Noise_XX 的静态认证已足够）。

> 为什么是 6 位数字：与 Signal 安全码 / KDE Connect 指纹同一量级的可用性权衡。6 位十进制在
> 单次配对中提供约 20 bit 的 MITM 检出率；配合"仅首次、短时效、一次性"三重限制，这是业界
> 通行做法。若需要更强，可显示 8 位或 5 词助记词，协议上 `sas_len` 可协商。

---

## 4. 握手（Noise）

| 项 | 值 |
|---|---|
| 模式 | `Noise_XX_25519_ChaChaPoly_BLAKE2s` |
| DH | Curve25519 |
| Cipher | ChaCha20-Poly1305 |
| Hash | BLAKE2s |
| Prologue | `"dsh-remote/v1/pair:" + sid`（配对）；`"dsh-remote/v1/resume:" + deviceId`（重连） |
| 消息数 | XX 模式标准 3 条消息 |

### 4.1 角色模型与"手机只做控制端"约束

| `role` | 含义 | 谁可以使用 |
|---|---|---|
| `controller` | 发起方，驱动被控端的会话 | DSH 实例、移动端 App |
| `controlled` | 被控方，暴露自身会话 | **仅 DSH 实例** |

**产品决策（2026-10-10）：移动端只做控制端。** 因此：

- 被控端在 `hello` 阶段**必须**校验对端声明：`role === "controller"`。任何声明
  `role: "controlled"` 或缺失 `role` 的对端一律以 `unauthorized` 拒绝并断开。
- `kind` 字段用于区分客户端类别。被控端**不得**因为 `kind: "mobile"` 而放宽任何权限；
  `kind` 只用于审计与策略展示。
- DSH 实例之间的互连**不受**此限制：一个 DSH 实例既可以做控制端也可以做被控端，由部署配置
  决定；本条只约束移动端。
- 该拒绝必须写入审计（`deviceId`、声明的角色、时间、原因）。

设计说明：真正的边界是"移动端分发渠道不提供被控端能力"，服务端的 `role` 检查是**纵深防御的
第二层**，用于拒绝被篡改的客户端，而不是唯一的防线。

---

### 4.2 XX 模式的消息序列（规范原文）

[Noise 规范 §7.5 / §8](https://noiseprotocol.org/noise.html) 定义的 XX 模式：

```
XX:
  -> e
  <- e, ee, s, es
  -> s, se
```

对应到配对流程（initiator = 控制端，responder = 被控端）：

| # | 方向 | 内容 | 该消息发出的 DH 运算 |
|---|---|---|---|
| 1 | 控制端 → 被控端 | `e` | —（仅发送临时公钥） |
| 2 | 被控端 → 控制端 | `e, ee, s, es` | `ee`、`es`（用被控端静态密钥做 DH） |
| 3 | 控制端 → 被控端 | `s, se` | `se`（用控制端静态密钥做 DH） |

每条消息的载荷都经 `EncryptAndHash()` 处理，并以当前 `h` 作为 associated data。

**两条容易写错的细节：**

1. `es` 出现在**第 2 条**消息中（由 responder 计算，用的是 initiator 的临时公钥与 responder 的
   静态密钥）；`se` 出现在**第 3 条**消息中（由 initiator 计算）。顺序写反会导致握手在两侧都
   失败且错误信息难以定位。
2. 静态公钥 `s` 在 XX 模式下与消息载荷一起**加密传输**（`EncryptAndHash`），因此第 2、3 条
   消息的密文长度包含公钥长度（32 字节 + 16 字节 AEAD tag）。实现分帧时必须按 Noise 消息
   边界，而不是按固定长度猜测。

### 4.3 握手哈希与 SAS 的取值时机

规范明确要求统计绑定值必须在 **`Split()` 之后**通过 `GetHandshakeHash()` 取得：

> GetHandshakeHash(): Returns h. This function should only be called at the end of a handshake,
> i.e. after the Split() function has been called.

因此 §3.4 的 SAS 派生中，`handshake_hash` 必须是**第 3 条握手消息处理完毕、调用 `Split()` 之后**
的 `h`。写早一步（在第 2 条消息后取值）会得到一个两端不一致的值，导致 SAS 永远对不上。

握手完成后进入**传输阶段**。

**版本与能力协商**：握手完成后，双方各发一条内层控制帧：

```jsonc
// kind: "hello"
{
  "vmin": 1, "vmax": 1,       // 支持的版本区间
  "caps": ["session","stream","files","terminal","approval"],
  "role": "controller",       // 见 §4.1
  "kind": "mobile" | "dsh" | "cli",   // 客户端类别，用于角色策略判定
  "deviceId": "<长期公钥指纹 base64url>",
  "name": "Pixel 9"
}
```

双方取版本交集与能力交集；交集为空则关闭连接。**协商失败不得降级到弱安全配置。**

## 5. 帧格式

传输阶段所有载荷经 Noise 加密。帧头 16 字节，明文，但受 AEAD 保护（作为 associated data）。

```
偏移  长度  字段        说明
0     2     magic       0x44 0x52 ("DR")
2     1     version     协议主版本（当前 1）
3     1     kind        帧类型
4     4     streamId    流 id，0 表示连接级
8     8     seq         该 streamId 内单调递增序号
---- 载荷 ----
16    N     payload     JSON(UTF-8) 或分块二进制
```

| kind | 值 | 方向 | 说明 |
|---|---|---|---|
| `REQ` | 0x01 | 双向 | 请求，载荷含 `{id, m, p}` |
| `RES` | 0x02 | 双向 | 成功响应，载荷含 `{id, r}` |
| `ERR` | 0x03 | 双向 | 失败响应，载荷含 `{id, e: {code, message, data?}}` |
| `EVT` | 0x04 | 双向 | 连接级事件（`hello`、`ping`、`pong`、`bye`） |
| `SDATA` | 0x05 | 双向 | 流数据，载荷为原始分块 |
| `SEND` | 0x06 | 双向 | 流结束，载荷含 `{error?}` |

`id` 是 8 字节随机请求标识（base64url 编码进 JSON），用于关联请求与响应。`seq` 为每流单调
递增，用于检测丢帧与重放。

### 5.1 Noise 传输阶段的 nonce 处理

Noise 的 `CipherState` 只有一个 64 bit 计数器，而双工连接需要两个方向独立的 nonce 空间，否则
会重复使用同一 `(key, nonce)` 组合 —— 这是 ChaCha20-Poly1305 的**灾难性误用**。

本协议规定：**一条 Noise 会话拆成两个 CipherState**，即握手完成后调用一次 `Split()`：

- `c1 = Split()[0]` 用于 initiator → responder
- `c2 = Split()[1]` 用于 responder → initiator

每个方向的 nonce 从 0 独立递增。这等价于 Noise 规范中 `Split()` 的标准用法，必须实现正确。

**M1 消息预算**：任一发送方向在 nonce 达到 `0xfffffffe` 时关闭连接，重新 Noise 握手
产生新的临时密钥与传输密钥。v1 不实现在线 Rekey 协商；不得重置旧 CipherState 的 nonce。
重新握手后由会话事件游标恢复历史。

### 5.2 心跳

- 空闲时每 **25 秒**发一次 `EVT{type:"ping"}`，对端回 `EVT{type:"pong"}`。
- 理由：Cloudflare 的空闲超时在**其自家文档内部矛盾**（Error 524 页为 125 s，
  connection-limits 表为 100 s）。25 秒对两者都留足余量。
- **必须使用应用层心跳**，验证对端业务路径存活。M0 的 `ws-pings=0` 是因为客户端未发送
  WebSocket 控制帧，不能据此判断控制帧透传行为。
- 连续 3 次心跳无响应 → 判定连接死亡，走重连流程。

### 5.3 重连参数（M0 实测确定）

| 参数 | 取值 | 依据 |
|---|---|---|
| 握手预算 | **≤10 s** | spike 用 20 s 预算时，一次尝试被死 origin 完全耗尽 |
| origin 被杀 | 客户端约 1.3 s 后收到 `CLOSE 1006, wasClean=false`；**URL 保持有效** | 直接重连同一 URL |
| 隧道进程被杀 | **URL 永久失效**（`HTTP 530` / `error code 1033`） | 必须重建隧道并**重新发布二维码** |
| 重连退避 | 指数退避，上限 30 s，带抖动 | 避免风暴 |
| 冷启动 | 新建隧道后前约 50 s 有 10–25% 冷升级失败 | 就绪探测通过前不展示 URL |

### 5.4 并发上限

隧道对每个 quick tunnel 有 **200 in-flight** 硬上限，实测对 WebSocket 连接同样生效，
第 201 条返回 `HTTP 1.1 429`。因此：

- 默认被控端物理连接上限 **32**；每条物理连接复用最多 **32** 个逻辑流。逻辑流不各自占用隧道连接额度。
- 服务端对超限主动返回 `busy`，**不要**让请求打到隧道去换 429。
- 429 与 530 必须在 UI 上区分：429 是容量问题（等已有流结束），530/1033 是隧道消失
  （需更新连接地址；已绑定公钥的设备信任不因此失效）。

---

## 6. 应用方法

### 6.1 连接与控制

| 方法 | 方向 | 参数 | 返回 |
|---|---|---|---|
| `hello`（EVT） | 双向 | `{type:"hello", vmin, vmax, caps, role, kind, deviceId, name}` | 双方分别发 EVT，不走 RPC |
| `ping`/`pong`（EVT） | 双向 | `{type, id}` | 回相同 `id` 的 `pong` |
| `device.list` | → 被控端 | `{}` | `{devices: [{deviceId, name, caps, pairedAt, lastSeenAt, online}]}` |
| `device.revoke` | → 被控端 | `{deviceId}` | `{revoked: true}` |
| `device.rename` | → 被控端 | `{deviceId, name}` | `{ok: true}` |
| `pair.begin` | → 被控端 | `{}` | `{qr: "<载荷 JSON>", sasLen: 6, expiresAt}` |
| `pair.confirm` | 双向 | `{deviceId, sas}` | `{ok: true, deviceId}` |

`device.*` 与 `pair.*` 仅在**本机授权**（被控端宿主 UI 或 CLI）或已完成配对的连接上可用。
M1 尚未实现这些方法；M2 的 `pair.confirm` 只允许在本机已开启、尚未授权的配对状态使用，
其他管理操作仍要求 `admin` 授权。

### 6.2 会话

| 方法 | 参数 | 返回 |
|---|---|---|
| `session.list` | `{}` | `{items: SessionSummary[]}` |
| `session.search` | `{query}` | `{items: SessionSummary[]}` |
| `session.create` | `{workspaceId?, cwd?, sessionId?, agentPreset?}` | `{sessionId, agentPreset?}` |
| `session.fork` | `{sessionId, atSeq?}` | `{sessionId}` |
| `session.rename` | `{sessionId, title}` | `{title, seq}` |
| `session.prompt` | `{requestId, sessionId, mode: 'queue'\|'steer', content: PromptContentPart[]}` | `{accepted: true}` |
| `session.cancel` | `{sessionId}` | `{accepted: true}` |
| `session.queue.update` | `{sessionId, itemId, action: {kind: 'steer'\|'edit'\|'remove', content?}}` | `{accepted: true}` |

`PromptContentPart`：`{type:'text', text}` \| `{type:'image', …}` \| `{type:'file', receiptId}`。

### 6.3 流

| 方法 | 参数 | 返回 |
|---|---|---|
| `stream.open`（流） | `{address, sinceSeq?, assistantStream?, maxMessages?}` | 流：见 §7 |
| `history.page`（流） | `{address, throughSeq, beforeSeq?, maxMessages?}` | 流：历史记录分页 |
| `control.subscribe`（流） | `{streamId}` | 流：宿主投影 baseline / projection |

`address`：`{kind:'session', sessionId}` \| `{kind:'subagent', parentSessionId, childSessionId, mode}`。

### 6.4 审批与提问

| 方法 | 方向 | 参数 | 返回 |
|---|---|---|---|
| `approval.request` | 被控端 → 控制端 | `{approvalId, sessionId, callId?, toolName, reason?, deadline?}` | — |
| `approval.decide` | 控制端 → 被控端 | `{approvalId, outcome}` | `{ok: true}` |
| `approval.pending` | 控制端 → 被控端 | `{sessionId?}` | `{items: PendingApproval[]}` |
| `approval.responded` | 被控端 → 控制端 | `{id, sessionId, outcome, by: 'local'\|'remote'}` | — |

`outcome ∈ {'allowed-once', 'rejected', 'cancelled', 'unavailable'}`，与宿主 `ApprovalOutcome`
一致。

`question.request` / `question.answer` 同构，对应宿主 `user-questions/request` 缝，返回
`AskUserQuestionAnswer`。

### 6.5 文件与终端

| 方法 | 参数 | 返回 |
|---|---|---|
| `files.list` | `{sessionId, path, offset?}` | `{entries: [{name, kind, size?}], hasMore}` |
| `files.read` | `{sessionId, path, offset?, maxBytes?, streamId?}` | RPC 字节窗口或分块逻辑流 |
| `files.write` | `{sessionId, path, content, approvalId}`（UTF-8 ≤32 KiB） | `{ok: true, bytes}` |
| `terminal.exec`（流） | `{sessionId, command, cwd?, approvalId, streamId?}` | 流：stdout/stderr 分块 + 退出码 |

`files.write` 与 `terminal.exec` **强制**要求先通过 `operation.prepare` 取得审批；`approvalId` 必须能对应到一条已决的
`allowed-once` 记录。

### 6.6 错误码

沿用 DSH 失败词汇以保证语义一致：

| code | 含义 |
|---|---|
| `unauthorized` | 未配对 / 设备已吊销 / 能力不足 |
| `not-found` | 会话或资源不存在 |
| `invalid-argument` | 参数不合法 |
| `session/writer-held` | 会话被其他写者占用（宿主语义） |
| `approval/denied` | 审批被拒 |
| `approval/expired` | 审批超时 |
| `busy` | 超出并发上限 |
| `unsupported` | 方法未知或协商未启用 |
| `internal` | 未预期错误 |
| `gateway/internal` | 宿主内部失败（透传） |

---

## 7. 流语义与重连

### 7.1 打开流的响应

`stream.open` 的返回是一条流，首帧必须是完整快照（复用宿主 follow 的 opening 语义）：

```jsonc
{
  "kind": "snapshot",
  "address": {"kind": "session", "sessionId": "…"},
  "cursor": 1234,              // 当前已持久事件的最大 seq
  "running": true,             // agent 是否在跑
  "turn": 7,                   // 当前 turn（若 running）
  "inbox": [ … ],              // 待处理队列
  "pendingApprovals": [ … ],   // 未决审批
  "activeAttempt": {           // 进行中的 assistant 尝试（可选）
    "attemptId": "…", "turn": 7, "step": 3,
    "startedAfterSeq": 1230, "nextIndex": 42,
    "stream": [ … ]            // 压缩后的已有增量
  }
}
```

**先基线后增量**是硬要求：客户端不能在拿到基线前渲染任何增量，否则会看到重排或重复内容。

### 7.2 增量帧

```jsonc
{"kind": "append",  "records": [ {"event": SessionWireEvent}, … ]}
{"kind": "prepend", "records": [ … ]}          // 向前补历史
{"kind": "replace", "fromSeq": 1200, "records": [ … ]}
{"kind": "settle-assistant", "attemptId": "…", "seq": 1240, "index": 55}
{"kind": "delta", "attemptId": "…", "revision": 2, "index": 43, "time": …, "chunk": { … }}
```

- `delta` 是**非持久**的展示帧（对应宿主 `agent/assistant-stream`）。客户端可按
  `(attemptId, revision, index)` 去重；`revision` 变化意味着重开一次尝试的增量序列。
- `append` 才是持久事实。渲染策略：增量用于即时反馈，`append` 到达后以持久记录为准结算。

### 7.3 断线重连

1. 客户端记录已确认的最大 `seq`（`cursor`）。
2. 重连后重新 `stream.open { sinceSeq: cursor }`。
3. 服务端返回基线 + 缺失区间。客户端按 `seq` 去重合并。
4. 若客户端 `sinceSeq` 早于服务端可提供的历史范围，服务端返回 `history.page` 引导，客户端
   按需向前翻页补齐；超出宿主保留范围时明确返回 `not-found`，**不静默丢事件**。
5. 进行中的 assistant 尝试通过 `activeAttempt` 重建，客户端据此恢复打字机状态。

### 7.4 序列校验

- 同一 `streamId` 内 `seq` 必须严格递增；出现重复或回退 → 判定为重放/错序，立即断开。
- 帧头的 `streamId`/`kind`/`seq` 作为 AEAD 的 associated data 参与认证，伪造会被解密失败捕获。

---

## 8. 版本演进策略

- `version` 主版本不兼容递增；两端不匹配直接拒绝连接。
- 新增**方法**不递增主版本；调用方通过 `hello` 交换的 `caps` 判断可用性。
- 新增**事件类型**不递增主版本，但**必须实现宿主的 `ignorable` 语义**（见 §9.1）——这是
  正确性要求，不是可选项。
- 新增**帧 kind** 需要主版本递增（帧头解析无法前向兼容）。
- 协议变更必须同时更新本文档与 `packages/protocol` 的 schema，并在 `packages/core` 增加对应
  的兼容性测试向量。

---

## 9. 事件信封的精确定义（已核实）

**[源码]** `packages/core/session/src/types.ts:470`：

```ts
export type SessionEvent<T extends SessionEventType = SessionEventType> = {
  [K in SessionEventType]: {
    type: K
    seq: SessionSeq          // BrandedNumber，会话内单调递增
    time: number             // Unix epoch 毫秒
    data: SessionEventMap[K]
    ignorable?: true         // 见 §9.1
  } & (K extends SurfaceEventType
      ? { surfaceOp: SurfaceOp; sourceEventSeqs?: SessionSeq[] }
      : { surfaceOp?: never; sourceEventSeqs?: never })
}[T]
```

`SurfaceEventType` = `system/message` \| `user/message` \| `assistant/message` \| `tool/result`。
只有这四类携带 `surfaceOp`；其余（边界标记、attempt、error）禁止携带。

### 9.1 `ignorable` 语义（强制实现）

`ignorable` 的缺失表示**必需**事件。源码注释原文：

> Marks an event a reader may safely skip when it does not recognize `type`. Absent means required:
> a reader meeting an unrecognized type without this marker MUST refuse to reconstruct the session
> instead of silently dropping the event, because an unrecognized required event may change how the
> rest of the log is interpreted.

因此远端客户端（Flutter 或控制端 DSH）必须：

| 遇到的情况 | 必须的行为 |
|---|---|
| 未知 `type` + `ignorable: true` | 跳过该事件，继续 |
| 未知 `type` + 无 `ignorable` | **拒绝继续重建会话**，向用户报告"对端协议较新，本客户端不支持"，**不得静默丢弃** |

这条规则同时服务于两个方向：宿主升级新增事件时旧客户端不会静默丢掉影响语义的帧。实现上
它必须是一个显式分支，不能靠"未知类型默认忽略"的宽松解析。

### 9.2 跨语言序列化（开放项 O2 —— 已确认可行）

**[源码]** `SessionEvent.data` 的每个成员类型最终都由 `JsonValue` 构成：

```ts
// packages/util/values/src/index.ts:4
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }
```

`JsonValue` **不含** `bigint`、`undefined`、`Map`、`Set`、`Date`、`Buffer`。因此：

- 事件数据可以由标准 JSON 无损承载，**不需要自定义编解码层**。
- `seq: SessionSeq` 是 branded number，`time` 是 epoch 毫秒 —— 均远小于 `2^53`，JavaScript
  与 Dart 的 `num`/`int` 都能精确表示，无精度风险。
- 二进制内容（图片、文件）不在事件 `data` 里，而是以附件引用的形式出现，因此分块二进制走
  §5 的 `SDATA` 帧，不混入 JSON。

**结论**：`SessionWireEvent` 可原样跨语言传递，协议不需要为序列化做任何特殊处理。这消除了
开放项 O2，也验证了 TD-3（以宿主事件词汇为中心）的可行性。

---

## 10. 开放项（M0 后更新）

| # | 开放项 | 影响 | 状态 |
|---|---|---|---|
| O1 | Node 与 Dart 的 Noise 实现及工具链 | 核心实现方式 | 已关闭：M0 自实现 + M1 正式包，无原生编译依赖 |
| ~~O2~~ | ~~DSH `SessionWireEvent` 是否可原样跨语言序列化~~ | 决定是否需要规范化层 | **已确认：可原样 JSON 传递（§9.2）** |
| O3 | `assistant/live-chunk` 类展示帧是否需要自定义压缩（宿主已有 compact stream） | 影响移动端带宽与实现复杂度 | 待评估 |
| O4 | SAS 长度与表现形式（6 位数字 vs 8 位 vs 词表） | 可用性 vs 安全性的取舍 | M2 配对 UX 决定；M1 不增加协商分支 |
| O5 | 局域网直连是否需要 mDNS 自动发现，还是仅手输 IP | 影响"离线可用"体验 | 待定 |
