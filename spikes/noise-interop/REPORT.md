# Noise_XX_25519_ChaChaPoly_BLAKE2s — Node ↔ Dart interoperability spike

**Spike directory:** `spikes/noise-interop/` (nothing outside it was touched)
**Date:** 2026-10-10
**Environment:** Node v22.23.3 / npm 12.2.0 / pnpm 11.28.5; Flutter 3.47.7 stable, **Dart 3.13.5**; Linux x86-64.

---

## (a) Verdict

| Question | Answer |
| --- | --- |
| **INTEROP ACHIEVED: byte-identical handshakes on both sides?** | **YES** |
| Same across a live TCP connection, both role assignments? | **YES** (3/3 driver combos pass) |
| Achieved with an off-the-shelf library pair? | **NO** — see below |
| Compiled toolchain / native build step required? | **NO** on either side |

**The critical finding: no library on either side implements `Noise_XX_25519_ChaChaPoly_BLAKE2s`.**

Every candidate was checked, not assumed:

| Candidate | Version | Why it cannot do this suite |
| --- | --- | --- |
| `noise-handshake` (Holepunch) | 4.2.0 | Hardcodes **BLAKE2b**. `hkdf.js` sets `HASHLEN = 64`; `hmac.js` is HMAC-BLAKE2b (BLOCKLEN 128, `crypto_generichash`); `symmetric-state.js` digests via `crypto_generichash`; `noise.js` builds the protocol name with a literal `'BLAKE2b'`. There is **no BLAKE2s primitive in libsodium at all** (`crypto_generichash*` is BLAKE2b only — 313 exported symbols checked, zero blake2s). Its XX pattern driver itself is correct. |
| `noise-protocol` | 3.0.2 | Depends on `hmac-blake2b`; same BLAKE2b-only problem. |
| `@chainsafe/libp2p-noise` | 17.0.0 | Hardcodes `Noise_XX_25519_ChaChaPoly_SHA256` and is coupled to libp2p interfaces, so it cannot be used as a generic XX state machine. |
| `noise_protocol_framework` (Dart) | 1.2.0 | **No XX at all** — only `NKpsk0` and `KNpsk0` handshake states ship (`lib/protocols/{nkpsk0,knpsk0}/`). `KeyDerivation.deriveKey` hardcodes **HKDF-HMAC-SHA256**, which is wrong for any BLAKE2s suite. Its `CipherState.empty()` allocates a 32-zero-byte key so `hasKey` is `true` before any `MixKey` — a spec violation that would make XX message 1 encrypt its payload with an all-zero key. Flutter-free but unusable. |
| `noise_protocol` (Dart) | 0.1.1 | Dead: SDK constraint `>=2.5.0 <3.0.0` excludes Dart 3. |
| `pointycastle` (Dart) | 4.0.0 | **No BLAKE2s** (only `blake2b.dart`), and its `ChaCha20Poly1305` AEAD is unusable here: `process()` on a 114-byte plaintext returns 114 bytes whose last 58 bytes are zero, `cipher.mac` stays all-zero, and it neither appends nor consumes the Poly1305 tag. Only correct for ≤1 block via the incremental `processBytes`/`doFinal` path. |
| `noise-c.wasm` | 0.4.0 | Would work in principle but needs an Emscripten/WASM runtime and a bespoke JS API; not needed once the pure implementations proved out. |

**What was actually done:** the XX pattern driver was written from the spec on both sides (~230 lines of JS, ~330 lines of Dart), on top of vetted primitives. It is not hand-rolled crypto — BLAKE2s, HMAC, X25519, ChaCha20-Poly1305 all come from audited, widely-used libraries; only the *pattern state machine, HKDF composition, prologue and SAS binding* are ours, and those are pinned by byte-for-byte vectors.

That claim is backed by three independent anchors:

