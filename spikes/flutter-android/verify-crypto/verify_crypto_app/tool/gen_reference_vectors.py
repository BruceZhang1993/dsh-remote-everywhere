#!/usr/bin/env python3
"""Generate INDEPENDENT reference vectors for the Noise primitive verification.

These vectors are produced by CPython's hashlib/hmac (OpenSSL) and pyca/cryptography,
i.e. by implementations that share NO code with the Dart packages under test.
Published RFC vectors are hard-coded in the Dart test instead.

Usage:  python3 tool/gen_reference_vectors.py > test/reference_vectors.dart
"""
import hashlib
import hmac as hmac_mod
import struct
import sys

from cryptography.hazmat.primitives.ciphers.aead import ChaCha20Poly1305

H = bytes.hex


def pattern(n: int) -> bytes:
    """Deterministic test input; deliberately hits every BLAKE2s block boundary."""
    return bytes((i * 7 + 11) % 251 for i in range(n))


SIZES = [0, 1, 3, 31, 32, 33, 63, 64, 65, 127, 128, 129, 255, 256, 1000]

KEY32 = bytes(range(32))
KEY_SECRET = b"secret"
KEY100 = bytes(range(100))

out = []
w = out.append

w("// GENERATED FILE - DO NOT EDIT BY HAND.")
w("// Produced by: tool/gen_reference_vectors.py")
w("// Independent references from CPython hashlib/hmac (OpenSSL) + pyca/cryptography.")
w("// ignore_for_file: lines_longer_than_80_chars")
w("")

# ---------------------------------------------------------------- BLAKE2s hash
w("/// BLAKE2s-256 of \"abc\" (published vector, RFC 7693 Appendix A style).")
w("const String blake2sAbcRef =")
w("    '%s';" % H(hashlib.blake2s(b"abc").digest()))
w("")
w("/// Independent BLAKE2s-256 digests of pattern(n), keyed by input length.")
w("const Map<int, String> blake2sRef = <int, String>{")
for n in SIZES:
    w("  %d: '%s'," % (n, H(hashlib.blake2s(pattern(n)).digest())))
w("};")
w("")

# --------------------------------------------------------------- keyed BLAKE2s
w("/// Native keyed BLAKE2s (BLAKE2s keyed mode, NOT HMAC), key = bytes(0..31).")
w("const Map<int, String> keyedBlake2sRef = <int, String>{")
for n in SIZES:
    w("  %d: '%s',"
      % (n, H(hashlib.blake2s(pattern(n), key=KEY32).digest())))
w("};")
w("")

# --------------------------------------------------------------- HMAC-BLAKE2s
# CPython hmac uses hashlib.blake2s().block_size == 64, i.e. textbook RFC 2104
# HMAC with B = 64 (the BLAKE2s compression block size).
w("/// Textbook HMAC-BLAKE2s per RFC 2104 with B = 64 (BLAKE2s block size).")
w("/// This is what the Noise Protocol Framework's HMAC-HASH means.")
w("const String hmacBlake2sSecretAbcRef = '%s';"
  % H(hmac_mod.new(KEY_SECRET, b"abc", hashlib.blake2s).digest()))
w("const String hmacBlake2sKey32AbcRef = '%s';"
  % H(hmac_mod.new(KEY32, b"abc", hashlib.blake2s).digest()))
w("const String hmacBlake2sKey100AbcRef = '%s';"
  % H(hmac_mod.new(KEY100, b"abc", hashlib.blake2s).digest()))
w("const Map<int, String> hmacBlake2sKey32Ref = <int, String>{")
for n in SIZES:
    w("  %d: '%s',"
      % (n, H(hmac_mod.new(KEY32, pattern(n), hashlib.blake2s).digest())))
w("};")
w("")
w("/// Textbook HMAC-BLAKE2b per RFC 2104 with B = 128 (BLAKE2b block size).")
w("const String hmacBlake2bSecretAbcRef = '%s';"
  % H(hmac_mod.new(KEY_SECRET, b"abc", hashlib.blake2b).digest()))


