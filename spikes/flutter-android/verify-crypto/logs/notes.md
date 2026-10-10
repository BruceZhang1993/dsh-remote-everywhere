## Notes / characterisations recorded by the suite

**Hmac.blake2s() is non-standard** — RFC 2104 HMAC-BLAKE2s (B=64, OpenSSL/interop) = 38441ee1d037603eb6dbcf66742ebbbcbd8afb9606c178532e0f364bd50b4583 package:cryptography Hmac.blake2s()        = 773a1d7d24a7d4c742973ad7420fadc143e2ec52a09ffe9c279f367ab8cad85b => cryptography pads the key to 32 bytes (Blake2s.blockLengthInBytes == 32, i.e. the DIGEST length) instead of the real 64-byte BLAKE2s compression block. Non-interoperable with every other Noise stack.

**Hmac.blake2b() is non-standard** — RFC 2104 HMAC-BLAKE2b (B=128)        = f0eda798c45c704ed9823e24491cf9fb44bfe4d3802cfae6af1e44f274b82bb683c9f0b2446eaa276cb4c06ea46afc848d27711b4609d269b1a4717577cb9552 package:cryptography Hmac.blake2b() = 87b33895c0d474e40289766104f4d02dfd689c0d7a16b3e9796ff8ec3d2a0db8b1fa89267d44a08abb6bd6bf1cdfd320ec41f7ae695f7105296d7bb2f8c642f8

**Hkdf(Hmac.blake2s) unusable for Noise** — expected (RFC 2104 HMAC-BLAKE2s) 1472c31f2ff768c71b19f8803683ee3b13c1a5fb3ea59c0c3bf0d44a4a40dcd4 actual   (cryptography B=32)    7077bc75410030aa2411651be1df17b17807104e095e479a33e46a60808a83b6

**HASHLEN=64 supported** — Blake2b primitives allow both the untruncated 64-byte output and the Noise 32-byte-truncated variant; only truncation is Noise-correct.

**X25519 has no low-order point check** — libsodium/pyca reject these 7 u-coordinates outright; cryptography 2.9.0 returns the all-zero shared secret with no error: u = 0                              -> 0000000000000000000000000000000000000000000000000000000000000000   <-- ALL ZERO, silently returned u = 1                              -> 0000000000000000000000000000000000000000000000000000000000000000   <-- ALL ZERO, silently returned order-8 point A                    -> 0000000000000000000000000000000000000000000000000000000000000000   <-- ALL ZERO, silently returned order-8 point B                    -> 0000000000000000000000000000000000000000000000000000000000000000   <-- ALL ZERO, silently returned p - 1                              -> 0000000000000000000000000000000000000000000000000000000000000000   <-- ALL ZERO, silently returned p (== 0 mod p)                     -> 0000000000000000000000000000000000000000000000000000000000000000   <-- ALL ZERO, silently returned p + 1 (== 1 mod p)                 -> 0000000000000000000000000000000000000000000000000000000000000000   <-- ALL ZERO, silently returned

**Mitigation is mandatory** — Noise_XX must call sharedSecretKey() and then reject an all-zero result (and reject a non-contributory remote static key) itself.

**pointycastle AEAD API caveat** — ChaCha20Poly1305.process() returns a zero-padded tail; the final partial block and the MAC only materialise after doFinal(). Not on our path (cryptography owns the AEAD) but a sharp edge to know about.

**pointycastle 4.0.0 ships BLAKE2b only** — lib/digests/ contains blake2b.dart and no blake2s.dart; the registry registers only Blake2bDigest. Blake2s must come from cryptography. ============================================ 00:01 +26: All tests passed!