1. **The Node driver is byte-identical to a third-party implementation.** Driven with the BLAKE2b cipher set (which `noise-handshake@4.2.0` does natively) and fixed ephemerals, our driver reproduces `noise-handshake`'s messages 1/2/3, handshake hash, split transport keys and transport ciphertexts **byte for byte** (all 26 checks in that script pass). The driver, token ordering, DH ordering, HKDF shape, AEAD nonce encoding and `Split()` are hash-agnostic; only `HASHLEN`/`BLOCKLEN`/the hash function change between the BLAKE2b and BLAKE2s runs.
2. **Every primitive is cross-checked against an independent implementation** (`@noble` vs libsodium for X25519 keygen/DH, BLAKE2b-512, HMAC and HKDF; `@noble` ChaCha20-Poly1305 vs libsodium for the exact Noise nonce encoding).
3. **Both implementations emit/consume one deterministic vector file** (94 Dart-side assertions, all passing) and complete real handshakes over TCP.

---

## (b) Libraries and versions chosen

### Node (production side)

| Package | Version | Role |
| --- | --- | --- |
| `@noble/hashes` | **2.4.0** | BLAKE2s (hash + HMAC), SHA-256 (SAS) |
| `@noble/curves` | **2.4.0** | X25519 keygen + DH |
| `@noble/ciphers` | **2.4.0** | ChaCha20-Poly1305 (IETF, 96-bit nonce) |
| `src/noise-xx.js` (ours) | — | XX pattern, HKDF, CipherState/SymmetricState, SAS, prologue |

All three are pure JavaScript (ESM-only in v2), **zero install scripts**, **no compiler**, no native addon, no `node-gyp`. Total installed tree is 3 packages plus `@noble/hashes` as a transitive dep of `@noble/curves`.

Rejected for Node: `noise-handshake@4.2.0`, `noise-protocol@3.0.2`, `@chainsafe/libp2p-noise@17.0.0` (reasons above).

> **Correction to the prior finding.** `noise-curve-ed` is **not** what we want even if we switched to BLAKE2b: its `ALG = 'Ed25519'` (it uses `crypto_scalarmult_ed25519_*`), so passing it would silently produce `Noise_XX_Ed25519_ChaChaPoly_BLAKE2b`. `noise-handshake`'s **default** curve (`noise-handshake/dh`, `ALG = '25519'`, `crypto_scalarmult`) is already the X25519 curve we want. Both packages are kept as `devDependencies` only, as the validation oracle.

### Dart (production side)

| Package | Version | Role |
| --- | --- | --- |
| `cryptography` | **2.9.0** | `DartX25519` (RFC 7748) and `DartBlake2s` (hash); `DartChacha20.poly1305Aead()` sync AEAD |
| `crypto` | **3.0.7** | `sha256` for the SAS |
| `lib/noise_xx_blake2s.dart` (ours) | — | XX pattern, HMAC-BLAKE2s, HKDF, state classes, SAS, prologue |

All pure Dart, no FFI, no native toolchain, no platform channels.

Other resolved versions (declared but **not used for the handshake**): `noise_protocol_framework` **1.2.0**, and its transitive `pointycastle` 4.0.0, `elliptic` 0.3.12, `convert` 3.1.2, plus `cryptography` 2.9.0 / `crypto` 3.0.7. `noise_protocol_framework` is declared in `pubspec.yaml` only so the report can state a resolved version; the reason it is rejected is in section (a). **Remove it before promoting this code.**

### Two library bugs found that affect anyone building this later

1. **`cryptography` 2.9.0: `Blake2s.blockLengthInBytes` returns 32, but the real BLAKE2s block size is 64.**
   Noise's HKDF is HMAC-based, so `Hmac(Blake2s())` from that package produces **wrong tags**. Our implementation therefore implements HMAC-BLAKE2s itself (~15 lines) over the package's plain (unkeyed) BLAKE2s hash, with `BLOCKLEN = 64`. This is verified because the resulting HKDF chain reproduces Node's `@noble` output byte-for-byte at all 12 trace steps and yields identical transport keys.
