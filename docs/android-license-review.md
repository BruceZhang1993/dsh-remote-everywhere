# Android 许可证声明补证

日期：2026-10-14。范围为 M4 已解析的 86 个 Maven 坐标中，6 个缺直接 POM 许可证声明的坐标。本文核对来源和 APK 已嵌入文本，不代替独立许可证合规或二进制审查。

## 结果

| 坐标 | 补充证据 | 结论 |
|---|---|---|
| `com.google.auto.value:auto-value-annotations:1.6.3` | child POM → `auto-value-parent:1.6.3` → `com.google.auto:auto-parent:7`；最后一层有 Apache 2.0 声明 | 已找到准确版本的继承声明 |
| `com.google.guava:listenablefuture:1.0` | child POM → `guava-parent:26.0-android`；parent 有 Apache 2.0 声明 | 已找到准确版本的继承声明 |
| Flutter `arm64_v8a_release`、`armeabi_v7a_release`、`x86_64_release`、`flutter_embedding_release` | 四个坐标均固定 engine `deb287481e3ce9468f3434937ced4240a70539ca`；从该 revision 的官方 `sky_engine.zip` 读取 LICENSE，并与本机 SDK 许可证哈希比较 | 已找到匹配 engine 的聚合许可证；包含第三方组件，不能统一简化为 BSD |

原始 POM 的直接声明仍为空。补证记录单独保存在 [android-license-evidence.json](android-license-evidence.json)，保留 child POM、parent POM、产物与许可证的 SHA-256，不覆盖原始库存。

来源：[auto-value-parent 1.6.3](https://repo.maven.apache.org/maven2/com/google/auto/value/auto-value-parent/1.6.3/auto-value-parent-1.6.3.pom)、[auto-parent 7](https://repo.maven.apache.org/maven2/com/google/auto/auto-parent/7/auto-parent-7.pom)、[guava-parent 26.0-android](https://repo.maven.apache.org/maven2/com/google/guava/guava-parent/26.0-android/guava-parent-26.0-android.pom)、[匹配 engine 的 sky_engine.zip](https://storage.googleapis.com/flutter_infra_release/flutter/deb287481e3ce9468f3434937ced4240a70539ca/sky_engine.zip)。下载证据位于 `.cache/m4/license-review/`。

## 已分发的 Flutter 文本核对

远端 APK 来自验证提交 `e4a1b32`，SHA-256 为 `0f4528c254ab4be6d0204bce80c652f11fa5471eed2a2b289889b6dd68dca8bf`。
解压 APK 的 `assets/flutter_assets/NOTICES.Z`，按当前 Flutter LicenseCollector 的 80 个连字符分隔规则提取 engine 许可证正文：1593 个块、1588 个不同正文，全部在 APK notices 中找到；Flutter SDK 根许可证也存在。

本机 `LICENSE.flutter_jar_zip.md` 指向旧 engine `035316565ad77281a75305515e4682e6c4c6f7ca`，与实际坐标不一致。本次未使用该旧链接作为证据，改用准确 revision 的官方 archive；其 LICENSE 与本机 `sky_engine/LICENSE` 的 SHA-256 一致。

## 仍待完成

2026-10-15 已补齐当前 Maven/native 声明扫描、现有 APK 对照及 JNI archive 来源，见 [分发声明材料](android-notices.md)。已准备审查归档，完整许可/二进制结论仍待外部审查。

- 全部 Maven/native 依赖的分发许可证与 notice 要求复核；auto-value/listenablefuture 的名称未在 Flutter 自动生成的 notices 中找到，不能仅凭 parent 声明认定分发义务已完成。
- Apple 解析结果、平台二进制和 SDK/工具链独立审查。
- 重新生成正式签名 App 后，针对最终产物复核许可证文本和产物哈希；当前 APK 仍使用调试签名。
