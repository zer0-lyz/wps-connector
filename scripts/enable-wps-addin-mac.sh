#!/usr/bin/env bash
set -euo pipefail

JSADDONS_DIR="${WPS_JSADDONS_DIR:-$HOME/Library/Containers/com.kingsoft.wpsoffice.mac/Data/.kingsoft/wps/jsaddons}"
ADDIN_URL="${WPS_CONNECTOR_ADDIN_URL:-http://127.0.0.1:3891}"
STAMP="$(date +%Y%m%d%H%M%S)"

mkdir -p "$JSADDONS_DIR"

backup_file() {
  local path="$1"
  [ -f "$path" ] || return 0
  cp "$path" "$path.bak-$STAMP-enable-wps-connector"
}

backup_file "$JSADDONS_DIR/publish.xml"
backup_file "$JSADDONS_DIR/authaddin.json"

JSADDONS_DIR="$JSADDONS_DIR" ADDIN_URL="$ADDIN_URL" node <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

const jsaddonsDir = process.env.JSADDONS_DIR;
const addinUrl = String(process.env.ADDIN_URL || "http://127.0.0.1:3891").replace(/\/$/, "");
const iconUrl = `${addinUrl}/images/connector.svg`;
const entries = [
  { section: "wps", type: "wps", name: "wps_connector_wps_binding_v7" },
  { section: "et", type: "et", name: "wps_connector_et_binding_v7" },
];

function escapeXml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function connectorItem(item) {
  return item && typeof item === "object" && String(item.name || "").startsWith("wps_connector_") && String(item.path || "").replace(/\/$/, "") === addinUrl;
}

const publishPath = path.join(jsaddonsDir, "publish.xml");
let publish = '<?xml version="1.0" encoding="UTF-8"?>\n<jsplugins>\n</jsplugins>\n';
try { publish = fs.readFileSync(publishPath, "utf8"); } catch {}
publish = publish.replace(/<jspluginonline\b(?=[^>]*name="wps_connector_[^"]+")(?=[^>]*url="http:\/\/127\.0\.0\.1:3891\/?")[^>]*\/?>(?:<\/jspluginonline>)?\s*/g, "");
const tags = entries.map((entry) => `    <jspluginonline name="${escapeXml(entry.name)}" url="${escapeXml(`${addinUrl}/`)}" type="${entry.type}" enable="enable" install="null" icon="${escapeXml(iconUrl)}" image="${escapeXml(iconUrl)}" imageUrl="${escapeXml(iconUrl)}" debug=""/>\n`).join("");
if (publish.includes("</jsplugins>")) publish = publish.replace("</jsplugins>", `${tags}</jsplugins>`);
else publish = `<?xml version="1.0" encoding="UTF-8"?>\n<jsplugins>\n${tags}</jsplugins>\n`;
fs.writeFileSync(publishPath, publish);

const authPath = path.join(jsaddonsDir, "authaddin.json");
const auth = readJson(authPath, {});
for (const sectionName of ["wps", "et"]) {
  const section = auth[sectionName] && typeof auth[sectionName] === "object" ? auth[sectionName] : {};
  for (const key of Object.keys(section)) {
    if (key !== "namelist" && connectorItem(section[key])) delete section[key];
  }
  const entry = entries.find((item) => item.section === sectionName);
  const key = Buffer.from(entry.name).toString("hex").slice(0, 32);
  section[key] = {
    enable: true,
    isload: false,
    mode: 1,
    name: entry.name,
    path: addinUrl,
    icon: iconUrl,
    image: iconUrl,
    imageUrl: iconUrl,
  };
  const names = String(section.namelist || "").split(";").filter(Boolean).filter((key) => section[key] && !connectorItem(section[key]));
  names.push(key);
  section.namelist = [...new Set(names)].join(";");
  auth[sectionName] = section;
}
fs.writeFileSync(authPath, `${JSON.stringify(auth, null, 4)}\n`);

console.log(JSON.stringify({ ok: true, jsaddonsDir, addinUrl, publishPath, authPath, installed: entries }, null, 2));
NODE

echo "WPS Connector add-in enabled with lazy activation. Restart WPS to reload add-in registration."