2. **`pointycastle` 4.0.0's `ChaCha20Poly1305.process()` is unusable for messages larger than one block** (observed: 114-byte plaintext → 114-byte output whose last 58 bytes are zero, MAC all zeros, tag neither appended nor verified). We use `cryptography`'s `DartChacha20.poly1305Aead()` sync API instead, validated against RFC 8439 §2.8.2.

### `sodium-native` native path — does it work, and how?

Answering the question directly, because it matters for approval-gated builds:

* **Yes, the native path works, and no install script ran and no compiler was needed.**
* `sodium-native@5.1.0` has **no `install`/`preinstall`/`postinstall` script** (`scripts` contains only `test`/`test:node`/`test:bare`); `sodium-universal@5.0.1` only has `prepublish`. Nothing was reported as an ignored/pending build by npm or pnpm in any layout.
* **The prebuilt binary it loaded** (confirmed via `process.report.getReport().sharedObjects`):
  `node_modules/sodium-native/prebuilds/linux-x64/sodium-native.node` (**919,464 bytes**; the sibling `sodium-native.bare` is 1,067,064 bytes). The tarball ships 10 platforms × (`.node` + `.bare`), 18,251,221 bytes unpacked.
* **Layouts tested — all three load the native binding and complete an XX handshake:**
  * npm flat → `node_modules/sodium-native/prebuilds/linux-x64/sodium-native.node`
  * pnpm default (isolated) → `node_modules/.pnpm/sodium-native@5.1.0_.../node_modules/sodium-native/prebuilds/linux-x64/sodium-native.node`
  * pnpm `nodeLinker: hoisted` → the same `.node` file
  Reproduce: `scripts/test-sodium-native.sh` → full output in `results/sodium-native-layouts.txt`.
* **But it cannot help us:** `sodium-native` exposes **no BLAKE2s** (`hasBlake2s: false`, 313 exported symbols). With the default curve it makes `noise-handshake` speak `Noise_XX_25519_ChaChaPoly_BLAKE2b`.
* The extra dependency weight of `sodium-native` is real: `require-addon` → `bare-addon-resolve` → `bare-module-resolve`/`bare-semver` plus `bare-*` and `streamx` — 18 packages and ~18 MB of prebuilds, versus 3 packages with `@noble`. If we ever adopt BLAKE2b, that trade is worth it (see performance).

---

## (c) Reproduce on this machine

One command runs everything (install → self-tests → validation → vectors → Dart byte-for-byte verification → live TCP interop → sodium layout probe):

```bash
cd /home/bruce/Projects/dsh-remote-everywhere/spikes/noise-interop
./scripts/run-all.sh
```

Individual steps:

```bash
export PATH="/home/bruce/Android/flutter/bin:$PATH"          # Dart 3.13.5
SPIKE=/home/bruce/Projects/dsh-remote-everywhere/spikes/noise-interop

# 1. install (no build scripts, no compiler)
cd $SPIKE/node && npm install --no-audit --no-fund
cd $SPIKE/dart && dart pub get

# 2. self-tests + perf
cd $SPIKE/node && node src/selftest.js
cd $SPIKE/dart && dart run bin/selftest.dart
cd $SPIKE/dart && mkdir -p build && dart compile exe bin/selftest.dart -o build/selftest_aot && ./build/selftest_aot

# 3. our XX driver vs the third-party noise-handshake (BLAKE2b oracle)
cd $SPIKE/node && node src/validate-vs-noise-handshake.js

# 4. emit vectors, then verify them from Dart byte-for-byte
cd $SPIKE/node && node src/emit-vectors.js
cd $SPIKE/dart && dart run bin/verify_vectors.dart

# 5. live Node <-> Dart handshake over TCP (both roles + negative run)
$SPIKE/scripts/run-interop.sh

# 6. sodium-native layout probe (npm flat / pnpm isolated / pnpm hoisted)
$SPIKE/scripts/test-sodium-native.sh
```

Manual live interop, if you want to watch it:

```bash
# terminal 1 (Node responder)
cd $SPIKE/node && node src/tcp-interop.js server 45999 --sid demo
# terminal 2 (Dart initiator)
cd $SPIKE/dart && dart run bin/tcp_interop.dart client 45999 --initiator --sid demo --verbose
```

