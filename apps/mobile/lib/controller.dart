import 'dart:async';
import 'dart:convert';
import 'dart:math';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:dsh_remote_core/remote_connection.dart';
import 'package:dsh_remote_core/session_state.dart';

import 'platform/identity_vault.dart';

class PendingInteraction {
  PendingInteraction(this.kind, this.data);
  final String kind;
  final Map<String, dynamic> data;
  String get id =>
      data[kind == 'approval' ? 'approvalId' : 'questionId'] as String;
  bool sending = false;
}

/// UI actions perform writes; incoming events only update this read model.
class MobileController extends ChangeNotifier with WidgetsBindingObserver {
  MobileController(this.vault);
  final IdentityVault vault;
  Identity? identity;
  List<TrustedDevice> devices = [];
  TrustedDevice? device;
  final Map<String, String> endpoints = {};
  List<Map<String, dynamic>> sessions = [], workspaces = [];
  Map<String, dynamic>? address;
  SessionState session = SessionState();
  final Map<String, PendingInteraction> interactions = {};
  final Map<String, Timer> _deadlines = {};
  final Set<RemoteCancellation> _sessionOperations = {};
  final Map<String, Map<String, Map<String, dynamic>>> _controlValues = {};
  int _controlBytes = 0;
  String status = '正在读取安全存储';
  String? error;
  bool initialized = false, busy = false, _disposed = false, _foreground = true;
  bool _initializing = false;
  bool _manualStopped = true;
  Future<void> _deviceWrite = Future.value();
  RemoteConnection? _connection;
  RemoteCancellation? _connecting, _sessionCancellation, _pairing;
  StreamSubscription<Map<String, dynamic>>? _events, _sessionEvents, _control;
  Timer? _retryTimer;
  int _generation = 0, _sessionGeneration = 0, _attempts = 0;
  int _rebaselineAttempts = 0;
  Object? _rebaselineOwner;
  Map<String, dynamic>? _sendingPromptOwner;
  SessionState? _uploadingOwner;
  Map<String, dynamic>? pendingPrompt;
  final List<Map<String, dynamic>> attachments = [];
  bool get connected => !_disposed && _connection?.isReady == true;
  bool has(String cap) =>
      connected && _connection!.negotiatedCaps.contains(cap);
  String? get sessionId => address?['sessionId'] ?? address?['childSessionId'];

  Future<void> initialize() async {
    if (_disposed || initialized || _initializing) return;
    _initializing = true;
    WidgetsBinding.instance.addObserver(this);
    Identity? loaded;
    try {
      loaded = await vault.loadIdentity();
      if (_disposed) {
        loaded.destroy();
        return;
      }
      identity = loaded;
      final trusted = await vault.loadDevices();
      if (_disposed) {
        loaded.destroy();
        return;
      }
      devices = trusted;
      for (final target in trusted) {
        if (target.endpoints.isNotEmpty) {
          endpoints[target.deviceId] = target.endpoints.first;
        }
      }
      initialized = true;
      status = '选择设备并连接';
    } catch (failure, stack) {
      if (_disposed) {
        loaded?.destroy();
        return;
      }
      status = '安全存储不可用';
      _boundary(failure, stack);
    } finally {
      _initializing = false;
      _notify();
    }
  }

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  void report(Object failure) {
    if (_disposed) return;
    error = failure is RemoteException
        ? '${failure.code}：${failure.message}'
        : failure is FormatException
        ? failure.message
        : '操作失败，请重试。';
    _notify();
  }

  void _boundary(Object failure, StackTrace stack) {
    // Malformed wire/UI values fail the operation. Runtime failures remain fatal.
    if (failure is Error && failure is! TypeError && failure is! RangeError) {
      Zone.current.handleUncaughtError(failure, stack);
      return;
    }
    report(failure);
  }

  void _background(Future<void> operation) {
    unawaited(
      operation.then<void>(
        (_) {},
        onError: (Object failure, StackTrace stack) =>
            _boundary(failure, stack),
      ),
    );
  }

  Future<void> action(Future<void> Function() operation) async {
    if (_disposed || busy) return;
    busy = true;
    error = null;
    _notify();
    try {
      await operation();
    } catch (failure, stack) {
      _boundary(failure, stack);
    } finally {
      busy = false;
      _notify();
    }
  }

