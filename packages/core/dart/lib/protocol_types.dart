// Generated from packages/protocol/schema.json; run pnpm generate.
class Request {
  const Request(this.values);
  final Map<String, Object?> values;
  String get id => values['id'] as String;
  String get m => values['m'] as String;
  Map<String, Object?> get p => values['p'] as Map<String, Object?>;
  Map<String, Object?> toJson() => Map.of(values);
}

class Response {
  const Response(this.values);
  final Map<String, Object?> values;
  String get id => values['id'] as String;
  Object? get r => values['r'];
  Map<String, Object?> toJson() => Map.of(values);
}

class ErrorResponse {
  const ErrorResponse(this.values);
  final Map<String, Object?> values;
  String get id => values['id'] as String;
  Map<String, Object?> get e => values['e'] as Map<String, Object?>;
  Map<String, Object?> toJson() => Map.of(values);
}

class Hello {
  const Hello(this.values);
  final Map<String, Object?> values;
  String get type => values['type'] as String;
  int get vmin => values['vmin'] as int;
  int get vmax => values['vmax'] as int;
  List<String> get caps => (values['caps'] as List).cast<String>();
  String get role => values['role'] as String;
  String get kind => values['kind'] as String;
  String get deviceId => values['deviceId'] as String;
  String get name => values['name'] as String;
  Map<String, Object?> toJson() => Map.of(values);
}

class Heartbeat {
  const Heartbeat(this.values);
  final Map<String, Object?> values;
  String get type => values['type'] as String;
  String get id => values['id'] as String;
  Map<String, Object?> toJson() => Map.of(values);
}

class Bye {
  const Bye(this.values);
  final Map<String, Object?> values;
  String get type => values['type'] as String;
  Map<String, Object?> toJson() => Map.of(values);
}

class SessionEvent {
  const SessionEvent(this.values);
  final Map<String, Object?> values;
  String get type => values['type'] as String;
  int get seq => values['seq'] as int;
  int get time => values['time'] as int;
  Object? get data => values['data'];
  bool? get ignorable => values['ignorable'] as bool?;
  Object? get sourceEventSeqs => values['sourceEventSeqs'];
  Object? get surfaceOp => values['surfaceOp'];
  Map<String, Object?> toJson() => Map.of(values);
}

class JournalSnapshot {
  const JournalSnapshot(this.values);
  final Map<String, Object?> values;
  String get kind => values['kind'] as String;
  int get cursor => values['cursor'] as int;
  int get firstSeq => values['firstSeq'] as int;
  List<Map<String, Object?>> get records => (values['records'] as List).cast<Map<String, Object?>>();
  bool get hasMore => values['hasMore'] as bool;
  Map<String, Object?> toJson() => Map.of(values);
}

class JournalAppend {
  const JournalAppend(this.values);
  final Map<String, Object?> values;
  String get kind => values['kind'] as String;
  List<Map<String, Object?>> get records => (values['records'] as List).cast<Map<String, Object?>>();
  Map<String, Object?> toJson() => Map.of(values);
}

class StreamEnd {
  const StreamEnd(this.values);
  final Map<String, Object?> values;
  String? get error => values['error'] as String?;
  Map<String, Object?> toJson() => Map.of(values);
}
