#!/usr/bin/env bash
set -euo pipefail
release_root="$(cd "$(dirname "$0")/.." && pwd)"
if [[ "${1:-}" != --inside-scope ]]; then
  exec "$release_root/tools/run-limited.sh" bash "$release_root/tools/mobile-release.sh" --inside-scope
fi
release_signing="$release_root/.signing/android/key.properties"
if [[ "${CI:-}" != true && -f "$release_signing" ]]; then
  export ANDROID_SIGNING_CERT_SHA256="$(sed -n 's/^certificateSha256=//p' "$release_signing")"
else
  : "${ANDROID_KEYSTORE_PATH:?release keystore path is required}"
  : "${ANDROID_KEYSTORE_PASSWORD:?release keystore password is required}"
  : "${ANDROID_KEY_ALIAS:?release key alias is required}"
  : "${ANDROID_KEY_PASSWORD:?release key password is required}"
fi
: "${ANDROID_SIGNING_CERT_SHA256:?expected release signing certificate fingerprint is required}"
export DSH_REQUIRE_RELEASE_SIGNING=1
cd "$release_root"
release_version="$(node --input-type=module -e 'import {releaseVersion} from "./tools/release-config.mjs"; console.log(releaseVersion)')"
release_flutter="${DSH_FLUTTER_BIN:-flutter}"
release_tools="${ANDROID_BUILD_TOOLS:-${ANDROID_HOME:?ANDROID_HOME is required}/build-tools/36.0.0}"
release_toolchain="$("$release_flutter" --version)"
if [[ "$release_toolchain" != *'Flutter 3.47.7 '* || "$release_toolchain" != *'Dart 3.13.5 '* ]]; then
  printf 'Expected Flutter 3.47.7 / Dart 3.13.5.\n' >&2; exit 2
fi
release_directory="$release_root/.cache/mobile-release"
rm -rf "$release_directory"
mkdir -p "$release_directory"
node tools/release-version.mjs > "$release_directory/version.json"
cd "$release_root/apps/mobile"
"$release_flutter" pub get --enforce-lockfile
"$release_flutter" build apk --release
release_apk="$release_directory/dsh-remote-android-$release_version.apk"
cp build/app/outputs/flutter-apk/app-release.apk "$release_apk"
"$release_tools/zipalign" -c -P 16 4 "$release_apk"
"$release_tools/apksigner" verify --verbose --print-certs "$release_apk" > "$release_directory/signature.txt"
"$release_tools/aapt" dump badging "$release_apk" > "$release_directory/badging.txt"
cd "$release_root"
node tools/mobile-manifest.mjs
rm "$release_directory/version.json" "$release_directory/signature.txt" "$release_directory/badging.txt"
cp LICENSE "$release_directory/LICENSE.txt"
cp docs/android-notices.md "$release_directory/ANDROID-NOTICES.md"
cp docs/android-license-review.md "$release_directory/ANDROID-LICENSE-REVIEW.md"
cd "$release_directory"
sha256sum ./*.apk ./*.json ./*.txt ./*.md > SHA256SUMS
