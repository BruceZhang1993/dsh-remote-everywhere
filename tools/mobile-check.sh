#!/usr/bin/env bash
set -euo pipefail
mobile_target="${1:-check}"
mobile_root="$(cd "$(dirname "$0")/.." && pwd)"
mobile_flutter="${DSH_FLUTTER_BIN:-flutter}"
case "$mobile_target" in
  check|android|ios) ;;
  *) printf '用法: tools/mobile-check.sh [check|android|ios]\n' >&2; exit 2 ;;
esac
if [[ "$(uname -s)" == Linux ]]; then
  if [[ "$mobile_target" == ios ]]; then
    printf 'iOS 构建必须在 macOS/Xcode 上运行。\n' >&2
    exit 2
  fi
  if [[ "${2:-}" != --inside-scope ]]; then
    exec "$mobile_root/tools/run-limited.sh" bash -lc 'exec bash "$1" "$2" --inside-scope' bash "$mobile_root/tools/mobile-check.sh" "$mobile_target"
  fi
elif [[ "$(uname -s)" == Darwin ]]; then
  if [[ "${DSH_IOS_ALLOW_UNBOUNDED:-0}" != 1 ]]; then
    printf 'macOS 不支持 systemd/cgroup 8G/4G 限制；未运行构建。确认 runner 内存条件后显式设置 DSH_IOS_ALLOW_UNBOUNDED=1 授权运行。\n' >&2
    exit 2
  fi
  printf 'macOS 构建已显式授权：本入口无法施加 Linux systemd 内存上限。\n' >&2
else
  printf '此入口只支持 Linux 与 macOS。\n' >&2
  exit 2
fi
cd "$mobile_root/apps/mobile"
mobile_version="$($mobile_flutter --version)"
if [[ "$mobile_version" != *'Flutter 3.47.7 '* || "$mobile_version" != *'Dart 3.13.5 '* ]]; then
  printf '工具链必须为 Flutter 3.47.7 / Dart 3.13.5。\n%s\n' "$mobile_version" >&2
  exit 2
fi
"$mobile_flutter" pub get --enforce-lockfile
"$mobile_flutter" analyze
"$mobile_flutter" test
if [[ "$mobile_target" == android ]]; then
  "$mobile_flutter" build apk --release
  mkdir -p "$mobile_root/.cache/mobile"
  cp build/app/outputs/flutter-apk/app-release.apk "$mobile_root/.cache/mobile/dsh-remote-release.apk"
elif [[ "$mobile_target" == ios ]]; then
  "$mobile_flutter" build ios --release --no-codesign
  mkdir -p "$mobile_root/.cache/mobile"
  ditto -c -k --keepParent build/ios/iphoneos/Runner.app "$mobile_root/.cache/mobile/dsh-remote-ios-unsigned.zip"
fi
