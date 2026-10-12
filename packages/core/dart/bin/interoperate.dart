// TCP application-wire smoke against the production Node SecureConnection.
import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';
import 'package:dsh_remote_core/noise_xx_blake2s.dart';
import 'package:dsh_remote_core/frame.dart';
import 'package:dsh_remote_core/protocol_types.dart';

Stream<Uint8List> records(Stream<Uint8List> chunks) async* {
  var prefix = Uint8List(4);
  Uint8List? record;
  var offset = 0;
  await for (final chunk in chunks) {
    var position = 0;
    while (position < chunk.length) {
      final target = record ?? prefix;
      final remaining = target.length - offset;
      final count = remaining < chunk.length - position ? remaining : chunk.length - position;
      target.setRange(offset, offset + count, chunk, position);
      offset += count;
      position += count;
      if (offset != target.length) continue;
      offset = 0;
      if (record == null) {
        final length = ByteData.sublistView(prefix).getUint32(0, Endian.big);
        if (length < 1 || length > maxWireBytes) throw FormatException('invalid TCP record');
        record = Uint8List(length);
      } else {
        final completed = record;
        record = null;
        yield completed;
      }
    }
  }
}

Future<void> main(List<String> args) async {
  Socket? socket;
  StreamIterator<Uint8List>? incoming;
  try {
    final vectors = jsonDecode(File(args[2]).readAsStringSync()) as Map<String, dynamic>;
    final static = vectors['applicationBindings']['initiatorStatic'];
    final localSecret = fromHex(static['secretKey'] as String);
    final localPublic = fromHex(static['publicKey'] as String);
    final remotePublic = fromHex(args[1]);
    final remoteId = base64Url.encode(sha256(remotePublic).sublist(0, 16)).replaceAll('=', '');
    final noise = NoiseXX(initiator: true, staticSecretKey: localSecret, staticPublicKey: localPublic,
      prologue: utf8Bytes('dsh-remote/v1/resume:$remoteId${args.contains('--mismatch') ? '-wrong' : ''}'));
    socket = await Socket.connect('127.0.0.1', int.parse(args[0])).timeout(const Duration(seconds: 5));
    incoming = StreamIterator(records(socket));
    Future<Uint8List> read() async {
      if (!await incoming!.moveNext().timeout(const Duration(seconds: 5))) throw StateError('peer ended');
      return incoming!.current;
    }
    void send(List<int> bytes) {
      final prefix = Uint8List(4);
      ByteData.sublistView(prefix).setUint32(0, bytes.length, Endian.big);
      socket!.add(concatBytes([prefix, bytes]));
    }
    send(noise.writeMessage());
    noise.readMessage(await read());
    if (toHex(noise.rs!) != toHex(remotePublic)) throw StateError('peer pin mismatch');
    send(noise.writeMessage());
    final hello = {
      'type': 'hello', 'vmin': 1, 'vmax': 1, 'caps': ['diagnostic', 'stream'],
      'role': 'controller', 'kind': 'cli', 'name': 'Dart M1 smoke',
      'deviceId': base64Url.encode(sha256(localPublic).sublist(0, 16)).replaceAll('=', ''),
    };
    send(encryptFrame(const DrHeader(4, 0, 0), noise.tx!, utf8Bytes(jsonEncode(hello))));
    final opening = Hello((jsonDecode(utf8.decode(decryptFrame(await read(), noise.rx!, expectedSeq: 0, expectedStreamId: 0))) as Map).cast<String, Object?>());
    if (opening.deviceId != remoteId || opening.role != 'controlled') throw StateError('invalid peer hello');
    send(encryptFrame(const DrHeader(1, 0, 1), noise.tx!, utf8Bytes(jsonEncode({
      'id': 'AAAAAAAAAAA', 'm': 'diagnostic.echo', 'p': {'message': '你好，Node↔Dart'},
    }))));
    final replyWire = await read();
    final reply = jsonDecode(utf8.decode(decryptFrame(replyWire, noise.rx!, expectedSeq: 1, expectedStreamId: 0))) as Map;
    if (reply['r']['message'] != '你好，Node↔Dart') throw StateError('application payload mismatch');
    var replayRejected = false;
    try { decryptFrame(replyWire, noise.rx!, expectedSeq: 1, expectedStreamId: 0); }
    catch (_) { replayRejected = true; }
    if (!replayRejected) throw StateError('replay accepted');
    stdout.writeln(jsonEncode({'passed': true, 'encryptedRpc': true, 'replayRejected': true}));
  } catch (_) {
    stderr.writeln('Dart application-wire handshake failed');
    exitCode = 1;
  } finally {
    await incoming?.cancel();
    socket?.destroy();
  }
}
