import { stdin, stdout } from "node:process";
import { tools } from "../shared/toolSchemas.js";

const bridgeUrl = (process.env.WPS_CONNECTOR_BRIDGE_URL || "http://127.0.0.1:40215").replace(/\/$/, "");
const exposeDottedTools = /^(1|true|yes|on)$/i.test(String(process.env.WPS_CONNECTOR_MCP_EXPOSE_DOTTED || ""));
const bridgeTimeoutMs = Number(process.env.WPS_CONNECTOR_MCP_TIMEOUT_MS || 65000);

function writeMessage(message, framing = "line") {
  const payload = JSON.stringify(message);
  if (framing === "content-length") {
    stdout.write(`Content-Length: ${Buffer.byteLength(payload, "utf8")}\r\n\r\n${payload}`);
    return;
  }
  stdout.write(`${payload}\n`);
}

function textResult(payload) {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    ...(payload?.ok === false ? { isError: true } : {}),
  };
}

function normalizeToolName(name) {
  let text = String(name || "");
  const wrapped = /^mcp__wps[_-]connector__(.+)$/i.exec(text);
  if (wrapped) text = wrapped[1];
  text = text.replace(/_[0-9a-f]{8,64}$/i, "");
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
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), bridgeTimeoutMs);
  try {
    const response = await fetch(`${bridgeUrl}/api/tools/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(args || {}),
      signal: controller.signal,
    });
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
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
        serverInfo: { name: "wps-connector", version: "1.0.72" },
      },
    };
  }
  if (method === "tools/list") return { jsonrpc: "2.0", id, result: { tools: exposeDottedTools ? [...tools, ...toolAliases()] : toolAliases() } };
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

let inputBuffer = Buffer.alloc(0);
let processing = Promise.resolve();

function takeMessages() {
  const messages = [];
  while (inputBuffer.length) {
    // MCP stdio uses Content-Length framing. Keep newline JSON as a compatibility
    // path for the existing local smoke tests and older agent gateways.
    const headerEnd = inputBuffer.indexOf(Buffer.from("\r\n\r\n"));
    const firstLineEnd = inputBuffer.indexOf(0x0a);
    const firstBytes = inputBuffer.subarray(0, Math.max(firstLineEnd, 0)).toString("utf8").trim();
    if (/^content-length\s*:/i.test(firstBytes)) {
      if (headerEnd < 0) break;
      const headers = inputBuffer.subarray(0, headerEnd).toString("ascii").split(/\r?\n/);
      const lengthHeader = headers.find((header) => /^content-length\s*:/i.test(header));
      const contentLength = Number(lengthHeader?.split(":").slice(1).join(":").trim());
      if (!Number.isSafeInteger(contentLength) || contentLength < 0) {
        inputBuffer = inputBuffer.subarray(headerEnd + 4);
        messages.push({ error: new Error("Invalid MCP Content-Length header"), framing: "content-length" });
        continue;
      }
      const bodyStart = headerEnd + 4;
      if (inputBuffer.length < bodyStart + contentLength) break;
      const body = inputBuffer.subarray(bodyStart, bodyStart + contentLength).toString("utf8");
      inputBuffer = inputBuffer.subarray(bodyStart + contentLength);
      messages.push({ body, framing: "content-length" });
      continue;
    }
    if (firstLineEnd < 0) break;
    const line = inputBuffer.subarray(0, firstLineEnd).toString("utf8").trim();
    inputBuffer = inputBuffer.subarray(firstLineEnd + 1);
    if (line) messages.push({ body: line, framing: "line" });
  }
  return messages;
}

async function processMessage(message) {
  let request;
  try {
    if (message.error) throw message.error;
    request = JSON.parse(message.body);
    const response = await handleRequest(request);
    if (response) writeMessage(response, message.framing);
  } catch (error) {
    writeMessage({
      jsonrpc: "2.0",
      id: request?.id ?? null,
      error: { code: error.rpcCode || -32000, message: error.message, data: error.data || error.details || {} },
    }, message.framing);
  }
}

function drainInput() {
  for (const message of takeMessages()) {
    processing = processing.then(() => processMessage(message)).catch(() => {});
  }
}

stdin.on("data", (chunk) => {
  inputBuffer = Buffer.concat([inputBuffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
  drainInput();
});
