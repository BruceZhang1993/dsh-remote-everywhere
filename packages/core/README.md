# @dsh-remote/core

Pinned Noise XX connections over TCP or binary WebSocket, bounded RPC and stream queues, application heartbeat, reconnect and event-history repair. Core code has no DSH dependency.

`createRemoteServer` owns its listener and accepted connections. `SecureConnection.close()` clears its timers, aborts requests and erases owned key copies; the caller owns long-term keys. `ReconnectingClient` owns one connection attempt and one retry timer. Stop it explicitly when done. Identity/capability failures stop retries; 530 stops with `address-expired`. Updating the endpoint retains the peer pin.

`EventJournal` and `serveJournal` are diagnostic helpers with bounded in-memory retention. `JournalFollower` retains a durable-event cursor over network reconnects, repairs pages before rendering new events, and rejects missing retained history or unknown required event types. M2 supplies DSH persistent history and assistant presentation semantics.

`dart/` is a pure Dart Noise/frame reference with exact crypto versions and generated DTOs, independent of Flutter. Its live application-wire smoke speaks to production Node `SecureConnection`. It is not yet the mobile client lifecycle.
