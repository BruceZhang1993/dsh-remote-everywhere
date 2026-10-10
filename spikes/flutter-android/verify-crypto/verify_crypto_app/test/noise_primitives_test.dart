// Verification of every primitive needed by
// `Noise_XX_25519_ChaChaPoly_BLAKE2s`, for the toolchain
// Flutter 3.47.7 / Dart 3.13.5 + cryptography 2.9.0 + pointycastle 4.0.0.
//
// Deliberately imports ONLY `package:test` + `package:cryptography` +
// `package:pointycastle` — no Flutter — so that `dart test` works inside
// `packages/core`.
//
// Reference values in `reference_vectors.dart` are generated independently by
// CPython hashlib/hmac (OpenSSL) and pyca/cryptography; see
// `tool/gen_reference_vectors.py`. Published RFC vectors are inlined here.
//
// Run:  flutter test test/noise_primitives_test.dart
//       dart    test test/noise_primitives_test.dart
import 'dart:convert';
import 'dart:typed_data';

import 'package:cryptography/cryptography.dart';
import 'package:cryptography/dart.dart';
import 'package:pointycastle/export.dart' as pc;
import 'package:test/test.dart';

import 'reference_vectors.dart';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

String hex(List<int> bytes) =>
    bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();

Uint8List unhex(String s) {
  final out = Uint8List(s.length ~/ 2);
  for (var i = 0; i < out.length; i++) {
    out[i] = int.parse(s.substring(i * 2, i * 2 + 2), radix: 16);
  }
  return out;
}

/// Deterministic test input; must match `pattern()` in the Python generator.
Uint8List pattern(int n) =>
    Uint8List.fromList(List<int>.generate(n, (i) => (i * 7 + 11) % 251));

/// In-memory record of every vector outcome, dumped at the end of the run.
final List<String> vectorLog = <String>[];

void checkHex(String label, List<int> actual, String expectedHex) {
  final actualHex = hex(actual);
  final ok = actualHex == expectedHex;
  vectorLog.add(
      '${ok ? 'PASS' : 'FAIL'}  $label\n        expected $expectedHex\n'
      '        actual   $actualHex');
  expect(actualHex, expectedHex, reason: label);
}

void record(String label, String detail) {
  vectorLog.add('NOTE  $label\n        $detail');
}

// ---------------------------------------------------------------------------
// Correct HMAC built on Blake2s / Blake2b primitives.
//
// The Noise Protocol Framework's HMAC-HASH is textbook RFC 2104 HMAC, i.e. the
// key must be padded to the *compression block size* of the hash:
//   BLAKE2s -> 64 bytes      BLAKE2b -> 128 bytes
// ---------------------------------------------------------------------------

List<int> _hmac(
  List<int> key,
  List<int> message, {
  required int blockSize,
  required List<int> Function(List<int>) hash,
}) {
  var k = Uint8List.fromList(key);
  if (k.length > blockSize) {
    k = Uint8List.fromList(hash(k));
  }
  final ipad = Uint8List(blockSize)..fillRange(0, blockSize, 0x36);
  final opad = Uint8List(blockSize)..fillRange(0, blockSize, 0x5c);
  for (var i = 0; i < k.length; i++) {
    ipad[i] ^= k[i];
    opad[i] ^= k[i];
  }
  final inner = hash(<int>[...ipad, ...message]);
  return hash(<int>[...opad, ...inner]);
}

List<int> _blake2sSync(List<int> m) => const DartBlake2s().hashSync(m).bytes;
List<int> _blake2bSync(List<int> m) => const DartBlake2b().hashSync(m).bytes;

/// RFC 2104 HMAC-BLAKE2s with the correct B = 64 block size.
List<int> hmacBlake2s(List<int> key, List<int> message) =>
    _hmac(key, message, blockSize: 64, hash: _blake2sSync);

/// RFC 2104 HMAC-BLAKE2b with the correct B = 128 block size.
List<int> hmacBlake2b(List<int> key, List<int> message) =>
    _hmac(key, message, blockSize: 128, hash: _blake2bSync);

