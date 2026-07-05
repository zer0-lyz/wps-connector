#!/usr/bin/env bash
set -euo pipefail

JSADDONS_DIR="${WPS_JSADDONS_DIR:-$HOME/Library/Containers/com.kingsoft.wpsoffice.mac/Data/.kingsoft/wps/jsaddons}"
ADDIN_URL="${WPS_CONNECTOR_ADDIN_URL:-http://127.0.0.1:3891}"
STAMP="$(date +%Y%m%d%H%M%S)"
BACKUP_DIR="$JSADDONS_DIR/wps-connector-disabled-$STAMP"

mkdir -p "$JSADDONS_DIR" "$BACKUP_DIR"

for file in publish.xml authaddin.json jsaddinblockhost.ini; do
  if [ -f "$JSADDONS_DIR/$file" ]; then
    cp "$JSADDONS_DIR/$file" "$BACKUP_DIR/$file"
  fi
done

JSADDONS_DIR="$JSADDONS_DIR" ADDIN_URL="$ADDIN_URL" BACKUP_DIR="$BACKUP_DIR" node <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

const jsaddonsDir = process.env.JSADDONS_DIR;
const addinUrl = String(process.env.ADDIN_URL || "http://127.0.0.1:3891").replace(/\/$/, "");

function connectorItem(item) {
  return item && typeof item === "object" && String(item.name || "").startsWith("wps_connector_");
}

const publishPath = path.join(jsaddonsDir, "publish.xml");
if (fs.existsSync(publishPath)) {
  const before = fs.readFileSync(publishPath, "utf8");
  const after = before.replace(/<jspluginonline\b(?=[^>]*name="wps_connector_[^"]+")[^>]*\/?>(?:<\/jspluginonline>)?\s*/g, "");
  fs.writeFileSync(publishPath, after);
}

const authPath = path.join(jsaddonsDir, "authaddin.json");
if (fs.existsSync(authPath)) {
  const auth = JSON.parse(fs.readFileSync(authPath, "utf8"));
  for (const sectionName of ["wps", "et"]) {
    const section = auth[sectionName];
    if (!section || typeof section !== "object") continue;
    for (const key of Object.keys(section)) {
      if (key !== "namelist" && connectorItem(section[key])) delete section[key];
    }
    section.namelist = String(section.namelist || "").split(";").filter(Boolean).filter((key) => section[key] && !connectorItem(section[key])).join(";");
  }
  fs.writeFileSync(authPath, `${JSON.stringify(auth, null, 4)}\n`);
}

const blockPath = path.join(jsaddonsDir, "jsaddinblockhost.ini");
if (fs.existsSync(blockPath)) fs.renameSync(blockPath, path.join(process.env.BACKUP_DIR, "jsaddinblockhost.ini.moved"));

console.log(JSON.stringify({ ok: true, jsaddonsDir, addinUrl, backupDir: process.env.BACKUP_DIR }, null, 2));
NODE

echo "WPS Connector add-in disabled. Restart WPS to unload ribbon registration."
echo "Backup: $BACKUP_DIR"
