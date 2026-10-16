#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
workflow_linter="${ACTIONLINT:-$PWD/.cache/tools/actionlint}"
if [[ ! -x "$workflow_linter" ]]; then
  mkdir -p .cache/tools
  curl --fail --location --retry 2 https://github.com/rhysd/actionlint/releases/download/v1.7.12/actionlint_1.7.12_linux_amd64.tar.gz -o .cache/tools/actionlint.tar.gz
  printf '%s  %s\n' 8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8 .cache/tools/actionlint.tar.gz | sha256sum --check
  tar -xzf .cache/tools/actionlint.tar.gz -C .cache/tools actionlint
fi
"$workflow_linter" -shellcheck= .github/workflows/*.yml
for workflow_script in tools/*.sh; do bash -n "$workflow_script"; done
