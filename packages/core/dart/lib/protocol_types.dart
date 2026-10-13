// Generated from packages/protocol/schema.json; run pnpm generate.
class UploadBeginParams {
  const UploadBeginParams(this.values);
  final Map<String, Object?> values;
  String get sessionId => values['sessionId'] as String;
  int get bytes => values['bytes'] as int;
  String? get name => values['name'] as String?;
  Map<String, Object?> toJson() => Map.of(values);
}

class UploadChunkParams {
  const UploadChunkParams(this.values);
  final Map<String, Object?> values;
  String get uploadId => values['uploadId'] as String;
  int get offset => values['offset'] as int;
  String get data => values['data'] as String;
  Map<String, Object?> toJson() => Map.of(values);
}

class UploadFinishParams {
  const UploadFinishParams(this.values);
  final Map<String, Object?> values;
  String get uploadId => values['uploadId'] as String;
  Map<String, Object?> toJson() => Map.of(values);
}

class PairingPayload {
  const PairingPayload(this.values);
  final Map<String, Object?> values;
  String get v => values['v'] as String;
  String get sid => values['sid'] as String;
  int get exp => values['exp'] as int;
  String get relay => values['relay'] as String;
  String get pk => values['pk'] as String;
  String get name => values['name'] as String;
  List<Object?> get caps => (values['caps'] as List).cast<Object?>();
  Map<String, Object?> toJson() => Map.of(values);
}

class EmptyParams {
  const EmptyParams(this.values);
  final Map<String, Object?> values;
  Map<String, Object?> toJson() => Map.of(values);
}

class SessionIdentityParams {
  const SessionIdentityParams(this.values);
  final Map<String, Object?> values;
  String get sessionId => values['sessionId'] as String;
  Map<String, Object?> toJson() => Map.of(values);
}

class SessionSearchParams {
  const SessionSearchParams(this.values);
  final Map<String, Object?> values;
  String get query => values['query'] as String;
  Map<String, Object?> toJson() => Map.of(values);
}

class SessionCreateParams {
  const SessionCreateParams(this.values);
  final Map<String, Object?> values;
  String? get sessionId => values['sessionId'] as String?;
  String? get workspaceId => values['workspaceId'] as String?;
  String? get cwd => values['cwd'] as String?;
  String? get agentPreset => values['agentPreset'] as String?;
  Map<String, Object?> toJson() => Map.of(values);
}

class SessionForkParams {
  const SessionForkParams(this.values);
  final Map<String, Object?> values;
  String get sessionId => values['sessionId'] as String;
  int? get atSeq => values['atSeq'] as int?;
  Map<String, Object?> toJson() => Map.of(values);
}

class SessionRenameParams {
  const SessionRenameParams(this.values);
  final Map<String, Object?> values;
  String get sessionId => values['sessionId'] as String;
  String get title => values['title'] as String;
  Map<String, Object?> toJson() => Map.of(values);
}

class SessionPromptParams {
  const SessionPromptParams(this.values);
  final Map<String, Object?> values;
  String get sessionId => values['sessionId'] as String;
  String get requestId => values['requestId'] as String;
  Object? get mode => values['mode'];
  List<Map<String, Object?>> get content => (values['content'] as List).cast<Map<String, Object?>>();
  String? get clientTimeZone => values['clientTimeZone'] as String?;
  Map<String, Object?> toJson() => Map.of(values);
}

class SessionQueueParams {
  const SessionQueueParams(this.values);
  final Map<String, Object?> values;
  String get sessionId => values['sessionId'] as String;
  String get itemId => values['itemId'] as String;
  Map<String, Object?> get action => values['action'] as Map<String, Object?>;
  Map<String, Object?> toJson() => Map.of(values);
}

class SessionAttachmentParams {
  const SessionAttachmentParams(this.values);
  final Map<String, Object?> values;
  String get sessionId => values['sessionId'] as String;
  String get attachmentId => values['attachmentId'] as String;
  Map<String, Object?> toJson() => Map.of(values);
}

class SessionStreamParams {
  const SessionStreamParams(this.values);
  final Map<String, Object?> values;
  int get streamId => values['streamId'] as int;
  Map<String, Object?> get address => values['address'] as Map<String, Object?>;
  int? get sinceSeq => values['sinceSeq'] as int?;
  bool? get assistantStream => values['assistantStream'] as bool?;
  int? get maxMessages => values['maxMessages'] as int?;
  Map<String, Object?> toJson() => Map.of(values);
}

class HistoryPageParams {
  const HistoryPageParams(this.values);
  final Map<String, Object?> values;
  int get streamId => values['streamId'] as int;
  Map<String, Object?> get address => values['address'] as Map<String, Object?>;
  int get throughSeq => values['throughSeq'] as int;
  int? get beforeSeq => values['beforeSeq'] as int?;
  int? get maxMessages => values['maxMessages'] as int?;
  Map<String, Object?> toJson() => Map.of(values);
}

class StreamIdentityParams {
  const StreamIdentityParams(this.values);
  final Map<String, Object?> values;
  int get streamId => values['streamId'] as int;
  Map<String, Object?> toJson() => Map.of(values);
}

class ApprovalPendingParams {
  const ApprovalPendingParams(this.values);
  final Map<String, Object?> values;
  String? get sessionId => values['sessionId'] as String?;
  Map<String, Object?> toJson() => Map.of(values);
}