/// Noise `HKDF(chaining_key, input_key_material)`, 2 outputs of HASHLEN bytes.
/// When [truncateTo] is set (Noise's HASHLEN = 64 rule) every HMAC output is
/// cut to that many bytes *before* being used for chaining and as output.
List<List<int>> noiseHkdf(
  List<int> chainingKey,
  List<int> inputKeyMaterial, {
  required int hashlength,
  required bool hashelenIs64,
}) {
  List<int> mac(List<int> key, List<int> msg) {
    final full = hashlength == 32
        ? hmacBlake2s(key, msg)
        : hmacBlake2b(key, msg);
    return hashelenIs64 ? full.sublist(0, 32) : full;
  }

  final tempKey = mac(chainingKey, inputKeyMaterial);
  final output1 = mac(tempKey, const <int>[0x01]);
  final output2 = mac(tempKey, <int>[...output1, 0x02]);
  return <List<int>>[output1, output2];
}

// ---------------------------------------------------------------------------
// Noise AEAD nonce: 4 zero bytes || LE64(counter), 12 bytes total.
// ---------------------------------------------------------------------------

Uint8List noiseNonce(int counter) {
  final nonce = Uint8List(12);
  ByteData.view(nonce.buffer).setUint64(4, counter & 0xffffffffffffffff,
      Endian.little);
  return nonce;
}

// ===========================================================================

