import { spawn } from "node:child_process";
import { stdin, stdout } from "node:process";
import { tools } from "../shared/toolSchemas.js";

const bridgeUrl = (process.env.WPS_CONNECTOR_BRIDGE_URL || "http://127.0.0.1:40215").replace(/\/$/, "");

function writeMessage(message) {
  stdout.write(`${JSON.stringify(message)}\n`);
}

function textResult(payload) {
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
}

function normalizeToolName(name) {
  const text = String(name || "");
  if (tools.some((tool) => tool.name === text)) return text;
  const match = /^(wps|wpp|et)_(.+)$/.exec(text);
  if (!match) return text;
  const dotted = match[1] + "." + match[2];
  return tools.some((tool) => tool.name === dotted) ? dotted : text;
}
function toolAliases() {
  return tools.map((tool) => ({ ...tool, name: tool.name.replace(".", "_"), description: String(tool.description || "") + " Alias for " + tool.name + "." })).filter((tool, index) => tool.name !== tools[index].name);
}

async function callBridgeTool(name, args) {
  const canonicalName = normalizeToolName(name);
  const path = canonicalName.replaceAll(".", "/");
  const payload = JSON.stringify(args || {});
  const result = await new Promise((resolve, reject) => {
    const child = spawn("curl", [
      "-sS",
      "-X",
      "POST",
      `${bridgeUrl}/api/tools/${path}`,
      "-H",
      "content-type: application/json",
      "--data-binary",
      "@-",
    ]);
    let out = "";
    let err = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      out += chunk;
    });
    child.stderr.on("data", (chunk) => {
      err += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(err || `curl exited with code ${code}`));
    });
    child.stdin.end(payload);
  });
  return JSON.parse(result);
}

async function handleRequest(request) {
  const { id, method, params } = request;
  if (method === "initialize") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "wps-connector", version: "0.1.0" },
      },
    };
  }
  if (method === "tools/list") return { jsonrpc: "2.0", id, result: { tools: [...tools, ...toolAliases()] } };
  if (method === "tools/call") {
    const requestedName = params?.name;
    const canonicalName = normalizeToolName(requestedName);
    if (!tools.some((tool) => tool.name === canonicalName)) throw new Error(`Unknown tool: ${requestedName}`);
    const result = await callBridgeTool(canonicalName, params?.arguments || {});
    return { jsonrpc: "2.0", id, result: textResult(result) };
  }
  if (method === "notifications/initialized") return null;
  throw new Error(`Unsupported method: ${method}`);
}

let buffer = "";
stdin.setEncoding("utf8");
stdin.on("data", async (chunk) => {
  buffer += chunk;
  let newline;
  while ((newline = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (!line) continue;
    let request;
    try {
      request = JSON.parse(line);
      const response = await handleRequest(request);
      if (response) writeMessage(response);
    } catch (error) {
      writeMessage({
        jsonrpc: "2.0",
        id: request?.id ?? null,
        error: { code: error.rpcCode || -32000, message: error.message, data: error.data || error.details || {} },
      });
    }
  }
});
