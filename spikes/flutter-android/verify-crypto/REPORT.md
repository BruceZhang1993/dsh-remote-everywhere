# Crypto stack verification — `Noise_XX_25519_ChaChaPoly_BLAKE2s` on Flutter 3.47.7 / Dart 3.13.5

**Date:** 2026-10-10
**Scope:** `spikes/flutter-android/verify-crypto/` (self-contained; `t_app` untouched)
**Question:** can this exact toolchain resolve, compile **and run** the primitives our pure-Dart Noise
implementation needs — including inside a real Android app build — with no C toolchain, no build hook
and no approval-gated install script?

| Environment | Value |
|---|---|
| Flutter | 3.47.7 stable (engine rev `deb287481e`) |
| Dart | 3.13.5 stable |
| Android SDK | `/home/bruce/Android/Sdk` (JAVA_HOME deliberately unset) |
| AGP / Gradle / Kotlin | 9.1.0 / 9.3.1 / 2.4.0 |
| Host | Arch Linux, Linux 7.2.8 |
| Independent reference | CPython 3.14.7 `hashlib`+`hmac` (OpenSSL) and pyca/cryptography 50.0.2 |
| On-device | emulator `qmsd-api33-google-apis-x86-64-pixel6`: Android **13** (API 33), `x86_64` |

---

## (a) Verdict

> ## CRYPTO STACK USABLE ON DART 3.13.5: **YES — with two mandatory mitigations.**

Every primitive the suite needs is available, resolves, compiles and **runs correctly on Android**.
`cryptography 2.9.0` is the right (and only) package to depend on; `pointycastle 4.0.0` is **not needed
for this suite** and does **not** provide BLAKE2s at all.

The two mitigations are not optional and both are headline findings:

1. **`cryptography`'s HMAC is broken for BLAKE2s — do NOT use `Hmac.blake2s()` or
   `Hkdf(hmac: Hmac.blake2s())`.** It pads the HMAC key to 32 bytes (the *digest* size) instead of the
   real 64-byte BLAKE2s compression block, so it produces non-interoperable MACs. Noise's `HMAC-HASH`
   must be implemented directly on `Blake2s`/`DartBlake2s` (≈20 lines, verified byte-exact against
   OpenSSL). `Hmac.blake2b()` has the same defect (pads to 64 instead of 128).
2. **`X25519` accepts low-order points and silently returns an all-zero shared secret.** All 7
   canonical low-order `u`-coordinates return `00…00` with no exception. Noise_XX **must** check for an
   all-zero DH result itself.

Bottom line: **pure Dart only, no C toolchain, no build hooks, no native assets, no NDK, no platform
channels.** Resolution, debug build, release (AOT) build and an on-device run all succeeded.

---

## (b) Resolved versions and dependency nature

Taken from `verify_crypto_app/pubspec.lock` (not from constraint strings).
`flutter pub outdated` reports `cryptography` and `pointycastle` as already at the newest version — there
is no upgrade path available today, so both findings below are present in the current releases.

| Package | Resolved | Purpose in our suite | Nature | Android / iOS caveat |
|---|---|---|---|---|
| **`cryptography`** | **2.9.0** | BLAKE2s-256 (`Blake2s`/`DartBlake2s`), SHA-256 (`Sha256`/`DartSha256`), X25519 (`X25519`/`DartX25519`), ChaCha20-Poly1305 (`Chacha20.poly1305Aead`/`DartChacha20`), `Hkdf` | **Pure Dart.** No `android/`, no `ios/`, no `flutter:` plugin section, no `hook/`, no `build.dart`, no `.c/.cc/.so`, no `DynamicLibrary.open` | None. The only `dart:ffi` import is conditional (`if (dart.library.ffi)`) and only inside the Argon2 implementation, which uses `package:ffi`'s `malloc` for a heap buffer; **we never call Argon2**, so nothing native is linked and web builds are unaffected. |
| **`pointycastle`** | **4.0.0** | Intended for BLAKE2s + SHA-256. **Has no BLAKE2s** — see finding F1. Kept only as an independent second opinion for SHA-256 | **Pure Dart.** No `android/`, no `ios/`, no `hook/`, no native sources | None, but **not required**. Recommend removing it from `packages/core`'s runtime dependencies. |
| `crypto` | 3.0.7 | transitive of `cryptography` (not used by us directly) | Pure Dart | None |
| `ffi` | 2.2.0 | transitive of `cryptography` (Argon2 buffer allocation only) | Pure Dart + `dart:ffi` `malloc` | None |
| `collection`, `meta`, `typed_data`, `convert` | 1.19.1 / 1.18.3 / 1.4.0 / 3.1.2 | transitive support packages | Pure Dart | None |
| `test` | 1.31.1 | **dev only** — lets us run the suite under plain `dart test` | Pure Dart | None |
| `cryptography_flutter` | **2.3.4** (added, recorded, then removed) | **OPTIONAL.** Not required for correctness | **Flutter plugin / platform channel** (Kotlin `dev.dint.cryptography_flutter.CryptographyFlutterPlugin` + Swift; `dartPluginClass: FlutterCryptography`) | Optional performance only. It would make `packages/core` Flutter-dependent — keep it out of core. It contains **no BLAKE2s** implementation, so BLAKE2s always runs in pure Dart regardless. No C/CMake in the package itself (the `CMakeLists.txt` hits are in its `example/` app). |

### Explicit answer to the hard requirement

**No package requires a C toolchain, a build hook, or an install script.**
Verified by inspection and by build logs:

- `hook/` directory: **absent** in both packages. `build.dart`: **absent** in both packages.
- No `.c`, `.cc`, `.cpp`, `.h` or `.so` ships in either package.
- No `flutter:` / plugin section in either package's `pubspec.yaml`; no `android/` or `ios/` directory.
- `grep -rn 'DynamicLibrary.open|DynamicLibrary.process'` over both packages: **no matches**.
- `grep -inE 'native asset|hook|ndk|cmake|clang|externalNativeBuild' logs/*.log`: **no matches** in any
  debug or release build log. `flutter config` shows `enable-native-assets: (Not set)` (i.e. off).

---

## (c) Test vectors — actual vs expected

Suite: `verify_crypto_app/test/noise_primitives_test.dart` (26 tests, **129 individual vector
assertions**). References in `test/reference_vectors.dart` are generated by
`tool/gen_reference_vectors.py` from CPython `hashlib`/`hmac` (OpenSSL) and pyca/cryptography — code
sharing nothing with the Dart packages under test. Published RFC vectors are inlined in the test.

**Result: `flutter test` → 26/26 tests passed, 129/129 vector assertions PASS, 0 FAIL.
`dart test` → 26/26 tests passed, 129/129 PASS, 0 FAIL.**

Headline vectors (all PASS):

| # | Vector | Expected (hex) | Actual (hex) |
|---|---|---|---|
| 1 | BLAKE2s-256("abc") *(required check)* | `508c5e8c327c14e2e1a72ba34eeb452f37458b209ed63a294d999b4c86675982` | `508c5e8c327c14e2e1a72ba34eeb452f37458b209ed63a294d999b4c86675982` |
| 2 | BLAKE2s-256("abc") via sync `DartBlake2s` | `508c5e8c327c14e2e1a72ba34eeb452f37458b209ed63a294d999b4c86675982` | *(identical)* |
| 3 | keyed BLAKE2s (native keyed mode), key = `00..1f`, msg = `"abc"` | `a281f725754969a702f6fe36fc591b7def866e4b70173ece402fc01c064d6b65` | `a281f725754969a702f6fe36fc591b7def866e4b70173ece402fc01c064d6b65` |
| 4 | **HMAC-BLAKE2s** key `"secret"` msg `"abc"` — our own implementation, B = 64 | `38441ee1d037603eb6dbcf66742ebbbcbd8afb9606c178532e0f364bd50b4583` | `38441ee1d037603eb6dbcf66742ebbbcbd8afb9606c178532e0f364bd50b4583` |
| 5 | **HMAC-BLAKE2s** via `Hmac.blake2s()` — **WRONG** (finding F2) | `38441ee1d037603eb6dbcf66742ebbbcbd8afb9606c178532e0f364bd50b4583` | `773a1d7d24a7d4c742973ad7420fadc143e2ec52a09ffe9c279f367ab8cad85b` ← **MISMATCH** |
| 6 | RFC 7748 §6.1 Alice public key | `8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a` | `8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a` |
| 7 | RFC 7748 §6.1 Bob public key | `de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f` | `de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f` |
| 8 | RFC 7748 §6.1 shared secret (Alice→Bob and Bob→Alice) | `4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742` | `4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742` |
| 9 | RFC 7748 §5.2 vector 1 | `c3da55379de9c6908e94ea4df28d084f32eccf03491c71f754b4075577a28552` | `c3da55379de9c6908e94ea4df28d084f32eccf03491c71f754b4075577a28552` |
| 10 | RFC 7748 §5.2 vector 2 | `95cbde9476e8907d7aade45cb4b873f88b595a68799fa152e6f8f7647aac7957` | `95cbde9476e8907d7aade45cb4b873f88b595a68799fa152e6f8f7647aac7957` |
| 11 | RFC 7748 §5.2 iterated, 1 iteration | `422c8e7a6227d7bca1350b3e2bb7279f7897b87bb6854b783c60e80311ae3079` | `422c8e7a6227d7bca1350b3e2bb7279f7897b87bb6854b783c60e80311ae3079` |
| 12 | RFC 7748 §5.2 iterated, **1000** iterations | `684cf59ba83309552800ef566f2f4d3c1c3887c49360e3875f2eb94d99532c51` | `684cf59ba83309552800ef566f2f4d3c1c3887c49360e3875f2eb94d99532c51` |
| 13 | RFC 8439 §2.8.2 AEAD ciphertext | `d31a8d34…6cec64b6116` (full row below) | *(identical)* |
| 14 | RFC 8439 §2.8.2 AEAD tag | `1ae10b594f09e26a7e902ecbd0600691` | `1ae10b594f09e26a7e902ecbd0600691` |
| 15 | SHA-256("abc") | `ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad` | `ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad` |
| 16 | SHA-256("") | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |

### Per-requirement detail

**BLAKE2s-256** — verified against the required `508c5e8c…` vector (matches) *and* against OpenSSL for
input lengths `0,1,3,31,32,33,63,64,65,127,128,129,255,256,1000`, deliberately covering every 64-byte
BLAKE2s block boundary, via both the async `Blake2s()` and the synchronous `DartBlake2s`. **All PASS.**

**BLAKE2s-based HMAC.** Two independent notions were tested:
- *Native keyed BLAKE2s* (`Blake2s` used directly as a `MacAlgorithm`, `newMacSink`/`calculateMac`) —
  **matches OpenSSL's `hashlib.blake2s(key=…)` exactly.** Note this is *keyed BLAKE2s*, which is
  **not** what Noise's `HMAC-HASH` is.
- *HMAC-BLAKE2s* — `cryptography`'s `Hmac.blake2s()` **does not match**, and our own B = 64
  implementation of RFC 2104 HMAC **does match OpenSSL exactly** (see F2). The suite pins both, so a
  future package upgrade that fixes the bug fails loudly.

**HKDF.** `Hkdf` was validated against published **RFC 5869 Test Case 1** using `Hmac.sha256()`:
`3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865` — **PASS**.
Output lengths 32/42/64/100 all work. RFC 5869 with **HMAC-BLAKE2s** (RFC 5869 case-1 inputs) matches
OpenSSL via our own HMAC: PRK `57e878130679f9ea85900980b52df2643d043b82f290eb7dd62175dbb04cca4e`,
OKM-32 `1472c31f2ff768c71b19f8803683ee3b13c1a5fb3ea59c0c3bf0d44a4a40dcd4`,
OKM-42 `1472c31f…329d9cd85bbe35a1b3e7` — **PASS**.
`Hkdf(hmac: Hmac.blake2s())` produces `7077bc75410030aa2411651be1df17b17807104e095e479a33e46a60808a83b6`
instead of `1472c31f…` → **unusable for Noise** (F2).

Noise's HASHLEN=64 truncation rule: implemented and verified for **BLAKE2b** (B = 128). Noise-style
HKDF outputs truncated to 32 bytes: `fdc2492006313006a8899c5140fa804a25fc0503693c4e101474b5433fdb09a3`
and `de3fcaf3a1202362e33dde531a02f62cf4e6ef8abbafa8c8e023229806e1511c`; the untruncated 64-byte value
is `b7a440a75a0056227790c3516b2af9cbd1b70bb446974d8f4daebca5043895f5aaca4bd3c60f1252f67442d490c8094a3c3677429a1aa9bf087f7578ab08586a`.
**The API supports both rules** — you can build either variant from the primitives — and only the
truncated variant is Noise-correct. For our suite HASHLEN = 32 (BLAKE2s), so **no truncation applies**;
the HASHLEN=32 Noise-HKDF outputs `afad1a49…` / `85f6d91a…` match OpenSSL.

**X25519** — RFC 7748 §6.1 and both §5.2 single-shot vectors **PASS**, and the §5.2 **1000-iteration**
chain (`684cf59b…`) **PASSES**, which is a strong conformance signal. Low-order handling is a
**failure** — see F3.

