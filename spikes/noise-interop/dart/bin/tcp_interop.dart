// Live interop driver (Dart side). Byte-identical protocol to
// node/src/tcp-interop.js — see that file for the protocol description.
//
//   dart run bin/tcp_interop.dart server <port> [--initiator] [--sid <sid>] [--verbose]
//   dart run bin/tcp_interop.dart client <port> [--initiator] [--sid <sid>] [--verbose]
//
// Prints one machine-readable line:  DSH_INTEROP_RESULT <json>

import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;
import 'dart:typed_data';

import 'package:noise_interop_dart/noise_xx_blake2s.dart';

const int _tagLen = 16;

Uint8List _framed(List<int> payload) {
  final out = Uint8List(4 + payload.length);
  ByteData.view(out.buffer).setUint32(0, payload.length, Endian.big);
  out.setAll(4, payload);
  return out;
}

Future<void> main(List<String> args) async {
  if (args.length < 2 || (args[0] != 'server' && args[0] != 'client')) {
    stderr.writeln(
        'usage: dart run bin/tcp_interop.dart server|client <port> [--initiator] [--sid s]');
    exit(2);
  }
  final mode = args[0];
  final port = int.parse(args[1]);
  final flags = <String, String>{};
  for (var i = 2; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
        flags[args[i].substring(2)] = args[++i];
      } else {
        flags[args[i].substring(2)] = 'true';
      }
    }
  }
  final initiator = flags.containsKey('initiator');
  final verbose = flags.containsKey('verbose');
  final sid = flags['sid'] ?? 'live-interop-session';

  final session = _Interop(
    initiator: initiator,
    sid: sid,
    verbose: verbose,
  );

  if (mode == 'server') {
    final server = await ServerSocket.bind(InternetAddress.loopbackIPv4, port);
    if (verbose) {
      stderr.writeln('[dart] listening on 127.0.0.1:$port as ${session.role}');
    }
    server.listen(session.attach);
    Timer(const Duration(seconds: 20), () {
      session.failWith('timeout waiting for the peer');
    });
  } else {
    Socket? socket;
    Object? lastError;
    for (var attempt = 0; attempt < 60; attempt++) {
      try {
        socket = await Socket.connect(InternetAddress.loopbackIPv4, port);
        break;
      } catch (e) {
        lastError = e;
        await Future<void>.delayed(const Duration(milliseconds: 100));
      }
    }
    if (socket == null) {
      session.failWith('could not connect to 127.0.0.1:$port ($lastError)');
      return;
    }
    session.attach(socket);
    Timer(const Duration(seconds: 20), () => session.failWith('timeout'));
  }
}

class _Interop {
  _Interop({required this.initiator, required this.sid, required this.verbose}) {
    final rng = math.Random.secure();
    final sk = Uint8List(32);
    for (var i = 0; i < 32; i++) {
      sk[i] = rng.nextInt(256);
    }
    staticSecretKey = sk;
    staticPublicKey = publicKeyFromSecret(sk);
    noise = NoiseXX(
      initiator: initiator,
      staticSecretKey: staticSecretKey,
      staticPublicKey: staticPublicKey,
      prologue: prologueForSession(sid),
    );
  }

  final bool initiator;
  final String sid;
  final bool verbose;
  String get role => initiator ? 'initiator' : 'responder';

  late final Uint8List staticSecretKey;
  late final Uint8List staticPublicKey;
  late final NoiseXX noise;

  Socket? _sock;
  Uint8List _acc = Uint8List(0);
  int _step = 0;
  int _rxIndex = 0;
  bool _done = false;
  bool handshakeFailed = false;
  String? failureReason;
  int handshakeMicros = 0;
  int bytesSent = 0;
  int bytesReceived = 0;
  bool transportOk = false;
  bool tamperRejected = false;
  bool postTamperOk = false;
  String? peerHash;
  String? peerSas;
  String? selfSas;
  final Stopwatch _watch = Stopwatch()..start();

  String? _sas() {
    final h = noise.handshakeHash;
    final rs = noise.rs;
    if (h == null || rs == null) return null;
    return initiator
        ? deriveSas(h, staticPublicKey, rs)
        : deriveSas(h, rs, staticPublicKey);
  }

  void attach(Socket socket) {
    _sock = socket;
    _watch.reset(); // measure from connection, not from process start
    socket.listen(
      (chunk) {
        bytesReceived += chunk.length;
        _feed(Uint8List.fromList(chunk));
      },
      onError: (Object e) => failWith('$e'),
      onDone: () {
        if (!_done) {
          failWith(failureReason ?? 'peer closed the connection');
        }
      },
      cancelOnError: true,
    );
    if (initiator) {
      _send(noise.writeMessage(Uint8List(0)));
      _step = 1;
    }
  }

  void _feed(Uint8List chunk) {
    _acc = concatBytes([_acc, chunk]);
    while (_acc.length >= 4) {
      final len = ByteData.sublistView(_acc, 0, 4).getUint32(0, Endian.big);
      if (_acc.length < 4 + len) return;
      final msg = Uint8List.fromList(_acc.sublist(4, 4 + len));
      _acc = Uint8List.fromList(_acc.sublist(4 + len));
      _onMessage(msg);
      if (_done) return;
    }
  }

  void _send(List<int> payload) {
    final f = _framed(payload);
    bytesSent += f.length;
    _sock?.add(f);
  }

