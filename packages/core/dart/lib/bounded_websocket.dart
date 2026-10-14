import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';
import 'dart:typed_data';

import 'frame.dart';

/// Inspect RFC 6455 server frames before dart:io assembles a complete message.
/// Reassemble at most one bounded DR record. Control payloads are separate,
/// avoiding the SDK's shared data/control buffer during fragmented messages.
class WebSocketReceiveGuard {
  final _header = Uint8List(10);
  int _headerBytes = 0, _headerLength = 2, _remaining = 0, _messageBytes = 0;
  int _fragments = 0;
  bool _fragmented = false, _failed = false;
  final _message = BytesBuilder(copy: false),
      _control = BytesBuilder(copy: false);
  int _opcode = 0;
  bool _fin = false;

  void push(Uint8List chunk, {void Function(Uint8List)? onFrame}) {
    if (_failed) throw const FormatException('WebSocket guard already failed');
    try {
      var offset = 0;
      while (offset < chunk.length) {
        if (_remaining > 0) {
          final count = min(_remaining, chunk.length - offset);
          (_opcode >= 8 ? _control : _message).add(
            Uint8List.sublistView(chunk, offset, offset + count),
          );
          _remaining -= count;
          offset += count;
          if (_remaining == 0) _completeFrame(onFrame);
          continue;
        }
        final count = min(_headerLength - _headerBytes, chunk.length - offset);
        _header.setRange(_headerBytes, _headerBytes + count, chunk, offset);
        _headerBytes += count;
        offset += count;
        if (_headerBytes < _headerLength) continue;
        if (_headerLength == 2) {
          final shortLength = _header[1] & 0x7f;
          _headerLength = shortLength == 126
              ? 4
              : shortLength == 127
              ? 10
              : 2;
          if (_headerBytes < _headerLength) continue;
        }
        _acceptHeader();
        _headerBytes = 0;
        _headerLength = 2;
        if (_remaining == 0) _completeFrame(onFrame);
      }
    } on FormatException {
      _failed = true;
      discard();
      rethrow;
    }
  }

  void _acceptHeader() {
    final fin = _header[0] & 0x80 != 0;
    final opcode = _header[0] & 0x0f;
    final shortLength = _header[1] & 0x7f;
    if (_header[0] & 0x70 != 0 ||
        _header[1] & 0x80 != 0 ||
        !{0, 2, 8, 9, 10}.contains(opcode)) {
      throw const FormatException('expected unmasked binary WebSocket frame');
    }
    final view = ByteData.sublistView(_header);
    final length = shortLength == 126
        ? view.getUint16(2)
        : shortLength == 127
        ? view.getUint64(2)
        : shortLength;
    if (shortLength == 126 && length < 126 ||
        shortLength == 127 && (_header[2] & 0x80 != 0 || length < 65536)) {
      throw const FormatException('invalid WebSocket length encoding');
    }
    if (opcode >= 8) {
      if (!fin || length > 125 || opcode == 8 && length == 1) {
        throw const FormatException('invalid WebSocket control frame');
      }
    } else {
      if (opcode == 0 && !_fragmented || opcode == 2 && _fragmented) {
        throw const FormatException('invalid WebSocket continuation');
      }
      if (opcode == 2) _messageBytes = 0;
      if (++_fragments > 1024) {
        throw const FormatException('WebSocket message exceeds fragment limit');
      }
      if (length > maxWireBytes - _messageBytes) {
        throw const FormatException('WebSocket message exceeds DR wire limit');
      }
      _messageBytes += length;
      _fragmented = !fin;
      if (fin) {
        _messageBytes = 0;
        _fragments = 0;
      }
    }
    _remaining = length;
    _opcode = opcode;
    _fin = fin;
  }

  void _completeFrame(void Function(Uint8List)? onFrame) {
    if (_opcode < 8 && !_fin) return;
    final bytes = (_opcode >= 8 ? _control : _message).takeBytes();
    final headerLength = bytes.length < 126
        ? 2
        : bytes.length < 65536
        ? 4
        : 10;
    final frame = Uint8List(headerLength + bytes.length);
    frame[0] = 0x80 | (_opcode >= 8 ? _opcode : 2);
    frame[1] = headerLength == 2
        ? bytes.length
        : headerLength == 4
        ? 126
        : 127;
    final view = ByteData.sublistView(frame);
    if (headerLength == 4) view.setUint16(2, bytes.length);
    if (headerLength == 10) view.setUint64(2, bytes.length);
    frame.setRange(headerLength, frame.length, bytes);
    onFrame?.call(frame);
  }

  void discard() {
    _message.clear();
    _control.clear();
  }

  void finish() {
    if (_headerBytes != 0 || _remaining != 0 || _fragmented) {
      throw const FormatException('truncated WebSocket frame or message');
    }
  }
}

/// Keep SDK masking, control frames, close handling and write backpressure.
/// The connection owner still owns and destroys the original socket.
class BoundedWebSocketSocket extends StreamView<Uint8List> implements Socket {
  BoundedWebSocketSocket(Socket socket)
    : _socket = socket,
      super(_guarded(socket));
  final Socket _socket;

  static Stream<Uint8List> _guarded(Socket socket) {
    final guard = WebSocketReceiveGuard();
    return socket.transform(
      StreamTransformer.fromHandlers(
        handleData: (Uint8List chunk, EventSink<Uint8List> sink) {
          try {
            guard.push(chunk, onFrame: sink.add);
          } on FormatException catch (error, stack) {
            sink.addError(error, stack);
            socket.destroy();
          }
        },
        // A TCP EOF mid-frame can be network loss. Keep the SDK's abnormal
        // closure so the controller can reconnect rather than stop on bad input.
        handleDone: (sink) {
          guard.discard();
          sink.close();
        },
      ),
    );
  }

  @override
  void destroy() => _socket.destroy();
  @override
  bool setOption(SocketOption option, bool enabled) =>
      _socket.setOption(option, enabled);
  @override
  Uint8List getRawOption(RawSocketOption option) =>
      _socket.getRawOption(option);
  @override
  void setRawOption(RawSocketOption option) => _socket.setRawOption(option);
  @override
  InternetAddress get address => _socket.address;
  @override
  InternetAddress get remoteAddress => _socket.remoteAddress;
  @override
  int get port => _socket.port;
  @override
  int get remotePort => _socket.remotePort;
  @override
  Encoding get encoding => _socket.encoding;
  @override
  set encoding(Encoding value) => _socket.encoding = value;
  @override
  void add(List<int> data) => _socket.add(data);
  @override
  void addError(Object error, [StackTrace? stackTrace]) =>
      _socket.addError(error, stackTrace);
  @override
  Future<void> addStream(Stream<List<int>> stream) => _socket.addStream(stream);
  @override
  Future<void> flush() => _socket.flush();
  @override
  Future<dynamic> close() => _socket.close();
  @override
  Future<dynamic> get done => _socket.done;
  @override
  void write(Object? object) => _socket.write(object);
  @override
  void writeAll(Iterable objects, [String separator = '']) =>
      _socket.writeAll(objects, separator);
  @override
  void writeln([Object? object = '']) => _socket.writeln(object);
  @override
  void writeCharCode(int charCode) => _socket.writeCharCode(charCode);
}
