import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:dsh_remote_core/frame.dart';
import 'package:dsh_remote_core/noise_xx_blake2s.dart';
import 'package:dsh_remote_core/remote_connection.dart';
import 'package:test/test.dart';

final _remoteFailure = isA<RemoteException>();
Matcher _code(String code) =>
    _remoteFailure.having((error) => error.code, 'code', code);

/// A real loopback binary WebSocket peer, with independently owned Noise keys.
class _Host {
  final identity = Identity.fromSecret(List.filled(32, 7));
  late HttpServer server;
  final peers = <_Peer>[];
  Map<String, dynamic> hello = {};
  String? pairSid;
  FutureOr<void> Function(_Peer peer, Map<String, dynamic> request)? request;
  bool answerHeartbeats = true;
  int? refuseStatus;
  Future<void> start() async {
    server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    server.listen((upgrade) async {
      if (refuseStatus != null) {
        upgrade.response.statusCode = refuseStatus!;
        await upgrade.response.close();
        return;
      }
      final socket = await WebSocketTransformer.upgrade(upgrade);
      final peer = _Peer(socket, this);
      peers.add(peer);
    });
  }

  String get endpoint => 'ws://127.0.0.1:${server.port}';
  Future<RemoteConnection> connect({
    Duration? heartbeat,
    List<int>? pin,
    RemoteCancellation? cancellation,
    Duration? timeout,
  }) => RemoteConnection.connect(
    endpoint,
    identity: Identity.fromSecret(List.filled(32, 8)),
    peerPublicKey: pin ?? identity.publicKey,
    caps: ['session', 'stream', 'approval'],
    pairSid: pairSid,
    cancellation: cancellation,
    requestTimeout: timeout ?? const Duration(seconds: 1),
    heartbeatInterval: heartbeat ?? const Duration(minutes: 1),
  );
  Future<void> close() async {
    for (final peer in peers) {
      await peer.socket.close();
    }
    await server.close(force: true);
  }
}

class _Peer {
  _Peer(this.socket, this.host)
    : noise = NoiseXX(
        initiator: false,
        staticSecretKey: host.identity.secretKey,
        staticPublicKey: host.identity.publicKey,
        prologue: utf8Bytes(
          host.pairSid == null
              ? 'dsh-remote/v1/resume:${host.identity.deviceId}'
              : 'dsh-remote/v1/pair:${host.pairSid}',
        ),
      ) {
    socket.listen(receive);
  }
  final WebSocket socket;
  final _Host host;
  final NoiseXX noise;
  final tx = <int, int>{};
  final rx = <int, int>{};
  final ready = Completer<void>();
  final received = <Map<String, dynamic>>[];
  void receive(dynamic message) {
    final bytes = Uint8List.fromList(message as List<int>);
    if (!noise.complete) {
      noise.readMessage(bytes);
      if (!noise.complete) {
        socket.add(noise.writeMessage());
      } else {
        send(4, {
          'type': 'hello',
          'vmin': 1,
          'vmax': 1,
          'caps': ['session', 'stream', 'approval', 'admin'],
          'role': 'controlled',
          'kind': 'dsh',
          'deviceId': host.identity.deviceId,
          'name': 'Test host',
          ...host.hello,
        });
      }
      return;
    }
    final header = DrHeader.decode(bytes);
    final value = jsonDecode(
      utf8.decode(
        decryptFrame(
          bytes,
          noise.rx!,
          expectedSeq: rx[header.streamId] ?? 0,
          expectedStreamId: header.streamId,
        ),
      ),
    ) as Map<String, dynamic>;
    rx[header.streamId] = header.seq + 1;
    received.add(value);
    if (value['type'] == 'hello') {
      ready.complete();
    } else if (value['type'] == 'ping' && host.answerHeartbeats) {
      send(4, {'type': 'pong', 'id': value['id']});
    } else if (header.kind == 1) {
      if (host.request != null) {
        Future.sync(() => host.request!(this, value)).ignore();
      } else {
        response(value, value['p']);
      }
    }
  }

  void send(int kind, Object value, {int streamId = 0, int? seq}) {
    final bytes = value is List<int> ? value : utf8.encode(jsonEncode(value));
    socket.add(
      encryptFrame(
        DrHeader(kind, streamId, seq ?? tx[streamId] ?? 0),
        noise.tx!,
        bytes,
      ),
    );
    tx[streamId] = (tx[streamId] ?? 0) + 1;
  }

