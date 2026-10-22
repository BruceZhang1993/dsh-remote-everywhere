# DSH Remote Mobile

正式 Android / iOS Flutter 控制端，复用 `../../packages/core/dart` 的 Noise 与远程协议。
工具链固定 Flutter **3.47.7** / Dart **3.13.5**；Android minSdk **24**，iOS deployment target **15.0**。

## 安装

正式签名 APK 发布在 [GitHub Releases](https://github.com/BruceZhang1993/dsh-remote-everywhere/releases)，请查看 Pre-release 并选择目标版本；缺少附件时尚不可下载。安装、SHA256SUMS/证书校验、调试包迁移与升级见 [安装指引](../../docs/install.md)。iOS 暂无可安装 IPA；以下本地构建命令面向开发者。

## 使用流程

1. 按 [当前安装指引](../../docs/install.md) 启用真实 DSH 插件和模型。跨设备连接先开启公网隧道，再开始配对；默认只授权 `session,stream,approval`。
2. 在 App 扫码或粘贴配对 JSON，人工核对两端六位安全码，并在被控 DSH 本机确认。双方成功后才保存信任并连接。
3. 选择已有会话或工作区新建会话，发送提示、查看助手及工具输出。审批与提问卡片由用户响应；文件和命令操作仅在对应权限获授后呈现，每次写操作都需人工审批。
4. App 进入后台会断开，回到前台重新握手并补齐当前会话。每台设备保存最近 8 个成功连接地址，冷启动后点击设备直接使用最近一次地址；设备菜单的「连接地址」可选择历史地址或输入新地址。旧版未保存地址的设备需补录一次；隧道地址失效时更新地址，无需重新配对。移除本机记录同时删除地址历史，不会代替宿主吊销。

首版限制及当前验证结果见 [M3 总结](../../docs/m3-summary.md)。

## 本地验证

在仓库根目录执行（可用 `DSH_FLUTTER_BIN=/home/bruce/Android/flutter/bin/flutter` 指定工具链）：

```bash
tools/mobile-check.sh check
tools/mobile-check.sh android
```

Android 构建需要 JDK 17 或更新版本；本机实测使用 `JAVA_HOME=/usr/lib/jvm/java-21-openjdk` 和 `ANDROID_HOME=/home/bruce/Android/Sdk`，系统默认 Java 8 不可作为 Gradle 工具链。Gradle 使用 2 GiB heap、1 GiB metaspace、最多两个 worker，并关闭持久 daemon，避免超过整个构建树的 8 GiB 上限。

脚本将整个 pub get、analyze、test、build 树包在 `tools/run-limited.sh` 的用户 systemd scope 中：8 GiB 内存、4 GiB swap；用户 manager 不可用就停止。重构建须串行。
Android CI APK 位于 `.cache/mobile/dsh-remote-release.apk`，未提供发布签名变量时使用调试签名，仅供本地验收。正式发布入口为 `bash tools/mobile-release.sh`，强制要求发布密钥和证书指纹，输出 `.cache/mobile-release/`；版本与签名 Secrets、GitHub Release 配置见 [CI 与版本发布](../../docs/ci-release.md)。

macOS / Xcode 未签名构建入口（Linux 无法执行）：

```bash
# 确认 macOS runner 内存条件、显式授权无 systemd 上限后运行。
DSH_IOS_ALLOW_UNBOUNDED=1 tools/mobile-check.sh ios
```

macOS 不支持 Linux systemd/cgroup 上限，脚本默认停止，必须显式授权。产物 `.cache/mobile/dsh-remote-ios-unsigned.zip` 包含 `.app`，不是可装机 IPA。
`.github/workflows/mobile.yml` Android job 使用 GitHub 托管 Linux runner 的 Ubuntu 容器，整 job 限制为 8 GiB 内存 / 4 GiB swap，并安装 JDK 21 与 Android SDK；本机入口仍使用用户 systemd scope。iOS job 在 Android job 后串行执行，仅在手动触发并勾选 `allow_macos_build` 时开启。
CI 配置本身不代表已在远端执行，也不代表 iOS 已通过编译。

## 平台边界

`IdentityVault` 使用平台安全存储保存 32 字节长期身份私钥和最多 64 个信任设备，保存 `deviceId/publicKey/name/caps` 及每台设备最近 8 个成功连接地址（局域网或公网）；二维码 sid、会话正文不落盘。历史地址仅用于定位，连接仍校验原配对公钥；沿用当前传输限制（WSS 或本机回环 WS）。
Android 使用插件 RSA OAEP + AES-GCM 默认加密，关闭损坏后自动清空，禁云备份与设备迁移。
iOS Keychain 为 `unlocked_this_device` 且禁同步，绑定当前设备、仅解锁时可读。卸载后的 Keychain 保留行为须在平台验收确认，不能假定卸载即清除信任。
Noise 私钥参与 Dart 内存运算，不宣称硬件不可导出 X25519。
`FakeKeyValueStore` 仅作单元测试注入，生产默认平台存储；存储损坏/不可用会向 UI 抛错，不自动换身份。

扫码仅请求相机权限；拒绝权限可返回粘贴二维码。`QrScannerPage` 返回原始文本，由控制层验证二维码、期限、公钥和人工 SAS，不在扫码层授予信任。
本轮不进行真机验收。

依赖核查依据：[flutter_secure_storage 10.3.4](https://pub.dev/packages/flutter_secure_storage/versions/10.3.4)、[AndroidOptions](https://pub.dev/documentation/flutter_secure_storage/10.3.4/flutter_secure_storage/AndroidOptions-class.html)、[KeychainAccessibility](https://pub.dev/documentation/flutter_secure_storage/10.3.4/flutter_secure_storage/KeychainAccessibility.html)、[mobile_scanner 7.4.2](https://pub.dev/packages/mobile_scanner/versions/7.4.2)。
