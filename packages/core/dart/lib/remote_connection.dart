import 'dart:async';
import 'dart:collection';
import 'dart:convert';
import 'dart:io';
import 'dart:math';
import 'dart:typed_data';

import 'package:crypto/crypto.dart' as crypto;

import 'frame.dart';
import 'noise_xx_blake2s.dart';

const _applicationLimit = 4 * 1024 * 1024;
final _wireId = RegExp(r'^[A-Za-z0-9_-]{11}$');
const _eventNames = {
  'session.frame',
  'control.frame',
  'approval.request',
  'approval.responded',
  'question.request',
  'question.responded',
  'files.chunk',
  'terminal.output',
};
const _deviceCaps = {
  'session',
  'stream',
  'approval',
  'files',
  'terminal',
  'admin',
};

class RemoteException implements Exception {
  const RemoteException(this.code, this.message);
  final String code;
  final String message;
  @override
  String toString() => '$code: $message';
}

String deviceId(List<int> publicKey) =>
    base64Url.encode(sha256(publicKey).sublist(0, 16)).replaceAll('=', '');

class Identity {
  Identity.fromSecret(List<int> secret)
    : secretKey = Uint8List.fromList(secret) {
    if (secret.length != 32) throw ArgumentError('identity requires 32 bytes');
    publicKey = publicKeyFromSecret(secretKey);
  }
  factory Identity.generate() => Identity.fromSecret(_randomBytes(32));
  final Uint8List secretKey;
  late final Uint8List publicKey;
  String get deviceId =>
      base64Url.encode(sha256(publicKey).sublist(0, 16)).replaceAll('=', '');
  void destroy() => secretKey.fillRange(0, secretKey.length, 0);
}

Uint8List _randomBytes(int length) {
  final random = Random.secure();
  return Uint8List.fromList(List.generate(length, (_) => random.nextInt(256)));
}

/// Cancellation never retries or implicitly cancels a remote session task.
class RemoteCancellation {
  final Set<void Function()> _listeners = {};
  bool get isCancelled => _cancelled;
  bool _cancelled = false;
  void cancel() {
    if (_cancelled) return;
    _cancelled = true;
    for (final listener in List.of(_listeners)) {
      listener();
    }
    _listeners.clear();
  }

  void Function() _listen(void Function() listener) {
    if (_cancelled) {
      listener();
    } else {
      _listeners.add(listener);
    }
    return () => _listeners.remove(listener);
  }
}

Uri _endpoint(String value) {
  final uri = Uri.tryParse(value);
  if (value.length > 2048 ||
      uri == null ||
      !{'ws', 'wss'}.contains(uri.scheme) ||
      uri.host.isEmpty ||
      uri.userInfo.isNotEmpty ||
      uri.hasFragment ||
      uri.scheme == 'ws' &&
          !{'localhost', '127.0.0.1', '::1'}.contains(uri.host)) {
    throw const RemoteException(
      'invalid-argument',
      'use WSS or loopback WS endpoint',
    );
  }
  return uri;
}

void _validateCaps(List<String> caps) {
  if (caps.isEmpty ||
      caps.toSet().length != caps.length ||
      caps.any((cap) => !_deviceCaps.contains(cap))) {
    throw const RemoteException('invalid-argument', 'invalid capabilities');
  }
}

