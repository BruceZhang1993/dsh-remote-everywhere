import 'dart:convert';

import 'package:dsh_remote_core/session_state.dart';
import 'package:test/test.dart';

Map<String, dynamic> record(
  int seq, {
  String type = 'user/message',
  Map<String, dynamic>? data,
  dynamic surfaceOp = 'append',
}) => {
  'type': 'event',
  'event': {
    'seq': seq,
    'time': seq + 100,
    'type': type,
    'surfaceOp': surfaceOp,
    'data':
        data ??
        {
          'message': {
            'content': [
              {'type': 'text', 'text': 'message $seq'},
            ],
          },
        },
  },
};
Map<String, dynamic> snapshot(
  List<Map<String, dynamic>> records, {
  int? cursor,
  Map<String, dynamic>? baseline,
  bool hasMore = false,
}) => {
  'kind': 'snapshot',
  'header': {'id': 'session-1', 'version': 2},
  'cursor':
      cursor ?? (records.isEmpty ? -1 : (records.last['event'] as Map)['seq']),
  'records': records,
  'hasMore': hasMore,
  'projections': {
    'asOfSeq':
        cursor ??
        (records.isEmpty ? -1 : (records.last['event'] as Map)['seq']),
    'values': {'title': 'Session'},
  },
  if (baseline != null) 'assistantStream': baseline,
};
Map<String, dynamic> assistantFrame(Map<String, dynamic> frame) => {
  'kind': 'assistant-stream',
  'frame': frame,
};
Map<String, dynamic> start({int revision = 1, String id = 'attempt-1'}) =>
    assistantFrame({
      'type': 'start',
      'attemptId': id,
      'revision': revision,
      'startedAfterSeq': 0,
      'turn': 1,
      'step': 0,
    });
Map<String, dynamic> chunk(
  int index,
  int revision, {
  String text = 'Hello',
  Map<String, dynamic>? value,
}) => assistantFrame({
  'type': 'chunk',
  'attemptId': 'attempt-1',
  'revision': revision,
  'index': index,
  'time': 1000 + index,
  'chunk': value ?? {'type': 'text-delta', 'index': 0, 'text': text},
});
Map<String, dynamic> end({
  int revision = 3,
  int index = 1,
  String kind = 'committed',
  String eventType = 'assistant/message',
}) => assistantFrame({
  'type': 'end',
  'attemptId': 'attempt-1',
  'revision': revision,
  'index': index,
  'outcome': {
    'kind': kind,
    if (kind == 'committed') 'seq': 1,
    if (kind == 'committed') 'eventType': eventType,
  },
});
Map<String, dynamic> settlement({
  String type = 'assistant/message',
  bool interrupted = false,
}) => record(
  1,
  type: type,
  data: {
    'turn': 1,
    'step': 0,
    'stream': [],
    if (interrupted) 'interrupted': true,
    if (type == 'assistant/message')
      'message': {
        'content': [
          {'type': 'text', 'text': 'Hello'},
        ],
      },
  },
);
SessionState streaming() {
  final state = SessionState();
  expect(
    state.applyFollow(snapshot([record(0)], baseline: {'revision': 0})),
    isTrue,
  );
  expect(state.applyFollow(start()), isTrue);
  expect(state.applyFollow(chunk(0, 2)), isTrue);
  return state;
}