  Future<void> pair(
    String raw,
    Future<bool> Function(PairingRequest, String) confirm,
  ) async {
    if (_disposed || !_foreground || identity == null) {
      throw const RemoteException('unauthorized', '安全存储尚未就绪');
    }
    if (utf8.encode(raw).length > 8192) throw const FormatException('二维码内容过大');
    final decoded = jsonDecode(raw);
    if (decoded is! Map<String, dynamic>) {
      throw const FormatException('二维码格式无效');
    }
    final payload = PairingRequest.parse(decoded);
    final cancellation = RemoteCancellation();
    final generation = _generation;
    _pairing?.cancel();
    _pairing = cancellation;
    bool current() =>
        !_disposed &&
        _foreground &&
        generation == _generation &&
        !cancellation.isCancelled &&
        _pairing == cancellation;
    try {
      final paired = await pairDevice(
        identity: identity!,
        payload: payload,
        confirm: (sas) =>
            current() ? confirm(payload, sas) : Future.value(false),
        cancellation: cancellation,
        name: 'DSH 移动控制端',
      );
      if (!current()) return;
      final trusted = TrustedDevice(
        deviceId: paired.deviceId,
        publicKey: base64Url.encode(paired.publicKey),
        name: paired.name,
        caps: paired.caps,
        endpoints: [
          paired.endpoint,
          ...devices
              .where((item) => item.deviceId == paired.deviceId)
              .expand((item) => item.endpoints)
              .where((endpoint) => endpoint != paired.endpoint),
        ].take(TrustedDevice.maxEndpoints).toList(),
      );
      await _updateDevices(
        (devices) => current()
            ? [
                ...devices.where((item) => item.deviceId != trusted.deviceId),
                trusted,
              ]
            : devices,
      );
      if (!current()) return;
      endpoints[trusted.deviceId] = paired.endpoint;
      _notify();
      await connect(trusted, paired.endpoint);
    } finally {
      if (_pairing == cancellation) _pairing = null;
    }
  }

  void cancelPairing() => _pairing?.cancel();

  // Address recovery and user device edits share one storage writer.
  Future<void> _updateDevices(
    List<TrustedDevice> Function(List<TrustedDevice>) update,
  ) {
    final writing = _deviceWrite.then((_) async {
      if (_disposed) return;
      final next = update(devices);
      if (identical(next, devices)) return;
      await vault.saveDevices(next);
      if (_disposed) return;
      devices = next;
      for (final target in next) {
        if (device?.deviceId == target.deviceId) device = target;
      }
    });
    _deviceWrite = writing.then<void>(
      (_) {},
      onError: (Object _, StackTrace _) {},
    );
    return writing;
  }

  Future<void> renameDevice(TrustedDevice target, String name) async {
    if (name.trim().isEmpty || name.length > 80) {
      throw const FormatException('名称需为 1–80 个字符');
    }
    await _updateDevices(
      (devices) => devices
          .map(
            (item) => item.deviceId == target.deviceId
                ? TrustedDevice(
                    deviceId: item.deviceId,
                    publicKey: item.publicKey,
                    name: name.trim(),
                    caps: item.caps,
                    endpoints: item.endpoints,
                  )
                : item,
          )
          .toList(),
    );
    if (_disposed) return;
    _notify();
  }

  Future<void> forget(TrustedDevice target) async {
    await _updateDevices(
      (devices) =>
          devices.where((item) => item.deviceId != target.deviceId).toList(),
    );
    if (_disposed) return;
    endpoints.remove(target.deviceId);
    if (device?.deviceId == target.deviceId) {
      device = null;
      await disconnect();
    }
    _notify();
  }

  bool _owns(
    RemoteConnection connection,
    int generation, [
    SessionState? state,
  ]) =>
      !_disposed &&
      _foreground &&
      generation == _generation &&
      identical(_connection, connection) &&
      connection.isReady &&
      (state == null || identical(session, state));
  RemoteConnection _requireConnection() {
    if (!connected || !_foreground) {
      throw const RemoteException('transport/lost', '设备尚未连接');
    }
    return _connection!;
  }

  void _checkOwner(
    RemoteConnection connection,
    int generation, [
    SessionState? state,
  ]) {
    if (!_owns(connection, generation, state)) {
      throw const RemoteException('cancelled', '连接或会话已切换，操作已停止');
    }
  }

  /// Join foreground recovery after a native picker. The selected session is
  /// retained; an explicit user disconnect never starts recovery here.
  Future<void> ensureConnected() async {
    if (connected && _foreground) return;
    if (_disposed ||
        _manualStopped ||
        device == null ||
        identity == null ||
        !endpoints.containsKey(device!.deviceId)) {
      throw const RemoteException('transport/lost', '请先连接设备');
    }
    final generation = _generation;
    final ready = Completer<void>();
    void check() {
      if (ready.isCompleted) return;
      if (_disposed || _manualStopped || generation != _generation) {
        ready.completeError(const RemoteException('cancelled', '连接恢复已取消'));
      } else if (connected && _foreground) {
        ready.complete();
      }
    }

    final timeout = Timer(const Duration(seconds: 10), () {
      if (!ready.isCompleted) {
        ready.completeError(const RemoteException('timeout', '等待设备恢复连接超时，请重试'));
      }
    });
    addListener(check);
    try {
      _background(_establish(generation));
      check();
      await ready.future;
    } finally {
      timeout.cancel();
      removeListener(check);
    }
  }

