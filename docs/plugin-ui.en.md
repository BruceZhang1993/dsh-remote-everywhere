# Remote management UI candidate

This development candidate targets **DSH Desktop 0.2.1-alpha.2** only. Its local candidate version is **0.2.0-dev.0**; it has not been published. Published 0.1.0 packages do not include this UI. DSH 0.1.7-rc.2 is outside the UI compatibility baseline.

Install all six matching candidate archives (protocol, core, tunnel, cli, ui and everywhere) with install scripts disabled into an isolated Desktop profile. Preserve the host bundles and add `@brucezhang1993/dsh-remote-everywhere` to `dsh.profile.bundles` for scoped candidates, or `dsh-remote-everywhere` for unscoped candidates. The main plugin brings in its companion UI; do not replace its Node SDK `./client` entry.

Open **Remote devices** in the sidebar, or the main plugin's details under **Plugins**. Choose the connection direction. To accept another device, enable public access first when connecting across computers, select grants and generate a code. On the controller, paste/import the pairing JSON. Compare both six-digit codes manually and confirm on both devices. Each direction is authorized separately.

After pairing, ask the local DSH conversation: `Use remote-control to connect to device <deviceId> and list its sessions.` This release provides management UI; a complete remote chat UI is deferred. Mobile requires the separate DSH Remote Mobile application, whose signed APKs are distributed separately through GitHub Releases when available; see the [installation guide](install.en.md).

Device cards show separate inbound/outbound grants and live connection state. Rename, connect/disconnect or explicitly confirm revocation. To change grants, revoke and pair again. If an old endpoint expires, disconnect and enter the new endpoint: the original public key is still pinned, and the endpoint is saved only after a successful handshake.

Public access requires an existing `cloudflared` executable. The UI checks availability but does not install it. Alternatively configure its absolute path in the `remote-everywhere` backend config and restart. Readiness requires both public HTTP health and WebSocket upgrade checks. Tunnel changes cancel unfinished pairing codes; closing the UI does not stop the tunnel. The tunnel exposes the dedicated encrypted remote protocol, not the host management UI.

Keep the existing `remote/identity.key` and `remote/devices.json` when upgrading. Back up configuration and lockfiles first; rollback restores the previous packages/configuration without replacing identity or trust. Existing-profile upgrades across host versions, other operating systems and physical mobile devices require separate acceptance.

The Chinese installation guide (`INSTALL.zh-CN.md` in this package, `docs/plugin-ui.md` in the repository) contains local candidate and isolated Web/Desktop UI test commands. No registry publication, dist-tag promotion or current-profile installation is performed by local verification.