class PairingRequest {
  PairingRequest._(
    this.sid,
    this.expiresAt,
    this.endpoint,
    this.publicKey,
    this.name,
    this.caps,
  );
  factory PairingRequest.parse(Map<String, dynamic> value, {DateTime? now}) {
    final time = (now ?? DateTime.now()).millisecondsSinceEpoch ~/ 1000;
    if (value.keys.toSet().difference({
          'v',
          'sid',
          'exp',
          'relay',
          'pk',
          'name',
          'caps',
        }).isNotEmpty ||
        value['v'] != 1 ||
        value['sid'] is! String ||
        !RegExp(r'^[A-Za-z0-9_-]{22}$').hasMatch(value['sid'] as String) ||
        value['exp'] is! int ||
        value['exp'] <= time ||
        value['exp'] > time + 300 ||
        value['pk'] is! String ||
        !RegExp(r'^[A-Za-z0-9+/]{43}=$').hasMatch(value['pk'] as String) ||
        value['name'] is! String ||
        (value['name'] as String).isEmpty ||
        (value['name'] as String).length > 80 ||
        value['relay'] is! String ||
        value['caps'] is! List ||
        (value['caps'] as List).any((cap) => cap is! String)) {
      throw const RemoteException(
        'invalid-argument',
        'invalid or expired pairing payload',
      );
    }
    final caps = (value['caps'] as List).cast<String>();
    _validateCaps(caps);
    _endpoint(value['relay'] as String);
    final publicKey = base64.decode(value['pk'] as String);
    if (publicKey.length != 32 || base64.encode(publicKey) != value['pk']) {
      throw const RemoteException(
        'invalid-argument',
        'noncanonical pairing public key',
      );
    }
    return PairingRequest._(
      value['sid'],
      DateTime.fromMillisecondsSinceEpoch(value['exp'] * 1000),
      value['relay'],
      publicKey,
      value['name'],
      List.unmodifiable(caps),
    );
  }
  final String sid, endpoint, name;
  final DateTime expiresAt;
  final Uint8List publicKey;
  final List<String> caps;
}

class PairedDevice {
  const PairedDevice({
    required this.deviceId,
    required this.publicKey,
    required this.name,
    required this.caps,
    required this.endpoint,
  });
  final String deviceId, name, endpoint;
  final Uint8List publicKey;
  final List<String> caps;
}

Future<PairedDevice> pairDevice({
  required Identity identity,
  required PairingRequest payload,
  required Future<bool> Function(String sas) confirm,
  String name = 'DSH Remote',
  RemoteCancellation? cancellation,
}) async {
  final remaining = payload.expiresAt.difference(DateTime.now());
  if (remaining <= Duration.zero)
    throw const RemoteException('unauthorized', 'pairing expired');
  final uri = _endpoint(payload.endpoint);
  final connection = await RemoteConnection.connect(
    uri
        .replace(queryParameters: {...uri.queryParameters, 'sid': payload.sid})
        .toString(),
    identity: identity,
    peerPublicKey: payload.publicKey,
    pairSid: payload.sid,
    caps: ['admin'],
    name: name,
    requestTimeout: remaining,
    cancellation: cancellation,
  );
  final expiration = Timer(
    payload.expiresAt.difference(DateTime.now()),
    () => connection.close(
      const RemoteException('unauthorized', 'pairing expired'),
    ),
  );
  final remove = cancellation?._listen(
    () => connection.close(
      const RemoteException('cancelled', 'pairing cancelled'),
    ),
  );
  try {
    final accepted = await Future.any([
      confirm(connection.sas),
      connection.closed.then<bool>((error) => throw error),
    ]);
    if (!accepted)
      throw const RemoteException('cancelled', 'SAS not confirmed');
    final result = await connection.request('pair.confirm', {
      'deviceId': identity.deviceId,
      'sas': connection.sas,
    }, cancellation: cancellation);
    if (result is! Map ||
        result['ok'] != true ||
        result['deviceId'] != deviceId(payload.publicKey) ||
        result['caps'] is! List ||
        (result['caps'] as List).any((cap) => cap is! String)) {
      throw const RemoteException('unauthorized', 'invalid pairing receipt');
    }
    final caps = (result['caps'] as List).cast<String>();
    _validateCaps(caps);
    if (caps.any((cap) => !payload.caps.contains(cap)))
      throw const RemoteException('unauthorized', 'unexpected pairing grant');
    return PairedDevice(
      deviceId: result['deviceId'],
      publicKey: Uint8List.fromList(payload.publicKey),
      name: connection.peerHello['name'] as String,
      caps: List.unmodifiable(caps),
      endpoint: payload.endpoint,
    );
  } finally {
    remove?.call();
    expiration.cancel();
    connection.close();
  }
}

