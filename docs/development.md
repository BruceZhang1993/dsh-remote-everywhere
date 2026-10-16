# 开发与运行手册 — DSH Remote Everywhere

> 记录本项目的环境事实、构建命令与复现流程。所有命令均在本机实测或即将实测。
> 环境事实若发生变化（如 SDK 升级），必须更新本文档。

---

## 1. 本机环境事实

> **重要历史记录**：M0 早期的一份调研报告曾断言根文件系统为只读、Flutter 为 3.35.7 /
> Dart 3.9.2、并需要重定向 `HOME`/`PUB_CACHE`/`GRADLE_USER_HOME`。该前提已被推翻 ——
> 用户放开权限后，`/` 为 `rw`，Flutter 已升级到 3.47.7。**不要基于旧结论做任何假设。**

| 项 | 值 | 路径 / 命令 |
|---|---|---|
| 操作系统 | Arch Linux (CachyOS), x86_64 | — |
| Node | 22.23.3 | `/usr/bin/node` |
| pnpm | 11.28.5 | `/usr/bin/pnpm` |
| Flutter | **3.47.7 stable** | `/home/bruce/Android/flutter` |
| Dart | **3.13.5** | `/home/bruce/Android/flutter/bin/dart` |
| Android SDK | build-tools 37.0.0, platforms 至 android-37.0 | `/home/bruce/Android/Sdk` |
| Android 诱饵路径 | **只有 platform-tools，不要用** | `/opt/android-sdk` |
| JDK | 17 / 21 可用；Android Studio JBR 25 | `/usr/lib/jvm/java-17-openjdk` 等 |
| 根文件系统 | `rw`（可写） | — |
| Gradle 缓存 | 已预热 | `~/.gradle` |
| pub 缓存 | 已预热 | `~/.pub-cache` |
| 网络 | 出网正常（经透明代理，DNS 解析落在 198.18.0.0/15） | — |

### 1.1 网络代理的影响（重要）

本机出网经过透明代理，DNS 解析结果位于 `198.18.0.0/15`（保留段）。这会导致：

- **`web_fetch` 工具不可用** —— 它会把该地址判定为"非公网 IP"而拒绝。需要抓取文档时改用
  `curl`。
- 云隧道 spike 的日志显示 cloudflared 的 QUIC 连接经该地址出网（`ICMP proxy will use
  198.18.0.1`、`ip=198.18.26.250`），连接成立且可用。

### 1.2 不需要做的事（早期错误结论，已失效）

- ❌ 不需要 `sudo mount -o remount,rw /`
- ❌ 不需要重定向 `HOME` / `PUB_CACHE` / `GRADLE_USER_HOME`
- ❌ 不需要补装 JDK（17/21 早已存在，只是 shell 默认指向 Java 8）
- ❌ 不需要 `~/Projects/FlutterSDK`（那是空壳目录）

---

## 2. 环境变量

Flutter 构建**不需要任何导出** —— 实测确认 `ANDROID_HOME`、`ANDROID_SDK_ROOT`、`JAVA_HOME`
全部留空也能正常构建：Flutter 会自己把 `sdk.dir` 写进 `android/local.properties`，并自动选用
`/opt/android-studio/jbr`（OpenJDK 25）来跑 Gradle 9.3.1 / AGP 9.1.0。

```bash
# 可选：只是为了让 flutter/dart 命令能直接敲
export PATH="/home/bruce/Android/flutter/bin:$PATH"
```

### ⚠️ 绝对不要做的事

**不要**把 `JAVA_HOME` 指向 Java 8。PATH 上的 `java` 是 1.8，但 Gradle 9.3.1 需要 17+；
若显式设置 `JAVA_HOME=/usr/lib/jvm/java-8-openjdk` 会**直接破坏构建**。让 Flutter 自己选
（它会选 Android Studio 的 JBR 25）是正确做法。

**不要**因为看到 `[!] Android licenses not accepted` 就以为环境有问题 —— 这是唯一真正需要修的
一项，`yes | flutter doctor --android-licenses` 约 2.3 秒即可解决，之后 doctor 的 Android 行
会从 `[!]` 变为 `[✓]`。

