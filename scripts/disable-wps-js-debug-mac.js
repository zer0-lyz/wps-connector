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
const connectorIconUrl = `${connectorUrl}/images/connector.svg`;

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

function escapeXmlAttr(value) {
  return String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function setXmlAttr(tag, name, value) {
  const attr = `${name}="${escapeXmlAttr(value)}"`;
  const pattern = new RegExp(`\\s${name}="[^"]*"`);
  if (pattern.test(tag)) return tag.replace(pattern, ` ${attr}`);
  if (/\/>\s*$/.test(tag)) return tag.replace(/\/>\s*$/, ` ${attr}/>`);
  return tag.replace(/>\s*$/, ` ${attr}>`);
}

function normalizePublishXml() {
  const path = join(jsaddonsDir, "publish.xml");
  if (!existsSync(path)) return false;
  backup(path);
  const before = readFileSync(path, "utf8");
  let after = before.replace(/enable="enable_dev"/g, 'enable="enable"').replace(/debug="code"/g, 'debug=""');
  after = after.replace(/<jspluginonline\b(?=[^>]*name="wps_connector_[^"]+")(?=[^>]*url="http:\/\/127\.0\.0\.1:3891\/?")[^>]*\/?>(?:<\/jspluginonline>)?/g, (tag) => {
    let next = tag.replace(/<\/jspluginonline>$/, "");
    next = setXmlAttr(next, "debug", "");
    next = setXmlAttr(next, "enable", "enable");
    next = setXmlAttr(next, "icon", connectorIconUrl);
    next = setXmlAttr(next, "image", connectorIconUrl);
    next = setXmlAttr(next, "imageUrl", connectorIconUrl);
    return next;
  });
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
    const expectedName = `wps_connector_${sectionName}_binding_v7`;
    const entries = Object.entries(section).filter(([key]) => key !== "namelist");
    const candidates = entries.filter(([, item]) => isConnectorItem(item) && item.name === expectedName);
    const selected = candidates.find(([, item]) => item.mode === 1 && item.isload === false) || candidates[0];
    for (const [key, item] of entries) {
      if (!isConnectorItem(item)) continue;
      if (!selected || key !== selected[0] || item.name !== expectedName) {
        delete section[key];
        changed = true;
      }
    }
    if (selected) {
      const item = section[selected[0]];
      const normalized = { ...item, enable: true, isload: false, mode: 1, md5: "", name: expectedName, path: connectorUrl, icon: connectorIconUrl, image: connectorIconUrl, imageUrl: connectorIconUrl };
      if (JSON.stringify(item) !== JSON.stringify(normalized)) { section[selected[0]] = normalized; changed = true; }
    }
    const keys = Object.entries(section).filter(([, item]) => isConnectorItem(item)).map(([key]) => key);
    const current = String(section.namelist || "").split(";").filter(Boolean);
    const others = current.filter((key) => section[key] && !isConnectorItem(section[key]));
    const nextNameList = [...new Set([...others, ...keys])].join(";");
    if (section.namelist !== nextNameList) { section.namelist = nextNameList; changed = true; }
  }
  if (changed) writeFileSync(path, `${JSON.stringify(data, null, 4)}\n`);
  return changed;
}

mkdirSync(jsaddonsDir, { recursive: true });
const publishChanged = normalizePublishXml();
const authChanged = normalizeAuthAddin();
console.log(JSON.stringify({ ok: true, jsaddonsDir, connectorIconUrl, publishChanged, authChanged }, null, 2));
