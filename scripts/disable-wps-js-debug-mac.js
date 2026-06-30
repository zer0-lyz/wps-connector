#!/usr/bin/env node
import { existsSync, copyFileSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
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

function normalizeUrl(value) {
  return String(value || "").replace(/\/$/, "");
}

function isConnectorItem(item) {
  return item && typeof item === "object" && String(item.name || "").startsWith(connectorNamePrefix) && normalizeUrl(item.path || item.url) === connectorUrl;
}

function normalizePublishXml() {
  const path = join(jsaddonsDir, "publish.xml");
  if (!existsSync(path)) return false;
  backup(path);
  const before = readFileSync(path, "utf8");
  let after = before.replace(/enable="enable_dev"/g, 'enable="enable"').replace(/debug="code"/g, 'debug=""');
  after = after.replace(/(<jspluginonline\b(?=[^>]*name="wps_connector_[^"]+")(?=[^>]*url="http:\/\/127\.0\.0\.1:3891\/?")[^>]*?)\s+debug="[^"]*"/g, "$1 debug=\"\"");
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
    const keepByName = new Map();
    for (const [key, item] of Object.entries(section)) {
      if (!isConnectorItem(item)) continue;
      const name = String(item.name || "");
      const existing = keepByName.get(name);
      const score = (item.mode === 1 ? 4 : 0) + (item.isload === false ? 2 : 0) + (key.length < 40 ? 1 : 0);
      if (!existing || score > existing.score) keepByName.set(name, { key, item, score });
    }
    const keepKeys = new Set([...keepByName.values()].map((entry) => entry.key));
    for (const [key, item] of Object.entries(section)) {
      if (!isConnectorItem(item)) continue;
      if (!keepKeys.has(key)) {
        delete section[key];
        changed = true;
        continue;
      }
      if (item.mode !== 1) { item.mode = 1; changed = true; }
      if (item.isload !== false) { item.isload = false; changed = true; }
      if (item.enable !== true) { item.enable = true; changed = true; }
    }
    const keys = Object.entries(section).filter(([, item]) => isConnectorItem(item)).map(([key]) => key);
    const current = String(section.namelist || "").split(";").filter(Boolean);
    const others = current.filter((key) => !isConnectorItem(section[key]));
    const nextNameList = [...new Set([...others, ...keys])].join(";");
    if (section.namelist !== nextNameList) { section.namelist = nextNameList; changed = true; }
  }
  if (changed) writeFileSync(path, `${JSON.stringify(data, null, 4)}\n`);
  return changed;
}

mkdirSync(jsaddonsDir, { recursive: true });
const publishChanged = normalizePublishXml();
const authChanged = normalizeAuthAddin();
console.log(JSON.stringify({ ok: true, jsaddonsDir, publishChanged, authChanged }, null, 2));
