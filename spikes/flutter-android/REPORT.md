# Flutter Android Build-Verification SPIKE — REPORT

**Date:** 2026-10-10 (Asia/Shanghai), window 10:30:56 → 10:46
**Host:** Arch Linux 7.2.8-1-cachyos, x86_64, locale `zh_CN.UTF-8`
**Scope:** everything below was run inside `spikes/flutter-android/` only. Nothing outside the repo was modified except caches the toolchain owns (`~/.gradle`, `~/.pub-cache`, `~/Android/Sdk/licenses/`, Flutter's own `bin/cache`).

---

## (a) VERDICT

**CAN BUILD ANDROID: YES.**

A signed, well-formed Android APK was produced and verified on this machine, in both debug and release variants, with `flutter analyze` clean and `flutter test` green. No blocker was hit. The only thing that had to be fixed first was the Android SDK license acceptance (one command, 2.3 s).

---

## (b) EXACT COMMANDS THAT WERE NEEDED, IN ORDER

**Environment exports needed: none.** `ANDROID_HOME`, `ANDROID_SDK_ROOT` and `JAVA_HOME` were all left **unset**, and no `PUB_CACHE`/`GRADLE_USER_HOME`/`HOME` redirects were made. Flutter located the SDK on its own (it writes `sdk.dir` into `android/local.properties` at `flutter create` time) and located a JDK on its own. The only convenience step is putting `flutter` on `PATH`, which is cosmetic and not required:

```bash
export PATH="/home/bruce/Android/flutter/bin:$PATH"   # optional convenience only; no effect on the build
```

The full working sequence, verbatim as executed:

```bash
cd /home/bruce/Projects/dsh-remote-everywhere/spikes/flutter-android

# 1. baseline inspection + config dump
flutter doctor -v
flutter config --list

# 2. THE ONE REQUIRED FIX — accept Android SDK licenses
yes | flutter doctor --android-licenses

# 3. generate the app (Android + iOS skeletons)
flutter create --org dev.bruce --platforms=android,ios t_app

# 4. primary gate
cd t_app
flutter build apk --debug

# 5. release gate
flutter build apk --release

# 6. rebuild cost (twice: unchanged tree, then after a real source edit)
flutter build apk --debug

# 7. toolchain test path
flutter analyze
flutter test

# 8. APK well-formedness
/home/bruce/Android/Sdk/build-tools/37.0.0/aapt2 dump badging build/app/outputs/flutter-apk/app-debug.apk
/home/bruce/Android/Sdk/build-tools/37.0.0/aapt2 dump badging build/app/outputs/flutter-apk/app-release.apk
/home/bruce/Android/Sdk/build-tools/37.0.0/apksigner verify --print-certs build/app/outputs/flutter-apk/app-release.apk
/home/bruce/Android/Sdk/build-tools/37.0.0/zipalign -c -v 4 build/app/outputs/flutter-apk/app-release.apk
```

**Toolchain actually used (as resolved by Flutter, not assumed):**

| Component | Value |
|---|---|
| Flutter | 3.47.7 stable, framework rev `abaf9c5237`, engine rev `deb287481e` |
| Dart | 3.13.5 (stable, 2026-09-29), DevTools 2.60.0 |
| Flutter SDK path | `/home/bruce/Android/flutter` |
| Android SDK | `/home/bruce/Android/Sdk` (build-tools 37.0.0, platform `android-37.0`) |
| JDK used for Gradle | `/opt/android-studio/jbr` — OpenJDK **25.0.3** (auto-detected by Flutter) |
| Gradle | 9.3.1 (`-all` dist, downloaded by the wrapper during the first build) |
| AGP / Kotlin | `com.android.application` **9.1.0** / `org.jetbrains.kotlin.android` **2.4.0** |
| compileSdk / targetSdk / minSdk | 36 / 36 / 24 (Flutter template defaults) |

> Note on Java: `java` on `PATH` is **Java 8** (`1.8.0_491`) and `JAVA_HOME` is unset. That did **not** matter — Flutter ignored it and used Android Studio's bundled JBR 25. Do not "fix" this by exporting `JAVA_HOME=/usr/lib/jvm/java-8-*`; that would break Gradle 9.

---

## (c) REAL TIMINGS (measured wall clock)

| Step | Wall time | Tool-reported | Result |
|---|---|---|---|
| `flutter doctor -v` (first run, downloads 6 engine artifact groups) | **10.0 s** | — | 2 issues (licenses, adb) |
| `flutter config --list` | **0.08 s** | — | 21 settings, all "Not set" |
| `yes \| flutter doctor --android-licenses` | **2.3 s** | — | "All SDK package licenses accepted" |
| `flutter create --org dev.bruce --platforms=android,ios t_app` | **3.4 s** | 75 files written | exit 0 |
| **`flutter build apk --debug` (FIRST EVER)** | **443.0 s = 7.38 min** | Gradle `assembleDebug` 429.9 s | ✓ `app-debug.apk` |
| **`flutter build apk --release` (first)** | **123.8 s = 2.06 min** | Gradle `assembleRelease` 121.5 s | ✓ `app-release.apk` (44.1MB) |
| **`flutter build apk --debug` REBUILD** (no source change) | **10.9 s = 0.18 min** | Gradle 6.6 s | ✓ |
| `flutter build apk --debug` rebuild **after editing `lib/main.dart`** | **21.3 s = 0.36 min** | Gradle 16.3 s | ✓ |
| `flutter analyze` | **18.6 s** | "ran in 17.7s" | **No issues found!** |
| `flutter test` | **23.0 s** | `+1: All tests passed!` | ✓ 1 test |

Cold-path total from nothing to a debug APK: `doctor 10.0 + licenses 2.3 + create 3.4 + build 443.0` ≈ **7.6 min**.
(*The debug build itself contains the one-time Gradle 9.3.1 distribution download; that is the dominant one-off cost.*)

---

## (d) DOCTOR OUTPUT (verbatim, `flutter doctor -v`)

```
[1/4] Flutter SDK
  ├─ [1/5] sky_engine                                              640ms
  ├─ [2/5] flutter_gpu                                              70ms
  ├─ [3/5] flutter_patched_sdk                                     489ms
  ├─ [4/5] flutter_patched_sdk_product                             418ms
  └─ [5/5] linux-x64                                                3.2s
[4/4] linux-x64/font-subset                                        370ms
[!] Flutter (Channel stable, 3.47.7, on Arch Linux 7.2.8-1-cachyos, locale zh_CN.UTF-8) [83ms]
    • Flutter version 3.47.7 on channel stable at /home/bruce/Android/flutter
    ! The flutter binary is not on your path. Consider adding /home/bruce/Android/flutter/bin to your path.
    ! The dart binary is not on your path. Consider adding /home/bruce/Android/flutter/bin to your path.
    • Upstream repository https://github.com/flutter/flutter.git
    • Framework revision abaf9c5237 (34 小时前), 2026-10-08 09:51:21 -0700
    • Engine revision deb287481e
    • Dart version 3.13.5
    • DevTools version 2.60.0
    • Feature flags: enable-web, enable-linux-desktop, enable-macos-desktop, enable-windows-desktop, enable-android, enable-ios, cli-animations, enable-native-assets, enable-record-use, enable-swift-package-manager, omit-legacy-version-file, enable-lldb-debugging, enable-uiscene-migration
    • If those were intentional, you can disregard the above warnings; however it is recommended to use "git" directly to perform update checks and upgrades.

[!] Android toolchain - develop for Android devices (Android SDK version 37.0.0) [3.1s]
    • Android SDK at /home/bruce/Android/Sdk
    • Emulator version 36.6.11.0 (build_id 15507667) (CL:N/A)
    • Platform android-37.0, build-tools 37.0.0
    ! Multiple adb binaries found. This can cause conflicts and device detection issues:
        - /home/bruce/Android/Sdk/platform-tools/adb
        - /opt/android-sdk/platform-tools/adb
    • Java binary at: /opt/android-studio/jbr/bin/java
      This is the JDK bundled with the latest Android Studio installation on this machine.
      To manually set the JDK path, use: `flutter config --jdk-dir="path/to/jdk"`.
    • Java version OpenJDK Runtime Environment (build 25.0.3+-15898627-b508.16)
    ! Some Android licenses not accepted. To resolve this, run: flutter doctor --android-licenses

[✓] Chrome - develop for the web [11ms]
    • CHROME_EXECUTABLE = /usr/bin/google-chrome-stable

[✓] Linux toolchain - develop for Linux desktop [552ms]
    • clang version 23.1.1
    • cmake version 4.4.4
    • ninja version 1.13.2
    • pkg-config version 3.0.7
    • OpenGL core renderer: AMD Radeon Graphics (radeonsi, renoir, ACO, DRM 3.64, 7.2.8-1-cachyos)
    • OpenGL core version: 4.6 (Core Profile) Mesa 26.2.4-arch3.1
    • OpenGL core shading language version: 4.60
    • OpenGL ES renderer: AMD Radeon Graphics (radeonsi, renoir, ACO, DRM 3.64, 7.2.8-1-cachyos)
    • OpenGL ES version: OpenGL ES 3.2 Mesa 26.2.4-arch3.1
    • OpenGL ES shading language version: OpenGL ES GLSL ES 3.20
    • GL_EXT_framebuffer_blit: yes
    • GL_EXT_texture_format_BGRA8888: yes

[✓] Connected device (2 available) [138ms]
    • Linux (desktop) • linux  • linux-x64      • Arch Linux 7.2.8-1-cachyos
    • Chrome (web)    • chrome • web-javascript • Google Chrome 155.0.8059.39

[✓] Network resources [524ms]
    • All expected network resources are available.

! Doctor found issues in 2 categories.
```

**After** the license fix, the Android line reads (re-ran doctor to confirm):

```
[✓] Android toolchain - develop for Android devices (Android SDK version 37.0.0)
    ! Multiple adb binaries found. This can cause conflicts and device detection issues:
        - /home/bruce/Android/Sdk/platform-tools/adb
        - /opt/android-sdk/platform-tools/adb
[✓] Chrome - develop for the web
```

`flutter config --list` (verbatim, verbatim-only; everything is at defaults, which is correct):

```
All Settings:
  enable-web: (Not set)
  enable-linux-desktop: (Not set)
  enable-macos-desktop: (Not set)
  enable-windows-desktop: (Not set)
  enable-android: (Not set)
  enable-ios: (Not set)
  enable-fuchsia: (Not set) (Unavailable)
  enable-custom-devices: (Not set)
  cli-animations: (Not set)
  enable-native-assets: (Not set)
  enable-dart-data-assets: (Not set) (Unavailable)
  enable-record-use: (Not set)
  enable-swift-package-manager: (Not set)
  omit-legacy-version-file: (Not set)
  enable-windowing: (Not set) (Unavailable)
  enable-accessibility-evaluations: (Not set) (Unavailable)
  enable-lldb-debugging: (Not set)
  enable-uiscene-migration: (Not set)
  enable-riscv64: (Not set)
  enable-macos-arm64-only: (Not set)
```

**Step 3 note (iOS skeleton):** yes, an iOS project skeleton **is** generated on Linux. `flutter create --platforms=android,ios` wrote `ios/Runner.xcodeproj/project.pbxproj`, `ios/Runner.xcworkspace`, `ios/Runner/AppDelegate.swift`, `ios/Runner/SceneDelegate.swift`, `ios/RunnerTests/RunnerTests.swift`, asset catalogs and storyboards. There is **no `ios/Podfile`** — this Flutter version uses **Swift Package Manager** (`ios/Flutter/ephemeral/Packages/FlutterGeneratedPluginSwiftPackage/Package.swift`, `.swift_pm.lock`). Generation is platform-independent; building is not.

---

## (e) APK BADGING SUMMARY + PATH + SIZE

`aapt2 dump badging` (build-tools 37.0.0), identical identity fields for both variants:

```
package: name='dev.bruce.t_app' versionCode='1' versionName='1.0.0' platformBuildVersionName='16'
         platformBuildVersionCode='36' compileSdkVersion='36' compileSdkVersionCodename='16'
minSdkVersion:'24'
targetSdkVersion:'36'
application-label:'t_app'
launchable-activity: name='dev.bruce.t_app.MainActivity'
native-code: 'arm64-v8a' 'armeabi-v7a' 'x86_64'
uses-permission: name='android.permission.INTERNET'
uses-permission: name='dev.bruce.t_app.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION'
```

| | Debug | Release |
|---|---|---|
| Path (relative to `spikes/flutter-android/`) | `t_app/build/app/outputs/flutter-apk/app-debug.apk` | `t_app/build/app/outputs/flutter-apk/app-release.apk` |
| Size (bytes) | **150,418,140** (143.4 MiB / `du` 144M) | **44,103,444** (42.1 MiB; Flutter reported "44.1MB") |
| minSdk / targetSdk / compileSdk | 24 / 36 / 36 | 24 / 36 / 36 |
| Package name | `dev.bruce.t_app` | `dev.bruce.t_app` |
| versionCode / versionName | 1 / 1.0.0 | 1 / 1.0.0 |
| Native ABIs in `lib/` | `arm64-v8a`, `armeabi-v7a`, `x86_64` | `arm64-v8a`, `armeabi-v7a`, `x86_64` |
| Launchable activity | `dev.bruce.t_app.MainActivity` | same |
| Signature | debug keystore | debug keystore (`V2 Signer: certificate DN: C=US, O=Android, CN=Android Debug`, SHA-256 `e82c9fdd…`), `apksigner verify` exit 0 |
| Zip alignment | — | `zipalign -c -v 4` → **Verification successful** |

Notes: no `x86` (32-bit) ABI — the Flutter template ships `arm64-v8a`, `armeabi-v7a`, `x86_64` only. The debug APK is large because it is a fat APK carrying all three ABIs plus unstripped debug engine artifacts. Release is **signed with the debug key** because that is what the generated template does by default (`signingConfig = signingConfigs.getByName("debug")`) — a real release needs a real keystore.

**Verification scope note (honest boundary):** `flutter devices` showed only Linux desktop and Chrome — **no Android device or emulator was running**, so the APK was verified as *well-formed and correctly signed*, not *launched on a device*. Runtime/on-device smoke testing was outside the steps requested.

---

## (f) ERRORS ENCOUNTERED, VERBATIM, AND RESOLUTION

**1. Android licenses — a REAL issue, and it DID need fixing.**
Doctor reported:
```
    ! Some Android licenses not accepted. To resolve this, run: flutter doctor --android-licenses
```
Resolved with `yes | flutter doctor --android-licenses` (2.3 s, exit 0, ends with `All SDK package licenses accepted`). Verdict on "was it actually needed?": **yes.** The directory already held 7 license files from 2021–2025, but a **newly required** license was missing — the run wrote a fresh `/home/bruce/Android/Sdk/licenses/microxr-sysimage-license` (timestamped 10:31 today). After the fix, doctor's Android toolchain line flipped from `[!]` to `[✓]`.

**2. Multiple adb binaries — warning only, NOT fixed, no impact.**
```
    ! Multiple adb binaries found. This can cause conflicts and device detection issues:
        - /home/bruce/Android/Sdk/platform-tools/adb
        - /opt/android-sdk/platform-tools/adb
```
`/opt/android-sdk/platform-tools` is on `PATH` (the decoy SDK) while the real SDK is `/home/bruce/Android/Sdk`. This does not affect `flutter build apk` at all — Gradle uses `sdk.dir` from `local.properties`. It could cause device-detection confusion later; fixing it means editing `PATH` outside this repo, so it was deliberately left alone.

**3. SDK XML version skew — benign warning, no action.**
```
Warning: SDK processing. This version only understands SDK XML versions up to 3 but an SDK XML file of version 4 was encountered. This can happen if you use versions of Android Studio and the command-line tools that were released at different times.
```
Also printed: `WARNING: The SDK Manager CLI tool (sdkmanager) is deprecated. Use Android CLI instead.` Build succeeded regardless.

**4. JDK 25 / Gradle native-access warnings — benign noise, no action.**
```
Picked up _JAVA_OPTIONS: -Dawt.useSystemAAFontSettings=lcd
WARNING: A restricted method in java.lang.System has been called
WARNING: java.lang.System::load has been called by net.rubygrapefruit.platform.internal.NativeLibraryLoader in an unnamed module (file:/home/bruce/.gradle/wrapper/dists/gradle-9.3.1-all/9ot9r568e8zfvvd4mn8rbu1j0/gradle-9.3.1/lib/native-platform-0.22-milestone-29.jar)
WARNING: Use --enable-native-access=ALL-UNNAMED to avoid a warning for callers in this module
WARNING: Restricted methods will be blocked in a future release unless native access is enabled
```
The `_JAVA_OPTIONS` line appears because `_JAVA_OPTIONS=-Dawt.useSystemAAFontSettings=lcd` is set in the environment; it is prefixed to every JVM start and is harmless. Despite Gradle 9.3.1 running on JDK 25 with AGP 9.1.0, everything built. **No `org.gradle.java.home` override and no `flutter config --jdk-dir` was needed.**

**5. iOS build on Linux — fails immediately, as expected.**
```
$ flutter build ios
Could not find a subcommand named "ios" for "flutter build".
(exit 64)
```
Before that, `flutter build ios --debug` and `flutter build ios --no-codesign` produced `Could not find an option named "--debug"` / `Could not find an option named "--no-codesign"`, because on Linux the `ios` build target is not even registered. `flutter build -h` on this host lists only: `aar, apk, appbundle, bundle, linux, web`.

**No build error, crash, or unresolved failure occurred on the Android path.**

---

## (g) WHAT STILL NEEDS A MAC

**iOS: everything past file generation.** `flutter create` produced a complete, SPM-based `ios/` project on Linux (no Podfile; Swift Package Manager instead), but building, signing, running and archiving iOS all require **macOS with Xcode** — on Linux `flutter build ios` is not even a subcommand (exit 64, verbatim error in §f.5). A Mac is needed for: `xcodebuild`/Xcode toolchain, CocoaPods or SPM resolution of native plugin dependencies, code signing certificates and provisioning profiles, `flutter build ipa`, and any simulator/device run. Additionally there is **no CocoaPods/Podfile path in this generated project at all** — plugin native deps go through Swift Package Manager, so the Mac will need Xcode with SPM support rather than a `pod install` workflow.

---

## (h) FIRST-EVER BUILD COST vs REBUILD

| | Wall clock |
|---|---|
| **First-ever `flutter build apk --debug`** (empty Gradle caches for Gradle 9.3.1 + AGP 9.1.0/Kotlin 2.4.0) | **443.0 s ≈ 7.38 min** (Gradle task itself 429.9 s) |
| First full cold path (doctor + licenses + create + debug build) | **≈ 7.6 min** |
| First `flutter build apk --release` (warm Gradle, different task graph) | **123.8 s ≈ 2.06 min** |
| **Rebuild, no source change** | **10.9 s ≈ 0.18 min** (Gradle 6.6 s) |
| **Rebuild after editing `lib/main.dart`** | **21.3 s ≈ 0.36 min** (Gradle 16.3 s) |

**~41× speedup** from first build to a no-change rebuild, and **~21×** to a rebuild after a real source edit. The one-off costs are the Gradle 9.3.1 distribution download (inside the first debug build) and AGP/Kotlin dependency resolution.

---

## DISK USAGE ADDED (step 8)

| Location | Before | After | Delta |
|---|---|---|---|
| `spikes/flutter-android/` | 0 | **2.7 GB** | +2.7 GB |
| ↳ `t_app/build/` | — | 2.6 GB | (build intermediates + 194 MB of APKs) |
| ↳ `t_app/.dart_tool/` | — | 78 MB | |
| ↳ `logs/` (raw command logs) | — | 104 KB | |
| `~/.gradle` | 6.7 GB | **11 GB** | **+4.3 GB** |
| ↳ `~/.gradle/caches` | 3.8 GB | 6.9 GB | +3.1 GB (AGP 9.1.0 / Kotlin 2.4.0 artifacts + transforms) |
| ↳ `~/.gradle/wrapper` | 151 MB | 904 MB | +753 MB (`gradle-9.3.1-all` dist, newly downloaded) |
| `~/.pub-cache` | 1.6 GB | **1.7 GB** | +≈0.1 GB |
| `~/Android/flutter/bin/cache` (engine artifacts; outside repo) | n/a | 1.9 GB total, of which `artifacts/engine/` is 1.1 GB | 6 Android engine artifact groups pulled during the first build (~8 s) |
| Root filesystem free | 94 GB | **85 GB** | −9 GB (spike + caches + unrelated system activity) |

`t_app/build/` is safely deletable; `~/.gradle` and `~/.pub-cache` are reusable caches and must **not** be wiped — they are what makes the 10.9 s rebuild possible.

---

## READ-ONLY ADJACENT CHECK: `cryptography` Dart package feasibility

Per instruction this was informational only — **no package depending on `cryptography` was created, and `cryptography` itself was not resolved or built.**

```
$ dart --version
Dart SDK version: 3.13.5 (stable) (Tue Sep 29 01:00:52 2026 -0700) on "linux_x64"

$ dart pub global list
flutter_distributor 0.3.7 at path "/home/bruce/StudioProjects/FlClash/plugins/flutter_distributor/packages/flutter_distributor"
```

Facts established: Dart SDK is **3.13.5** (well past the Dart 3.x floor that `cryptography` requires, and its null-safety/pub constraints are satisfied by a modern SDK); the pub network path works (doctor `[✓] Network resources`, and `flutter create` performed a real `Downloading packages... Got dependencies`); the toolchain supports FFI/native assets (`enable-native-assets` is an active feature flag) and NDKs are installed (7 present, e.g. `30.0.14904198` under `/home/bruce/Android/Sdk/ndk/`), which is the prerequisite shape for a native-backed crypto package.

**Not established (do not treat as verified):** whether `cryptography`/`cryptography_flutter` actually resolve against Dart 3.13.5, and whether any of its native backends compile for Android here. That requires a real `pub add` + build and was explicitly out of scope.

---

## RAW EVIDENCE

Full command logs are preserved in `spikes/flutter-android/logs/`:

| File | Contents |
|---|---|
| `01-doctor.txt` / `.meta` | `flutter doctor -v` verbatim, exit 0, 9.997 s |
| `02-licenses.txt` / `.meta` | license acceptance, exit 0, 2.275 s |
| `03-create.txt` / `.meta` | `flutter create`, exit 0, 3.438 s, 75 files |
| `04-build-debug.txt` / `.meta` | first debug build, exit 0, **443.041 s** |
| `05-build-release.txt` / `.meta` | release build, exit 0, **123.838 s** |
| `06-rebuild-debug.txt` / `.meta` | rebuild, exit 0, **10.935 s** |
| `06b-rebuild-after-edit.txt` | rebuild after source edit, exit 0, 21.323 s |
| `07-badging-debug.txt`, `07-badging-release.txt` | `aapt2 dump badging`, exit 0 |
| `08-analyze.txt` / `.meta` | "No issues found! (ran in 17.7s)", exit 0, 18.609 s |
| `09-test.txt` / `.meta` | "+1: All tests passed!", exit 0, 22.985 s |
| `10-build-ios.txt` | iOS-on-Linux failure, exit 64 |

The probe edit made to `lib/main.dart` for the incremental-rebuild measurement was reverted immediately and verified byte-identical to the generated original (single appended comment line; `diff` → identical).