Add `--initiator` to the Node side and drop it from the Dart side to swap roles.

---

## (d) Test-vector file

**Path:** `spikes/noise-interop/vectors/xx25519-chachapoly-blake2s.json` (~43 KB, produced by `node/src/emit-vectors.js`).

Ephemeral keys **can** be fixed on both sides (our state machines accept a caller-supplied ephemeral secret), so the vector file is deterministic — it is the stronger artifact, not just a live-comparison log.

Contents:

| Field | Meaning |
| --- | --- |
| `suite`, `protocolName`, `hash`, `hashLen`, `blockLen`, `cipher`, `dh`, `hkdf`, `prologueRule`, `sasRule` | The exact parameterisation being pinned |
| `applicationBindings.initiatorStatic` / `.responderStatic` | X25519 secret + public key (hex) for both devices |
| `sessions.A/B/C/D.sid`, `.prologue`, `.initiatorEphemeral`, `.responderEphemeral`, `.payloads` | Deterministic inputs, including the fixed ephemeral secret + public keys |
| `sessions.*.messages.msg1/msg2/msg3` | **Every handshake message, hex** (32 / 118 / 86 bytes for A) |
| `sessions.*.traceInitiator` / `.traceResponder` | 12 entries each: `h`, `ck` and cipher key `k` after **every** mix step, so a divergence pinpoints the exact token |
| `sessions.*.handshakeHash`, `.chainingKey` | Final handshake hash and chaining key |
| `sessions.*.transportKeys.initiatorToResponder` / `.responderToInitiator` | The two split transport keys |
| `sessions.*.transport.initiatorToResponder[]` / `.responderToInitiator[]` | 2 messages per direction with `nonce`, `plaintext`, `ciphertext` hex — the transport phase byte-for-byte |
| `sessions.*.sas` | The 6-digit SAS |
| `negativeVectors.tamperedTransportCiphertext` | Original + tampered ciphertext and the modified byte index |

Session roles: **A** canonical; **B** same statics, fresh ephemerals and different sid (replay); **C** same statics *and* same ephemerals as A but the sid differs by one byte (prologue binding); **D** byte-identical replay of A (proves the SAS is a pure function of the transcript).

Dart verification: `dart run bin/verify_vectors.dart` → **`ALL 94 CHECKS PASSED`**, covering every message byte, the full trace, both transport keys, the handshake hash, the chaining key, the SAS, all four sessions, and the negative vectors. It also runs independent KATs first (BLAKE2s‑256("abc") = `508c5e8c…7582`; X25519 RFC 7748 §6.1 Alice/Bob keys and shared secret; ChaCha20‑Poly1305 RFC 8439 §2.8.2), so a broken primitive cannot hide behind a matching vector.

Live-comparison results (both role assignments, loopback TCP):

| Combo | Node role | Dart role | Handshake hash | SAS | Result |
| --- | --- | --- | --- | --- | --- |
| A | responder | initiator | `ae71ccbf…1aa3`\* | `592259`\* | PASS |
| B | initiator | responder | `74966d74…1e90`\* | `956030`\* | PASS |
| C | initiator (sid C1) | responder (sid C2) | — | — | PASS (both fail) |

\* hashes/SAS from the recorded run; every run uses fresh ephemerals so the values change — what is asserted is that **both sides agree** and that each side independently confirms the peer's value.

---

## (e) Negative-test results

