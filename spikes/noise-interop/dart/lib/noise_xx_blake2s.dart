// Noise_XX_25519_ChaChaPoly_BLAKE2s — Dart side of the interop spike.
//
// Why hand-written: `noise_protocol_framework` 1.2.0 (the only live Dart Noise
// package) ships handshake states for NKpsk0 and KNpsk0 only — there is no XX
// implementation — and its SymmetricState hardcodes HKDF-HMAC-SHA256, which is
// wrong for any BLAKE2s suite. `noise_protocol` 0.1.1 is dead (SDK <3.0.0).
// See REPORT.md.
//
// Primitives (all pure Dart, no native toolchain, no FFI):
//   - BLAKE2s        : package:cryptography 2.9.0  (DartBlake2s)
//   - X25519         : package:cryptography 2.9.0  (DartX25519, RFC 7748)
//   - ChaCha20-Poly1305 : package:cryptography 2.9.0 (DartChacha20.poly1305Aead)
//   - SHA-256        : package:crypto 3.0.7        (dart-lang sha256)
//
// HMAC is implemented here rather than via package:cryptography's `Hmac`
// because `Blake2s.blockLengthInBytes` in that package returns 32, while the
// real BLAKE2s block size is 64 bytes. Using it for HMAC produces wrong tags.
// (Noise's HKDF is HMAC-based, so this matters — see REPORT.md section (d).)

import 'dart:convert';
import 'dart:math' as math;
import 'dart:typed_data';

import 'package:cryptography/cryptography.dart';
import 'package:cryptography/dart.dart';
import 'package:crypto/crypto.dart' as crypto;

// ---------------------------------------------------------------------------
// Constants (Noise Protocol Framework rev 34)
// ---------------------------------------------------------------------------

const String kProtocolName = 'Noise_XX_25519_ChaChaPoly_BLAKE2s';
const int kHashLen = 32; // BLAKE2s HASHLEN
const int kBlockLen = 64; // BLAKE2s BLOCKLEN
const int kCipherKeyLen = 32; // ChaChaPoly KEYLEN
const int kTagLen = 16; // ChaChaPoly MACBYTES
const int kDhLen = 32; // X25519 DHLEN / PKLEN / SKLEN
const int kMaxMessageLen = 65535;

const DartBlake2s _blake2s = DartBlake2s();
const DartX25519 _x25519 = DartX25519();
const DartChacha20 _aead = DartChacha20.poly1305Aead();

// ---------------------------------------------------------------------------
// Byte helpers
// ---------------------------------------------------------------------------

Uint8List concatBytes(List<List<int>> parts) {
  var size = 0;
  for (final p in parts) {
    size += p.length;
  }
  final out = Uint8List(size);
  var offset = 0;
  for (final p in parts) {
    out.setAll(offset, p);
    offset += p.length;
  }
  return out;
}

String toHex(List<int> bytes) {
  final sb = StringBuffer();
  for (final b in bytes) {
    sb.write((b & 0xff).toRadixString(16).padLeft(2, '0'));
  }
  return sb.toString();
}

Uint8List fromHex(String hex) {
  if (hex.length.isOdd) throw ArgumentError('odd hex length');
  final out = Uint8List(hex.length ~/ 2);
  for (var i = 0; i < out.length; i++) {
    out[i] = int.parse(hex.substring(i * 2, i * 2 + 2), radix: 16);
  }
  return out;
}

