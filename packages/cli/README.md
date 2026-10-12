# @dsh-remote/cli

Diagnostic CLI for M1. Run `pnpm remote` for usage or see [`docs/development.md`](../../docs/development.md). `keygen` creates an exclusive 0600 identity file and prints only the public key. `serve` exposes an encrypted echo plus a bounded diagnostic journal. `doctor` verifies the peer pin and an encrypted RPC; `connect --follow` prints ordered events and reconnect state.

CLI public-key pins must be exchanged over a trusted local path. Scan/SAS onboarding, device management, DSH session methods and approval UI are M2. The optional `serve --tunnel` forwards only the diagnostic listener, not a DSH GUI.
