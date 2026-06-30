#!/usr/bin/env node
import { existsSync, copyFileSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

const jsaddonsDir = process.env.WPS_JSADDONS_DIR || join(
  homedir(),
  "Library/Containers/com.kingsoft.wpsoffice.mac/Data/.kingsoft/wps/jsaddons",
);
const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
const connectorUrl = "http://127.0.0.1:3891";
const connectorNamePrefix = "wps_connector_";

function backup(path) {
  if (!existsSync(path)) return;
  const backupPath = `${path}.bak-${stamp}-no-js-debug`;
  if (!existsSync(backupPath)) copyFileSync(path, backupPath);
}

function normalizePublishXml() {
  const path = join(jsaddonsDir, "publish.xml");
  if (!existsSync(path)) return false;
  backup(path);
  const before = readFileSync(path, "utf8");
  const after = before.replace(/enable="enable_dev"/g, 'enable="enable"').replace(/debug="code"/g, 'debug=""');
  if (after !== before) writeFileSync(path, after);
  return after !== before;
}

function normalizeAuthAddin() {
  const path = join(jsaddonsDir, "authaddin.json");
  if (!existsSync(path)) return false;
  backup(path);
  const data = JSON.parse(readFileSync(path, "utf8"));
  let changed = false;
  for (const sectionName of ["et", "wps"]) {
    const section = data[sectionName];
    if (!section || typeof section !== "object") continue;
    for (const item of Object.values(section)) {
      if (!item || typeof item !== "object") continue;
      const isConnector = String(item.name || "").startsWith(connectorNamePrefix) && String(item.path || "").replace(/\/$/, "") === connectorUrl;
      if (!isConnector) continue;
      if (item.mode !== 1) { item.mode = 1; changed = true; }
      if (item.isload !== false) { item.isload = false; changed = true; }
    }
  }
  if (changed) writeFileSync(path, `${JSON.stringify(data, null, 4)}\n`);
  return changed;
}

mkdirSync(jsaddonsDir, { recursive: true });
const publishChanged = normalizePublishXml();
const authChanged = normalizeAuthAddin();
console.log(JSON.stringify({ ok: true, jsaddonsDir, publishChanged, authChanged }, null, 2));
