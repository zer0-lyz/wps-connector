#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${WPS_CONNECTOR_REPO_URL:-https://github.com/zer0-lyz/wps-connector.git}"
INSTALL_ROOT="${WPS_CONNECTOR_SOURCE_ROOT:-$HOME/.local/share/wps-connector/source}"
RUNTIME_ROOT="${WPS_CONNECTOR_RUNTIME_ROOT:-$HOME/.local/share/wps-connector/runtime}"
PLUGIN_TARGET="${WPS_CONNECTOR_PLUGIN_INSTALL_DIR:-$HOME/.codex/plugins/cache/personal/wps-connector/0.1.0}"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "WPS Connector one-command installer currently supports macOS only." >&2
  exit 2
fi

if ! command -v git >/dev/null 2>&1; then
  echo "git is required. Install Xcode Command Line Tools first: xcode-select --install" >&2
  exit 2
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 20+ is required. Install it first, then rerun this script." >&2
  exit 2
fi

NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
if [[ "$NODE_MAJOR" -lt 20 ]]; then
  echo "Node.js 20+ is required. Current version: $(node -v)" >&2
  exit 2
fi

mkdir -p "$(dirname "$INSTALL_ROOT")"

if [[ -d "$INSTALL_ROOT/.git" ]]; then
  git -C "$INSTALL_ROOT" fetch --prune origin
  git -C "$INSTALL_ROOT" checkout main
  git -C "$INSTALL_ROOT" pull --ff-only origin main
else
  rm -rf "$INSTALL_ROOT"
  git clone "$REPO_URL" "$INSTALL_ROOT"
fi

cd "$INSTALL_ROOT"

npm run check
bash scripts/bootstrap-mac.sh

echo
echo "WPS Connector installed."
echo "Source: $INSTALL_ROOT"
echo "Runtime: $RUNTIME_ROOT"
echo "Plugin: $PLUGIN_TARGET"
echo
echo "Health checks:"
curl -fsS http://127.0.0.1:40215/api/health >/dev/null && echo "  bridge ok: http://127.0.0.1:40215"
curl -fsS http://127.0.0.1:3891/health >/dev/null && echo "  add-in ok: http://127.0.0.1:3891"
echo
echo "Next: open WPS Writer or Spreadsheet, then open the WPS Connector pane."