/// Explicit HTTP upgrade exposes tunnel status and gives the owner a raw socket
/// to destroy immediately, including peers that never acknowledge WS close.
Future<(WebSocket, Socket)> _openSocket(Uri uri, HttpClient client) async {
  final request = await client.getUrl(
    uri.replace(scheme: uri.scheme == 'wss' ? 'https' : 'http'),
  );
  request.followRedirects = false;
  final key = base64.encode(_randomBytes(16));
  request.headers.set(HttpHeaders.connectionHeader, 'Upgrade');
  request.headers.set(HttpHeaders.upgradeHeader, 'websocket');
  request.headers.set('Sec-WebSocket-Version', '13');
  request.headers.set('Sec-WebSocket-Key', key);
  final response = await request.close();
  if (response.statusCode != HttpStatus.switchingProtocols) {
    throw RemoteException(
      response.statusCode == 429
          ? 'tunnel/busy'
          : response.statusCode == 530
          ? 'tunnel/expired'
          : 'transport/lost',
      'WebSocket upgrade refused',
    );
  }
  final expected = base64.encode(
    crypto.sha1
        .convert(utf8.encode('${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11'))
        .bytes,
  );
  if (response.headers.value('Sec-WebSocket-Accept') != expected ||
      response.headers.value(HttpHeaders.upgradeHeader)?.toLowerCase() !=
          'websocket' ||
      !(response.headers[HttpHeaders.connectionHeader] ?? [])
          .expand((value) => value.toLowerCase().split(','))
          .any((value) => value.trim() == 'upgrade') ||
      response.headers.value('Sec-WebSocket-Extensions') != null ||
      response.headers.value('Sec-WebSocket-Protocol') != null) {
    throw const RemoteException('transport/lost', 'invalid WebSocket upgrade');
  }
  final socket = await response.detachSocket();
  try {
    return (
      WebSocket.fromUpgradedSocket(
        socket,
        serverSide: false,
        compression: CompressionOptions.compressionOff,
      ),
      socket,
    );
  } on Exception {
    socket.destroy();
    rethrow;
  }
}

class _Sequence {
  int tx = 0, rx = 0;
}

class _Pending {
  _Pending(this.finish);
  final void Function(RemoteException?, dynamic) finish;
}

/// One pinned controller session owns the socket, keys, timers, RPCs and streams.
/// Reconnection creates a fresh instance; writes are never automatically replayed.
class RemoteConnection {
  RemoteConnection._(
    this._socket,
    this._rawSocket,
    this._client,
    Identity identity,
    this._pin,
    this._caps,
    this._name,
    String? pairSid,
    this.requestTimeout,
    Duration handshakeTimeout,
    Duration heartbeatInterval,
    this._sendTimeout,
  ) : _noise = NoiseXX(
        initiator: true,
        staticSecretKey: identity.secretKey,
        staticPublicKey: identity.publicKey,
        prologue: utf8Bytes(
          pairSid == null
              ? 'dsh-remote/v1/resume:${deviceId(_pin)}'
              : 'dsh-remote/v1/pair:$pairSid',
        ),
      ),
      _identityId = identity.deviceId {
    _ready.future.ignore();
    _subscription = _socket.listen(
      _receive,
      onError: (Object _) =>
          close(const RemoteException('transport/lost', 'WebSocket failed')),
      onDone: () =>
          close(const RemoteException('transport/lost', 'WebSocket closed')),
    );
    _deadline = Timer(
      handshakeTimeout,
      () =>
          close(const RemoteException('transport/lost', 'handshake timed out')),
    );
    _heartbeat = Timer.periodic(heartbeatInterval, (_) {
      if (!isReady) return;
      if (_heartbeats.length >= 3) {
        close(const RemoteException('transport/lost', 'heartbeat timed out'));
        return;
      }
      final id = _newId();
      _heartbeats.add(id);
      _sendFrame(4, {
        'type': 'ping',
        'id': id,
      }).catchError((Object error) => close(_failure(error)));
    });
    _enqueue(_noise.writeMessage())
        .catchError((Object error) => close(_failure(error)));
  }

