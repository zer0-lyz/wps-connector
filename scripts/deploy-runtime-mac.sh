#!/usr/bin/env bash
set -euo pipefail

SOURCE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RUNTIME_ROOT="${WPS_CONNECTOR_RUNTIME_ROOT:-$HOME/.local/share/wps-connector/runtime}"
PLUGIN_DIR="${WPS_CONNECTOR_PLUGIN_DIR:-$HOME/.codex/plugins/cache/personal/wps-connector/1.0.88}"

mkdir -p "$RUNTIME_ROOT" "$PLUGIN_DIR"

rsync -a --delete \
  --exclude '.git/' \
  --exclude 'node_modules/' \
  --exclude '.DS_Store' \
  --exclude 'test_logs/' \
  --exclude 'project-bindings.local.json' \
  --exclude 'codex-catalog.snapshot.json' \
  "$SOURCE_DIR/" "$RUNTIME_ROOT/"

# Fail closed if a deployment ever swaps the HTTP bridge and MCP stdio entrypoints.
# LaunchAgent starts apps/bridge/server.js directly, so a valid bridge must expose
# the HTTP server and must not be the stdin-framed MCP process.
if ! grep -q 'createServer(handle).listen' "$RUNTIME_ROOT/apps/bridge/server.js" \
  || grep -q 'Content-Length' "$RUNTIME_ROOT/apps/bridge/server.js"; then
  echo "Invalid runtime deployment: apps/bridge/server.js is not the HTTP bridge." >&2
  exit 1
fi
if ! grep -q 'Content-Length' "$RUNTIME_ROOT/apps/mcp/server.js" \
  || grep -q 'createServer(handle).listen' "$RUNTIME_ROOT/apps/mcp/server.js"; then
  echo "Invalid runtime deployment: apps/mcp/server.js is not the MCP stdio server." >&2
  exit 1
fi

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
        "WPS_CONNECTOR_BRIDGE_URL": "http://127.0.0.1:40215",
        "WPS_CONNECTOR_MCP_EXPOSE_DOTTED": "true"
      }
    }
  }
}
JSON

cat > "$PLUGIN_DIR/skills/wps-connector/SKILL.md" <<EOF_SKILL
---
name: wps-connector
description: Use for WPS Writer or Spreadsheet automation. If MCP returns unsupported call, especially through AiMaMi, DeepSeek, or MiniMax, immediately use the local agent-tool-call gateway without retrying MCP or asking the user for another prompt.
---

# WPS Connector

## Two-Path Routing

Use the path that the current model/client can actually execute:

- **MCP path**: for models with native MCP tool calling. Use one exact discovered
  handle, starting with wps.connection_status.
- **Gateway path**: for models or clients that return unsupported call, do not
  retry MCP. Immediately call the local agent-tool-call.js gateway for the
  rest of the task. The gateway reaches the same WPS bridge and preserves the
  same session and binding arguments.

Unsupported call means the model/client rejected the tool invocation before
the WPS bridge was reached. It is not evidence that WPS is offline.

## Mandatory Routing

Try one exact MCP tool handle only when tool discovery returned that handle.
Never invent a full mcp__ function name. If any WPS MCP call returns
unsupported call, stop retrying MCP immediately and use
\$HOME/.local/share/wps-connector/runtime/scripts/agent-tool-call.js for the
current and all remaining WPS calls in that task. Do this automatically without
asking the user to restart WPS, restart Codex, or provide another prompt.

The gateway accepts the same dotted or underscore tool name and the same JSON arguments. Always preserve sessionId, bindingId, projectId, and threadId when present. A gateway result is authoritative for bridge and WPS execution status.

Use the WPS Connector MCP server exposed by this plugin. Runtime files live at \$HOME/.local/share/wps-connector/runtime unless WPS_CONNECTOR_RUNTIME_ROOT overrides it. Project folders should be treated as source code or documents, not as the live runtime directory. The default bridge URL is http://127.0.0.1:40215.

Use one fast connection call before live WPS work: wps.connection_status (or
wps_connection_status) with onlyOnline:true plus the current Codex projectPath
or projectId, and host only when the requested host is already known. Do not
call wps.list_sessions first and do not scan all sessions repeatedly. When
issues is empty, reuse recommendedSession.sessionId and its binding fields for
the rest of the task.

When using the gateway, run the equivalent call first:

\`\`\`bash
node "\$HOME/.local/share/wps-connector/runtime/scripts/agent-tool-call.js" wps.connection_status '{"onlyOnline":true}'
\`\`\`

If the gateway returns NO_ONLINE_SESSIONS, then diagnose WPS/add-in status.
Do not misclassify unsupported call as a WPS session failure.

Dotted and underscore MCP names are both supported.

Fallback CLI for non-MCP agents:

node "\$HOME/.local/share/wps-connector/runtime/scripts/agent-connection-status.js" --onlyOnline
node "\$HOME/.local/share/wps-connector/runtime/scripts/agent-tool-call.js" wps.connection_status '{"onlyOnline":true}'
EOF_SKILL

printf 'Deployed WPS Connector runtime to %s\n' "$RUNTIME_ROOT"
printf 'Updated plugin MCP config at %s/.mcp.json\n' "$PLUGIN_DIR"