void main() {
  tearDownAll(() {
    // ignore: avoid_print
    print('\n================ VECTOR LOG ================');
    for (final line in vectorLog) {
      // ignore: avoid_print
      print(line);
    }
    // ignore: avoid_print
    print('============================================');
  });

  group('1. BLAKE2s-256 (Noise HASH / HMAC base)', () {
    test('published BLAKE2s-256("abc") vector', () async {
      checkHex('Blake2s().hash("abc")', (await Blake2s().hash(utf8.encode('abc'))).bytes,
          blake2sAbcRef);
      checkHex('DartBlake2s().hashSync("abc")',
          const DartBlake2s().hashSync(utf8.encode('abc')).bytes, blake2sAbcRef);
      expect(blake2sAbcRef,
          '508c5e8c327c14e2e1a72ba34eeb452f37458b209ed63a294d999b4c86675982');
    });

    test('boundary lengths vs independent reference (OpenSSL)', () async {
      for (final n in blake2sRef.keys) {
        final msg = pattern(n);
        checkHex('Blake2s($n bytes)', (await Blake2s().hash(msg)).bytes,
            blake2sRef[n]!);
        checkHex('DartBlake2s($n bytes)',
            const DartBlake2s().hashSync(msg).bytes, blake2sRef[n]!);
      }
    });

    test('keyed BLAKE2s (BLAKE2s native keyed mode, NOT HMAC)', () async {
      final key = Uint8List.fromList(List<int>.generate(32, (i) => i));
      for (final n in keyedBlake2sRef.keys) {
        final mac = await Blake2s()
            .calculateMac(pattern(n), secretKey: SecretKey(key));
        checkHex('keyed Blake2s($n bytes)', mac.bytes, keyedBlake2sRef[n]!);
      }
    });
  });

  group('2. HMAC-BLAKE2s (Noise HMAC-HASH)', () {
    test('manual RFC 2104 HMAC (B=64) matches independent reference', () {
      final key = utf8.encode('secret');
      checkHex('HMAC-BLAKE2s("secret", "abc")', hmacBlake2s(key, utf8.encode('abc')),
          hmacBlake2sSecretAbcRef);
      final k32 = Uint8List.fromList(List<int>.generate(32, (i) => i));
      checkHex('HMAC-BLAKE2s(key32, "abc")', hmacBlake2s(k32, utf8.encode('abc')),
          hmacBlake2sKey32AbcRef);
      final k100 = Uint8List.fromList(List<int>.generate(100, (i) => i));
      checkHex('HMAC-BLAKE2s(key100, "abc")',
          hmacBlake2s(k100, utf8.encode('abc')), hmacBlake2sKey100AbcRef);
      for (final n in hmacBlake2sKey32Ref.keys) {
        checkHex('HMAC-BLAKE2s(key32, $n bytes)', hmacBlake2s(k32, pattern(n)),
            hmacBlake2sKey32Ref[n]!);
      }
    });

    test('HEADLINE: Hmac.blake2s() is NOT RFC 2104 HMAC (B=32 not 64)', () async {
      final actual = (await Hmac.blake2s()
              .calculateMac(utf8.encode('abc'),
                  secretKey: SecretKey(utf8.encode('secret'))))
          .bytes;
      final actualHex = hex(actual);
      record(
        'Hmac.blake2s() is non-standard',
        'RFC 2104 HMAC-BLAKE2s (B=64, OpenSSL/interop) = $hmacBlake2sSecretAbcRef\n'
        '        package:cryptography Hmac.blake2s()        = $actualHex\n'
        '        => cryptography pads the key to 32 bytes (Blake2s.blockLengthInBytes\n'
        '           == 32, i.e. the DIGEST length) instead of the real 64-byte BLAKE2s\n'
        '           compression block. Non-interoperable with every other Noise stack.',
      );
      // Characterisation, not approval: pin the exact (wrong) value so a future
      // package upgrade that fixes the block size fails this test loudly.
      expect(actualHex, hmacEmulBlake2sB32SecretAbcRef,
          reason: 'cryptography Hmac(Blake2s()) behaviour changed - re-evaluate!');
      expect(actualHex, isNot(hmacBlake2sSecretAbcRef),
          reason: 'if these ever match, Hmac.blake2s() became RFC-compliant');
      expect(Blake2s().blockLengthInBytes, 32,
          reason: 'root cause: BLAKE2s block size misreported');
    });

    test('HEADLINE: Hmac.blake2b() is also NOT RFC 2104 HMAC (B=64 not 128)',
        () async {
      final actual = (await Hmac.blake2b()
              .calculateMac(utf8.encode('abc'),
                  secretKey: SecretKey(utf8.encode('secret'))))
          .bytes;
      final actualHex = hex(actual);
      record(
        'Hmac.blake2b() is non-standard',
        'RFC 2104 HMAC-BLAKE2b (B=128)        = $hmacBlake2bSecretAbcRef\n'
        '        package:cryptography Hmac.blake2b() = $actualHex',
      );
      expect(actualHex, hmacEmulBlake2bB64SecretAbcRef);
      expect(actualHex, isNot(hmacBlake2bSecretAbcRef));
      expect(Blake2b().blockLengthInBytes, 64);
    });
  });

  group('3. HKDF', () {
    test('package Hkdf matches RFC 5869 TC1 given a standard HMAC', () async {
      final hkdf = Hkdf(hmac: Hmac.sha256(), outputLength: 42);
      final okm = await hkdf.deriveKey(
        secretKey: SecretKey(unhex('0b' * 22)),
        nonce: unhex('000102030405060708090a0b0c'),
        info: unhex('f0f1f2f3f4f5f6f7f8f9'),
      );
      final bytes = await okm.extractBytes();
      checkHex(
        'Hkdf(Hmac.sha256, 42) RFC 5869 TC1',
        bytes,
        '3cb25f25faacd57a90434f64d0362f2a'
        '2d2d0a90cf1a5a4c5db02d56ecc4c5bf'
        '34007208d5b887185865',
      );
    });

    test('Hkdf(Hmac.blake2s) reproduces the non-standard HMAC (characterisation)',
        () async {
      final okm = await Hkdf(hmac: Hmac.blake2s(), outputLength: 32).deriveKey(
        secretKey: SecretKey(unhex(hkdfIkmHex)),
        nonce: unhex(hkdfSaltHex),
        info: unhex(hkdfInfoHex),
      );
      final bytes = await okm.extractBytes();
      checkHex('Hkdf(Hmac.blake2s, 32)', bytes, hkdfOkm32EmulBlake2sB32Ref);
      expect(hex(bytes), isNot(hkdfOkm32Blake2sRef));
      record('Hkdf(Hmac.blake2s) unusable for Noise',
          'expected (RFC 2104 HMAC-BLAKE2s) $hkdfOkm32Blake2sRef\n'
          '        actual   (cryptography B=32)    ${hex(bytes)}');
    });

    test('Hkdf(Hmac.sha256) 32/42 byte output lengths work', () async {
      for (final n in <int>[32, 42, 64, 100]) {
        final okm = await Hkdf(hmac: Hmac.sha256(), outputLength: n).deriveKey(
          secretKey: SecretKey(utf8.encode('ikm')),
          nonce: utf8.encode('salt'),
          info: utf8.encode('info'),
        );
        expect((await okm.extractBytes()).length, n);
      }
    });

    test('Noise HKDF, HASHLEN=32 (BLAKE2s) - no truncation', () {
      final out = noiseHkdf(unhex(noiseHkdfCkHex), utf8.encode(noiseHkdfIkm),
          hashlength: 32, hashelenIs64: false);
      checkHex('Noise HKDF/HASHLEN=32 output1', out[0], noiseHkdfBlake2sO1Ref);
      checkHex('Noise HKDF/HASHLEN=32 output2', out[1], noiseHkdfBlake2sO2Ref);
    });

    test('Noise HKDF, HASHLEN=64 (BLAKE2b) - outputs truncated to 32 bytes', () {
      final truncated = noiseHkdf(
          unhex(noiseHkdfCkHex), utf8.encode(noiseHkdfIkm),
          hashlength: 64, hashelenIs64: true);
      checkHex('Noise HKDF/HASHLEN=64 truncated output1', truncated[0],
          noiseHkdfBlake2bTruncO1Ref);
      checkHex('Noise HKDF/HASHLEN=64 truncated output2', truncated[1],
          noiseHkdfBlake2bTruncO2Ref);
      expect(truncated[0].length, 32);
      expect(truncated[1].length, 32);

      final untruncated = noiseHkdf(
          unhex(noiseHkdfCkHex), utf8.encode(noiseHkdfIkm),
          hashlength: 64, hashelenIs64: false);
      expect(untruncated[0].length, 64);
      checkHex('Noise HKDF/HASHLEN=64 untruncated output1', untruncated[0],
          noiseHkdfBlake2bFullO1Ref);
      record('HASHLEN=64 supported',
          'Blake2b primitives allow both the untruncated 64-byte output and the\n'
          '        Noise 32-byte-truncated variant; only truncation is Noise-correct.');
    });
  });

  group('4. X25519 (RFC 7748)', () {
    const alicePrivHex =
        '77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a';
    const bobPrivHex =
        '5dab087e624a8a4b79e17f8b83800ee66f3bb1292618b6fd1c2f8b27ff88e0eb';
    const alicePubHex =
        '8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a';
    const bobPubHex =
        'de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f';
    const sharedHex =
        '4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742';

    final x = X25519();

    test('RFC 7748 6.1 key exchange (Alice/Bob)', () async {
      final alice = await x.newKeyPairFromSeed(unhex(alicePrivHex));
      final bob = await x.newKeyPairFromSeed(unhex(bobPrivHex));
      checkHex('alice public key', (await alice.extractPublicKey()).bytes, alicePubHex);
      checkHex('bob public key', (await bob.extractPublicKey()).bytes, bobPubHex);

      final s1 = await x.sharedSecretKey(
        keyPair: alice,
        remotePublicKey: SimplePublicKey(unhex(bobPubHex),
            type: KeyPairType.x25519),
      );
      final s2 = await x.sharedSecretKey(
        keyPair: bob,
        remotePublicKey: SimplePublicKey(unhex(alicePubHex),
            type: KeyPairType.x25519),
      );
      checkHex('alice shared secret', await s1.extractBytes(), sharedHex);
      checkHex('bob shared secret', await s2.extractBytes(), sharedHex);
    });

    test('RFC 7748 5.2 single-shot vectors', () {
      const vectors = <List<String>>[
        <String>[
          'a546e36bf0527c9d3b16154b82465edd62144c0ac1fc5a18506a2244ba449ac4',
          'e6db6867583030db3594c1a424b15f7c726624ec26b3353b10a903a6d0ab1c4c',
          'c3da55379de9c6908e94ea4df28d084f32eccf03491c71f754b4075577a28552',
        ],
        <String>[
          '4b66e9d4d1b4673c5ad22691957d6af5c11b6421e0ea01d42ca4169e7918ba0d',
          'e5210f12786811d3f4b7959d0538ae2c31dbe7106fc03c3efc4cd549c715a493',
          '95cbde9476e8907d7aade45cb4b873f88b595a68799fa152e6f8f7647aac7957',
        ],
      ];
      for (var i = 0; i < vectors.length; i++) {
        final v = vectors[i];
        checkHex(
          'RFC 7748 5.2 vector ${i + 1}',
          _x25519Raw(unhex(v[0]), unhex(v[1])),
          v[2],
        );
      }
    });

    test('RFC 7748 5.2 iterated test (1 and 1000 iterations)', () {
      var k = unhex('0900${'00' * 30}');
      var u = Uint8List.fromList(k);
      for (var i = 1; i <= 1000; i++) {
        final r = _x25519Raw(k, u);
        u = k;
        k = Uint8List.fromList(r);
        if (i == 1) {
          checkHex('iterated x25519, 1 iteration', k,
              '422c8e7a6227d7bca1350b3e2bb7279f7897b87bb6854b783c60e80311ae3079');
        }
      }
      checkHex('iterated x25519, 1000 iterations', k,
          '684cf59ba83309552800ef566f2f4d3c1c3887c49360e3875f2eb94d99532c51');
    });

    test('HEADLINE: low-order / all-zero shared secrets are NOT rejected',
        () async {
      final alice = await x.newKeyPairFromSeed(unhex(alicePrivHex));
      final log = <String>[];
      var silentZeros = 0;
      var threw = 0;
      for (final entry in _lowOrderPoints.entries) {
        final u = unhex(entry.value);
        try {
          final s = await x.sharedSecretKey(
            keyPair: alice,
            remotePublicKey: SimplePublicKey(u, type: KeyPairType.x25519),
          );
          final bytes = await s.extractBytes();
          final allZero = bytes.every((b) => b == 0);
          if (allZero) silentZeros++;
          log.add('  ${entry.key.padRight(34)} -> ${hex(bytes)}'
              '${allZero ? '   <-- ALL ZERO, silently returned' : ''}');
        } on Object catch (e) {
          threw++;
          log.add('  ${entry.key.padRight(34)} -> THREW ${e.runtimeType}');
        }
      }
      record(
        'X25519 has no low-order point check',
        'libsodium/pyca reject these 7 u-coordinates outright; cryptography 2.9.0\n'
        '        returns the all-zero shared secret with no error:\n${log.join('\n')}',
      );
      // Every one of these u-coordinates is order <= 8 (independently confirmed
      // with a from-scratch RFC 7748 ladder in Python): the raw X25519 function
      // yields 0^32. That is what must be detected by the caller.
      expect(silentZeros, _lowOrderPoints.length,
          reason: 'DartX25519 must return all-zero for these low-order points');
      expect(threw, 0,
          reason: 'DartX25519 performs no low-order rejection at all');
      record('Mitigation is mandatory',
          'Noise_XX must call sharedSecretKey() and then reject an all-zero\n'
          '        result (and reject a non-contributory remote static key) itself.');
    });

    test('mitigation helper detects the all-zero shared secret', () async {
      final alice = await x.newKeyPairFromSeed(unhex(alicePrivHex));
      final s = await x.sharedSecretKey(
        keyPair: alice,
        remotePublicKey:
            SimplePublicKey(unhex(_lowOrderPoints['u = 0']!), type: KeyPairType.x25519),
      );
      expect(_isAllZero(await s.extractBytes()), isTrue);

      final good = await x.sharedSecretKey(
        keyPair: alice,
        remotePublicKey:
            SimplePublicKey(unhex(bobPubHex), type: KeyPairType.x25519),
      );
      expect(_isAllZero(await good.extractBytes()), isFalse);
    });
  });

  group('5. ChaCha20-Poly1305 AEAD', () {
    final aead = Chacha20.poly1305Aead();

    test('RFC 8439 2.8.2 published vector', () async {
      final key = unhex(rfc8439KeyHex);
      final nonce = unhex(rfc8439NonceHex);
      final aad = unhex(rfc8439AadHex);
      final plaintext = unhex(rfc8439PlaintextHex);

      final box = await aead.encrypt(plaintext,
          secretKey: SecretKey(key), nonce: nonce, aad: aad);
      checkHex('RFC 8439 ciphertext', box.cipherText, rfc8439CiphertextHex);
      checkHex('RFC 8439 tag', box.mac.bytes, rfc8439TagHex);

      final clear = await aead.decrypt(
        SecretBox(box.cipherText, nonce: nonce, mac: box.mac),
        secretKey: SecretKey(key),
        aad: aad,
      );
      expect(hex(clear), rfc8439PlaintextHex);
    });

    test('Noise 96-bit nonce (4 zero bytes || LE64(counter)) round trip', () async {
      final key = unhex(noiseAeadKeyHex);
      final aad = unhex(noiseAeadAadHex);
      final plaintext = unhex(noiseAeadPlaintextHex);
      for (final counter in <int>[0, 1, 2, 0x0102030405060708]) {
        final nonce = noiseNonce(counter);
        expect(nonce.length, 12);
        final box = await aead.encrypt(plaintext,
            secretKey: SecretKey(key), nonce: nonce, aad: aad);
        final ctRef = <int, String>{
          0: noiseCt0Hex,
          1: noiseCt1Hex,
          2: noiseCt2Hex,
          0x0102030405060708: noiseCt72623859790382856Hex,
        }[counter]!;
        final tagRef = <int, String>{
          0: noiseTag0Hex,
          1: noiseTag1Hex,
          2: noiseTag2Hex,
          0x0102030405060708: noiseTag72623859790382856Hex,
        }[counter]!;
        checkHex('Noise counter=$counter ciphertext', box.cipherText, ctRef);
        checkHex('Noise counter=$counter tag', box.mac.bytes, tagRef);
        checkHex(
            'Noise counter=$counter nonce bytes',
            nonce,
            <int, String>{
              0: noiseNonce0Hex,
              1: noiseNonce1Hex,
              2: noiseNonce2Hex,
              0x0102030405060708: noiseNonce72623859790382856Hex,
            }[counter]!);

        final clear = await aead.decrypt(
          SecretBox(box.cipherText, nonce: nonce, mac: box.mac),
          secretKey: SecretKey(key),
          aad: aad,
        );
        expect(hex(clear), noiseAeadPlaintextHex);
      }
    });

    test('pointycastle ChaCha20-Poly1305 agrees (second implementation)',
        () async {
      final key = unhex(noiseAeadKeyHex);
      final aad = unhex(noiseAeadAadHex);
      final plaintext = unhex(noiseAeadPlaintextHex);
      final nonce = noiseNonce(1);
      final box = await aead.encrypt(plaintext,
          secretKey: SecretKey(key), nonce: nonce, aad: aad);

      // pointycastle buffers the final partial block, so `process()` alone is
      // NOT enough: processBytes() must be followed by doFinal().
      final cipher = pc.ChaCha20Poly1305(pc.ChaCha7539Engine(), pc.Poly1305())
        ..init(true, pc.AEADParameters(pc.KeyParameter(key), 128, nonce, aad));
      final buf = Uint8List(cipher.getOutputSize(plaintext.length));
      var len = cipher.processBytes(plaintext, 0, plaintext.length, buf, 0);
      len += cipher.doFinal(buf, len);
      final pcCt = buf.sublist(0, plaintext.length);
      final pcTag = buf.sublist(plaintext.length, len);
      checkHex('pointycastle ciphertext', pcCt, hex(box.cipherText));
      checkHex('pointycastle tag', pcTag, hex(box.mac.bytes));
      checkHex('pointycastle tag vs Python reference', pcTag, noiseTag1Hex);
      record(
        'pointycastle AEAD API caveat',
        'ChaCha20Poly1305.process() returns a zero-padded tail; the final partial\n'
        '        block and the MAC only materialise after doFinal(). Not on our path\n'
        '        (cryptography owns the AEAD) but a sharp edge to know about.',
      );
    });

    test('negative: tampered ciphertext fails authentication', () async {
      final key = SecretKey(unhex(noiseAeadKeyHex));
      final aad = unhex(noiseAeadAadHex);
      final nonce = noiseNonce(0);
      final box = await aead.encrypt(unhex(noiseAeadPlaintextHex),
          secretKey: key, nonce: nonce, aad: aad);
      final ct = Uint8List.fromList(box.cipherText);
      ct[5] ^= 0x01;
      await expectLater(
        aead.decrypt(SecretBox(ct, nonce: nonce, mac: box.mac),
            secretKey: key, aad: aad),
        throwsA(isA<SecretBoxAuthenticationError>()),
      );
    });

    test('negative: tampered associated data fails authentication', () async {
      final key = SecretKey(unhex(noiseAeadKeyHex));
      final aad = unhex(noiseAeadAadHex);
      final nonce = noiseNonce(0);
      final box = await aead.encrypt(unhex(noiseAeadPlaintextHex),
          secretKey: key, nonce: nonce, aad: aad);
      final badAad = Uint8List.fromList(aad);
      badAad[0] ^= 0x80;
      await expectLater(
        aead.decrypt(
            SecretBox(box.cipherText, nonce: nonce, mac: box.mac),
            secretKey: key,
            aad: badAad),
        throwsA(isA<SecretBoxAuthenticationError>()),
      );
    });

    test('negative: tampered MAC fails authentication', () async {
      final key = SecretKey(unhex(noiseAeadKeyHex));
      final aad = unhex(noiseAeadAadHex);
      final nonce = noiseNonce(0);
      final box = await aead.encrypt(unhex(noiseAeadPlaintextHex),
          secretKey: key, nonce: nonce, aad: aad);
      final macBytes = Uint8List.fromList(box.mac.bytes);
      macBytes[15] ^= 0xff;
      await expectLater(
        aead.decrypt(
            SecretBox(box.cipherText, nonce: nonce, mac: Mac(macBytes)),
            secretKey: key,
            aad: aad),
        throwsA(isA<SecretBoxAuthenticationError>()),
      );
    });

    test('negative: wrong nonce/counter fails authentication', () async {
      final key = SecretKey(unhex(noiseAeadKeyHex));
      final aad = unhex(noiseAeadAadHex);
      final box = await aead.encrypt(unhex(noiseAeadPlaintextHex),
          secretKey: key, nonce: noiseNonce(0), aad: aad);
      await expectLater(
        aead.decrypt(
            SecretBox(box.cipherText, nonce: noiseNonce(1), mac: box.mac),
            secretKey: key,
            aad: aad),
        throwsA(isA<SecretBoxAuthenticationError>()),
      );
    });
  });

  group('6. SHA-256 (SAS derivation)', () {
    test('known vectors and independent references', () async {
      checkHex('SHA-256("abc")', (await Sha256().hash(utf8.encode('abc'))).bytes,
          'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
      checkHex(
          'SHA-256("")',
          (await Sha256().hash(const <int>[])).bytes,
          'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
      for (final n in sha256Ref.keys) {
        checkHex('SHA-256($n bytes)', (await Sha256().hash(pattern(n))).bytes,
            sha256Ref[n]!);
      }
    });

    test('pointycastle SHA-256 agrees (second implementation)', () {
      for (final n in sha256Ref.keys) {
        final d = pc.SHA256Digest()..update(pattern(n), 0, n);
        final out = Uint8List(32);
        d.doFinal(out, 0);
        checkHex('pointycastle SHA-256($n bytes)', out, sha256Ref[n]!);
      }
    });
  });

  group('7. Package surface (does pointycastle add anything we need?)', () {
    test('pointycastle has no BLAKE2s; cryptography covers all primitives', () {
      // The absence of BLAKE2s in pointycastle 4.0.0 is a static/API fact; it is
      // recorded here because it invalidates the original package plan.
      record(
        'pointycastle 4.0.0 ships BLAKE2b only',
        'lib/digests/ contains blake2b.dart and no blake2s.dart; the registry\n'
        '        registers only Blake2bDigest. Blake2s must come from cryptography.',
      );
      expect(pc.SHA256Digest().algorithmName, 'SHA-256');
    });
  });
}

// ---------------------------------------------------------------------------
// X25519 raw scalar multiplication through the package's public API.
// ---------------------------------------------------------------------------

List<int> _x25519Raw(Uint8List scalar, Uint8List uCoordinate) {
  const algorithm = DartX25519();
  final result = algorithm.sharedSecretSync(
    keyPairData: SimpleKeyPairData(
      scalar,
      publicKey: SimplePublicKey(uCoordinate, type: KeyPairType.x25519),
      type: KeyPairType.x25519,
    ),
    remotePublicKey: SimplePublicKey(uCoordinate, type: KeyPairType.x25519),
  ) as SecretKeyData;
  return result.bytes;
}

bool _isAllZero(List<int> bytes) => bytes.every((b) => b == 0);

/// u-coordinates of order <= 8 (plus the equivalent curve representatives).
/// Independently confirmed to produce 0^32 from a from-scratch RFC 7748 ladder.
const Map<String, String> _lowOrderPoints = <String, String>{
  'u = 0': '0000000000000000000000000000000000000000000000000000000000000000',
  'u = 1': '0100000000000000000000000000000000000000000000000000000000000000',
  'order-8 point A':
      'e0eb7a7c3b41b8ae1656e3faf19fc46ada098deb9c32b1fd866205165f49b800',
  'order-8 point B':
      '5f9c95bca3508c24b1d0b1559c83ef5b04445cc4581c8e86d8224eddd09f1157',
  'p - 1':
      'ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f',
  'p (== 0 mod p)':
      'edffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f',
  'p + 1 (== 1 mod p)':
      'eeffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f',
};