| Test | Where | Result |
| --- | --- | --- |
| Tampered transport ciphertext (bit flip at byte 3) | Node selftest, Dart selftest, vector file | **Rejected** (`invalid tag` / `SecretBoxAuthenticationError`) |
| Flipped Poly1305 tag bit | Node + Dart selftest | **Rejected** |
| Tampered handshake msg2 (byte 40, inside the encrypted static key) | Node + Dart selftest, vector file, live | **Rejected** by the initiator |
| **Live over-the-wire tamper**: corrupted copy of the next ciphertext is put on the wire first, then the untouched ciphertext | `run-interop.sh` combos A and B | Responder **rejected** the corrupted copy (`tamperRejected: true`) and then **successfully decrypted** the genuine message — the failed AEAD open did **not** advance the receive nonce, and the sender/receiver nonces stayed aligned |
| **Replay / freshness**: same QR session id, fresh ephemerals | Node + Dart selftest, sessions A vs B | Handshake hash **differs**, SAS **differs** (e.g. `317884` vs `233667`; vectors: `713328` vs `872258`) |
| Replay of a captured `msg1` into a fresh responder | Node selftest | The replayed `msg1` is accepted (it is unauthenticated at that point, by design) but the fresh responder's `msg2` cannot be read by a different initiator — no session is established |
| Byte-identical replay (same ephemerals **and** same prologue, sessions A vs D) | Vector file + Dart test | Identical SAS (`713328`) — confirms the SAS is a pure function of the transcript, which is exactly why ephemerals must be fresh every pairing |
| **Mismatched prologue**: initiator `sid-AAA`, responder `sid-BBB` | Node + Dart selftest | Initiator rejects `msg2` with an AEAD failure; responder never completes; **no session on either side** |
| Mismatched prologue, **live over TCP** (combo C, sid `…C1` vs `…C2`) | `run-interop.sh` | Node: `invalid tag`; Dart: `peer closed the connection`; both report `ok: false` |
| One-byte prologue change with everything else identical (sessions A vs C) | Vectors + Dart test | Handshake hash and SAS both change (`713328` → `378289`) |

Note on the tamper probe design: an AEAD failure must **not** advance the receiver nonce (it does not, on either side), so a sender cannot simply *skip* a message — the sender and receiver would desynchronise. The probe therefore sends a corrupted copy of the next ciphertext and then that same ciphertext untouched, which is the only construction that demonstrates nonce non-advance without corrupting the session.

---

## (f) SAS derivation — stated precisely enough to reimplement

```text
handshake_hash         = the Noise handshake hash h after the final handshake message
                         (32 bytes for BLAKE2s; identical on both sides)
initiator_static_pub   = the initiator's X25519 static public key (32 raw bytes, no prefix)
responder_static_pub   = the responder's X25519 static public key (32 raw bytes, no prefix)

digest = SHA-256( handshake_hash || initiator_static_pub || responder_static_pub )   # 32 bytes
v      = big-endian unsigned integer of digest[0..8]                                  # first 8 bytes
n      = v mod 1_000_000
SAS    = decimal(n) left-padded with '0' to exactly 6 characters
```

* Concatenation, not hashing of a structured encoding. Order is initiator-static then responder-static.
* 8 bytes are used (not 4) so the modulo bias is ~2⁻⁶⁴ instead of ~0.02 %.
* Worked example from session A of the vector file:
  `handshake_hash = a010547e3db0b068b23db6813dbf3f0dd7c4c47c3584fa4fc4128db08c598a19`, SAS = **`713328`**.
* Node: `deriveSas()` in `node/src/noise-xx.js`. Dart: `deriveSas()` in `dart/lib/noise_xx_blake2s.dart`.
* Note that the SAS is a *displayed* value for the human to compare; it is not a key. It binds the full handshake transcript, so a MITM cannot make both sides show the same 6 digits without breaking the handshake (probability 10⁻⁶ per attempt if it completes at all).

Protocol parameters, for completeness:

```text
protocol_name = "Noise_XX_25519_ChaChaPoly_BLAKE2s"   (32 bytes == HASHLEN, so
                                                       h = protocol_name with no padding)
prologue      = utf8("dsh-remote/v1/pair:" + sid)
initialize    : h = protocol_name ; ck = h ; k = empty ; n = 0 ; MixHash(prologue)
HKDF          : temp_key = HMAC-BLAKE2s(ck, ikm)
                out[i]   = HMAC-BLAKE2s(temp_key, out[i-1] || byte(i))
MixKey        : ck, temp_k = HKDF(ck, ikm, 2) ; k = temp_k[0..32] ; n = 0
MixHash       : h = BLAKE2s(h || data)
EncryptAndHash: ct = (k empty) ? pt : ChaCha20Poly1305(k, n, ad=h, pt) ; n++ ; MixHash(ct)
nonce         : 12 bytes = 00 00 00 00 || LE64(n)      (the 8-byte Noise counter, zero-padded)
DH tokens     : ee = DH(e_i, e_r) ; es = DH(e_i, s_r) ; se = DH(s_i, e_r)
Split         : k1, k2 = HKDF(ck, "", 2) ; initiator sends with k1, receives with k2
```