  void _sendSelfInfo() {
    selfSas = _sas();
    _send(noise.tx!.encrypt(utf8Bytes(jsonEncode({
      'handshakeHash': toHex(noise.handshakeHash!),
      'sas': selfSas,
      'role': role,
      'staticPublicKey': toHex(staticPublicKey),
    }))));
  }

  void _onMessage(Uint8List msg) {
    if (_done) return;
    try {
      if (!noise.complete) {
        _onHandshake(msg);
      } else {
        _onTransport(msg);
      }
    } catch (e) {
      failWith('$e');
    }
  }

  void _onHandshake(Uint8List msg) {
    if (initiator) {
      if (_step != 1) {
        throw StateError('unexpected handshake message at step $_step');
      }
      noise.readMessage(msg);
      _send(noise.writeMessage(utf8Bytes('initiator-msg3')));
      _step = 2;
      handshakeMicros = _watch.elapsedMicroseconds;
      _sendSelfInfo();
      _send(noise.tx!.encrypt(utf8Bytes('i->r payload #2')));
    } else {
      if (_step == 0) {
        noise.readMessage(msg);
        _send(noise.writeMessage(utf8Bytes('responder-msg2')));
        _step = 1;
      } else if (_step == 1) {
        noise.readMessage(msg);
        _step = 2;
        handshakeMicros = _watch.elapsedMicroseconds;
      } else {
        throw StateError('unexpected handshake message at step $_step');
      }
    }
  }

  void _onTransport(Uint8List msg) {
    if (initiator) {
      if (_rxIndex == 0) {
        final info = jsonDecode(utf8.decode(noise.rx!.decrypt(msg))) as Map;
        peerHash = info['handshakeHash'] as String?;
        peerSas = info['sas'] as String?;
        _rxIndex = 1;
      } else if (_rxIndex == 1) {
        transportOk = utf8.decode(noise.rx!.decrypt(msg)) == 'r->i payload #2';
        _rxIndex = 2;
        // Corrupted copy first, then the untouched ciphertext. The responder
        // must reject the first without advancing its receive nonce, then open
        // the second normally.
        final good = noise.tx!.encrypt(utf8Bytes('i->r payload #3'));
        final bad = Uint8List.fromList(good);
        bad[2] ^= 0x01;
        _send(bad);
        _send(good);
      } else if (_rxIndex == 2) {
        postTamperOk = utf8.decode(noise.rx!.decrypt(msg)) == 'r->i payload #3';
        _rxIndex = 3;
        _finish(transportOk && postTamperOk && peerSas == selfSas);
      }
    } else {
      if (_rxIndex == 0) {
        final info = jsonDecode(utf8.decode(noise.rx!.decrypt(msg))) as Map;
        peerHash = info['handshakeHash'] as String?;
        peerSas = info['sas'] as String?;
        _rxIndex = 1;
        _sendSelfInfo();
        _send(noise.tx!.encrypt(utf8Bytes('r->i payload #2')));
      } else if (_rxIndex == 1) {
        transportOk = utf8.decode(noise.rx!.decrypt(msg)) == 'i->r payload #2';
        _rxIndex = 2;
      } else if (_rxIndex == 2) {
        // Tamper probe: must fail and must not advance the receive nonce.
        var accepted = false;
        try {
          noise.rx!.decrypt(msg);
          accepted = true;
        } catch (_) {
          tamperRejected = true;
        }
        if (accepted) {
          throw StateError('tampered ciphertext was accepted');
        }
        _rxIndex = 3;
      } else if (_rxIndex == 3) {
        postTamperOk = utf8.decode(noise.rx!.decrypt(msg)) == 'i->r payload #3';
        _rxIndex = 4;
        _send(noise.tx!.encrypt(utf8Bytes('r->i payload #3')));
        _finish(transportOk && tamperRejected && postTamperOk && peerSas == selfSas);
      }
    }
  }

  void failWith(String reason) {
    if (_done) return;
    handshakeFailed = true;
    failureReason = failureReason ?? reason;
    _finish(false);
  }

  void _finish(bool ok) {
    if (_done) return;
    _done = true;
    final hash = noise.handshakeHash == null ? null : toHex(noise.handshakeHash!);
    final result = <String, dynamic>{
      'side': 'dart',
      'role': role,
      'sid': sid,
      'suite': kProtocolName,
      'ok': ok && !handshakeFailed,
      'handshakeFailed': handshakeFailed,
      'failureReason': failureReason,
      'handshakeMicros': handshakeMicros,
      'handshakeHash': hash,
      'sas': selfSas,
      'peerSas': peerSas,
      'peerHandshakeHash': peerHash,
      'sasMatchesPeer': peerSas != null && selfSas != null && peerSas == selfSas,
      'hashMatchesPeer': peerHash != null && hash != null && peerHash == hash,
      'transportOk': transportOk,
      'tamperRejected': tamperRejected,
      'postTamperOk': postTamperOk,
      'bytesSent': bytesSent,
      'bytesReceived': bytesReceived,
    };
    stdout.writeln('DSH_INTEROP_RESULT ${jsonEncode(result)}');
    if (verbose) stderr.writeln('[dart/$role] ${jsonEncode(result)}');
    try {
      _sock?.destroy();
    } catch (_) {}
    Timer(const Duration(milliseconds: 30), () => exit(ok ? 0 : 1));
  }
}

void unused() {
  // keep the analyzer honest about the tag length constant
  assert(_tagLen == 16);
}