**不要**清理 `~/.gradle` 与 `~/.pub-cache`。M0 项目冷构建约 40 秒、增量约 19 秒；首次全量下载
约 443 秒。M1 完整握手与认证帧 Android AOT 门禁最终构建约 36 秒（首轮约 79 秒）。

---

## 3. 常用命令

### 3.0 M1 仓库验证与资源限制

所有本地构建、检查和测试均通过 `tools/run-limited.sh` 执行，整个子进程树限定为内存 8 GiB、
swap 4 GiB。该机 systemd 明确拒绝 `--scope --wait`；scope 本身同步等待，因此包装器使用
`--scope --collect --same-dir`。用户 manager 不可用时包装器停止，不自动绕过限制。

```bash
export PATH="/home/bruce/Android/flutter/bin:$PATH"
tools/run-limited.sh pnpm install --frozen-lockfile
tools/run-limited.sh pnpm check
tools/run-limited.sh pnpm test
tools/run-limited.sh bash -lc 'cd packages/core/dart && /home/bruce/Android/flutter/bin/dart pub get --enforce-lockfile && /home/bruce/Android/flutter/bin/dart analyze && /home/bruce/Android/flutter/bin/dart test && /home/bruce/Android/flutter/bin/dart run bin/selftest.dart && /home/bruce/Android/flutter/bin/dart run bin/verify_vectors.dart'
tools/run-limited.sh env DART_BIN=/home/bruce/Android/flutter/bin/dart pnpm test:interop
tools/run-limited.sh pnpm test:package
tools/run-limited.sh bash -lc 'export PATH=/home/bruce/Android/flutter/bin:$PATH; tools/android-gate.sh'
```

这些命令串行运行。`pnpm check` 包括语法、生成文件一致性、公共 TS 类型消费和宿主依赖边界。
`test:interop` 校验冻结向量、BLAKE2b 第三方 oracle 和实际 Node↔Dart DR RPC。`test:package`
打包四个模块并在独立临时目录禁用 install scripts 安装、自检，产物在 `.cache/packages/`。
Android 门禁创建临时 Flutter 工程，直接依赖正式纯 Dart 包，APK 保存在
`.cache/m1-android-gate.apk`；这不是移动端产品。测试生成的私钥均留在临时目录并清理。

公网测试依赖现有 cloudflared、真实出网，不放进默认 CI：

```bash
tools/run-limited.sh env CLOUDFLARED=/absolute/path/to/cloudflared pnpm test:tunnel
```

不设置 `CLOUDFLARED` 时，该本机 smoke 使用 M0 的 `spikes/tunnel/cloudflared`。CI 已配置 Node、
纯 Dart、互操作、tarball 安装与管理 UI、实际移动端检查/Android 构建；版本 PR、npmjs 与正式 APK 发布配置见 [CI 与版本发布](ci-release.md)。构建容器使用 `--memory=8g --memory-swap=12g`
（总内存+swap 12 GiB）。远程 CI 的实际运行结果需另行确认。

### 3.0.1 两进程诊断 CLI

```bash
pnpm remote keygen --out .cache/host.key
pnpm remote keygen --out .cache/client.key
# 从各自 keygen 输出取得 PUBLIC_KEY，通过可信本地方式核对后使用。
pnpm remote serve --key .cache/host.key --peer CLIENT_PUBLIC_KEY --port 47311
pnpm remote doctor --key .cache/client.key --peer HOST_PUBLIC_KEY --endpoint ws://127.0.0.1:47311/remote/ws
pnpm remote connect --key .cache/client.key --peer HOST_PUBLIC_KEY --endpoint ws://127.0.0.1:47311/remote/ws --follow
# TCP 直连：serve --transport tcp；客户端 endpoint 为 tcp://127.0.0.1:47311。
# 公网：serve 添加 --tunnel --cloudflared /absolute/path/to/cloudflared，使用 ready 输出的 wss endpoint。
```

先创建 `.cache/`（构建／包 smoke 会自动创建）。`keygen` 拒绝覆盖已有文件，仅输出公钥；
`doctor` 验证绑定身份与加密 echo；`--follow` 显示诊断事件及重连状态。SIGINT/SIGTERM 清理资源。
隧道地址失效时要更新地址，保留原公钥绑定；扫码配对与真实 DSH 能力属于 M2。

### 3.1 Flutter / Android

