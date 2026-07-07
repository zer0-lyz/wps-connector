#!/usr/bin/env bash
set -euo pipefail
PLUGIN_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RUNTIME_SOURCE="$PLUGIN_DIR/runtime"
if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This runtime installer currently supports macOS only." >&2
  exit 2
fi
cd "$RUNTIME_SOURCE"
npm run deploy
npm run launchd:install
