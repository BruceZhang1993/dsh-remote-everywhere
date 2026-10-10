// ignore_for_file: avoid_print  // scratch CLI probe
// Scratch probe: observe raw behaviour of the candidate crypto packages.
// Not part of the test suite.
import 'dart:convert';
import 'dart:typed_data';

import 'package:cryptography/cryptography.dart';
import 'package:cryptography/dart.dart';
import 'package:pointycastle/export.dart' as pc;

String hex(List<int> b) =>
    b.map((e) => e.toRadixString(16).padLeft(2, '0')).join();

Future<void> main() async {
  final abc = utf8.encode('abc');
  print('--- BLAKE2s abc ---');
  print('Blake2s().hash        : ${hex((await Blake2s().hash(abc)).bytes)}');
  print('DartBlake2s().hashSync: ${hex(const DartBlake2s().hashSync(abc).bytes)}');

  print('--- keyed BLAKE2s (native MAC) key=bytes(0..31) msg=abc ---');
  final key32 = List<int>.generate(32, (i) => i);
  final mac = await Blake2s().calculateMac(abc, secretKey: SecretKey(key32));
  print('Blake2s().calculateMac: ${hex(mac.bytes)}');

  print('--- HMAC-BLAKE2s key="secret" msg=abc ---');
  print('Hmac.blake2s()        : '
      '${hex((await Hmac.blake2s().calculateMac(abc, secretKey: SecretKey(utf8.encode('secret')))).bytes)}');
  print('DartHmac(Blake2s())   : '
      '${hex(DartHmac(Blake2s()).calculateMacSync(abc, secretKeyData: SecretKeyData(utf8.encode('secret')), nonce: const []).bytes)}');

  print('--- manual RFC2104 HMAC-BLAKE2s, B=64, key="secret" msg=abc ---');
  print(hex(await manualHmacBlake2s(utf8.encode('secret'), abc)));

  print('--- X25519 RFC 7748 6.1 ---');
  final x = X25519();
  final a = await x.newKeyPairFromSeed(hexDecode(
      '77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a'));
  print('alice pub: ${hex((await a.extractPublicKey()).bytes)}');

  print('--- X25519 low-order points ---');
  for (final entry in <String, String>{
    'u=0': '00' * 32,
    'u=1': '01${'00' * 31}',
    'e0eb..00': 'e0eb7a7c3b41b8ae1656e3faf19fc46ada098deb9c32b1fd866205165f49b800',
    '5f9c..57': '5f9c95bca3508c24b1d0b1559c83ef5b04445cc4581c8e86d8224eddd09f1157',
    'p-1': 'ec${'ff' * 30}7f',
    'p': 'ed${'ff' * 30}7f',
    'p+1': 'ee${'ff' * 30}7f',
  }.entries) {
    final u = hexDecode(entry.value);
    try {
      final s = await x.sharedSecretKey(
        keyPair: a,
        remotePublicKey: SimplePublicKey(u, type: KeyPairType.x25519),
      );
      final bytes = await s.extractBytes();
      print('  ${entry.key.padRight(10)} -> ${hex(bytes)}'
          '${bytes.every((e) => e == 0) ? '  <-- ALL ZERO' : ''}');
    } catch (e) {
      print('  ${entry.key.padRight(10)} -> THREW ${e.runtimeType}: $e');
    }
  }

  print('--- ChaCha20-Poly1305 with Noise nonce (4 zero || LE64(1)) ---');
  final c = Chacha20.poly1305Aead();
  final n = Uint8List(12);
  n[4] = 1;
  final box = await c.encrypt(
    utf8.encode('hello noise'),
    secretKey: SecretKey(List<int>.filled(32, 0x1c)),
    nonce: n,
    aad: utf8.encode('aad'),
  );
  print('nonce: ${hex(n)}');
  print('ct   : ${hex(box.cipherText)}');
  print('tag  : ${hex(box.mac.bytes)}');

  print('--- pointycastle 4.0.0 SHA-256 abc ---');
  final d = pc.SHA256Digest()..update(abc, 0, abc.length);
  final o = Uint8List(32);
  d.doFinal(o, 0);
  print(hex(o));
}

Future<List<int>> manualHmacBlake2s(List<int> key, List<int> msg) async {
  var k = Uint8List.fromList(key);
  if (k.length > 64) {
    k = Uint8List.fromList((await Blake2s().hash(k)).bytes);
  }
  final ipad = Uint8List(64)..fillRange(0, 64, 0x36);
  final opad = Uint8List(64)..fillRange(0, 64, 0x5c);
  for (var i = 0; i < k.length; i++) {
    ipad[i] ^= k[i];
    opad[i] ^= k[i];
  }
  final inner = Blake2s().toSync().newHashSink()
    ..add(ipad)
    ..add(msg)
    ..close();
  final innerDigest = inner.hashBytes;
  final outer = Blake2s().toSync().newHashSink()
    ..add(opad)
    ..add(innerDigest)
    ..close();
  return outer.hashBytes;
}

Uint8List hexDecode(String s) {
  final out = Uint8List(s.length ~/ 2);
  for (var i = 0; i < out.length; i++) {
    out[i] = int.parse(s.substring(i * 2, i * 2 + 2), radix: 16);
  }
  return out;
}
