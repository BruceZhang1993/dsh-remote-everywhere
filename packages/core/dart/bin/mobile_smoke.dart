// Private stdin/stdout driver for tools/m3-mobile-smoke.mjs; never print secrets.
import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:dsh_remote_core/remote_connection.dart';
import 'package:dsh_remote_core/session_state.dart';

class SmokeDriver {
  final Identity identity;
  PairedDevice? peer;
  RemoteConnection? connection;
  Completer<bool>? sasConfirmation;
  StreamSubscription<Map<String, dynamic>>? eventSubscription;
  Future<void> Function(Map<String, dynamic>)? interaction;

  SmokeDriver(this.identity);

  Future<Map<String, dynamic>> run(Map<String, dynamic> params) async {
    final client = connection!;
    final created = await client.request('session.create', {
      'cwd': params['cwd'],
    });
    final sessionId = created['sessionId'];
    final cancellation = RemoteCancellation();
    final failure = Completer<Map<String, dynamic>>();
    var approved = false;
    var answered = false;
    interaction = (event) async {
      try {
        final data = event['data'] as Map<String, dynamic>;
        if (event['name'] == 'approval.request' && params['approval'] == true) {
          approved = true;
          await client.request('approval.decide', {
            'approvalId': data['approvalId'],
            'outcome': 'allowed-once',
          });
        } else if (event['name'] == 'question.request' &&
            params['question'] == true) {
          answered = true;
          await client.request('question.answer', {
            'questionId': data['questionId'],
            'answer': {
              'answers': [
                {
                  'id': 'm2-question',
                  'selected': ['Proceed'],
                },
              ],
            },
          });
        }
      } catch (error, stack) {
        if (!failure.isCompleted) failure.completeError(error, stack);
      }
    };
    try {
      final source = await client.open('stream.open', {
        'address': {'kind': 'session', 'sessionId': sessionId},
        'assistantStream': true,
        'maxMessages': 4,
      }, cancellation: cancellation);
      var records = 0;
      var cursor = -1;
      var userMessages = 0;
      var assistantMessages = 0;
      var liveFrames = 0;
      var allowed = false;
      var baselineVerified = false;
      final state = SessionState();
      SessionState? restoredBaseline;
      final consumed = () async {
        await for (final frame in source) {
          state.applyFollow(frame);
          if (state.needsSnapshot)
            throw StateError('real session frame rejected by SessionState');
          restoredBaseline?.applyFollow(frame);
          if (restoredBaseline?.needsSnapshot == true) {
            throw StateError('real compact baseline continuation failed');
          }
          if (frame['kind'] == 'assistant-stream') liveFrames++;
          if (params['baseline'] == true &&
              !baselineVerified &&
              state.assistant?.text == 'M3_BASELINE_') {
            final baselineCancellation = RemoteCancellation();
            try {
              final baselineSource = await client.open('stream.open', {
                'address': {'kind': 'session', 'sessionId': sessionId},
                'assistantStream': true,
                'maxMessages': 4,
              }, cancellation: baselineCancellation);
              final baseline = await baselineSource.first.timeout(
                const Duration(seconds: 5),
              );
              final compact =
                  baseline['assistantStream']?['activeAttempt']?['stream']
                      as List? ??
                  [];
              if (!compact.any((record) => record['type'] == 'text-chunks')) {
                throw StateError(
                  'real host baseline did not contain compact text chunks',
                );
              }
              final restored = SessionState()..applyFollow(baseline);
              if (restored.needsSnapshot ||
                  restored.assistant?.text != 'M3_BASELINE_') {
                throw StateError('real compact baseline restoration failed');
              }
              restoredBaseline = restored;
              baselineVerified = true;
            } finally {
              baselineCancellation.cancel();
            }
          }
          var ended = false;
          for (final record in (frame['records'] as List? ?? [])) {
            if (++records > 1024) throw StateError('event budget exceeded');
            final event = record['event'];
            cursor = event['seq'] as int;
            if (event['type'] == 'user/message' &&
                event['data']['source']?['rpcId'] == params['requestId'])
              userMessages++;
            if (event['type'] == 'assistant/message') assistantMessages++;
            if (event['type'] == 'approval/decided') {
              allowed = event['data']['outcome'] == 'allowed-once';
            }
            if (event['type'] == 'turn/end') ended = true;
          }
          if (ended) {
            final allUsers = state.messages
                .where((message) => message.role == 'user')
                .toList();
            final users = allUsers
                .where(
                  (message) =>
                      message.data['source']?['rpcId'] == params['requestId'],
                )
                .toList();
            final sourceKinds = allUsers
                .map((message) => message.data['source']?['kind'])
                .whereType<String>()
                .toSet()
                .toList();
            final assistants = state.messages
                .where((message) => message.role == 'assistant')
                .toList();
            final expectedText = params['baseline'] == true
                ? 'M3_BASELINE_OK'
                : 'M2_SMOKE_OK';
            if (users.length != 1 ||
                users.single.text != params['text'] ||
                assistants
                        .where((message) => message.text == expectedText)
                        .length !=
                    1 ||
                assistants.any((message) => message.transient)) {
              throw StateError(
                'real session presentation missing, duplicated or unsettled: ${jsonEncode({'userRows': allUsers.length, 'requestedUserRows': users.length, 'userSourceKinds': sourceKinds, 'assistantRows': assistants.length, 'userTextMatches': users.length == 1 && users.single.text == params['text'], 'assistantTextMatches': assistants.where((message) => message.text == expectedText).length, 'transient': assistants.any((message) => message.transient), 'attemptPresent': state.assistant != null, 'awaitingSettlement': state.assistant?.awaitingSettlement, 'eventTypes': state.records.map((record) => record['event']['type']).toList()})}',
              );
            }
            if (params['baseline'] == true &&
                (restoredBaseline == null ||
                    restoredBaseline!.messages
                            .where(
                              (message) =>
                                  message.role == 'assistant' &&
                                  message.text == expectedText &&
                                  !message.transient,
                            )
                            .length !=
                        1 ||
                    restoredBaseline!.assistant != null)) {
              throw StateError(
                'compact baseline did not settle into one durable message',
              );
            }
            return <String, dynamic>{
              'sessionId': sessionId,
              'cursor': cursor,
              'records': records,
              'userMessages': userMessages,
              'assistantMessages': assistantMessages,
              'userRows': allUsers.length,
              'userSourceKinds': sourceKinds,
              'liveFrames': liveFrames,
              'approved': approved,
              'allowed': allowed,
              'answered': answered,
              'stateMessagesVerified': true,
              'compactBaselineVerified': baselineVerified,
            };
          }
        }
        throw StateError('session ended before turn completion');
      }();
      await client.request('session.prompt', {
        'sessionId': sessionId,
        'requestId': params['requestId'],
        'mode': 'queue',
        'content': [
          {'type': 'text', 'text': params['text']},
        ],
      });
      return await Future.any([consumed, failure.future])
          .timeout(const Duration(seconds: 20));
    } finally {
      cancellation.cancel();
      interaction = null;
    }
  }

