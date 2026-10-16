# DSH Remote Everywhere

[![CI](https://github.com/BruceZhang1993/dsh-remote-everywhere/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/BruceZhang1993/dsh-remote-everywhere/actions/workflows/ci.yml)
[![Fuzz](https://github.com/BruceZhang1993/dsh-remote-everywhere/actions/workflows/fuzz.yml/badge.svg?branch=master)](https://github.com/BruceZhang1993/dsh-remote-everywhere/actions/workflows/fuzz.yml)
[![MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![DSH Desktop 0.2.1-alpha.2](https://img.shields.io/badge/DSH_Desktop-0.2.1--alpha.2-blue)](docs/install.en.md)

English | [中文](README.zh-CN.md)

A DeepSeek Harness (DSH) plugin that gives **any DSH instance both sides of a remote-access
connection**: it can connect out to other DSH instances that have the plugin enabled, and it can
accept connections from them. The same protocol is spoken by native Flutter apps on Android and
iOS, so a phone can pair with any enabled controlled machine. The controlled side supports a free,
one-click public tunnel.

> **Status: early implementation; M3 initial development complete, M4 review incomplete.** Real DSH instances can pair and control sessions, with native GUI approvals, files and bounded terminal operations. The Flutter controller is in [apps/mobile](apps/mobile/README.md). See [M3 evidence and deferred acceptance](docs/m3-summary.md), [M4 results](docs/m4-summary.md) and [installation / rollback](docs/install.en.md). Independent security review, physical-device acceptance, iOS build validation and real-model mobile acceptance remain pending. The historical `0.1.0` publication used GitHub Packages; npmjs and signed APK publication follow the new release pipeline.

## Installation

Use **DSH Desktop 0.2.1-alpha.2**. After a release is available, open **Plugins → Add plugin**, select the official npm registry and enter `@brucezhang1993/dsh-remote-everywhere@next` for prereleases. The sidebar entry is **Remote devices**. Install the separate Android APK from the [Releases list](https://github.com/BruceZhang1993/dsh-remote-everywhere/releases), including Pre-release builds; iOS IPA distribution is pending.

See the [installation guide](docs/install.en.md) for pinned versions, stable releases, APK checksums, first pairing and rollback. If the selected version/assets are absent, wait for publication. The historical GitHub Packages `0.1.0` targets an older host and has no management UI. CI badges show remote `master` runs, not publication or device acceptance.

## What problem this solves

DSH is excellent locally and in its own web GUI, but there is no supported way to:

- drive a DSH session running on machine A from a DSH instance on machine B;
- watch and approve an agent's work from a phone;
- reach a machine behind NAT/CGNAT without setting up a VPN or a server.

This project fills that gap with one plugin and one protocol, without an account system and without
routing plaintext through a third party.

## Documentation

For npmjs publishing, version PRs, signed Android APKs and GitHub Releases, see [CI and release configuration](docs/ci-release.md) and the [current preflight report](docs/release-preflight.md) (Chinese). Publication status and acceptance scope are recorded separately from CI badges.

The integrated management UI targets **DSH Desktop 0.2.1-alpha.2**: open **Remote devices** in the sidebar or the plugin details. See [UI features and local validation](docs/plugin-ui.en.md) and the [implementation plan](docs/plugin-ui-plan.md). See the installation guide for published versions; historical `0.1.0` does not contain this UI.

M1 diagnostics: `pnpm install --frozen-lockfile`, then `pnpm remote` for CLI usage. See
[development instructions](docs/development.md#301-两进程诊断-cli) for public-key binding, two-process
echo/event recovery and optional Quick Tunnel. The CLI currently operates on diagnostic events, not DSH sessions.

| Document | What it covers |
|---|---|
| [docs/roadmap.md](docs/roadmap.md) | Objective, milestones, acceptance criteria, risks, current status |
| [docs/m2-summary.md](docs/m2-summary.md) | **M2 plugin delivery and acceptance evidence** |
| [docs/m3-summary.md](docs/m3-summary.md) | **M3 mobile implementation, local evidence and pending acceptance** |
| [docs/m4-summary.md](docs/m4-summary.md) | **M4 receive limits, security/fuzz tests and dependency advisory review** |
| [docs/release.en.md](docs/release.en.md) | Local/CI v0.1.0 candidates, installation/rollback and GitHub Packages flow; code synchronized and protocol/security plus Android CI passed; exact sources, artifacts and remaining gates tracked in M4 results and the [readiness checklist](docs/release-readiness.md) |
| [SECURITY.md](SECURITY.md) | Disclosure policy and the pending private reporting channel |
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
- **Controller** — another DSH instance. Its agent gets native DSH tools and optional standard MCP tools (`remote_*`) plus a bundled
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

MIT. See [LICENSE](LICENSE).