  void response(Map<String, dynamic> request, Object? value) =>
      send(2, {'id': request['id'], 'r': value});
  void value(int streamId, Map<String, dynamic> value) {
    final bytes = utf8.encode(jsonEncode(value));
    for (var offset = 0; offset < bytes.length; offset += 32768) {
      send(
        5,
        bytes.sublist(
          offset,
          offset + 32768 < bytes.length ? offset + 32768 : bytes.length,
        ),
        streamId: streamId,
      );
    }
    send(4, {
      'type': 'application',
      'name': 'session.frame',
      'data': {'bytes': bytes.length},
    }, streamId: streamId);
  }
}

void main() {
  late _Host host;
  setUp(() async {
    host = _Host();
    await host.start();
  });
  tearDown(() => host.close());

  test(
    'mobile hello, independent concurrent RPCs and application events',
    () async {
      final connection = await host.connect();
      final peer = host.peers.single;
      await peer.ready.future;
      expect(peer.received.first['role'], 'controller');
      expect(peer.received.first['kind'], 'mobile');
      expect(connection.negotiatedCaps, {'session', 'stream', 'approval'});
      final results = await Future.wait(
        List.generate(12, (i) => connection.request('echo', {'value': i})),
      );
      expect(
        results.map((value) => value['value']),
        List.generate(12, (i) => i),
      );
      final event = connection.events.first;
      peer.send(4, {
        'type': 'application',
        'name': 'approval.responded',
        'data': {'interactionId': 'one'},
      });
      expect((await event)['data'], {'interactionId': 'one'});
      connection.close();
      expect((await connection.closed).code, 'cancelled');
    },
  );

  test(
    'RPC error and timeout release slots without closing connection',
    () async {
      host.request = (peer, request) {
        if (request['m'] == 'fail') {
          peer.send(3, {
            'id': request['id'],
            'e': {'code': 'unsupported', 'message': 'unknown method'},
          });
        }
        if (request['m'] == 'echo') peer.response(request, {'ok': true});
      };
      final connection = await host.connect();
      await expectLater(
        connection.request('fail', {}),
        throwsA(_code('unsupported')),
      );
      await expectLater(
        connection.request(
          'wait',
          {},
          timeout: const Duration(milliseconds: 30),
        ),
        throwsA(_code('timeout')),
      );
      await expectLater(
        connection.request('echo', {'bad': BigInt.one}),
        throwsA(_code('invalid-argument')),
      );
      expect(connection.isReady, isTrue);
      expect(await connection.request('echo', {}), {'ok': true});
      connection.close();
    },
  );

  test(
    'request cancellation does not replay writes; pending slot cap is 32',
    () async {
      host.request = (_, _) {};
      final connection = await host.connect();
      final token = RemoteCancellation();
      final cancelled = connection.request('write', {}, cancellation: token);
      final assertion = expectLater(cancelled, throwsA(_code('cancelled')));
      token.cancel();
      await assertion;
      final pending = List.generate(32, (_) => connection.request('wait', {}));
      final assertions = pending
          .map((future) => expectLater(future, throwsA(_code('cancelled'))))
          .toList();
      await expectLater(
        connection.request('extra', {}),
        throwsA(_code('busy')),
      );
      // Close while the serialized addStream chain still owns the WS sink.
      expect(connection.close, returnsNormally);
      expect((await connection.closed).code, 'cancelled');
      await Future.wait(assertions);
    },
  );

  test(
    'independent logical streams reassemble UTF-8 split across 32 KiB blocks',
    () async {
      host.request = (peer, request) {
        final id = request['p']['streamId'] as int;
        peer.response(request, {'streamId': id});
        peer.value(id, {'kind': 'snapshot', 'cursor': id, 'text': '中' * 25000});
        peer.value(id, {'kind': 'append', 'records': []});
        peer.send(6, {}, streamId: id);
      };
      final connection = await host.connect();
      final streams = await Future.wait([
        connection.open('stream.open', {}),
        connection.open('stream.open', {}),
      ]);
      final values = await Future.wait(
        streams.map((stream) => stream.toList()),
      );
      expect(values[0][0]['cursor'], 1);
      expect(values[1][0]['cursor'], 3);
      expect(values[0][0]['text'], '中' * 25000);
      expect(values[0].last['kind'], 'append');
      connection.close();
    },
  );

  test(
    'subscription cancellation sends stream.close and keeps transport usable',
    () async {
      host.request = (peer, request) {
        final params = request['p'] as Map;
        if (request['m'] == 'stream.open') {
          peer.response(request, {'streamId': params['streamId']});
          peer.value(params['streamId'] as int, {
            'kind': 'snapshot',
            'cursor': -1,
            'records': [],
          });
        } else if (request['m'] == 'stream.close') {
          peer.send(6, {}, streamId: params['streamId'] as int);
          peer.response(request, {'ok': true});
        } else {
          peer.response(request, {'ok': true});
        }
      };
      final connection = await host.connect();
      final stream = await connection.open('stream.open', {});
      final event = Completer<void>();
      final subscription = stream.listen((_) => event.complete());
      await event.future;
      await subscription.cancel();
      // RPC ordering ensures the close request has been processed before echo.
      expect(await connection.request('echo', {}), {'ok': true});
      expect(
        host.peers.single.received.where(
          (value) => value['m'] == 'stream.close',
        ),
        hasLength(1),
      );
      connection.close();
    },
  );

  test('paused incoming stream queue is bounded to 128 values', () async {
    host.request = (peer, request) {
      final id = request['p']['streamId'] as int;
      peer.response(request, {'streamId': id});
      for (var i = 0; i < 129; i++) {
        peer.value(id, {'value': i});
      }
    };
    final connection = await host.connect();
    await connection.open('stream.open', {});
    expect((await connection.closed).code, 'busy');
  });

  test(
    'truncated and invalid UTF-8 application values terminate connection',
    () async {
      host.request = (peer, request) {
        final id = request['p']['streamId'] as int;
        peer.response(request, {'streamId': id});
        peer.send(5, [0xff], streamId: id);
        peer.send(4, {
          'type': 'application',
          'name': 'session.frame',
          'data': {'bytes': 1},
        }, streamId: id);
      };
      final connection = await host.connect();
      await connection.open('stream.open', {});
      expect((await connection.closed).code, 'invalid-argument');
    },
  );

  test(
    'truncated SEND, unknown stream and physical replay are rejected',
    () async {
      final connection = await host.connect();
      host.peers.single.send(4, {'type': 'ping', 'id': '12345678901'}, seq: 0);
      expect((await connection.closed).code, 'invalid-argument');
      final unknown = await host.connect();
      host.peers.last.send(6, {}, streamId: 99);
      expect((await unknown.closed).code, 'invalid-argument');
      host.request = (peer, request) {
        final id = request['p']['streamId'] as int;
        peer.response(request, {'streamId': id});
        peer.send(5, [123], streamId: id);
        peer.send(6, {}, streamId: id);
      };
      final truncated = await host.connect();
      await truncated.open('stream.open', {});
      expect((await truncated.closed).code, 'invalid-argument');
    },
  );

  test(
    'peer pin, role, version and authentication rejection fail closed',
    () async {
      final wrong = Identity.fromSecret(List.filled(32, 9));
      await expectLater(
        host.connect(pin: wrong.publicKey),
        throwsA(_code('unauthorized')),
      );
      host.hello = {'role': 'controller'};
      await expectLater(host.connect(), throwsA(_code('unauthorized')));
      host.hello = {'vmin': 2, 'vmax': 2};
      await expectLater(host.connect(), throwsA(_code('unauthorized')));
      host.hello = {'type': 'authentication-rejected', 'code': 'unauthorized'};
      await expectLater(host.connect(), throwsA(_code('unauthorized')));
    },
  );

  test(
    'ciphertext tampering and heartbeat starvation close pending work',
    () async {
      final connection = await host.connect();
      final peer = host.peers.single;
      final wire = encryptFrame(
        const DrHeader(4, 0, 1),
        peer.noise.tx!,
        utf8.encode('{"type":"pong","id":"12345678901"}'),
      )..[16] ^= 1;
      peer.socket.add(wire);
      expect((await connection.closed).code, 'unauthorized');
      host.answerHeartbeats = false;
      final idle = await host.connect(
        heartbeat: const Duration(milliseconds: 20),
      );
      expect((await idle.closed).code, 'transport/lost');
    },
  );

  test('connection closing settles live streams and does not destroy stored identity', () async {
    host.request = (peer, request) =>
        peer.response(request, {'streamId': request['p']['streamId']});
    final identity = Identity.generate(),
        original = Uint8List.fromList(identity.secretKey);
    final connection = await RemoteConnection.connect(
      host.endpoint,
      identity: identity,
      peerPublicKey: host.identity.publicKey,
      caps: ['stream'],
    );
    final stream = await connection.open('stream.open', {});
    final result = expectLater(stream.toList(), throwsA(_code('cancelled')));
    connection.close();
    await result;
    expect(identity.secretKey, original);
  });

  test(
    'endpoint, cancellation and pairing payload validation precede connection',
    () async {
      await expectLater(
        host.connect(cancellation: RemoteCancellation()..cancel()),
        throwsA(_code('cancelled')),
      );
      await expectLater(
        RemoteConnection.connect(
          'ws://example.com',
          identity: Identity.generate(),
          peerPublicKey: host.identity.publicKey,
          caps: ['stream'],
        ),
        throwsA(_code('invalid-argument')),
      );
      final qr = {
        'v': 1,
        'sid': 'AAAAAAAAAAAAAAAAAAAAAA',
        'exp': DateTime.now().millisecondsSinceEpoch ~/ 1000 + 60,
        'relay': host.endpoint,
        'pk': base64.encode(host.identity.publicKey),
        'name': 'Test host',
        'caps': ['session', 'stream'],
      };
      final payload = PairingRequest.parse(qr);
      expect(payload.publicKey, host.identity.publicKey);
      expect(
        () => PairingRequest.parse({...qr, 'exp': 0}),
        throwsA(_code('invalid-argument')),
      );
      expect(
        () => PairingRequest.parse({
          ...qr,
          'caps': ['stream', 'stream'],
        }),
        throwsA(_code('invalid-argument')),
      );
      expect(
        () => PairingRequest.parse({...qr, 'pk': 'A' * 44}),
        throwsA(_code('invalid-argument')),
      );
    },
  );

  test(
    'HTTP upgrade 429 and 530 retain actionable tunnel error codes',
    () async {
      host.refuseStatus = 429;
      await expectLater(host.connect(), throwsA(_code('tunnel/busy')));
      host.refuseStatus = 530;
      await expectLater(host.connect(), throwsA(_code('tunnel/expired')));
    },
  );

  test(
    'text WS, oversized physical record and oversized SDATA fail closed',
    () async {
      final text = await host.connect();
      host.peers.last.socket.add('not binary');
      expect((await text.closed).code, 'invalid-argument');
      final large = await host.connect();
      host.peers.last.socket.add(Uint8List(maxWireBytes + 1));
      expect((await large.closed).code, 'invalid-argument');
      host.request = (peer, request) {
        final id = request['p']['streamId'] as int;
        peer.response(request, {'streamId': id});
        peer.send(5, Uint8List(32769), streamId: id);
      };
      final block = await host.connect();
      await block.open('stream.open', {});
      expect((await block.closed).code, 'invalid-argument');
    },
  );

  test('32 active streams cap does not affect ordinary RPCs', () async {
    host.request = (peer, request) => peer.response(request, {'ok': true});
    final connection = await host.connect();
    for (var i = 0; i < 32; i++) {
      await connection.open('stream.open', {});
    }
    await expectLater(
      connection.open('stream.open', {}),
      throwsA(_code('busy')),
    );
    expect(await connection.request('echo', {}), {'ok': true});
    connection.close();
  });

  test(
    'pairDevice requires manual SAS and validates granted receipt',
    () async {
      host.pairSid = 'AAAAAAAAAAAAAAAAAAAAAA';
      host.request = (peer, request) {
        expect(request['m'], 'pair.confirm');
        expect(
          request['p']['sas'],
          deriveSas(
            peer.noise.handshakeHash!,
            peer.noise.rs!,
            host.identity.publicKey,
          ),
        );
        peer.response(request, {
          'ok': true,
          'deviceId': host.identity.deviceId,
          'caps': ['session', 'stream'],
        });
      };
      final qr = PairingRequest.parse({
        'v': 1,
        'sid': host.pairSid,
        'exp': DateTime.now().millisecondsSinceEpoch ~/ 1000 + 60,
        'relay': host.endpoint,
        'pk': base64.encode(host.identity.publicKey),
        'name': 'Test host',
        'caps': ['session', 'stream'],
      });
      var confirmations = 0;
      final paired = await pairDevice(
        identity: Identity.generate(),
        payload: qr,
        confirm: (sas) async {
          expect(sas, matches(RegExp(r'^\d{6}$')));
          confirmations++;
          return true;
        },
      );
      expect(confirmations, 1);
      expect(paired.deviceId, host.identity.deviceId);
      expect(paired.caps, ['session', 'stream']);
      await expectLater(
        pairDevice(
          identity: Identity.generate(),
          payload: qr,
          confirm: (_) async => false,
        ),
        throwsA(_code('cancelled')),
      );
    },
  );
}
