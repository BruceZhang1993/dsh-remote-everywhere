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

**不要**清理 `~/.gradle` 与 `~/.pub-cache` —— 它们是增量重建只需约 11 秒的原因（冷构建则需
约 7.4 分钟）。

---

## 3. 常用命令

### 3.1 Flutter / Android

```bash
flutter doctor -v                      # 环境体检
flutter doctor --android-licenses      # 接受许可（首次可能需要）
flutter analyze                        # 静态分析
flutter test                           # 单元测试
flutter build apk --debug              # 调试包（首次会下载 Gradle/依赖，耗时较长）
flutter build apk --release            # 发布包
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
pnpm install
pnpm -r test
pnpm -r run check
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

- [ ] M1：`pnpm install` 后的仓库级命令（构建、测试、lint）
- [ ] M1：仓库边界检查（确保 `packages/{protocol,core,tunnel}` 不 import `@deepseek-ai/*`）
- [ ] M2：把插件安装到 DSH profile 的完整步骤与回滚方式
- [ ] M3：Android 真机/模拟器调试流程；iOS 的 macOS CI 配置
- [ ] M4：发布流程（npm publish、版本号规则、双语文档校验）
