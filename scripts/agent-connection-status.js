#!/usr/bin/env node
import { argv, exit } from "node:process";

const bridgeUrl = (process.env.WPS_CONNECTOR_BRIDGE_URL || "http://127.0.0.1:40215").replace(/\/$/, "");

function parseArgs(args) {
  const out = {};
  for (let i = 2; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = args[i + 1];
    if (["onlyOnline", "onlyBound"].includes(key)) out[key] = true;
    else if (next && !next.startsWith("--")) { out[key] = next; i += 1; }
    else out[key] = true;
  }
  if (out.host) out.host = String(out.host);
  if (out.binding && typeof out.binding === "string") out.binding = JSON.parse(out.binding);
  return out;
}

async function main() {
  const payload = parseArgs(argv);
  const response = await fetch(`${bridgeUrl}/api/tools/wps/connection_status`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await response.json();
  console.log(JSON.stringify(json, null, 2));
  if (!response.ok || json.ok === false) exit(2);
  if (json.issues?.length) exit(1);
}

main().catch((error) => {
  console.log(JSON.stringify({ ok: false, error: { code: "CONNECTION_STATUS_FAILED", message: error.message }, bridgeUrl }, null, 2));
  exit(2);
});
