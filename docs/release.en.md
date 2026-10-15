# v0.1.0 candidate, installation and release

All five `0.1.0` packages were published on 2026-10-15 under the user's authorization, with the command tag `next`, from `v0.1.0` / `5556e67`. Registry integrity and fresh consumer installation passed; see the [release record](release-0.1.0.md). The repository is [BruceZhang1993/dsh-remote-everywhere](https://github.com/BruceZhang1993/dsh-remote-everywhere); CI uses GitHub Actions and the registry is `https://npm.pkg.github.com`.
Independent Noise/full supply-chain review, sustained fuzz, private-report receipt and deferred M3 platform acceptance remain incomplete. Publication does not assert that these checks passed. This flow covers five npm packages; signed App distribution remains separate.
Source packages retain their alpha names/versions. Standard candidates use `.cache/release-0.1.0`; GitHub candidates use `.cache/github-packages-0.1.0`. Only staging changes package names, imports, Cordis patch, versions and publication metadata.
The manifest records the source commit, dirty-workspace flag, lockfile hash and five tarball SHA-256 hashes. A dirty candidate is not a committed release tag.

## Local validation

```bash
tools/run-limited.sh pnpm check
tools/run-limited.sh pnpm test
tools/run-limited.sh pnpm test:release-candidate
tools/run-limited.sh pnpm test:release-candidate --github-packages BruceZhang1993/dsh-remote-everywhere
tools/run-limited.sh node tools/publish-packages.mjs
```

The candidate smoke command packs five candidates, installs them into a temporary consumer with install scripts disabled, and exercises the diagnostic CLI and two genuine DSH instances, including sessions, human approvals, files and bounded terminal commands.
The supported host baseline is **DSH 0.1.7-rc.2**, with Node >=22.19.0. Host service packages must match that version. Linux management sockets are validated; Windows/macOS management is pending.

## Isolated installation and rollback

Use a new test profile with the supported DSH version. The smoke entry point installs all five local tarballs together without querying/publishing to GitHub Packages. The publication helper defaults to offline source/lockfile/order/size/hash validation.
The repository owner is BruceZhang1993; candidate package scopes use lowercase:

```bash
@brucezhang1993/dsh-remote-protocol
@brucezhang1993/dsh-remote-core
@brucezhang1993/dsh-remote-tunnel
@brucezhang1993/dsh-remote-cli
@brucezhang1993/dsh-remote-everywhere
```

Wrap local install/test commands in `tools/run-limited.sh`. Preserve the active profile, lockfile and device state. Never replace identity.key or devices.json during an upgrade.
For rollback, stop the candidate instance and restore the original profile/lockfile/tarballs while retaining its identity and trust records.
DR v1 and the device-table format are unchanged. Older versions may omit the new audit events.

Pairing requires human comparison of the same six-digit SAS on both sides. Default grants are session/stream/approval; files/terminal/admin require explicit selection, and writes/terminal still require one-shot approval.
Endpoint refresh retains the pinned public key. Revocation remains available through local host management.
Upgrade the controlled plugin first, then the controller plugin/App. Older peers remain wire-compatible, but protection exists only on upgraded receivers.

## Audit and failure behaviour

Each runtime owns remote/audit.jsonl. Current and previous logs are each limited to 1 MiB, with at most 4096 bytes per record, pre-append rotation and 0600 permissions.
Records contain connection/authentication, RPC status, pairing/revocation, human interaction and operation metadata.
Parameters, response content, private keys, QR/sid/SAS, endpoint URLs and exception messages are excluded.
The log is not a tamper-proof ledger or a business database. It does not fsync every record; a host crash can lose unflushed data.

Unsafe/replaced files or write failures latch an audit failure and raise an alert. New remote operations fail closed; local revocation and resource cleanup remain available.
If an operation has executed before result auditing fails, the caller may receive a failed/unknown outcome. Do not replay a write based on that failure.
Repair the state directory or disk, then explicitly restart. There is no implicit audit recovery.
Archive oversized legacy logs and fix permissions before restarting; old evidence is not silently discarded.

## GitHub Actions and publication gates