  static Future<RemoteConnection> connect(
    String endpoint, {
    required Identity identity,
    required List<int> peerPublicKey,
    required List<String> caps,
    String? pairSid,
    String name = 'DSH Remote',
    Duration requestTimeout = const Duration(seconds: 120),
    Duration handshakeTimeout = const Duration(seconds: 10),
    Duration heartbeatInterval = const Duration(seconds: 25),
    Duration sendTimeout = const Duration(seconds: 10),
    RemoteCancellation? cancellation,
  }) async {
    final uri = _endpoint(endpoint);
    _validateCaps(caps);
    if (peerPublicKey.length != 32 ||
        identity.secretKey.length != 32 ||
        name.isEmpty ||
        name.length > 80 ||
        [
          requestTimeout,
          handshakeTimeout,
          heartbeatInterval,
          sendTimeout,
        ].any((value) => value <= Duration.zero) ||
        pairSid != null && !RegExp(r'^[A-Za-z0-9_-]{22}$').hasMatch(pairSid)) {
      throw const RemoteException(
        'invalid-argument',
        'invalid identity, pin or connection options',
      );
    }
    if (cancellation?.isCancelled == true)
      throw const RemoteException('cancelled', 'connection cancelled');
    final client = HttpClient()..connectionTimeout = handshakeTimeout;
    final cancelled = Completer<(WebSocket, Socket)>();
    cancelled.future.ignore();
    final remove = cancellation?._listen(() {
      client.close(force: true);
      if (!cancelled.isCompleted)
        cancelled.completeError(
          const RemoteException('cancelled', 'connection cancelled'),
        );
    });
    WebSocket? socket;
    Socket? rawSocket;
    RemoteConnection? connection;
    try {
      final opening = _openSocket(uri, client).then((value) {
        if (cancelled.isCompleted) {
          value.$2.destroy();
          throw const RemoteException('cancelled', 'connection cancelled');
        }
        return value;
      });
      final opened = await Future.any([opening, cancelled.future])
          .timeout(handshakeTimeout);
      socket = opened.$1;
      rawSocket = opened.$2;
      connection = RemoteConnection._(
        socket,
        rawSocket,
        client,
        identity,
        Uint8List.fromList(peerPublicKey),
        List.unmodifiable(caps),
        name,
        pairSid,
        requestTimeout,
        handshakeTimeout,
        heartbeatInterval,
        sendTimeout,
      );
      final stop = cancellation?._listen(
        () => connection!.close(
          const RemoteException('cancelled', 'connection cancelled'),
        ),
      );
      try {
        await connection._ready.future;
      } finally {
        stop?.call();
      }
      return connection;
    } catch (error) {
      connection?.close(_failure(error));
      rawSocket?.destroy();
      client.close(force: true);
      if (!cancelled.isCompleted)
        cancelled.completeError(
          const RemoteException('cancelled', 'connection stopped'),
        );
      if (error is RemoteException) rethrow;
      throw const RemoteException(
        'transport/lost',
        'WebSocket connection failed',
      );
    } finally {
      remove?.call();
    }
  }

  final WebSocket _socket;
  final Socket _rawSocket;
  final HttpClient _client;
  final NoiseXX _noise;
  final Uint8List _pin;
  final List<String> _caps;
  final String _name, _identityId;
  final Duration requestTimeout, _sendTimeout;
  final _ready = Completer<void>();
  final _closed = Completer<RemoteException>();
  final _events = _Inbox(() {});
  final _sequences = <int, _Sequence>{0: _Sequence()};
  final _pending = <String, _Pending>{};
  final _streams = <int, _Inbox>{};
  final _heartbeats = <String>{};
  late final StreamSubscription<dynamic> _subscription;
  late final Timer _deadline, _heartbeat;
  Future<void> _tail = Future.value();
  int _queueBytes = 0, _queueMessages = 0, _nextStream = 1;
  String _state = 'handshaking';
  late final String sas;
  Map<String, dynamic> peerHello = const {};
  Set<String> negotiatedCaps = const {};
  bool get isReady => _state == 'ready';
  Future<RemoteException> get closed => _closed.future;
  Stream<Map<String, dynamic>> get events => _events.controller.stream;
  String _newId() => base64Url.encode(_randomBytes(8)).replaceAll('=', '');

  static RemoteException _failure(Object error) => error is RemoteException
      ? error
      : const RemoteException('transport/lost', 'connection failed');

