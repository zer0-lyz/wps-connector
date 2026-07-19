import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { promisify } from "node:util";
import { tools } from "../shared/toolSchemas.js";
import { CodexAgentClient } from "./codexAgent.js";
import { connectorPlatformStatus, startConnectorPlatformHeartbeat } from "./connectorPlatform.js";

const host = process.env.WPS_CONNECTOR_HOST || "127.0.0.1";
const port = Number(process.env.WPS_CONNECTOR_PORT || 40215);
const commandTimeoutMs = Number(process.env.WPS_CONNECTOR_COMMAND_TIMEOUT_MS || 60000);
const sessionOfflineMs = Number(process.env.WPS_CONNECTOR_SESSION_OFFLINE_MS || 30000);
const sessionRetainOfflineMs = Number(process.env.WPS_CONNECTOR_SESSION_RETAIN_OFFLINE_MS || 300000);
const maxOfflineSessions = Number(process.env.WPS_CONNECTOR_MAX_OFFLINE_SESSIONS || 200);
const addinUrl = (process.env.WPS_CONNECTOR_ADDIN_URL || "http://127.0.0.1:3891").replace(/\/$/, "");
const runtimeRoot = process.env.WPS_CONNECTOR_RUNTIME_ROOT || join(homedir(), ".local/share/wps-connector/runtime");
const catalogPath = process.env.WPS_CONNECTOR_CATALOG_PATH || join(runtimeRoot, "codex-catalog.snapshot.json");
const bindingsPath = process.env.WPS_CONNECTOR_BINDINGS_PATH || join(runtimeRoot, "project-bindings.local.json");
const updateCheckUrl = process.env.WPS_CONNECTOR_UPDATE_CHECK_URL || "https://raw.githubusercontent.com/zer0-lyz/wps-connector/main/apps/wps-addin/main.js";
const updateCheckFallbackUrl = process.env.WPS_CONNECTOR_UPDATE_CHECK_FALLBACK_URL || "https://cdn.jsdelivr.net/gh/zer0-lyz/wps-connector@main/apps/wps-addin/main.js";
const sourceRoot = process.env.WPS_CONNECTOR_SOURCE_ROOT || join(homedir(), ".local/share/wps-connector/source");
const sessions = new Map();
const commands = new Map();
const paneViews = new Map();
const paneSignals = new Map();
const execFileAsync = promisify(execFile);
let bindingsStore = { bindings: [] };
let updateCheckCache = null;
const codexAgent = new CodexAgentClient();
let desktopSyncCache = { checkedAt: 0, value: null };
codexAgent.on("log", (message) => {
  const text = String(message || "").trim();
  if (text) console.error(`[codex-agent] ${text}`);
});

function nowIso() { return new Date().toISOString(); }
function sendJson(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "content-type" });
  res.end(JSON.stringify(payload, null, 2));
}
function sendError(res, status, code, message, details = {}) { sendJson(res, status, { ok: false, error: { code, message, details } }); }
function statusForError(error) {
  const code = String(error?.code || "");
  if (code === "AGENT_ORIGIN_REFUSED") return 403;
  if (code === "SESSION_HOST_MISMATCH" || code === "SESSION_BINDING_MISMATCH" || code === "BINDING_MISMATCH" || code === "SESSION_BINDING_REQUIRED" || code === "PROJECT_BINDING_REQUIRED" || code === "SESSION_OFFLINE" || code === "SESSION_WAITING_FOR_DOCUMENT" || code === "AMBIGUOUS_SESSION" || code === "AGENT_THREAD_BINDING_REQUIRED" || code === "AGENT_TURN_ACTIVE" || code === "AGENT_DESKTOP_SYNC_REQUIRED" || code.endsWith("_REFUSED")) return 409;
  if (code === "INVALID_ARGUMENT" || code === "INVALID_ADDRESS") return 400;
  if (code.endsWith("_NOT_FOUND") || code === "AGENT_TURN_NOT_FOUND") return 404;
  if (code === "HOST_UNSUPPORTED") return 501;
  if (code === "COMMAND_TIMEOUT") return 504;
  return 500;
}
async function readJson(req) { let body = ""; for await (const chunk of req) body += chunk; if (!body.trim()) return {}; return JSON.parse(body); }
function normalizeHost(value) { const text = String(value || "").toLowerCase(); if (text.includes("spreadsheet") || text.includes("et") || text.includes("excel")) return "et"; if (text.includes("writer") || text.includes("wpp") || text.includes("word")) return "wpp"; return value || "wps"; }
function normalizeText(value) { return String(value || "").trim(); }
function canonicalDocumentKey(value) {
  const text = normalizeText(value);
  return /^(et|wpp)::\//.test(text) ? text.replace(/^(et|wpp)::/, "") : text;
}
function queryBool(value, fallback = false) { if (value === undefined || value === null || value === "") return fallback; return /^(1|true|yes|on)$/i.test(String(value)); }
function documentKeyFor(session) { return session.documentKey || session.documentIdentity?.fullPath || session.documentIdentity?.url || session.documentName || session.sessionId; }
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
function hasProjectBinding(binding) { return Boolean(binding?.projectId || binding?.projectPath || binding?.projectName); }
function hasProjectSelector(binding) { return Boolean(binding?.bindingId || binding?.projectId || binding?.projectPath || binding?.projectName); }
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
  if (!hasProjectBinding(session.binding) || !hasProjectSelector(requested)) return false;
  return Object.entries(requested).every(([key, value]) => {
    const actual = String(session.binding?.[key] ?? "");
    if (key === "threadId" || key === "conversationId") {
      if (value) return !actual || actual === String(value);
      return !actual;
    }
    return actual === String(value);
  });
}
async function loadBindings() { try { const raw = await readFile(bindingsPath, "utf8"); const json = JSON.parse(raw); bindingsStore = { bindings: Array.isArray(json.bindings) ? json.bindings : [] }; } catch { bindingsStore = { bindings: [] }; } }
async function saveBindings() { await mkdir(dirname(bindingsPath), { recursive: true }); await writeFile(bindingsPath, `${JSON.stringify(bindingsStore, null, 2)}\n`); }
function findBindingForSession(session) {
  const key = canonicalDocumentKey(documentKeyFor(session));
  return bindingsStore.bindings.find((binding) => canonicalDocumentKey(binding.documentKey) === key) || null;
}
function upsertBinding(session, inputBinding) {
  const binding = normalizeBinding(inputBinding);
  if (!binding) return clearBinding(session);
  if (!hasProjectBinding(binding)) throw { code: "PROJECT_BINDING_REQUIRED", message: "至少需要选择一个 Codex 项目后才能保存绑定。", details: { sessionId: session.sessionId, required: ["projectId", "projectPath", "projectName"] } };
  const now = nowIso();
  const previous = findBindingForSession(session);
  const documentKey = documentKeyFor(session);
  const requestedBindingId = binding.bindingId || "";
  const requestedIdBelongsToAnotherDocument = requestedBindingId && bindingsStore.bindings.some((item) => item.bindingId === requestedBindingId && canonicalDocumentKey(item.documentKey) !== canonicalDocumentKey(documentKey));
  const bindingId = previous?.bindingId || (!requestedIdBelongsToAnotherDocument && requestedBindingId) || randomUUID();
  const next = { ...previous, ...binding, bindingId, documentKey, host: session.host, documentName: session.documentName, documentIdentity: session.documentIdentity || null, createdAt: previous?.createdAt || now, updatedAt: now };
  const idx = bindingsStore.bindings.findIndex((binding) => canonicalDocumentKey(binding.documentKey) === canonicalDocumentKey(next.documentKey));
  if (idx >= 0) bindingsStore.bindings[idx] = next; else bindingsStore.bindings.push(next);
  session.binding = next;
  return next;
}
function clearBinding(session) { const key = canonicalDocumentKey(documentKeyFor(session)); const before = bindingsStore.bindings.length; bindingsStore.bindings = bindingsStore.bindings.filter((binding) => canonicalDocumentKey(binding.documentKey) !== key && binding.bindingId !== session.binding?.bindingId); session.binding = null; return before !== bindingsStore.bindings.length; }
function agentBindingForSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) throw { code: "SESSION_NOT_FOUND", message: `Session not found: ${sessionId}` };
  session.binding = findBindingForSession(session) || session.binding || null;
  if (!session.binding?.threadId) throw { code: "AGENT_THREAD_BINDING_REQUIRED", message: "当前 WPS 文档尚未绑定 Codex 对话。", details: { sessionId, documentName: session.documentName } };
  return { session, binding: session.binding };
}
function setPaneView(sessionId, view) {
  const session = sessions.get(sessionId);
  if (!session) throw { code: "SESSION_NOT_FOUND", message: `Session not found: ${sessionId}` };
  const state = { view: view === "agent" ? "agent" : "connector", updatedAt: nowIso() };
  paneViews.set(sessionId, state);
  return state;
}