def _emul_hmac(key: bytes, msg: bytes, h, blk: int) -> bytes:
    """HMAC-<h> with an artificially small pad block size `blk`."""
    kk = h(key).digest() if len(key) > blk else key
    ip = bytes(((kk[i] if i < len(kk) else 0) ^ 0x36) for i in range(blk))
    op = bytes(((kk[i] if i < len(kk) else 0) ^ 0x5C) for i in range(blk))
    return h(op + h(ip + msg).digest()).digest()


w("/// HMAC emulated with pad block = digest size instead of the real hash block")
w("/// size. These describe the behaviour of package:cryptography's")
w("/// `Hmac(Blake2s())` (B = 32) and `Hmac(Blake2b())` (B = 64).")
w("const String hmacEmulBlake2sB32SecretAbcRef = '%s';"
  % H(_emul_hmac(KEY_SECRET, b"abc", hashlib.blake2s, 32)))
w("const String hmacEmulBlake2bB64SecretAbcRef = '%s';"
  % H(_emul_hmac(KEY_SECRET, b"abc", hashlib.blake2b, 64)))
w("")

# ------------------------------------------------------- HKDF (RFC 5869) BLAKE2s
IKM = bytes.fromhex("0b" * 22)
SALT = bytes.fromhex("000102030405060708090a0b0c")
INFO = bytes.fromhex("f0f1f2f3f4f5f6f7f8f9")
PRK = hmac_mod.new(SALT, IKM, hashlib.blake2s).digest()
T1 = hmac_mod.new(PRK, INFO + b"\x01", hashlib.blake2s).digest()
T2 = hmac_mod.new(PRK, T1 + INFO + b"\x02", hashlib.blake2s).digest()
OKM42 = (T1 + T2)[:42]
w("/// RFC 5869 test-case-1 inputs, hashed with HMAC-BLAKE2s.")
w("const String hkdfIkmHex = '%s';" % H(IKM))
w("const String hkdfSaltHex = '%s';" % H(SALT))
w("const String hkdfInfoHex = '%s';" % H(INFO))
w("const String hkdfPrkBlake2sRef = '%s';" % H(PRK))
w("const String hkdfOkm32Blake2sRef = '%s';" % H(T1))
w("const String hkdfOkm42Blake2sRef = '%s';" % H(OKM42))
w("")
_eprk = _emul_hmac(SALT, IKM, hashlib.blake2s, 32)
_et1 = _emul_hmac(_eprk, INFO + b"\x01", hashlib.blake2s, 32)
_et2 = _emul_hmac(_eprk, _et1 + INFO + b"\x02", hashlib.blake2s, 32)
w("/// RFC 5869 HKDF built on the emulated (non-standard, B = 32) HMAC-BLAKE2s,")
w("/// i.e. what package:cryptography's Hkdf(hmac: Hmac.blake2s()) produces.")
w("const String hkdfOkm32EmulBlake2sB32Ref = '%s';" % H(_et1))
w("const String hkdfOkm42EmulBlake2sB32Ref = '%s';" % H((_et1 + _et2)[:42]))
w("")

# ------------------------------------------- Noise-style HKDF, HASHLEN 32 and 64
def noise_hkdf(hash_name, ck: bytes, ikm: bytes, truncate: bool):
    h = getattr(hashlib, hash_name)
    hl = h().digest_size

    def mac(key, msg):
        d = hmac_mod.new(key, msg, h).digest()
        return d[:32] if truncate else d

    temp = mac(ck, ikm)
    o1 = mac(temp, b"\x01")
    o2 = mac(temp, o1 + b"\x02")
    return o1, o2