  void _receive(dynamic message) {
    if (_state == 'closed') return;
    try {
      if (message is! List<int> ||
          message.isEmpty ||
          message.length > maxWireBytes)
        throw const RemoteException(
          'invalid-argument',
          'expected bounded binary WebSocket message',
        );
      final bytes = Uint8List.fromList(message);
      if (_state == 'handshaking') {
        _noise.readMessage(bytes);
        if (_noise.rs == null || !constantTimeEquals(_noise.rs!, _pin))
          throw const RemoteException(
            'unauthorized',
            'peer identity does not match pin',
          );
        _enqueue(_noise.writeMessage())
            .catchError((Object error) => close(_failure(error)));
        sas = deriveSas(_noise.handshakeHash!, _noise.sPublic, _pin);
        _wipeHandshake();
        _state = 'hello';
        _sendFrame(4, {
          'type': 'hello',
          'vmin': 1,
          'vmax': 1,
          'caps': _caps,
          'role': 'controller',
          'kind': 'mobile',
          'deviceId': _identityId,
          'name': _name,
        }).catchError((Object error) => close(_failure(error)));
        return;
      }
      final header = DrHeader.decode(bytes);
      final sequence = _sequences[header.streamId];
      if (sequence == null)
        throw const RemoteException(
          'invalid-argument',
          'unknown physical stream',
        );
      final plaintext = decryptFrame(
        bytes,
        _noise.rx!,
        expectedSeq: sequence.rx,
        expectedStreamId: header.streamId,
      );
      sequence.rx++;
      if (header.kind == 5) {
        if (plaintext.isEmpty ||
            plaintext.length > 32768 ||
            header.streamId == 0)
          throw const RemoteException(
            'invalid-argument',
            'invalid SDATA block',
          );
        _streams[header.streamId]!.chunk(plaintext);
        return;
      }
      final decoded = jsonDecode(utf8.decode(plaintext, allowMalformed: false));
      if (decoded is! Map<String, dynamic>)
        throw const RemoteException(
          'invalid-argument',
          'invalid frame payload',
        );
      final value = decoded;
      if (_state == 'hello') {
        if (value['type'] == 'authentication-rejected')
          throw const RemoteException(
            'unauthorized',
            'paired host refused this device',
          );
        if (header.streamId != 0 ||
            header.kind != 4 ||
            value['type'] != 'hello' ||
            value['role'] != 'controlled' ||
            !{'dsh', 'cli'}.contains(value['kind']) ||
            value['vmin'] is! int ||
            value['vmax'] is! int ||
            value['vmin'] != 1 ||
            value['vmax'] < 1 ||
            value['vmax'] > 255 ||
            value['deviceId'] != deviceId(_pin) ||
            value['name'] is! String ||
            (value['name'] as String).isEmpty ||
            (value['name'] as String).length > 80 ||
            value['caps'] is! List ||
            (value['caps'] as List).any(
              (cap) =>
                  cap is! String ||
                  !{..._deviceCaps, 'diagnostic'}.contains(cap),
            ) ||
            (value['caps'] as List).length !=
                (value['caps'] as List).toSet().length) {
          throw const RemoteException('unauthorized', 'invalid peer hello');
        }
        negotiatedCaps = Set.unmodifiable(
          (value['caps'] as List).cast<String>().where(_caps.contains),
        );
        if (negotiatedCaps.isEmpty)
          throw const RemoteException('unsupported', 'no common capabilities');
        peerHello = Map.unmodifiable(value);
        _state = 'ready';
        _deadline.cancel();
        _ready.complete();
        return;
      }
      if (header.streamId != 0) {
        final inbox = _streams[header.streamId]!;
        if (header.kind == 4 &&
            value['type'] == 'application' &&
            _eventNames.contains(value['name']) &&
            value['data'] is Map &&
            value['data']['bytes'] is int) {
          inbox.commit(value['data']['bytes'] as int);
        } else if (header.kind == 6 &&
            value.keys.every((key) => key == 'error') &&
            (value['error'] == null || value['error'] is String)) {
          inbox.end(
            value['error'] == null
                ? null
                : RemoteException(value['error'], 'remote stream failed'),
          );
          _streams.remove(header.streamId);
          _sequences.remove(header.streamId);
        } else {
          throw const RemoteException(
            'invalid-argument',
            'unexpected logical stream frame',
          );
        }
      } else if (header.kind == 2 || header.kind == 3) {
        if (value['id'] is! String ||
            !_wireId.hasMatch(value['id'] as String) ||
            header.kind == 2 && !value.containsKey('r') ||
            header.kind == 3 &&
                (value['e'] is! Map ||
                    value['e']['code'] is! String ||
                    value['e']['message'] is! String))
          throw const RemoteException(
            'invalid-argument',
            'invalid RPC response',
          );
        _pending[value['id']]?.finish(
          header.kind == 3
              ? RemoteException(value['e']['code'], value['e']['message'])
              : null,
          value['r'],
        );
      } else if (header.kind == 4) {
        switch (value['type']) {
          case 'ping':
            if (value['id'] is! String ||
                !_wireId.hasMatch(value['id'] as String))
              throw const RemoteException(
                'invalid-argument',
                'invalid heartbeat',
              );
            _sendFrame(4, {
              'type': 'pong',
              'id': value['id'],
            }).catchError((Object error) => close(_failure(error)));
          case 'pong':
            if (value['id'] is! String ||
                !_wireId.hasMatch(value['id'] as String))
              throw const RemoteException(
                'invalid-argument',
                'invalid heartbeat',
              );
            _heartbeats.remove(value['id']);
          case 'bye':
            close();
          case 'application':
            if (!_eventNames.contains(value['name']) || value['data'] is! Map)
              throw const RemoteException(
                'invalid-argument',
                'invalid application event',
              );
            _events.push(value, plaintext.length);
          default:
            throw const RemoteException(
              'invalid-argument',
              'unexpected control event',
            );
        }
      } else {
        throw const RemoteException(
          'invalid-argument',
          'controller received unexpected request',
        );
      }
    } on RemoteException catch (error) {
      close(error);
    } on FormatException {
      close(
        const RemoteException(
          'invalid-argument',
          'invalid UTF-8 JSON or physical frame',
        ),
      );
    } on StateError {
      close(
        const RemoteException('unauthorized', 'invalid Noise handshake state'),
      );
    } on Exception {
      close(
        const RemoteException('unauthorized', 'Noise authentication failed'),
      );
    }
  }

