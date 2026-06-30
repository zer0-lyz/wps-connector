#!/usr/bin/env bash
set -euo pipefail

SOURCE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RUNTIME_ROOT="${WPS_CONNECTOR_RUNTIME_ROOT:-$HOME/.local/share/wps-connector/runtime}"
PLUGIN_DIR="${WPS_CONNECTOR_PLUGIN_DIR:-$HOME/.codex/plugins/cache/personal/wps-connector/0.1.0}"

mkdir -p "$RUNTIME_ROOT" "$PLUGIN_DIR"

rsync -a --delete \
  --exclude '.git/' \
  --exclude 'node_modules/' \
  --exclude '.DS_Store' \
  --exclude 'test_logs/' \
  "$SOURCE_DIR/" "$RUNTIME_ROOT/"

mkdir -p "$PLUGIN_DIR/skills/wps-connector" "$PLUGIN_DIR/assets"
if [ -f "$RUNTIME_ROOT/apps/wps-addin/icon.png" ]; then
  cp "$RUNTIME_ROOT/apps/wps-addin/icon.png" "$PLUGIN_DIR/assets/icon.png"
fi

cat > "$PLUGIN_DIR/.mcp.json" <<JSON
{
  "mcpServers": {
    "wps-connector": {
      "command": "node",
      "args": [
        "$RUNTIME_ROOT/apps/mcp/server.js"
      ],
      "env": {
        "WPS_CONNECTOR_BRIDGE_URL": "http://127.0.0.1:40215"
      }
    }
  }
}
JSON

cat > "$PLUGIN_DIR/skills/wps-connector/SKILL.md" <<EOF_SKILL
---
name: wps-connector
description: Use when the user asks to connect Codex to WPS Spreadsheets or WPS Writer through the local WPS Connector MCP bridge.
---

# WPS Connector

Use the WPS Connector MCP server exposed by this plugin. Runtime files live at $RUNTIME_ROOT; the OneDrive project folder is documentation/source only. The default bridge URL is http://127.0.0.1:40215.

Before calling live WPS tools, run wps.connection_status (or wps_connection_status) with onlyOnline:true and the expected host/project/thread selector. Use recommendedSession.sessionId only when issues is empty. For project-specific work, require the WPS session binding to match the Codex project/thread to avoid cross-window routing.

Fallback CLI for non-MCP agents:

```bash
node $RUNTIME_ROOT/scripts/agent-connection-status.js --onlyOnline --host wpp
```
EOF_SKILL

printf 'Deployed WPS Connector runtime to %s\n' "$RUNTIME_ROOT"
printf 'Updated plugin MCP config at %s/.mcp.json\n' "$PLUGIN_DIR"
