// ignore_for_file: avoid_print  // scratch CLI probe
import 'dart:typed_data';
import 'package:pointycastle/export.dart' as pc;
import 'package:cryptography/cryptography.dart';

void main() async {
  final key = Uint8List.fromList(List.filled(32, 0x1c));
  final aad = Uint8List.fromList(List.filled(16, 0xa0));
  final pt = Uint8List.fromList(List.generate(77, (i) => (i * 7 + 11) % 251));
  final nonce = Uint8List(12)..[4] = 1;
  final cipher = pc.ChaCha20Poly1305(pc.ChaCha7539Engine(), pc.Poly1305())
    ..init(true, pc.AEADParameters(pc.KeyParameter(key), 128, nonce, aad));
  final out = cipher.process(pt);
  print('pt len=${pt.length} out len=${out.length} mac=${cipher.mac.length}');
  print('out hex=${out.map((b)=>b.toRadixString(16).padLeft(2,'0')).join()}');
  final box = await Chacha20.poly1305Aead()
      .encrypt(pt, secretKey: SecretKey(key), nonce: nonce, aad: aad);
  print('cry ct= ${box.cipherText.map((b)=>b.toRadixString(16).padLeft(2,'0')).join()}');
  print('cry tag=${box.mac.bytes.map((b)=>b.toRadixString(16).padLeft(2,'0')).join()}');
  print('pc  tag=${cipher.mac.map((b)=>b.toRadixString(16).padLeft(2,'0')).join()}');
}
