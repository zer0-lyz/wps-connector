import { stdin, stdout } from "node:process";
import { tools } from "../shared/toolSchemas.js";

const bridgeUrl = (process.env.WPS_CONNECTOR_BRIDGE_URL || "http://127.0.0.1:40215").replace(/\/$/, "");
const exposeDottedTools = /^(1|true|yes|on)$/i.test(String(process.env.WPS_CONNECTOR_MCP_EXPOSE_DOTTED || ""));
const bridgeTimeoutMs = Number(process.env.WPS_CONNECTOR_MCP_TIMEOUT_MS || 65000);
const contextOptionalTools = new Set(["wps.list_sessions", "wps.connection_status"]);

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

function firstText(...values) {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) return text;
  }
  return "";
}

function trustedCallContext(request) {
  const meta = request?.params?._meta && typeof request.params._meta === "object" ? request.params._meta
    : request?._meta && typeof request._meta === "object" ? request._meta
      : {};
  return {
    threadId: firstText(
      meta.threadId,
      meta.thread_id,
      meta.codexThreadId,
      meta.codex_thread_id,
      meta["codex/threadId"],
      process.env.CODEX_THREAD_ID,
      process.env.CODEX_THREAD,
    ),
    conversationId: firstText(
      meta.conversationId,
      meta.conversation_id,
      meta.codexConversationId,
      meta.codex_conversation_id,
      meta["codex/conversationId"],
      process.env.CODEX_CONVERSATION_ID,
    ),
    projectPath: firstText(
      meta.codex_cwd,
      meta.codexCwd,
      meta.cwd,
      meta.projectPath,
      meta.project_path,
      process.env.CODEX_CWD,
      process.env.CODEX_PROJECT_PATH,
    ),
  };
}

function bindingOverrideError(field, requested, trusted) {
  return {
    ok: false,
    error: {
      code: "CALLER_BINDING_OVERRIDE_REFUSED",
      message: `Tool arguments cannot override the current Codex ${field}.`,
      details: { field, requested, trusted },
    },
  };
}

function prepareTrustedArguments(canonicalName, input, request) {
  const args = input && typeof input === "object" && !Array.isArray(input) ? { ...input } : {};
  const nested = args.binding && typeof args.binding === "object" && !Array.isArray(args.binding) ? { ...args.binding } : null;
  const trusted = trustedCallContext(request);
  if (!trusted.threadId && !trusted.conversationId && !contextOptionalTools.has(canonicalName)) {
    return {
      ok: false,
      error: {
        code: "MCP_TRUSTED_CONTEXT_REQUIRED",
        message: `${canonicalName} requires the current Codex task identity from MCP metadata. Caller-supplied binding fields are not trusted.`,
      },
    };
  }
  for (const [field, value] of [["threadId", trusted.threadId], ["conversationId", trusted.conversationId]]) {
    if (!value) continue;
    const supplied = firstText(args[field], nested?.[field]);
    if (supplied && supplied !== value) return bindingOverrideError(field, supplied, value);
    args[field] = value;
    if (nested) nested[field] = value;
  }
  if (trusted.projectPath) {
    const suppliedPath = firstText(args.projectPath, nested?.projectPath);
    if (suppliedPath && suppliedPath !== trusted.projectPath) return bindingOverrideError("projectPath", suppliedPath, trusted.projectPath);
    args.projectPath = trusted.projectPath;
    if (nested) nested.projectPath = trusted.projectPath;
  }
  if (nested) args.binding = nested;
  return { ok: true, args, trusted };
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
        serverInfo: { name: "wps-connector", version: "1.1.1" },
      },
    };
  }
  if (method === "tools/list") return { jsonrpc: "2.0", id, result: { tools: exposeDottedTools ? [...tools, ...toolAliases()] : toolAliases() } };
  if (method === "tools/call") {
    const requestedName = params?.name;
    const canonicalName = normalizeToolName(requestedName);
    if (!tools.some((tool) => tool.name === canonicalName)) throw new Error(`Unknown tool: ${requestedName}`);
    const prepared = prepareTrustedArguments(canonicalName, params?.arguments || {}, request);
    if (!prepared.ok) return { jsonrpc: "2.0", id, result: textResult(prepared) };
    const result = await callBridgeTool(canonicalName, prepared.args);
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