**ChaCha20-Poly1305** — the published **RFC 8439 §2.8.2** vector matches in full (ciphertext
`d31a8d34648e60db7b86afbc53ef7ec2a4aded51296e08fea9e2b5a736ee62d63dbea45e8ca9671282fafb69da92728b1a71de0a9e060b2905d6a5b67ecd3b3692ddbd7f2d778b8c9803aee328091b58fab324e4fad675945585808b4831d7bc3ff4def08e4b7a9de576d26586cec64b6116`,
tag `1ae10b594f09e26a7e902ecbd0600691`), and is cross-checked against a **second implementation**
(pointycastle's `ChaCha20Poly1305`) plus pyca/cryptography.
The **Noise 96-bit nonce** `4 zero bytes || LE64(counter)` round-trips and matches Python for
counters `0, 1, 2, 0x0102030405060708` — e.g. counter 1 →
nonce `000000000100000000000000`, ct `34ef69e3…41c276da74`, tag `73240a9e04f95f6cea2cadd7f213d849`.
Negative tests all raise `SecretBoxAuthenticationError` as required: **tampered ciphertext**,
**tampered AAD**, **tampered MAC**, and **wrong counter/nonce**. **All PASS.**

**SHA-256** — `"abc"`, `""`, and 15 boundary lengths match OpenSSL exactly, and pointycastle's
`SHA256Digest` agrees on all of them. **All PASS.**

The complete 129-row table (every assertion, expected vs actual) is appended in
[Appendix A](#appendix-a--complete-vector-table) and machine-generated from the real test log.

---

## (d) Android build result and timing

All builds used `flutter build apk`, Android SDK `/home/bruce/Android/Sdk`, `JAVA_HOME` unset
(Flutter auto-selected Android Studio's JBR 25). `~/.gradle` and `~/.pub-cache` were **not** deleted.

| Build | Command | Wall clock | Result |
|---|---|---|---|
| Debug, *cold for this project* (after `flutter clean`, Gradle daemon stopped, **warm** `~/.gradle`) | `flutter build apk --debug` | **40 s** (Gradle task 37.7 s) | `app-debug.apk` built, exit 0 |
| Debug, first build in this project (warm caches, daemon running) | `flutter build apk --debug` | **27 s** (Gradle task 24.5 s) | OK |
| Debug, **bare app** (no crypto deps), same machine, same warm caches, cold-for-project | `flutter build apk --debug` | **34 s** (Gradle task 31.9 s) | `app-debug.apk` 150,416,656 B |
| Debug, warm incremental rebuild after a source edit | `flutter build apk --debug` | **19 s** (Gradle task 13.4 s) | OK |
| **Release (AOT)** — proves AOT compilation, not just kernel/JIT | `flutter build apk --release` | **90 s** (Gradle task 87.8 s) | `app-release.apk` **46,955,100 B (47.0 MB)** |

The debug APK is large (~166 MB as finally built) because it bundles `libflutter.so` for
`arm64-v8a` (38.8 MB), `armeabi-v7a` (33.2 MB) and `x86_64` (40.1 MB) plus a 44.7 MB Dart
`kernel_blob.bin`; the crypto packages themselves add no native artifact. The release APK splits to
47.0 MB once AOT-compiled.

**Comparison with the 443 s baseline.** The 443 s figure was the *first ever* Android build on this
machine: the captured log for it shows Flutter downloading the Android engine artifacts
(`[1/6] android-arm-profile`, `… android-arm64-release`, `… android-x64-release`, ~7.9 s) on top of the
Gradle 9.3.1 distribution and the entire AGP 9.1.0 / Kotlin 2.4.0 dependency graph. Those downloads now
live in `~/.gradle`, which is exactly why today's numbers are ~10× smaller.

So the honest apples-to-apples statement is: with all caches warm, adding
`cryptography 2.9.0 + pointycastle 4.0.0` (and actually *calling* every primitive from `lib/main.dart`
so nothing is tree-shaken away) costs **40 s vs 34 s for a bare app — about +6 s (+18 %)**, and
essentially all of that is Dart kernel compilation of the extra pure-Dart source. There is **no**
native compilation step, so the cost does not grow with new ABI targets.

The only build-time warning of any kind was the ordinary Flutter icon tree-shaking notice on the
release build (`Font asset "MaterialIcons-Regular.otf" was tree-shaken…`). **No** warning about native
assets, build hooks, NDK, CMake or clang appeared in any debug or release log.

### On-device execution (resolve → compile → **run**)

Rather than stopping at "it compiled", the harness was installed and executed on an Android 13
(API 33, `x86_64`) emulator, with results emitted to logcat via `debugPrint`
(`logs/android-ondevice-run.txt`, screenshot `logs/android-selftest.png`). Raw on-device output:

```text
VERIFY_CRYPTO_ANDROID blake2s("abc") 508c5e8c327c14e2e1a72ba34eeb452f37458b209ed63a294d999b4c86675982
VERIFY_CRYPTO_ANDROID keyed blake2s a281f725754969a702f6fe36fc591b7def866e4b70173ece402fc01c064d6b65
VERIFY_CRYPTO_ANDROID hmac-sha256 342e519ce0ad6c03a36b98eeb3f1d130db4813b9df4d1160eda488d712dc78ee
VERIFY_CRYPTO_ANDROID hkdf d58e7c1c4394984eb3ca168ff7b709d44f8db0e9f6f00a0ac1c01a2e4d0ad350
VERIFY_CRYPTO_ANDROID x25519 4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742
VERIFY_CRYPTO_ANDROID chacha ct 57981caf8dfbcfc2473140
VERIFY_CRYPTO_ANDROID chacha tag a1def7b4ee481af70c0cdcd6ec1968a5
VERIFY_CRYPTO_ANDROID sha256("abc") ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
VERIFY_CRYPTO_ANDROID sync blake2s 508c5e8c327c14e2e1a72ba34eeb452f37458b209ed63a294d999b4c86675982
VERIFY_CRYPTO_ANDROID DONE lines=9
```

Every on-device value was independently re-derived with CPython:
`hmac.new(b"k", b"abc", sha256)` = `342e519c…78ee`, HKDF-SHA256(`ikm="ikm"`, empty salt/info, 32) =
`d58e7c1c…ad350`, and the ChaCha20-Poly1305 pair = `57981caf…` / `a1def7b4…`. The on-device X25519
shared secret equals the RFC 7748 §6.1 value and the on-device BLAKE2s equals the required
`508c5e8c…` vector. No crash: `adb logcat -b crash` shows nothing for the package.

`packages/core` testability without Flutter (item 6) — `dart test` in the **plain Dart VM**, no Flutter
engine, passes **26/26 tests / 129/129 assertions** (`dart test` from the package root, whole `test/`
directory). Two notes for the real repo:

- `cryptography` and `pointycastle` both work under plain `dart test` for every primitive we need —
  no Flutter bindings are touched.
- A Flutter *app* directory cannot run `dart test` over the whole tree: `test/widget_test.dart` (which
  imports `flutter_test`) fails to load and the run reports
  `Failing tests: test/widget_test.dart: loading test/widget_test.dart`. It was removed here, after
  which `dart test` passes cleanly. **`packages/core` must contain only Flutter-free test files** (as
  this one does) for `dart test` to be usable.

---

## (e) Failures and findings (verbatim)

### F1 — `pointycastle 4.0.0` has **no BLAKE2s** at all *(invalidates the original package plan)*

The suite's package section records this; it is a static API fact:

```text
$ cd ~/.pub-cache/hosted/pub.dev/pointycastle-4.0.0
$ grep -ril 'blake2s' . | wc -l
0
$ ls lib/digests/
blake2b.dart  cshake.dart  keccak.dart  md2.dart  md4.dart  md5.dart  ripemd128.dart
ripemd160.dart  ripemd256.dart  ripemd320.dart  sha1.dart  sha224.dart  sha256.dart
sha384.dart  sha3.dart  sha512.dart  sha512t.dart  shake.dart  sm3.dart  tiger.dart
whirlpool.dart  xof_utils.dart
$ grep -rn 'Blake2' lib/src/registry/registration.dart
lib/src/registry/registration.dart:46:  registry.register(Blake2bDigest.factoryConfig);
```

Only **BLAKE2b** exists (plus keyed BLAKE2b via `Hmac`/native keyed mode). The earlier plan of
"`pointycastle` for BLAKE2s, SHA-256" is impossible: **BLAKE2s must come from `cryptography`.** This is
not a version problem — no published pointycastle version provides BLAKE2s.

### F2 — **HEADLINE (security/interop): `cryptography`'s HMAC-BLAKE2s is not RFC 2104 HMAC**

`Hmac.blake2s()` (i.e. `Hmac(Blake2s())`) is non-interoperable, and `Hkdf(hmac: Hmac.blake2s())`
inherits the defect, so **both are unusable for Noise**.

Observed (25 bytes of divergence in a 32-byte MAC; the suite's characterisation test passes because it
pins the exact wrong value so a future fix is detected):

```text
RFC 2104 HMAC-BLAKE2s, B = 64, key "secret", msg "abc"
  expected (OpenSSL hmac + hashlib.blake2s)  38441ee1d037603eb6dbcf66742ebbbcbd8afb9606c178532e0f364bd50b4583
  actual   (cryptography Hmac.blake2s())     773a1d7d24a7d4c742973ad7420fadc143e2ec52a09ffe9c279f367ab8cad85b

our own HMAC-BLAKE2s built on Blake2s primitives, B = 64
  actual                                     38441ee1d037603eb6dbcf66742ebbbcbd8afb9606c178532e0f364bd50b4583   <- matches OpenSSL

HKDF (RFC 5869 case-1 inputs) with HMAC-BLAKE2s, 32-byte output
  expected (OpenSSL)                          1472c31f2ff768c71b19f8803683ee3b13c1a5fb3ea59c0c3bf0d44a4a40dcd4
  actual   (Hkdf(hmac: Hmac.blake2s()))       7077bc75410030aa2411651be1df17b17807104e095e479a33e46a60808a83b6
```

Root cause, confirmed by reproducing it exactly in Python: `Blake2s.blockLengthInBytes` returns **32**
(the digest size) instead of the real **64**-byte BLAKE2s compression block, and `DartHmac` uses
`hashAlgorithm.blockLengthInBytes` as the ipad/opad pad length. Emulating HMAC with a 32-byte pad in
Python reproduces `773a1d7d…` byte-for-byte, and a 64-byte pad reproduces `38441ee1…`:

```text
secret  B=64: 38441ee1d037603eb6dbcf66742ebbbcbd8afb9606c178532e0f364bd50b4583
secret  B=32: 773a1d7d24a7d4c742973ad7420fadc143e2ec52a09ffe9c279f367ab8cad85b   <-- == cryptography
```

The same defect applies to BLAKE2b (`Hmac.blake2b()` pads to 64 instead of 128:
`87b33895c0d474e40289766104f4d02dfd689c0d7a16b3e9796ff8ec3d2a0db8b1fa89267d44a08abb6bd6bf1cdfd320ec41f7ae695f7105296d7bb2f8c642f8`
vs the correct `f0eda798c45c704ed9823e24491cf9fb44bfe4d3802cfae6af1e44f274b82bb683c9f0b2446eaa276cb4c06ea46afc848d27711b4609d269b1a4717577cb9552`),
but our suite uses BLAKE2s so only BLAKE2s matters in practice.

**Impact if unnoticed:** every Noise handshake hash, `MixKey`/`MixHash` and transport-key derivation
would differ from every other Noise implementation (noise-c, snow, go, Java). Handshakes would fail
against third-party peers and, worse, succeed against themselves — a silent interop trap.
**Mitigation:** implement HMAC-BLAKE2s ourselves (done and verified), never call `Hmac.blake2s()` or
`Hkdf(hmac: Hmac.blake2s())`.

### F3 — **HEADLINE (security): `X25519` does not reject low-order points / all-zero shared secrets**

`DartX25519.sharedSecretSync` computes the ladder and returns 32 bytes with **no** check on the result
(the class body contains no zero test and no small-order blacklist). All seven canonical
low-order/equivalent `u`-coordinates silently yield an all-zero shared secret:

```text
u = 0                            -> 0000000000000000000000000000000000000000000000000000000000000000   <-- ALL ZERO, silently returned
u = 1                            -> 0000000000000000000000000000000000000000000000000000000000000000   <-- ALL ZERO, silently returned
order-8 point A (e0eb7a7c…)      -> 0000000000000000000000000000000000000000000000000000000000000000   <-- ALL ZERO, silently returned
order-8 point B (5f9c95bc…)      -> 0000000000000000000000000000000000000000000000000000000000000000   <-- ALL ZERO, silently returned
p - 1 (ecff…ff7f)                -> 0000000000000000000000000000000000000000000000000000000000000000   <-- ALL ZERO, silently returned
p     (edff…ff7f)                -> 0000000000000000000000000000000000000000000000000000000000000000   <-- ALL ZERO, silently returned
p + 1 (eeff…ff7f)                -> 0000000000000000000000000000000000000000000000000000000000000000   <-- ALL ZERO, silently returned
```

No exception was thrown for any of them (`threw == 0`). For contrast, pyca/cryptography 50.0.2 raises
`ValueError: Error computing shared key.` for all seven. That the seven coordinates really are
low-order was independently confirmed with a from-scratch RFC 7748 ladder in Python (which also
reproduces the §6.1 shared secret, then yields `0^32` for each of them).

**Impact if unnoticed:** a peer/attacker can send a low-order (or non-contributory) public key and force
a known all-zero DH output, defeating the confidentiality/authentication assumptions of the handshake.
**Mitigation:** in `packages/core`, after every `sharedSecretKey`/`sharedSecretSync` call, reject an
all-zero result (and treat it as a fatal handshake error). The suite includes a passing test showing
that such a check is straightforward and that it does not misfire on a valid key.

### F4 — minor: `pointycastle` AEAD needs `doFinal()` (sharp edge, not on our path)

`ChaCha20Poly1305.process()` returns a zero-padded tail: the final partial block and the MAC only
materialise after `doFinal()`. Observed on a 77-byte plaintext: `process()` returned 77 bytes whose last
18 bytes were zero and `cipher.mac` was all zeros; `getOutputSize()` + `processBytes()` + `doFinal()`
produced the correct ciphertext and tag. We do not use pointycastle for the AEAD (`cryptography` owns
it), so this is recorded only to prevent a future mistake.

### Not a failure, but recorded

- **Nothing was left "unverified".** Every assertion in the suite is against either a published RFC
  vector or a value generated by an independent implementation (OpenSSL/pyca). The generated reference
  file is reproducible: `python3 tool/gen_reference_vectors.py > test/reference_vectors.dart`.
- `flutter pub outdated` reports `cryptography` and `pointycastle` as already at the latest resolvable
  version, so F1–F3 cannot be fixed by upgrading today.

---

## (f) Recommendation — exact pins and packages to avoid

### Pin these in `packages/core` and the mobile app

```yaml
environment:
  sdk: ^3.13.5

dependencies:
  # Pure Dart, no plugins, no build hooks, no C. Verified 2026-10-10 on Dart 3.13.5.
  cryptography: 2.9.0        # exact pin: 2.9.0 is latest; behaviour is characterised by our tests
```

Recommended practice for the security-critical surface:

- **Pin `cryptography` exactly (`2.9.0`, no caret).** Because `Hmac.blake2s()` is broken and
  `X25519` has no low-order check *in this version*, a silent minor/patch bump must not be allowed to
  change crypto behaviour unnoticed. `verify_crypto_app/test/noise_primitives_test.dart` is written as a
  set of characterisation tests plus vector tests, so promoting it into the repo turns any such change
  into a red test rather than a silent interop break.
- **Do NOT add `pointycastle` to `packages/core`'s runtime dependencies.** It contributes nothing this
  suite needs (no BLAKE2s; SHA-256 is already available and verified in `cryptography`). If you want a
  second independent implementation in tests only, add it as a **dev/CI-only** dependency
  (`pointycastle: 4.0.0`) — exactly as this spike does.
- **Do NOT add `cryptography_flutter` to `packages/core`.** It is optional, it is a platform-channel
  Flutter plugin, and it would drag Flutter into a package we want testable under plain `dart test`. It
  provides no BLAKE2s acceleration anyway. If profiling later shows ChaCha20-Poly1305 or X25519 on
  Android is too slow, add `cryptography_flutter: 2.3.4` **only to the mobile app package**, never to
  core.
- Keep `pointycastle` out of the mobile app's runtime path too — every byte of it is dead weight for
  this suite.

### Write these two things ourselves (do not delegate to the package)

1. **`noiseHmac(key, data)` — RFC 2104 HMAC-BLAKE2s with B = 64**, built on `Blake2s`/`DartBlake2s`:

   ```dart
   List<int> hmacBlake2s(List<int> key, List<int> message) {
     var k = Uint8List.fromList(key);
     if (k.length > 64) k = Uint8List.fromList(const DartBlake2s().hashSync(k).bytes);
     final ipad = Uint8List(64)..fillRange(0, 64, 0x36);
     final opad = Uint8List(64)..fillRange(0, 64, 0x5c);
     for (var i = 0; i < k.length; i++) { ipad[i] ^= k[i]; opad[i] ^= k[i]; }
     final inner = const DartBlake2s().hashSync(<int>[...ipad, ...message]);
     return const DartBlake2s().hashSync(<int>[...opad, ...inner]).bytes;
   }
   ```

   Verified byte-exact against OpenSSL for key lengths 6, 32 and 100 (including the >64-byte
   key-hashing branch) — see test group 2.

2. **Noise `HKDF(chaining_key, input_key_material, n)`** on top of that HMAC, honouring the HASHLEN=64
   rule (truncate every HMAC output to the first 32 bytes). Both the HASHLEN=32 (no truncation) and
   HASHLEN=64 (truncated) variants are implemented and verified against independent references; our
   suite uses HASHLEN=32.

3. **The X25519 all-zero guard.** After computing any DH shared secret, reject it if all 32 bytes are
   zero, and abort the handshake (`packages/core` should surface this as a fatal protocol error rather
   than a retryable one). Consider also rejecting the remote static public key if it is one of the known
   low-order coordinates, so the failure is detected before any state is mixed.

4. **The Noise AEAD nonce** `4 zero bytes || LE64(counter)` — trivially constructed and verified against
   Python and a second implementation; note `Chacha20.poly1305Aead()` correctly enforces 12-byte nonces
   and all four tamper tests raise `SecretBoxAuthenticationError`.

### What the primitive split should look like

| Noise role | Use |
|---|---|
| `HASH` | `cryptography`'s `Blake2s` (async) / `DartBlake2s` (sync) — verified correct |
| `HMAC-HASH` | **ours**, on top of `Blake2s` — **never** `Hmac.blake2s()` |
| `HKDF` | **ours**, on top of our `HMAC-HASH` — **never** `Hkdf(hmac: Hmac.blake2s())` |
| `DH` | `cryptography`'s `X25519` / `DartX25519` **plus our all-zero guard** |
| `CIPHER` | `cryptography`'s `Chacha20.poly1305Aead()` / `DartChacha20.poly1305Aead()` — verified against RFC 8439 |
| SAS | `cryptography`'s `Sha256` / `DartSha256` — verified |

Fastest path to a production-ready `packages/core`: prefer the **synchronous `Dart*` implementations**
(`DartBlake2s`, `DartSha256`, `DartX25519`, `DartChacha20.poly1305Aead()`) — they are pure Dart, need no
isolate hop, work identically under `dart test` in the plain VM and on Android (proved above by the
`sync blake2s` on-device line), and remove any temptation to reach for the broken `Hmac`/`Hkdf` wrappers.

---

## Artifacts (all inside `spikes/flutter-android/verify-crypto/`)

| Path | What it is |
|---|---|
| `verify_crypto_app/test/noise_primitives_test.dart` | **The promotable test suite** (26 tests, 129 assertions). Imports only `package:test`, `package:cryptography`, `package:cryptography/dart.dart`, `package:pointycastle` — no Flutter. |
| `verify_crypto_app/test/reference_vectors.dart` | Generated independent reference values (OpenSSL / pyca). |
| `verify_crypto_app/tool/gen_reference_vectors.py` | Reproducible generator for the above. |
| `verify_crypto_app/lib/main.dart` | Android harness that calls every primitive and logs results to logcat. |
| `verify_crypto_app/tool/probe.dart` | Raw behaviour probe used to discover F2/F3. |
| `verify_crypto_app/tool/pc_probe.dart` | Probe that exposed F4 (`process()` vs `doFinal()`). |
| `logs/flutter-test.log` | Full `flutter test` output (all 129 expected/actual rows). |
| `logs/vector_table.md` | The same 129 rows as a markdown table (Appendix A source). |
| `logs/notes.md` | Suite notes as captured in Appendix B. |
| `logs/build-apk-debug.log`, `logs/build-apk-debug-cold.log` | Debug build logs + timings. |
| `logs/build-apk-release.log` | Release (AOT) build log + timing. |
| `logs/baseline-bare-app.log` | Bare-app control build (34 s) on the same machine/caches. |
| `logs/android-ondevice-run.txt` | Raw on-device logcat output. |
| `logs/android-selftest.png` | Screenshot of the on-device self-test results. |
| `baseline_bare_app/` | The bare control app (no crypto dependencies). |

Static analysis of the frozen tree is clean: `dart analyze lib test tool` → **No issues found!**
(`lib`/`test` clean on their own; the two `tool/` probes carry an `avoid_print` ignore because they are
CLI probes.)

Re-verified after freezing: `flutter test` → **26/26 passed**; `dart test` (plain VM, whole `test/`) →
**26/26 passed**.

## Appendix A — complete vector table

Every assertion from the real `flutter test` run: **129 PASS, 0 FAIL.**

| # | Vector | Expected (hex) | Actual (hex) | Result |
|---|--------|----------------|--------------|--------|
| 1 | Blake2s().hash("abc") | `508c5e8c327c14e2e1a72ba34eeb452f37458b209ed63a294d999b4c86675982` | `508c5e8c327c14e2e1a72ba34eeb452f37458b209ed63a294d999b4c86675982` | PASS |
| 2 | DartBlake2s().hashSync("abc") | `508c5e8c327c14e2e1a72ba34eeb452f37458b209ed63a294d999b4c86675982` | `508c5e8c327c14e2e1a72ba34eeb452f37458b209ed63a294d999b4c86675982` | PASS |
| 3 | Blake2s(0 bytes) | `69217a3079908094e11121d042354a7c1f55b6482ca1a51e1b250dfd1ed0eef9` | `69217a3079908094e11121d042354a7c1f55b6482ca1a51e1b250dfd1ed0eef9` | PASS |
| 4 | DartBlake2s(0 bytes) | `69217a3079908094e11121d042354a7c1f55b6482ca1a51e1b250dfd1ed0eef9` | `69217a3079908094e11121d042354a7c1f55b6482ca1a51e1b250dfd1ed0eef9` | PASS |
| 5 | Blake2s(1 bytes) | `b480c25c1e06eea9e9c3e36754715cf0958e4d14b22a8c2a7bc34ebf75208602` | `b480c25c1e06eea9e9c3e36754715cf0958e4d14b22a8c2a7bc34ebf75208602` | PASS |
| 6 | DartBlake2s(1 bytes) | `b480c25c1e06eea9e9c3e36754715cf0958e4d14b22a8c2a7bc34ebf75208602` | `b480c25c1e06eea9e9c3e36754715cf0958e4d14b22a8c2a7bc34ebf75208602` | PASS |
| 7 | Blake2s(3 bytes) | `78aed3ef881bf9d82b78f27f6b8b585fef960b816a13fe987fedfb96fea5f0f8` | `78aed3ef881bf9d82b78f27f6b8b585fef960b816a13fe987fedfb96fea5f0f8` | PASS |
| 8 | DartBlake2s(3 bytes) | `78aed3ef881bf9d82b78f27f6b8b585fef960b816a13fe987fedfb96fea5f0f8` | `78aed3ef881bf9d82b78f27f6b8b585fef960b816a13fe987fedfb96fea5f0f8` | PASS |
| 9 | Blake2s(31 bytes) | `632fd86e9c7e23ab098037a0a07afcf80557826f665835ee99c6f3ee38998416` | `632fd86e9c7e23ab098037a0a07afcf80557826f665835ee99c6f3ee38998416` | PASS |
| 10 | DartBlake2s(31 bytes) | `632fd86e9c7e23ab098037a0a07afcf80557826f665835ee99c6f3ee38998416` | `632fd86e9c7e23ab098037a0a07afcf80557826f665835ee99c6f3ee38998416` | PASS |
| 11 | Blake2s(32 bytes) | `ff6d6151531fefb38b881ee447dee451a9715fad1e304d2558521c4bb3b68f9c` | `ff6d6151531fefb38b881ee447dee451a9715fad1e304d2558521c4bb3b68f9c` | PASS |
| 12 | DartBlake2s(32 bytes) | `ff6d6151531fefb38b881ee447dee451a9715fad1e304d2558521c4bb3b68f9c` | `ff6d6151531fefb38b881ee447dee451a9715fad1e304d2558521c4bb3b68f9c` | PASS |
| 13 | Blake2s(33 bytes) | `36e08c81ec7ddf8fdc2f2a216d32cf8de6d38e834d65e04df2b90f7468c5f2f2` | `36e08c81ec7ddf8fdc2f2a216d32cf8de6d38e834d65e04df2b90f7468c5f2f2` | PASS |
| 14 | DartBlake2s(33 bytes) | `36e08c81ec7ddf8fdc2f2a216d32cf8de6d38e834d65e04df2b90f7468c5f2f2` | `36e08c81ec7ddf8fdc2f2a216d32cf8de6d38e834d65e04df2b90f7468c5f2f2` | PASS |
| 15 | Blake2s(63 bytes) | `097f3e7144ca0dd305c5a34309dee329232e9209f1e5c95d7e40d780b3b2f9d8` | `097f3e7144ca0dd305c5a34309dee329232e9209f1e5c95d7e40d780b3b2f9d8` | PASS |
| 16 | DartBlake2s(63 bytes) | `097f3e7144ca0dd305c5a34309dee329232e9209f1e5c95d7e40d780b3b2f9d8` | `097f3e7144ca0dd305c5a34309dee329232e9209f1e5c95d7e40d780b3b2f9d8` | PASS |
| 17 | Blake2s(64 bytes) | `f02a59ea09f0833643e84d678cdf5cf0ffe524920c8354235df818c8594e2be1` | `f02a59ea09f0833643e84d678cdf5cf0ffe524920c8354235df818c8594e2be1` | PASS |
| 18 | DartBlake2s(64 bytes) | `f02a59ea09f0833643e84d678cdf5cf0ffe524920c8354235df818c8594e2be1` | `f02a59ea09f0833643e84d678cdf5cf0ffe524920c8354235df818c8594e2be1` | PASS |
| 19 | Blake2s(65 bytes) | `0ac3d13a7ed2af4933f533819602898ba90117906214882c968be7f380820b1e` | `0ac3d13a7ed2af4933f533819602898ba90117906214882c968be7f380820b1e` | PASS |
| 20 | DartBlake2s(65 bytes) | `0ac3d13a7ed2af4933f533819602898ba90117906214882c968be7f380820b1e` | `0ac3d13a7ed2af4933f533819602898ba90117906214882c968be7f380820b1e` | PASS |
| 21 | Blake2s(127 bytes) | `91b215624b77e35fc4d5bcaa8fe04c6a97a6731b540ba6e0ecd74918feafd4c6` | `91b215624b77e35fc4d5bcaa8fe04c6a97a6731b540ba6e0ecd74918feafd4c6` | PASS |
| 22 | DartBlake2s(127 bytes) | `91b215624b77e35fc4d5bcaa8fe04c6a97a6731b540ba6e0ecd74918feafd4c6` | `91b215624b77e35fc4d5bcaa8fe04c6a97a6731b540ba6e0ecd74918feafd4c6` | PASS |
| 23 | Blake2s(128 bytes) | `cdc7339cef2a93111ccfef5ae8a84bae69fce8d458a10ad486ab801c71c817fc` | `cdc7339cef2a93111ccfef5ae8a84bae69fce8d458a10ad486ab801c71c817fc` | PASS |
| 24 | DartBlake2s(128 bytes) | `cdc7339cef2a93111ccfef5ae8a84bae69fce8d458a10ad486ab801c71c817fc` | `cdc7339cef2a93111ccfef5ae8a84bae69fce8d458a10ad486ab801c71c817fc` | PASS |
| 25 | Blake2s(129 bytes) | `126d98599abde4039d55b7c81ad9e19b806cd749e3369f384fa6dfaf51088a82` | `126d98599abde4039d55b7c81ad9e19b806cd749e3369f384fa6dfaf51088a82` | PASS |
| 26 | DartBlake2s(129 bytes) | `126d98599abde4039d55b7c81ad9e19b806cd749e3369f384fa6dfaf51088a82` | `126d98599abde4039d55b7c81ad9e19b806cd749e3369f384fa6dfaf51088a82` | PASS |
| 27 | Blake2s(255 bytes) | `0088f842f11ab7ed95a5d4302bd89fe7923331863858a8034b35d946663bb5b5` | `0088f842f11ab7ed95a5d4302bd89fe7923331863858a8034b35d946663bb5b5` | PASS |
| 28 | DartBlake2s(255 bytes) | `0088f842f11ab7ed95a5d4302bd89fe7923331863858a8034b35d946663bb5b5` | `0088f842f11ab7ed95a5d4302bd89fe7923331863858a8034b35d946663bb5b5` | PASS |
| 29 | Blake2s(256 bytes) | `87a930f9d7ffeb0fb7b0cb9931eae70def91221ebcc438b1f3c3bde9ac4eeb63` | `87a930f9d7ffeb0fb7b0cb9931eae70def91221ebcc438b1f3c3bde9ac4eeb63` | PASS |
| 30 | DartBlake2s(256 bytes) | `87a930f9d7ffeb0fb7b0cb9931eae70def91221ebcc438b1f3c3bde9ac4eeb63` | `87a930f9d7ffeb0fb7b0cb9931eae70def91221ebcc438b1f3c3bde9ac4eeb63` | PASS |
| 31 | Blake2s(1000 bytes) | `250e5108aab618828bf10662138a1f156906a1e12644c370ddf79fec86ab666d` | `250e5108aab618828bf10662138a1f156906a1e12644c370ddf79fec86ab666d` | PASS |
| 32 | DartBlake2s(1000 bytes) | `250e5108aab618828bf10662138a1f156906a1e12644c370ddf79fec86ab666d` | `250e5108aab618828bf10662138a1f156906a1e12644c370ddf79fec86ab666d` | PASS |
| 33 | keyed Blake2s(0 bytes) | `48a8997da407876b3d79c0d92325ad3b89cbb754d86ab71aee047ad345fd2c49` | `48a8997da407876b3d79c0d92325ad3b89cbb754d86ab71aee047ad345fd2c49` | PASS |
| 34 | keyed Blake2s(1 bytes) | `e2c4077ce2da96db75a2f8478711a01b2a6ba71d654193eba5b6d3b9a9101aea` | `e2c4077ce2da96db75a2f8478711a01b2a6ba71d654193eba5b6d3b9a9101aea` | PASS |
| 35 | keyed Blake2s(3 bytes) | `65a5aab4dbd6cf14cedc75300b80909cbb5aaea6700f03ab1e6e921cb261e4a7` | `65a5aab4dbd6cf14cedc75300b80909cbb5aaea6700f03ab1e6e921cb261e4a7` | PASS |
| 36 | keyed Blake2s(31 bytes) | `0fa774f2a91a2eb631f917dd719d36a2aecfd830b57f9eff288a8f80a1520614` | `0fa774f2a91a2eb631f917dd719d36a2aecfd830b57f9eff288a8f80a1520614` | PASS |
| 37 | keyed Blake2s(32 bytes) | `782701e7690ce38188d5190c6d0c0eca37f8e33e0cb1af378c431dd2c5cf2b5a` | `782701e7690ce38188d5190c6d0c0eca37f8e33e0cb1af378c431dd2c5cf2b5a` | PASS |
| 38 | keyed Blake2s(33 bytes) | `67505f179bc81d22e4bc888ca237de0699b39b7eee3f36c87c461f682a4bc0a3` | `67505f179bc81d22e4bc888ca237de0699b39b7eee3f36c87c461f682a4bc0a3` | PASS |
| 39 | keyed Blake2s(63 bytes) | `66d5cf5253699255da9dcc21e9f06b5d9eb527a6fc46b3939d6de37bd18eab8f` | `66d5cf5253699255da9dcc21e9f06b5d9eb527a6fc46b3939d6de37bd18eab8f` | PASS |
| 40 | keyed Blake2s(64 bytes) | `dd1c522f01b10d46b8a8ba7a9086a83fb26317975b79286a02dcb27c8bfda415` | `dd1c522f01b10d46b8a8ba7a9086a83fb26317975b79286a02dcb27c8bfda415` | PASS |
| 41 | keyed Blake2s(65 bytes) | `27971e7f19f5f98eed39daf726b9ab24c5226b4686997a28fa902c589c33f706` | `27971e7f19f5f98eed39daf726b9ab24c5226b4686997a28fa902c589c33f706` | PASS |
| 42 | keyed Blake2s(127 bytes) | `0c9cda07070e57088f5ae1b388ff8d792b0ea1e08ad553337a12f051d161c4bc` | `0c9cda07070e57088f5ae1b388ff8d792b0ea1e08ad553337a12f051d161c4bc` | PASS |
| 43 | keyed Blake2s(128 bytes) | `06d0f85f789a3156b8a12eecaab3686d01b158d25b12b3dd1bca4678a94d8431` | `06d0f85f789a3156b8a12eecaab3686d01b158d25b12b3dd1bca4678a94d8431` | PASS |
| 44 | keyed Blake2s(129 bytes) | `5717bfa5c360fbebe8da94bccbb7427f5a4b6a62cc636f010e6f260179ff07f1` | `5717bfa5c360fbebe8da94bccbb7427f5a4b6a62cc636f010e6f260179ff07f1` | PASS |
| 45 | keyed Blake2s(255 bytes) | `0a7feb6b5e9625dff49df378db0b24440a0dfdda721b192c287fae7147ecbf66` | `0a7feb6b5e9625dff49df378db0b24440a0dfdda721b192c287fae7147ecbf66` | PASS |
| 46 | keyed Blake2s(256 bytes) | `395753fdda6403446dfaf580e86a772b236956f1a233332b7663ad9ccd5fd419` | `395753fdda6403446dfaf580e86a772b236956f1a233332b7663ad9ccd5fd419` | PASS |
| 47 | keyed Blake2s(1000 bytes) | `d647422656af100260dd36d28b0b71911c39e7c83cdf6aebd66a7feac4b5f694` | `d647422656af100260dd36d28b0b71911c39e7c83cdf6aebd66a7feac4b5f694` | PASS |
| 48 | HMAC-BLAKE2s("secret", "abc") | `38441ee1d037603eb6dbcf66742ebbbcbd8afb9606c178532e0f364bd50b4583` | `38441ee1d037603eb6dbcf66742ebbbcbd8afb9606c178532e0f364bd50b4583` | PASS |
| 49 | HMAC-BLAKE2s(key32, "abc") | `82623be5bc0a391b24dce53e67d028eff92d586de0485ac37822e597d049c74f` | `82623be5bc0a391b24dce53e67d028eff92d586de0485ac37822e597d049c74f` | PASS |
| 50 | HMAC-BLAKE2s(key100, "abc") | `c1b751501db12b753069a918627b623179be55c8cc7ca5c4e14bdf32274ac656` | `c1b751501db12b753069a918627b623179be55c8cc7ca5c4e14bdf32274ac656` | PASS |
| 51 | HMAC-BLAKE2s(key32, 0 bytes) | `e2641d24dfa8dd89e8cb77f1cdc77d8c006e5bebdfc4d6a3a3a6f8d5b7586fb0` | `e2641d24dfa8dd89e8cb77f1cdc77d8c006e5bebdfc4d6a3a3a6f8d5b7586fb0` | PASS |
| 52 | HMAC-BLAKE2s(key32, 1 bytes) | `1c1dcfc5738194d80021e4d779094a33329e331ab01df5708992d5ce82b50840` | `1c1dcfc5738194d80021e4d779094a33329e331ab01df5708992d5ce82b50840` | PASS |
| 53 | HMAC-BLAKE2s(key32, 3 bytes) | `610b96cb82cced78c0bf13a7a2156e063e8577275ec78b38aca6d97a141c2a12` | `610b96cb82cced78c0bf13a7a2156e063e8577275ec78b38aca6d97a141c2a12` | PASS |
| 54 | HMAC-BLAKE2s(key32, 31 bytes) | `754a10fa337454c8f2840fea5e1fb313d1236d28086ab74c87b5c5aa6b1100d3` | `754a10fa337454c8f2840fea5e1fb313d1236d28086ab74c87b5c5aa6b1100d3` | PASS |
| 55 | HMAC-BLAKE2s(key32, 32 bytes) | `a1ca9fd7c76b35d674b159fe84f237871cbfa63f32c2c761ef5e8d91e4820630` | `a1ca9fd7c76b35d674b159fe84f237871cbfa63f32c2c761ef5e8d91e4820630` | PASS |
| 56 | HMAC-BLAKE2s(key32, 33 bytes) | `5b3a74af7f2cf141f469e55b799edf60b384a7d42bca156153a85f7816bdd8ab` | `5b3a74af7f2cf141f469e55b799edf60b384a7d42bca156153a85f7816bdd8ab` | PASS |
| 57 | HMAC-BLAKE2s(key32, 63 bytes) | `01acda381cf06bbd2b0596b580ef5cc6f3d96d8e3ef9ac1e004f3900d25c5784` | `01acda381cf06bbd2b0596b580ef5cc6f3d96d8e3ef9ac1e004f3900d25c5784` | PASS |
| 58 | HMAC-BLAKE2s(key32, 64 bytes) | `3d8dbcd4a30e30b0355dedc73a214249bf61399fac4fdd4a0ee21c1b2dc33667` | `3d8dbcd4a30e30b0355dedc73a214249bf61399fac4fdd4a0ee21c1b2dc33667` | PASS |
| 59 | HMAC-BLAKE2s(key32, 65 bytes) | `dd0c9246d1d46dc344f6d01c41b36f028464cd604df2021e16dfde37684d7d2a` | `dd0c9246d1d46dc344f6d01c41b36f028464cd604df2021e16dfde37684d7d2a` | PASS |
| 60 | HMAC-BLAKE2s(key32, 127 bytes) | `4c3db4e835342c7434b6cd2c4e28aace87aab50cc3603be76d6441ad60d4a61d` | `4c3db4e835342c7434b6cd2c4e28aace87aab50cc3603be76d6441ad60d4a61d` | PASS |
| 61 | HMAC-BLAKE2s(key32, 128 bytes) | `3e96071981776d3df25469ea285c2b854e26d2427d62971d02f86cf77e74b5e5` | `3e96071981776d3df25469ea285c2b854e26d2427d62971d02f86cf77e74b5e5` | PASS |
| 62 | HMAC-BLAKE2s(key32, 129 bytes) | `7ec5001b1fc5b383a4e32f0e2b9de5617f5e3e617fa4dced559bce86830b63f8` | `7ec5001b1fc5b383a4e32f0e2b9de5617f5e3e617fa4dced559bce86830b63f8` | PASS |
| 63 | HMAC-BLAKE2s(key32, 255 bytes) | `e717cea053c8f1c89e97d151afc0d2af830e1bf3d86d62a9c7838de0e17ba962` | `e717cea053c8f1c89e97d151afc0d2af830e1bf3d86d62a9c7838de0e17ba962` | PASS |
| 64 | HMAC-BLAKE2s(key32, 256 bytes) | `dda77b54ad50254cb396f735d0604aa6c114c8bb23acfcb3297491227eff1fd7` | `dda77b54ad50254cb396f735d0604aa6c114c8bb23acfcb3297491227eff1fd7` | PASS |
| 65 | HMAC-BLAKE2s(key32, 1000 bytes) | `6c2695abd82e0c4b08d74f4288b40cffd7da2973f8c4e9c605c83cbe4e213c1c` | `6c2695abd82e0c4b08d74f4288b40cffd7da2973f8c4e9c605c83cbe4e213c1c` | PASS |
| 66 | Hkdf(Hmac.sha256, 42) RFC 5869 TC1 | `3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865` | `3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865` | PASS |
| 67 | Hkdf(Hmac.blake2s, 32) | `7077bc75410030aa2411651be1df17b17807104e095e479a33e46a60808a83b6` | `7077bc75410030aa2411651be1df17b17807104e095e479a33e46a60808a83b6` | PASS |
| 68 | Noise HKDF/HASHLEN=32 output1 | `afad1a49a02abfbf71cc91c5306ee5c57f8f534119886893a986719f7057a4b0` | `afad1a49a02abfbf71cc91c5306ee5c57f8f534119886893a986719f7057a4b0` | PASS |
| 69 | Noise HKDF/HASHLEN=32 output2 | `85f6d91afa3f4247a8e9de7f012df5fe8f0255fc798bff3ea5b12d32d1274140` | `85f6d91afa3f4247a8e9de7f012df5fe8f0255fc798bff3ea5b12d32d1274140` | PASS |
| 70 | Noise HKDF/HASHLEN=64 truncated output1 | `fdc2492006313006a8899c5140fa804a25fc0503693c4e101474b5433fdb09a3` | `fdc2492006313006a8899c5140fa804a25fc0503693c4e101474b5433fdb09a3` | PASS |
| 71 | Noise HKDF/HASHLEN=64 truncated output2 | `de3fcaf3a1202362e33dde531a02f62cf4e6ef8abbafa8c8e023229806e1511c` | `de3fcaf3a1202362e33dde531a02f62cf4e6ef8abbafa8c8e023229806e1511c` | PASS |
| 72 | Noise HKDF/HASHLEN=64 untruncated output1 | `b7a440a75a0056227790c3516b2af9cbd1b70bb446974d8f4daebca5043895f5aaca4bd3c60f1252f67442d490c8094a3c3677429a1aa9bf087f7578ab08586a` | `b7a440a75a0056227790c3516b2af9cbd1b70bb446974d8f4daebca5043895f5aaca4bd3c60f1252f67442d490c8094a3c3677429a1aa9bf087f7578ab08586a` | PASS |
| 73 | alice public key | `8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a` | `8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a` | PASS |
| 74 | bob public key | `de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f` | `de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f` | PASS |
| 75 | alice shared secret | `4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742` | `4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742` | PASS |
| 76 | bob shared secret | `4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742` | `4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742` | PASS |
| 77 | RFC 7748 5.2 vector 1 | `c3da55379de9c6908e94ea4df28d084f32eccf03491c71f754b4075577a28552` | `c3da55379de9c6908e94ea4df28d084f32eccf03491c71f754b4075577a28552` | PASS |
| 78 | RFC 7748 5.2 vector 2 | `95cbde9476e8907d7aade45cb4b873f88b595a68799fa152e6f8f7647aac7957` | `95cbde9476e8907d7aade45cb4b873f88b595a68799fa152e6f8f7647aac7957` | PASS |
| 79 | iterated x25519, 1 iteration | `422c8e7a6227d7bca1350b3e2bb7279f7897b87bb6854b783c60e80311ae3079` | `422c8e7a6227d7bca1350b3e2bb7279f7897b87bb6854b783c60e80311ae3079` | PASS |
| 80 | iterated x25519, 1000 iterations | `684cf59ba83309552800ef566f2f4d3c1c3887c49360e3875f2eb94d99532c51` | `684cf59ba83309552800ef566f2f4d3c1c3887c49360e3875f2eb94d99532c51` | PASS |
| 81 | RFC 8439 ciphertext | `d31a8d34648e60db7b86afbc53ef7ec2a4aded51296e08fea9e2b5a736ee62d63dbea45e8ca9671282fafb69da92728b1a71de0a9e060b2905d6a5b67ecd3b3692ddbd7f2d778b8c9803aee328091b58fab324e4fad675945585808b4831d7bc3ff4def08e4b7a9de576d26586cec64b6116` | `d31a8d34648e60db7b86afbc53ef7ec2a4aded51296e08fea9e2b5a736ee62d63dbea45e8ca9671282fafb69da92728b1a71de0a9e060b2905d6a5b67ecd3b3692ddbd7f2d778b8c9803aee328091b58fab324e4fad675945585808b4831d7bc3ff4def08e4b7a9de576d26586cec64b6116` | PASS |
| 82 | RFC 8439 tag | `1ae10b594f09e26a7e902ecbd0600691` | `1ae10b594f09e26a7e902ecbd0600691` | PASS |
| 83 | Noise counter=0 ciphertext | `fff87813397799dfec8c19a83d3fbe10417e270f127a97ffc33addbcfce5ce3862989f5b414123fb1d97e23c2b232e2becacdd81e85efec5805f1921c28fd39b2ae7540235c087ebba91ae28d6` | `fff87813397799dfec8c19a83d3fbe10417e270f127a97ffc33addbcfce5ce3862989f5b414123fb1d97e23c2b232e2becacdd81e85efec5805f1921c28fd39b2ae7540235c087ebba91ae28d6` | PASS |
| 84 | Noise counter=0 tag | `d69e2bd1f3507c6669a3cde824d7a5a0` | `d69e2bd1f3507c6669a3cde824d7a5a0` | PASS |
| 85 | Noise counter=0 nonce bytes | `000000000000000000000000` | `000000000000000000000000` | PASS |
| 86 | Noise counter=1 ciphertext | `34ef69e3c5f594916d087474c2672a5c5afd595d82402868b63bc2f9a793d3725c7afa55ddaf75cb91c34dfbbaa985680ecc6e484c98e69b0341cd5f65d8afd6075bd8aa528a2a4351c276da74` | `34ef69e3c5f594916d087474c2672a5c5afd595d82402868b63bc2f9a793d3725c7afa55ddaf75cb91c34dfbbaa985680ecc6e484c98e69b0341cd5f65d8afd6075bd8aa528a2a4351c276da74` | PASS |
| 87 | Noise counter=1 tag | `73240a9e04f95f6cea2cadd7f213d849` | `73240a9e04f95f6cea2cadd7f213d849` | PASS |
| 88 | Noise counter=1 nonce bytes | `000000000100000000000000` | `000000000100000000000000` | PASS |
| 89 | Noise counter=2 ciphertext | `0eb75dcfcb02153c65afc80c057f1222e777d01eff4abd8b12c7eaef9c23d3640142ec97aae3259b1c2e1ac5d505088bd5421bf1947a916dfaa76d943827d8074495b9ff443f36c31b47385f7d` | `0eb75dcfcb02153c65afc80c057f1222e777d01eff4abd8b12c7eaef9c23d3640142ec97aae3259b1c2e1ac5d505088bd5421bf1947a916dfaa76d943827d8074495b9ff443f36c31b47385f7d` | PASS |
| 90 | Noise counter=2 tag | `486bf1cb5c9fe9ccd7e7b2eb25f727b3` | `486bf1cb5c9fe9ccd7e7b2eb25f727b3` | PASS |
| 91 | Noise counter=2 nonce bytes | `000000000200000000000000` | `000000000200000000000000` | PASS |
| 92 | Noise counter=72623859790382856 ciphertext | `55a0a5f9386c0d840ee67c6bc9f4e79d21cd55cf85eb4340e24ccdef8c43c5f15d93ebed9c75c3e7273c46ca2248b5ef992ecdfbab5c9b5e824af480f2d1feb15581d6ba4a630eaabdccb661ea` | `55a0a5f9386c0d840ee67c6bc9f4e79d21cd55cf85eb4340e24ccdef8c43c5f15d93ebed9c75c3e7273c46ca2248b5ef992ecdfbab5c9b5e824af480f2d1feb15581d6ba4a630eaabdccb661ea` | PASS |
| 93 | Noise counter=72623859790382856 tag | `e6fdc6e1ec135d262b9678f1ab4bda15` | `e6fdc6e1ec135d262b9678f1ab4bda15` | PASS |
| 94 | Noise counter=72623859790382856 nonce bytes | `000000000807060504030201` | `000000000807060504030201` | PASS |
| 95 | pointycastle ciphertext | `34ef69e3c5f594916d087474c2672a5c5afd595d82402868b63bc2f9a793d3725c7afa55ddaf75cb91c34dfbbaa985680ecc6e484c98e69b0341cd5f65d8afd6075bd8aa528a2a4351c276da74` | `34ef69e3c5f594916d087474c2672a5c5afd595d82402868b63bc2f9a793d3725c7afa55ddaf75cb91c34dfbbaa985680ecc6e484c98e69b0341cd5f65d8afd6075bd8aa528a2a4351c276da74` | PASS |
| 96 | pointycastle tag | `73240a9e04f95f6cea2cadd7f213d849` | `73240a9e04f95f6cea2cadd7f213d849` | PASS |
| 97 | pointycastle tag vs Python reference | `73240a9e04f95f6cea2cadd7f213d849` | `73240a9e04f95f6cea2cadd7f213d849` | PASS |
| 98 | SHA-256("abc") | `ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad` | `ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad` | PASS |
| 99 | SHA-256("") | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | PASS |
| 100 | SHA-256(0 bytes) | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | PASS |
| 101 | SHA-256(1 bytes) | `e7cf46a078fed4fafd0b5e3aff144802b853f8ae459a4f0c14add3314b7cc3a6` | `e7cf46a078fed4fafd0b5e3aff144802b853f8ae459a4f0c14add3314b7cc3a6` | PASS |
| 102 | SHA-256(3 bytes) | `9bef0e5f2b6e407e1492abfcf729c30cc561f835d2c8b286f3ac14c1406a7672` | `9bef0e5f2b6e407e1492abfcf729c30cc561f835d2c8b286f3ac14c1406a7672` | PASS |
| 103 | SHA-256(31 bytes) | `a929fe91166d70cd70b2fdf38c2d626b1c7f4e6ce2a31a7313ba2966406d9135` | `a929fe91166d70cd70b2fdf38c2d626b1c7f4e6ce2a31a7313ba2966406d9135` | PASS |
| 104 | SHA-256(32 bytes) | `626c4ed5cb6893c7a708f5d84df0020fd7896a4e1c982e2e4c7ba2b09d084961` | `626c4ed5cb6893c7a708f5d84df0020fd7896a4e1c982e2e4c7ba2b09d084961` | PASS |
| 105 | SHA-256(33 bytes) | `da8ad2772558562cd5a4c0cae79a12ba3192d2fde13bf81ee6ff312953e3d0fa` | `da8ad2772558562cd5a4c0cae79a12ba3192d2fde13bf81ee6ff312953e3d0fa` | PASS |
| 106 | SHA-256(63 bytes) | `fc8329f49dc58f8564a7e1688ded65f17c92368136e07bc01e5ce2f1ea86d8e9` | `fc8329f49dc58f8564a7e1688ded65f17c92368136e07bc01e5ce2f1ea86d8e9` | PASS |
| 107 | SHA-256(64 bytes) | `2f4ffe1f17a86fea1f2d35d7b334f246d7e59b443064423329eb3a6c7ff7fbd1` | `2f4ffe1f17a86fea1f2d35d7b334f246d7e59b443064423329eb3a6c7ff7fbd1` | PASS |
| 108 | SHA-256(65 bytes) | `a1e71339bfadd6f8065fcff4c12f2c468cd31b1abf188b73bce5e0fa16f982f3` | `a1e71339bfadd6f8065fcff4c12f2c468cd31b1abf188b73bce5e0fa16f982f3` | PASS |
| 109 | SHA-256(127 bytes) | `d4bdc35cb355a74588963ea002629a2e6f81039bee56e3086916a13edb8404e6` | `d4bdc35cb355a74588963ea002629a2e6f81039bee56e3086916a13edb8404e6` | PASS |
| 110 | SHA-256(128 bytes) | `4b600b3762621ec85ab6a4a727914cfd75ecff3fcde53a7284595588e81679a0` | `4b600b3762621ec85ab6a4a727914cfd75ecff3fcde53a7284595588e81679a0` | PASS |
| 111 | SHA-256(129 bytes) | `112ba1c81ae3f5d41c9aa72f31ec91cf95101050bbe5df04f37a41b5deb61416` | `112ba1c81ae3f5d41c9aa72f31ec91cf95101050bbe5df04f37a41b5deb61416` | PASS |
| 112 | SHA-256(255 bytes) | `03b3c3abfad2ebe34473bca856964b696ad32e65f8ba0c02079d474057b68f38` | `03b3c3abfad2ebe34473bca856964b696ad32e65f8ba0c02079d474057b68f38` | PASS |
| 113 | SHA-256(256 bytes) | `960c6ebb735df2ca9f35e74e95630499339444947fc0600da806f3c63217f572` | `960c6ebb735df2ca9f35e74e95630499339444947fc0600da806f3c63217f572` | PASS |
| 114 | SHA-256(1000 bytes) | `b5fbc3835f00e2b6501fbcafc8a7fd5d0333b3dab2541a19e2bab10e6377e9d6` | `b5fbc3835f00e2b6501fbcafc8a7fd5d0333b3dab2541a19e2bab10e6377e9d6` | PASS |
| 115 | pointycastle SHA-256(0 bytes) | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | PASS |
| 116 | pointycastle SHA-256(1 bytes) | `e7cf46a078fed4fafd0b5e3aff144802b853f8ae459a4f0c14add3314b7cc3a6` | `e7cf46a078fed4fafd0b5e3aff144802b853f8ae459a4f0c14add3314b7cc3a6` | PASS |
| 117 | pointycastle SHA-256(3 bytes) | `9bef0e5f2b6e407e1492abfcf729c30cc561f835d2c8b286f3ac14c1406a7672` | `9bef0e5f2b6e407e1492abfcf729c30cc561f835d2c8b286f3ac14c1406a7672` | PASS |
| 118 | pointycastle SHA-256(31 bytes) | `a929fe91166d70cd70b2fdf38c2d626b1c7f4e6ce2a31a7313ba2966406d9135` | `a929fe91166d70cd70b2fdf38c2d626b1c7f4e6ce2a31a7313ba2966406d9135` | PASS |
| 119 | pointycastle SHA-256(32 bytes) | `626c4ed5cb6893c7a708f5d84df0020fd7896a4e1c982e2e4c7ba2b09d084961` | `626c4ed5cb6893c7a708f5d84df0020fd7896a4e1c982e2e4c7ba2b09d084961` | PASS |
| 120 | pointycastle SHA-256(33 bytes) | `da8ad2772558562cd5a4c0cae79a12ba3192d2fde13bf81ee6ff312953e3d0fa` | `da8ad2772558562cd5a4c0cae79a12ba3192d2fde13bf81ee6ff312953e3d0fa` | PASS |
| 121 | pointycastle SHA-256(63 bytes) | `fc8329f49dc58f8564a7e1688ded65f17c92368136e07bc01e5ce2f1ea86d8e9` | `fc8329f49dc58f8564a7e1688ded65f17c92368136e07bc01e5ce2f1ea86d8e9` | PASS |
| 122 | pointycastle SHA-256(64 bytes) | `2f4ffe1f17a86fea1f2d35d7b334f246d7e59b443064423329eb3a6c7ff7fbd1` | `2f4ffe1f17a86fea1f2d35d7b334f246d7e59b443064423329eb3a6c7ff7fbd1` | PASS |
| 123 | pointycastle SHA-256(65 bytes) | `a1e71339bfadd6f8065fcff4c12f2c468cd31b1abf188b73bce5e0fa16f982f3` | `a1e71339bfadd6f8065fcff4c12f2c468cd31b1abf188b73bce5e0fa16f982f3` | PASS |
| 124 | pointycastle SHA-256(127 bytes) | `d4bdc35cb355a74588963ea002629a2e6f81039bee56e3086916a13edb8404e6` | `d4bdc35cb355a74588963ea002629a2e6f81039bee56e3086916a13edb8404e6` | PASS |
| 125 | pointycastle SHA-256(128 bytes) | `4b600b3762621ec85ab6a4a727914cfd75ecff3fcde53a7284595588e81679a0` | `4b600b3762621ec85ab6a4a727914cfd75ecff3fcde53a7284595588e81679a0` | PASS |
| 126 | pointycastle SHA-256(129 bytes) | `112ba1c81ae3f5d41c9aa72f31ec91cf95101050bbe5df04f37a41b5deb61416` | `112ba1c81ae3f5d41c9aa72f31ec91cf95101050bbe5df04f37a41b5deb61416` | PASS |
| 127 | pointycastle SHA-256(255 bytes) | `03b3c3abfad2ebe34473bca856964b696ad32e65f8ba0c02079d474057b68f38` | `03b3c3abfad2ebe34473bca856964b696ad32e65f8ba0c02079d474057b68f38` | PASS |
| 128 | pointycastle SHA-256(256 bytes) | `960c6ebb735df2ca9f35e74e95630499339444947fc0600da806f3c63217f572` | `960c6ebb735df2ca9f35e74e95630499339444947fc0600da806f3c63217f572` | PASS |
| 129 | pointycastle SHA-256(1000 bytes) | `b5fbc3835f00e2b6501fbcafc8a7fd5d0333b3dab2541a19e2bab10e6377e9d6` | `b5fbc3835f00e2b6501fbcafc8a7fd5d0333b3dab2541a19e2bab10e6377e9d6` | PASS |

---

## Appendix B — notes and characterisations emitted by the suite

### Hmac.blake2s() is non-standard

RFC 2104 HMAC-BLAKE2s (B=64, OpenSSL/interop) = 38441ee1d037603eb6dbcf66742ebbbcbd8afb9606c178532e0f364bd50b4583
package:cryptography Hmac.blake2s()        = 773a1d7d24a7d4c742973ad7420fadc143e2ec52a09ffe9c279f367ab8cad85b
=> cryptography pads the key to 32 bytes (Blake2s.blockLengthInBytes
== 32, i.e. the DIGEST length) instead of the real 64-byte BLAKE2s
compression block. Non-interoperable with every other Noise stack.

### Hmac.blake2b() is non-standard

RFC 2104 HMAC-BLAKE2b (B=128)        = f0eda798c45c704ed9823e24491cf9fb44bfe4d3802cfae6af1e44f274b82bb683c9f0b2446eaa276cb4c06ea46afc848d27711b4609d269b1a4717577cb9552
package:cryptography Hmac.blake2b() = 87b33895c0d474e40289766104f4d02dfd689c0d7a16b3e9796ff8ec3d2a0db8b1fa89267d44a08abb6bd6bf1cdfd320ec41f7ae695f7105296d7bb2f8c642f8

### Hkdf(Hmac.blake2s) unusable for Noise

expected (RFC 2104 HMAC-BLAKE2s) 1472c31f2ff768c71b19f8803683ee3b13c1a5fb3ea59c0c3bf0d44a4a40dcd4
actual   (cryptography B=32)    7077bc75410030aa2411651be1df17b17807104e095e479a33e46a60808a83b6

### HASHLEN=64 supported

Blake2b primitives allow both the untruncated 64-byte output and the
Noise 32-byte-truncated variant; only truncation is Noise-correct.

### X25519 has no low-order point check

libsodium/pyca reject these 7 u-coordinates outright; cryptography 2.9.0
returns the all-zero shared secret with no error:

```
  u = 0              -> 0000000000000000000000000000000000000000000000000000000000000000   <-- ALL ZERO, silently returned
  u = 1              -> 0000000000000000000000000000000000000000000000000000000000000000   <-- ALL ZERO, silently returned
  order-8 point A    -> 0000000000000000000000000000000000000000000000000000000000000000   <-- ALL ZERO, silently returned
  order-8 point B    -> 0000000000000000000000000000000000000000000000000000000000000000   <-- ALL ZERO, silently returned
  p - 1              -> 0000000000000000000000000000000000000000000000000000000000000000   <-- ALL ZERO, silently returned
  p (== 0 mod p)     -> 0000000000000000000000000000000000000000000000000000000000000000   <-- ALL ZERO, silently returned
  p + 1 (== 1 mod p) -> 0000000000000000000000000000000000000000000000000000000000000000   <-- ALL ZERO, silently returned
```

(The exact coordinate hex values are in the test's `_lowOrderPoints` map and in finding F3 above.)

### Mitigation is mandatory

Noise_XX must call sharedSecretKey() and then reject an all-zero
result (and reject a non-contributory remote static key) itself.

### pointycastle AEAD API caveat

ChaCha20Poly1305.process() returns a zero-padded tail; the final partial
block and the MAC only materialise after doFinal(). Not on our path
(cryptography owns the AEAD) but a sharp edge to know about.

### pointycastle 4.0.0 ships BLAKE2b only

lib/digests/ contains blake2b.dart and no blake2s.dart; the registry
registers only Blake2bDigest. Blake2s must come from cryptography.

