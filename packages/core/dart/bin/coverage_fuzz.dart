// Synthetic inputs only. Never load application identities or network endpoints.
import 'dart:convert';
import 'dart:developer';
import 'dart:io';
import 'dart:isolate';
import 'dart:math';
import 'dart:typed_data';

import 'package:cryptography/cryptography.dart'
    show SecretBoxAuthenticationError;
import 'package:dsh_remote_core/bounded_websocket.dart';
import 'package:dsh_remote_core/frame.dart';
import 'package:dsh_remote_core/noise_xx_blake2s.dart';

void require(bool condition, String message) {
  if (!condition) throw StateError('fuzz invariant: $message');
}

void rejected(void Function() operation, bool Function(Object) expected) {
  try {
    operation();
  } catch (error) {
    if (expected(error)) return;
    rethrow;
  }
  throw StateError('fuzz invariant: invalid operation was accepted');
}

bool authenticationError(Object error) =>
    error is SecretBoxAuthenticationError ||
    error is StateError &&
        error.message ==
            'Noise: X25519 low-order point rejected (all-zero shared secret)';

Uint8List wsFrame(List<int> body, {int opcode = 2, bool fin = true}) {
  final size = body.length < 126
      ? 2
      : body.length < 65536
      ? 4
      : 10;
  final result = Uint8List(size + body.length);
  result[0] = (fin ? 128 : 0) | opcode;
  result[1] = size == 2
      ? body.length
      : size == 4
      ? 126
      : 127;
  if (size == 4) ByteData.sublistView(result).setUint16(2, body.length);
  if (size == 10) ByteData.sublistView(result).setUint64(2, body.length);
  result.setRange(size, result.length, body);
  return result;
}

({List<String> frames, bool rejected}) receive(Uint8List wire, bool chunked) {
  final guard = WebSocketReceiveGuard(), frames = <String>[];
  var failed = false;
  try {
    for (var offset = 0; offset < wire.length;) {
      final end = chunked
          ? min(wire.length, offset + 1 + wire[offset] % 31)
          : wire.length;
      guard.push(
        Uint8List.sublistView(wire, offset, end),
        onFrame: (frame) => frames.add(toHex(frame)),
      );
      offset = end;
    }
  } on FormatException {
    failed = true;
    rejected(() => guard.push(wsFrame([])), (e) => e is FormatException);
  }
  if (!failed) {
    try {
      guard.finish();
    } on FormatException {
      failed = true;
    }
  }
  guard.discard();
  return (frames: frames, rejected: failed);
}

final _secrets = List.generate(
  4,
  (i) => Uint8List(32)..fillRange(0, 32, i + 1),
);
final _public = _secrets.take(2).map(publicKeyFromSecret).toList();

({NoiseXX i, NoiseXX r}) pair({bool mismatched = false, String sid = 'fuzz'}) =>
    (
      i: NoiseXX(
        initiator: true,
        staticSecretKey: _secrets[0],
        staticPublicKey: _public[0],
        ephemeralSecretKey: sha256(concatBytes([_secrets[2], utf8Bytes(sid)])),
        prologue: prologueForSession(sid),
      ),
      r: NoiseXX(
        initiator: false,
        staticSecretKey: _secrets[1],
        staticPublicKey: _public[1],
        ephemeralSecretKey: sha256(concatBytes([_secrets[3], utf8Bytes(sid)])),
        prologue: prologueForSession(mismatched ? '$sid-other' : sid),
      ),
    );

void complete(({NoiseXX i, NoiseXX r}) p, Uint8List payload) {
  require(
    constantTimeEquals(p.r.readMessage(p.i.writeMessage(payload)), payload),
    'message 1 payload',
  );
  require(
    constantTimeEquals(p.i.readMessage(p.r.writeMessage(payload)), payload),
    'message 2 payload',
  );
  require(
    constantTimeEquals(p.r.readMessage(p.i.writeMessage(payload)), payload),
    'message 3 payload',
  );
  require(p.i.complete && p.r.complete, 'handshake completion');
  require(
    constantTimeEquals(p.i.handshakeHash!, p.r.handshakeHash!),
    'handshake hash',
  );
  require(
    constantTimeEquals(p.i.rs!, _public[1]) &&
        constantTimeEquals(p.r.rs!, _public[0]),
    'static identities',
  );
}

