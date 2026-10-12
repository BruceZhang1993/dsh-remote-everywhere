#!/usr/bin/env bash
set -euo pipefail
TASK_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TASK_GATE="$(mktemp -d -t dsh-remote-android-XXXXXX)"
trap 'rm -rf "$TASK_GATE"' EXIT
flutter create --platforms android --project-name m1_android_gate --org dev.dshremote "$TASK_GATE"
python3 - "$TASK_GATE/pubspec.yaml" "$TASK_ROOT/packages/core/dart" "$TASK_GATE/android/gradle.properties" <<'PY'
import sys
from pathlib import Path
pubspec = Path(sys.argv[1])
pubspec.write_text(pubspec.read_text().replace('dependencies:\n', 'dependencies:\n  dsh_remote_core:\n    path: "' + sys.argv[2] + '"\n', 1))
gradle = Path(sys.argv[3])
lines = gradle.read_text().splitlines()
gradle.write_text('\n'.join('org.gradle.jvmargs=-Xmx2G -XX:MaxMetaspaceSize=1G -XX:+HeapDumpOnOutOfMemoryError' if line.startswith('org.gradle.jvmargs=') else line for line in lines) + '\n')
PY
cat > "$TASK_GATE/lib/main.dart" <<'DART'
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:dsh_remote_core/frame.dart';
import 'package:dsh_remote_core/noise_xx_blake2s.dart';
void main() {
  final initiatorKey = Uint8List.fromList(List.generate(32, (index) => index));
  final responderKey = Uint8List.fromList(List.generate(32, (index) => 31 - index));
  final prologue = utf8Bytes('M1 Android AOT gate');
  final initiator = NoiseXX(initiator: true, staticSecretKey: initiatorKey,
    staticPublicKey: publicKeyFromSecret(initiatorKey), prologue: prologue);
  final responder = NoiseXX(initiator: false, staticSecretKey: responderKey,
    staticPublicKey: publicKeyFromSecret(responderKey), prologue: prologue);
  responder.readMessage(initiator.writeMessage());
  initiator.readMessage(responder.writeMessage());
  responder.readMessage(initiator.writeMessage());
  final wire = encryptFrame(const DrHeader(5, 1, 0), initiator.tx!, utf8Bytes('M1 Android AOT gate'));
  final result = decryptFrame(wire, responder.rx!, expectedSeq: 0, expectedStreamId: 1);
  runApp(MaterialApp(home: Scaffold(body: Center(child: Text(toHex(result))))));
}
DART
cd "$TASK_GATE"
flutter pub get
flutter build apk --release
mkdir -p "$TASK_ROOT/.cache"
cp build/app/outputs/flutter-apk/app-release.apk "$TASK_ROOT/.cache/m1-android-gate.apk"
printf 'M1 Android AOT artifact: %s\n' "$TASK_ROOT/.cache/m1-android-gate.apk"
sha256sum "$TASK_ROOT/.cache/m1-android-gate.apk"