```bash
flutter doctor -v                      # 环境体检
flutter doctor --android-licenses      # 接受许可（首次可能需要）
tools/run-limited.sh flutter analyze   # 静态分析
tools/run-limited.sh flutter test      # 单元测试
tools/run-limited.sh flutter build apk --debug   # 调试包（首次会下载 Gradle/依赖，耗时较长）
tools/run-limited.sh flutter build apk --release # 发布包
flutter devices                        # 列出可用设备
flutter emulators                      # 列出模拟器（本机有 3 个 AVD）
```

校验产物：

```bash
$ANDROID_HOME/build-tools/37.0.0/aapt2 dump badging \
  build/app/outputs/flutter-apk/app-debug.apk
```

### 3.2 Node

```bash
tools/run-limited.sh pnpm install --frozen-lockfile
tools/run-limited.sh pnpm test
tools/run-limited.sh pnpm check
```

---

## 4. M0 spike 复现

每个 spike 的结论与原始证据都在 `spikes/<name>/REPORT.md`，脚本与日志保留在同目录。

| Spike | 目录 | 复现方式 |
|---|---|---|
| Flutter Android 构建门禁 | `spikes/flutter-android/` | 见该目录 `REPORT.md`；日志在 `logs/` |
| 隧道传输 | `spikes/tunnel/` | `./start-tunnel.sh`（起 tunnel），`node server.mjs`、`node client.mjs` |
| Noise 跨语言互操作 | `spikes/noise-interop/` | 见该目录 `REPORT.md`；向量在 `vectors/` |

### 4.1 隧道 spike 的已知观测值

| 观测项 | 实测值 |
|---|---|
| cloudflared 版本 | 2026.10.0 |
| URL 出现位置 | **stderr**（stdout 为空） |
| URL 出现耗时 | 3.32 s |
| 公网可达耗时 | 6.19 s |
| URL 形态 | `https://<random-words>.trycloudflare.com` |
| 协议 | QUIC（`protocol:quic`，`ha-connections:1`） |

---

## 5. 环境变更时的检查清单

任何下列变更发生后，重新执行 `flutter doctor -v` 并更新本文档：

- Flutter / Dart 升级（会改变最小 SDK 约束，进而影响依赖解析）
- Android SDK 或 build-tools 升级
- JDK 默认版本变化
- 根文件系统挂载方式变化
- 网络代理策略变化（会让 `web_fetch` 可用性改变）

---

## 6. 待补充（随里程碑推进）

- [x] M1：仓库级命令、Node/Dart/互操作/Android AOT 门禁与本地安装验证
- [x] M1：仓库边界检查（确保 `packages/{protocol,core,tunnel}` 不 import `@deepseek-ai/*`）
- [x] M2：插件安装与回滚见 [m2-install.md](m2-install.md)
- [x] M3：Flutter 本地验证和 macOS CI 执行入口见 [apps/mobile/README.md](../apps/mobile/README.md)；真机验收暂缓，CI 配置不等于已执行
- [x] M4：GitHub Packages 候选与手动发布流程、版本/来源校验、双语文档；远程执行与实际发布延期

## M2 复验

```bash
tools/run-limited.sh bash -lc 'DSH_HOST_MODULE_ROOT="$PWD/.cache/m2-runtime/node_modules" node tools/m2-host-smoke.mjs'
# 同一脚本支持 M2_GUI=1（人工 GUI 阶段）、M2_TUNNEL=1（真实公网）、M2_SEARCH_DISABLED=1（宿主默认关闭搜索）和真实 provider 参数。
# 先按 m2-install.md 安装同版宿主；不使用混版的全局 node_modules。
```

## M3 移动端

```bash
DSH_FLUTTER_BIN=/home/bruce/Android/flutter/bin/flutter tools/mobile-check.sh check
JAVA_HOME=/usr/lib/jvm/java-21-openjdk ANDROID_HOME=/home/bruce/Android/Sdk DSH_FLUTTER_BIN=/home/bruce/Android/flutter/bin/flutter tools/mobile-check.sh android
tools/run-limited.sh bash -lc 'DSH_HOST_MODULE_ROOT="$PWD/.cache/m2-runtime/node_modules" DART_BIN=/home/bruce/Android/flutter/bin/dart node tools/m3-mobile-smoke.mjs'
```