class ApprovalDecisionParams {
  const ApprovalDecisionParams(this.values);
  final Map<String, Object?> values;
  String get approvalId => values['approvalId'] as String;
  Object? get outcome => values['outcome'];
  Map<String, Object?> toJson() => Map.of(values);
}

class QuestionAnswerParams {
  const QuestionAnswerParams(this.values);
  final Map<String, Object?> values;
  String get questionId => values['questionId'] as String;
  Map<String, Object?> get answer => values['answer'] as Map<String, Object?>;
  Map<String, Object?> toJson() => Map.of(values);
}

class DeviceIdentityParams {
  const DeviceIdentityParams(this.values);
  final Map<String, Object?> values;
  String get deviceId => values['deviceId'] as String;
  Map<String, Object?> toJson() => Map.of(values);
}

class DeviceRenameParams {
  const DeviceRenameParams(this.values);
  final Map<String, Object?> values;
  String get deviceId => values['deviceId'] as String;
  String get name => values['name'] as String;
  Map<String, Object?> toJson() => Map.of(values);
}

class PairBeginParams {
  const PairBeginParams(this.values);
  final Map<String, Object?> values;
  List<Object?>? get caps => (values['caps'] as List?)?.cast<Object?>();
  Map<String, Object?> toJson() => Map.of(values);
}

class PairConfirmParams {
  const PairConfirmParams(this.values);
  final Map<String, Object?> values;
  String get deviceId => values['deviceId'] as String;
  String get sas => values['sas'] as String;
  Map<String, Object?> toJson() => Map.of(values);
}

class FileListParams {
  const FileListParams(this.values);
  final Map<String, Object?> values;
  String get sessionId => values['sessionId'] as String;
  String get path => values['path'] as String;
  int? get offset => values['offset'] as int?;
  Map<String, Object?> toJson() => Map.of(values);
}

class FileReadParams {
  const FileReadParams(this.values);
  final Map<String, Object?> values;
  String get sessionId => values['sessionId'] as String;
  String get path => values['path'] as String;
  int? get offset => values['offset'] as int?;
  int? get maxBytes => values['maxBytes'] as int?;
  int? get streamId => values['streamId'] as int?;
  Map<String, Object?> toJson() => Map.of(values);
}

class FileWriteParams {
  const FileWriteParams(this.values);
  final Map<String, Object?> values;
  String get sessionId => values['sessionId'] as String;
  String get path => values['path'] as String;
  String get content => values['content'] as String;
  String get approvalId => values['approvalId'] as String;
  Map<String, Object?> toJson() => Map.of(values);
}

class TerminalExecParams {
  const TerminalExecParams(this.values);
  final Map<String, Object?> values;
  String get sessionId => values['sessionId'] as String;
  String get command => values['command'] as String;
  String? get cwd => values['cwd'] as String?;
  String get approvalId => values['approvalId'] as String;
  int? get streamId => values['streamId'] as int?;
  Map<String, Object?> toJson() => Map.of(values);
}

class OperationPrepareParams {
  const OperationPrepareParams(this.values);
  final Map<String, Object?> values;
  Object? get method => values['method'];
  String get sessionId => values['sessionId'] as String;
  String? get path => values['path'] as String?;
  String? get content => values['content'] as String?;
  String? get command => values['command'] as String?;
  String? get cwd => values['cwd'] as String?;
  Map<String, Object?> toJson() => Map.of(values);
}

class ApplicationEvent {
  const ApplicationEvent(this.values);
  final Map<String, Object?> values;
  String get type => values['type'] as String;
  Object? get name => values['name'];
  Object? get data => values['data'];
  Map<String, Object?> toJson() => Map.of(values);
}

class AuthenticationRejected {
  const AuthenticationRejected(this.values);
  final Map<String, Object?> values;
  String get type => values['type'] as String;
  String get code => values['code'] as String;
  Map<String, Object?> toJson() => Map.of(values);
}

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

class SubagentIdentityParams {
  const SubagentIdentityParams(this.values);
  final Map<String, Object?> values;
  String get parentSessionId => values['parentSessionId'] as String;
  String get childSessionId => values['childSessionId'] as String;
  String get mode => values['mode'] as String;
  Map<String, Object?> toJson() => Map.of(values);
}

class SubagentPromptParams {
  const SubagentPromptParams(this.values);
  final Map<String, Object?> values;
  String get requestId => values['requestId'] as String;
  List<Map<String, Object?>> get content => (values['content'] as List).cast<Map<String, Object?>>();
  String? get clientTimeZone => values['clientTimeZone'] as String?;
  String get parentSessionId => values['parentSessionId'] as String;
  String get childSessionId => values['childSessionId'] as String;
  String get mode => values['mode'] as String;
  Object? get delivery => values['delivery'];
  Map<String, Object?> toJson() => Map.of(values);
}

class ChangesSummaryParams {
  const ChangesSummaryParams(this.values);
  final Map<String, Object?> values;
  String get sessionId => values['sessionId'] as String;
  int get seq => values['seq'] as int;
  Map<String, Object?> toJson() => Map.of(values);
}

class ChangesDiffParams {
  const ChangesDiffParams(this.values);
  final Map<String, Object?> values;
  String get sessionId => values['sessionId'] as String;
  int get seq => values['seq'] as int;
  int get index => values['index'] as int;
  int get streamId => values['streamId'] as int;
  Map<String, Object?> toJson() => Map.of(values);
}