function paneKeyFromInput(input = {}) {
  return String(input.windowKey || input.window || input.sessionId || input.documentKey || "default");
}
function recordPaneSignal(input = {}, state = "alive") {
  const key = paneKeyFromInput(input);
  const previous = paneSignals.get(key) || {};
  const next = { ...previous, ...input, windowKey: key, state, updatedAt: nowIso() };
  paneSignals.set(key, next);
  return next;
}
function paneSignalState(input = {}) {
  const key = paneKeyFromInput(input);
  return paneSignals.get(key) || { windowKey: key, state: "unknown", updatedAt: "" };
}

function getPaneView(sessionId) {
  if (!sessions.has(sessionId)) throw { code: "SESSION_NOT_FOUND", message: `Session not found: ${sessionId}` };
  return paneViews.get(sessionId) || { view: "connector", updatedAt: "" };
}
function assertAgentOrigin(req) {
  const origin = String(req.headers.origin || "");
  if (!origin) return;
  const expected = new URL(addinUrl).origin;
  if (origin !== expected) throw { code: "AGENT_ORIGIN_REFUSED", message: "Agent 对话接口只允许 WPS Connector 面板访问。", details: { origin, expected } };
}

function hostLabelForAgent(host = "") {
  const value = String(host || "").toLowerCase();
  if (value === "wpp") return "WPS Writer";
  if (value === "et") return "WPS Spreadsheet";
  if (value === "wppresentation") return "WPS Presentation";
  return host || "WPS";
}
function contextLabelForAgent(session) {
  const c = session?.activeContext || {};
  if (c.error) return `读取失败：${c.error}`;
  if (session?.host === "et") {
    const size = c.rowCount && c.columnCount ? `${c.rowCount} 行 x ${c.columnCount} 列` : "";
    return [`Sheet: ${c.sheetName || ""}`.trim(), `Range: ${c.address || ""}`.trim(), size ? `Size: ${size}` : ""].filter((x) => !/:\s*$/.test(x) && x).join("; ") || "表格当前上下文未读取";
  }
  if (session?.host === "wpp") {
    if (Number(c.length) > 0) {
      const pos = Number.isFinite(Number(c.start)) && Number.isFinite(Number(c.end)) ? `位置 ${c.start}-${c.end}` : "";
      const preview = c.textPreview ? `；预览：${String(c.textPreview).slice(0, 120)}` : "";
      return [`WPS 文字已选择 ${c.length} 字`, pos].filter(Boolean).join(" / ") + preview;
    }
    return "WPS 文字当前无选中文本 / 插入点位置";
  }
  return JSON.stringify(c || {});
}
function operationScopeLabelForAgent(session) {
  const scope = session?.operationScope || {};
  if (scope.mode === "selection") return "已确认选区：本轮工具操作必须限定在已确认选区内。";
  return "未确认选区：默认按用户指令全局操作；若用户说当前选区，则使用下面 Current context。";
}
function buildAgentPrompt(session, binding, userText) {
  const cleanText = String(userText || "").trim();
  const lines = [
    "【WPS Connector 来源元数据】",
    `Host: ${hostLabelForAgent(session?.host)}`,
    `Document: ${session?.documentName || ""}`,
    `SessionId: ${session?.sessionId || ""}`,
    `DocumentKey: ${session?.documentKey || binding?.documentKey || ""}`,
    `BindingId: ${binding?.bindingId || ""}`,
    `ThreadId: ${binding?.threadId || ""}`,
    `Project: ${binding?.projectName || binding?.projectId || ""}`,
    `Current context: ${contextLabelForAgent(session)}`,
    `Operation scope: ${operationScopeLabelForAgent(session)}`,
    "",
    "路由规则：本轮需求来自上述 Host/SessionId。处理 WPS Writer/Spreadsheet/Presentation 工具调用时，必须优先使用该 SessionId、bindingId 和 documentKey；不要因为同一对话里还有 Office 或其他 WPS session 在线就改用 recommended session。",
    "",
    "【用户需求】",
    cleanText,
  ];
  return lines.join("\n");
}

