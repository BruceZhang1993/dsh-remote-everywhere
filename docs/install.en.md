# Installation and upgrades

[中文](https://github.com/BruceZhang1993/dsh-remote-everywhere/blob/master/docs/install.md)

This guide covers releases with the **Remote devices** management UI, targeting **DSH Desktop 0.2.1-alpha.2**. Install the desktop plugin from public npmjs and the separate Android app from this repository's GitHub Releases. The historical GitHub Packages `0.1.0` targets an older host and does not include this UI.

Check the [Releases list](https://github.com/BruceZhang1993/dsh-remote-everywhere/releases) and the selected release notes first. If the version or assets are absent, they are not available for installation yet. Source versions and local candidates do not prove publication. Prereleases appear as **Pre-release**; `/releases/latest` may omit them.

## Desktop plugin

1. Confirm **0.2.1-alpha.2** in the desktop About screen and select the intended profile. Back up its configuration, package/lock files and `remote/` state directory.
2. Open **Plugins → Add plugin**. In **Package name or address**, enter:

   ```text
   @brucezhang1993/dsh-remote-everywhere@next
   ```

   Select the official registry, **`https://registry.npmjs.org`**. Use `next` for prereleases and `latest` only after a stable release exists. For a pinned version, replace `next` with the full release version without the tag's `v` prefix. Omitting the suffix may fail when only `next` exists.
3. Let the host finish installation and enable/reload as prompted. The main plugin brings in the matching UI and protocol dependencies; do not install six packages individually or copy files into the system application directory.
4. Open **Remote devices** in the sidebar or the **DSH Remote Everywhere** plugin details. First activation also offers the management entry. Confirm that the local identity and device page appears.

Public npmjs reads do not require a GitHub PAT. Remove or adjust any old `@brucezhang1993` scope registry mapping to `npm.pkg.github.com` in this profile before installation. Never send a GitHub token to npmjs.

If the entry is missing, verify that the selected release includes the UI, the main plugin is enabled, the host matches, and the companion UI installed successfully, then reload as prompted. Do not force incompatible peers onto an older host. A registry missing `dsh.bundle` must pass the release's registry acceptance check; a successful local tarball install cannot prove registry acceptance.

## Android APK

1. Use **Android 7.0 / API 24 or newer**. Select the desired release, including **Pre-release** builds, from the [Releases list](https://github.com/BruceZhang1993/dsh-remote-everywhere/releases).
2. Download all six assets into one directory: `dsh-remote-android-VERSION.apk`, `SHA256SUMS`, `release-manifest.json`, `LICENSE.txt`, `ANDROID-NOTICES.md`, and `ANDROID-LICENSE-REVIEW.md`.
3. On Linux run `sha256sum --check SHA256SUMS`; on macOS run `shasum -a 256 --check SHA256SUMS`. On Windows use `Get-FileHash .\dsh-remote-android-VERSION.apk -Algorithm SHA256` and compare with that APK's entry in `SHA256SUMS`. Substitute the selected version for `VERSION`. Stop on any mismatch and check the download source.
4. Open the APK and follow Android's prompt to allow the installation source (newer Android versions grant this per browser/file manager). Root is unnecessary. The universal APK includes supported ABIs; the npm plugin does not install this mobile app.
5. An existing debug-signed app normally cannot be updated with the production certificate. Keep a working host pairing entry, revoke the old phone authorization as appropriate, uninstall the test app, install the production APK, and pair again. Production upgrades preserve the signing identity and applicationId and increase versionCode.

The applicationId is `dev.dshremote.dsh_remote_mobile`. With Android SDK tools, run `apksigner verify --verbose --print-certs <APK>` and compare the certificate SHA-256 with the release's `release-manifest.json`. For first trust also compare the [registered signing certificate](https://github.com/BruceZhang1993/dsh-remote-everywhere/blob/master/docs/ci-release.md). Checksums establish file consistency; trust in the release source and certificate is separate.

No installable iOS IPA is distributed yet. The unsigned `.app` is a development check artifact.

## Pairing

1. Open **Remote devices** on the controlled computer. For another computer or phone, first enable public access and wait until ready; the default loopback endpoint is local-only. Optional public access requires `cloudflared` installed using the [official Cloudflare downloads](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/downloads/), or use a reachable WebSocket endpoint you manage.
2. Choose the incoming direction, select grants and generate a code. On another desktop choose the outgoing direction and paste/import the complete JSON; on Android scan the code or paste its JSON.
3. Compare the six-digit code manually on both devices and confirm on both. Codes expire within 180 seconds. Pair separately for each control direction.
4. Ask the controlling DSH conversation to use `remote-control` with an explicit device and list its sessions; on Android select/create a remote session in the app. The management page is not a full remote chat page. Approvals and file/terminal writes still require human decisions.

Default grants are `session,stream,approval`; explicitly select files, terminal or administration as needed. Revoke and pair again to change grants. When a Quick Tunnel endpoint changes, update the address while retaining the pinned public key; do not delete identity files to bypass key conflicts.

## Upgrades, rollback and removal

Before updating the desktop plugin, stop affected connections and back up its profile. Install an exact version; its dependencies select the matching UI/protocol packages. Preserve `<profile>/remote/identity.key` and `devices.json`, and never copy another device's identity. Recheck devices, identities, a session and an approval after upgrading. Existing-profile upgrades across host versions, other operating systems and physical devices need separate acceptance.

For rollback, stop the instance and restore compatible packages, configuration and lockfiles. Restore old trust snapshots only after reviewing authorization changes, since they may resurrect revoked grants. Revoke obsolete devices at the controlled host before uninstalling a plugin/app. Removing a phone's local record does not revoke its host authorization; back up state before deleting it.

## Diagnostic CLI only

The diagnostic CLI requires Node.js ≥22.19. After npmjs publication, install it in a separate directory. It provides neither desktop management UI nor the Android app:

```bash
npm install --ignore-scripts --registry=https://registry.npmjs.org @brucezhang1993/dsh-remote-cli@next
./node_modules/.bin/dsh-remote help
```

Use `latest` only after a stable version passes registry acceptance and promotion. The authenticated GitHub Packages procedure remains in the [historical release guide](https://github.com/BruceZhang1993/dsh-remote-everywhere/blob/master/docs/release.en.md).