---

## (g) Performance

Steady-state, warmed up, in-process (this machine, Linux x86-64, one core):

| Measurement | Node (`@noble`, pure JS) | Dart JIT (`dart run`) | Dart AOT (`dart compile exe`) |
| --- | --- | --- | --- |
| Full XX handshake, **both** sides (3 messages, 6 X25519 ops) | **10.4 ms** | 9.6–10.5 ms | **6.8–7.6 ms** |
| Per party | 5.2 ms | 4.8–5.3 ms | 3.4–3.8 ms |
| Transport encrypt+decrypt, 32 KiB messages | **47–51 MiB/s** round-trip (94–102 MiB/s processed) | 10.1–10.2 MiB/s | 8.3–9.6 MiB/s |

The handshake is dominated entirely by X25519:

| Primitive | `@noble` (pure JS) | libsodium (`sodium-native`, native) |
| --- | --- | --- |
| X25519 DH | 2416 µs | **68.8 µs** (35× faster) |
| X25519 base-point multiply | 765 µs | **28.2 µs** |
| Hash | BLAKE2s 64 B: 21.2 µs | BLAKE2b-512: **0.71 µs** (not comparable, different function) |

Ranges are across the repeated runs recorded in `results/` and `/tmp/run-all.log`; run-to-run spread is roughly ±30 % on this machine. Live loopback-TCP handshake wall-clock, first connection after process start (includes Dart JIT warm-up for the first crypto calls): **43–67 ms**. This is a cold-start figure; the steady-state per-party cost above is the number that matters for planning.

Interpretation:
* **Handshake cost is irrelevant for our use case.** Pairing happens once per device; 3.4–5.3 ms of CPU per party is nothing, and even the cold-start ~60 ms is invisible next to a QR scan.
* **Transport throughput is the real question.** Node's 47–51 MiB/s is fine. Dart's 8–10 MiB/s is the weak spot: for screen streaming this is roughly 64–80 Mbit/s of *ciphertext*, and it is pure-Dart CPU on a phone, so it will cost battery. Mitigations, in order of effort: (i) set `Cryptography.instance = FlutterCryptography()` by adding `cryptography_flutter` (**2.3.4**, depends on `cryptography ^2.8.1`, so it drops in — it routes ChaCha20-Poly1305 and X25519 to Android/iOS native code); (ii) chunk/parallelise; (iii) if throughput is still short, revisit the suite choice. This was **not** measured on device, so treat the mitigation as unverified.
* If handshake latency ever mattered, the native path is 35× faster per X25519 — but it costs 18 MB of prebuilds and the `bare-*` dependency chain, and it cannot give us BLAKE2s.

---

## (h) Recommendation

**Adopt the pure-Dart `@noble`-style pair, not an existing Noise library.** There is no library pair to adopt for this suite; the choice is which primitives to build the ~250–330 line state machine on.

| Side | Adopt | Pin exactly |
| --- | --- | --- |
| Node | `@noble/hashes`, `@noble/curves`, `@noble/ciphers` + our `noise-xx.js` | `@noble/hashes@2.4.0`, `@noble/curves@2.4.0`, `@noble/ciphers@2.4.0` (exact, not `^`), committed `package-lock.json` |
| Dart | `cryptography` + `crypto` + our `noise_xx_blake2s.dart` | `cryptography: 2.9.0`, `crypto: 3.0.7` (exact, not `^`), committed `pubspec.lock` |

Concrete actions before promoting this code into the plugin:

