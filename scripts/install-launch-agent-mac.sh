#!/usr/bin/env bash
set -euo pipefail
RUNTIME_ROOT="${WPS_CONNECTOR_RUNTIME_ROOT:-$HOME/.local/share/wps-connector/runtime}"
AGENT_DIR="$HOME/Library/LaunchAgents"
UID_VALUE="$(id -u)"
mkdir -p "$AGENT_DIR" "$RUNTIME_ROOT/logs"

unload_agent() {
  local label="$1"
  launchctl bootout "gui/$UID_VALUE/$label" 2>/dev/null || true
  launchctl remove "$label" 2>/dev/null || true
}

stop_port() {
  local port="$1"
  local pids
  pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  [ -n "$pids" ] && kill -9 $pids 2>/dev/null || true
}

write_agent() {
  local label="$1"
  local script_path="$2"
  local stdout_path="$3"
  local stderr_path="$4"
  local plist="$AGENT_DIR/$label.plist"
  cat > "$plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$label</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>$script_path</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$RUNTIME_ROOT</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$stdout_path</string>
  <key>StandardErrorPath</key>
  <string>$stderr_path</string>
</dict>
</plist>
PLIST
  plutil -lint "$plist" >/dev/null
  launchctl bootstrap "gui/$UID_VALUE" "$plist"
  launchctl kickstart -k "gui/$UID_VALUE/$label"
}

for legacy in com.codex.wps-connector.wps com.codex.wps-connector.et; do
  unload_agent "$legacy"
  if [ -f "$AGENT_DIR/$legacy.plist" ]; then
    mv "$AGENT_DIR/$legacy.plist" "$AGENT_DIR/$legacy.plist.disabled-$(date +%Y%m%d%H%M%S)"
  fi
done

unload_agent com.codex.wps-connector.bridge
unload_agent com.codex.wps-connector.addin
stop_port 40215
stop_port 3891
sleep 1

write_agent "com.codex.wps-connector.bridge" "apps/bridge/server.js" "$RUNTIME_ROOT/logs/bridge.launchd.out.log" "$RUNTIME_ROOT/logs/bridge.launchd.err.log"
write_agent "com.codex.wps-connector.addin" "apps/wps-addin/server.js" "$RUNTIME_ROOT/logs/addin.launchd.out.log" "$RUNTIME_ROOT/logs/addin.launchd.err.log"

printf 'Installed WPS Connector LaunchAgents with runtime %s\n' "$RUNTIME_ROOT"