bool constantTimeEquals(List<int> a, List<int> b) {
  if (a.length != b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff == 0;
}

Uint8List utf8Bytes(String s) => Uint8List.fromList(utf8.encode(s));

// ---------------------------------------------------------------------------
// Hash / HMAC / HKDF
// ---------------------------------------------------------------------------

Uint8List blake2sHash(List<int> data) =>
    Uint8List.fromList(_blake2s.hashSync(data).bytes);

/// HMAC-BLAKE2s (RFC 2104) with the real BLAKE2s block size of 64 bytes.
Uint8List hmacBlake2s(List<int> key, List<List<int>> parts) {
  final k = Uint8List(kBlockLen);
  if (key.length > kBlockLen) {
    k.setAll(0, blake2sHash(key));
  } else {
    k.setAll(0, key);
  }
  final ipad = Uint8List(kBlockLen);
  final opad = Uint8List(kBlockLen);
  for (var i = 0; i < kBlockLen; i++) {
    ipad[i] = k[i] ^ 0x36;
    opad[i] = k[i] ^ 0x5c;
  }
  final inner = blake2sHash(concatBytes([ipad, ...parts]));
  return blake2sHash(concatBytes([opad, inner]));
}

/// HKDF(chainingKey, ikm, numOutputs) exactly as the Noise spec defines it:
/// temp_key = HMAC(ck, ikm); output[i] = HMAC(temp_key, output[i-1] || i).
List<Uint8List> hkdf(List<int> chainingKey, List<int> ikm, int numOutputs) {
  final tempKey = hmacBlake2s(chainingKey, [ikm]);
  final outputs = <Uint8List>[];
  var prev = Uint8List(0);
  for (var i = 1; i <= numOutputs; i++) {
    prev = hmacBlake2s(tempKey, [prev, Uint8List.fromList([i])]);
    outputs.add(prev);
  }
  return outputs;
}

// ---------------------------------------------------------------------------
// X25519
// ---------------------------------------------------------------------------

Uint8List dh(List<int> secretKey, List<int> remotePublicKey) {
  if (secretKey.length != kDhLen) throw ArgumentError('bad X25519 secret key');
  if (remotePublicKey.length != kDhLen) throw ArgumentError('bad X25519 public key');
  final kp = SimpleKeyPairData(
    Uint8List.fromList(secretKey),
    publicKey: SimplePublicKey(
      Uint8List.fromList(remotePublicKey),
      type: KeyPairType.x25519,
    ),
    type: KeyPairType.x25519,
  );
  final shared = _x25519.sharedSecretSync(
    keyPairData: kp,
    remotePublicKey: SimplePublicKey(
      Uint8List.fromList(remotePublicKey),
      type: KeyPairType.x25519,
    ),
  );
  if (shared is! SecretKeyData) {
    throw StateError('unexpected SecretKey implementation: ${shared.runtimeType}');
  }
  return Uint8List.fromList(shared.bytes);
}

/// X25519 public key from a 32-byte secret: X25519(sk, 9), which is the RFC 7748
/// definition. Implemented via the sync DH primitive so keygen stays synchronous.
Uint8List publicKeyFromSecret(List<int> secretKey) {
  final basePoint = Uint8List(32)..[0] = 9;
  return dh(secretKey, basePoint);
}

// ---------------------------------------------------------------------------
// AEAD: ChaCha20-Poly1305 with a 96-bit nonce = 4 zero bytes || LE64(counter)
// ---------------------------------------------------------------------------

Uint8List noiseNonce(int n) {
  final nonce = Uint8List(12);
  final view = ByteData.view(nonce.buffer);
  view.setUint64(4, n, Endian.little);
  return nonce;
}

Uint8List aeadEncrypt(
  List<int> key,
  int n,
  List<int> ad,
  List<int> plaintext,
) {
  final box = _aead.encryptSync(
    plaintext,
    secretKey: SecretKeyData(Uint8List.fromList(key)),
    nonce: noiseNonce(n),
    aad: Uint8List.fromList(ad),
  );
  return concatBytes([box.cipherText, box.mac.bytes]);
}

/// Throws [SecretBoxAuthenticationError] when the Poly1305 tag does not verify.
Uint8List aeadDecrypt(
  List<int> key,
  int n,
  List<int> ad,
  List<int> ciphertext,
) {
  if (ciphertext.length < kTagLen) {
    throw SecretBoxAuthenticationError();
  }
  final split = ciphertext.length - kTagLen;
  return Uint8List.fromList(_aead.decryptSync(
    SecretBox(
      Uint8List.fromList(ciphertext.sublist(0, split)),
      nonce: noiseNonce(n),
      mac: Mac(Uint8List.fromList(ciphertext.sublist(split))),
    ),
    secretKey: SecretKeyData(Uint8List.fromList(key)),
    aad: Uint8List.fromList(ad),
  ));
}

Uint8List sha256(List<int> data) =>
    Uint8List.fromList(crypto.sha256.convert(data).bytes);

/// Raw RFC 8439 AEAD_CHACHA20_POLY1305 with a caller-supplied 12-byte nonce.
/// Exposed for the known-answer tests; the Noise code path goes through
/// [aeadEncrypt]/[aeadDecrypt], which build the nonce from the counter.
Uint8List pcChacha20Poly1305(
  List<int> key,
  List<int> nonce,
  List<int> ad,
  List<int> plaintext,
) {
  final box = _aead.encryptSync(
    plaintext,
    secretKey: SecretKeyData(Uint8List.fromList(key)),
    nonce: Uint8List.fromList(nonce),
    aad: Uint8List.fromList(ad),
  );
  return concatBytes([box.cipherText, box.mac.bytes]);
}

Uint8List pcChacha20Poly1305Decrypt(
  List<int> key,
  List<int> nonce,
  List<int> ad,
  List<int> ciphertext,
) {
  final split = ciphertext.length - kTagLen;
  return Uint8List.fromList(_aead.decryptSync(
    SecretBox(
      Uint8List.fromList(ciphertext.sublist(0, split)),
      nonce: Uint8List.fromList(nonce),
      mac: Mac(Uint8List.fromList(ciphertext.sublist(split))),
    ),
    secretKey: SecretKeyData(Uint8List.fromList(key)),
    aad: Uint8List.fromList(ad),
  ));
}

// ---------------------------------------------------------------------------
// Noise state
// ---------------------------------------------------------------------------

class NoiseTraceEntry {
  NoiseTraceEntry(this.label, this.h, this.ck, this.k);
  final String label;
  final String h;
  final String ck;
  final String? k;

  Map<String, dynamic> toJson() => {
        'label': label,
        'h': h,
        'ck': ck,
        'k': k,
      };
}

class CipherState {
  CipherState([List<int>? key])
      : k = key == null
            ? null
            : Uint8List.fromList(key.sublist(0, kCipherKeyLen)),
        n = 0;

  Uint8List? k;
  int n;

  bool get hasKey => k != null;

  void initializeKey(List<int> key) {
    k = Uint8List.fromList(key.sublist(0, kCipherKeyLen));
    n = 0;
  }

  Uint8List encrypt(List<int> plaintext, [List<int>? ad]) {
    final aad = ad ?? Uint8List(0);
    final key = k;
    if (key == null) return Uint8List.fromList(plaintext);
    if (n >= 0xffffffff) throw StateError('CipherState nonce exhausted');
    final ciphertext = aeadEncrypt(key, n, aad, plaintext);
    if (ciphertext.length > kMaxMessageLen) {
      throw StateError('Noise message too long');
    }
    n++;
    return ciphertext;
  }

  Uint8List decrypt(List<int> ciphertext, [List<int>? ad]) {
    final aad = ad ?? Uint8List(0);
    final key = k;
    if (key == null) return Uint8List.fromList(ciphertext);
    if (n >= 0xffffffff) throw StateError('CipherState nonce exhausted');
    if (ciphertext.length > kMaxMessageLen) {
      throw StateError('Noise message too long');
    }
    final plaintext = aeadDecrypt(key, n, aad, ciphertext);
    n++;
    return plaintext;
  }
}

class SymmetricState {
  SymmetricState({List<int>? prologue, bool trace = false})
      : _trace = trace ? <NoiseTraceEntry>[] : null {
    final protocolName = utf8Bytes(kProtocolName);
    final h = Uint8List(kHashLen);
    if (protocolName.length <= kHashLen) {
      h.setAll(0, protocolName);
    } else {
      h.setAll(0, blake2sHash(protocolName));
    }
    this.h = h;
    ck = Uint8List.fromList(h);
    mixHash(prologue ?? Uint8List(0), 'prologue');
  }

  late Uint8List h;
  late Uint8List ck;
  final CipherState cipher = CipherState();
  final List<NoiseTraceEntry>? _trace;

  List<NoiseTraceEntry>? get trace => _trace;

  void _note(String label) {
    _trace?.add(NoiseTraceEntry(
      label,
      toHex(h),
      toHex(ck),
      cipher.k == null ? null : toHex(cipher.k!),
    ));
  }

  void mixHash(List<int> data, [String label = 'mixHash']) {
    h = blake2sHash(concatBytes([h, data]));
    _note(label);
  }

  void mixKey(List<int> ikm, [String label = 'mixKey']) {
    final out = hkdf(ck, ikm, 2);
    ck = out[0];
    cipher.initializeKey(out[1]);
    _note(label);
  }

  void mixKeyAndHash(List<int> ikm, [String label = 'mixKeyAndHash']) {
    final out = hkdf(ck, ikm, 3);
    ck = out[0];
    mixHash(out[1]);
    cipher.initializeKey(out[2]);
    _note(label);
  }

  Uint8List encryptAndHash(List<int> plaintext, [String label = 'encryptAndHash']) {
    final ciphertext = cipher.encrypt(plaintext, h);
    mixHash(ciphertext, label);
    return ciphertext;
  }

  Uint8List decryptAndHash(List<int> ciphertext, [String label = 'decryptAndHash']) {
    final plaintext = cipher.decrypt(ciphertext, h);
    mixHash(ciphertext, label);
    return plaintext;
  }

  List<Uint8List> split() => hkdf(ck, Uint8List(0), 2);

  Uint8List getHandshakeHash() => Uint8List.fromList(h);
}

/// XX pattern:
///   -> e
///   <- e, ee, s, es
///   -> s, se
class NoiseXX extends SymmetricState {
  NoiseXX({
    required this.initiator,
    required Uint8List staticSecretKey,
    required Uint8List staticPublicKey,
    Uint8List? prologue,
    Uint8List? ephemeralSecretKey,
    bool trace = false,
  })  : sSecret = staticSecretKey,
        sPublic = staticPublicKey,
        _fixedE = ephemeralSecretKey,
        super(prologue: prologue, trace: trace);

  final bool initiator;
  final Uint8List sSecret;
  final Uint8List sPublic;
  Uint8List? _fixedE;

  Uint8List? eSecret;
  Uint8List? ePublic;
  Uint8List? re;
  Uint8List? rs;

  int messageIndex = 0;
  bool complete = false;
  CipherState? tx;
  CipherState? rx;
  Uint8List? handshakeHash;

  void _generateEphemeral() {
    final sk = _fixedE ?? _randomBytes(32);
    _fixedE = null;
    eSecret = Uint8List.fromList(sk);
    ePublic = publicKeyFromSecret(sk);
  }

  static final math.Random _rng = math.Random.secure();

  static Uint8List _randomBytes(int n) {
    final out = Uint8List(n);
    for (var i = 0; i < n; i++) {
      out[i] = _rng.nextInt(256);
    }
    return out;
  }

  void _finish() {
    final keys = split();
    tx = CipherState(initiator ? keys[0] : keys[1]);
    rx = CipherState(initiator ? keys[1] : keys[0]);
    handshakeHash = getHandshakeHash();
    complete = true;
    _note('split');
  }

  Uint8List writeMessage([List<int>? payload]) {
    final p = payload ?? Uint8List(0);
    if (complete) throw StateError('handshake already complete');
    if (messageIndex == 0 && initiator) return _writeMsg1(p);
    if (messageIndex == 1 && !initiator) return _writeMsg2(p);
    if (messageIndex == 2 && initiator) return _writeMsg3(p);
    throw StateError('writeMessage: wrong role/index ($messageIndex, initiator=$initiator)');
  }

  Uint8List readMessage(List<int> buf) {
    if (complete) throw StateError('handshake already complete');
    if (messageIndex == 0 && !initiator) return _readMsg1(buf);
    if (messageIndex == 1 && initiator) return _readMsg2(buf);
    if (messageIndex == 2 && !initiator) return _readMsg3(buf);
    throw StateError('readMessage: wrong role/index ($messageIndex, initiator=$initiator)');
  }

  // -> e
  Uint8List _writeMsg1(List<int> payload) {
    _generateEphemeral();
    mixHash(ePublic!, 'e1:e');
    final out = concatBytes([ePublic!, encryptAndHash(payload, 'e1:payload')]);
    messageIndex++;
    return out;
  }

  Uint8List _readMsg1(List<int> buf) {
    re = Uint8List.fromList(buf.sublist(0, kDhLen));
    mixHash(re!, 'e1:re');
    final payload = decryptAndHash(buf.sublist(kDhLen), 'e1:payload');
    messageIndex++;
    return payload;
  }

  // <- e, ee, s, es
  Uint8List _writeMsg2(List<int> payload) {
    _generateEphemeral();
    mixHash(ePublic!, 'e2:e');
    final parts = <List<int>>[ePublic!];

    mixKey(dh(eSecret!, re!), 'e2:ee'); // DH(e_i, e_r)
    parts.add(encryptAndHash(sPublic, 'e2:s'));

    mixKey(dh(sSecret, re!), 'e2:es'); // DH(e_i, s_r)
    parts.add(encryptAndHash(payload, 'e2:payload'));

    messageIndex++;
    return concatBytes(parts);
  }

  Uint8List _readMsg2(List<int> buf) {
    var offset = 0;
    re = Uint8List.fromList(buf.sublist(offset, offset + kDhLen));
    offset += kDhLen;
    mixHash(re!, 'e2:re');

    mixKey(dh(eSecret!, re!), 'e2:ee'); // DH(e_i, e_r)

    final encryptedStatic = buf.sublist(offset, offset + kDhLen + kTagLen);
    offset += kDhLen + kTagLen;
    rs = decryptAndHash(encryptedStatic, 'e2:s');

    mixKey(dh(eSecret!, rs!), 'e2:es'); // DH(e_i, s_r)

    final payload = decryptAndHash(buf.sublist(offset), 'e2:payload');
    messageIndex++;
    return payload;
  }

  // -> s, se
  Uint8List _writeMsg3(List<int> payload) {
    final parts = <List<int>>[encryptAndHash(sPublic, 'e3:s')];

    mixKey(dh(sSecret, re!), 'e3:se'); // DH(s_i, e_r)
    parts.add(encryptAndHash(payload, 'e3:payload'));

    messageIndex++;
    _finish();
    return concatBytes(parts);
  }

  Uint8List _readMsg3(List<int> buf) {
    var offset = 0;
    final encryptedStatic = buf.sublist(offset, offset + kDhLen + kTagLen);
    offset += kDhLen + kTagLen;
    rs = decryptAndHash(encryptedStatic, 'e3:s');

    mixKey(dh(eSecret!, rs!), 'e3:se'); // DH(s_i, e_r)

    final payload = decryptAndHash(buf.sublist(offset), 'e3:payload');
    messageIndex++;
    _finish();
    return payload;
  }
}

// ---------------------------------------------------------------------------
// Application bindings
// ---------------------------------------------------------------------------

/// prologue = utf8("dsh-remote/v1/pair:" + sid)
Uint8List prologueForSession(String sid) =>
    utf8Bytes('dsh-remote/v1/pair:$sid');

/// SAS = be_u64(SHA256(handshakeHash || initiatorStaticPub || responderStaticPub)[0..8])
///       mod 10^6, zero-padded to 6 decimal digits.
String deriveSas(
  List<int> handshakeHash,
  List<int> initiatorStaticPub,
  List<int> responderStaticPub,
) {
  final digest = sha256(concatBytes([
    handshakeHash,
    initiatorStaticPub,
    responderStaticPub,
  ]));
  var v = BigInt.zero;
  for (var i = 0; i < 8; i++) {
    v = (v << 8) | BigInt.from(digest[i]);
  }
  final n = v % BigInt.from(1000000);
  return n.toString().padLeft(6, '0');
}