CK = bytes.fromhex("4e" * 32)
O1S, O2S = noise_hkdf("blake2s", CK, b"noise-ikm", truncate=False)
O1B, O2B = noise_hkdf("blake2b", CK, b"noise-ikm", truncate=True)
w("/// Noise HKDF(chaining_key, input_key_material) with HASHLEN = 32 (BLAKE2s).")
w("/// No truncation applies because HASHLEN == 32.")
w("const String noiseHkdfCkHex = '%s';" % H(CK))
w("const String noiseHkdfIkm = 'noise-ikm';")
w("const String noiseHkdfBlake2sO1Ref = '%s';" % H(O1S))
w("const String noiseHkdfBlake2sO2Ref = '%s';" % H(O2S))
w("")
w("/// Same construction with HASHLEN = 64 (BLAKE2b) where Noise discards")
w("/// everything after the first 32 bytes of every HMAC output.")
w("const String noiseHkdfBlake2bTruncO1Ref = '%s';" % H(O1B))
w("const String noiseHkdfBlake2bTruncO2Ref = '%s';" % H(O2B))
w("const String noiseHkdfBlake2bFullO1Ref = '%s';"
  % H(noise_hkdf("blake2b", CK, b"noise-ikm", truncate=False)[0]))
w("")

# -------------------------------------------------------------------- SHA-256
w("/// SHA-256 digests of pattern(n).")
w("const Map<int, String> sha256Ref = <int, String>{")
for n in SIZES:
    w("  %d: '%s'," % (n, H(hashlib.sha256(pattern(n)).digest())))
w("};")
w("")

# ------------------------------------------------------- ChaCha20-Poly1305 AEAD
# RFC 8439 section 2.8.2 vector (12-byte nonce).
RFC_KEY = bytes.fromhex(
    "808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9f")
RFC_NONCE = bytes.fromhex("070000004041424344454647")
RFC_AAD = bytes.fromhex("50515253c0c1c2c3c4c5c6c7")
RFC_PT = (b"Ladies and Gentlemen of the class of '99: If I could offer you "
          b"only one tip for the future, sunscreen would be it.")
RFC_CT = ChaCha20Poly1305(RFC_KEY).encrypt(RFC_NONCE, RFC_PT, RFC_AAD)
w("/// RFC 8439 section 2.8.2 AEAD_CHACHA20_POLY1305 vector.")
w("const String rfc8439KeyHex = '%s';" % H(RFC_KEY))
w("const String rfc8439NonceHex = '%s';" % H(RFC_NONCE))
w("const String rfc8439AadHex = '%s';" % H(RFC_AAD))
w("const String rfc8439PlaintextHex = '%s';" % H(RFC_PT))
w("const String rfc8439CiphertextHex = '%s';" % H(RFC_CT[:-16]))
w("const String rfc8439TagHex = '%s';" % H(RFC_CT[-16:]))
w("")

# Noise nonce construction: 4 zero bytes || LE64(counter).
NOISE_KEY = bytes.fromhex("1c" * 32)
NOISE_AAD = bytes.fromhex("a0" * 16)
NOISE_PT = pattern(77)
for counter in (0, 1, 2, 0x0102030405060708):
    n12 = bytes(4) + struct.pack("<Q", counter)
    ct = ChaCha20Poly1305(NOISE_KEY).encrypt(n12, NOISE_PT, NOISE_AAD)
    w("/// Noise 96-bit nonce: 4 zero bytes || LE64(%d)." % counter)
    w("const String noiseNonce%dHex = '%s';" % (counter, H(n12)))
    w("const String noiseCt%dHex = '%s';" % (counter, H(ct[:-16])))
    w("const String noiseTag%dHex = '%s';" % (counter, H(ct[-16:])))
w("const String noiseAeadKeyHex = '%s';" % H(NOISE_KEY))
w("const String noiseAeadAadHex = '%s';" % H(NOISE_AAD))
w("const String noiseAeadPlaintextHex = '%s';" % H(NOISE_PT))
w("")

sys.stdout.write("\n".join(out) + "\n")