void exerciseNoise(Uint8List data) {
  final mode = data.isEmpty ? 0 : data[0] % 8;
  final payload = Uint8List.sublistView(data, min(1, data.length));
  final p = pair(mismatched: mode == 6);
  if (mode == 1) {
    rejected(
      () => p.i.readMessage(Uint8List(32)),
      (e) =>
          e is StateError &&
          e.message == 'readMessage: wrong role/index (0, initiator=true)',
    );
    rejected(
      () => p.r.writeMessage(payload),
      (e) =>
          e is StateError &&
          e.message == 'writeMessage: wrong role/index (0, initiator=false)',
    );
    return;
  }
  if (mode == 5) {
    final lowOrder = Uint8List(32)..[0] = payload.isEmpty ? 0 : payload[0] % 2;
    p.r.readMessage(lowOrder); // Message 1 is unauthenticated; DH happens at 2.
    rejected(() => p.r.writeMessage(payload), authenticationError);
    require(!p.r.complete, 'low-order key cannot complete handshake');
    return;
  }
  if (mode == 0 || mode == 7) {
    complete(p, payload);
    final encrypted = p.i.tx!.encrypt(payload);
    final corrupted = Uint8List.fromList(encrypted)
      ..[encrypted.length - 1] ^= 1;
    rejected(() => p.r.rx!.decrypt(corrupted), authenticationError);
    require(p.r.rx!.n == 0, 'bad tag must not advance nonce');
    require(
      constantTimeEquals(p.r.rx!.decrypt(encrypted), payload),
      'transport payload',
    );
    rejected(() => p.r.rx!.decrypt(encrypted), authenticationError);
    require(p.r.rx!.n == 1, 'replay must not advance nonce');
    require(
      constantTimeEquals(p.i.rx!.decrypt(p.r.tx!.encrypt(payload)), payload),
      'reverse transport',
    );
    if (mode == 7) {
      final other = pair(sid: 'other-session');
      complete(other, payload);
      require(
        !constantTimeEquals(p.i.tx!.k!, other.i.tx!.k!),
        'sessions need distinct synthetic ephemeral keys',
      );
      rejected(() => other.r.rx!.decrypt(encrypted), authenticationError);
    }
    rejected(
      () => p.i.writeMessage(),
      (e) => e is StateError && e.message == 'handshake already complete',
    );
    p.i.tx!.n = 0xffffffff;
    rejected(
      () => p.i.tx!.encrypt(payload),
      (e) => e is StateError && e.message == 'CipherState nonce exhausted',
    );
    return;
  }
  p.r.readMessage(p.i.writeMessage(payload));
  final second = p.r.writeMessage(payload);
  if (mode == 2 || mode == 6) {
    if (mode == 2)
      second[(payload.isEmpty ? 0 : payload[0]) % second.length] ^= 1;
    rejected(() => p.i.readMessage(second), authenticationError);
    require(
      !p.i.complete && p.i.messageIndex == 1,
      'bad message 2 cannot advance',
    );
  } else if (mode == 3) {
    final length = (payload.isEmpty ? 0 : payload[0]) % second.length;
    rejected(
      () => p.i.readMessage(second.sublist(0, length)),
      (e) =>
          authenticationError(e) ||
          e is StateError && e.message == 'invalid Noise handshake length',
    );
    require(
      !p.i.complete && p.i.messageIndex == 1,
      'truncated message 2 cannot advance',
    );
  } else {
    p.i.readMessage(second);
    final third = p.i.writeMessage(payload);
    third[(payload.isEmpty ? 0 : payload[0]) % third.length] ^= 1;
    rejected(() => p.r.readMessage(third), authenticationError);
    require(
      !p.r.complete && p.r.messageIndex == 2,
      'bad message 3 cannot advance',
    );
  }
}