  Future<dynamic> _ownedRequest(
    RemoteConnection connection,
    int generation,
    SessionState? state,
    String method,
    Map<String, dynamic> params, {
    RemoteCancellation? cancellation,
  }) async {
    _checkOwner(connection, generation, state);
    final result = await connection.request(
      method,
      params,
      cancellation: cancellation,
    );
    _checkOwner(connection, generation, state);
    return result;
  }

  Future<void> connect(TrustedDevice target, String endpoint) async {
    final closing = disconnect(manual: false);
    final generation = _generation;
    await closing;
    if (_disposed || generation != _generation) return;
    device = target;
    endpoints[target.deviceId] = endpoint;
    address = null;
    _manualStopped = false;
    session = SessionState();
    pendingPrompt = null;
    attachments.clear();
    _attempts = 0;
    _rebaselineAttempts = 0;
    await _establish(generation);
  }

  Future<void> _rememberEndpoint(TrustedDevice target, String endpoint) =>
      _updateDevices((devices) {
        final index = devices.indexWhere(
          (item) => item.deviceId == target.deviceId,
        );
        if (index < 0) return devices;
        final previous = devices[index];
        if (previous.endpoints.isNotEmpty &&
            previous.endpoints.first == endpoint) {
          return devices;
        }
        final replacement = TrustedDevice(
          deviceId: previous.deviceId,
          publicKey: previous.publicKey,
          name: previous.name,
          caps: previous.caps,
          endpoints: [
            endpoint,
            ...previous.endpoints.where((item) => item != endpoint),
          ].take(TrustedDevice.maxEndpoints).toList(),
        );
        return [...devices]..[index] = replacement;
      });

  Future<void> _establish(int generation) async {
    final target = device;
    if (_disposed ||
        _manualStopped ||
        target == null ||
        identity == null ||
        !_foreground ||
        generation != _generation ||
        _connecting != null ||
        connected) {
      return;
    }
    status = _attempts == 0 ? '连接中' : '重连中（$_attempts/8）';
    _notify();
    final cancellation = RemoteCancellation();
    final endpoint = endpoints[target.deviceId]!;
    _connecting = cancellation;
    RemoteConnection? opened;
    bool failed = false;
    Future<void> fail(Object failure, StackTrace stack) async {
      if (failed) return;
      failed = true;
      if (_disposed || generation != _generation || cancellation.isCancelled) {
        return;
      }
      final connection = opened;
      if (connection != null && !identical(_connection, connection)) return;
      final events = _events;
      _events = null;
      _connection = null;
      if (identical(_connecting, cancellation)) _connecting = null;
      final streams = _stopStreams();
      _clearInteractions();
      _controlValues.clear();
      _controlBytes = 0;
      connection?.close();
      try {
        await streams;
        await events?.cancel();
      } catch (cleanup, cleanupStack) {
        _boundary(cleanup, cleanupStack);
      }
      if (_disposed || generation != _generation) return;
      // Cancelling an obsolete opening stream can require a fresh transport.
      final reason = failure is RemoteException
          ? failure
          : const RemoteException('transport/lost', '连接失败');
      _retry(
        reason.code == 'cancelled'
            ? const RemoteException('transport/lost', '流打开已取消，重新建立连接')
            : reason,
        generation,
      );
      if (failure is Error) _boundary(failure, stack);
    }

    try {
      final connection = await RemoteConnection.connect(
        endpoint,
        identity: identity!,
        peerPublicKey: base64Url.decode(target.publicKey),
        caps: target.caps,
        cancellation: cancellation,
        name: 'DSH 移动控制端',
      );
      opened = connection;
      if (_disposed ||
          generation != _generation ||
          !_foreground ||
          cancellation.isCancelled) {
        connection.close();
        return;
      }
      _connection = connection;
      await _rememberEndpoint(target, endpoint);
      _checkOwner(connection, generation);
      status = '已连接';
      error = null;
      _events = connection.events.listen(
        (event) {
          if (!_owns(connection, generation)) return;
          try {
            _interaction(event);
          } catch (failure, stack) {
            _boundary(failure, stack);
          }
        },
        onError: (Object failure, StackTrace stack) {
          if (_owns(connection, generation)) _boundary(failure, stack);
        },
      );
      _background(
        connection.closed.then((failure) => fail(failure, StackTrace.current)),
      );
      _notify();
      if (has('session')) await refresh();
      _checkOwner(connection, generation);
      if (has('stream')) {
        final control = await connection.open('control.subscribe', {});
        if (!_owns(connection, generation)) {
          await control.listen((_) {}).cancel();
          return;
        }
        _control = control.listen(
          (frame) {
            if (!_owns(connection, generation)) return;
            try {
              _acceptControl(frame);
            } catch (failure, stack) {
              _boundary(failure, stack);
              connection.close(
                const RemoteException('invalid-argument', '控制状态无效'),
              );
            }
          },
          onError: (Object failure, StackTrace stack) {
            if (_owns(connection, generation)) _boundary(failure, stack);
          },
        );
        if (address != null) await _watchSession();
      }
      _checkOwner(connection, generation);
      _attempts = 0;
      _notify();
    } catch (failure, stack) {
      await fail(failure, stack);
    } finally {
      if (identical(_connecting, cancellation)) _connecting = null;
    }
  }

