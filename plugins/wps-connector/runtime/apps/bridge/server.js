import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { promisify } from "node:util";
import { tools } from "../shared/toolSchemas.js";

const host = process.env.WPS_CONNECTOR_HOST || "127.0.0.1";
const port = Number(process.env.WPS_CONNECTOR_PORT || 40215);
const commandTimeoutMs = Number(process.env.WPS_CONNECTOR_COMMAND_TIMEOUT_MS || 60000);
const addinUrl = (process.env.WPS_CONNECTOR_ADDIN_URL || "http://127.0.0.1:3891").replace(/\/$/, "");
const runtimeRoot = process.env.WPS_CONNECTOR_RUNTIME_ROOT || join(homedir(), ".local/share/wps-connector/runtime");
const catalogPath = process.env.WPS_CONNECTOR_CATALOG_PATH || join(runtimeRoot, "codex-catalog.snapshot.json");
const bindingsPath = process.env.WPS_CONNECTOR_BINDINGS_PATH || join(runtimeRoot, "project-bindings.local.json");
const sessions = new Map();
const commands = new Map();
const execFileAsync = promisify(execFile);
let bindingsStore = { bindings: [] };

function nowIso() { return new Date().toISOString(); }
function sendJson(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "content-type" });
  res.end(JSON.stringify(payload, null, 2));
}
function sendError(res, status, code, message, details = {}) { sendJson(res, status, { ok: false, error: { code, message, details } }); }
function statusForError(error) {
  const code = String(error?.code || "");
  if (code === "SESSION_HOST_MISMATCH" || code === "SESSION_BINDING_MISMATCH" || code === "BINDING_MISMATCH" || code === "SESSION_BINDING_REQUIRED" || code === "SESSION_OFFLINE" || code.endsWith("_REFUSED")) return 409;
  if (code === "INVALID_ARGUMENT" || code === "INVALID_ADDRESS") return 400;
  if (code.endsWith("_NOT_FOUND")) return 404;
  if (code === "HOST_UNSUPPORTED") return 501;
  if (code === "COMMAND_TIMEOUT") return 504;
  return 500;
}
async function readJson(req) { let body = ""; for await (const chunk of req) body += chunk; if (!body.trim()) return {}; return JSON.parse(body); }
function normalizeHost(value) { const text = String(value || "").toLowerCase(); if (text.includes("spreadsheet") || text.includes("et") || text.includes("excel")) return "et"; if (text.includes("writer") || text.includes("wpp") || text.includes("word")) return "wpp"; return value || "wps"; }
function normalizeText(value) { return String(value || "").trim(); }
function documentKeyFor(session) { return session.documentIdentity?.fullPath || session.documentIdentity?.url || session.documentName || session.sessionId; }
const bindingKeys = ["projectName", "projectPath", "projectId", "threadId", "conversationId", "documentRole", "bindingId", "documentKey", "host", "documentName", "createdAt", "updatedAt"];
const selectorBindingKeys = ["projectName", "projectPath", "projectId", "threadId", "conversationId", "documentRole", "bindingId", "documentKey", "host", "documentName"];
function normalizeBinding(binding) {
  if (!binding || typeof binding !== "object") return null;
  const out = {};
  for (const key of bindingKeys) {
    if (Object.prototype.hasOwnProperty.call(binding, key)) out[key] = String(binding[key] ?? "");
  }
  if (binding.documentIdentity && typeof binding.documentIdentity === "object") out.documentIdentity = binding.documentIdentity;
  return Object.keys(out).length ? out : null;
}
function requestedBinding(input = {}) {
  const nested = normalizeBinding(input.binding) || {};
  const direct = {};
  for (const key of selectorBindingKeys) {
    if (Object.prototype.hasOwnProperty.call(input, key)) direct[key] = String(input[key] ?? "");
  }
  const requested = { ...nested, ...direct };
  for (const key of Object.keys(requested)) {
    if (requested[key] === "" || key === "createdAt" || key === "updatedAt") delete requested[key];
  }
  return Object.keys(requested).length ? requested : null;
}
function bindingMatches(session, requested) {
  if (!requested) return true;
  if (!session?.binding) return false;
  return Object.entries(requested).every(([key, value]) => String(session.binding?.[key] ?? "") === String(value));
}
async function loadBindings() { try { const raw = await readFile(bindingsPath, "utf8"); const json = JSON.parse(raw); bindingsStore = { bindings: Array.isArray(json.bindings) ? json.bindings : [] }; } catch { bindingsStore = { bindings: [] }; } }
async function saveBindings() { await mkdir(dirname(bindingsPath), { recursive: true }); await writeFile(bindingsPath, `${JSON.stringify(bindingsStore, null, 2)}\n`); }
function findBindingForSession(session) { const key = documentKeyFor(session); return bindingsStore.bindings.find((b) => b.documentKey === key) || null; }
function upsertBinding(session, inputBinding) {
  const binding = normalizeBinding(inputBinding);
  if (!binding) return clearBinding(session);
  const now = nowIso();
  const previous = findBindingForSession(session);
  const next = { ...previous, ...binding, bindingId: previous?.bindingId || binding.bindingId || randomUUID(), documentKey: documentKeyFor(session), host: session.host, documentName: session.documentName, documentIdentity: session.documentIdentity || null, createdAt: previous?.createdAt || now, updatedAt: now };
  const idx = bindingsStore.bindings.findIndex((b) => b.documentKey === next.documentKey || b.bindingId === next.bindingId);
  if (idx >= 0) bindingsStore.bindings[idx] = next; else bindingsStore.bindings.push(next);
  session.binding = next;
  return next;
}
function clearBinding(session) { const key = documentKeyFor(session); const before = bindingsStore.bindings.length; bindingsStore.bindings = bindingsStore.bindings.filter((b) => b.documentKey !== key && b.bindingId !== session.binding?.bindingId); session.binding = null; return before !== bindingsStore.bindings.length; }
async function loadCatalog() { try { const raw = await readFile(catalogPath, "utf8"); const json = JSON.parse(raw); return { projects: Array.isArray(json.projects) ? json.projects : [], threads: Array.isArray(json.threads) ? json.threads : [], updatedAt: json.updatedAt || "", source: json.source || "" }; } catch { return { projects: [], threads: [], updatedAt: "", source: "" }; } }
async function refreshCatalog() {
  const script = join(process.cwd(), "scripts/sync-codex-catalog.js");
  await execFileAsync(process.execPath, [script, "--output", catalogPath], { env: { ...process.env, WPS_CONNECTOR_CATALOG_PATH: catalogPath }, maxBuffer: 1024 * 1024 * 20 });
  return loadCatalog();
}
function pruneOfflineSessions() { const cutoff = Date.now() - 30000; for (const session of sessions.values()) { if (Date.parse(session.lastSeenAt || session.registeredAt) < cutoff) session.status = "offline"; } }
function sessionDocumentFlags(session) {
  const identity = session.documentIdentity || {};
  const fullPath = String(identity.fullPath || identity.url || session.documentKey || "").trim();
  const documentName = String(session.documentName || identity.name || "").trim();
  return { emptyDocumentName: !documentName, emptyDocumentPath: !fullPath, documentPath: fullPath };
}
function publicSession(session) { const flags = sessionDocumentFlags(session); return { sessionId: session.sessionId, host: session.host, documentName: session.documentName, documentKey: session.documentKey, documentIdentity: session.documentIdentity || null, status: session.status, registeredAt: session.registeredAt, lastSeenAt: session.lastSeenAt, activeContext: session.activeContext, operationScope: session.operationScope || { mode: "document" }, capabilities: session.capabilities, clientVersion: session.clientVersion || "", clientBuild: session.clientBuild || "", binding: session.binding, ...flags }; }
function sessionSortScore(session, requested) {
  let score = 0;
  if (requested && bindingMatches(session, requested)) score += 1000;
  if (session.status === "online") score += 100;
  const flags = sessionDocumentFlags(session);
  if (!flags.emptyDocumentPath) score += 20;
  if (!flags.emptyDocumentName) score += 10;
  if (session.binding) score += 5;
  return score;
}
function listSessions(input = {}) {
  pruneOfflineSessions();
  const requested = requestedBinding(input);
  let items = [...sessions.values()];
  if (input.onlyOnline) items = items.filter((session) => session.status === "online");
  if (input.onlyBound) items = items.filter((session) => Boolean(session.binding));
  if (input.host) { const host = normalizeHost(input.host); items = items.filter((session) => String(session.host || "").startsWith(host)); }
  items.sort((a, b) => sessionSortScore(b, requested) - sessionSortScore(a, requested) || Date.parse(b.lastSeenAt || 0) - Date.parse(a.lastSeenAt || 0));
  return items.map(publicSession);
}
function selectSession(input = {}, expectedHostPrefix, toolName = "tool") {
  const requested = requestedBinding(input);
  if (input.sessionId) {
    const session = sessions.get(input.sessionId);
    if (session && requested && !bindingMatches(session, requested)) {
      throw { code: "SESSION_BINDING_MISMATCH", message: "Session " + session.sessionId + " is not bound to the requested Codex project/thread.", details: { sessionId: session.sessionId, requestedBinding: requested, actualBinding: session.binding || null, aliases: ["BINDING_MISMATCH"] } };
    }
    return session;
  }
  pruneOfflineSessions();
  const candidates = [...sessions.values()]
    .filter((s) => s.status === "online")
    .filter((s) => !expectedHostPrefix || String(s.host || "").startsWith(expectedHostPrefix));
  const matches = requested ? candidates.filter((session) => bindingMatches(session, requested)) : candidates;
  if (requested && !matches.length) {
    throw { code: "SESSION_BINDING_REQUIRED", message: "No online WPS session is bound to the requested Codex project/thread for " + toolName + ".", details: { requestedBinding: requested, candidateCount: candidates.length, candidates: candidates.map((session) => ({ sessionId: session.sessionId, host: session.host, documentName: session.documentName, binding: session.binding || null })) } };
  }
  return matches.sort((a, b) => Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt))[0];
}
function assertSessionHost(session, expectedHostPrefix, toolName) {
  if (!expectedHostPrefix || String(session.host || "").startsWith(expectedHostPrefix)) return;
  throw { code: "SESSION_HOST_MISMATCH", message: `${toolName} requires a ${expectedHostPrefix} session, but ${session.sessionId} is ${session.host}.`, details: { sessionId: session.sessionId, expectedHost: expectedHostPrefix, actualHost: session.host } };
}
function commandInputWithScope(session, toolName, input = {}) {
  const scope = session.operationScope?.mode === "selection" ? session.operationScope : { mode: "document" };
  const next = { ...input, operationScope: scope };
  if (scope.mode !== "selection") return next;
  const context = scope.context || {};
  if (toolName.startsWith("et.")) {
    if (!next.address && context.address) next.address = context.address;
    if (!next.sheetName && context.sheetName) next.sheetName = context.sheetName;
  }
  if (toolName.startsWith("wpp.")) {
    if (next.start === undefined && Number.isFinite(Number(context.start))) next.start = Number(context.start);
    if (next.end === undefined && Number.isFinite(Number(context.end))) next.end = Number(context.end);
  }
  return next;
}
function enqueueCommand(session, toolName, input) { const commandId = randomUUID(); const command = { commandId, sessionId: session.sessionId, toolName, input: commandInputWithScope(session, toolName, input), status: "queued", createdAt: nowIso() }; commands.set(commandId, command); session.queue.push(commandId); return command; }
function waitForCommand(command) { return new Promise((resolve, reject) => { const timer = setTimeout(() => { command.status = "timed_out"; command.timedOutAt = nowIso(); command.error = { code: "COMMAND_TIMEOUT", message: `Command timed out after ${commandTimeoutMs}ms.` }; reject(command.error); }, commandTimeoutMs); command.resolve = (result) => { clearTimeout(timer); resolve(result); }; command.reject = (error) => { clearTimeout(timer); reject(error); }; }); }
async function probeJson(url) {
  const started = Date.now();
  try {
    const response = await fetch(url);
    const text = await response.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch {}
    return { ok: response.ok, httpStatus: response.status, latencyMs: Date.now() - started, body: json || text.slice(0, 500) };
  } catch (error) {
    return { ok: false, latencyMs: Date.now() - started, error: { code: "PROBE_FAILED", message: error.message } };
  }
}
function summarizeSessionForAgent(session) {
  return {
    sessionId: session.sessionId,
    host: session.host,
    status: session.status,
    documentName: session.documentName,
    documentKey: session.documentKey,
    clientVersion: session.clientVersion || "",
    clientBuild: session.clientBuild || "",
    bound: Boolean(session.binding),
    binding: session.binding || null,
    operationScope: session.operationScope || { mode: "document" },
    emptyDocumentName: Boolean(session.emptyDocumentName),
    emptyDocumentPath: Boolean(session.emptyDocumentPath),
    lastSeenAt: session.lastSeenAt
  };
}
async function connectionStatus(input = {}) {
  pruneOfflineSessions();
  const { host: _hostFilter, sessionId: _sessionFilter, onlyOnline: _onlyOnline, onlyBound: _onlyBound, ...bindingInput } = input;
  const requested = requestedBinding(bindingInput);
  const sessionsList = listSessions({ ...input, onlyOnline: input.onlyOnline ?? false });
  const filtered = sessionsList.map(summarizeSessionForAgent);
  const candidates = filtered.filter((session) => {
    if (input.sessionId && session.sessionId !== input.sessionId) return false;
    if (input.host && !String(session.host || "").startsWith(normalizeHost(input.host))) return false;
    if (input.onlyOnline && session.status !== "online") return false;
    if (input.onlyBound && !session.bound) return false;
    if (requested && !bindingMatches(session, requested)) return false;
    return true;
  });
  const online = filtered.filter((session) => session.status === "online");
  const onlineBound = online.filter((session) => session.bound);
  const recommended = candidates.find((session) => session.status === "online" && (!input.onlyBound || session.bound)) || null;
  const issues = [];
  if (!online.length) issues.push({ code: "NO_ONLINE_SESSIONS", message: "No online WPS sessions are registered. Open or refresh the WPS Connector pane in Writer/Spreadsheet." });
  if (input.host && !online.some((session) => String(session.host || "").startsWith(normalizeHost(input.host)))) issues.push({ code: "NO_ONLINE_HOST_SESSION", message: "No online session matches the requested host.", details: { host: input.host } });
  if (requested && !onlineBound.some((session) => bindingMatches(session, requested))) issues.push({ code: "NO_BOUND_SESSION", message: "No online session is bound to the requested Codex project/thread.", details: { requestedBinding: requested } });
  if (input.sessionId && !filtered.some((session) => session.sessionId === input.sessionId)) issues.push({ code: "SESSION_NOT_FOUND", message: "The requested sessionId is not registered.", details: { sessionId: input.sessionId } });
  if (input.sessionId) {
    const exact = filtered.find((session) => session.sessionId === input.sessionId);
    if (exact && exact.status !== "online") issues.push({ code: "SESSION_OFFLINE", message: "The requested session is registered but offline.", details: { sessionId: input.sessionId, lastSeenAt: exact.lastSeenAt } });
    if (exact && requested && !bindingMatches(exact, requested)) issues.push({ code: "SESSION_BINDING_MISMATCH", message: "The requested session is bound to a different Codex project/thread.", details: { sessionId: input.sessionId, requestedBinding: requested, actualBinding: exact.binding } });
  }
  const nextActions = [];
  if (!issues.length && recommended) nextActions.push("Use recommendedSession.sessionId for tool calls, or pass the same binding selector to let the bridge route automatically.");
  if (issues.some((issue) => issue.code === "NO_ONLINE_SESSIONS" || issue.code === "SESSION_OFFLINE" || issue.code === "NO_ONLINE_HOST_SESSION")) nextActions.push("Open WPS, show the WPS Connector pane, and confirm the pane version is current before retrying.");
  if (issues.some((issue) => issue.code === "NO_BOUND_SESSION" || issue.code === "SESSION_BINDING_MISMATCH")) nextActions.push("Save the project/thread binding in the WPS Connector pane for the target document, then retry with the same binding selector.");
  const bridgeHealth = { ok: true, url: `http://${host}:${port}/api/health`, time: nowIso() };
  const addinHealth = await probeJson(`${addinUrl}/health`);
  return {
    ok: issues.length === 0,
    bridge: bridgeHealth,
    addin: { url: `${addinUrl}/health`, ...addinHealth },
    requestedBinding: requested,
    filters: { onlyOnline: Boolean(input.onlyOnline), onlyBound: Boolean(input.onlyBound), host: input.host || "", sessionId: input.sessionId || "" },
    counts: { total: filtered.length, online: online.length, onlineBound: onlineBound.length, matched: candidates.length },
    recommendedSession: recommended,
    sessions: (candidates.length ? candidates : filtered).slice(0, 20),
    truncated: (candidates.length ? candidates : filtered).length > 20,
    issues,
    nextActions,
    agentUsage: {
      recommendedFirstCall: "wps.connection_status",
      listTools: ["wps.list_sessions", "wps.connection_status", "wpp.read_document_identity", "et.read_selection"],
      dottedAndUnderscoreNamesSupported: true,
      bindingSelectorFields: selectorBindingKeys
    }
  };
}
async function runTool(toolName, input) {
  if (toolName === "wps.list_sessions") return { sessions: listSessions(input) };
  if (toolName === "wps.connection_status") return connectionStatus(input);
  const expectedHost = toolName.startsWith("et.") ? "et" : toolName.startsWith("wpp.") ? "wpp" : "";
  const session = selectSession(input, expectedHost, toolName);
  if (!session) throw { code: "SESSION_NOT_FOUND", message: `No online WPS session found for ${toolName}.` };
  assertSessionHost(session, expectedHost, toolName);
  pruneOfflineSessions();
  if (session.status !== "online") throw { code: "SESSION_OFFLINE", message: `Session ${session.sessionId} is offline. Reopen the WPS Connector pane for this document.`, details: { sessionId: session.sessionId, toolName, requestedArgs: input, lastSeenAt: session.lastSeenAt, documentName: session.documentName, documentKey: session.documentKey } };
  const command = enqueueCommand(session, toolName, input);
  const result = await waitForCommand(command);
  return { commandId: command.commandId, sessionId: session.sessionId, ...result };
}
async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || `${host}:${port}`}`);
  const pathname = url.pathname;
  if (req.method === "OPTIONS") return sendJson(res, 200, { ok: true });
  try {
    if (req.method === "GET" && pathname === "/api/health") return sendJson(res, 200, { ok: true, name: "wps-connector", time: nowIso() });
    if (req.method === "GET" && pathname === "/api/tools/schema") return sendJson(res, 200, { ok: true, tools });
    if (req.method === "POST" && pathname === "/api/catalog/refresh") { const catalog = await refreshCatalog(); return sendJson(res, 200, { ok: true, projects: catalog.projects, threads: catalog.threads, updatedAt: catalog.updatedAt, source: catalog.source }); }
    if (req.method === "GET" && pathname === "/api/catalog/projects") { const catalog = await loadCatalog(); return sendJson(res, 200, { ok: true, projects: catalog.projects, updatedAt: catalog.updatedAt, source: catalog.source }); }
    if (req.method === "GET" && pathname === "/api/catalog/threads") { const catalog = await loadCatalog(); return sendJson(res, 200, { ok: true, threads: catalog.threads, updatedAt: catalog.updatedAt, source: catalog.source }); }
    if (req.method === "GET" && pathname === "/api/sessions") { pruneOfflineSessions(); return sendJson(res, 200, { ok: true, sessions: [...sessions.values()].map(publicSession) }); }
    if (req.method === "POST" && pathname === "/api/sessions/register") {
      const body = await readJson(req);
      const sessionId = body.sessionId || randomUUID();
      const previous = sessions.get(sessionId);
      const session = { sessionId, host: normalizeHost(body.host), documentName: body.documentName || "", documentKey: normalizeText(body.documentKey) || "", documentIdentity: body.documentIdentity || null, status: "online", registeredAt: previous?.registeredAt || nowIso(), lastSeenAt: nowIso(), activeContext: body.activeContext || null, operationScope: previous?.operationScope || { mode: "document" }, capabilities: body.capabilities || [], clientVersion: body.clientVersion || previous?.clientVersion || "", clientBuild: body.clientBuild || previous?.clientBuild || "", queue: previous?.queue || [], binding: previous?.binding || null };
      if (!session.documentKey) session.documentKey = documentKeyFor(session);
      sessions.set(sessionId, session);
      session.binding = findBindingForSession(session) || null;
      return sendJson(res, 200, { ok: true, session: publicSession(session) });
    }
    const sessionBinding = /^\/api\/sessions\/([^/]+)\/binding$/.exec(pathname);
    if (sessionBinding && req.method === "GET") { const session = sessions.get(sessionBinding[1]); if (!session) return sendError(res, 404, "SESSION_NOT_FOUND", `Session not found: ${sessionBinding[1]}`); session.binding = findBindingForSession(session) || null; session.lastSeenAt = nowIso(); return sendJson(res, 200, { ok: true, session: publicSession(session), binding: session.binding }); }
    if (sessionBinding && req.method === "POST") { const session = sessions.get(sessionBinding[1]); if (!session) return sendError(res, 404, "SESSION_NOT_FOUND", `Session not found: ${sessionBinding[1]}`); const body = await readJson(req); if (body.documentIdentity || body.documentName || body.documentPath || body.host) { session.documentIdentity = body.documentIdentity || session.documentIdentity; session.documentName = body.documentName || session.documentName; session.host = normalizeHost(body.host || session.host); session.documentKey = documentKeyFor(session); } const binding = upsertBinding(session, body.binding || body); await saveBindings(); return sendJson(res, 200, { ok: true, session: publicSession(session), binding }); }
    const sessionScope = /^\/api\/sessions\/([^/]+)\/operation-scope$/.exec(pathname);
    if (sessionScope && req.method === "POST") { const session = sessions.get(sessionScope[1]); if (!session) return sendError(res, 404, "SESSION_NOT_FOUND", `Session not found: ${sessionScope[1]}`); const body = await readJson(req); const mode = body.mode === "selection" ? "selection" : "document"; session.operationScope = mode === "selection" ? { mode, confirmedAt: nowIso(), context: body.context || session.activeContext || {} } : { mode: "document", confirmedAt: nowIso() }; session.lastSeenAt = nowIso(); return sendJson(res, 200, { ok: true, session: publicSession(session), operationScope: session.operationScope }); }
    const heartbeat = /^\/api\/sessions\/([^/]+)\/heartbeat$/.exec(pathname);
    if (req.method === "POST" && heartbeat) { const session = sessions.get(heartbeat[1]); if (!session) return sendError(res, 404, "SESSION_NOT_FOUND", `Session not found: ${heartbeat[1]}`); const body = await readJson(req); session.status = "online"; session.lastSeenAt = nowIso(); session.activeContext = body.activeContext || session.activeContext; session.clientVersion = body.clientVersion || session.clientVersion || ""; session.clientBuild = body.clientBuild || session.clientBuild || ""; if (body.documentIdentity || body.documentName || body.documentPath || body.host) { session.documentIdentity = body.documentIdentity || session.documentIdentity; session.documentName = body.documentName || session.documentName; session.host = normalizeHost(body.host || session.host); session.documentKey = documentKeyFor(session); } session.binding = findBindingForSession(session) || session.binding || null; return sendJson(res, 200, { ok: true, session: publicSession(session) }); }
    const nextCommand = /^\/api\/sessions\/([^/]+)\/commands\/next$/.exec(pathname);
    if (req.method === "GET" && nextCommand) { const session = sessions.get(nextCommand[1]); if (!session) return sendError(res, 404, "SESSION_NOT_FOUND", `Session not found: ${nextCommand[1]}`); session.status = "online"; session.lastSeenAt = nowIso(); const commandId = session.queue.shift(); if (!commandId) return sendJson(res, 200, { ok: true, command: null }); const command = commands.get(commandId); command.status = "delivered"; command.deliveredAt = nowIso(); return sendJson(res, 200, { ok: true, command: { commandId, toolName: command.toolName, input: command.input } }); }
    const commandResult = /^\/api\/commands\/([^/]+)\/result$/.exec(pathname);
    if (req.method === "POST" && commandResult) { const command = commands.get(commandResult[1]); if (!command) return sendError(res, 404, "COMMAND_NOT_FOUND", `Command not found: ${commandResult[1]}`); const body = await readJson(req); command.completedAt = nowIso(); if (body.ok === false) { command.status = "failed"; command.error = body.error || { code: "COMMAND_FAILED", message: "Command failed." }; command.reject?.(command.error); } else { command.status = "completed"; command.result = body.result || {}; command.resolve?.(command.result); } return sendJson(res, 200, { ok: true, commandId: command.commandId, status: command.status }); }
    const toolCall = /^\/api\/tools\/([^/]+)\/([^/]+)$/.exec(pathname);
    if (req.method === "POST" && toolCall) { const toolName = `${toolCall[1]}.${toolCall[2]}`; if (!tools.some((tool) => tool.name === toolName)) return sendError(res, 404, "TOOL_NOT_FOUND", `Unknown tool: ${toolName}`); const input = await readJson(req); try { const result = await runTool(toolName, input); return sendJson(res, 200, { ok: true, ...result }); } catch (error) { return sendError(res, statusForError(error), error.code || "TOOL_FAILED", error.message || String(error), error.details || {}); } }
    return sendError(res, 404, "NOT_FOUND", `Route not found: ${req.method} ${pathname}`);
  } catch (error) { return sendError(res, 500, "INTERNAL_ERROR", error.message || String(error)); }
}
await loadBindings();
createServer(handle).listen(port, host, () => { console.error(`wps-connector bridge listening on http://${host}:${port}`); });
