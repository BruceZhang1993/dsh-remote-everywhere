// Consumes the Node-produced determinism vectors and verifies every value
// byte-for-byte with the Dart implementation.
//
//   dart run bin/verify_vectors.dart [path/to/vectors.json]
//
// Default path: ../../vectors/xx25519-chachapoly-blake2s.json

import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:dsh_remote_core/noise_xx_blake2s.dart';

int failures = 0;
int checks = 0;

void check(String name, bool ok, [String detail = '']) {
  checks++;
  if (!ok) failures++;
  final status = ok ? 'ok  ' : 'FAIL';
  stdout.writeln('  [$status] $name${detail.isEmpty ? '' : ' :: $detail'}');
}

void section(String title) {
  stdout.writeln('\n$title');
}

Future<void> main(List<String> args) async {
  final scriptDir = File(Platform.script.toFilePath()).parent;
  final defaultPath = '${scriptDir.parent.parent.parent.path}/protocol/vectors/xx25519-chachapoly-blake2s.json';
  final path = args.isNotEmpty ? args[0] : defaultPath;
  final file = File(path);
  if (!file.existsSync()) {
    stderr.writeln('vector file not found: $path');
    stderr.writeln('run: (cd ../node && node src/emit-vectors.js)');
    exit(2);
  }

  stdout.writeln('noise-interop :: dart verify_vectors');
  stdout.writeln('  vectors: $path');

  final doc = jsonDecode(file.readAsStringSync()) as Map<String, dynamic>;

  // -------------------------------------------------------------------------
  section('[0] primitive known-answer tests (independent of the Node vectors)');

  // BLAKE2s-256("abc") — RFC 7693 / BLAKE2 reference.
  check(
    'BLAKE2s-256("abc") KAT',
    toHex(blake2sHash(utf8Bytes('abc'))) ==
        '508c5e8c327c14e2e1a72ba34eeb452f37458b209ed63a294d999b4c86675982',
    toHex(blake2sHash(utf8Bytes('abc'))),
  );

  // RFC 7748 section 6.1, first test vector.
  final rfcK = fromHex(
      'a546e36bf0527c9d3b16154b82465edd62144c0ac1fc5a18506a2244ba449ac4');
  final rfcU = fromHex(
      'e6db6867583030db3594c1a424b15f7c726624ec26b3353b10a903a6d0ab1c4c');
  check(
    'X25519 RFC 7748 6.1 vector 1',
    toHex(dh(rfcK, rfcU)) ==
        'c3da55379de9c6908e94ea4df28d084f32eccf03491c71f754b4075577a28552',
    toHex(dh(rfcK, rfcU)),
  );

  // RFC 7748 section 6.1, Alice/Bob key pairs and their shared secret. This
  // pins both the base-point public-key derivation and the DH.
  final alicePriv = fromHex(
      '77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a');
  final bobPriv = fromHex(
      '5dab087e624a8a4b79e17f8b83800ee66f3bb1292618b6fd1c2f8b27ff88e0eb');
  final alicePub = publicKeyFromSecret(alicePriv);
  final bobPub = publicKeyFromSecret(bobPriv);
  check(
    'X25519 RFC 7748 6.1 Alice public key (X25519(a, 9))',
    toHex(alicePub) ==
        '8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a',
    toHex(alicePub),
  );
  check(
    'X25519 RFC 7748 6.1 Bob public key (X25519(b, 9))',
    toHex(bobPub) ==
        'de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f',
    toHex(bobPub),
  );
  check(
    'X25519 RFC 7748 6.1 shared secret (both directions)',
    toHex(dh(alicePriv, bobPub)) ==
            '4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742' &&
        toHex(dh(bobPriv, alicePub)) ==
            '4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742',
    toHex(dh(alicePriv, bobPub)),
  );

  // RFC 8439 section 2.8.2 AEAD_CHACHA20_POLY1305 test vector. This validates
  // the cryptography AEAD glue (12-byte nonce + AAD + tag handling).
  final aeadKey = fromHex(
      '808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9f');
  final aeadNonce = fromHex('070000004041424344454647');
  final aeadAad = fromHex('50515253c0c1c2c3c4c5c6c7');
  final aeadPlain = utf8Bytes(
      "Ladies and Gentlemen of the class of '99: If I could offer you only one "
      'tip for the future, sunscreen would be it.');
  const aeadExpected =
      'd31a8d34648e60db7b86afbc53ef7ec2a4aded51296e08fea9e2b5a736ee62d6'
      '3dbea45e8ca9671282fafb69da92728b1a71de0a9e060b2905d6a5b67ecd3b36'
      '92ddbd7f2d778b8c9803aee328091b58fab324e4fad675945585808b4831d7bc'
      '3ff4def08e4b7a9de576d26586cec64b6116'
      '1ae10b594f09e26a7e902ecbd0600691';
  final aeadCipher = pcChacha20Poly1305(aeadKey, aeadNonce, aeadAad, aeadPlain);
  check('ChaCha20-Poly1305 RFC 8439 2.8.2 encrypt KAT',
      toHex(aeadCipher) == aeadExpected, toHex(aeadCipher).substring(0, 32) + '...');
  check('ChaCha20-Poly1305 RFC 8439 2.8.2 decrypt round-trip',
      toHex(pcChacha20Poly1305Decrypt(aeadKey, aeadNonce, aeadAad, aeadCipher)) ==
          toHex(aeadPlain));

  // -------------------------------------------------------------------------
  section('[1] deterministic vector sessions (Node -> Dart, byte-for-byte)');

  final sessions = doc['sessions'] as Map<String, dynamic>;
  final appStatics = doc['applicationBindings'] as Map<String, dynamic>;
  final iStaticPub = fromHex((appStatics['initiatorStatic'] as Map)['publicKey'] as String);
  final rStaticPub = fromHex((appStatics['responderStatic'] as Map)['publicKey'] as String);

  final sasByLabel = <String, String>{};
  final hashByLabel = <String, String>{};

  for (final entry in sessions.entries) {
    final name = entry.key;
    final s = entry.value as Map<String, dynamic>;
    stdout.writeln('  --- session $name (${s['label']}) ---');

    final iStaticSk = fromHex((appStatics['initiatorStatic'] as Map)['secretKey'] as String);
    final rStaticSk = fromHex((appStatics['responderStatic'] as Map)['secretKey'] as String);
    final iEph = s['initiatorEphemeral'] as Map<String, dynamic>;
    final rEph = s['responderEphemeral'] as Map<String, dynamic>;
    final prologue = fromHex(s['prologue'] as String);
    final prologueRos = s['prologueRos'] == null ? null : fromHex(s['prologueRos'] as String);
    final payloads = (s['payloads'] as List).cast<String>().map(fromHex).toList();
    final messages = s['messages'] as Map<String, dynamic>;

    final init = NoiseXX(
      initiator: true,
      staticSecretKey: iStaticSk,
      staticPublicKey: iStaticPub,
      prologue: prologue,
      ephemeralSecretKey: fromHex(iEph['secretKey'] as String),
      trace: true,
    );
    final resp = NoiseXX(
      initiator: false,
      staticSecretKey: rStaticSk,
      staticPublicKey: rStaticPub,
      prologue: prologueRos ?? prologue,
      ephemeralSecretKey: fromHex(rEph['secretKey'] as String),
      trace: true,
    );

    final m1 = init.writeMessage(payloads[0]);
    final g1 = resp.readMessage(m1);
    final m2 = resp.writeMessage(payloads[1]);
    final g2 = init.readMessage(m2);
    final m3 = init.writeMessage(payloads[2]);
    final g3 = resp.readMessage(m3);

    check('  ephemeral public key derives correctly (initiator)',
        toHex(publicKeyFromSecret(fromHex(iEph['secretKey'] as String))) == iEph['publicKey']);
    check('  ephemeral public key derives correctly (responder)',
        toHex(publicKeyFromSecret(fromHex(rEph['secretKey'] as String))) == rEph['publicKey']);
    check('  msg1 bytes', toHex(m1) == messages['msg1'], '${m1.length} bytes');
    check('  msg2 bytes', toHex(m2) == messages['msg2'], '${m2.length} bytes');
    check('  msg3 bytes', toHex(m3) == messages['msg3'], '${m3.length} bytes');
    check('  payload round-trip',
        toHex(g1) == toHex(payloads[0]) &&
            toHex(g2) == toHex(payloads[1]) &&
            toHex(g3) == toHex(payloads[2]));
    check('  handshake hash', toHex(init.handshakeHash!) == s['handshakeHash'],
        toHex(init.handshakeHash!));
    check('  responder handshake hash matches initiator',
        toHex(resp.handshakeHash!) == toHex(init.handshakeHash!));
    check('  chaining key', toHex(init.ck) == s['chainingKey'], toHex(init.ck));

    final tk = s['transportKeys'] as Map<String, dynamic>;
    check('  transport key initiator->responder',
        toHex(init.tx!.k!) == tk['initiatorToResponder']);
    check('  transport key responder->initiator',
        toHex(init.rx!.k!) == tk['responderToInitiator']);
    check('  responder tx == initiator rx',
        toHex(resp.tx!.k!) == toHex(init.rx!.k!));

    final sas = deriveSas(init.handshakeHash!, iStaticPub, rStaticPub);
    check('  SAS', sas == s['sas'], '${s['sas']} (dart $sas)');
    check('  responder SAS matches',
        deriveSas(resp.handshakeHash!, iStaticPub, rStaticPub) == sas);
    sasByLabel[name] = sas;
    hashByLabel[name] = toHex(init.handshakeHash!);

    // Full trace comparison (h/ck/k after every mix step) — catches the exact
    // step at which the two implementations would diverge.
    final traceI = (s['traceInitiator'] as List).cast<Map<String, dynamic>>();
    final traceR = (s['traceResponder'] as List).cast<Map<String, dynamic>>();
    check('  initiator trace length', init.trace!.length == traceI.length,
        'dart ${init.trace!.length} vs node ${traceI.length}');
    check('  responder trace length', resp.trace!.length == traceR.length,
        'dart ${resp.trace!.length} vs node ${traceR.length}');
    var traceOk = true;
    var firstBad = '';
    for (var i = 0; i < traceI.length && i < init.trace!.length; i++) {
      final d = init.trace![i];
      final n = traceI[i];
      if (d.label != n['label'] || d.h != n['h'] || d.ck != n['ck'] || d.k != n['k']) {
        traceOk = false;
        firstBad = 'step $i (${n['label']} vs ${d.label}) node.h=${n['h']} dart.h=${d.h}';
        break;
      }
    }
    check('  initiator trace identical at every step', traceOk, firstBad);
    traceOk = true;
    firstBad = '';
    for (var i = 0; i < traceR.length && i < resp.trace!.length; i++) {
      final d = resp.trace![i];
      final n = traceR[i];
      if (d.label != n['label'] || d.h != n['h'] || d.ck != n['ck'] || d.k != n['k']) {
        traceOk = false;
        firstBad = 'step $i (${n['label']} vs ${d.label})';
        break;
      }
    }
    check('  responder trace identical at every step', traceOk, firstBad);

    // Transport phase, byte-for-byte, both directions, nonces 0 and 1.
    final tr = s['transport'] as Map<String, dynamic>;
    final i2r = (tr['initiatorToResponder'] as List).cast<Map<String, dynamic>>();
    final r2i = (tr['responderToInitiator'] as List).cast<Map<String, dynamic>>();
    var transportOk = true;
    for (final rec in i2r) {
      final ct = init.tx!.encrypt(fromHex(rec['plaintext'] as String));
      if (toHex(ct) != rec['ciphertext'] || rec['nonce'] != init.tx!.n - 1) {
        transportOk = false;
      }
      final pt = resp.rx!.decrypt(fromHex(rec['ciphertext'] as String));
      if (toHex(pt) != rec['plaintext']) transportOk = false;
    }
    for (final rec in r2i) {
      final ct = resp.tx!.encrypt(fromHex(rec['plaintext'] as String));
      if (toHex(ct) != rec['ciphertext']) transportOk = false;
      final pt = init.rx!.decrypt(fromHex(rec['ciphertext'] as String));
      if (toHex(pt) != rec['plaintext']) transportOk = false;
    }
    check('  transport phase: 2 msgs/direction, ciphertexts identical', transportOk);
    check('  transport nonces are 0,1 (8-byte LE64 counter)',
        i2r[0]['nonce'] == 0 && i2r[1]['nonce'] == 1 &&
            r2i[0]['nonce'] == 0 && r2i[1]['nonce'] == 1);
  }

  // -------------------------------------------------------------------------
  section('[2] negative vectors');
  final neg = doc['negativeVectors'] as Map<String, dynamic>;
  final tampered = neg['tamperedTransportCiphertext'] as Map<String, dynamic>;

  // Reproduce session A's transport state so the tampered ciphertext can be fed
  // to a live responder.
  final a = sessions['A'] as Map<String, dynamic>;
  final iStaticSk = fromHex((appStatics['initiatorStatic'] as Map)['secretKey'] as String);
  final rStaticSk = fromHex((appStatics['responderStatic'] as Map)['secretKey'] as String);
  final iEphA = a['initiatorEphemeral'] as Map<String, dynamic>;
  final rEphA = a['responderEphemeral'] as Map<String, dynamic>;
  final prologueA = fromHex(a['prologue'] as String);
  final payloadsA = (a['payloads'] as List).cast<String>().map(fromHex).toList();
  final initA = NoiseXX(
    initiator: true,
    staticSecretKey: iStaticSk,
    staticPublicKey: iStaticPub,
    prologue: prologueA,
    ephemeralSecretKey: fromHex(iEphA['secretKey'] as String),
  );
  final respA = NoiseXX(
    initiator: false,
    staticSecretKey: rStaticSk,
    staticPublicKey: rStaticPub,
    prologue: prologueA,
    ephemeralSecretKey: fromHex(rEphA['secretKey'] as String),
  );
  respA.readMessage(initA.writeMessage(payloadsA[0]));
  initA.readMessage(respA.writeMessage(payloadsA[1]));
  respA.readMessage(initA.writeMessage(payloadsA[2]));

  var tamperRejected = false;
  String tamperError = '';
  try {
    respA.rx!.decrypt(fromHex(tampered['tamperedCiphertext'] as String));
  } catch (e) {
    tamperRejected = true;
    tamperError = e.runtimeType.toString();
  }
  check('tampered transport ciphertext rejected', tamperRejected, tamperError);

  var tamperedHandshakeRejected = false;
  try {
    final badMsg2 = fromHex((a['messages'] as Map)['msg2'] as String);
    badMsg2[40] ^= 0x01;
    final i2 = NoiseXX(
      initiator: true,
      staticSecretKey: iStaticSk,
      staticPublicKey: iStaticPub,
      prologue: prologueA,
      ephemeralSecretKey: fromHex(iEphA['secretKey'] as String),
    );
    final r2 = NoiseXX(
      initiator: false,
      staticSecretKey: rStaticSk,
      staticPublicKey: rStaticPub,
      prologue: prologueA,
      ephemeralSecretKey: fromHex(rEphA['secretKey'] as String),
    );
    r2.readMessage(i2.writeMessage(payloadsA[0]));
    i2.readMessage(badMsg2);
  } catch (_) {
    tamperedHandshakeRejected = true;
  }
  check('tampered handshake msg2 rejected', tamperedHandshakeRejected);

  // Mismatched prologue.
  var prologueRejected = false;
  String prologueError = '';
  try {
    final i = NoiseXX(
      initiator: true,
      staticSecretKey: iStaticSk,
      staticPublicKey: iStaticPub,
      prologue: prologueForSession('sid-AAA'),
      ephemeralSecretKey: fromHex(iEphA['secretKey'] as String),
    );
    final r = NoiseXX(
      initiator: false,
      staticSecretKey: rStaticSk,
      staticPublicKey: rStaticPub,
      prologue: prologueForSession('sid-BBB'),
      ephemeralSecretKey: fromHex(rEphA['secretKey'] as String),
    );
    r.readMessage(i.writeMessage(Uint8List(0)));
    i.readMessage(r.writeMessage(utf8Bytes('p2')));
  } catch (e) {
    prologueRejected = true;
    prologueError = e.runtimeType.toString();
  }
  check('mismatched prologue aborts the handshake', prologueRejected, prologueError);

  // Replay semantics.
  check('A == D (identical ephemerals + prologue => identical SAS)',
      sasByLabel['A'] == sasByLabel['D'], '${sasByLabel['A']} vs ${sasByLabel['D']}');
  check('A != B (same static keys, fresh ephemerals => different SAS)',
      sasByLabel['A'] != sasByLabel['B'], '${sasByLabel['A']} vs ${sasByLabel['B']}');
  check('A != C (prologue differs by one byte => different SAS)',
      sasByLabel['A'] != sasByLabel['C'], '${sasByLabel['A']} vs ${sasByLabel['C']}');
  check('A != C handshake hash', hashByLabel['A'] != hashByLabel['C']);

  stdout.writeln(
      '\n${failures == 0 ? 'ALL $checks CHECKS PASSED' : '$failures of $checks CHECKS FAILED'}');
  exit(failures == 0 ? 0 : 1);
}
