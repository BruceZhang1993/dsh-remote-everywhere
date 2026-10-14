import 'dart:async';
import 'dart:io';
import 'dart:math';
import 'dart:typed_data';

import 'package:dsh_remote_core/bounded_websocket.dart';
import 'package:dsh_remote_core/frame.dart';
import 'package:test/test.dart';

Uint8List _header(int length, {int opcode = 2, bool fin = true}) {
  final bytes = Uint8List(
    length < 126
        ? 2
        : length < 65536
        ? 4
        : 10,
  );
  bytes[0] = (fin ? 0x80 : 0) | opcode;
  bytes[1] = bytes.length == 2
      ? length
      : bytes.length == 4
      ? 126
      : 127;
  final view = ByteData.sublistView(bytes);
  if (bytes.length == 4) view.setUint16(2, length);
  if (bytes.length == 10) view.setUint64(2, length);
  return bytes;
}

Uint8List _frame(int length, {int opcode = 2, bool fin = true}) =>
    Uint8List.fromList([
      ..._header(length, opcode: opcode, fin: fin),
      ...List.filled(length, 7),
    ]);

void main() {
  final rounds = int.parse(Platform.environment['DSH_FUZZ_ROUNDS'] ?? '10000');
  if (rounds < 1000 || rounds > 1000000)
    throw ArgumentError('DSH_FUZZ_ROUNDS must be 1000..1000000');
  test('split headers, coalesced frames and exact DR limit remain valid', () {
    final guard = WebSocketReceiveGuard();
    for (final byte in _header(maxWireBytes)) {
      guard.push(Uint8List.fromList([byte]));
    }
    guard.push(Uint8List(maxWireBytes));
    guard.push(Uint8List.fromList([..._frame(126), ..._frame(0)]));
    guard.finish();
  });

  test('oversized 64-bit declaration is rejected without its payload', () {
    for (final length in [maxWireBytes + 1, 0x7fffffffffffffff]) {
      final guard = WebSocketReceiveGuard();
      expect(() => guard.push(_header(length)), throwsFormatException);
      expect(() => guard.push(_frame(1)), throwsFormatException);
    }
  });

  test('tiny and empty fragments are bounded independently of byte size', () {
    final guard = WebSocketReceiveGuard()..push(_frame(0, fin: false));
    for (var index = 1; index < 1024; index++) {
      guard.push(_frame(0, opcode: 0, fin: false));
    }
    expect(() => guard.push(_header(0, opcode: 0)), throwsFormatException);
  });

  test('fragment budget includes continuation and survives control frames', () {
    final guard = WebSocketReceiveGuard();
    guard.push(_frame(32768, fin: false));
    guard.push(_frame(125, opcode: 9));
    guard.push(_frame(32768, opcode: 0, fin: false));
    expect(() => guard.push(_header(16, opcode: 0)), throwsFormatException);
    final exact = WebSocketReceiveGuard();
    exact.push(_frame(32768, fin: false));
    exact.push(_frame(maxWireBytes - 32768, opcode: 0));
    exact.push(_frame(maxWireBytes)); // Completed messages reset the budget.
    exact.finish();
  });

  test('masked, compressed, text, illegal opcode and invalid control fail', () {
    for (final bytes in [
      [0x82, 0x80],
      [0xc2, 0],
      [0x81, 0],
      [0x83, 0],
      [0x09, 0],
      [0x89, 126, 0, 126],
      [0x88, 1],
      [0x82, 126, 0, 125],
      [0x82, 127, 0, 0, 0, 0, 0, 0, 0, 126],
      [0x82, 127, 128, 0, 0, 0, 0, 0, 0, 0],
    ]) {
      expect(
        () => WebSocketReceiveGuard().push(Uint8List.fromList(bytes)),
        throwsFormatException,
        reason: '$bytes',
      );
    }
  });

  test(
    'orphan continuation, new message during fragments and truncation fail',
    () {
      expect(
        () => WebSocketReceiveGuard().push(_header(0, opcode: 0)),
        throwsFormatException,
      );
      final guard = WebSocketReceiveGuard()..push(_frame(1, fin: false));
      expect(() => guard.push(_frame(1)), throwsFormatException);
      for (final bytes in [
        Uint8List.fromList([0x82]),
        _header(126),
        _frame(0, fin: false),
      ]) {
        final truncated = WebSocketReceiveGuard()..push(bytes);
        expect(truncated.finish, throwsFormatException);
      }
    },
  );

  test(
    'seeded fragmented messages are invariant under TCP chunk boundaries',
    () {
      final random = Random(0x4d34);
      for (var iteration = 0; iteration < rounds ~/ 5; iteration++) {
        final length = random.nextInt(2048);
        final split = random.nextInt(length + 1);
        final bytes = Uint8List.fromList([
          ..._frame(split, fin: false),
          ..._frame(0, opcode: 9),
          ..._frame(length - split, opcode: 0),
          ..._frame(random.nextInt(130)),
        ]);
        final guard = WebSocketReceiveGuard();
        var offset = 0;
        while (offset < bytes.length) {
          final end = min(bytes.length, offset + 1 + random.nextInt(97));
          guard.push(Uint8List.sublistView(bytes, offset, end));
          offset = end;
        }
        guard.finish();
      }
    },
  );

  test(
    'seeded arbitrary headers reject cleanly without allocation by length',
    () {
      final random = Random(0x6455);
      for (var iteration = 0; iteration < rounds; iteration++) {
        final guard = WebSocketReceiveGuard();
        try {
          guard.push(
            Uint8List.fromList(List.generate(10, (_) => random.nextInt(256))),
          );
          guard.finish();
        } on FormatException {
          // Only a format failure is expected; RangeError/StateError must fail.
        }
      }
    },
  );

  for (final mode in [
    'declared',
    'cumulative',
    'network-eof',
    'control-interleave',
  ]) {
    test('SDK socket rejects $mode safely before a complete message', () async {
      final server = await ServerSocket.bind(InternetAddress.loopbackIPv4, 0);
      final accepted = server.first;
      final raw = await Socket.connect(
        InternetAddress.loopbackIPv4,
        server.port,
      );
      final peer = await accepted;
      final outgoing = BytesBuilder();
      final pong = Completer<void>();
      final peerSubscription = peer.listen((bytes) {
        outgoing.add(bytes);
        if (outgoing.length >= 9 && !pong.isCompleted) pong.complete();
      });
      final socket = WebSocket.fromUpgradedSocket(
        BoundedWebSocketSocket(raw),
        serverSide: false,
        compression: CompressionOptions.compressionOff,
        maxPayloadLength: maxWireBytes,
      );
      final done = Completer<void>();
      final first = Completer<void>();
      final received = <dynamic>[];
      final subscription = socket.listen((message) {
        received.add(message);
        if (!first.isCompleted) first.complete();
      }, onDone: done.complete);
      try {
        final fragmented = mode == 'cumulative';
        if (mode == 'control-interleave') {
          peer.add(
            Uint8List.fromList([2, 2, 4, 5, 0x89, 3, 1, 2, 3, 0x80, 2, 6, 7]),
          );
          await first.future.timeout(const Duration(seconds: 1));
          expect(received, [
            [4, 5, 6, 7],
          ]);
          await pong.future.timeout(const Duration(seconds: 1));
          final reply = outgoing.takeBytes();
          expect(reply[0], 0x8a);
          expect(reply[1], 0x83);
          expect(
            List.generate(3, (index) => reply[6 + index] ^ reply[2 + index]),
            [1, 2, 3],
          );
          return;
        }
        if (fragmented) peer.add(_frame(maxWireBytes, fin: false));
        peer.add(
          _header(
            mode == 'network-eof'
                ? 126
                : fragmented
                ? 1
                : maxWireBytes + 1,
            opcode: fragmented ? 0 : 2,
          ),
        );
        await peer.flush();
        if (mode == 'network-eof') peer.destroy();
        await done.future.timeout(const Duration(seconds: 1));
        expect(received, isEmpty);
        expect(
          socket.closeCode,
          mode == 'network-eof'
              ? WebSocketStatus.abnormalClosure
              : WebSocketStatus.invalidFramePayloadData,
        );
      } finally {
        raw.destroy();
        peer.destroy();
        await subscription.cancel();
        await peerSubscription.cancel();
        await server.close();
      }
    });
  }
}
