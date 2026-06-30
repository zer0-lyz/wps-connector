#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PLUGIN_NAME="wps-connector"
PLUGIN_SOURCE="$ROOT_DIR/plugins/$PLUGIN_NAME"
PLUGIN_TARGET="${WPS_CONNECTOR_PLUGIN_INSTALL_DIR:-$HOME/plugins/$PLUGIN_NAME}"
MARKETPLACE_PATH="${WPS_CONNECTOR_MARKETPLACE_PATH:-$HOME/.agents/plugins/marketplace.json}"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This bootstrap script currently supports macOS only." >&2
  exit 2
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 20+ is required before installing WPS Connector." >&2
  exit 2
fi

NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
if [[ "$NODE_MAJOR" -lt 20 ]]; then
  echo "Node.js 20+ is required. Current version: $(node -v)" >&2
  exit 2
fi

if [[ ! -d "$PLUGIN_SOURCE" ]]; then
  echo "Plugin source not found: $PLUGIN_SOURCE" >&2
  exit 2
fi

mkdir -p "$(dirname "$PLUGIN_TARGET")" "$(dirname "$MARKETPLACE_PATH")"

rsync -a --delete \
  --exclude ".DS_Store" \
  "$PLUGIN_SOURCE/" "$PLUGIN_TARGET/"

MARKETPLACE_PATH="$MARKETPLACE_PATH" PLUGIN_TARGET="$PLUGIN_TARGET" PLUGIN_NAME="$PLUGIN_NAME" node <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const marketplacePath = process.env.MARKETPLACE_PATH;
const pluginTarget = process.env.PLUGIN_TARGET;
const pluginName = process.env.PLUGIN_NAME;
const root = path.dirname(path.dirname(marketplacePath));
const relPath = `./${path.relative(root, pluginTarget).split(path.sep).join("/")}`;
let data = { name: "personal", interface: { displayName: "Personal" }, plugins: [] };
if (fs.existsSync(marketplacePath)) {
  data = JSON.parse(fs.readFileSync(marketplacePath, "utf8"));
  if (!Array.isArray(data.plugins)) data.plugins = [];
  if (!data.name) data.name = "personal";
  if (!data.interface) data.interface = { displayName: "Personal" };
}
const entry = {
  name: pluginName,
  source: { source: "local", path: relPath },
  policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
  category: "Productivity",
};
const index = data.plugins.findIndex((item) => item && item.name === pluginName);
if (index >= 0) data.plugins[index] = entry;
else data.plugins.push(entry);
fs.mkdirSync(path.dirname(marketplacePath), { recursive: true });
fs.writeFileSync(marketplacePath, `${JSON.stringify(data, null, 2)}\n`);
console.log(`Updated marketplace: ${marketplacePath}`);
console.log(`Plugin source path: ${relPath}`);
NODE

if command -v codex >/dev/null 2>&1; then
  codex plugin add "$PLUGIN_NAME@personal"
else
  echo "Codex CLI was not found on PATH; skipped 'codex plugin add $PLUGIN_NAME@personal'." >&2
  echo "Install the plugin manually from: $MARKETPLACE_PATH" >&2
fi

bash "$PLUGIN_TARGET/scripts/install-local-runtime.sh"

echo
echo "WPS Connector bootstrap completed."
echo "Codex plugin source: $PLUGIN_TARGET"
echo "Marketplace: $MARKETPLACE_PATH"
echo "Runtime: ${WPS_CONNECTOR_RUNTIME_ROOT:-$HOME/.local/share/wps-connector/runtime}"
echo
echo "Next step: open WPS Writer or Spreadsheet and open the WPS Connector Pane."