1. **Vendor or own the XX state machine** (`node/src/noise-xx.js`, `dart/lib/noise_xx_blake2s.dart`). Keep `validate-vs-noise-handshake.js` in CI: it is the regression test that proves our driver still matches a third-party implementation after any refactor.
2. **Commit both lockfiles and pin exact versions.** The whole stack is a handful of packages by very few publishers; both lockfiles are already generated here.
3. **Keep the vector file as a cross-language contract test.** Wire `node src/emit-vectors.js && dart run bin/verify_vectors.dart` into CI so a Dart-side upgrade that changes any byte fails loudly. This is the single highest-value artifact of the spike.
4. **Delete `noise_protocol_framework` (and with it `pointycastle`/`elliptic`) from `pubspec.yaml`.** It is declared here only to document that it resolves; it must not ship. Also consider adding a lint/test that fails if `Hmac(Blake2s())` or `pointycastle`'s `ChaCha20Poly1305` ever appears in the codebase (both are traps, section (b)).
5. **Expressly do not add `sodium-native`.** It works with no build step, but it cannot do BLAKE2s, and it brings 18 MB and 15 extra packages. If a future decision flips the suite to BLAKE2b, re-evaluate: BLAKE2b + `noise-handshake@4.2.0` + `sodium-native@5.1.0` would be native-speed and zero-custom-crypto on Node (and `noise-handshake`'s XX driver is already proven correct against our vectors).
6. **Plan the Dart transport acceleration now**, not later: decide between `cryptography_flutter` and chunked I/O before the streaming layer is designed, because 8–10 MiB/s constrains it.

### Risk register (honest)

| Risk | Severity | Notes |
| --- | --- | --- |
| **We own the XX state machine.** A bug in token ordering, HKDF composition or the prologue binding would not be caught by any third-party audit. | High | Mitigated to a good degree: the Node driver is byte-identical to `noise-handshake`'s XX (BLAKE2b oracle), both sides match on a full 12-step `h`/`ck`/`k` trace, and both match independent RFC KATs. Still: this is security-critical code that a human reviewer should read line-by-line against spec §7. |
| **`@noble/*` is effectively a one-person project** (Paul Miller), 3 packages deep. | Medium | Widely deployed and independently audited (Cure53 2021; Trail of Bits for curves), no install scripts, no native code. Pin exact versions; mirror to an internal registry if that is available. |
| **`cryptography` (Gohilla) is effectively single-publisher and ships a real correctness bug** (`Blake2s.blockLengthInBytes == 32`). | Medium–High | We avoid the buggy path (manual HMAC, no `Hmac(Blake2s())`), but a future contributor could easily hit it. Pin `2.9.0` exactly and add the guard test from action 4. Alternative: switch the Dart BLAKE2s to a self-contained implementation or to `pointycastle`'s BLAKE2b, and re-vector. |
| **Dart transport throughput (~8–10 MiB/s, pure Dart, unverified on device).** | Medium | See (g). Decide on `cryptography_flutter` before designing the streaming layer. |
| **BLAKE2s is an unusual suite for Noise.** Most ecosystem tooling (libsodium, libp2p, every JS Noise library) speaks BLAKE2b or SHA-256, so the suite choice permanently excludes off-the-shelf implementations on *both* sides. | Medium | If the suite is still open, **switching to `Noise_XX_25519_ChaChaPoly_BLAKE2b` removes the entire Dart-side blocker and most of the Node-side custom code** (`noise-handshake@4.2.0` works natively) at the cost of a 64-byte hash and slightly slower hashing. That is worth a deliberate decision rather than a default. |
| **Nonce exhaustion / message-size limits.** Both implementations refuse to exceed 2³² messages per direction and 65535-byte Noise messages. | Low | Enforced identically on both sides (matches `noise-handshake`'s own limit). Callers must chunk. |
| **No rekey support** (`Rekey()` is not implemented). | Low | Fine for a remote-access session of bounded length; add it or bound session length/data volume before shipping, per spec §11.3. |
| **No low-order-point / contributory-behaviour check on X25519 peer keys.** | Low–Medium | Neither implementation rejects an all-zero DH output. With XX the statics are authenticated, so this is mostly a hardening item; add an explicit check if the threat model includes malicious peers. |
| **Static key persistence is not exercised here.** | Medium | This spike uses per-process statics. Device key generation, clamping conventions (note: `DartX25519.newKeyPairFromSeed` returns **clamped** bytes, so the persisted private key differs byte-wise from what `@noble`/libsodium would store for the same seed — clamping is idempotent so both remain valid, but a shared key-storage format must be agreed explicitly) and secure storage are out of scope and untested. |

---

## (i) Fallback option (not needed — recorded for completeness)

Interop succeeded, so the TLS 1.3 fallback was not pursued beyond an outline.

**What TLS 1.3 + mutual client certificates + an application-layer AEAD would require:** on Node, `node:tls` with `requestCert: true`, `rejectUnauthorized: true`, a CA the plugin itself pins, and a self-signed device certificate whose fingerprint is bound into the pairing payload instead of an X25519 static key; then an application AEAD (e.g. ChaCha20-Poly1305 with a key derived from the TLS exporter) for end-to-end confidentiality that survives a terminating proxy. On Dart, `SecurityContext` with `useCertificateChain`/`usePrivateKey` and `SecureSocket.connect(onBadCertificate: ...)` with **fingerprint pinning** (Dart's `X509Certificate` exposes `sha1` only, so pinning is done on a hash you provide), plus `cryptography` or `pointycastle` for the application AEAD. **Concrete blockers:** (1) TLS has no built-in short-authentication-string binding, so the MITM resistance of "compare 6 digits" would have to be re-implemented over the channel binding / exporter — the very thing the Noise handshake hash gives us for free; (2) Dart on Android/iOS does support client certificates through `SecureSocket`, but it depends on the platform BoringSSL and the `onBadCertificate` escape hatch is easy to get wrong — pinning must be explicit and tested per platform; (3) `SecureSocket` cannot present a *raw* self-signed cert chain without a `SecurityContext` and file/asset plumbing for the private key, which on mobile means key material crossing into the platform TLS stack — a worse trust boundary than keeping an X25519 static key in Dart; (4) it is strictly more code and more platform surface than the ~330-line Dart implementation proven here, and it does not give byte-level cross-language vectors. **Recommendation: do not fall back.**

---

## Layout of this spike

```
spikes/noise-interop/
  REPORT.md                              this file
  vectors/xx25519-chachapoly-blake2s.json  the cross-language contract (deterministic)
  node/
    package.json / package-lock.json
    src/bytes.js                         byte helpers
    src/primitives.js                    BLAKE2s/BLAKE2b cipher sets, X25519, AEAD, SHA-256
    src/noise-xx.js                      XX state machine, HKDF, CipherState, SAS, prologue
    src/emit-vectors.js                  writes vectors/xx25519-chachapoly-blake2s.json
    src/validate-vs-noise-handshake.js   byte-compares our driver with noise-handshake (BLAKE2b)
    src/selftest.js                      happy path, tamper, replay, prologue, perf
    src/tcp-interop.js                   live TCP driver (server/client, either role)
  dart/
    pubspec.yaml / pubspec.lock
    lib/noise_xx_blake2s.dart            the Dart XX state machine
    bin/verify_vectors.dart              consumes the Node vectors byte-for-byte (94 checks)
    bin/selftest.dart                    happy path, tamper, replay, prologue, perf
    bin/tcp_interop.dart                 live TCP driver (mirror of the Node one)
  scripts/
    run-all.sh                           everything, in order
    run-interop.sh                       live interop, both roles + negative run
    test-sodium-native.sh                sodium-native across npm/pnpm/hoisted layouts
  results/                               captured logs from the runs
  sodium-tests/                          generated by scripts/test-sodium-native.sh
```

Not shipped and not claimed: no mobile-device testing, no static-key persistence, no rekeying, no threat model beyond "replayed QR code in a different session", and no independent audit of our state machine.
