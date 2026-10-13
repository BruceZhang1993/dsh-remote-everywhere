import 'dart:convert';

import 'package:dsh_remote_core/remote_connection.dart' show Identity;
import 'package:dsh_remote_core/remote_connection.dart' as remote show deviceId;
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

abstract interface class KeyValueStore {
  Future<String?> read(String key);
  Future<void> write(String key, String value);
}

class PlatformKeyValueStore implements KeyValueStore {
  final FlutterSecureStorage _storage = const FlutterSecureStorage(
    aOptions: AndroidOptions(
      storageNamespace: 'dsh_remote_identity_v1',
      resetOnError: false,
    ),
    iOptions: IOSOptions(
      accountName: 'dev.dshremote.identity.v1',
      accessibility: KeychainAccessibility.unlocked_this_device,
      synchronizable: false,
    ),
  );

  @override
  Future<String?> read(String key) => _storage.read(key: key);

  @override
  Future<void> write(String key, String value) =>
      _storage.write(key: key, value: value);
}

/// In-memory test double; production uses [PlatformKeyValueStore].
class FakeKeyValueStore implements KeyValueStore {
  final Map<String, String> values = {};

  @override
  Future<String?> read(String key) async => values[key];

  @override
  Future<void> write(String key, String value) async {
    values[key] = value;
  }
}

/// Trusted identity only. Tunnel addresses and pairing secrets are ephemeral.
class TrustedDevice {
  TrustedDevice({
    required this.deviceId,
    required this.publicKey,
    required this.name,
    required List<String> caps,
  }) : caps = List.unmodifiable(caps);

  final String deviceId;
  final String publicKey;
  final String name;
  final List<String> caps;

  Map<String, Object> toJson() => {
    'deviceId': deviceId,
    'publicKey': publicKey,
    'name': name,
    'caps': caps,
  };

  factory TrustedDevice.fromJson(Object? value) {
    if (value is! Map<String, dynamic> ||
        value['deviceId'] is! String ||
        (value['deviceId'] as String).isEmpty ||
        value['publicKey'] is! String ||
        value['name'] is! String ||
        value['caps'] is! List ||
        (value['caps'] as List).any((cap) => cap is! String)) {
      throw const FormatException('信任设备资料损坏，请手动处理存储。');
    }
    final key = base64Url.decode(value['publicKey'] as String);
    final name = value['name'] as String;
    final caps = (value['caps'] as List).cast<String>();
    const allowedCaps = {
      'session',
      'stream',
      'approval',
      'files',
      'terminal',
      'admin',
    };
    if (key.length != 32 || value['deviceId'] != remote.deviceId(key)) {
      throw const FormatException('信任设备公钥或设备标识无效。');
    }
    if (name.isEmpty ||
        name.length > 80 ||
        caps.isEmpty ||
        caps.length > 6 ||
        caps.toSet().length != caps.length ||
        caps.any((cap) => !allowedCaps.contains(cap))) {
      throw const FormatException('信任设备名称或权限无效。');
    }
    return TrustedDevice(
      deviceId: value['deviceId'] as String,
      publicKey: base64Url.encode(key),
      name: name,
      caps: caps,
    );
  }
}

/// All records use platform secure storage; no session bodies are persisted.
/// Noise needs this secret in Dart memory; this is not a non-exportable key.
class IdentityVault {
  IdentityVault({KeyValueStore? store})
    : _store = store ?? PlatformKeyValueStore();

  static const _identityKey = 'identity-v1';
  static const _devicesKey = 'trusted-devices-v1';
  final KeyValueStore _store;
  Future<Identity>? _identity;

  // One owner creates and persists the identity, even under concurrent callers.
  Future<Identity> loadIdentity() => _identity ??= _readIdentity();

  Future<Identity> _readIdentity() async {
    final stored = await _store.read(_identityKey);
    if (stored != null) {
      final secret = base64Url.decode(stored);
      try {
        if (secret.length != 32) {
          throw const FormatException('身份私钥长度无效，不会自动生成替代身份。');
        }
        return Identity.fromSecret(secret);
      } finally {
        secret.fillRange(0, secret.length, 0);
      }
    }
    final identity = Identity.generate();
    var persisted = false;
    try {
      await _store.write(_identityKey, base64Url.encode(identity.secretKey));
      persisted = true;
      return identity;
    } finally {
      if (!persisted) identity.destroy();
    }
  }

  Future<List<TrustedDevice>> loadDevices() async {
    final stored = await _store.read(_devicesKey);
    if (stored == null) return [];
    final decoded = jsonDecode(stored);
    if (decoded is! List || decoded.length > 64) {
      throw const FormatException('信任设备资料损坏或超过 64 个设备。');
    }
    final devices = decoded.map(TrustedDevice.fromJson).toList();
    _checkDuplicateDevices(devices);
    return devices;
  }

  static void _checkDuplicateDevices(List<TrustedDevice> devices) {
    if (devices.map((device) => device.deviceId).toSet().length !=
        devices.length) {
      throw const FormatException('信任设备资料包含重复设备。');
    }
  }

  Future<void> saveDevices(List<TrustedDevice> devices) {
    if (devices.length > 64) {
      throw ArgumentError('最多保存 64 个信任设备。');
    }
    final checked = devices
        .map((device) => TrustedDevice.fromJson(device.toJson()))
        .toList();
    _checkDuplicateDevices(checked);
    return _store.write(
      _devicesKey,
      jsonEncode(checked.map((device) => device.toJson()).toList()),
    );
  }
}
