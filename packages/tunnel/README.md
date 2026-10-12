# @dsh-remote/tunnel

`TunnelManager({binary})` starts one cloudflared Quick Tunnel for a dedicated loopback HTTP server. `start(origin)` drains both pipes, extracts the URL from bounded stderr lines, and returns it only after HTTP health plus a real WebSocket upgrade pass. Startup has one 60-second budget.

`stop()` clears the public endpoint immediately, terminates the owned process group, waits for exit and escalates after five seconds. Concurrent start/stop calls share the same owner. Unexpected exit invalidates the endpoint; it does not revoke device identity.

The binary is supplied by PATH or an explicit path. M1 does not download executable code at installation. Public network smoke is opt-in (`pnpm test:tunnel`); normal CI uses deterministic process fixtures. Linux group cleanup is tested locally; Windows task-tree cleanup requires platform validation before release.
