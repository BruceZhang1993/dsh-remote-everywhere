import 'dart:convert';

/// A bounded, transport-independent fold of the DSH follow/history wire values.
/// A rejected gap freezes follow mutations until a complete snapshot arrives.
class SessionState {
  SessionState({
    this.maxRecords = 2000,
    this.maxTransientChunks = 4096,
    this.maxRetainedBytes = 4 * 1024 * 1024,
    this.maxTransientBytes = 1024 * 1024,
  }) {
    if (maxRecords < 1 ||
        maxTransientChunks < 1 ||
        maxRetainedBytes < 1 ||
        maxTransientBytes < 1) {
      throw ArgumentError('Session retention limits must be positive');
    }
  }

  final int maxRecords;
  final int maxTransientChunks;
  final int maxRetainedBytes;
  final int maxTransientBytes;
  int cursor = -1;
  bool hasMore = false;
  bool needsSnapshot = false;
  bool retentionExceeded = false;
  String? failure;
  Map<String, dynamic> header = const {};
  final List<Map<String, dynamic>> _records = [];
  final List<int> _recordSizes = [];
  int _retainedBytes = 0;
  final Map<String, dynamic> _projections = {};
  final Map<String, int> _projectionSeqs = {};
  int? _revision;
  _Attempt? _attempt;

  List<Map<String, dynamic>> get records => List.unmodifiable(_records);
  Map<String, dynamic> get projections => Map.unmodifiable(_projections);
  int? get firstSeq => _records.isEmpty ? null : _seq(_records.first);
  AssistantPresentation? get assistant => _attempt?.presentation;
  int get retainedBytes => _retainedBytes;
  int get transientBytes => _attempt?.retainedBytes ?? 0;

  /// Returns false on duplicates or a rejected frame. Inspect [needsSnapshot]
  /// to distinguish a harmless duplicate from a follow stream requiring repair.
  bool applyFollow(Map<String, dynamic> frame) {
    final kind = frame['kind'] ?? frame['type'];
    if (needsSnapshot && kind != 'snapshot') return false;
    try {
      switch (kind) {
        case 'snapshot':
          return _snapshot(frame);
        case 'append':
          return _append(_readRecords(frame['records']));
        case 'event':
          return _append(_readRecords([frame]));
        case 'assistant-stream':
          return _assistantFrame(_map(frame['frame']));
        default:
          throw const FormatException('Unknown required session frame');
      }
    } on FormatException catch (error) {
      needsSnapshot = true;
      retentionExceeded = error is _RetentionExceeded;
      failure = error.message.toString();
      return false;
    }
  }

  bool _snapshot(Map<String, dynamic> frame) {
    final nextCursor = _int(frame['cursor'], min: -1);
    final more = _bool(frame['hasMore']);
    final next = _readRecords(frame['records']);
    final nextSizes = next.map(_recordSize).toList();
    if (next.isNotEmpty && _seq(next.last) != nextCursor) {
      throw const FormatException('Snapshot must end at its durable cursor');
    }
    final nextHeader = _freezeMap(_map(frame['header']));
    final projection = _map(frame['projections']);
    final projectionSeq = _int(projection['asOfSeq'], min: -1);
    if (projectionSeq != nextCursor) {
      throw const FormatException('Snapshot projections must match its cursor');
    }
    final values = _freezeMap(_map(projection['values']));
    final baseline = frame['assistantStream'];
    int? revision;
    _Attempt? attempt;
    if (baseline != null) {
      final value = _map(baseline);
      revision = _int(value['revision']);
      if (value['activeAttempt'] != null) {
        final opening = _map(value['activeAttempt']);
        attempt = _Attempt.fromStart(opening);
        if (attempt.startedAfterSeq > nextCursor) {
          throw const FormatException(
            'Assistant baseline starts beyond cursor',
          );
        }
        final count = _int(opening['nextIndex']);
        attempt.chunks.addAll(
          _expand(opening['stream'], maxTransientChunks, maxTransientBytes),
        );
        attempt.retainedBytes = attempt.chunks.fold(
          0,
          (bytes, chunk) => bytes + _jsonSize(chunk),
        );
        if (attempt.chunks.length != count) {
          throw const FormatException(
            'Assistant baseline chunk count mismatch',
          );
        }
        attempt.nextIndex = count;
        for (final record in next) {
          final event = _map(record['event']);
          if (!attempt.matches(event)) continue;
          if (attempt.settlementSeq != null) {
            throw const FormatException(
              'Baseline has multiple attempt settlements',
            );
          }
          attempt.settlementSeq = event['seq'] as int;
          attempt.settlementType = event['type'] as String;
        }
      }
    }
    _records
      ..clear()
      ..addAll(next);
    _recordSizes
      ..clear()
      ..addAll(nextSizes);
    _retainedBytes = nextSizes.fold(0, (bytes, size) => bytes + size);
    cursor = nextCursor;
    header = nextHeader;
    hasMore = more;
    // A replacement baseline defines all capabilities present at its cut.
    _projections
      ..clear()
      ..addAll(values);
    _projectionSeqs
      ..clear()
      ..addEntries(values.keys.map((key) => MapEntry(key, projectionSeq)));
    _revision = revision;
    _attempt = attempt;
    needsSnapshot = false;
    retentionExceeded = false;
    failure = null;
    _trim();
    return true;
  }