  void _retry(RemoteException failure, int generation) {
    if (_disposed || !_foreground || generation != _generation) return;
    if (!{'transport/lost', 'tunnel/busy'}.contains(failure.code) ||
        ++_attempts > 8) {
      status = failure.code == 'tunnel/expired'
          ? '地址已失效，请更新端点'
          : failure.code == 'unauthorized'
          ? '身份未获授权，请重新配对'
          : '连接已停止';
      report(failure);
      return;
    }
    status = '重连中（$_attempts/8）';
    _notify();
    _retryTimer?.cancel();
    _retryTimer = Timer(
      Duration(milliseconds: min(10000, 500 * (1 << (_attempts - 1)))),
      () {
        _retryTimer = null;
        _background(_establish(generation));
      },
    );
  }

  Future<void> disconnect({bool manual = true}) async {
    if (manual) _manualStopped = true;
    _generation++;
    _retryTimer?.cancel();
    _retryTimer = null;
    final connecting = _connecting;
    _connecting = null;
    connecting?.cancel();
    final connection = _connection;
    _connection = null;
    final events = _events;
    _events = null;
    final streams = _stopStreams();
    connection?.close();
    _clearInteractions();
    _controlValues.clear();
    _controlBytes = 0;
    sessions = [];
    workspaces = [];
    status = '未连接';
    _notify();
    await streams;
    await events?.cancel();
  }

  Future<void> _stopSessionStream() async {
    _sessionGeneration++;
    final cancellation = _sessionCancellation;
    _sessionCancellation = null;
    final events = _sessionEvents;
    _sessionEvents = null;
    cancellation?.cancel();
    await events?.cancel();
  }

  Future<void> _stopStreams() async {
    _rebaselineOwner = null;
    final sessionClosing = _stopSessionStream();
    final control = _control;
    _control = null;
    for (final cancellation in List.of(_sessionOperations)) {
      cancellation.cancel();
    }
    _sessionOperations.clear();
    await sessionClosing;
    await control?.cancel();
  }

  void _acceptControl(Map<String, dynamic> frame) {
    if (frame['type'] == 'baseline') {
      final projections = (frame['value'] as Map)['projections'] as Map;
      for (final entry in projections.entries) {
        final baseline = entry.value as Map;
        final values = baseline['values'] as Map;
        for (final value in values.entries) {
          _cacheProjection({
            'sessionId': entry.key,
            'key': value.key,
            'seq': baseline['asOfSeq'],
            'value': value.value,
          });
        }
      }
    } else if (frame['type'] == 'projection') {
      _cacheProjection(frame);
    } else {
      throw const FormatException('未知控制状态帧');
    }
    _applyControl();
    _notify();
  }

  void _cacheProjection(Map<String, dynamic> update) {
    final id = update['sessionId'], key = update['key'], seq = update['seq'];
    if (id is! String ||
        key is! String ||
        seq is! int ||
        seq < -1 ||
        seq > 9007199254740991) {
      throw const FormatException('控制状态水位或标识无效');
    }
    final previous = _controlValues[id]?[key];
    if (previous != null && (previous['seq'] as int) >= seq) return;
    final value = Map<String, dynamic>.unmodifiable(update);
    final bytes = utf8.encode(jsonEncode(value)).length;
    final previousBytes = previous == null
        ? 0
        : utf8.encode(jsonEncode(previous)).length;
    if (bytes > 4 * 1024 * 1024) {
      throw const RemoteException('busy', '控制状态超过 4 MiB');
    }
    // Keep selected-session updates. Other cold sessions can be read again.
    while (_controlBytes - previousBytes + bytes > 4 * 1024 * 1024 ||
        (!_controlValues.containsKey(id) && _controlValues.length >= 256)) {
      final cold = _controlValues.keys
          .where((candidate) => candidate != id && candidate != sessionId)
          .firstOrNull;
      if (cold == null) throw const RemoteException('busy', '控制状态缓存已满');
      final removed = _controlValues.remove(cold)!;
      for (final entry in removed.values) {
        _controlBytes -= utf8.encode(jsonEncode(entry)).length;
      }
    }
    final values = _controlValues.putIfAbsent(id, () => {});
    if (!values.containsKey(key) && values.length >= 64) {
      throw const RemoteException('busy', '会话控制字段过多');
    }
    values[key] = value;
    _controlBytes += bytes - previousBytes;
  }

