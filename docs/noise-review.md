# 独立 Noise 审查交接

此文件是审查范围与证据索引，**不是独立审查报告**。当前没有第三方审查者、签署结论或风险接受记录；正式发布仍保留此门禁。
审查必须固定到拟发布标签的完整提交 SHA 和候选 manifest；源码、依赖或协议变化后须复核受影响部分。

## 实现与安全边界

- [Node Noise 状态机](../packages/core/src/noise-xx.js) 与 [Dart 实现](../packages/core/dart/lib/noise_xx_blake2s.dart)：`Noise_XX_25519_ChaChaPoly_BLAKE2s`，规范 [revision 34](https://noiseprotocol.org/noise.html)。Node 原语 `@noble/*` 2.4.0，Dart `cryptography` 2.9.0 / `crypto` 3.0.7。
- [Node 连接](../packages/core/src/connection.js)、[Node 服务入口](../packages/core/src/server.js) 与 [Dart 连接](../packages/core/dart/lib/remote_connection.dart)：prologue、角色、固定身份、公钥核对、握手超时、鉴权失败与物理流/序列号。
- [配对](../packages/dsh-plugin/src/pairing.js)、[信任存储](../packages/dsh-plugin/src/store.js)、[人工交互](../packages/dsh-plugin/src/interactions.js) 与 [操作围栏](../packages/dsh-plugin/src/operations.js)：双方 SAS、短期 sid、权限授予/吊销、写入审批和真实宿主边界。
- [DR 定义](protocol.md)、[威胁模型](security.md)、[验证矩阵](security-validation.md)：TLS/隧道只提供可达性，本机失陷和流量元数据不在通信认证承诺内。

## 应形成书面结论的检查点

1. DH 输入/全零结果、临时密钥随机性、静态身份绑定、XX 每步 transcript/hash/key 派生及 split 方向是否遵守规范。
2. HMAC-BLAKE2s BLOCKLEN=64 与 HKDF、空 key/cipher 状态、ChaCha nonce 字节序/范围、AEAD 关联数据是否正确；Dart 上游 HMAC 错误的项目封装修复是否完整。
3. prologue 是否完整绑定 DR 版本/角色/身份/能力，握手及会话是否可能降级、未知密钥共享、反射、跨流或跨连接重放。
4. SAS 派生和有效期、配对确认/吊销/重连状态、错误后资源与密钥结算；确认失败不能进入业务派发。
5. 暂停/断线/重连与 logical stream 的序列边界，是否会重复写入或扩大审批/权限；审计失败不能自动重放未知结果。
6. 用独立实现或规范向量复核项目冻结向量，说明覆盖盲区及残余风险，避免把同一代码生成/验证的结果当独立证明。

## 已有证据与缺口

本地自测、冻结向量、第三方 BLAKE2b 对照和 Node↔Dart 互通日志在 `.cache/m4`；BLAKE2b 对照与本项目 BLAKE2s 实现不同，不构成后者的完整独立认证。
Node/Dart 安全回归已测试重放、降级、角色/身份/流混淆及接收限额。Node 覆盖率 fuzz 只涉及 DR 解析/TCP，不覆盖 Noise 状态机；新增 [Dart 覆盖率反馈入口](dart-fuzz.md)覆盖合成 Noise 握手/transport，并验证错误分类和故障回放。SDK socket、RemoteConnection 生命周期/竞速、Node Noise 与长期观察仍有缺口；这些工具均不替代独立审查。
交付审查报告时须记录审查者、日期、完整 SHA、方法、发现/修复验证、尚未覆盖的风险和是否允许发布；当前这些字段均未填充，也没有对外发送本资料。
