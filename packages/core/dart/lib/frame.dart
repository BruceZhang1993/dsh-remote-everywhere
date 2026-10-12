import 'dart:typed_data';
import 'noise_xx_blake2s.dart';

const int maxWireBytes = 65551;
const int maxSafeSequence = 9007199254740991;

class DrHeader {
  const DrHeader(this.kind, this.streamId, this.seq);
  final int kind;
  final int streamId;
  final int seq;

  Uint8List encode() {
    if (kind < 1 || kind > 6 || streamId < 0 || streamId > 0xffffffff || seq < 0 || seq > maxSafeSequence) {
      throw FormatException('invalid DR header');
    }
    final bytes = Uint8List(16);
    final view = ByteData.sublistView(bytes);
    view.setUint16(0, 0x4452, Endian.big);
    bytes[2] = 1;
    bytes[3] = kind;
    view.setUint32(4, streamId, Endian.big);
    view.setUint64(8, seq, Endian.big);
    return bytes;
  }

  static DrHeader decode(Uint8List bytes) {
    if (bytes.length < 16) throw FormatException('truncated DR header');
    final view = ByteData.sublistView(bytes);
    if (view.getUint16(0, Endian.big) != 0x4452 || bytes[2] != 1) throw FormatException('unsupported DR header');
    final value = DrHeader(bytes[3], view.getUint32(4, Endian.big), view.getUint64(8, Endian.big));
    value.encode();
    return value;
  }
}

Uint8List encryptFrame(DrHeader header, CipherState cipher, List<int> plaintext) {
  if (plaintext.length > 65519) throw FormatException('payload requires chunking');
  final bytes = header.encode();
  return concatBytes([bytes, cipher.encrypt(plaintext, bytes)]);
}

Uint8List decryptFrame(Uint8List bytes, CipherState cipher, {required int expectedSeq, required int expectedStreamId}) {
  if (bytes.length > maxWireBytes || bytes.length < 32) throw FormatException('invalid DR record length');
  final header = DrHeader.decode(bytes);
  if (header.seq != expectedSeq || header.streamId != expectedStreamId) throw FormatException('unexpected DR sequence or stream');
  return cipher.decrypt(bytes.sublist(16), bytes.sublist(0, 16));
}
