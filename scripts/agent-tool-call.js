#!/usr/bin/env node
import { argv, exit, stdin } from "node:process";

const bridgeUrl = (process.env.WPS_CONNECTOR_BRIDGE_URL || "http://127.0.0.1:40215").replace(/\/$/, "");

function canonicalToolName(value) {
  const match = /^(wps|wpp|et)[._](.+)$/.exec(String(value || ""));
  if (!match) throw new Error("Tool must use wps.*, wpp.*, et.* or the underscore alias.");
  return `${match[1]}.${match[2]}`;
}

async function readStdin() {
  if (stdin.isTTY) return "";
  let text = "";
  stdin.setEncoding("utf8");
  for await (const chunk of stdin) text += chunk;
  return text.trim();
}

async function main() {
  const toolName = canonicalToolName(argv[2]);
  const rawInput = argv[3] || await readStdin() || "{}";
  const input = JSON.parse(rawInput);
  if (!input || Array.isArray(input) || typeof input !== "object") throw new Error("Tool input must be a JSON object.");

  const controller = new AbortController();
  const timeoutMs = Number(process.env.WPS_CONNECTOR_AGENT_TIMEOUT_MS || 65000);
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const path = toolName.replace(".", "/");
    const response = await fetch(`${bridgeUrl}/api/tools/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
      signal: controller.signal,
    });
    const json = await response.json();
    console.log(JSON.stringify(json, null, 2));
    if (!response.ok || json.ok === false) exit(1);
  } finally {
    clearTimeout(timer);
  }
}

main().catch((error) => {
  console.log(JSON.stringify({ ok: false, error: { code: "AGENT_TOOL_CALL_FAILED", message: error.message }, bridgeUrl }, null, 2));
  exit(2);
});