void exercise(Uint8List input) {
  final family = input.isEmpty ? 0 : input[0] % 4;
  final data = Uint8List.sublistView(input, min(1, input.length));
  switch (family) {
    case 0:
      try {
        final header = DrHeader.decode(data);
        require(
          constantTimeEquals(header.encode(), data.sublist(0, 16)),
          'DR header round trip',
        );
      } on FormatException {
        /* Expected malformed header. */
      }
      final key = _secrets[0];
      final wire = encryptFrame(
        const DrHeader(1, 3, 0),
        CipherState(key),
        data,
      );
      final receiver = CipherState(key);
      require(
        constantTimeEquals(
          decryptFrame(wire, receiver, expectedSeq: 0, expectedStreamId: 3),
          data,
        ),
        'DR record round trip',
      );
      rejected(
        () => decryptFrame(wire, receiver, expectedSeq: 0, expectedStreamId: 3),
        authenticationError,
      );
      require(receiver.n == 1, 'DR replay nonce');
      break;
    case 1:
      final whole = receive(data, false), chunks = receive(data, true);
      require(
        whole.rejected == chunks.rejected &&
            whole.frames.join(',') == chunks.frames.join(','),
        'WebSocket TCP chunk invariance',
      );
      break;
    case 2:
      exerciseNoise(data);
      break;
    case 3:
      if (data.isNotEmpty && data[0] == 255) {
        final wire = concatBytes([
          wsFrame([], fin: false),
          for (var i = 1; i < 1025; i++) wsFrame([], opcode: 0, fin: i == 1024),
        ]);
        require(receive(wire, true).rejected, 'fragment count limit');
        break;
      }
      if (data.isNotEmpty && data[0] >= 253) {
        final wire = concatBytes([
          wsFrame(Uint8List(maxWireBytes), fin: data[0] == 253),
          if (data[0] == 254) wsFrame([1], opcode: 0),
        ]);
        require(
          receive(wire, true).rejected == (data[0] == 254),
          'cumulative DR wire limit',
        );
        break;
      }
      final split = data.isEmpty ? 0 : data[0] % (data.length + 1);
      final ping = data.sublist(0, min(data.length, 125));
      final wire = concatBytes([
        wsFrame(data.sublist(0, split), fin: false),
        wsFrame(ping, opcode: 9),
        wsFrame(data.sublist(split), opcode: 0),
      ]);
      final result = receive(wire, true);
      require(
        !result.rejected &&
            result.frames.join(',') ==
                [
                  toHex(wsFrame(ping, opcode: 9)),
                  toHex(wsFrame(data)),
                ].join(','),
        'control payload must not replace fragmented data',
      );
      break;
  }
}

List<Uint8List> seeds() => [
  Uint8List(0),
  Uint8List.fromList([0, ...const DrHeader(1, 3, 0).encode()]),
  for (final wire in <List<int>>[
    [], [0x82], [0x82, 0], [0x80, 0], [0x81, 0], [0x82, 0x80],
    [0xc2, 0], [0x09, 0], [0x88, 1], [0x89, 126, 0, 126],
    [0x82, 126, 0, 125], [0x82, 127, 0, 0, 0, 0, 0, 0, 0, 126],
    [0x82, 127, 128, 0, 0, 0, 0, 0, 0, 0],
    [0x82, 127, 0, 0, 0, 0, 0, 1, 0, 16], // Declared > DR limit.
    [2, 2, 4, 5, 0x89, 3, 1, 2, 3, 0x80, 2, 6, 7],
  ])
    Uint8List.fromList([1, ...wire]),
  for (var mode = 0; mode < 8; mode++) Uint8List.fromList([2, mode, 9, 7, 5]),
  for (final length in [0, 1, 125, 126, 1023])
    Uint8List.fromList([3, ...List.generate(length, (i) => (i + 17) % 256)]),
  for (final boundary in [253, 254, 255]) Uint8List.fromList([3, boundary]),
];