async function desktopSyncStatus() {
  const transport = codexAgent.getTransportStatus();
  if (!transport.desktopSyncRequired) return { ...transport, ready: true, desktopRunning: false, privateAppServerActive: false, restartRequired: false };
  if (desktopSyncCache.value && Date.now() - desktopSyncCache.checkedAt < 1500) return { ...transport, ...desktopSyncCache.value };
  let commands = "";
  let launchSetting = "";
  try {
    const [{ stdout: psOutput }, { stdout: launchOutput }] = await Promise.all([
      execFileAsync("/bin/ps", ["-ax", "-o", "command="], { timeout: 2500 }),
      execFileAsync("/bin/launchctl", ["getenv", "CODEX_APP_SERVER_USE_LOCAL_DAEMON"], { timeout: 2500 }).catch(() => ({ stdout: "" })),
    ]);
    commands = psOutput;
    launchSetting = String(launchOutput || "").trim();
  } catch {}
  const lines = commands.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const desktopRunning = lines.some((line) => line === "/Applications/ChatGPT.app/Contents/MacOS/ChatGPT" || line.includes("/Applications/ChatGPT.app/Contents/MacOS/ChatGPT "));
  const privateAppServerActive = lines.some((line) => line.includes("/Applications/ChatGPT.app/Contents/Resources/codex") && line.includes(" app-server") && line.includes("--analytics-default-enabled") && !line.includes("--listen"));
  const value = {
    ready: desktopRunning && !privateAppServerActive && transport.connected,
    desktopRunning,
    privateAppServerActive,
    launchSettingEnabled: launchSetting === "1",
    restartRequired: desktopRunning && privateAppServerActive,
  };
  desktopSyncCache = { checkedAt: Date.now(), value };
  return { ...transport, ...value };
}
async function assertAgentSyncReady() {
  const sync = await desktopSyncStatus();
  if (!sync.ready && sync.desktopSyncRequired && process.env.WPS_CONNECTOR_AGENT_ALLOW_UNSYNCED !== "1") {
    throw {
      code: "AGENT_DESKTOP_SYNC_REQUIRED",
      message: sync.restartRequired ? "Codex Desktop 仍在使用旧的独立会话通道。请重启 Codex Desktop 后再发送。" : "Codex Desktop 尚未连接共享会话通道。请先启动或重启 Codex Desktop。",
      details: sync,
    };
  }
  return sync;
}
async function loadCatalog() { try { const raw = await readFile(catalogPath, "utf8"); const json = JSON.parse(raw); return { projects: Array.isArray(json.projects) ? json.projects : [], threads: Array.isArray(json.threads) ? json.threads : [], updatedAt: json.updatedAt || "", source: json.source || "" }; } catch { return { projects: [], threads: [], updatedAt: "", source: "" }; } }
async function refreshCatalog() {
  const script = join(process.cwd(), "scripts/sync-codex-catalog.js");
  await execFileAsync(process.execPath, [script, "--output", catalogPath], { env: { ...process.env, WPS_CONNECTOR_CATALOG_PATH: catalogPath }, maxBuffer: 1024 * 1024 * 20 });
  return loadCatalog();
}
function parseConnectorVersion(source = "") {
  const version = /WPS_CONNECTOR_CLIENT_VERSION\s*=\s*"([^"]+)"/.exec(source)?.[1] || "";
  const build = /WPS_CONNECTOR_CLIENT_BUILD\s*=\s*"([^"]+)"/.exec(source)?.[1] || "";
  return { version, build };
}
function compareVersions(a = "", b = "") {
  const left = String(a).split(".").map((n) => Number(n) || 0);
  const right = String(b).split(".").map((n) => Number(n) || 0);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    if ((left[i] || 0) > (right[i] || 0)) return 1;
    if ((left[i] || 0) < (right[i] || 0)) return -1;
  }
  return 0;
}
async function fetchUpdateSource(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } catch (error) {
    const aborted = error?.name === "AbortError" || /aborted/i.test(String(error?.message || error));
    throw new Error(aborted ? "远程检查超时" : (error.message || String(error)));
  } finally {
    clearTimeout(timer);
  }
}
async function checkForUpdates(input = {}) {
  const cacheMs = Number(process.env.WPS_CONNECTOR_UPDATE_CHECK_CACHE_MS || 300000);
  if (!queryBool(input.refresh, false) && updateCheckCache && Date.now() - updateCheckCache.checkedAtMs < cacheMs) return updateCheckCache.payload;
  const localPath = join(process.cwd(), "apps/wps-addin/main.js");
  const localSource = await readFile(localPath, "utf8");
  const current = parseConnectorVersion(localSource);
  const payload = { current, latest: null, updateAvailable: false, versionState: "unknown", checkedAt: nowIso(), source: { localPath, updateCheckUrl, updateCheckFallbackUrl } };
  if (!queryBool(input.skipRemote, false)) {
    const timeoutMs = Number(process.env.WPS_CONNECTOR_UPDATE_CHECK_TIMEOUT_MS || 30000);
    const urls = [updateCheckUrl, updateCheckFallbackUrl].filter(Boolean);
    const failures = [];
    for (const url of urls) {
      try {
        payload.latest = parseConnectorVersion(await fetchUpdateSource(url, timeoutMs));
        payload.source.remoteUrl = url;
        const comparison = payload.latest.version ? compareVersions(current.version, payload.latest.version) : 0;
        payload.versionState = comparison < 0 ? "update_available" : comparison > 0 ? "local_ahead" : "up_to_date";
        payload.updateAvailable = payload.versionState === "update_available";
        payload.warning = null;
        break;
      } catch (error) {
        failures.push({ url, message: error.message || String(error) });
      }
    }
    if (!payload.latest?.version) {
      payload.versionState = "unknown";
      payload.warning = { code: "UPDATE_CHECK_FAILED", message: failures.map((item) => `${item.url}: ${item.message}`).join("; "), failures };
    }
  }
  updateCheckCache = { checkedAtMs: Date.now(), payload };
  return payload;
}
function applyUpdate() {
  const logPath = join(runtimeRoot, "logs/update-apply.log");
  const command = [
    `cd ${JSON.stringify(sourceRoot)}`,
    "git fetch origin main",
    "git pull --ff-only origin main",
    "npm run deploy",
    "npm run launchd:install"
  ].join(" && ");
  const child = spawn("/bin/zsh", ["-lc", `mkdir -p ${JSON.stringify(join(runtimeRoot, "logs"))}; (${command}) >> ${JSON.stringify(logPath)} 2>&1`], { detached: true, stdio: "ignore" });
  child.unref();
  return { started: true, sourceRoot, runtimeRoot, logPath, message: "更新安装已开始。文件和本地服务会更新，但当前 WPS 已加载的插件不会热替换；安装完成后请重启 WPS 使新版本生效。" };
}
function sessionLastSeenMs(session) { const value = Date.parse(session.lastSeenAt || session.registeredAt || 0); return Number.isFinite(value) ? value : 0; }
function pruneOfflineSessions() {
  const now = Date.now();
  const offline = [];
  for (const [sessionId, session] of sessions.entries()) {
    const age = now - sessionLastSeenMs(session);
    if (age > sessionRetainOfflineMs) {
      sessions.delete(sessionId);
      continue;
    }
    if (age > sessionOfflineMs) session.status = "offline";
    if (session.status !== "online") offline.push(session);
  }
  offline.sort((a, b) => sessionLastSeenMs(b) - sessionLastSeenMs(a));
  for (const session of offline.slice(Math.max(0, maxOfflineSessions))) sessions.delete(session.sessionId);
}
function sessionDocumentFlags(session) {
  const identity = session.documentIdentity || {};
  const fullPath = String(identity.fullPath || identity.url || session.documentKey || "").trim();
  const documentName = String(session.documentName || identity.name || "").trim();
  return { emptyDocumentName: !documentName, emptyDocumentPath: !fullPath, documentPath: fullPath };
}
function sessionAvailability(session) {
  if (session.status === "online") return { availability: "executable", executable: true, displayStatus: "当前可执行" };
  if (session.binding) return { availability: "waiting_for_document", executable: false, displayStatus: "等待切回绑定文档" };
  return { availability: "offline", executable: false, displayStatus: "离线" };
}
function publicSession(session) { const flags = sessionDocumentFlags(session); return { sessionId: session.sessionId, host: session.host, documentName: session.documentName, documentKey: session.documentKey, documentIdentity: session.documentIdentity || null, status: session.status, ...sessionAvailability(session), registeredAt: session.registeredAt, lastSeenAt: session.lastSeenAt, activeContext: session.activeContext, operationScope: session.operationScope || { mode: "document" }, capabilities: session.capabilities, clientVersion: session.clientVersion || "", clientBuild: session.clientBuild || "", binding: session.binding, ...flags }; }
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
  const includeOffline = queryBool(input.includeOffline, false);
  const onlyOnline = queryBool(input.onlyOnline, false);
  const sessionId = normalizeText(input.sessionId);
  const documentKey = normalizeText(input.documentKey);
  if (sessionId) items = items.filter((session) => session.sessionId === sessionId);
  if (documentKey) items = items.filter((session) => session.documentKey === documentKey);
  if (onlyOnline || (!includeOffline && !sessionId && !documentKey)) items = items.filter((session) => session.status === "online");
  if (input.onlyBound) items = items.filter((session) => Boolean(session.binding));
  if (input.host) { const host = normalizeHost(input.host); items = items.filter((session) => String(session.host || "").startsWith(host)); }
  items.sort((a, b) => sessionSortScore(b, requested) - sessionSortScore(a, requested) || Date.parse(b.lastSeenAt || 0) - Date.parse(a.lastSeenAt || 0));
  return items.map(publicSession);
}
function selectSession(input = {}, expectedHostPrefix, toolName = "tool") {
  const requested = requestedBinding(input);
  if (input.sessionId) {
    const session = sessions.get(input.sessionId);
    if (session && !session.binding) {
      throw { code: "PROJECT_BINDING_REQUIRED", message: "当前 WPS 文档尚未绑定 Codex 项目，不能执行 " + toolName + "。请先在 WPS Connector 面板保存项目绑定。", details: { sessionId: session.sessionId, documentName: session.documentName } };
    }
    if (session?.binding && !requested) {
      throw { code: "SESSION_BINDING_REQUIRED", message: "Session " + session.sessionId + " is bound to a Codex project/thread. Provide matching bindingId, projectId/threadId, or binding to use it.", details: { sessionId: session.sessionId, actualBinding: session.binding || null } };
    }
    if (session?.binding && requested && !hasProjectSelector(requested)) throw { code: "PROJECT_BINDING_REQUIRED", message: "请提供项目绑定信息（projectId、projectPath、projectName 或 bindingId）。", details: { sessionId: session.sessionId } };
    if (session && requested && !bindingMatches(session, requested)) {
      throw { code: "SESSION_BINDING_MISMATCH", message: "Session " + session.sessionId + " is not bound to the requested Codex project/thread.", details: { sessionId: session.sessionId, requestedBinding: requested, actualBinding: session.binding || null, aliases: ["BINDING_MISMATCH"] } };
    }
    return session;
  }
  pruneOfflineSessions();
  const candidates = [...sessions.values()]
    .filter((s) => s.status === "online")
    .filter((s) => !expectedHostPrefix || String(s.host || "").startsWith(expectedHostPrefix));
  if (!requested) throw { code: "PROJECT_BINDING_REQUIRED", message: "执行 " + toolName + " 前必须先绑定 Codex 项目。", details: { candidateCount: candidates.length, candidates: candidates.map((session) => ({ sessionId: session.sessionId, host: session.host, documentName: session.documentName })) } };
  if (!hasProjectSelector(requested)) throw { code: "PROJECT_BINDING_REQUIRED", message: "请提供项目绑定信息后再执行 " + toolName + ".", details: { requestedBinding: requested } };
  const matches = candidates.filter((session) => bindingMatches(session, requested));
  if (requested && !matches.length) {
    const waiting = [...sessions.values()].filter((session) => (!expectedHostPrefix || String(session.host || "").startsWith(expectedHostPrefix)) && bindingMatches(session, requested));
    if (waiting.length) {
      const latest = waiting.sort((a, b) => sessionLastSeenMs(b) - sessionLastSeenMs(a))[0];
      throw { code: "SESSION_WAITING_FOR_DOCUMENT", message: "The target document is bound but not currently executable. Switch back to the bound WPS document, then retry " + toolName + ".", details: { requestedBinding: requested, sessionId: latest.sessionId, documentName: latest.documentName, documentKey: latest.documentKey, lastSeenAt: latest.lastSeenAt, displayStatus: sessionAvailability(latest).displayStatus } };
    }
    throw { code: "SESSION_BINDING_REQUIRED", message: "No online WPS session is bound to the requested Codex project/thread for " + toolName + ".", details: { requestedBinding: requested, candidateCount: candidates.length, candidates: candidates.map((session) => ({ sessionId: session.sessionId, host: session.host, documentName: session.documentName, binding: session.binding || null })) } };
  }
  const explicitDocumentSelector = Boolean(input.documentKey || input.documentName || input.bindingId);
  if (matches.length > 1 && !explicitDocumentSelector) {
    throw {
      code: "AMBIGUOUS_SESSION",
      message: `${toolName} matched multiple online ${expectedHostPrefix || "WPS"} documents. Provide sessionId, documentKey, documentName, or bindingId.`,
      details: {
        requestedBinding: requested,
        candidates: matches.map((session) => ({
          sessionId: session.sessionId,
          host: session.host,
          documentName: session.documentName,
          documentKey: session.documentKey,
          binding: session.binding || null,
        })),
      },
    };
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
  next.__wpsConnectorTarget = {
    sessionId: session.sessionId,
    host: session.host,
    documentName: session.documentName,
    documentKey: session.documentKey,
    documentIdentity: session.documentIdentity || null,
  };
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
function toolExists(toolName) {
  return tools.some((tool) => tool.name === toolName);
}
function expectedHostForTool(toolName) {
  return toolName.startsWith("et.") ? "et" : toolName.startsWith("wpp.") ? "wpp" : "";
}
function batchOperationInput(batchInput = {}, operation = {}) {
  const inherited = {};
  for (const key of selectorBindingKeys) {
    if (Object.prototype.hasOwnProperty.call(batchInput, key)) inherited[key] = batchInput[key];
  }
  if (batchInput.binding) inherited.binding = batchInput.binding;
  return { ...inherited, ...(operation.input || {}), sessionId: operation.input?.sessionId || batchInput.sessionId };
}
async function runBatch(input = {}) {
  if (!Array.isArray(input.operations) || !input.operations.length) throw { code: "INVALID_ARGUMENT", message: "operations is required.", details: { field: "operations" } };
  const started = Date.now();
  const results = [];
  const stopOnError = input.stopOnError !== false;
  for (const [index, operation] of input.operations.entries()) {
    const operationId = operation.operationId || `op-${index + 1}`;
    const toolName = operation.tool;
    const opInput = batchOperationInput(input, operation);
    const stepStarted = Date.now();
    try {
      if (!toolName || toolName === "wps.batch") throw { code: "INVALID_ARGUMENT", message: "Nested or empty batch tool is not supported.", details: { operationId, tool: toolName } };
      if (!toolExists(toolName)) throw { code: "TOOL_NOT_FOUND", message: `Unknown tool: ${toolName}`, details: { operationId, tool: toolName } };
      if (input.dryRun) {
        const expectedHost = expectedHostForTool(toolName);
        if (expectedHost) {
          const session = selectSession(opInput, expectedHost, toolName);
          if (!session) throw { code: "SESSION_NOT_FOUND", message: `No online WPS session found for ${toolName}.` };
          assertSessionHost(session, expectedHost, toolName);
        }
        results.push({ operationId, index, tool: toolName, ok: true, dryRun: true, durationMs: Date.now() - stepStarted, wouldRun: true });
        continue;
      }
      const result = await runTool(toolName, opInput);
      results.push({ operationId, index, tool: toolName, ok: true, durationMs: Date.now() - stepStarted, result });
    } catch (error) {
      const step = { operationId, index, tool: toolName, ok: false, durationMs: Date.now() - stepStarted, error: { code: error.code || "TOOL_FAILED", message: error.message || String(error), details: error.details || {} } };
      results.push(step);
      if (stopOnError) break;
    }
  }
  const verification = [];
  if (!input.dryRun && Array.isArray(input.verifyAfter)) {
    for (const [index, operation] of input.verifyAfter.entries()) {
      const operationId = operation.operationId || `verify-${index + 1}`;
      const toolName = operation.tool;
      const stepStarted = Date.now();
      try {
        const result = await runTool(toolName, batchOperationInput(input, operation));
        verification.push({ operationId, index, tool: toolName, ok: true, durationMs: Date.now() - stepStarted, result });
      } catch (error) {
        verification.push({ operationId, index, tool: toolName, ok: false, durationMs: Date.now() - stepStarted, error: { code: error.code || "TOOL_FAILED", message: error.message || String(error), details: error.details || {} } });
      }
    }
  }
  let saveResult = null;
  if (!input.dryRun && input.saveAfter) {
    const firstTool = input.operations.find((operation) => operation.tool?.startsWith("wpp.") || operation.tool?.startsWith("et."))?.tool || "";
    const saveTool = firstTool.startsWith("wpp.") ? "wpp.save_document" : firstTool.startsWith("et.") ? "et.save_workbook" : "";
    if (saveTool) {
      try { saveResult = await runTool(saveTool, batchOperationInput(input, { input: { sessionId: input.sessionId } })); }
      catch (error) { saveResult = { ok: false, error: { code: error.code || "SAVE_FAILED", message: error.message || String(error), details: error.details || {} } }; }
    } else saveResult = { ok: false, warning: { code: "SAVE_UNSUPPORTED", message: "saveAfter is currently implemented for Writer and Spreadsheet sessions." } };
  }
  return { batch: true, ok: results.every((step) => step.ok) && verification.every((step) => step.ok) && (!saveResult || saveResult.ok !== false), operationCount: input.operations.length, completedCount: results.length, failedCount: results.filter((step) => !step.ok).length, dryRun: Boolean(input.dryRun), durationMs: Date.now() - started, results, verification, saveResult };
}
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
    lastSeenAt: session.lastSeenAt,
    availability: session.availability,
    executable: session.executable,
    displayStatus: session.displayStatus
  };
}
async function connectionStatus(input = {}) {
  pruneOfflineSessions();
  const { host: _hostFilter, sessionId: _sessionFilter, onlyOnline: _onlyOnline, onlyBound: _onlyBound, ...bindingInput } = input;
  const requested = requestedBinding(bindingInput);
  const sessionsList = listSessions({ ...input, includeOffline: input.includeOffline ?? true, onlyOnline: input.onlyOnline ?? false });
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
  const waitingBound = requested ? filtered.filter((session) => session.bound && bindingMatches(session, requested) && session.status !== "online") : [];
  const issues = [];
  if (!online.length) issues.push({ code: "NO_ONLINE_SESSIONS", message: "No online WPS sessions are registered. Open or refresh the WPS Connector pane in Writer/Spreadsheet." });
  if (input.host && !online.some((session) => String(session.host || "").startsWith(normalizeHost(input.host)))) issues.push({ code: "NO_ONLINE_HOST_SESSION", message: "No online session matches the requested host.", details: { host: input.host } });
  if (requested && !onlineBound.some((session) => bindingMatches(session, requested))) {
    if (waitingBound.length) issues.push({ code: "SESSION_WAITING_FOR_DOCUMENT", message: "The requested binding exists, but its WPS document is not currently executable. Switch back to the bound document.", details: { requestedBinding: requested, sessions: waitingBound.map((session) => ({ sessionId: session.sessionId, host: session.host, documentName: session.documentName, documentKey: session.documentKey, lastSeenAt: session.lastSeenAt, displayStatus: session.displayStatus })) } });
    else issues.push({ code: "NO_BOUND_SESSION", message: "No online session is bound to the requested Codex project/thread.", details: { requestedBinding: requested } });
  }
  if (input.host && candidates.filter((session) => session.status === "online").length > 1 && !input.sessionId && !input.documentKey && !input.documentName && !input.bindingId) {
    issues.push({
      code: "AMBIGUOUS_SESSION",
      message: `Multiple online ${normalizeHost(input.host)} documents match the current selector. Choose a sessionId or document identifier before executing.`,
      details: {
        candidates: candidates.filter((session) => session.status === "online").map((session) => ({
          sessionId: session.sessionId,
          host: session.host,
          documentName: session.documentName,
          documentKey: session.documentKey,
        })),
      },
    });
  }
  if (input.sessionId && !filtered.some((session) => session.sessionId === input.sessionId)) issues.push({ code: "SESSION_NOT_FOUND", message: "The requested sessionId is not registered.", details: { sessionId: input.sessionId } });
  if (input.sessionId) {
    const exact = filtered.find((session) => session.sessionId === input.sessionId);
    if (exact && exact.status !== "online") issues.push({ code: exact.bound ? "SESSION_WAITING_FOR_DOCUMENT" : "SESSION_OFFLINE", message: exact.bound ? "The requested session is bound but waiting for you to switch back to that WPS document." : "The requested session is registered but offline.", details: { sessionId: input.sessionId, lastSeenAt: exact.lastSeenAt, documentName: exact.documentName, displayStatus: exact.displayStatus } });
    if (exact && requested && !bindingMatches(exact, requested)) issues.push({ code: "SESSION_BINDING_MISMATCH", message: "The requested session is bound to a different Codex project/thread.", details: { sessionId: input.sessionId, requestedBinding: requested, actualBinding: exact.binding } });
  }
  const nextActions = [];
  if (!issues.length && recommended) nextActions.push("Use recommendedSession.sessionId for tool calls, or pass the same binding selector to let the bridge route automatically.");
  if (issues.some((issue) => issue.code === "SESSION_WAITING_FOR_DOCUMENT")) nextActions.push("Switch back to the bound WPS document shown in details, wait for it to become 当前可执行, then retry.");
  if (issues.some((issue) => issue.code === "NO_ONLINE_SESSIONS" || issue.code === "SESSION_OFFLINE" || issue.code === "NO_ONLINE_HOST_SESSION")) nextActions.push("Open WPS, show the WPS Connector pane, and confirm the pane version is current before retrying.");
  if (issues.some((issue) => issue.code === "NO_BOUND_SESSION" || issue.code === "SESSION_BINDING_MISMATCH")) nextActions.push("Save the project/thread binding in the WPS Connector pane for the target document, then retry with the same binding selector.");
  if (issues.some((issue) => issue.code === "AMBIGUOUS_SESSION")) nextActions.push("Use the sessionId from candidates for each spreadsheet, or pass documentKey/documentName; parallel calls with different sessionIds are supported.");
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
  if (toolName === "wps.batch") return runBatch(input);
  const expectedHost = expectedHostForTool(toolName);
  const session = selectSession(input, expectedHost, toolName);
  if (!session) throw { code: "SESSION_NOT_FOUND", message: `No online WPS session found for ${toolName}.` };
  assertSessionHost(session, expectedHost, toolName);
  pruneOfflineSessions();
  if (session.status !== "online") {
    const availability = sessionAvailability(session);
    if (session.binding) throw { code: "SESSION_WAITING_FOR_DOCUMENT", message: `Session ${session.sessionId} is bound but not currently executable. Switch back to ${session.documentName || "the bound WPS document"}, then retry.`, details: { sessionId: session.sessionId, toolName, requestedArgs: input, lastSeenAt: session.lastSeenAt, documentName: session.documentName, documentKey: session.documentKey, displayStatus: availability.displayStatus } };
    throw { code: "SESSION_OFFLINE", message: `Session ${session.sessionId} is offline. Reopen the WPS Connector pane for this document.`, details: { sessionId: session.sessionId, toolName, requestedArgs: input, lastSeenAt: session.lastSeenAt, documentName: session.documentName, documentKey: session.documentKey } };
  }
  const command = enqueueCommand(session, toolName, input);
  const result = await waitForCommand(command);
  return { commandId: command.commandId, sessionId: session.sessionId, ...result };
}
async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || `${host}:${port}`}`);
  const pathname = url.pathname;
  if (req.method === "OPTIONS") return sendJson(res, 200, { ok: true });
  try {
    if (req.method === "GET" && pathname === "/api/health") return sendJson(res, 200, { ok: true, name: "wps-connector", time: nowIso(), connectorPlatform: connectorPlatformStatus() });

    if (req.method === "POST" && pathname === "/api/panes/closed") { const body = await readJson(req); return sendJson(res, 200, { ok: true, pane: recordPaneSignal(body, "closed") }); }
    if (req.method === "POST" && pathname === "/api/panes/collapse") { const body = Object.fromEntries(url.searchParams.entries()); return sendJson(res, 200, { ok: true, pane: recordPaneSignal(body, "collapse") }); }
    if (req.method === "POST" && pathname === "/api/panes/alive") { const body = await readJson(req); return sendJson(res, 200, { ok: true, pane: recordPaneSignal(body, "alive") }); }
    if (req.method === "GET" && pathname === "/api/panes/state") { return sendJson(res, 200, { ok: true, pane: paneSignalState(Object.fromEntries(url.searchParams.entries())) }); }
    if (req.method === "GET" && pathname === "/api/update/check") { const result = await checkForUpdates(Object.fromEntries(url.searchParams.entries())); return sendJson(res, 200, { ok: true, ...result }); }
    if (req.method === "POST" && pathname === "/api/update/apply") { return sendJson(res, 202, { ok: true, ...applyUpdate() }); }
    if (req.method === "GET" && pathname === "/api/tools/schema") return sendJson(res, 200, { ok: true, tools });
    if (req.method === "POST" && pathname === "/api/catalog/refresh") { const catalog = await refreshCatalog(); return sendJson(res, 200, { ok: true, projects: catalog.projects, threads: catalog.threads, updatedAt: catalog.updatedAt, source: catalog.source }); }
    if (req.method === "GET" && pathname === "/api/catalog") { const catalog = await loadCatalog(); return sendJson(res, 200, { ok: true, projects: catalog.projects, threads: catalog.threads, updatedAt: catalog.updatedAt, source: catalog.source }); }
    if (req.method === "GET" && pathname === "/api/catalog/projects") { const catalog = await loadCatalog(); return sendJson(res, 200, { ok: true, projects: catalog.projects, updatedAt: catalog.updatedAt, source: catalog.source }); }
    if (req.method === "GET" && pathname === "/api/catalog/threads") { const catalog = await loadCatalog(); return sendJson(res, 200, { ok: true, threads: catalog.threads, updatedAt: catalog.updatedAt, source: catalog.source }); }
    const agentHistory = /^\/api\/agent\/([^/]+)\/history$/.exec(pathname);
    if (req.method === "GET" && agentHistory) {
      assertAgentOrigin(req);
      const { session, binding } = agentBindingForSession(agentHistory[1]);
      const result = await codexAgent.readThread(binding.threadId, Number(url.searchParams.get("limit") || 200));
      return sendJson(res, 200, { ok: true, sessionId: session.sessionId, documentName: session.documentName, binding, thread: { id: result.thread?.id || binding.threadId, name: result.thread?.name || binding.threadTitle || "" }, messages: result.messages, run: result.run, sync: await desktopSyncStatus() });
    }
    const agentMessage = /^\/api\/agent\/([^/]+)\/message$/.exec(pathname);
    if (req.method === "POST" && agentMessage) {
      assertAgentOrigin(req);
      const { session, binding } = agentBindingForSession(agentMessage[1]);
      const body = await readJson(req);
      const text = String(body.text || "").trim();
      if (!text) return sendError(res, 400, "AGENT_MESSAGE_REQUIRED", "请输入要发送给 Agent 的内容。");
      const sync = await assertAgentSyncReady();
      const prompt = buildAgentPrompt(session, binding, text);
      const run = await codexAgent.startTurn(binding.threadId, prompt, { cwd: binding.threadCwd || binding.projectPath || binding.projectId || "" });
      return sendJson(res, 202, { ok: true, sessionId: session.sessionId, documentName: session.documentName, threadId: binding.threadId, run, sync });
    }
    const agentStatus = /^\/api\/agent\/([^/]+)\/status$/.exec(pathname);
    if (req.method === "GET" && agentStatus) {
      assertAgentOrigin(req);
      const { session, binding } = agentBindingForSession(agentStatus[1]);
      return sendJson(res, 200, { ok: true, sessionId: session.sessionId, threadId: binding.threadId, run: codexAgent.getRun(binding.threadId), sync: await desktopSyncStatus() });
    }
    const agentInterrupt = /^\/api\/agent\/([^/]+)\/interrupt$/.exec(pathname);
    if (req.method === "POST" && agentInterrupt) {
      assertAgentOrigin(req);
      const { session, binding } = agentBindingForSession(agentInterrupt[1]);
      const run = await codexAgent.interrupt(binding.threadId);
      return sendJson(res, 200, { ok: true, sessionId: session.sessionId, threadId: binding.threadId, run });
    }
    if (req.method === "GET" && pathname === "/api/sessions") {
      const input = Object.fromEntries(url.searchParams.entries());
      const sessionsList = listSessions(input);
      return sendJson(res, 200, { ok: true, sessions: sessionsList, count: sessionsList.length, filters: { onlyOnline: queryBool(input.onlyOnline, false), includeOffline: queryBool(input.includeOffline, false), sessionId: input.sessionId || "", documentKey: input.documentKey || "", host: input.host || "" } });
    }
    if (req.method === "POST" && pathname === "/api/sessions/register") {
      const body = await readJson(req);
      const sessionId = body.sessionId || randomUUID();
      const previous = sessions.get(sessionId);
      const session = { sessionId, host: normalizeHost(body.host), documentName: body.documentName || "", documentKey: canonicalDocumentKey(body.documentKey), documentIdentity: body.documentIdentity || null, status: "online", registeredAt: previous?.registeredAt || nowIso(), lastSeenAt: nowIso(), activeContext: body.activeContext || null, operationScope: previous?.operationScope || { mode: "document" }, capabilities: body.capabilities || [], clientVersion: body.clientVersion || previous?.clientVersion || "", clientBuild: body.clientBuild || previous?.clientBuild || "", queue: previous?.queue || [], binding: previous?.binding || null };
      if (!session.documentKey) session.documentKey = documentKeyFor(session);
      if (session.documentKey) {
        for (const [existingId, existing] of sessions.entries()) {
          if (existingId !== sessionId && existing.host === session.host && existing.documentKey === session.documentKey) sessions.delete(existingId);
        }
      }
      sessions.set(sessionId, session);
      session.binding = findBindingForSession(session) || null;
      return sendJson(res, 200, { ok: true, session: publicSession(session) });
    }
    const sessionBinding = /^\/api\/sessions\/([^/]+)\/binding$/.exec(pathname);
    if (sessionBinding && req.method === "GET") { const session = sessions.get(sessionBinding[1]); if (!session) return sendError(res, 404, "SESSION_NOT_FOUND", `Session not found: ${sessionBinding[1]}`); session.binding = findBindingForSession(session) || null; session.lastSeenAt = nowIso(); return sendJson(res, 200, { ok: true, session: publicSession(session), binding: session.binding }); }
    if (sessionBinding && req.method === "POST") { const session = sessions.get(sessionBinding[1]); if (!session) return sendError(res, 404, "SESSION_NOT_FOUND", `Session not found: ${sessionBinding[1]}`); const body = await readJson(req); if (body.documentIdentity || body.documentName || body.documentPath || body.host) { session.documentIdentity = body.documentIdentity || session.documentIdentity; session.documentName = body.documentName || session.documentName; session.host = normalizeHost(body.host || session.host); session.documentKey = documentKeyFor(session); } const binding = upsertBinding(session, body.binding || body); await saveBindings(); return sendJson(res, 200, { ok: true, session: publicSession(session), binding }); }
    const sessionPaneView = /^\/api\/sessions\/([^/]+)\/pane-view$/.exec(pathname);
    if (sessionPaneView && req.method === "GET") return sendJson(res, 200, { ok: true, sessionId: sessionPaneView[1], ...getPaneView(sessionPaneView[1]) });
    if (sessionPaneView && req.method === "POST") { const body = await readJson(req); return sendJson(res, 200, { ok: true, sessionId: sessionPaneView[1], ...setPaneView(sessionPaneView[1], body.view) }); }
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
  } catch (error) { return sendError(res, statusForError(error), error.code || "INTERNAL_ERROR", error.message || String(error), error.details || {}); }
}
await loadBindings();
process.on("exit", () => codexAgent.close());
codexAgent.ensureStarted().catch((error) => console.error(`[codex-agent] Shared transport preflight failed: ${error.message}`));
startConnectorPlatformHeartbeat({ version: "1.1.3" });
createServer(handle).listen(port, host, () => { console.error(`wps-connector bridge listening on http://${host}:${port}`); });
