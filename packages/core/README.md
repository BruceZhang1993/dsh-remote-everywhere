# @dsh-remote/core

Pinned Noise XX connections over TCP or binary WebSocket, bounded RPC and stream queues, application heartbeat, reconnect and event-history repair. Core code has no DSH dependency.

`createRemoteServer` owns its listener and accepted connections. `SecureConnection.close()` clears its timers, aborts requests and erases owned key copies; the caller owns long-term keys. `ReconnectingClient` owns one connection attempt and one retry timer. Stop it explicitly when done. Identity/capability failures stop retries; 530 stops with `address-expired`. Updating the endpoint retains the peer pin.

`EventJournal` and `serveJournal` are diagnostic helpers with bounded in-memory retention. `JournalFollower` retains a durable-event cursor over network reconnects, repairs pages before rendering new events, and rejects missing retained history or unknown required event types. M2 supplies DSH persistent history and assistant presentation semantics.

`dart/` contains the pure Dart Noise/frame implementation, `RemoteConnection` mobile controller, pairing validation and bounded `SessionState` presentation fold. It stays independent of Flutter; the app owns platform storage and reconnect/lifecycle decisions. `tools/m3-mobile-smoke.mjs` validates it against an isolated real DSH host. The ingress adapter rejects excessive advertised/cumulative payloads and more than 1024 fragments before SDK assembly. It holds at most one 65551-byte DR record and a separate 125-byte control payload, and normalizes data fragments before passing them to the SDK to preserve interleaved ping/pong behaviour.
