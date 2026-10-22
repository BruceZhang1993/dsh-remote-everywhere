import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:dsh_remote_core/remote_connection.dart';
import 'package:dsh_remote_mobile/controller.dart';
import 'package:dsh_remote_mobile/platform/identity_vault.dart';

class DelayedIdentityStore implements KeyValueStore {
  final identityRead = Completer<String?>();
  int reads = 0;
  @override
  Future<String?> read(String key) {
    if (key == 'identity-v1') {
      reads++;
      return identityRead.future;
    }
    return Future.value(null);
  }

  @override
  Future<void> write(String key, String value) async {}
}

class _DelayedDeviceStore extends FakeKeyValueStore {
  Completer<void>? release;
  final writing = Completer<void>();
  int pendingWrites = 0;

  @override
  Future<void> write(String key, String value) async {
    final wait = release;
    if (key == 'trusted-devices-v1' && wait != null) {
      pendingWrites++;
      if (!writing.isCompleted) writing.complete();
      await wait.future;
      pendingWrites--;
    }
    await super.write(key, value);
  }
}

void main() {
  testWidgets('concurrent device writes cannot restore a forgotten device', (
    tester,
  ) async {
    final store = _DelayedDeviceStore();
    final vault = IdentityVault(store: store);
    final identity = await vault.loadIdentity();
    final target = TrustedDevice(
      deviceId: identity.deviceId,
      publicKey: base64Url.encode(identity.publicKey),
      name: 'Desktop',
      caps: ['session'],
      endpoints: ['wss://desktop.example.com/remote/ws'],
    );
    await vault.saveDevices([target]);
    final controller = MobileController(vault);
    await controller.initialize();
    store.release = Completer<void>();
    final renaming = controller.renameDevice(target, 'Renamed');
    await store.writing.future;
    final forgetting = controller.forget(target);
    await tester.pump();
    expect(store.pendingWrites, 1);
    store.release!.complete();
    await Future.wait([renaming, forgetting]);
    expect(controller.devices, isEmpty);
    expect(await vault.loadDevices(), isEmpty);
    expect(controller.endpoints, isEmpty);
    controller.dispose();
  });

  testWidgets(
    'cold start restores addresses and rename preserves history while forget removes it',
    (tester) async {
      final store = FakeKeyValueStore();
      final vault = IdentityVault(store: store);
      final identity = await vault.loadIdentity();
      final history = [
        'wss://192.168.1.20/remote/ws',
        'wss://desktop.example.com/remote/ws',
      ];
      await vault.saveDevices([
        TrustedDevice(
          deviceId: identity.deviceId,
          publicKey: base64Url.encode(identity.publicKey),
          name: 'Desktop',
          caps: ['session'],
          endpoints: history,
        ),
      ]);
      final controller = MobileController(vault);
      await controller.initialize();
      expect(controller.endpoints[identity.deviceId], history.first);
      await controller.renameDevice(controller.devices.single, 'Renamed');
      final restored = await IdentityVault(store: store).loadDevices();
      expect(restored.single.name, 'Renamed');
      expect(restored.single.endpoints, history);
      await controller.forget(controller.devices.single);
      expect(await vault.loadDevices(), isEmpty);
      expect(controller.endpoints, isEmpty);
      controller.dispose();
    },
  );

  testWidgets('late secure identity is wiped after controller disposal', (
    tester,
  ) async {
    final store = DelayedIdentityStore();
    final vault = IdentityVault(store: store);
    final controller = MobileController(vault);
    final initializing = controller.initialize();
    controller.dispose();
    store.identityRead.complete(base64Url.encode(List.filled(32, 7)));
    await initializing;
    final loaded = await vault.loadIdentity();
    expect(loaded.secretKey, everyElement(0));
    expect(controller.identity, isNull);
    expect(controller.initialized, isFalse);
    expect(tester.takeException(), isNull);
  });

  testWidgets('concurrent initialization borrows one identity owner', (
    tester,
  ) async {
    final store = DelayedIdentityStore();
    final controller = MobileController(IdentityVault(store: store));
    final first = controller.initialize();
    final second = controller.initialize();
    expect(store.reads, 1);
    store.identityRead.complete(base64Url.encode(List.filled(32, 8)));
    await first;
    await second;
    expect(controller.initialized, isTrue);
    controller.dispose();
  });

  testWidgets('explicit disconnect stays stopped after background and resume', (
    tester,
  ) async {
    final controller = MobileController(
      IdentityVault(store: FakeKeyValueStore()),
    );
    await controller.initialize();
    controller.device = TrustedDevice(
      deviceId: 'test-device',
      publicKey: base64Url.encode(controller.identity!.publicKey),
      name: 'Test',
      caps: ['session', 'stream'],
    );
    controller.endpoints['test-device'] = 'ws://127.0.0.1:1/remote/ws';
    await controller.disconnect();
    controller.didChangeAppLifecycleState(AppLifecycleState.paused);
    controller.didChangeAppLifecycleState(AppLifecycleState.resumed);
    await tester.pump();
    expect(controller.connected, isFalse);
    expect(controller.status, '未连接');
    await expectLater(
      controller.ensureConnected(),
      throwsA(
        isA<RemoteException>().having(
          (error) => error.code,
          'code',
          'transport/lost',
        ),
      ),
    );
    controller.dispose();
  });

  testWidgets(
    'combined attachment budget rejects before creating a pending prompt',
    (tester) async {
      final controller = MobileController(
        IdentityVault(store: FakeKeyValueStore()),
      );
      controller.address = {'kind': 'session', 'sessionId': 's'};
      controller.attachments.addAll(
        List.generate(
          4,
          (_) => {
            'type': 'image',
            'mediaType': 'image/png',
            'data': List.filled(48000, 'a').join(),
          },
        ),
      );
      await expectLater(
        controller.prompt('hello'),
        throwsA(
          isA<RemoteException>().having(
            (error) => error.code,
            'code',
            'invalid-argument',
          ),
        ),
      );
      expect(controller.pendingPrompt, isNull);
      expect(controller.attachments.length, 4);
      controller.dispose();
    },
  );

  testWidgets(
    'UTF-8 prompt budget includes multibyte content and preserves draft ownership',
    (tester) async {
      final controller = MobileController(
        IdentityVault(store: FakeKeyValueStore()),
      );
      controller.address = {'kind': 'session', 'sessionId': 's'};
      await expectLater(
        controller.prompt(List.filled(22000, '中').join()),
        throwsA(
          isA<RemoteException>().having(
            (error) => error.code,
            'code',
            'invalid-argument',
          ),
        ),
      );
      expect(controller.pendingPrompt, isNull);
      controller.dispose();
    },
  );

  testWidgets('one user action cannot re-enter another pending write', (
    tester,
  ) async {
    final controller = MobileController(
      IdentityVault(store: FakeKeyValueStore()),
    );
    final admitted = Completer<void>();
    var calls = 0;
    final first = controller.action(() async {
      calls++;
      await admitted.future;
    });
    await controller.action(() async {
      calls++;
    });
    expect(calls, 1);
    expect(controller.busy, isTrue);
    admitted.complete();
    await first;
    expect(controller.busy, isFalse);
    await controller.action(() async {
      throw const FormatException('invalid action');
    });
    expect(controller.error, 'invalid action');
    expect(controller.busy, isFalse);
    controller.dispose();
  });
}
