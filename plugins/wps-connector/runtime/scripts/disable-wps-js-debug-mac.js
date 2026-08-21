#!/usr/bin/env node
import { existsSync, copyFileSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
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
const connectorDefinitions = {
  wps: { name: "wps_connector_wps_binding_v7", type: "wps" },
  et: { name: "wps_connector_et_binding_v7", type: "et" },
};

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
  const before = existsSync(path)
    ? readFileSync(path, "utf8")
    : '<?xml version="1.0" encoding="UTF-8"?>\n<jsplugins>\n</jsplugins>\n';
  if (existsSync(path)) backup(path);
  let after = before
    .replace(/enable="enable_dev"/g, 'enable="enable"')
    .replace(/debug="code"/g, 'debug=""')
    .replace(/\s*<jspluginonline\b(?=[^>]*name="wps_connector_[^"]+")[^>]*\/?>(?:<\/jspluginonline>)?/g, "");
  const entries = Object.values(connectorDefinitions).map((definition) =>
    `    <jspluginonline type="${definition.type}" image="${connectorIconUrl}" name="${definition.name}" debug="" icon="${connectorIconUrl}" enable="enable" install="null" imageUrl="${connectorIconUrl}" url="${connectorUrl}/"/>`,
  ).join("\n");
  if (/<\/jsplugins>\s*$/.test(after)) {
    after = after.replace(/\s*<\/jsplugins>\s*$/, `\n${entries}\n</jsplugins>\n`);
  } else {
    after = `<?xml version="1.0" encoding="UTF-8"?>\n<jsplugins>\n${entries}\n</jsplugins>\n`;
  }
  if (after !== before) writeFileSync(path, after);
  return after !== before;
}

function normalizeAuthAddin() {
  const path = join(jsaddonsDir, "authaddin.json");
  if (existsSync(path)) backup(path);
  let data = { et: { namelist: "" }, wps: { namelist: "" } };
  if (existsSync(path)) {
    try {
      data = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      const corruptBackup = `${path}.bak-${stamp}-invalid-json`;
      copyFileSync(path, corruptBackup);
    }
  }
  let changed = false;
  for (const sectionName of ["et", "wps"]) {
    if (!data[sectionName] || typeof data[sectionName] !== "object") {
      data[sectionName] = { namelist: "" };
      changed = true;
    }
    const section = data[sectionName];
    for (const [key, item] of Object.entries(section)) {
      if (key !== "namelist" && isConnectorItem(item)) {
        delete section[key];
        changed = true;
      }
    }
    const definition = connectorDefinitions[sectionName];
    const key = createHash("sha256").update(`${definition.name}|${connectorUrl}`).digest("hex").slice(0, 32);
    section[key] = {
      enable: true,
      icon: connectorIconUrl,
      image: connectorIconUrl,
      imageUrl: connectorIconUrl,
      isload: false,
      md5: "",
      mode: 1,
      name: definition.name,
      path: connectorUrl,
    };
    const current = String(section.namelist || "").split(";").filter(Boolean);
    const others = current.filter((existingKey) => section[existingKey] && !isConnectorItem(section[existingKey]));
    const nextNameList = [...new Set([...others, key])].join(";");
    if (section.namelist !== nextNameList) { section.namelist = nextNameList; changed = true; }
  }
  const serialized = `${JSON.stringify(data, null, 4)}\n`;
  if (!existsSync(path) || serialized !== readFileSync(path, "utf8")) {
    writeFileSync(path, serialized);
    changed = true;
  }
  return changed;
}

mkdirSync(jsaddonsDir, { recursive: true });
const publishChanged = normalizePublishXml();
const authChanged = normalizeAuthAddin();
console.log(JSON.stringify({ ok: true, jsaddonsDir, connectorIconUrl, publishChanged, authChanged }, null, 2));
