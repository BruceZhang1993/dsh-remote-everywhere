// Dart self-tests: transport phase, tamper, replay, prologue mismatch, perf.
//
//   dart run bin/selftest.dart

import 'dart:io';
import 'dart:math' as math;
import 'dart:typed_data';

import 'package:noise_interop_dart/noise_xx_blake2s.dart';

int failures = 0;
int checks = 0;

void check(String name, bool ok, [String detail = '']) {
  checks++;
  if (!ok) failures++;
  stdout.writeln('  [${ok ? 'ok  ' : 'FAIL'}] $name${detail.isEmpty ? '' : ' :: $detail'}');
}

void section(String t) => stdout.writeln('\n$t');

void expectThrows(String name, void Function() fn) {
  try {
    fn();
    check(name, false, 'no error thrown');
  } catch (e) {
    check(name, true, e.runtimeType.toString());
  }
}

final math.Random _rng = math.Random.secure();

Uint8List randKey() {
  final out = Uint8List(32);
  for (var i = 0; i < 32; i++) {
    out[i] = _rng.nextInt(256);
  }
  return out;
}

class Side {
  Side(this.sk, this.pk);
  final Uint8List sk;
  final Uint8List pk;
}

Side newSide() {
  final sk = randKey();
  return Side(sk, publicKeyFromSecret(sk));
}

class Session {
  Session(this.init, this.resp, this.m1, this.m2, this.m3);
  final NoiseXX init;
  final NoiseXX resp;
  final Uint8List m1;
  final Uint8List m2;
  final Uint8List m3;
}

Session handshake({
  required Side iStatic,
  required Side rStatic,
  required String sid,
  Uint8List? iEph,
  Uint8List? rEph,
  Uint8List? prologueI,
  Uint8List? prologueR,
  List<Uint8List>? payloads,
}) {
  final pI = prologueI ?? prologueForSession(sid);
  final pR = prologueR ?? prologueForSession(sid);
  final pl = payloads ??
      [Uint8List(0), utf8Bytes('p2'), utf8Bytes('p3')];
  final init = NoiseXX(
    initiator: true,
    staticSecretKey: iStatic.sk,
    staticPublicKey: iStatic.pk,
    prologue: pI,
    ephemeralSecretKey: iEph ?? randKey(),
  );
  final resp = NoiseXX(
    initiator: false,
    staticSecretKey: rStatic.sk,
    staticPublicKey: rStatic.pk,
    prologue: pR,
    ephemeralSecretKey: rEph ?? randKey(),
  );
  final m1 = init.writeMessage(pl[0]);
  final g1 = resp.readMessage(m1);
  final m2 = resp.writeMessage(pl[1]);
  final g2 = init.readMessage(m2);
  final m3 = init.writeMessage(pl[2]);
  final g3 = resp.readMessage(m3);
  if (toHex(g1) != toHex(pl[0]) || toHex(g2) != toHex(pl[1]) || toHex(g3) != toHex(pl[2])) {
    throw StateError('payload round-trip failed');
  }
  return Session(init, resp, m1, m2, m3);
}

