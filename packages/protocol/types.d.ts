// Generated from schema.json; run pnpm generate.
export type UploadBeginParams = { sessionId: string; bytes: number; name?: string }
export type UploadChunkParams = { uploadId: string; offset: number; data: string }
export type UploadFinishParams = { uploadId: string }
export type PairingPayload = { v: 1; sid: string; exp: number; relay: string; pk: string; name: string; caps: Array<"session" | "stream" | "approval" | "files" | "terminal" | "admin"> }
export type EmptyParams = {  }
export type SessionIdentityParams = { sessionId: string }
export type SessionSearchParams = { query: string }
export type SessionCreateParams = { sessionId?: string; workspaceId?: string; cwd?: string; agentPreset?: string }
export type SessionForkParams = { sessionId: string; atSeq?: number }
export type SessionRenameParams = { sessionId: string; title: string }
export type SessionPromptParams = { sessionId: string; requestId: string; mode: "queue" | "steer"; content: Array<{ type: "text" | "image" | "file"; text?: string; data?: string; mediaType?: "image/png" | "image/jpeg" | "image/webp" | "image/gif"; name?: string; receiptId?: string }>; clientTimeZone?: string }
export type SessionQueueParams = { sessionId: string; itemId: string; action: { kind: "steer" | "edit" | "remove"; content?: Array<{ type: "text"; text: string }> } }
export type SessionAttachmentParams = { sessionId: string; attachmentId: string }
export type SessionStreamParams = { streamId: number; address: { kind: "session" | "subagent"; sessionId?: string; parentSessionId?: string; childSessionId?: string; mode?: "one-shot" | "continuable" | "unknown" }; sinceSeq?: number; assistantStream?: true; maxMessages?: number }
export type HistoryPageParams = { streamId: number; address: { kind: "session" | "subagent"; sessionId?: string; parentSessionId?: string; childSessionId?: string; mode?: "one-shot" | "continuable" | "unknown" }; throughSeq: number; beforeSeq?: number; maxMessages?: number }
export type StreamIdentityParams = { streamId: number }
export type ApprovalPendingParams = { sessionId?: string }
export type ApprovalDecisionParams = { approvalId: string; outcome: "allowed-once" | "rejected" | "cancelled" | "unavailable" }
export type QuestionAnswerParams = { questionId: string; answer: Record<string, unknown> }
export type DeviceIdentityParams = { deviceId: string }
export type DeviceRenameParams = { deviceId: string; name: string }
export type PairBeginParams = { caps?: Array<"session" | "stream" | "approval" | "files" | "terminal" | "admin"> }
export type PairConfirmParams = { deviceId: string; sas: string }
export type FileListParams = { sessionId: string; path: string; offset?: number }
export type FileReadParams = { sessionId: string; path: string; offset?: number; maxBytes?: number; streamId?: number }
export type FileWriteParams = { sessionId: string; path: string; content: string; approvalId: string }
export type TerminalExecParams = { sessionId: string; command: string; cwd?: string; approvalId: string; streamId?: number }
export type OperationPrepareParams = { method: "files.write" | "terminal.exec"; sessionId: string; path?: string; content?: string; command?: string; cwd?: string }
export type ApplicationEvent = { type: "application"; name: "session.frame" | "control.frame" | "approval.request" | "approval.responded" | "question.request" | "question.responded" | "files.chunk" | "terminal.output"; data: unknown }
export type AuthenticationRejected = { type: "authentication-rejected"; code: "unauthorized" }
export type Request = { id: string; m: string; p: Record<string, unknown> }
export type Response = { id: string; r: unknown }
export type ErrorResponse = { id: string; e: { code: string; message: string } }
export type Hello = { type: "hello"; vmin: number; vmax: number; caps: Array<"diagnostic" | "session" | "stream" | "files" | "terminal" | "approval" | "admin">; role: "controller" | "controlled"; kind: "dsh" | "mobile" | "cli"; deviceId: string; name: string }
export type Heartbeat = { type: "ping" | "pong"; id: string }
export type Bye = { type: "bye" }
export type SessionEvent = { type: string; seq: number; time: number; data: unknown; ignorable?: true; sourceEventSeqs?: unknown; surfaceOp?: unknown }
export type JournalSnapshot = { kind: "snapshot"; cursor: number; firstSeq: number; records: Array<SessionEvent>; hasMore: boolean }
export type JournalAppend = { kind: "append"; records: Array<SessionEvent> }
export type StreamEnd = { error?: string }
export type SubagentIdentityParams = { parentSessionId: string; childSessionId: string; mode: "continuable" }
export type SubagentPromptParams = { requestId: string; content: Array<{ type: "text" | "image" | "file"; text?: string; data?: string; mediaType?: "image/png" | "image/jpeg" | "image/webp" | "image/gif"; name?: string; receiptId?: string }>; clientTimeZone?: string; parentSessionId: string; childSessionId: string; mode: "continuable"; delivery: "queue" | "steer" }
export type ChangesSummaryParams = { sessionId: string; seq: number }
export type ChangesDiffParams = { sessionId: string; seq: number; index: number; streamId: number }

export declare const VERSION: number
export declare const HEADER_BYTES: number
export declare const MAX_NOISE_BYTES: number
export declare const MAX_PLAINTEXT_BYTES: number
export declare const MAX_WIRE_BYTES: number
export declare const MAX_STREAMS: number
export declare const MAX_PENDING_REQUESTS: number
export declare const MAX_QUEUE_BYTES: number
export declare const MAX_QUEUE_MESSAGES: number
export declare const MAX_PAGE_RECORDS: number
export declare const KINDS: Readonly<{ REQ: 1; RES: 2; ERR: 3; EVT: 4; SDATA: 5; SEND: 6 }>
export declare class ProtocolError extends Error { code: string; constructor(code: string, message: string) }
export declare function assertValue<T>(name: string, value: T): T
export declare function assertMethod(method: string, params: Record<string, unknown>): Record<string, unknown>
export declare function encodeHeader(value: {kind: number; streamId?: number; seq: number}): Uint8Array
export declare function decodeHeader(bytes: Uint8Array): {kind: number; streamId: number; seq: number}
export declare function encodePayload(kind: number, value: unknown): Uint8Array
export declare function decodePayload(kind: number, bytes: Uint8Array): unknown
