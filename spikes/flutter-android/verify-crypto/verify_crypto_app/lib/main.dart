// Minimal Android harness for the crypto verification spike.
//
// It deliberately calls into every primitive the Noise implementation needs so
// that `flutter build apk` must actually compile (and AOT-link) the packages
// rather than tree-shaking them away.
import 'package:cryptography/cryptography.dart';
import 'package:cryptography/dart.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

void main() => runApp(const VerifyCryptoApp());

class VerifyCryptoApp extends StatelessWidget {
  const VerifyCryptoApp({super.key});

  @override
  Widget build(BuildContext context) {
    return const MaterialApp(
      home: Scaffold(body: Center(child: _SelfTest())),
    );
  }
}

class _SelfTest extends StatefulWidget {
  const _SelfTest();

  @override
  State<_SelfTest> createState() => _SelfTestState();
}

class _SelfTestState extends State<_SelfTest> {
  String _result = 'running...';

  @override
  void initState() {
    super.initState();
    _run().then((r) => setState(() => _result = r));
  }

  Future<String> _run() async {
    final lines = <String>[];

    // 1. BLAKE2s-256 of "abc".
    final blake2s = (await Blake2s().hash('abc'.codeUnits)).bytes;
    lines.add('blake2s("abc") ${_hex(blake2s)}');

    // 2. Keyed BLAKE2s (native MAC mode).
    final keyed = await Blake2s().calculateMac(
      'abc'.codeUnits,
      secretKey: SecretKey(List<int>.generate(32, (i) => i)),
    );
    lines.add('keyed blake2s ${_hex(keyed.bytes)}');

    // 3. HMAC (needed for Noise's HMAC-HASH).
    final mac = await Hmac.sha256()
        .calculateMac('abc'.codeUnits, secretKey: SecretKey('k'.codeUnits));
    lines.add('hmac-sha256 ${_hex(mac.bytes)}');

    // 4. HKDF.
    final okm = await Hkdf(hmac: Hmac.sha256(), outputLength: 32)
        .deriveKey(secretKey: SecretKey('ikm'.codeUnits), nonce: const <int>[]);
    lines.add('hkdf ${_hex(await okm.extractBytes())}');

    // 5. X25519 (RFC 7748 6.1).
    final x = X25519();
    final alice = await x.newKeyPairFromSeed(_unhex(
        '77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a'));
    final bobPub = SimplePublicKey(
      _unhex('de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f'),
      type: KeyPairType.x25519,
    );
    final shared = await x
        .sharedSecretKey(keyPair: alice, remotePublicKey: bobPub)
        .then((s) => s.extractBytes());
    lines.add('x25519 ${_hex(shared)}');

    // 6. ChaCha20-Poly1305 with the Noise nonce (4 zero bytes || LE64(counter)).
    final nonce = Uint8List(12)..[4] = 1; // counter = 1, little endian
    final box = await Chacha20.poly1305Aead().encrypt(
      'hello noise'.codeUnits,
      secretKey: SecretKey(List<int>.filled(32, 0x1c)),
      nonce: nonce,
      aad: 'aad'.codeUnits,
    );
    lines.add('chacha ct ${_hex(box.cipherText)}');
    lines.add('chacha tag ${_hex(box.mac.bytes)}');

    // 7. SHA-256 for the SAS derivation.
    lines.add(
        'sha256("abc") ${_hex((await Sha256().hash('abc'.codeUnits)).bytes)}');

    // 8. Synchronous Dart-only entry points (what packages/core will use).
    lines.add(
        'sync blake2s ${_hex(const DartBlake2s().hashSync('abc'.codeUnits).bytes)}');

    // Also push the results to logcat (`adb logcat -s flutter`) so the spike can
    // be verified on a real Android device without reading pixels.
    for (final line in lines) {
      debugPrint('VERIFY_CRYPTO_ANDROID $line');
    }
    debugPrint('VERIFY_CRYPTO_ANDROID DONE lines=${lines.length}');
    return lines.join('\n');
  }

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: SelectableText(
        _result,
        style: const TextStyle(fontFamily: 'monospace', fontSize: 11),
      ),
    );
  }
}

String _hex(List<int> b) =>
    b.map((e) => e.toRadixString(16).padLeft(2, '0')).join();

Uint8List _unhex(String s) {
  final out = Uint8List(s.length ~/ 2);
  for (var i = 0; i < out.length; i++) {
    out[i] = int.parse(s.substring(i * 2, i * 2 + 2), radix: 16);
  }
  return out;
}