Future<void> main() async {
  final iStatic = newSide();
  final rStatic = newSide();
  final iEph = randKey();
  final rEph = randKey();

  stdout.writeln('noise-interop :: dart selftest');

  // -------------------------------------------------------------------------
  section('[1] handshake + transport happy path');
  final s = handshake(
    iStatic: iStatic,
    rStatic: rStatic,
    sid: 'selftest-01',
    iEph: iEph,
    rEph: rEph,
  );
  check('handshake completes on both sides', s.init.complete && s.resp.complete);
  check('handshake hashes agree', toHex(s.init.handshakeHash!) == toHex(s.resp.handshakeHash!),
      toHex(s.init.handshakeHash!));
  check('initiator tx == responder rx', toHex(s.init.tx!.k!) == toHex(s.resp.rx!.k!));
  check('initiator rx == responder tx', toHex(s.init.rx!.k!) == toHex(s.resp.tx!.k!));
  check('msg lengths 32/98/66',
      s.m1.length == 32 && s.m2.length == 98 && s.m3.length == 66,
      '${s.m1.length}/${s.m2.length}/${s.m3.length}');

  final sasI = deriveSas(s.init.handshakeHash!, iStatic.pk, rStatic.pk);
  final sasR = deriveSas(s.resp.handshakeHash!, iStatic.pk, rStatic.pk);
  check('SAS matches across the two local sides', sasI == sasR, sasI);
  check('SAS is 6 decimal digits', RegExp(r'^[0-9]{6}$').hasMatch(sasI), sasI);

  final tr1 = utf8Bytes('transport i->r #1');
  final tr2 = utf8Bytes('transport i->r #2');
  final ct1 = s.init.tx!.encrypt(tr1);
  final ct2 = s.init.tx!.encrypt(tr2);
  check('i->r #1 decrypts (nonce 0)', toHex(s.resp.rx!.decrypt(ct1)) == toHex(tr1));
  check('i->r #2 decrypts (nonce 1)', toHex(s.resp.rx!.decrypt(ct2)) == toHex(tr2));
  final tr3 = utf8Bytes('transport r->i #1');
  final tr4 = utf8Bytes('transport r->i #2');
  final ct3 = s.resp.tx!.encrypt(tr3);
  final ct4 = s.resp.tx!.encrypt(tr4);
  check('r->i #1 decrypts (nonce 0)', toHex(s.init.rx!.decrypt(ct3)) == toHex(tr3));
  check('r->i #2 decrypts (nonce 1)', toHex(s.init.rx!.decrypt(ct4)) == toHex(tr4));
  check('ciphertext is plaintext + 16-byte tag',
      ct1.length == tr1.length + 16 && ct3.length == tr3.length + 16);

  // -------------------------------------------------------------------------
  section('[2] tamper detection');
  final tampered = Uint8List.fromList(ct1)..[3] ^= 0x01;
  expectThrows('tampered transport ciphertext is rejected', () => s.resp.rx!.decrypt(tampered));

  final s2 = handshake(iStatic: iStatic, rStatic: rStatic, sid: 'selftest-02', iEph: iEph, rEph: rEph);
  final ctA = s2.init.tx!.encrypt(utf8Bytes('tamper-target'));
  final badTag = Uint8List.fromList(ctA)..[ctA.length - 1] ^= 0x01;
  expectThrows('flipped Poly1305 tag bit is rejected', () => s2.resp.rx!.decrypt(badTag));

  {
    final badMsg2 = Uint8List.fromList(s2.m2)..[40] ^= 0x01;
    expectThrows('tampered handshake msg2 rejected by the initiator', () {
      final i = NoiseXX(
        initiator: true,
        staticSecretKey: iStatic.sk,
        staticPublicKey: iStatic.pk,
        prologue: prologueForSession('selftest-02'),
        ephemeralSecretKey: iEph,
      );
      final r = NoiseXX(
        initiator: false,
        staticSecretKey: rStatic.sk,
        staticPublicKey: rStatic.pk,
        prologue: prologueForSession('selftest-02'),
        ephemeralSecretKey: rEph,
      );
      r.readMessage(i.writeMessage(Uint8List(0)));
      i.readMessage(badMsg2);
    });
  }

  // -------------------------------------------------------------------------
  section('[3] replay / freshness');
  final a = handshake(iStatic: iStatic, rStatic: rStatic, sid: 'replay-sid-XYZ', iEph: randKey(), rEph: randKey());
  final b = handshake(iStatic: iStatic, rStatic: rStatic, sid: 'replay-sid-XYZ', iEph: randKey(), rEph: randKey());
  final sasA = deriveSas(a.init.handshakeHash!, iStatic.pk, rStatic.pk);
  final sasB = deriveSas(b.init.handshakeHash!, iStatic.pk, rStatic.pk);
  check('same session id + fresh ephemerals -> different handshake hash',
      toHex(a.init.handshakeHash!) != toHex(b.init.handshakeHash!));
  check('same session id + fresh ephemerals -> different SAS', sasA != sasB, '$sasA vs $sasB');
  final e1 = randKey();
  final e2 = randKey();
  final c = handshake(iStatic: iStatic, rStatic: rStatic, sid: 'replay-sid-XYZ', iEph: e1, rEph: e2);
  final d = handshake(iStatic: iStatic, rStatic: rStatic, sid: 'replay-sid-XYZ', iEph: e1, rEph: e2);
  check('same sid + byte-identical transcript -> identical SAS (SAS is a pure function of the transcript)',
      deriveSas(c.init.handshakeHash!, iStatic.pk, rStatic.pk) ==
          deriveSas(d.init.handshakeHash!, iStatic.pk, rStatic.pk));

  // -------------------------------------------------------------------------
  section('[4] prologue / session-id binding');
  {
    final i = NoiseXX(
      initiator: true,
      staticSecretKey: iStatic.sk,
      staticPublicKey: iStatic.pk,
      prologue: prologueForSession('sid-AAA'),
      ephemeralSecretKey: iEph,
    );
    final r = NoiseXX(
      initiator: false,
      staticSecretKey: rStatic.sk,
      staticPublicKey: rStatic.pk,
      prologue: prologueForSession('sid-BBB'),
      ephemeralSecretKey: rEph,
    );
    r.readMessage(i.writeMessage(Uint8List(0)));
    final m2 = r.writeMessage(utf8Bytes('p2'));
    expectThrows('mismatched prologue: initiator rejects responder msg2', () => i.readMessage(m2));
    check('no session established', !i.complete && !r.complete);
  }
  {
    final h1 = handshake(iStatic: iStatic, rStatic: rStatic, sid: 'sid-AAA', iEph: iEph, rEph: rEph);
    final p2 = prologueForSession('sid-AAB');
    final h2 = handshake(
      iStatic: iStatic,
      rStatic: rStatic,
      sid: 'x',
      iEph: iEph,
      rEph: rEph,
      prologueI: p2,
      prologueR: p2,
    );
    check('one-byte prologue change propagates to the handshake hash',
        toHex(h1.init.handshakeHash!) != toHex(h2.init.handshakeHash!));
    check('one-byte prologue change propagates to the SAS',
        deriveSas(h1.init.handshakeHash!, iStatic.pk, rStatic.pk) !=
            deriveSas(h2.init.handshakeHash!, iStatic.pk, rStatic.pk));
  }

  // -------------------------------------------------------------------------
  section('[5] performance sanity (Dart / pure Dart, AOT-less `dart run`)');
  const n = 200;
  for (var k = 0; k < 10; k++) {
    handshake(iStatic: iStatic, rStatic: rStatic, sid: 'perf', iEph: iEph, rEph: rEph);
  }
  final sw = Stopwatch()..start();
  for (var k = 0; k < n; k++) {
    handshake(iStatic: iStatic, rStatic: rStatic, sid: 'perf', iEph: iEph, rEph: rEph);
  }
  sw.stop();
  final hsUs = sw.elapsedMicroseconds / n;
  stdout.writeln('  full XX handshake (both sides, 3 messages): '
      '${hsUs.toStringAsFixed(1)} us/handshake => ${(hsUs / 2).toStringAsFixed(1)} us/party');

  const sz = 32 * 1024; // Noise caps a message at 65535 bytes
  const msgs = 100;
  final big = Uint8List(sz);
  for (var k = 0; k < sz; k++) {
    big[k] = k & 0xff;
  }
  final p = handshake(iStatic: iStatic, rStatic: rStatic, sid: 'perf-transport', iEph: iEph, rEph: rEph);
  final sw2 = Stopwatch()..start();
  var sink = 0;
  for (var k = 0; k < msgs; k++) {
    final ct = p.init.tx!.encrypt(big);
    final pt = p.resp.rx!.decrypt(ct);
    sink += pt[0];
  }
  sw2.stop();
  final secs = sw2.elapsedMicroseconds / 1e6;
  final mib = (sz * msgs) / (1024 * 1024);
  stdout.writeln('  transport encrypt+decrypt 32 KiB x $msgs: '
      '${(mib / secs).toStringAsFixed(1)} MiB/s round-trip');
  if (sink == -1) stdout.writeln('  $sink');

  stdout.writeln('\n${failures == 0 ? 'ALL $checks SELFTESTS PASSED' : '$failures of $checks SELFTESTS FAILED'}');
  exit(failures == 0 ? 0 : 1);
}
