import 'dart:convert';

import 'package:dsh_remote_core/remote_connection.dart' as remote;
import 'package:dsh_remote_mobile/platform/identity_vault.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test(
    'concurrent loads persist one identity and cold start restores it',
    () async {
      final store = FakeKeyValueStore();
      final vault = IdentityVault(store: store);
      final identities = await Future.wait([
        vault.loadIdentity(),
        vault.loadIdentity(),
      ]);
      expect(identities[0].deviceId, identities[1].deviceId);
      expect(store.values.length, 1);
      final restored = await IdentityVault(store: store).loadIdentity();
      expect(restored.deviceId, identities[0].deviceId);
      expect(restored.secretKey, identities[0].secretKey);
    },
  );

  test(
    'corrupt identity is rejected without generating a replacement',
    () async {
      final store = FakeKeyValueStore();
      store.values['identity-v1'] = base64Url.encode([1, 2, 3]);
      await expectLater(
        IdentityVault(store: store).loadIdentity(),
        throwsFormatException,
      );
      expect(store.values['identity-v1'], base64Url.encode([1, 2, 3]));
    },
  );

  test(
    'trusted records round trip without endpoint or pairing secret',
    () async {
      final store = FakeKeyValueStore();
      final vault = IdentityVault(store: store);
      await vault.saveDevices([
        TrustedDevice(
          deviceId: remote.deviceId(List.filled(32, 42)),
          publicKey: base64Url.encode(List.filled(32, 42)),
          name: '桌面',
          caps: ['session'],
        ),
      ]);
      final devices = await IdentityVault(store: store).loadDevices();
      expect(devices.single.name, '桌面');
      expect(devices.single.caps, ['session']);
      final serialized =
          jsonDecode(store.values['trusted-devices-v1']!) as List;
      expect((serialized.single as Map).keys.toSet(), {
        'deviceId',
        'publicKey',
        'name',
        'caps',
      });
    },
  );

  test('corrupt trust key and storage failures are surfaced', () async {
    final store = FakeKeyValueStore();
    store.values['trusted-devices-v1'] = jsonEncode([
      {'deviceId': 'id', 'publicKey': 'AA==', 'name': 'host', 'caps': []},
    ]);
    await expectLater(
      IdentityVault(store: store).loadDevices(),
      throwsFormatException,
    );
    await expectLater(
      IdentityVault(store: _FailingStore()).loadIdentity(),
      throwsStateError,
    );
  });

  test(
    'connection history survives cold start and old records still load',
    () async {
      final store = FakeKeyValueStore();
      final vault = IdentityVault(store: store);
      final legacy = TrustedDevice.fromJson(_trustedRecord());
      expect(legacy.endpoints, isEmpty);
      final record = _trustedRecord()
        ..['endpoints'] = [
          'wss://192.168.1.20:47311/remote/ws',
          'wss://desktop.example.com/remote/ws',
        ];
      await vault.saveDevices([TrustedDevice.fromJson(record)]);
      final restored = await IdentityVault(store: store).loadDevices();
      expect(restored.single.endpoints, record['endpoints']);
      expect(restored.single.publicKey, legacy.publicKey);
    },
  );

  test('connection history is bounded and excludes pairing secrets', () {
    for (final endpoints in [
      'wss://host/remote/ws',
      [42],
      [''],
      ['https://host/remote/ws'],
      ['wss:///remote/ws'],
      ['wss://user:password@host/remote/ws'],
      ['wss://host/remote/ws#fragment'],
      ['wss://host/remote/ws?sid=pairing-secret'],
      ['wss://host/${List.filled(2048, 'a').join()}'],
      ['wss://host/remote/ws', 'wss://host/remote/ws'],
      List.generate(9, (index) => 'wss://host$index/remote/ws'),
    ]) {
      expect(
        () =>
            TrustedDevice.fromJson(_trustedRecord()..['endpoints'] = endpoints),
        throwsFormatException,
      );
    }
  });

  test('mismatched device id is rejected on save and load', () async {
    final store = FakeKeyValueStore();
    final vault = IdentityVault(store: store);
    final record = _trustedRecord()..['deviceId'] = 'mismatched-id';
    expect(
      () => vault.saveDevices([
        TrustedDevice(
          deviceId: 'mismatched-id',
          publicKey: record['publicKey'] as String,
          name: 'host',
          caps: ['session'],
        ),
      ]),
      throwsFormatException,
    );
    expect(store.values, isEmpty);
    store.values['trusted-devices-v1'] = jsonEncode([record]);
    await expectLater(vault.loadDevices(), throwsFormatException);
  });

  test(
    'invalid names and duplicate or unknown capabilities are rejected',
    () async {
      final invalidRecords = [
        _trustedRecord()..['name'] = '',
        _trustedRecord()..['name'] = List.filled(81, 'a').join(),
        _trustedRecord()..['caps'] = [],
        _trustedRecord()..['caps'] = ['session', 'session'],
        _trustedRecord()..['caps'] = ['unknown'],
        _trustedRecord()
          ..['caps'] = [
            'session',
            'stream',
            'approval',
            'files',
            'terminal',
            'admin',
            'other',
          ],
      ];
      for (final record in invalidRecords) {
        expect(() => TrustedDevice.fromJson(record), throwsFormatException);
        final store = FakeKeyValueStore();
        store.values['trusted-devices-v1'] = jsonEncode([record]);
        await expectLater(
          IdentityVault(store: store).loadDevices(),
          throwsFormatException,
        );
      }
      final accepted = TrustedDevice.fromJson(
        _trustedRecord()
          ..['name'] = List.filled(80, 'a').join()
          ..['caps'] = [
            'session',
            'stream',
            'approval',
            'files',
            'terminal',
            'admin',
          ],
      );
      expect(accepted.name.length, 80);
      expect(accepted.caps.length, 6);
    },
  );

  test(
    'duplicate devices cannot overwrite or load a trusted device list',
    () async {
      final store = FakeKeyValueStore();
      final vault = IdentityVault(store: store);
      final device = TrustedDevice.fromJson(_trustedRecord());
      await vault.saveDevices([device]);
      final original = store.values['trusted-devices-v1'];
      expect(() => vault.saveDevices([device, device]), throwsFormatException);
      expect(store.values['trusted-devices-v1'], original);
      store.values['trusted-devices-v1'] = jsonEncode([
        device.toJson(),
        device.toJson(),
      ]);
      await expectLater(vault.loadDevices(), throwsFormatException);
    },
  );

  test('malformed secret and failed persistence never return a replacement identity', () async {
    final store = FakeKeyValueStore();
    store.values['identity-v1'] = 'invalid!';
    final vault = IdentityVault(store: store);
    await expectLater(vault.loadIdentity(), throwsFormatException);
    expect(store.values['identity-v1'], 'invalid!');
    final failingStore = _FailingStore();
    final unavailable = IdentityVault(store: failingStore);
    await expectLater(unavailable.loadIdentity(), throwsStateError);
    await expectLater(unavailable.loadIdentity(), throwsStateError);
    expect(failingStore.writes, 1);
  });
}

Map<String, Object> _trustedRecord() => {
  'deviceId': remote.deviceId(List.filled(32, 42)),
  'publicKey': base64Url.encode(List.filled(32, 42)),
  'name': 'host',
  'caps': ['session'],
};

class _FailingStore implements KeyValueStore {
  int writes = 0;
  @override
  Future<String?> read(String key) async => null;

  @override
  Future<void> write(String key, String value) async {
    writes += 1;
    throw StateError('secure storage unavailable');
  }
}
