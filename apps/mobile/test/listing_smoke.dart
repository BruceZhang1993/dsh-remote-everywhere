import 'dart:async';
import 'dart:convert';
import 'dart:io';

// Run explicitly with `flutter test test/listing_smoke.dart` after pnpm install.

import 'package:flutter_test/flutter_test.dart';
import 'package:dsh_remote_core/remote_connection.dart';
import 'package:dsh_remote_mobile/controller.dart';
import 'package:dsh_remote_mobile/platform/identity_vault.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  // This suite connects to an isolated loopback host instead of mocking HTTP.
  HttpOverrides.global = null;

  for (final mode in ['large', 'legacy', 'sessionOnly', 'delayed', 'pairing']) {
    test(
      'mobile loads complete $mode listing and search from Node host',
      () async {
        final store = FakeKeyValueStore();
        final controller = MobileController(IdentityVault(store: store));
        await controller.initialize();
        final host = await Process.start('node', [
          File('../../tools/fixtures/listing-host.mjs').absolute.path,
          base64Url.encode(controller.identity!.publicKey),
          mode,
        ]);
        unawaited(host.stderr.drain<void>());
        addTearDown(() async {
          await controller.disconnect();
          controller.dispose();
          await host.stdin.close();
          try {
            await host.exitCode.timeout(const Duration(seconds: 5));
          } on TimeoutException {
            host.kill(ProcessSignal.sigkill);
            await host.exitCode;
          }
        });
        final line = await host.stdout
            .transform(utf8.decoder)
            .transform(const LineSplitter())
            .first
            .timeout(const Duration(seconds: 10));
        final config = jsonDecode(line) as Map<String, dynamic>;
        final key = base64Url.normalize(config['publicKey'] as String);
        final device = TrustedDevice(
          deviceId: deviceId(base64Url.decode(key)),
          publicKey: key,
          name: 'Node fixture',
          caps: (config['caps'] as List).cast<String>(),
          endpoints: List.generate(
            mode == 'pairing' ? 0 : 8,
            (index) => 'wss://old$index.example.com/remote/ws',
          ),
        );
        if (mode == 'pairing') {
          await controller.pair(
            jsonEncode(config['qr']),
            (payload, sas) async => true,
          );
          expect((await controller.vault.loadDevices()).single.endpoints, [
            config['endpoint'],
          ]);
          await controller.disconnect();
        } else {
          await controller.vault.saveDevices([device]);
          controller.devices = [device];
        }
        final ready = Completer<void>();
        void onConnected() {
          if (controller.connected && !ready.isCompleted) ready.complete();
        }

        controller.addListener(onConnected);
        final connecting = controller.connect(
          device,
          config['endpoint'] as String,
        );
        if (mode == 'delayed') {
          await ready.future.timeout(const Duration(seconds: 5));
          final stats = await controller.call('session.projections', {
            'sessionId': 's-0',
          });
          expect((stats['calls'] as List).first['method'], 'list');
          await controller.disconnect();
          await connecting;
          expect(controller.connected, isFalse);
          expect(controller.sessions, isEmpty);
          expect(controller.status, '未连接');
          return;
        }
        await connecting;
        controller.removeListener(onConnected);
        expect(controller.connected, isTrue);
        expect(controller.error, isNull);
        final saved = (await controller.vault.loadDevices()).single;
        expect(saved.endpoints, [
          config['endpoint'],
          ...device.endpoints.take(7),
        ]);
        expect(
          base64Url.decode(saved.publicKey),
          base64Url.decode(device.publicKey),
        );
        await controller.connect(saved, config['endpoint'] as String);
        expect(
          (await controller.vault.loadDevices()).single.endpoints,
          saved.endpoints,
        );
        expect(controller.sessions, hasLength(mode == 'large' ? 120 : 1));
        expect(
          controller.sessions.last['sessionId'],
          mode == 'large' ? 's-119' : 's-0',
        );
        expect(
          controller.sessions.first['title'],
          List.filled(180, '中文标题').join(),
        );
        expect(controller.workspaces.single['workspaceId'], 'test');

        await controller.refresh(query: 'all');
        expect(controller.sessions, hasLength(mode == 'large' ? 120 : 1));
        await controller.refresh(query: 's-0');
        expect(controller.sessions.single['sessionId'], 's-0');
        await controller.refresh(query: 'missing');
        expect(controller.sessions, isEmpty);
        await expectLater(
          controller.refresh(query: 'fail'),
          throwsA(
            isA<RemoteException>().having((e) => e.code, 'code', 'unsupported'),
          ),
        );
        expect(controller.connected, isTrue);
        await controller.refresh();
        expect(controller.sessions, hasLength(mode == 'large' ? 120 : 1));
        final stats = await controller.call('session.projections', {
          'sessionId': 's-0',
        });
        final calls = (stats['calls'] as List).cast<Map>();
        expect(
          calls.where(
            (call) =>
                call['method'] == 'search' && call['params']['query'] == 'fail',
          ),
          hasLength(1),
        );
        expect(
          calls.every(
            (call) => !(call['params'] as Map).containsKey('streamId'),
          ),
          isTrue,
        );
        await controller.connect(
          saved,
          'https://invalid.example.com/remote/ws',
        );
        expect(controller.connected, isFalse);
        expect(
          (await controller.vault.loadDevices()).single.endpoints,
          saved.endpoints,
        );
        if (mode == 'pairing') {
          final restored = MobileController(IdentityVault(store: store));
          try {
            await restored.initialize();
            final target = restored.devices.single;
            await restored.connect(
              target,
              restored.endpoints[target.deviceId]!,
            );
            expect(restored.connected, isTrue);
            expect(restored.error, isNull);
            expect(restored.sessions, hasLength(1));
          } finally {
            await restored.disconnect();
            restored.dispose();
          }
        }
      },
    );
  }
}