第三条使用隔离真实 DSH 与确定性模型，验证 mobile-controller 配对、会话归并、审批/提问、恢复和吊销；不使用真机或真实模型账号。iOS 只能在 macOS/Xcode 验证，详见移动端 README 的显式执行入口。
在第三条 Node 命令前添加 `M3_TUNNEL=1` 可启用公网 WSS；宿主重启后重新获取隧道地址，仍固定原公钥。验收状态见 [M3 总结](m3-summary.md)。

## M4 安全加固

首批状态和依赖公告复核见 [M4 记录](m4-summary.md)，后续审计与发布步骤见 [M4 计划](m4-plan.md)。

```bash
tools/run-limited.sh pnpm test:security
tools/run-limited.sh bash -lc 'cd packages/core/dart && /home/bruce/Android/flutter/bin/dart test test/bounded_websocket_test.dart'
tools/run-limited.sh pnpm audit --prod
tools/run-limited.sh pnpm test:release-candidate
tools/run-limited.sh node tools/dependency-inventory.mjs
```

Node 安全/fuzz 和 Dart 接收/fuzz 用例也会由各自默认测试执行。audit 只表示注册表对当前生产依赖的公告结果，不替代平台依赖或密码学审查。
本地发布候选见 [release.md](release.md)，不改源码 alpha 版本、不自动发布。`DSH_FUZZ_ROUNDS=100000` 可在同一 scope 中放大固定 seed 样本；允许范围 1000..1000000，重任务仍串行。

### M4 GitHub Packages 与覆盖率 fuzz

公开远程仓库 `BruceZhang1993/dsh-remote-everywhere` 已接入 origin，默认 master；CI 的 owner/repo 从 `GITHUB_REPOSITORY` 获取。本地现按真实仓库 metadata 生成 `@brucezhang1993` 候选；此前 `local-validation` 仅用于隔离验证。

```bash
tools/run-limited.sh pnpm test:release-candidate --github-packages BruceZhang1993/dsh-remote-everywhere
tools/run-limited.sh node tools/publish-packages.mjs # 默认离线校验
tools/run-limited.sh node --test --test-concurrency=1 tools/test-release.mjs # mock registry，无真实发布
tools/run-limited.sh env DSH_FUZZ_SECONDS=600 pnpm test:fuzz-coverage
```

覆盖率入口用 V8 precise block ranges 反馈保留新输入；语料最多 512 条、每条 1024 字节，运行最多 3600 秒/100 万迭代。报告和 base64 语料在 `.cache/coverage-fuzz`，输入只含模拟协议数据。已有语料会重新测量当前源码覆盖，报告包含源码哈希；报告中的执行范围数不是整体覆盖率百分比。默认 60 秒，CI 短跑 10 秒，每日 scheduled job 900 秒；Node DR/TCP 以外的长期覆盖未完成。
发布 helper 只有 `--publish` 才写注册表，并检查干净工作区、同仓库 Actions/标签与已批准 SHA；正式运行配置见 [发布说明](release.md)。iOS/macOS 仍要求单独明确授权运行无 systemd 限额的构建。

Android 原生供应链库存按已解析 releaseRuntimeClasspath 生成；有现成 build 和 Gradle 缓存时可离线运行：

```bash
tools/run-limited.sh bash -lc 'cd apps/mobile/android && JAVA_HOME=/usr/lib/jvm/java-21-openjdk ./gradlew --offline --no-daemon --max-workers=2 -I ../../../tools/android-inventory.gradle :app:dshReleaseInventory -PdshInventoryPath="$PWD/../../../.cache/m4/android-artifacts.json"'
tools/run-limited.sh python3 tools/android-inventory.py --fetch-poms --osv
```

后者从 Google Maven/Maven Central 补齐缺失 POM（有界 4 并发），记录外部 artifact/POM 哈希、许可证声明及 Maven OSV 公告快照，不替代平台二进制或许可证独立审查；本地 Flutter 插件 project 单独列出并排除，OSV 查询失败不会记为零公告。Apple 依赖仍需要 Xcode 实际解析清单。独立密码学交接见 [Noise 审查范围](noise-review.md)，当前没有第三方签署报告。
