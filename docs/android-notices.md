# Android 分发声明材料

日期：2026-10-15。此批材料核对现有 M4 依赖和 APK，尚未作为正式 App 的分发声明发布，也不代表独立许可或二进制审查结论。

## Maven/native 材料

`tools/android-notices.py` 对当前 86 坐标/91 产物逐个核对原始 SHA-256，扫描 JAR/AAR 和一层内嵌 JAR 中的 LICENSE、NOTICE、COPYING、COPYRIGHT；保留原始字节与来源。无 archive 路径解压，文本按哈希命名。每份文本 ≤2 MiB，总文本 ≤16 MiB，最多 256 个不同文本；内嵌 JAR ≤32 MiB，条目数 ≤20000。

| 库存类别 | 坐标数 | 分发前仍需核对 |
|---|---:|---|
| Apache 声明及 parent 补证 | 71 | 保留准确组件的 LICENSE/NOTICE；未找到内嵌 NOTICE 不代表上游没有归属要求 |
| Apache + BSD-3-Clause | 1 | `camera-core:1.6.1` 的 BSD 组件、准确来源和归属文本；不能只复制 Apache 文本 |
| ML Kit Terms of Service | 6 | SDK/模型的分发条款与 App 隐私告知 |
| Android SDK License | 4 | POM 指向的实际条款及适用分发范围 |
| Flutter 聚合许可证 | 4 | 使用匹配 engine 的完整聚合文本；既有 APK 嵌入校验见 [六项补证](android-license-review.md) |

11 个坐标有内嵌声明，共保留 4 份不同文本（包括原始声明、标准 Apache 文本及 Flutter engine 聚合文本）；15 个原始依赖 native 条目的名称、大小和哈希已记录。一层扫描后没有尚未检查的内嵌 JAR。以上仅针对外部 Maven 产物，不覆盖本地 Flutter plugin project 或 Apple。

生成入口需要原始 `.cache/m4/android-dependencies.json`、其对应产物和 [六项证据](android-license-evidence.json)，以及 `.cache/m4/license-review/` 中已核验的 Apache/engine 文本。输入绑定当前库存快照；换依赖或重建不同库存后须重新审查补证，不能沿用旧批准。

```bash
tools/run-limited.sh python3 tools/android-notices.py
```

输出 `.cache/m4/android-notices/manifest.json`、各文本的 SHA-256 命名文件和 `THIRD_PARTY_NOTICES.txt`。manifest 保留独立审查未批准状态。标准 Apache 文本来自 [Apache 官方](https://www.apache.org/licenses/LICENSE-2.0.txt)，SHA-256 固定为 `cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30`。

ML Kit 的 [官方条款/隐私说明](https://developers.google.com/ml-kit/terms)列出使用指标发送及用户告知要求；仍需核对 App 的实际配置与披露材料。不能由“识别在设备上执行”推断没有指标通信。SDK 类条款保留 [POM 指向的官方入口](https://developer.android.com/studio/terms.html)，本轮没有代用户接受协议。

## 现有 APK 的 native 对照

核对对象为 `e4a1b32` 的已校验远端 APK，SHA-256 `0f4528c254ab4be6d0204bce80c652f11fa5471eed2a2b289889b6dd68dca8bf`；它不代表后续最终签名产物。

- APK 有 18 个 `.so`：9 个与 Maven 原始条目逐字节相同；3 个 Flutter engine 与本机 stripped 输出相同，其 merged 输出也与原始 Maven 条目相同。
- 其余 6 个为三个 ABI 的 `libapp.so` 和 `libdartjni.so`。已定位应用编译输出和本地 JNI plugin project，但这些条目与本机产物的字节不同，不把源包名称一致当成跨环境二进制复现。
- `libdartjni.so` 来源追溯到 `jni 1.1.0` 的 `android/build.gradle → src/CMakeLists.txt → dartjni.c/global_jni_env.c/dart_api_dl.c`。官方 archive SHA-256 `6b9ca0602fef0230e83149afbe3f9f8227e94f2bbe84a1da4f14d699742f402d` 与锁文件一致，181 个 archive 文件与本机安装文件全部匹配。包含 Dart BSD 文本及 AOSP Apache 声明，不把整个 JNI 编译单元简化成一个许可证标签。来源：[固定版本](https://pub.dev/packages/jni/versions/1.1.0)、[官方 archive](https://pub.dev/api/archives/jni-1.1.0.tar.gz)。

详细条目与本机中间产物链记录在 `.cache/m4/android-notices/{apk-native,jni-provenance}.json`。这补齐了 Maven 库存之外的来源线索；编译工具链、最终二进制、Camera BSD 来源、其余 plugin 和 Apple 仍需审查。

## 交接与最终产物

本轮审查材料归档为 `.cache/m4/android-notice-review-20261015.zip`，包含声明文本、完整坐标/哈希、APK 对照、JNI 来源及原始库存。未向外部审查者发送。
完成逐项审查后，再将获批准的文本随正式签名 App 分发，并对最终 APK 的内容与 SHA 重新验收。当前材料生成、source archive 匹配和已有 debug 签名 APK 均不关闭正式 App 的独立审查/签名/平台门禁。