  void _applyControl() {
    for (final update
        in _controlValues[sessionId]?.values ?? <Map<String, dynamic>>[]) {
      session.applyProjection(update);
    }
  }

  Future<dynamic> call(
    String method,
    Map<String, dynamic> params, {
    RemoteCancellation? cancellation,
  }) {
    final connection = _requireConnection();
    return _ownedRequest(
      connection,
      _generation,
      params.containsKey('sessionId') || params.containsKey('childSessionId')
          ? session
          : null,
      method,
      Map<String, dynamic>.from(params),
      cancellation: cancellation,
    );
  }

  Future<void> refresh({String? query}) async {
    final connection = _requireConnection(), generation = _generation;
    final method = query == null || query.isEmpty
        ? 'session.list'
        : 'session.search';
    final params = query == null || query.isEmpty
        ? <String, dynamic>{}
        : <String, dynamic>{'query': query};
    dynamic value;
    Stream<Map<String, dynamic>>? source;
    final cancellation = RemoteCancellation();
    try {
      if (has('stream')) {
        try {
          source = await connection.open(
            method,
            params,
            cancellation: cancellation,
          );
        } on RemoteException catch (failure) {
          // Older hosts only accept these methods as a single RPC response.
          if (!{'invalid-argument', 'unsupported'}.contains(failure.code)) {
            rethrow;
          }
        }
      }
      value = source == null
          ? await _ownedRequest(connection, generation, null, method, params)
          : await source.single.timeout(
              connection.requestTimeout,
              onTimeout: () =>
                  throw const RemoteException('timeout', '读取会话列表超时'),
            );
      _checkOwner(connection, generation);
    } finally {
      cancellation.cancel();
    }
    final rows = (value['items'] as List)
        .map((item) => Map<String, dynamic>.from(item as Map))
        .toList();
    final workspacesValue = await _ownedRequest(
      connection,
      generation,
      null,
      'workspace.list',
      {},
    );
    sessions = rows;
    workspaces = (workspacesValue['items'] as List)
        .map((item) => Map<String, dynamic>.from(item as Map))
        .toList();
    _notify();
  }

  Future<void> createSession(Map<String, dynamic> params) async {
    final connection = _requireConnection(),
        generation = _generation,
        state = session;
    final result = await _ownedRequest(
      connection,
      generation,
      state,
      'session.create',
      Map<String, dynamic>.from(params),
    );
    await refresh();
    _checkOwner(connection, generation, state);
    await selectSession({'kind': 'session', 'sessionId': result['sessionId']});
  }

  Future<void> selectSession(Map<String, dynamic>? next) async {
    _rebaselineOwner = null;
    final closing = _stopSessionStream();
    final streamGeneration = _sessionGeneration;
    for (final cancellation in List.of(_sessionOperations)) {
      cancellation.cancel();
    }
    _sessionOperations.clear();
    _clearInteractions();
    address = next == null ? null : Map<String, dynamic>.unmodifiable(next);
    session = SessionState();
    pendingPrompt = null;
    attachments.clear();
    _rebaselineAttempts = 0;
    _applyControl();
    _notify();
    await closing;
    if (_disposed || streamGeneration != _sessionGeneration) return;
    if (next != null && connected && _foreground) await _watchSession();
  }