  void _wipeHandshake() {
    for (final key in [
      _noise.sSecret,
      _noise.eSecret,
      _noise.ck,
      _noise.cipher.k,
    ]) {
      key?.fillRange(0, key.length, 0);
    }
  }

  Future<void> _enqueue(Uint8List bytes) {
    if (_state == 'closed')
      return Future.error(
        const RemoteException('transport/lost', 'connection closed'),
      );
    if (_queueMessages >= 128 || _queueBytes + bytes.length > 1024 * 1024) {
      const error = RemoteException('busy', 'outgoing queue full');
      close(error);
      return Future.error(error);
    }
    _queueMessages++;
    _queueBytes += bytes.length;
    final operation = _tail
        .then((_) async {
          if (_state == 'closed')
            throw const RemoteException('transport/lost', 'connection closed');
          await Future.any([
            _socket.addStream(Stream.value(bytes)),
            closed.then<void>((error) => throw error),
          ]).timeout(_sendTimeout);
        })
        .whenComplete(() {
          _queueMessages--;
          _queueBytes -= bytes.length;
        });
    _tail = operation.catchError((Object error) => close(_failure(error)));
    return operation;
  }

  Future<void> _sendFrame(
    int kind,
    Map<String, dynamic> value, [
    int streamId = 0,
  ]) {
    if (!isReady &&
        !(_state == 'hello' && kind == 4 && value['type'] == 'hello'))
      return Future.error(
        const RemoteException('unauthorized', 'connection not ready'),
      );
    final bytes = utf8Bytes(jsonEncode(value));
    if (bytes.length > 65519)
      return Future.error(
        const RemoteException(
          'invalid-argument',
          'RPC payload exceeds frame budget',
        ),
      );
    final sequence = _sequences[streamId]!;
    if (_noise.tx!.n >= 0xfffffffe) {
      const error = RemoteException(
        'transport/lost',
        'Noise message budget exhausted',
      );
      close(error);
      return Future.error(error);
    }
    final frame = encryptFrame(
      DrHeader(kind, streamId, sequence.tx),
      _noise.tx!,
      bytes,
    );
    sequence.tx++;
    return _enqueue(frame);
  }