  bool _append(List<Map<String, dynamic>> values) {
    final fresh = values.where((record) => _seq(record) > cursor).toList();
    if (fresh.isEmpty) return false;
    final sizes = fresh.map(_recordSize).toList();
    if (_seq(fresh.first) != cursor + 1) {
      throw const FormatException('Durable follow sequence gap');
    }
    // Validate settlement before changing the durable window or cursor.
    int? settlementSeq = _attempt?.settlementSeq;
    for (final record in fresh) {
      final event = _map(record['event']);
      final attempt = _attempt;
      if (attempt != null && attempt.matches(event)) {
        if (settlementSeq != null && settlementSeq != event['seq']) {
          throw const FormatException('Multiple settlements for one attempt');
        }
        settlementSeq = event['seq'] as int;
        final outcome = attempt.outcome;
        if (outcome != null &&
            (outcome['seq'] != event['seq'] ||
                outcome['eventType'] != event['type'])) {
          throw const FormatException(
            'Durable settlement differs from end marker',
          );
        }
      }
    }
    for (final record in fresh) {
      final event = _map(record['event']);
      final attempt = _attempt;
      if (attempt != null && attempt.matches(event)) {
        attempt.settlementSeq = event['seq'] as int;
        attempt.settlementType = event['type'] as String;
        if (attempt.outcome != null) _attempt = null;
      }
      _records.add(record);
    }
    _recordSizes.addAll(sizes);
    _retainedBytes += sizes.fold(0, (bytes, size) => bytes + size);
    cursor = _seq(fresh.last);
    _trim();
    return true;
  }

  /// Older records must end directly before the resident window. Overlapping
  /// pages are accepted only when their records agree with the resident copy.
  bool prependHistory(Map<String, dynamic> page) {
    try {
      final incoming = _readRecords(page['records']);
      for (final record in incoming) {
        _recordSize(record);
      }
      final more = _bool(page['hasMore']);
      if (_records.isEmpty) {
        if (incoming.isNotEmpty && _seq(incoming.last) != cursor) {
          throw const FormatException(
            'History page does not reach current cut',
          );
        }
      } else {
        final first = _seq(_records.first);
        for (final record in incoming.where(
          (record) => _seq(record) >= first,
        )) {
          final seq = _seq(record);
          final resident = _records.where((value) => _seq(value) == seq);
          if (resident.isEmpty ||
              jsonEncode(resident.first) != jsonEncode(record)) {
            throw const FormatException('History overlap does not agree');
          }
        }
        final older = incoming.where((record) => _seq(record) < first).toList();
        if (older.isNotEmpty && _seq(older.last) != first - 1) {
          throw const FormatException('History page has a gap');
        }
      }
      final existing = _records.isEmpty ? cursor + 1 : _seq(_records.first);
      final older = incoming
          .where((record) => _seq(record) < existing)
          .toList();
      final sizes = older.map(_recordSize).toList();
      _records.insertAll(0, older);
      _recordSizes.insertAll(0, sizes);
      _retainedBytes += sizes.fold(0, (bytes, size) => bytes + size);
      hasMore = more;
      _trim();
      return older.isNotEmpty;
    } on FormatException catch (error) {
      needsSnapshot = true;
      retentionExceeded = error is _RetentionExceeded;
      failure = error.message.toString();
      return false;
    }
  }

