#!/usr/bin/env bash
set -euo pipefail
if ! systemctl --user show-environment >/dev/null 2>&1; then
  printf '用户 systemd 管理器不可用，停止执行；未绕过资源限制。\n' >&2
  exit 2
fi
# --scope waits synchronously; this systemd rejects combining it with --wait.
exec systemd-run --user --scope --collect --same-dir -p MemoryMax=8G -p MemorySwapMax=4G -- "$@"