  Future<dynamic> command(Map<String, dynamic> input) async {
    final params = (input['params'] as Map? ?? {}).cast<String, dynamic>();
    switch (input['command']) {
      case 'pair':
        peer = await pairDevice(
          identity: identity,
          payload: PairingRequest.parse(params),
          name: 'M3 Dart mobile smoke',
          confirm: (sas) async {
            sasConfirmation = Completer<bool>();
            stdout.writeln(jsonEncode({'event': 'sas', 'sas': sas}));
            try {
              return await sasConfirmation!.future.timeout(
                const Duration(seconds: 10),
              );
            } finally {
              sasConfirmation = null;
            }
          },
        );
        return {'deviceId': identity.deviceId, 'hostDeviceId': peer!.deviceId};
      case 'sas.confirm':
        sasConfirmation!.complete(params['confirmed'] == true);
        return {'ok': true};
      case 'connect':
        connection?.close();
        if (connection != null) await connection!.closed;
        await eventSubscription?.cancel();
        eventSubscription = null;
        connection = await RemoteConnection.connect(
          params['endpoint'] as String? ?? peer!.endpoint,
          identity: identity,
          peerPublicKey: peer!.publicKey,
          caps: peer!.caps,
          name: 'M3 Dart mobile smoke',
          requestTimeout: const Duration(seconds: 15),
          // Test timing: a reverse proxy may retain its frontend after the host
          // terminates the origin socket. Exercise heartbeat detection promptly.
          heartbeatInterval: const Duration(seconds: 1),
        );
        eventSubscription = connection!.events.listen((event) {
          final handler = interaction;
          if (handler != null) unawaited(handler(event));
        });
        return {
          'ready': connection!.isReady,
          'peerRole': connection!.peerHello['role'],
        };
      case 'request':
        return connection!.request(
          params['method'] as String,
          (params['params'] as Map? ?? {}).cast<String, dynamic>(),
        );
      case 'run':
        return run(params);
      case 'first':
        final cancellation = RemoteCancellation();
        try {
          final source = await connection!.open(
            params['method'] as String,
            (params['params'] as Map? ?? {}).cast<String, dynamic>(),
            cancellation: cancellation,
          );
          return await source.first.timeout(const Duration(seconds: 15));
        } finally {
          cancellation.cancel();
        }
      case 'loss':
        final iterators = <StreamIterator<Map<String, dynamic>>>[];
        try {
          final openings = <Map<String, dynamic>>[];
          for (var index = 0; index < 2; index++) {
            final source = await connection!.open('stream.open', params);
            final iterator = StreamIterator(source);
            iterators.add(iterator);
            if (!await iterator.moveNext().timeout(
              const Duration(seconds: 15),
            )) {
              throw StateError('missing subscription baseline');
            }
            openings.add(iterator.current);
          }
          final pending = iterators.map((iterator) async {
            try {
              if (await iterator.moveNext())
                throw StateError('unexpected event during disconnect');
              return 'ended';
            } on RemoteException catch (error) {
              return error.code;
            }
          }).toList();
          connection!.close(
            const RemoteException(
              'transport/lost',
              'M3 simulated network loss',
            ),
          );
          final lost = await Future.wait(pending)
              .timeout(const Duration(seconds: 10));
          await connection!.closed;
          await eventSubscription?.cancel();
          eventSubscription = null;
          return {'openings': openings, 'lost': lost};
        } finally {
          for (final iterator in iterators) {
            await iterator.cancel();
          }
        }
      case 'upload':
        final bytes = utf8.encode('M3 attachment '.padRight(60000, 'x'));
        final begin = await connection!.request('session.upload.begin', {
          'sessionId': params['sessionId'],
          'bytes': bytes.length,
          'name': 'm3-attachment.txt',
        });
        for (var offset = 0; offset < bytes.length; offset += 32768) {
          final end = offset + 32768 < bytes.length
              ? offset + 32768
              : bytes.length;
          await connection!.request('session.upload.chunk', {
            'uploadId': begin['uploadId'],
            'offset': offset,
            'data': base64.encode(bytes.sublist(offset, end)),
          });
        }
        return connection!.request('session.upload.finish', {
          'uploadId': begin['uploadId'],
        });
      case 'read':
        final source = await connection!.open('files.read', params);
        var bytes = 0;
        var chunks = 0;
        await for (final frame in source.timeout(const Duration(seconds: 15))) {
          if (frame['data'] != null) {
            final data = base64.decode(frame['data'] as String);
            if (data.any((byte) => byte != 120))
              throw StateError('file payload mismatch');
            bytes += data.length;
            chunks++;
          }
        }
        return {'bytes': bytes, 'chunks': chunks};
      case 'closed':
        final error = await connection!.closed.timeout(
          const Duration(seconds: 10),
        );
        await eventSubscription?.cancel();
        eventSubscription = null;
        return {'code': error.code};
      case 'close':
        connection?.close();
        if (connection != null) await connection!.closed;
        await eventSubscription?.cancel();
        eventSubscription = null;
        interaction = null;
        return {'ok': true};
      default:
        throw StateError('unknown smoke command');
    }
  }
}

Future<void> main() async {
  final driver = SmokeDriver(Identity.generate());
  final tasks = <Future<void>>{};
  stdout.writeln(jsonEncode({'event': 'ready'}));
  try {
    await for (final line
        in stdin.transform(utf8.decoder).transform(const LineSplitter())) {
      if (line.length > 131072 || tasks.length >= 8)
        throw StateError('driver input budget exceeded');
      final input = (jsonDecode(line) as Map).cast<String, dynamic>();
      late Future<void> task;
      task = () async {
        try {
          final result = await driver.command(input);
          stdout.writeln(jsonEncode({'id': input['id'], 'result': result}));
        } catch (error) {
          stdout.writeln(
            jsonEncode({
              'id': input['id'],
              'error': {
                'code': error is RemoteException ? error.code : 'smoke/failed',
                if (error is StateError) 'detail': error.message,
                if (error is TimeoutException)
                  'detail': 'fixture wait timed out',
              },
            }),
          );
        }
      }().whenComplete(() => tasks.remove(task));
      tasks.add(task);
    }
    await Future.wait(tasks.toList());
  } finally {
    driver.connection?.close();
    await driver.eventSubscription?.cancel();
    driver.identity.destroy();
  }
}