  /// Projection watermarks belong to each key and never advance the journal.
  bool applyProjection(Map<String, dynamic> update) {
    final key = update['key'];
    if (key is! String || key.isEmpty) return false;
    final seq = update['seq'];
    if (seq is! int || seq < -1 || seq > _maxSafeInteger) return false;
    if (seq <= (_projectionSeqs[key] ?? -2)) return false;
    _projections[key] = _freeze(update['value']);
    _projectionSeqs[key] = seq;
    return true;
  }

  bool _assistantFrame(Map<String, dynamic> frame) {
    final revision = _int(frame['revision']);
    if (_revision != null && revision <= _revision!) return false;
    if (_revision != null && revision != _revision! + 1) {
      throw const FormatException('Assistant revision gap');
    }
    final type = frame['type'];
    final attemptId = _string(frame['attemptId']);
    if (type == 'start') {
      if (_attempt != null) {
        throw const FormatException('Previous assistant attempt is unsettled');
      }
      final attempt = _Attempt.fromStart(frame);
      if (attempt.startedAfterSeq > cursor) {
        throw const FormatException('Assistant start beyond durable cursor');
      }
      _attempt = attempt;
    } else if (type == 'chunk' || type == 'end') {
      final attempt = _attempt;
      // Mounting without a baseline cannot reconstruct a transient suffix.
      if (attempt == null || attempt.id != attemptId) {
        _revision = revision;
        return false;
      }
      if (attempt.outcome != null ||
          _int(frame['index']) != attempt.nextIndex) {
        throw const FormatException('Assistant chunk index gap');
      }
      if (type == 'chunk') {
        if (attempt.chunks.length >= maxTransientChunks) {
          throw const _RetentionExceeded(
            'Assistant transient chunk retention exceeded',
          );
        }
        final chunk = _freezeMap(_map(frame['chunk']));
        _validateChunk(chunk);
        final time = _int(frame['time'], min: -_maxSafeInteger);
        final timed = Map<String, dynamic>.unmodifiable({
          'time': time,
          'chunk': chunk,
        });
        final bytes = _jsonSize(timed);
        if (attempt.retainedBytes + bytes > maxTransientBytes) {
          throw const _RetentionExceeded(
            'Assistant transient byte retention exceeded',
          );
        }
        attempt.chunks.add(timed);
        attempt.retainedBytes += bytes;
        attempt.nextIndex++;
      } else {
        final outcome = _freezeMap(_map(frame['outcome']));
        if (outcome['kind'] == 'abandoned') {
          if (attempt.settlementSeq != null) {
            throw const FormatException(
              'Abandoned attempt already has a settlement',
            );
          }
          _attempt = null;
        } else if (outcome['kind'] == 'committed') {
          final seq = _int(outcome['seq']);
          final eventType = outcome['eventType'];
          if ((eventType != 'assistant/message' &&
                  eventType != 'assistant/attempt') ||
              seq <= attempt.startedAfterSeq ||
              (attempt.settlementSeq != null &&
                  (seq != attempt.settlementSeq ||
                      eventType != attempt.settlementType)) ||
              (seq <= cursor && attempt.settlementSeq == null)) {
            throw const FormatException('Assistant end has invalid settlement');
          }
          attempt.outcome = outcome;
          if (attempt.settlementSeq != null) _attempt = null;
        } else {
          throw const FormatException('Unknown assistant outcome');
        }
      }
    } else {
      throw const FormatException('Unknown assistant frame');
    }
    _revision = revision;
    return true;
  }

  void _trim() {
    var removed = 0;
    while (_records.length - removed > maxRecords ||
        _retainedBytes > maxRetainedBytes) {
      _retainedBytes -= _recordSizes[removed++];
    }
    if (removed > 0) {
      _records.removeRange(0, removed);
      _recordSizes.removeRange(0, removed);
      hasMore = true;
    }
  }

  int _recordSize(Map<String, dynamic> record) {
    final bytes = _jsonSize(record);
    if (bytes > maxRetainedBytes)
      throw const _RetentionExceeded(
        'Single durable record exceeds retained byte budget',
      );
    return bytes;
  }