Independent Noise review, full supply-chain review, sustained fuzz and private-report receipt verification remain incomplete. The initial publication follows the user's authorization while retaining these known limitations. See [M4 results](m4-summary.md) for earlier evidence; the final release tag must pass its own checks.
Deferred M3 device/iOS/real-model acceptance remains separate. These candidates do not claim completed dual-platform product acceptance.

- `ci.yml`: Node/Dart regression, security, interoperability, short coverage-guided runs in both runtimes, Dart fault injection/replay, independent candidate installation and Android AOT.
- `mobile.yml`: hosted Linux container Flutter checks/Android build. iOS requires explicit manual permission for a macOS build without systemd limits.
- `fuzz.yml`: daily serial Node DR/TCP and Dart DR/Noise/WS guard fuzz, each bounded to 900 seconds and one million iterations, with persisted bounded corpus and reports. See the [Dart scope and limitations](dart-fuzz.md).
- `publish.yml`: manual dispatch on `v0.1.0` only. Re-run CI and Android App checks for that tag; use the exact CI tarballs. `publish-next` publishes to `next`; `promote-latest` only promotes five already published, integrity-matching versions. Both require environment review.

The `github-packages` environment requires review by `BruceZhang1993` and allows only tag `v0.1.0`. Owner self-review is allowed for a manual run; this is maintainer approval, not independent security review. Private vulnerability reporting is enabled; receipt/notification verification is pending. Set `DSH_RELEASE_APPROVED_SHA` to the full source SHA authorized for this publication, retaining the outstanding review and validation items. A missing/mismatched value rejects publication. Approval must identify artifacts, hashes, account, registry and tag.
Only the publish job receives `packages:write`; its repository `GITHUB_TOKEN` is passed to publishing and registry installation steps. Install scripts are disabled, and the installation token is removed from the diagnostic/DSH child-process environment. The candidate must be clean and match the tag SHA, repository and lockfile.
Preflight all existing versions; only E404 means missing. Authentication/network errors stop the release, and existing versions must match the tarball SHA-512. Publish protocol, core, tunnel, CLI, then plugin, checking registry integrity after each package. Partial failure preserves published packages; identical candidates may resume, without automatic deletion or replacement. Registry visibility delays fail the run and require operator review before resuming.
After uploading, `tools/package-smoke.sh --registry` installs all five packages and pinned DSH into a fresh directory/cache with install scripts disabled, checks registry URLs and SHA-512 against the approved tarballs, then runs CLI diagnostics and a genuine two-host DSH regression with a synthetic model. Its acceptance artifact does not establish access for other accounts, real-model acceptance, upgrades or previous-version rollback.

After registry consumer acceptance, record the source SHA, five integrity hashes, consumer environment, diagnostics/real DSH regression and rollback results. Set `DSH_RELEASE_PROMOTION_APPROVED_SHA` to the same full SHA and explicitly authorize stable promotion. Dispatch `promote-latest` on the same `v0.1.0` tag. The script preflights all five published versions before changing any tag, promotes in dependency order, and reads back `latest`. Missing versions, integrity mismatches or unapproved sources fail before any tag mutation. A partial failure preserves completed tags and stops dependents; the identical reviewed source can resume after inspection. This initial publication does not set the promotion approval variable.

See the [release readiness checklist](release-readiness.md), [Android declaration evidence](android-license-review.md) and [native notice/provenance materials](android-notices.md).

## Registry installation (after publication)

GitHub's npm registry requires authentication even for public packages. All five packages were visible in GitHub's Public filter while signed out; visibility was not manually changed. Other-account registry credentials/access remain unverified. See [official GitHub npm registry documentation](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-npm-registry).
In the isolated profile `.npmrc`, use the lowercase repository scope and retain the environment reference:

```ini
@brucezhang1993:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
```

Supply a PAT classic with `read:packages` securely via the environment; install `@brucezhang1993/dsh-remote-everywhere@0.1.0` with install scripts disabled. Use the same full scoped name in `dsh.profile.bundles`. Update the profile package name and lockfile on upgrade while retaining its remote state/identity/trust records. Wire format remains DR v1.
Organizations can disable inherited package access; verify Actions access in the actual repository. Install the diagnostic `@brucezhang1993/dsh-remote-cli` separately: both CLI and plugin provide a `dsh-remote` binary, so use separate profiles.