Future<Set<String>> coverage(HttpClient client, Uri service) async {
  final request = await client.getUrl(
    service.replace(
      path: '${service.path}getSourceReport',
      queryParameters: {
        'isolateId': Service.getIsolateId(Isolate.current)!,
        // The VM HTTP API accepts unquoted list elements, unlike JSON-RPC.
        'reports': '[Coverage]', 'libraryFilters': '[package:dsh_remote_core/]',
      },
    ),
  );
  final response = await request.close();
  final bytes = BytesBuilder();
  await for (final chunk in response) {
    if (bytes.length + chunk.length > 512 * 1024)
      throw StateError('coverage response exceeds budget');
    bytes.add(chunk);
  }
  final body =
      jsonDecode(utf8.decode(bytes.takeBytes())) as Map<String, dynamic>;
  if (response.statusCode != 200 || body['error'] != null)
    throw StateError('VM coverage request failed');
  final report = body['result'] as Map<String, dynamic>;
  final scripts = report['scripts'] as List;
  return {
    for (final range in report['ranges'] as List)
      for (final hit in (range['coverage']?['hits'] as List? ?? []))
        '${scripts[range['scriptIndex']]['uri']}:$hit',
  };
}

Future<void> main(List<String> args) async {
  final seconds = int.parse(
    Platform.environment['DSH_DART_FUZZ_SECONDS'] ?? '60',
  );
  final limit = int.parse(
    Platform.environment['DSH_DART_FUZZ_ITERATIONS'] ?? '1000000',
  );
  if (seconds < 10 ||
      seconds > 3600 ||
      limit < 100 ||
      limit > 1000000 ||
      (args.isNotEmpty && (args.length != 2 || args[0] != '--replay'))) {
    throw ArgumentError(
      'budget: seconds 10..3600, iterations 100..1000000; optional --replay report.json',
    );
  }
  Uint8List decodeInput(dynamic value) {
    if (value is! String || value.length > 1368)
      throw FormatException('invalid corpus encoding');
    final bytes = base64Decode(value);
    if (bytes.length > 1024) throw FormatException('input exceeds budget');
    return bytes;
  }

  Uint8List? replay;
  if (args.isNotEmpty) {
    final file = File(args[1]);
    if (file.lengthSync() > 512 * 1024)
      throw FormatException('replay file exceeds budget');
    replay = decodeInput((jsonDecode(file.readAsStringSync()) as Map)['input']);
  }
  final directory = Directory.fromUri(
    Platform.script.resolve('../../../../.cache/dart-fuzz/'),
  )..createSync(recursive: true);
  final reportFile = File('${directory.path}/report.json');
  final corpusFile = File('${directory.path}/corpus.json');
  final sourceHashes = {
    for (final file in [
      'frame.dart',
      'bounded_websocket.dart',
      'noise_xx_blake2s.dart',
    ])
      file: toHex(
        sha256(
          File.fromUri(Platform.script.resolve('../lib/$file'))
              .readAsBytesSync(),
        ),
      ),
  };
  final provenance = {
    'sourceCommit': Platform.environment['GITHUB_SHA'],
    'sourceHashes': sourceHashes,
    'harnessSha256': toHex(
      sha256(File.fromUri(Platform.script).readAsBytesSync()),
    ),
    'lockSha256': toHex(
      sha256(
        File.fromUri(Platform.script.resolve('../pubspec.lock'))
            .readAsBytesSync(),
      ),
    ),
  };
  reportFile.writeAsStringSync(
    jsonEncode({'passed': false, 'status': 'running', ...provenance}),
  );
  final client = HttpClient()..connectionTimeout = const Duration(seconds: 5);
  var state = 0x4434465a, iterations = 0, discoveries = 0, seededPositions = 0;
  var input = Uint8List(0);
  final corpus = <Uint8List>[], seen = <String>{}, positions = <String>{};
  int next(int max) {
    state = (state ^ (state << 13)) & 0xffffffff;
    state = (state ^ (state >> 17)) & 0xffffffff;
    state = (state ^ (state << 5)) & 0xffffffff;
    return state % max;
  }

  final started = Stopwatch()..start();
  var lastProgress = 0;
  try {
    final service = (await Service.getInfo()).serverUri;
    if (service == null ||
        !['127.0.0.1', '::1', 'localhost'].contains(service.host))
      throw StateError('loopback VM service required');
    final initial = replay == null ? seeds() : [replay];
    if (replay == null && corpusFile.existsSync()) {
      if (corpusFile.lengthSync() > 512 * 1024)
        throw FormatException('corpus file exceeds budget');
      final saved = jsonDecode(corpusFile.readAsStringSync()) as Map;
      if (saved['format'] != 1 ||
          saved['inputs'] is! List ||
          (saved['inputs'] as List).length > 256)
        throw FormatException('invalid persisted corpus');
      initial.addAll((saved['inputs'] as List).map(decodeInput));
    }
    for (
      var index = 0;
      index < initial.length ||
          (replay == null &&
              iterations < limit &&
              started.elapsed.inSeconds < seconds);
      index++
    ) {
      final isSeed = index < initial.length;
      if (isSeed) {
        input = initial[index];
      } else {
        final bytes = List<int>.from(corpus[next(corpus.length)]);
        final offset = next(bytes.length + 1);
        switch (next(4)) {
          case 0:
            if (bytes.isEmpty) bytes.add(0);
            bytes[next(bytes.length)] ^= 1 + next(255);
            break;
          case 1:
            bytes.insert(offset, next(256));
            break;
          case 2:
            if (offset < bytes.length) bytes.removeAt(offset);
            break;
          case 3:
            bytes.insertAll(offset, corpus[next(corpus.length)]);
            break;
        }
        input = Uint8List.fromList(bytes.take(1024).toList());
      }
      // Preserve the current synthetic input even if a synchronous target hangs
      // and the outer watchdog must terminate the process.
      reportFile.writeAsStringSync(
        jsonEncode({
          'passed': false,
          'status': 'running',
          'input': base64Encode(input),
          'iterations': iterations,
          'state': state,
          ...provenance,
        }),
      );
      exercise(input);
      final hits = await coverage(
        client,
        service,
      ).timeout(const Duration(seconds: 5));
      final gained = hits.difference(positions);
      positions.addAll(hits);
      final encoded = base64Encode(input);
      if ((isSeed || gained.isNotEmpty) &&
          corpus.length < 256 &&
          seen.add(encoded))
        corpus.add(Uint8List.fromList(input));
      if (isSeed) {
        seededPositions = positions.length;
      } else {
        iterations++;
        if (gained.isNotEmpty) discoveries++;
      }
      if (started.elapsed.inSeconds - lastProgress >= 15) {
        stdout.writeln(
          jsonEncode({
            'iterations': iterations,
            'positions': positions.length,
            'corpus': corpus.length,
          }),
        );
        lastProgress = started.elapsed.inSeconds;
      }
    }
    if (replay == null) {
      for (final file in sourceHashes.keys) {
        require(
          positions.any((p) => p.startsWith('package:dsh_remote_core/$file:')),
          'no VM coverage for $file',
        );
      }
      corpusFile.writeAsStringSync(
        jsonEncode({
          'format': 1,
          'sourceHashes': sourceHashes,
          'inputs': corpus.map(base64Encode).toList(),
        }),
      );
    }
    final report = {
      'passed': true,
      'engine': 'Dart VM cumulative token-position coverage',
      'dart': Platform.version.split(' ').first,
      ...provenance,
      'seed': '0x4434465a',
      'secondsBudget': seconds,
      'iterationBudget': limit,
      'elapsedMs': started.elapsedMilliseconds,
      'iterations': iterations,
      'seededPositions': seededPositions,
      'executedPositions': positions.length,
      'positionsByTarget': {
        for (final file in sourceHashes.keys)
          file: positions
              .where((p) => p.startsWith('package:dsh_remote_core/$file:'))
              .length,
      },
      'discoveries': discoveries,
      'corpus': corpus.length,
      'replayed': replay != null,
      'scope': 'Dart DR, WebSocket receive guard and Noise handshake/transport; excludes SDK sockets, RemoteConnection lifecycle and Node Noise',
    };
    reportFile.writeAsStringSync('${jsonEncode(report)}\n');
    stdout.writeln(jsonEncode(report));
  } catch (error) {
    reportFile.writeAsStringSync(
      '${jsonEncode({'passed': false, 'input': base64Encode(input), 'iterations': iterations, 'state': state, ...provenance, 'error': error.runtimeType.toString()})}\n',
    );
    rethrow;
  } finally {
    client.close(force: true);
  }
}