  /// A small presentation model. Unknown event data remains available through
  /// [records]. Surface replacement events retire the named earlier rows.
  List<SessionMessage> get messages {
    final result = <SessionMessage>[];
    for (final record in _records) {
      final event = _map(record['event']);
      if (!_knownEventTypes.contains(event['type'])) continue;
      final op = event['surfaceOp'];
      if (op is Map &&
          op['op'] == 'replace' &&
          op['startSeq'] is int &&
          op['endSeq'] is int) {
        result.removeWhere(
          (row) =>
              row.seq != null &&
              row.seq! >= op['startSeq'] &&
              row.seq! <= op['endSeq'],
        );
      }
      if (_attempt?.settlementSeq == event['seq']) continue;
      final type = event['type'] as String;
      if (event['data'] is! Map) continue;
      final data = _map(event['data']);
      if (type == 'tool/call') {
        result.add(
          SessionMessage(
            seq: event['seq'] as int,
            role: 'tool-call',
            content: const [],
            data: data,
            toolId: data['callId'] as String?,
            toolName: data['name'] as String?,
            text: data['arguments'] as String? ?? '',
          ),
        );
      } else if (type == 'user/message' ||
          type == 'assistant/message' ||
          type == 'system/message' ||
          type == 'developer/message' ||
          type == 'tool/result') {
        final message = data['message'] is Map ? _map(data['message']) : data;
        final content = message['content'] is List
            ? List<dynamic>.unmodifiable(message['content'] as List)
            : <dynamic>[];
        result.add(
          SessionMessage(
            seq: event['seq'] as int,
            role: type == 'tool/result' ? 'tool' : type.split('/').first,
            content: content,
            data: data,
            text: _blockText(content, 'text'),
            reasoning: _blockText(content, 'reasoning'),
            toolId:
                message['toolCallId'] as String? ??
                message['callId'] as String?,
            toolName: message['name'] as String?,
          ),
        );
      }
    }
    final live = assistant;
    if (live != null) {
      result.add(
        SessionMessage(
          role: 'assistant',
          content: live.content,
          data: Map.unmodifiable({'attemptId': live.attemptId}),
          text: live.text,
          reasoning: live.reasoning,
          transient: true,
        ),
      );
    }
    return List.unmodifiable(result);
  }
}

class SessionMessage {
  const SessionMessage({
    this.seq,
    required this.role,
    required this.content,
    required this.data,
    this.text = '',
    this.reasoning = '',
    this.toolId,
    this.toolName,
    this.transient = false,
  });
  final int? seq;
  final String role;
  final List<dynamic> content;
  final Map<String, dynamic> data;
  final String text;
  final String reasoning;
  final String? toolId;
  final String? toolName;
  final bool transient;
}

class AssistantPresentation {
  AssistantPresentation._(_Attempt attempt)
    : attemptId = attempt.id,
      chunks = List.unmodifiable(attempt.chunks),
      awaitingSettlement = attempt.outcome != null,
      content = _assemble(attempt.chunks);
  final String attemptId;
  final List<Map<String, dynamic>> chunks;
  final bool awaitingSettlement;
  final List<Map<String, dynamic>> content;
  String get text => _blockText(content, 'text');
  String get reasoning => _blockText(content, 'reasoning');
  List<Map<String, dynamic>> get tools =>
      List.unmodifiable(content.where((block) => block['type'] == 'tool-call'));
}

class _Attempt {
  _Attempt(this.id, this.startedAfterSeq, this.turn, this.step);
  factory _Attempt.fromStart(Map<String, dynamic> frame) => _Attempt(
    _string(frame['attemptId']),
    _int(frame['startedAfterSeq'], min: -1),
    _int(frame['turn']),
    _int(frame['step']),
  );
  final String id;
  final int startedAfterSeq;
  final int turn;
  final int step;
  int nextIndex = 0;
  int retainedBytes = 0;
  int? settlementSeq;
  String? settlementType;
  Map<String, dynamic>? outcome;
  final List<Map<String, dynamic>> chunks = [];
  AssistantPresentation get presentation => AssistantPresentation._(this);
  bool matches(Map<String, dynamic> event) {
    if (event['type'] != 'assistant/message' &&
        event['type'] != 'assistant/attempt')
      return false;
    if (event['type'] == 'assistant/message' && event['surfaceOp'] != 'append')
      return false;
    final data = _map(event['data']);
    return event['seq'] > startedAfterSeq &&
        data['turn'] == turn &&
        data['step'] == step;
  }
}