  Future<void> _watchSession() async {
    if (address == null || !has('stream')) return;
    final connection = _requireConnection(),
        transportGeneration = _generation,
        state = session;
    final selected = Map<String, dynamic>.from(address!);
    final generation = ++_sessionGeneration;
    final cancellation = RemoteCancellation();
    _sessionCancellation = cancellation;
    bool current() =>
        _owns(connection, transportGeneration, state) &&
        generation == _sessionGeneration &&
        !cancellation.isCancelled;
    try {
      final stream = await connection.open('stream.open', {
        'address': selected,
        'assistantStream': true,
        'maxMessages': 16,
        if (state.cursor >= 0) 'sinceSeq': state.cursor,
      }, cancellation: cancellation);
      if (!current()) {
        await stream.listen((_) {}).cancel();
        return;
      }
      bool opening = true;
      _sessionEvents = stream.listen(
        (frame) {
          if (!current()) return;
          try {
            final kind = frame['kind'] ?? frame['type'];
            if (opening && kind != 'snapshot') {
              throw const FormatException('会话流缺少初始快照');
            }
            opening = false;
            state.applyFollow(frame);
            if (state.needsSnapshot) {
              if (state.retentionExceeded) {
                cancellation.cancel();
                report(RemoteException('busy', state.failure ?? '会话超过本地存储预算'));
                return;
              }
              if (_rebaselineOwner == null) {
                _background(
                  _rebaseline(connection, transportGeneration, state),
                );
              }
              return;
            }
            if (kind == 'snapshot') _applyControl();
            _notify();
          } catch (failure, stack) {
            cancellation.cancel();
            _boundary(failure, stack);
          }
        },
        onError: (Object failure, StackTrace stack) {
          if (current()) _boundary(failure, stack);
        },
      );
      // HostStreams.open replays both approval and question requests for this
      // subscribed device; approval.pending additionally reconciles its RPC cut.
      if (has('approval')) {
        final pending = await connection.request('approval.pending', {
          'sessionId': selected['sessionId'] ?? selected['childSessionId'],
        }, cancellation: cancellation);
        if (!current()) return;
        for (final data in pending['items'] as List) {
          _interaction({'name': 'approval.request', 'data': data});
        }
      }
    } catch (failure) {
      if (!current()) return;
      rethrow;
    }
  }

  Future<void> _rebaseline(
    RemoteConnection connection,
    int generation,
    SessionState state,
  ) async {
    if (_rebaselineOwner != null || !_owns(connection, generation, state)) {
      return;
    }
    final owner = Object();
    _rebaselineOwner = owner;
    bool retryAgain = false;
    try {
      await _stopSessionStream();
      if (!_owns(connection, generation, state)) return;
      if (++_rebaselineAttempts > 2) {
        throw const RemoteException(
          'history/unavailable',
          '会话状态连续修复失败，请重新打开会话',
        );
      }
      // Retain sinceSeq: the host must explicitly reject unavailable history.
      await _watchSession();
      retryAgain = state.needsSnapshot;
    } finally {
      if (identical(_rebaselineOwner, owner)) _rebaselineOwner = null;
    }
    if (retryAgain && _owns(connection, generation, state)) {
      _background(_rebaseline(connection, generation, state));
    }
  }

  Future<void> older() async {
    if (address == null || session.records.isEmpty || !session.hasMore) return;
    final connection = _requireConnection(),
        generation = _generation,
        state = session;
    final selected = Map<String, dynamic>.from(address!);
    final cancellation = RemoteCancellation();
    _sessionOperations.add(cancellation);
    try {
      final stream = await connection.open('history.page', {
        'address': selected,
        'throughSeq': state.cursor,
        'beforeSeq': state.records.first['event']['seq'],
        'maxMessages': 16,
      }, cancellation: cancellation);
      _checkOwner(connection, generation, state);
      await for (final page in stream) {
        _checkOwner(connection, generation, state);
        state.prependHistory(page);
        if (state.needsSnapshot) {
          throw const RemoteException('history/unavailable', '历史页不连续');
        }
      }
      _notify();
    } finally {
      _sessionOperations.remove(cancellation);
      cancellation.cancel();
    }
  }

  Future<List<Map<String, dynamic>>> readStream(
    String method,
    Map<String, dynamic> params,
  ) async {
    final connection = _requireConnection(),
        generation = _generation,
        state = session;
    final cancellation = RemoteCancellation();
    _sessionOperations.add(cancellation);
    final values = <Map<String, dynamic>>[];
    var bytes = 0;
    try {
      final stream = await connection.open(
        method,
        Map<String, dynamic>.from(params),
        cancellation: cancellation,
      );
      _checkOwner(connection, generation, state);
      await for (final value in stream) {
        _checkOwner(connection, generation, state);
        final size = utf8.encode(jsonEncode(value)).length;
        if (size > 4 * 1024 * 1024 ||
            bytes + size > 4 * 1024 * 1024 ||
            values.length >= 256) {
          throw const RemoteException('busy', '流读取超过 4 MiB 或 256 项');
        }
        bytes += size;
        values.add(Map<String, dynamic>.unmodifiable(value));
      }
      _checkOwner(connection, generation, state);
      return List.unmodifiable(values);
    } finally {
      _sessionOperations.remove(cancellation);
      cancellation.cancel();
    }
  }

