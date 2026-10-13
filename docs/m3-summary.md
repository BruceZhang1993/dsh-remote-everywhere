# M3 首版实现与验证记录

日期：2026-10-13。分支：`feature/20261013-m3Mobile`，基线 M2 `7967cae`。
状态：**首版实现已落地，M3 最终验收未完成**。按用户要求暂不进行真机验收；本机 Linux 无法执行 iOS/Xcode 门禁。本记录描述本地实现与验证，Git 提交及推送单独交付；尚未发布或运行远端 CI。

## 本轮交付

- `apps/mobile`：正式 Flutter Android/iOS 工程、精确依赖锁定、平台身份与设备信任存储、扫码/粘贴和双方 SAS 确认。
- 纯 Dart `RemoteConnection`：二进制 WS/WSS、固定公钥 Noise 握手、hello、RPC、32 个逻辑流、分块重组、心跳、取消、发送与接收限额；连接关闭先结算资源，不重放远程写请求。
- `SessionState`：持久 cursor、分页、独立 projection 水位、流式 attempt/revision/index、compact baseline、持久结算去重。持久记录默认 2000 项/4 MiB，临时助手流 4096 块/1 MiB；未知必需事件拒绝，未知可忽略事件保留为不影响展示的 opaque 数据。
- App：设备管理、会话/工作区与搜索、聊天/代码块/推理/工具展示、人工审批与提问、队列、分叉、子代理、附件、文件窗口、代码 diff 和逐次审批的有界命令入口。已补附件移除和完整提示 UTF-8 帧预算。
- 控制器：单一连接 owner、跨 await 的连接/会话归属检查、前后台恢复、pending 交互重推、有限状态修复、主动断开后停止自动恢复。提示结果未知时仅由用户显式重试同一个 requestId。
- `tools/mobile-check.sh`、移动端 workflow、真实 DSH↔Dart 集成入口和双语开发入口文档。

密钥由 Android 加密安全存储/iOS Keychain 保护，Noise 运算仍在 Dart 内存使用私钥；不宣称硬件不可导出 X25519。持久资料仅含身份与设备信任；端点、配对 sid、聊天正文和附件不落盘。

## 验证结果

所有本地分析、测试和构建整树运行在用户 systemd scope 内：8 GiB 内存、4 GiB swap；重任务串行。

| 门禁 | 结果与范围 |
|---|---|
| 仓库 check / Node test | 语法、导出、生成文件、宿主依赖边界及 TypeScript 消费检查通过；**44/44** 回归通过 |
| Dart analyze / test | 无问题，**46/46**：分帧、连接与负向拒绝、恢复归并、字节上限、未知事件隔离 |
| Flutter analyze / test | 无问题，**19/19**：安全存储 8、控制器 6、界面 5；含损坏身份、晚到回调、主动断开、预算、附件移除及人工交互到达时释放输入焦点 |
| Android release APK | 已构建，APK v2 签名校验与 zipalign 4 字节对齐检查通过；Flutter 3.47.7 / Dart 3.13.5，JDK 21，minSdk 24、target/compileSdk 36；采用本地调试签名 |
| 真实 DSH↔Dart 本地 WS | 已通过确定性夹具；不等于真实模型或手机验收 |
| 真实 DSH↔Dart 公网 WSS | 已通过：双方 SAS、会话提示/流式归并、真实 compact baseline、审批/提问、60 KiB 上传、100 KiB 文件读取、RPC 故障隔离、双订阅断线恢复、宿主重启后原公钥恢复、吊销后拒绝认证 |
| Android 模拟器 | **已通过核心闭环**：API 33 / x86_64，安装最新 release APK；安全存储插件加载、相机权限拒绝回退、错误二维码拒绝、双方 SAS、新建会话、提示/助手输出、审批允许、提问提交、前后台恢复、冷启动保留信任与原身份重连；未发现 App crash 或 Flutter 未处理异常 |
| iOS / 远端 CI | 工程、权限、Keychain entitlement、macOS 未签名构建入口已配置；**未执行** |
| 真机 / 真实模型 | 本轮未执行，真机按用户要求延期 |

公网集成使用 `M3_TUNNEL=1`；每次宿主重启重新开启隧道，更新地址并保留原公钥。集成驱动采用 **1 秒测试心跳**。实测隧道可能在宿主断开后保留前端 socket，生产默认 25 秒心跳、三次未确认后关闭，客户端提示最迟可能约 100 秒才更新。宿主吊销及认证拒绝立即生效，不能将客户端检测延迟描述为实时撤回。

## 产物与复现

本地 APK：`.cache/mobile/dsh-remote-release.apk`。签名仅供本地测试，未配置发布签名；iOS 尚无产物，未签名 `.app` 也不能称为可装机 IPA。

- 版本：`0.1.0+1`；ABI：`arm64-v8a`、`armeabi-v7a`、`x86_64`。
- 大小：**69,093,547 bytes**。
- SHA-256：`733a8e16e287b93e6c8f23829c4afa9a8a21dc6a9fb629256328e03c188970bf`。

模拟器本地证据位于 `.cache/mobile/qa/report.json`；设备页、权限拒绝、聊天、审批、提问和结算截图同目录保存。测试使用独立 AVD 和隔离真实 DSH 的确定性模型；没有连接或操作真机，也没有调用真实模型。相机权限回退通过不代表二维码相机解码已验收。

```bash
DSH_FLUTTER_BIN=/home/bruce/Android/flutter/bin/flutter tools/mobile-check.sh check
JAVA_HOME=/usr/lib/jvm/java-21-openjdk ANDROID_HOME=/home/bruce/Android/Sdk DSH_FLUTTER_BIN=/home/bruce/Android/flutter/bin/flutter tools/mobile-check.sh android
tools/run-limited.sh bash -lc 'DSH_HOST_MODULE_ROOT="$PWD/.cache/m2-runtime/node_modules" DART_BIN=/home/bruce/Android/flutter/bin/dart M3_TUNNEL=1 node tools/m3-mobile-smoke.mjs'
```

Android Gradle 已限制 2 GiB heap、1 GiB metaspace、最多两个 worker，关闭持久 daemon；系统默认 Java 8 不可用于构建。macOS 无 systemd/cgroup 限额，脚本默认停止；只有用户显式授权相应 runner 后才能运行 iOS 入口。无 Git remote，workflow 配置不代表 CI 已执行。

## 收口事项

1. 扩展 Android 模拟器上的队列、子代理、文件/diff/终端等入口逐项交互验收，以及扫码解码和取消竞速；核心闭环通过不代表全部 UI 用例通过。
2. 在 macOS 验证 iOS 编译、Xcode 工程和平台插件，产出未签名 `.app`；真机与签名分发仍按用户安排执行。
3. 补齐真实模型的移动端闭环，继续覆盖审批竞速/过期/撤回、系统文件选择返回及网络切换。
4. Dart 原生 `WebSocket` 在回调前组装完整 message，缺少 transport `maxPayload` 配置。当前会在接收完成后拒绝超大物理记录，**恶意分片提前有界接收尚未实现**，应在安全加固阶段补齐；不能宣称全部接收层内存风险已消除。

M3 最终完成门禁保留在 [开发计划](m3-plan.md)，本轮不据首版代码或 Android 构建结果将里程碑标记为全部完成。