  Future<dynamic> request(
    String method,
    Map<String, dynamic> params, {
    Duration? timeout,
    RemoteCancellation? cancellation,
  }) {
    final duration = timeout ?? requestTimeout;
    if (!isReady)
      return Future.error(
        const RemoteException('unauthorized', 'connection not ready'),
      );
    if (duration <= Duration.zero || method.isEmpty || method.length > 128)
      return Future.error(
        const RemoteException('invalid-argument', 'invalid request options'),
      );
    if (_pending.length >= 32)
      return Future.error(
        const RemoteException('busy', 'too many pending requests'),
      );
    if (cancellation?.isCancelled == true)
      return Future.error(
        const RemoteException('cancelled', 'request cancelled'),
      );
    final id = _newId(), result = Completer<dynamic>();
    Timer? timer;
    void Function()? remove;
    void finish(RemoteException? error, dynamic value) {
      if (_pending.remove(id) == null) return;
      timer?.cancel();
      remove?.call();
      if (error == null) {
        result.complete(value);
      } else {
        result.completeError(error);
      }
    }

    _pending[id] = _Pending(finish);
    timer = Timer(
      duration,
      () => finish(
        const RemoteException(
          'timeout',
          'request timed out; remote result may be unknown',
        ),
        null,
      ),
    );
    remove = cancellation?._listen(
      () => finish(
        const RemoteException(
          'cancelled',
          'request cancelled; remote result may be unknown',
        ),
        null,
      ),
    );
    try {
      _sendFrame(1, {
        'id': id,
        'm': method,
        'p': params,
      }).catchError((Object error) => finish(_failure(error), null));
    } on JsonUnsupportedObjectError {
      finish(
        const RemoteException(
          'invalid-argument',
          'request is not JSON encodable',
        ),
        null,
      );
    } on Exception {
      finish(
        const RemoteException(
          'invalid-argument',
          'request is not JSON encodable',
        ),
        null,
      );
    }
    return result.future;
  }

  Future<Stream<Map<String, dynamic>>> open(
    String method,
    Map<String, dynamic> params, {
    RemoteCancellation? cancellation,
  }) async {
    if (!isReady)
      throw const RemoteException('unauthorized', 'connection not ready');
    if (cancellation?.isCancelled == true)
      throw const RemoteException('cancelled', 'stream opening cancelled');
    if (_streams.length >= 32 || _nextStream > 0xffffffff)
      throw const RemoteException('busy', 'logical stream budget exhausted');
    final id = _nextStream;
    _nextStream += 2;
    final inbox = _Inbox(() => _cancelStream(id));
    _streams[id] = inbox;
    _sequences[id] = _Sequence();
    final remove = cancellation?._listen(() => inbox.cancel());
    inbox.onFinished = () => remove?.call();
    try {
      await request(method, {
        ...params,
        'streamId': id,
      }, cancellation: cancellation);
      return inbox.controller.stream;
    } catch (error) {
      // The host may already have allocated the stream before a timeout/cancel.
      // A fresh connection is required when opening outcome is unknown.
      if (error is RemoteException &&
          {'timeout', 'cancelled'}.contains(error.code))
        close(error);
      _streams.remove(id);
      _sequences.remove(id);
      inbox.end(const RemoteException('cancelled', 'stream opening failed'));
      rethrow;
    }
  }

  void _cancelStream(int id) {
    final inbox = _streams[id];
    if (!isReady || inbox == null || inbox.stopping) return;
    inbox.stopping = true;
    inbox.stopTimer = Timer(requestTimeout, () {
      if (_streams[id] == inbox)
        close(
          const RemoteException(
            'transport/lost',
            'logical stream did not stop',
          ),
        );
    });
    request('stream.close', {'streamId': id}).catchError((Object error) {
      close(_failure(error));
      return null;
    });
  }