  static String newRequestId() => base64Url
      .encode(List.generate(16, (_) => Random.secure().nextInt(256)))
      .replaceAll('=', '');
  Future<void> prompt(String text) async {
    if (pendingPrompt != null) {
      throw const RemoteException('busy', '请先确认上一条提示的发送结果');
    }
    if (sessionId == null || (text.trim().isEmpty && attachments.isEmpty)) {
      return;
    }
    final content = [
      if (text.trim().isNotEmpty) {'type': 'text', 'text': text},
      ...attachments,
    ];
    final pending = {
      'requestId': newRequestId(),
      'content': content,
      if (address?['kind'] == 'subagent') ...{
        'parentSessionId': address!['parentSessionId'],
        'childSessionId': sessionId,
        'mode': address!['mode'],
        'delivery': 'queue',
      } else ...{
        'sessionId': sessionId,
        'mode': 'queue',
      },
    };
    final method = pending.containsKey('childSessionId')
        ? 'subagent.prompt'
        : 'session.prompt';
    // RemoteConnection mints an 8-byte base64url RPC id (11 characters).
    if (utf8
            .encode(
              jsonEncode({'id': 'xxxxxxxxxxx', 'm': method, 'p': pending}),
            )
            .length >
        65519) {
      throw const RemoteException('invalid-argument', '提示和附件合计超过单帧预算，请减少内容');
    }
    pendingPrompt = pending;
    await retryPrompt();
  }

  Future<void> retryPrompt() async {
    final pending = pendingPrompt;
    if (pending == null || identical(_sendingPromptOwner, pending)) return;
    final connection = _requireConnection(),
        generation = _generation,
        state = session;
    _sendingPromptOwner = pending;
    try {
      await _ownedRequest(
        connection,
        generation,
        state,
        pending.containsKey('childSessionId')
            ? 'subagent.prompt'
            : 'session.prompt',
        pending,
      );
      if (identical(pendingPrompt, pending)) {
        pendingPrompt = null;
        attachments.clear();
      }
      _notify();
    } on RemoteException catch (failure) {
      if (!{'transport/lost', 'timeout', 'cancelled'}.contains(failure.code) &&
          identical(pendingPrompt, pending)) {
        pendingPrompt = null;
      }
      rethrow;
    } finally {
      if (identical(_sendingPromptOwner, pending)) _sendingPromptOwner = null;
    }
  }

  Future<void> cancelTask() async {
    if (address == null) return;
    final selected = Map<String, dynamic>.from(address!);
    await call(
      selected['kind'] == 'subagent' ? 'subagent.cancel' : 'session.cancel',
      selected['kind'] == 'subagent'
          ? {
              'parentSessionId': selected['parentSessionId'],
              'childSessionId': selected['childSessionId'],
              'mode': selected['mode'],
            }
          : {'sessionId': selected['sessionId']},
    );
  }

  Future<void> attach(Uint8List bytes, String name, {String? mediaType}) async {
    if (sessionId == null || address?['kind'] == 'subagent') {
      throw const RemoteException('unsupported', '请在主会话中上传附件');
    }
    if (identical(_uploadingOwner, session)) {
      throw const RemoteException('busy', '已有附件正在上传');
    }
    if (attachments.length >= 4 ||
        bytes.isEmpty ||
        bytes.length > 4 * 1024 * 1024) {
      throw const RemoteException('invalid-argument', '最多四个附件，单个不超过 4 MiB');
    }
    final connection = _requireConnection(),
        generation = _generation,
        state = session;
    final id = sessionId!;
    final cancellation = RemoteCancellation();
    _sessionOperations.add(cancellation);
    _uploadingOwner = state;
    try {
      if (mediaType != null) {
        final data = base64.encode(bytes);
        if (data.length > 48000) {
          throw const RemoteException(
            'invalid-argument',
            '内联图片过大，请使用较小图片或作为文件上传',
          );
        }
        _checkOwner(connection, generation, state);
        attachments.add({
          'type': 'image',
          'mediaType': mediaType,
          'data': data,
          'name': name,
        });
      } else {
        final upload = await _ownedRequest(
          connection,
          generation,
          state,
          'session.upload.begin',
          {'sessionId': id, 'bytes': bytes.length, 'name': name},
          cancellation: cancellation,
        );
        for (var offset = 0; offset < bytes.length; offset += 32768) {
          await _ownedRequest(
            connection,
            generation,
            state,
            'session.upload.chunk',
            {
              'uploadId': upload['uploadId'],
              'offset': offset,
              'data': base64.encode(
                bytes.sublist(offset, min(offset + 32768, bytes.length)),
              ),
            },
            cancellation: cancellation,
          );
        }
        final receipt = await _ownedRequest(
          connection,
          generation,
          state,
          'session.upload.finish',
          {'uploadId': upload['uploadId']},
          cancellation: cancellation,
        );
        attachments.add({'type': 'file', 'receiptId': receipt['receiptId']});
      }
      _notify();
    } finally {
      if (identical(_uploadingOwner, state)) _uploadingOwner = null;
      _sessionOperations.remove(cancellation);
      cancellation.cancel();
    }
  }

