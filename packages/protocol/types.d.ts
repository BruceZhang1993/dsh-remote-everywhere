// Generated from schema.json; run pnpm generate.
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
export declare function encodeHeader(value: {kind: number; streamId?: number; seq: number}): Uint8Array
export declare function decodeHeader(bytes: Uint8Array): {kind: number; streamId: number; seq: number}
export declare function encodePayload(kind: number, value: unknown): Uint8Array
export declare function decodePayload(kind: number, bytes: Uint8Array): unknown
