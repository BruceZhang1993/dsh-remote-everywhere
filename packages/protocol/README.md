# @dsh-remote/protocol

DR v1 constants, bounded binary headers and JSON envelope validation. `schema.json` defines the implemented wire structures. `pnpm generate` derives `types.d.ts` and the pure Dart DTOs; `pnpm check` rejects stale generated files.

Frozen Noise and authenticated DR frame vectors live in `vectors/`. The test keys in those files are public deterministic fixtures. Protocol state and the M1/M2 implementation boundary are described in [`docs/protocol.md`](../../docs/protocol.md).