  Future<dynamic> operation(String method, Map<String, dynamic> params) async {
    if (sessionId == null) {
      throw const RemoteException('invalid-argument', '请先选择会话');
    }
    final connection = _requireConnection(),
        generation = _generation,
        state = session;
    final fixed = Map<String, dynamic>.from({
      ...params,
      'sessionId': sessionId,
    });
    final cancellation = RemoteCancellation();
    _sessionOperations.add(cancellation);
    try {
      final grant = await _ownedRequest(
        connection,
        generation,
        state,
        'operation.prepare',
        {...fixed, 'method': method},
        cancellation: cancellation,
      );
      return await _ownedRequest(connection, generation, state, method, {
        ...fixed,
        'approvalId': grant['approvalId'],
      }, cancellation: cancellation);
    } finally {
      _sessionOperations.remove(cancellation);
      cancellation.cancel();
    }
  }

  void _interaction(Map<String, dynamic> event) {
    final name = event['name'];
    if (name != 'approval.responded' &&
        name != 'question.responded' &&
        name != 'approval.request' &&
        name != 'question.request') {
      return;
    }
    if (event['data'] is! Map) throw const FormatException('交互数据无效');
    final data = Map<String, dynamic>.from(event['data'] as Map);
    if (data['sessionId'] != sessionId) return;
    if (name == 'approval.responded' || name == 'question.responded') {
      final id = data['id'];
      if (id is! String) throw const FormatException('交互标识无效');
      interactions.remove(id);
      _deadlines.remove(id)?.cancel();
      _notify();
      return;
    }
    if (!has('approval')) return;
    final kind = name == 'approval.request' ? 'approval' : 'question';
    final id = data[kind == 'approval' ? 'approvalId' : 'questionId'];
    final deadline = data['deadline'];
    if (id is! String ||
        id.isEmpty ||
        deadline is! int ||
        kind == 'question' && data['questions'] is! List) {
      throw const FormatException('交互标识、问题或期限无效');
    }
    final interaction = PendingInteraction(kind, data);
    final remaining = deadline - DateTime.now().millisecondsSinceEpoch;
    if (remaining <= 0 ||
        remaining > 180000 ||
        interactions.containsKey(id) ||
        interactions.length >= 32) {
      return;
    }
    interactions[id] = interaction;
    _deadlines[id] = Timer(Duration(milliseconds: remaining), () {
      if (identical(interactions[id], interaction)) interactions.remove(id);
      _deadlines.remove(id);
      _notify();
    });
    _notify();
  }

  Future<void> decide(PendingInteraction item, dynamic value) async {
    if (!connected || item.sending || !identical(interactions[item.id], item)) {
      return;
    }
    final connection = _requireConnection(),
        generation = _generation,
        state = session;
    item.sending = true;
    _notify();
    try {
      await _ownedRequest(
        connection,
        generation,
        state,
        item.kind == 'approval' ? 'approval.decide' : 'question.answer',
        item.kind == 'approval'
            ? {'approvalId': item.id, 'outcome': value}
            : {'questionId': item.id, 'answer': value},
      );
      if (identical(interactions[item.id], item)) {
        interactions.remove(item.id);
        _deadlines.remove(item.id)?.cancel();
      }
    } catch (failure, stack) {
      if (!_owns(connection, generation, state) ||
          !identical(interactions[item.id], item)) {
        return;
      }
      if (failure is RemoteException && failure.code == 'not-found') {
        interactions.remove(item.id);
        _deadlines.remove(item.id)?.cancel();
      } else {
        item.sending = false;
        _boundary(failure, stack);
      }
    }
    _notify();
  }

  void _clearInteractions() {
    for (final timer in _deadlines.values) {
      timer.cancel();
    }
    _deadlines.clear();
    interactions.clear();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (_disposed) return;
    // Native permission/file dialogs can be inactive; only a real pause disconnects.
    if (state == AppLifecycleState.paused ||
        state == AppLifecycleState.detached) {
      _foreground = false;
      _pairing?.cancel();
      _background(disconnect(manual: false));
    } else if (state == AppLifecycleState.resumed && !_foreground) {
      _foreground = true;
      _attempts = 0;
      if (!_manualStopped &&
          device != null &&
          endpoints.containsKey(device!.deviceId)) {
        _background(_establish(_generation));
      }
    }
  }

  @override
  void dispose() {
    _disposed = true;
    WidgetsBinding.instance.removeObserver(this);
    _pairing?.cancel();
    _background(disconnect());
    identity?.destroy();
    identity = null;
    super.dispose();
  }
}
