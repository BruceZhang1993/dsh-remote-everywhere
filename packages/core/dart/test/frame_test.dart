import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';
import 'package:cryptography/cryptography.dart' hide CipherState;
import 'package:cryptography/dart.dart';
import 'package:dsh_remote_core/noise_xx_blake2s.dart';
import 'package:dsh_remote_core/frame.dart';
import 'package:test/test.dart';

void main() {
  final vectors = jsonDecode(File('../../protocol/vectors/dr-v1.json').readAsStringSync()) as Map<String, dynamic>;
  final key = fromHex(vectors['testKey'] as String);
  for (final value in vectors['frames'] as List) {
    test('Node frame ${value['kind']} is byte-identical in Dart', () {
      final header = DrHeader(value['kind'] as int, value['streamId'] as int, value['seq'] as int);
      expect(toHex(header.encode()), value['header']);
      final plaintext = fromHex(value['plaintext'] as String);
      final wire = encryptFrame(header, CipherState(key), plaintext);
      expect(toHex(wire), value['wire']);
      expect(decryptFrame(wire, CipherState(key), expectedSeq: header.seq, expectedStreamId: header.streamId), plaintext);
      final corrupted = Uint8List.fromList(wire)..[16] ^= 1;
      final receiver = CipherState(key);
      expect(() => decryptFrame(corrupted, receiver, expectedSeq: header.seq, expectedStreamId: header.streamId), throwsA(anything));
      expect(receiver.n, 0);
      final modifiedHeader = Uint8List.fromList(wire)..[3] = header.kind == 1 ? 2 : 1;
      expect(() => decryptFrame(modifiedHeader, CipherState(key), expectedSeq: header.seq, expectedStreamId: header.streamId), throwsA(anything));
    });
  }
  test('invalid headers, unsafe integer and oversized plaintext are rejected', () {
    expect(() => DrHeader.decode(Uint8List(15)), throwsFormatException);
    expect(() => const DrHeader(1, 0, maxSafeSequence + 1).encode(), throwsFormatException);
    expect(() => encryptFrame(const DrHeader(1, 0, 0), CipherState(key), Uint8List(65520)), throwsFormatException);
  });
  test('upstream incorrect HMAC remains characterized; production HMAC uses B=64', () async {
    final broken = await Hmac(const DartBlake2s()).calculateMac(utf8.encode('abc'), secretKey: SecretKey(utf8.encode('secret')));
    expect(toHex(Uint8List.fromList(broken.bytes)), startsWith('773a1d7d'));
    expect(toHex(hmacBlake2s(utf8.encode('secret'), [utf8.encode('abc')])), startsWith('38441ee1'));
  });
}
