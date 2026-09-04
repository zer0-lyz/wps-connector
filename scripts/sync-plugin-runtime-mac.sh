#!/usr/bin/env bash
set -euo pipefail

SOURCE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TARGET_DIR="$SOURCE_DIR/plugins/wps-connector/runtime"

mkdir -p "$TARGET_DIR"
rsync -a --delete \
  --exclude '.git/' \
  --exclude 'node_modules/' \
  --exclude 'plugins/' \
  --exclude '.DS_Store' \
  --exclude 'test_logs/' \
  --exclude 'project-bindings.local.json' \
  --exclude 'codex-catalog.snapshot.json' \
  --exclude 'et-wpp-table-syncs.local.json' \
  --exclude 'et-wpp-source-cache.local.json' \
  --exclude 'table-format-templates.local.json' \
  "$SOURCE_DIR/" "$TARGET_DIR/"

printf 'Synchronized WPS plugin runtime: %s\n' "$TARGET_DIR"