  void close([
    RemoteException error = const RemoteException(
      'cancelled',
      'connection stopped',
    ),
  ]) {
    if (_state == 'closed') return;
    _state = 'closed';
    _deadline.cancel();
    _heartbeat.cancel();
    _wipeHandshake();
    for (final key in [_noise.tx?.k, _noise.rx?.k]) {
      key?.fillRange(0, key.length, 0);
    }
    for (final pending in List.of(_pending.values)) {
      pending.finish(error, null);
    }
    for (final inbox in _streams.values) {
      inbox.end(error);
    }
    _streams.clear();
    _sequences.clear();
    _heartbeats.clear();
    if (!_ready.isCompleted) _ready.completeError(error);
    _closed.complete(error);
    _events.end();
    // WebSocket.close is illegal while addStream owns the sink. Settle callers
    // first, then destroy the sole owned raw socket; queued sends see closed.
    _rawSocket.destroy();
    _client.close(force: true);
    unawaited(_subscription.cancel());
  }
}

/// Buffer only complete application values; paused/unlistened consumers are bounded.
class _Inbox {
  _Inbox(this.stop) {
    controller = StreamController<Map<String, dynamic>>(
      sync: true,
      onListen: () => scheduleMicrotask(_drain),
      onPause: () {},
      onResume: () => scheduleMicrotask(_drain),
      onCancel: cancel,
    );
  }
  final void Function() stop;
  late final StreamController<Map<String, dynamic>> controller;
  final _chunks = BytesBuilder(copy: false);
  final _queue = Queue<(Map<String, dynamic>, int)>();
  int _bytes = 0, _queuedBytes = 0;
  bool _ended = false, _cancelled = false, stopping = false;
  RemoteException? _error;
  Timer? stopTimer;
  void Function()? onFinished;
  void chunk(Uint8List bytes) {
    _bytes += bytes.length;
    if (_bytes > _applicationLimit)
      throw const RemoteException(
        'busy',
        'incoming application value exceeds 4 MiB',
      );
    _chunks.add(bytes);
  }

  void commit(int count) {
    if (_bytes == 0 || count != _bytes)
      throw const RemoteException(
        'invalid-argument',
        'incomplete application value',
      );
    final bytes = _chunks.takeBytes();
    _bytes = 0;
    final value = jsonDecode(utf8.decode(bytes, allowMalformed: false));
    if (value is! Map<String, dynamic>)
      throw const RemoteException(
        'invalid-argument',
        'application value must be an object',
      );
    push(value, count);
  }

  void push(Map<String, dynamic> value, int count) {
    if (_cancelled) return;
    if (_queue.length >= 128 || _queuedBytes + count > _applicationLimit)
      throw const RemoteException('busy', 'incoming application queue full');
    _queue.add((value, count));
    _queuedBytes += count;
    _drain();
  }

  void _drain() {
    if (_cancelled ||
        !controller.hasListener ||
        controller.isPaused ||
        controller.isClosed)
      return;
    while (_queue.isNotEmpty && !controller.isPaused && !_cancelled) {
      final item = _queue.removeFirst();
      _queuedBytes -= item.$2;
      controller.add(item.$1);
    }
    if (_ended &&
        _queue.isEmpty &&
        !controller.isPaused &&
        !controller.isClosed) {
      if (_error != null) controller.addError(_error!);
      unawaited(controller.close());
    }
  }

  void end([RemoteException? error]) {
    if (_ended) return;
    if (_bytes != 0 && error == null)
      throw const RemoteException(
        'invalid-argument',
        'truncated application value',
      );
    _ended = true;
    _error = error;
    stopTimer?.cancel();
    onFinished?.call();
    _chunks.clear();
    _bytes = 0;
    if (error != null) {
      _queue.clear();
      _queuedBytes = 0;
    }
    _drain();
  }

  void cancel() {
    if (_cancelled) return;
    _cancelled = true;
    _queue.clear();
    _queuedBytes = 0;
    onFinished?.call();
    if (!_ended) stop();
    if (!controller.isClosed) unawaited(controller.close());
  }
}