void main() {
  test(
    'unknown required event freezes the cursor without accepting its data',
    () {
      final state = SessionState()..applyFollow(snapshot([record(0)]));
      expect(
        state.applyFollow({
          'kind': 'append',
          'records': [record(1, type: 'future/required')],
        }),
        isFalse,
      );
      expect(state.cursor, 0);
      expect(state.needsSnapshot, isTrue);
      expect(state.records.length, 1);
    },
  );

  test(
    'unknown ignorable metadata stays opaque and cannot replace visible rows',
    () {
      final optional = record(
        1,
        type: 'future/optional',
        surfaceOp: {'op': 'replace', 'startSeq': 0, 'endSeq': 0},
      );
      (optional['event'] as Map)['ignorable'] = true;
      final state = SessionState()
        ..applyFollow(snapshot([record(0), optional]));
      expect(state.needsSnapshot, isFalse);
      expect(state.cursor, 1);
      expect(state.messages.single.text, 'message 0');
    },
  );

  test('real DR append envelopes deduplicate and reject gaps atomically', () {
    final state = SessionState();
    expect(state.cursor, -1);
    expect(state.applyFollow(snapshot([record(0), record(1)])), isTrue);
    expect(
      state.applyFollow({
        'kind': 'append',
        'records': [record(1), record(2)],
      }),
      isTrue,
    );
    expect(state.cursor, 2);
    expect(
      state.applyFollow({
        'kind': 'append',
        'records': [record(2)],
      }),
      isFalse,
    );
    expect(state.needsSnapshot, isFalse);
    expect(
      state.applyFollow({
        'kind': 'append',
        'records': [record(4)],
      }),
      isFalse,
    );
    expect(state.needsSnapshot, isTrue);
    expect(state.cursor, 2);
    expect(
      state.applyFollow({
        'kind': 'append',
        'records': [record(3)],
      }),
      isFalse,
    );
    expect(
      state.applyFollow(snapshot([record(3), record(4)], hasMore: true)),
      isTrue,
    );
    expect(state.needsSnapshot, isFalse);
    expect(state.cursor, 4);
    expect(state.messages.map((message) => message.text), [
      'message 3',
      'message 4',
    ]);
  });

  test('native DSH type envelopes are accepted', () {
    final state = SessionState();
    final opening = snapshot([])..remove('kind');
    opening['type'] = 'snapshot';
    expect(state.applyFollow(opening), isTrue);
    expect(state.applyFollow(record(0)), isTrue);
    expect(state.cursor, 0);
  });

  test('history prepends without changing live cursor and checks overlap', () {
    final state = SessionState();
    state.applyFollow(snapshot([record(2), record(3)], hasMore: true));
    expect(
      state.prependHistory({
        'records': [record(0), record(1), record(2)],
        'hasMore': false,
      }),
      isTrue,
    );
    expect(state.cursor, 3);
    expect(state.records.length, 4);
    expect(state.hasMore, isFalse);
    expect(
      state.prependHistory({
        'records': [
          record(0, data: {'unexpected': true}),
        ],
        'hasMore': false,
      }),
      isFalse,
    );
    expect(state.needsSnapshot, isTrue);
  });

  test('history gap and inconsistent snapshot cursor are rejected', () {
    final state = SessionState();
    state.applyFollow(snapshot([record(4), record(5)], hasMore: true));
    expect(
      state.prependHistory({
        'records': [record(1), record(2)],
        'hasMore': true,
      }),
      isFalse,
    );
    expect(state.firstSeq, 4);
    expect(state.applyFollow(snapshot([record(0)], cursor: 1)), isFalse);
    expect(state.cursor, 5);
  });

  test('records are bounded and detached from caller mutations', () {
    final state = SessionState(maxRecords: 2);
    final input = snapshot([record(0), record(1), record(2)]);
    state.applyFollow(input);
    expect(state.firstSeq, 1);
    expect(state.hasMore, isTrue);
    (input['header'] as Map)['id'] = 'changed';
    expect(state.header['id'], 'session-1');
    expect(() => state.records.first['event'] = {}, throwsUnsupportedError);
    state.applyFollow({
      'kind': 'append',
      'records': [record(3)],
    });
    expect(state.records.length, 2);
    expect(state.firstSeq, 2);
  });

  test('projection watermark is per key and never changes journal cursor', () {
    final state = SessionState();
    state.applyFollow(snapshot([record(0)]));
    expect(
      state.applyProjection({'key': 'title', 'seq': 3, 'value': 'New'}),
      isTrue,
    );
    expect(
      state.applyProjection({'key': 'title', 'seq': 2, 'value': 'Stale'}),
      isFalse,
    );
    expect(
      state.applyProjection({'key': 'inbox', 'seq': 1, 'value': []}),
      isTrue,
    );
    expect(state.projections['title'], 'New');
    expect(state.cursor, 0);
  });

  for (final durableFirst in [true, false]) {
    test('assistant settles once with durableFirst=$durableFirst', () {
      final state = streaming();
      expect(state.assistant!.text, 'Hello');
      expect(
        state.messages.where((message) => message.role == 'assistant').length,
        1,
      );
      if (durableFirst) {
        state.applyFollow({
          'kind': 'append',
          'records': [settlement()],
        });
        expect(state.assistant, isNotNull);
      } else {
        expect(state.applyFollow(end()), isTrue);
        expect(state.assistant!.awaitingSettlement, isTrue);
      }
      expect(
        state.messages.where((message) => message.role == 'assistant').length,
        1,
      );
      if (durableFirst) {
        expect(state.applyFollow(end()), isTrue);
      } else {
        expect(
          state.applyFollow({
            'kind': 'append',
            'records': [settlement()],
          }),
          isTrue,
        );
      }
      expect(state.assistant, isNull);
      expect(
        state.messages
            .where((message) => message.role == 'assistant')
            .single
            .text,
        'Hello',
      );
      expect(state.messages.last.transient, isFalse);
      expect(state.applyFollow(end()), isFalse);
      expect(
        state.applyFollow({
          'kind': 'append',
          'records': [settlement()],
        }),
        isFalse,
      );
      expect(state.needsSnapshot, isFalse);
    });
  }

  test('failed attempt settles without fabricating a chat message', () {
    final state = streaming();
    state.applyFollow(end(eventType: 'assistant/attempt'));
    expect(
      state.applyFollow({
        'kind': 'append',
        'records': [settlement(type: 'assistant/attempt')],
      }),
      isTrue,
    );
    expect(state.assistant, isNull);
    expect(state.messages.length, 1);
  });

  test('abandoned attempt retires its text immediately', () {
    final state = streaming();
    expect(state.applyFollow(end(kind: 'abandoned')), isTrue);
    expect(state.assistant, isNull);
    expect(state.messages.length, 1);
    expect(state.applyFollow(start(revision: 4, id: 'attempt-2')), isTrue);
  });

  test('abandonment contradicting durable settlement requires rebaseline', () {
    final state = streaming();
    state.applyFollow({
      'kind': 'append',
      'records': [settlement()],
    });
    expect(state.applyFollow(end(kind: 'abandoned')), isFalse);
    expect(state.needsSnapshot, isTrue);
  });

  test('dense assistant indices and revision gaps trigger rebaseline', () {
    final state = streaming();
    expect(state.applyFollow(chunk(0, 2)), isFalse);
    expect(state.needsSnapshot, isFalse);
    expect(state.applyFollow(chunk(2, 3)), isFalse);
    expect(state.needsSnapshot, isTrue);
    expect(state.assistant!.text, 'Hello');
    final another = streaming();
    expect(another.applyFollow(chunk(1, 4)), isFalse);
    expect(another.needsSnapshot, isTrue);
  });

  test(
    'snapshot restores compact baseline and continues dense chunk sequence',
    () {
      final state = streaming();
      final baseline = {
        'revision': 6,
        'activeAttempt': {
          'attemptId': 'attempt-1',
          'startedAfterSeq': 0,
          'turn': 1,
          'step': 0,
          'nextIndex': 4,
          'stream': [
            {
              'type': 'text-chunks',
              'time0': 10,
              'index': 0,
              'dt': [1],
              'texts': ['He', 'llo'],
            },
            {
              'type': 'reasoning-chunks',
              'time0': 12,
              'index': 1,
              'dt': [],
              'texts': ['think'],
            },
            {
              'type': 'tool-call-chunks',
              'time0': 13,
              'index': 2,
              'id': 'call-1',
              'name': 'read_file',
              'dt': [],
              'args': ['{"path":'],
            },
          ],
        },
      };
      expect(
        state.applyFollow(snapshot([record(0)], baseline: baseline)),
        isTrue,
      );
      expect(state.assistant!.text, 'Hello');
      expect(state.assistant!.reasoning, 'think');
      expect(state.assistant!.tools.single['name'], 'read_file');
      expect(
        state.applyFollow(
          chunk(
            4,
            7,
            value: {
              'type': 'tool-call-delta',
              'index': 2,
              'id': 'call-1',
              'argumentsDelta': '"a"}',
            },
          ),
        ),
        isTrue,
      );
      expect(state.assistant!.tools.single['arguments'], '{"path":"a"}');
      expect(
        state.applyFollow(
          snapshot([record(0), settlement()], baseline: {'revision': 8}),
        ),
        isTrue,
      );
      expect(state.assistant, isNull);
      expect(state.messages.last.text, 'Hello');
    },
  );

  test(
    'baseline count mismatch and transient overflow are bounded failures',
    () {
      final state = SessionState(maxTransientChunks: 1);
      state.applyFollow(snapshot([record(0)], baseline: {'revision': 0}));
      state.applyFollow(start());
      state.applyFollow(chunk(0, 2));
      expect(state.applyFollow(chunk(1, 3)), isFalse);
      expect(state.needsSnapshot, isTrue);
      final other = SessionState();
      expect(
        other.applyFollow(
          snapshot(
            [record(0)],
            baseline: {
              'revision': 0,
              'activeAttempt': {
                'attemptId': 'attempt-1',
                'startedAfterSeq': 0,
                'turn': 1,
                'step': 0,
                'nextIndex': 1,
                'stream': [],
              },
            },
          ),
        ),
        isFalse,
      );
      expect(other.cursor, -1);
    },
  );

  test(
    'snapshot holds a durable settlement behind a still-active baseline',
    () {
      final state = SessionState();
      expect(
        state.applyFollow(
          snapshot(
            [record(0), settlement()],
            baseline: {
              'revision': 2,
              'activeAttempt': {
                'attemptId': 'attempt-1',
                'startedAfterSeq': 0,
                'turn': 1,
                'step': 0,
                'nextIndex': 1,
                'stream': [
                  {
                    'type': 'text-chunks',
                    'time0': 1,
                    'index': 0,
                    'dt': [],
                    'texts': ['Hello'],
                  },
                ],
              },
            },
          ),
        ),
        isTrue,
      );
      expect(
        state.messages.where((message) => message.role == 'assistant').length,
        1,
      );
      expect(state.messages.last.transient, isTrue);
      expect(state.applyFollow(end()), isTrue);
      expect(
        state.messages.where((message) => message.role == 'assistant').length,
        1,
      );
      expect(state.messages.last.transient, isFalse);
    },
  );

  test('end marker and durable event must agree before cursor advances', () {
    final state = streaming();
    state.applyFollow(end(eventType: 'assistant/attempt'));
    expect(
      state.applyFollow({
        'kind': 'append',
        'records': [settlement()],
      }),
      isFalse,
    );
    expect(state.cursor, 0);
    expect(state.needsSnapshot, isTrue);
    expect(state.assistant!.text, 'Hello');
  });

  test(
    'unknown ignorable scalar events do not break the presentation reader',
    () {
      final state = SessionState();
      final unknown = record(1, type: 'extension/notice');
      (unknown['event'] as Map)
        ..['data'] = 'opaque extension value'
        ..['ignorable'] = true;
      expect(state.applyFollow(snapshot([record(0), unknown])), isTrue);
      expect(state.records.length, 2);
      expect(state.messages.length, 1);
    },
  );

  test('block-end replaces deltas and tool content remains available', () {
    final state = streaming();
    state.applyFollow(
      chunk(
        1,
        3,
        value: {
          'type': 'block-end',
          'index': 0,
          'block': {'type': 'text', 'text': 'Hello final'},
        },
      ),
    );
    expect(state.assistant!.text, 'Hello final');
    state.applyFollow(chunk(2, 4, text: 'ignored'));
    expect(state.assistant!.text, 'Hello final');
    state.applyFollow(
      snapshot([
        record(
          0,
          type: 'tool/call',
          data: {'callId': 'tool-1', 'name': 'read', 'arguments': '{}'},
        ),
        record(
          1,
          type: 'tool/result',
          data: {
            'message': {
              'toolCallId': 'tool-1',
              'content': [
                {'type': 'text', 'text': 'contents'},
                {
                  'type': 'image',
                  'attachment': {'id': 'a'},
                },
              ],
            },
            'meta': {'diff': 'x'},
          },
        ),
      ]),
    );
    expect(state.messages.first.role, 'tool-call');
    expect(state.messages.last.role, 'tool');
    expect(state.messages.last.toolId, 'tool-1');
    expect(state.messages.last.content.length, 2);
    expect(state.messages.last.data['meta'], {'diff': 'x'});
  });

  test('surface replacements retire earlier visible rows', () {
    final state = SessionState();
    state.applyFollow(
      snapshot([
        record(0),
        record(1),
        record(2, surfaceOp: {'op': 'replace', 'startSeq': 0, 'endSeq': 1}),
      ]),
    );
    expect(state.records.length, 3);
    expect(state.messages.map((message) => message.seq), [2]);
  });

  test('durable byte budget trims only the oldest contiguous prefix', () {
    final size = utf8.encode(jsonEncode(record(0))).length;
    final state = SessionState(maxRetainedBytes: size * 2);
    expect(
      state.applyFollow(snapshot([record(0), record(1), record(2)])),
      isTrue,
    );
    expect(state.records.map((entry) => (entry['event'] as Map)['seq']), [
      1,
      2,
    ]);
    expect(state.retainedBytes, size * 2);
    expect(state.cursor, 2);
    expect(state.hasMore, isTrue);
    expect(
      state.applyFollow({
        'kind': 'append',
        'records': [record(3)],
      }),
      isTrue,
    );
    expect(state.records.map((entry) => (entry['event'] as Map)['seq']), [
      2,
      3,
    ]);
    expect(state.retainedBytes, lessThanOrEqualTo(state.maxRetainedBytes));
  });

  test(
    'one oversized durable event is an explicit atomic retention failure',
    () {
      final state = SessionState(maxRetainedBytes: 1024);
      state.applyFollow(snapshot([record(0)]));
      final huge = record(
        1,
        data: {
          'message': {
            'content': [
              {'type': 'text', 'text': List.filled(2000, '中').join()},
            ],
          },
        },
      );
      expect(
        state.applyFollow({
          'kind': 'append',
          'records': [huge],
        }),
        isFalse,
      );
      expect(state.cursor, 0);
      expect(state.records.length, 1);
      expect(state.retentionExceeded, isTrue);
      expect(state.failure, contains('Single durable record'));
      expect(state.applyFollow(snapshot([record(0)])), isTrue);
      expect(state.retentionExceeded, isFalse);
      expect(state.failure, isNull);
    },
  );

  test(
    'live transient bytes reject growth without corrupting the accepted prefix',
    () {
      final timed = {
        'time': 1000,
        'chunk': {'type': 'text-delta', 'index': 0, 'text': 'Hello'},
      };
      final state = SessionState(
        maxTransientBytes: utf8.encode(jsonEncode(timed)).length,
      );
      state.applyFollow(snapshot([record(0)], baseline: {'revision': 0}));
      state.applyFollow(start());
      expect(state.applyFollow(chunk(0, 2)), isTrue);
      expect(state.transientBytes, state.maxTransientBytes);
      expect(state.applyFollow(chunk(1, 3)), isFalse);
      expect(state.retentionExceeded, isTrue);
      expect(state.assistant!.text, 'Hello');
      expect(state.transientBytes, lessThanOrEqualTo(state.maxTransientBytes));
    },
  );

  test(
    'compact baseline expansion is bounded by bytes as well as chunk count',
    () {
      final state = SessionState(maxTransientBytes: 128);
      final huge = snapshot(
        [record(0)],
        baseline: {
          'revision': 1,
          'activeAttempt': {
            'attemptId': 'attempt-1',
            'startedAfterSeq': 0,
            'turn': 1,
            'step': 0,
            'nextIndex': 1,
            'stream': [
              {
                'type': 'text-chunks',
                'time0': 1,
                'index': 0,
                'dt': [],
                'texts': [List.filled(1000, 'x').join()],
              },
            ],
          },
        },
      );
      expect(state.applyFollow(huge), isFalse);
      expect(state.retentionExceeded, isTrue);
      expect(state.cursor, -1);
      expect(state.transientBytes, 0);
    },
  );
}
