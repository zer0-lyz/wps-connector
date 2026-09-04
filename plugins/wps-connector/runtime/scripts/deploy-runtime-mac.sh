#!/usr/bin/env bash
set -euo pipefail

SOURCE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RUNTIME_ROOT="${WPS_CONNECTOR_RUNTIME_ROOT:-$HOME/.local/share/wps-connector/runtime}"
PLUGIN_DIR="${WPS_CONNECTOR_PLUGIN_DIR:-$HOME/plugins/wps-connector}"
BACKUP_ROOT="${WPS_CONNECTOR_BACKUP_ROOT:-$HOME/Library/Application Support/Connector Suite/backups/wps-runtime}"
RUN_ID="${CONNECTOR_SUITE_RUN_ID:-$(date +%Y%m%d-%H%M%S)}"
RUNTIME_PARENT="$(dirname "$RUNTIME_ROOT")"
STAGE_ROOT="$RUNTIME_PARENT/.runtime-stage-$RUN_ID-$$"
OLD_RUNTIME=""

log() {
  printf '[wps-runtime] %s\n' "$*" >&2
}

cleanup() {
  rm -rf -- "$STAGE_ROOT"
}
trap cleanup EXIT

mkdir -p "$RUNTIME_PARENT" "$BACKUP_ROOT"
bash "$SOURCE_DIR/scripts/sync-plugin-runtime-mac.sh"

mkdir -p "$STAGE_ROOT"
rsync -a --delete \
  --exclude '.git/' \
  --exclude 'node_modules/' \
  --exclude '.DS_Store' \
  --exclude 'test_logs/' \
  --exclude 'project-bindings.local.json' \
  --exclude 'codex-catalog.snapshot.json' \
  --exclude 'et-wpp-table-syncs.local.json' \
  --exclude 'et-wpp-source-cache.local.json' \
  --exclude 'table-format-templates.local.json' \
  "$SOURCE_DIR/" "$STAGE_ROOT/" >&2

for file in project-bindings.local.json codex-catalog.snapshot.json et-wpp-table-syncs.local.json et-wpp-source-cache.local.json table-format-templates.local.json; do
  [[ -f "$RUNTIME_ROOT/$file" ]] && cp -p "$RUNTIME_ROOT/$file" "$STAGE_ROOT/$file"
done

log "Installing production dependencies in writable staging runtime"
npm install --omit=dev --ignore-scripts --no-audit --no-fund --prefix "$STAGE_ROOT" >&2

if [[ -d "$RUNTIME_ROOT" ]]; then
  BACKUP_DIR="$BACKUP_ROOT/$RUN_ID"
  mkdir -p "$BACKUP_DIR"
  OLD_RUNTIME="$BACKUP_DIR/runtime"
  log "Backing up current runtime to $OLD_RUNTIME"
  mv "$RUNTIME_ROOT" "$OLD_RUNTIME"
fi

if ! mv "$STAGE_ROOT" "$RUNTIME_ROOT"; then
  log "Runtime activation failed"
  if [[ -n "$OLD_RUNTIME" && -d "$OLD_RUNTIME" && ! -e "$RUNTIME_ROOT" ]]; then
    mv "$OLD_RUNTIME" "$RUNTIME_ROOT"
    log "Previous runtime restored"
  fi
  exit 1
fi
trap - EXIT
log "Activated runtime: $RUNTIME_ROOT"
mkdir -p "$RUNTIME_ROOT/logs"

restart_launch_agent() {
  local label="$1"
  local domain="gui/$(id -u)"
  local target="$domain/$label"
  local plist="$HOME/Library/LaunchAgents/$label.plist"
  if launchctl print "$target" >/dev/null 2>&1; then
    launchctl kickstart -k "$target"
    log "Restarted LaunchAgent: $label"
    return 0
  fi
  if [[ -f "$plist" ]]; then
    launchctl bootstrap "$domain" "$plist"
    launchctl kickstart -k "$target"
    log "Bootstrapped and started LaunchAgent: $label"
    return 0
  fi
  log "LaunchAgent plist not found: $plist"
  return 1
}

if [ -f "$PLUGIN_DIR/.codex-plugin/plugin.json" ]; then
  mkdir -p "$PLUGIN_DIR/skills/wps-connector" "$PLUGIN_DIR/assets"
  cp "$SOURCE_DIR/plugins/wps-connector/.codex-plugin/plugin.json" "$PLUGIN_DIR/.codex-plugin/plugin.json"
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
  printf 'Updated plugin MCP config at %s/.mcp.json\n' "$PLUGIN_DIR"
else
  printf 'Skipped plugin metadata update: complete plugin source not found at %s\n' "$PLUGIN_DIR"
fi

restart_launch_agent "com.codex.wps-connector.bridge"
restart_launch_agent "com.codex.wps-connector.addin"

printf 'Deployed WPS Connector runtime to %s\n' "$RUNTIME_ROOT"
