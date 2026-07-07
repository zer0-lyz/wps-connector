#!/usr/bin/env bash
set -euo pipefail
for port in "${WPS_CONNECTOR_PORT:-40215}" "${WPS_CONNECTOR_ADDIN_PORT:-3891}"; do
  pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    kill $pids 2>/dev/null || true
    sleep 0.5
    pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
    if [ -n "$pids" ]; then kill -9 $pids 2>/dev/null || true; fi
    printf 'Stopped listeners on port %s\n' "$port"
  else
    printf 'No listener on port %s\n' "$port"
  fi
done