List<Map<String, dynamic>> _readRecords(dynamic value) {
  if (value is! List) throw const FormatException('Records must be an array');
  final records = <Map<String, dynamic>>[];
  int? previous;
  for (final member in value) {
    final record = _map(member);
    if (record['type'] != 'event')
      throw const FormatException('Expected event record');
    final event = _map(record['event']);
    final seq = _int(event['seq']);
    _int(event['time'], min: -_maxSafeInteger);
    final type = _string(event['type']);
    if (event.containsKey('ignorable') && event['ignorable'] != true) {
      throw const FormatException('Invalid ignorable event marker');
    }
    if (!_knownEventTypes.contains(type) && event['ignorable'] != true) {
      throw const FormatException('Unknown required session event');
    }
    if (previous != null && seq != previous + 1)
      throw const FormatException('Records are not contiguous');
    if (!event.containsKey('data'))
      throw const FormatException('Event data is missing');
    records.add(_freezeMap(record));
    previous = seq;
  }
  return records;
}

// Vocabulary of the supported DSH 0.1.7-rc.2 session persistence catalog.
// Unknown events are accepted only with the host's explicit ignorable marker.
const _knownEventTypes = {
  'agent-preset/selected',
  'agent/inbox/spliced',
  'approval/asked',
  'approval/decided',
  'approval/policy',
  'assistant/attempt',
  'assistant/message',
  'command/done',
  'command/run',
  'compaction/end',
  'compaction/prune',
  'compaction/start',
  'compaction/summary',
  'deliverables/presented',
  'developer/message',
  'feedback/message-delete',
  'feedback/message-put',
  'feedback/record',
  'goal/change',
  'hook/invoked',
  'hook/result',
  'image/offload',
  'llm/retry',
  'llm/retry-started',
  'model/selection',
  'permission/preset',
  'plan/mode',
  'request/context',
  'request/header',
  'sandbox/mode',
  'schedule/change',
  'session-log-deepseek/delivery-accepted',
  'session/end-seed',
  'session/title',
  'session/title-llm-request',
  'step/end',
  'step/start',
  'subagent/catalog',
  'subagent/descriptor',
  'subagent/model-selection-policy',
  'system/message',
  'team/member',
  'team/message/delivered',
  'team/message/queued',
  'team/task',
  'todo/write',
  'tool-workflow/agent-end',
  'tool-workflow/agent-start',
  'tool-workflow/run-end',
  'tool-workflow/run-start',
  'tool/call',
  'tool/ptc-dispatch',
  'tool/ptc-dispatch-start',
  'tool/result',
  'turn/end',
  'turn/start',
  'user/message',
  'web/deepseek-search-llm-request',
  'workspace/changes',
};

List<Map<String, dynamic>> _expand(dynamic value, int limit, int byteLimit) {
  if (value is! List)
    throw const FormatException('Assistant stream must be an array');
  final result = <Map<String, dynamic>>[];
  var bytes = 0;
  void add(int time, Map<String, dynamic> chunk) {
    if (result.length >= limit)
      throw const _RetentionExceeded(
        'Assistant baseline exceeds chunk retention',
      );
    _validateChunk(chunk);
    final timed = _freezeMap({'time': time, 'chunk': chunk});
    bytes += _jsonSize(timed);
    if (bytes > byteLimit)
      throw const _RetentionExceeded(
        'Assistant baseline exceeds byte retention',
      );
    result.add(timed);
  }

  for (final member in value) {
    final record = _map(member);
    if (record['type'] == 'chunk') {
      add(_int(record['time'], min: -_maxSafeInteger), _map(record['chunk']));
      continue;
    }
    final type = record['type'];
    if (type != 'text-chunks' &&
        type != 'reasoning-chunks' &&
        type != 'tool-call-chunks') {
      throw const FormatException('Unknown compact assistant stream record');
    }
    var time = _int(record['time0'], min: -_maxSafeInteger);
    final index = _int(record['index']);
    final members = record[type == 'tool-call-chunks' ? 'args' : 'texts'];
    final gaps = record['dt'];
    if (members is! List ||
        members.isEmpty ||
        members.any((part) => part is! String) ||
        gaps is! List ||
        gaps.length != members.length - 1) {
      throw const FormatException('Invalid compact assistant delta run');
    }
    for (var position = 0; position < members.length; position++) {
      if (position > 0)
        time = _int(
          time + _int(gaps[position - 1], min: -_maxSafeInteger),
          min: -_maxSafeInteger,
        );
      add(
        time,
        type == 'tool-call-chunks'
            ? {
                'type': 'tool-call-delta',
                'index': index,
                'id': _string(record['id']),
                if (record.containsKey('name')) 'name': _string(record['name']),
                'argumentsDelta': members[position],
              }
            : {
                'type': type == 'text-chunks'
                    ? 'text-delta'
                    : 'reasoning-delta',
                'index': index,
                'text': members[position],
              },
      );
    }
  }
  return result;
}

