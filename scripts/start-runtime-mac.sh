#!/usr/bin/env bash
set -euo pipefail
RUNTIME_ROOT="${WPS_CONNECTOR_RUNTIME_ROOT:-$HOME/.local/share/wps-connector/runtime}"
BRIDGE_PORT="${WPS_CONNECTOR_PORT:-40215}"
ADDIN_PORT="${WPS_CONNECTOR_ADDIN_PORT:-3891}"
LOG_DIR="$RUNTIME_ROOT/logs"
mkdir -p "$LOG_DIR"

stop_port() {
  local port="$1"
  local pids
  pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    kill $pids 2>/dev/null || true
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      sleep 0.2
      pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
      [ -z "$pids" ] && return 0
    done
    kill -9 $pids 2>/dev/null || true
    sleep 0.2
  fi
}

stop_port "$BRIDGE_PORT"
stop_port "$ADDIN_PORT"

cd "$RUNTIME_ROOT"
nohup node apps/bridge/server.js > "$LOG_DIR/bridge.log" 2>&1 &
nohup node apps/wps-addin/server.js > "$LOG_DIR/addin.log" 2>&1 &
sleep 0.5

printf 'Started WPS Connector bridge on http://127.0.0.1:%s\n' "$BRIDGE_PORT"
printf 'Started WPS Connector add-in server on http://127.0.0.1:%s\n' "$ADDIN_PORT"
