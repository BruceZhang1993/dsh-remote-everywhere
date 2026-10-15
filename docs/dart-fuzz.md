# Dart 覆盖率反馈 fuzz

入口：`tools/dart-fuzz.sh`，Dart 3.13.5；生产协议、密码学和接收实现不因本入口改变。所有身份、临时密钥、消息均由合成输入生成，不读取 App/DSH 状态或真实凭据。

## 范围与判断

- DR：任意头的合法拒绝/编码往返、有效记录往返和旧密文拒绝，失败不得推进接收 nonce。
- WebSocketReceiveGuard：任意帧在 TCP 合并/分块下已派发帧及拒绝结果一致；有效分片穿插带载荷 ping 后，控制数据独立、完整二进制消息不丢失；累计 DR 上限与 1025 个空分片拒绝。
- Dart Noise：角色/阶段错误、截断/篡改握手消息、低阶点、错误 prologue、双向消息、静态身份绑定、重放、跨会话旧密文和 nonce 耗尽。跨会话夹具使用不同的合成临时密钥；只改变 prologue 而复用 DH 密钥不足以构造独立 transport keys。

每条输入执行后，从仅绑定 loopback 的 Dart VM 服务取得三个目标源码的累计 token-position Coverage。种子和新增命中位置的变异输入才进入有界语料；不添加运行时依赖，使用 SDK 的 HTTP 接口。源码位置数不是覆盖百分比，也不是独立密码学认证。

## 限额与产物

默认 60 秒，可设 `DSH_DART_FUZZ_SECONDS=10..3600`；最多 100 万变异，单输入最多 1024 字节，语料最多 256 条。持久语料/回放文件最多 512 KiB，VM 单次响应最多 512 KiB、超时 5 秒。脚本外层 watchdog 在预算加 60 秒后终止、再过 5 秒强制结束；管道保留失败退出状态。
本机入口自动进入 systemd scope（8 GiB / 4 GiB swap）；GitHub 只在整个 job 已处于同限额容器时使用 `--inside-scope`。Node 与 Dart 的每日 900 秒运行串行执行，总 job 超时 40 分钟。

`.cache/dart-fuzz/report.json` 记录源码/夹具/锁文件哈希、Dart 版本、运行 SHA（本地无 GitHub 上下文时为空）、实际预算/命中位置/语料数量。每次执行目标前保存当前输入和 PRNG 状态；异常或 watchdog 终止的 report 保持 passed=false，可从下载的 report 回放。文件不承诺逐次 fsync。
`.cache/dart-fuzz/corpus.json` 保存成功运行的有界语料。GitHub 上传报告/语料，缓存成功语料供后续运行；旧语料始终重新执行并测量新源码覆盖。

```bash
DART_BIN=/home/bruce/Android/flutter/bin/dart DSH_DART_FUZZ_SECONDS=10 tools/dart-fuzz.sh
DART_BIN=/home/bruce/Android/flutter/bin/dart tools/dart-fuzz.sh --replay /absolute/path/to/downloaded-report.json
tools/run-limited.sh env DART_BIN=/home/bruce/Android/flutter/bin/dart python3 tools/test-dart-fuzz.py
```

启动日志中的临时 VM URL/auth code 被过滤；故障注入测试仅操作隔离副本，不改生产文件。其四项检查验证有效重组、注入数据丢失后失败并保存输入、恢复实现后回放成功，以及非预期 StateError 不能被当成格式拒绝吞掉。
2026-10-15 另在本机临时副本注入同步无限循环，实际 watchdog 约 70.3 秒后退出 124，保留最后输入及 `passed=false`；此项不是 CI 四项检查的一部分，证据见 [M4 记录](m4-summary.md)。

## 未覆盖

不覆盖 dart:io WebSocket 的实际 socket/control callback、RemoteConnection 生命周期和重连竞速、Node Noise、Apple/native 插件或真实平台。既有 socket 集成/单元测试继续执行。短跑或单次 900 秒成功不构成持续长期证据；独立 Noise 审查和平台验收门禁保留。