List<Map<String, dynamic>> _assemble(List<Map<String, dynamic>> chunks) {
  final blocks = <int, Map<String, dynamic>>{};
  final closed = <int>{};
  for (final timed in chunks) {
    final chunk = _map(timed['chunk']);
    final index = chunk['index'];
    if (index is! int || closed.contains(index)) continue;
    final type = chunk['type'];
    if (type == 'block-end') {
      blocks[index] = Map<String, dynamic>.from(_map(chunk['block']));
      closed.add(index);
    } else if (type == 'text-delta' || type == 'reasoning-delta') {
      final block = blocks.putIfAbsent(
        index,
        () => {'type': type == 'text-delta' ? 'text' : 'reasoning', 'text': ''},
      );
      block['text'] = '${block['text'] ?? ''}${chunk['text'] ?? ''}';
    } else if (type == 'tool-call-delta') {
      final block = blocks.putIfAbsent(
        index,
        () => {'type': 'tool-call', 'arguments': ''},
      );
      block['id'] = chunk['id'];
      if (chunk['name'] != null) block['name'] = chunk['name'];
      block['arguments'] =
          '${block['arguments'] ?? ''}${chunk['argumentsDelta'] ?? ''}';
    }
  }
  return List.unmodifiable(blocks.values.map(_freezeMap));
}

String _blockText(List<dynamic> blocks, String type) => blocks
    .whereType<Map>()
    .where((block) => block['type'] == type)
    .map((block) => block['text'] is String ? block['text'] as String : '')
    .join();
void _validateChunk(Map<String, dynamic> chunk) {
  final type = _string(chunk['type']);
  if (type == 'usage' || type == 'finish') return;
  _int(chunk['index']);
  if (type == 'text-delta' || type == 'reasoning-delta') {
    if (chunk['text'] is String) return;
  } else if (type == 'tool-call-delta') {
    if (chunk['id'] is String &&
        chunk['argumentsDelta'] is String &&
        (!chunk.containsKey('name') || chunk['name'] is String))
      return;
  } else if (type == 'block-start') {
    _string(chunk['blockType']);
    return;
  } else if (type == 'block-end') {
    final block = _map(chunk['block']);
    final blockType = _string(block['type']);
    if ((blockType == 'text' || blockType == 'reasoning') &&
        block['text'] is! String) {
      throw const FormatException('Assistant closed text block is invalid');
    }
    return;
  }
  throw const FormatException('Invalid assistant chunk');
}

const _maxSafeInteger = 9007199254740991;
int _jsonSize(dynamic value) => utf8.encode(jsonEncode(value)).length;

class _RetentionExceeded extends FormatException {
  const _RetentionExceeded(super.message);
}

int _seq(Map<String, dynamic> record) => _map(record['event'])['seq'] as int;
int _int(dynamic value, {int min = 0}) {
  if (value is! int || value < min || value > _maxSafeInteger)
    throw const FormatException('Expected safe integer');
  return value;
}

String _string(dynamic value) {
  if (value is! String || value.isEmpty)
    throw const FormatException('Expected non-empty string');
  return value;
}

bool _bool(dynamic value) {
  if (value is! bool) throw const FormatException('Expected boolean');
  return value;
}

Map<String, dynamic> _map(dynamic value) {
  if (value is! Map || value.keys.any((key) => key is! String))
    throw const FormatException('Expected JSON object');
  return Map<String, dynamic>.from(value);
}

dynamic _freeze(dynamic value) {
  if (value is Map)
    return Map<String, dynamic>.unmodifiable(
      value.map((key, member) => MapEntry(key as String, _freeze(member))),
    );
  if (value is List) return List<dynamic>.unmodifiable(value.map(_freeze));
  return value;
}

Map<String, dynamic> _freezeMap(Map<String, dynamic> value) =>
    _freeze(value) as Map<String, dynamic>;
