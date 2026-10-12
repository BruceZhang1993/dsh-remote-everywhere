# DSH Remote Everywhere

English | [中文](README.zh-CN.md)

A DeepSeek Harness (DSH) plugin that gives **any DSH instance both sides of a remote-access
connection**: it can connect out to other DSH instances that have the plugin enabled, and it can
accept connections from them. The same protocol is spoken by native Flutter apps on Android and
iOS, so a phone can pair with any enabled controlled machine. The controlled side supports a free,
one-click public tunnel.

> **Status: pre-alpha, M1 foundation complete (local validation).** Protocol/core/tunnel packages and a diagnostic CLI
> are implemented. There is no installable DSH plugin yet (M2). See
> [docs/roadmap.md](docs/roadmap.md) for what is actually done versus planned.

## What problem this solves

DSH is excellent locally and in its own web GUI, but there is no supported way to:

- drive a DSH session running on machine A from a DSH instance on machine B;
- watch and approve an agent's work from a phone;
- reach a machine behind NAT/CGNAT without setting up a VPN or a server.

This project fills that gap with one plugin and one protocol, without an account system and without
routing plaintext through a third party.

## Documentation

M1 diagnostics: `pnpm install --frozen-lockfile`, then `pnpm remote` for CLI usage. See
[development instructions](docs/development.md#301-两进程诊断-cli) for public-key binding, two-process
echo/event recovery and optional Quick Tunnel. The CLI currently operates on diagnostic events, not DSH sessions.

| Document | What it covers |
|---|---|
| [docs/roadmap.md](docs/roadmap.md) | Objective, milestones, acceptance criteria, risks, current status |
| [docs/m1-summary.md](docs/m1-summary.md) | **M1 delivery and validation** — packages, CLI, evidence and the remaining integration boundary |
| [docs/m0-summary.md](docs/m0-summary.md) | **M0 validation results** — what was proven, what was disproven, and the architecture changes it forced |
| [docs/architecture.md](docs/architecture.md) | Component layout, integration seams, session-capability mapping, repository structure |
| [docs/protocol.md](docs/protocol.md) | The wire protocol: pairing, Noise handshake, framing, methods, resync semantics |
| [docs/security.md](docs/security.md) | Threat model, trust boundaries, pairing, device authorisation, revocation, approval model |
| [docs/technology-decisions.md](docs/technology-decisions.md) | Every significant technology choice, with the evidence and the alternatives rejected |
| [docs/development.md](docs/development.md) | Environment facts, build commands, spike reproduction, CI notes |
| [spikes/](spikes/) | M0 validation spikes and their measured reports |

Also see [CHANGELOG.md](CHANGELOG.md), which records **superseded assumptions** — the project's
early environment research was partly wrong and the corrections matter for anyone picking this up.

## The three roles

```
   controlled DSH instance                 controller DSH instance
   (host half of this plugin)   <───────►  (controller half: MCP tools + skill)
              ▲                                       ▲
              │        one protocol, one port        │
              └──────────────┬────────────────────────┘
                             ▼
                    Flutter app (Android / iOS)
```

- **Controlled** — an ordinary DSH instance with this plugin enabled. Exposes its *real* sessions:
  chat, streaming agent output, tool calls, approvals, files. Nothing runs in a sidecar: the plugin
  is an in-process Cordis plugin.
- **Controller** — another DSH instance. Its agent gets native MCP tools (`remote_*`) plus a bundled
  skill, so "connect to my desktop and check the build" is a normal tool call.
- **Mobile** — a Flutter app that speaks the same protocol. Pairing is a QR code plus a
  human-compared 6-digit short authentication string. **The mobile app is controller-only**: a
  phone can drive a DSH instance, but a phone can never be *controlled*. See
  [docs/security.md](docs/security.md) §5.4 for why.

## Safety posture

- End-to-end encryption with the Noise Protocol Framework; a tunnel or relay only ever sees
  ciphertext.
- Per-device X25519 key pairs; the controlled side keeps an explicit device list and can revoke any
  device.
- Approvals work in both directions and never silently auto-allow. The controlled host's existing
  fail-closed behaviour is preserved.
- No account system, no telemetry, no cloud dependency beyond the optional tunnel.

## License

MIT. See [LICENSE](LICENSE) (added at M4).
