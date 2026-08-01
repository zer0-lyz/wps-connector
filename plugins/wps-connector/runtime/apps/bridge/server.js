import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { promisify } from "node:util";
import { tools } from "../shared/toolSchemas.js";
import { asMatrix, mapSyncRows, mergeRowsByKey, normalizeSyncConfig } from "../../vendor/connector-shared/tableSyncCore.js";
import { CodexAgentClient } from "./codexAgent.js";
import { connectorPlatformStatus, startConnectorPlatformHeartbeat } from "./connectorPlatform.js";
import { pushAdapterState, reconcileAdapterState } from "../../vendor/connector-shared/connectorStateClient.js";
import { deriveDesktopSyncStatus } from "../../vendor/connector-shared/modules/agent-chat/desktopSync.js";
import { buildSourcePrompt } from "../../vendor/connector-shared/sourceMetadata.js";

const host = process.env.WPS_CONNECTOR_HOST || "127.0.0.1";
const port = Number(process.env.WPS_CONNECTOR_PORT || 40215);
const commandTimeoutMs = Number(process.env.WPS_CONNECTOR_COMMAND_TIMEOUT_MS || 60000);
const activeContextRefreshMinIntervalMs = Number(process.env.WPS_CONNECTOR_ACTIVE_CONTEXT_REFRESH_MIN_INTERVAL_MS || 5000);
const sessionOfflineMs = Number(process.env.WPS_CONNECTOR_SESSION_OFFLINE_MS || 30000);
const sessionRetainOfflineMs = Number(process.env.WPS_CONNECTOR_SESSION_RETAIN_OFFLINE_MS || 300000);
const maxOfflineSessions = Number(process.env.WPS_CONNECTOR_MAX_OFFLINE_SESSIONS || 200);
const addinUrl = (process.env.WPS_CONNECTOR_ADDIN_URL || "http://127.0.0.1:3891").replace(/\/$/, "");
const runtimeRoot = process.env.WPS_CONNECTOR_RUNTIME_ROOT || join(homedir(), ".local/share/wps-connector/runtime");
const catalogPath = process.env.WPS_CONNECTOR_CATALOG_PATH || join(runtimeRoot, "codex-catalog.snapshot.json");
const bindingsPath = process.env.WPS_CONNECTOR_BINDINGS_PATH || join(runtimeRoot, "project-bindings.local.json");
const tableSyncsPath = process.env.WPS_CONNECTOR_TABLE_SYNCS_PATH || join(runtimeRoot, "et-wpp-table-syncs.local.json");
const connectorPlatformUrl = (process.env.CONNECTOR_PLATFORM_URL || "http://127.0.0.1:40315").replace(/\/$/, "");
const productUpdateCheckUrl = process.env.WPS_CONNECTOR_PRODUCT_UPDATE_URL || `${connectorPlatformUrl}/api/product`;
const updateCheckUrl = process.env.WPS_CONNECTOR_UPDATE_CHECK_URL || "https://raw.githubusercontent.com/zer0-lyz/wps-connector/main/apps/wps-addin/main.js";
const updateCheckFallbackUrl = process.env.WPS_CONNECTOR_UPDATE_CHECK_FALLBACK_URL || "https://cdn.jsdelivr.net/gh/zer0-lyz/wps-connector@main/apps/wps-addin/main.js";
const suiteSourceRoot = process.env.CONNECTOR_SUITE_SOURCE_ROOT || join(homedir(), "Code/connector-platform");
const sessions = new Map();
const commands = new Map();
const paneViews = new Map();
const execFileAsync = promisify(execFile);
let bindingsStore = { bindings: [] };
let tableSyncsStore = { sources: [], syncs: [] };
let connectorStateStatus = { ok: false, mode: "local", revision: 0, error: "not reconciled" };
let updateCheckCache = null;
const codexAgent = new CodexAgentClient();
let desktopSyncCache = { checkedAt: 0, value: null };
codexAgent.on("log", (message) => {
  const text = String(message || "").trim();
  if (text) console.error(`[codex-agent] ${text}`);
});
function warmAgentTransport() {
  void codexAgent.ensureStarted().catch((error) => {
    console.error(`[codex-agent] Agent transport warm-up failed: ${error.message || error}`);
  });
}

function nowIso() { return new Date().toISOString(); }
function sendJson(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "content-type" });
  res.end(JSON.stringify(payload, null, 2));
}
function sendError(res, status, code, message, details = {}) { sendJson(res, status, { ok: false, error: { code, message, details } }); }
async function readSystemClipboard() {
  const env = { ...process.env, LANG: "en_US.UTF-8", LC_ALL: "en_US.UTF-8" };
  const { stdout } = await execFileAsync("/usr/bin/pbpaste", [], { timeout: 3000, maxBuffer: 1024 * 1024 * 8, encoding: "utf8", env });
  return String(stdout || "");
}
async function writeSystemClipboard(text) {
  await new Promise((resolve, reject) => {
    const env = { ...process.env, LANG: "en_US.UTF-8", LC_ALL: "en_US.UTF-8" };
    const child = spawn("/usr/bin/pbcopy", [], { stdio: ["pipe", "ignore", "pipe"], env });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(stderr.trim() || `pbcopy exited with code ${code}`)));
    child.stdin.end(String(text || ""));
  });
}
function statusForError(error) {
  if (Number.isFinite(Number(error?.status))) return Number(error.status);
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
const bindingKeys = ["projectName", "projectPath", "projectId", "threadId", "threadTitle", "threadCwd", "conversationId", "documentRole", "bindingId", "documentKey", "host", "documentName", "createdAt", "updatedAt"];
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
function hasBindingSelector(binding) { return Boolean(binding?.bindingId || binding?.projectId || binding?.projectPath || binding?.projectName || binding?.threadId || binding?.conversationId); }
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
  if (!hasBindingSelector(requested)) return false;
  const actualThreadId = String(session.binding.threadId || session.binding.conversationId || "");
  const requestedThreadId = String(requested.threadId || requested.conversationId || "");
  if (!hasProjectBinding(session.binding)) {
    return Boolean(
      (requested.bindingId && String(requested.bindingId) === String(session.binding.bindingId || ""))
      || (actualThreadId && requestedThreadId && actualThreadId === requestedThreadId),
    );
  }
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
async function writeBindingsLocal() { await mkdir(dirname(bindingsPath), { recursive: true }); await writeFile(bindingsPath, `${JSON.stringify(bindingsStore, null, 2)}\n`); }
async function loadTableSyncs() {
  try {
    const raw = await readFile(tableSyncsPath, "utf8");
    const json = JSON.parse(raw);
    tableSyncsStore = { sources: Array.isArray(json.sources) ? json.sources : [], syncs: Array.isArray(json.syncs) ? json.syncs : [] };
  } catch {
    tableSyncsStore = { sources: [], syncs: [] };
  }
}
async function writeTableSyncsLocal() { await mkdir(dirname(tableSyncsPath), { recursive: true }); await writeFile(tableSyncsPath, `${JSON.stringify(tableSyncsStore, null, 2)}\n`); }
function connectorStateSnapshot() { return { bindings: bindingsStore.bindings, tableSyncs: tableSyncsStore }; }
async function pushConnectorState() { connectorStateStatus = await pushAdapterState("WPS", connectorStateSnapshot()); return connectorStateStatus; }
async function saveBindings() { await writeBindingsLocal(); await pushConnectorState(); }
async function saveTableSyncs() { await writeTableSyncsLocal(); await pushConnectorState(); }
async function reconcileConnectorState() {
  const result = await reconcileAdapterState("WPS", connectorStateSnapshot());
  connectorStateStatus = result;
  if (!result.ok) return result;
  bindingsStore = { bindings: result.state.bindings };
  tableSyncsStore = result.state.tableSyncs;
  await writeBindingsLocal();
  await writeTableSyncsLocal();
  return result;
}
function findBindingForSession(session) {
  const key = canonicalDocumentKey(documentKeyFor(session));
  return bindingsStore.bindings.find((binding) => canonicalDocumentKey(binding.documentKey) === key) || null;
}
function upsertBinding(session, inputBinding) {
  const binding = normalizeBinding(inputBinding);
  if (!binding) return clearBinding(session);
  if (!hasProjectBinding(binding) && !binding.threadId) {
    throw { code: "BINDING_TARGET_REQUIRED", message: "至少需要选择一个项目，或允许首次发送时创建新的 Codex 对话。", details: { sessionId: session.sessionId } };
  }
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
function agentBindingForSession(sessionId, { requireThread = false } = {}) {
  const session = sessions.get(sessionId);
  if (!session) throw { code: "SESSION_NOT_FOUND", message: `Session not found: ${sessionId}` };
  session.binding = findBindingForSession(session) || session.binding || null;
  if (requireThread && !session.binding?.threadId) {
    throw { code: "AGENT_THREAD_BINDING_REQUIRED", message: "当前 WPS 文档尚未绑定 Codex 对话。", details: { sessionId, documentName: session.documentName } };
  }
  return { session, binding: session.binding };
}

async function ensureAgentBinding(session) {
  let binding = session.binding || findBindingForSession(session) || null;
  if (binding?.threadId) return binding;
  const projectPath = binding?.threadCwd || binding?.projectPath || binding?.projectId || "";
  const created = await codexAgent.startThread({ cwd: projectPath });
  const thread = created.thread || {};
  binding = upsertBinding(session, {
    ...(binding || {}),
    threadId: created.threadId,
    threadTitle: thread.name || thread.title || "新建 Codex 对话",
    threadCwd: projectPath,
    projectId: binding?.projectId || "",
    projectName: binding?.projectName || "",
    projectPath: binding?.projectPath || "",
    documentRole: binding?.documentRole || "",
  });
  await saveBindings();
  return binding;
}
function setPaneView(sessionId, view) {
  const session = sessions.get(sessionId);
  if (!session) throw { code: "SESSION_NOT_FOUND", message: `Session not found: ${sessionId}` };
  const normalizedView = view === "agent" ? "agent" : view === "sync" ? "sync" : "connector";
  const state = { view: normalizedView, updatedAt: nowIso() };
  paneViews.set(sessionId, state);
  return state;
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
  const value = deriveDesktopSyncStatus({
    transport,
    desktopRunning,
    privateAppServerActive,
    launchSettingEnabled: launchSetting === "1",
  });
  desktopSyncCache = { checkedAt: Date.now(), value };
  return value;
}

function summarizeAgentContext(session, contextOverride = null) {
  const context = contextOverride || session.activeContext || {};
  if (session.host === "et") {
    return [
      context.sheetName ? `Sheet: ${context.sheetName}` : "",
      context.address ? `Range: ${context.address}` : "",
      Number(context.rowCount) && Number(context.columnCount)
        ? `Size: ${context.rowCount} 行 x ${context.columnCount} 列`
        : "",
    ].filter(Boolean).join("; ") || "未读取到 WPS 表格选区";
  }
  if (session.host === "wpp") {
    const preview = String(context.text || context.textPreview || context.previewText || "").slice(0, 160);
    return Number(context.length) > 0
      ? `Selection: ${context.length} 字; Position: ${context.start ?? "?"}-${context.end ?? "?"}; Preview: ${preview}`
      : "WPS 文字当前无选中文本 / 插入点位置";
  }
  return JSON.stringify(context || {});
}

function buildAgentPrompt(session, binding, userText) {
  const scope = session.operationScope || { mode: "document", context: null };
  const scopeText = scope.mode === "selection"
    ? `已确认选区：${summarizeAgentContext(session, scope.context || session.activeContext)}`
    : "未确认选区：默认按用户指令全局操作；若用户说当前选区，则使用下面 Current context。";
  return buildSourcePrompt({
    connector: "WPS",
    host: session.host === "wpp" ? "WPS Writer" : session.host === "et" ? "WPS Spreadsheet" : session.host,
    document: session.documentName || "",
    sessionId: session.sessionId,
    documentKey: session.documentKey || documentKeyFor(session),
    bindingId: binding.bindingId || "",
    threadId: binding.threadId || "",
    project: binding.projectName || binding.projectPath || binding.projectId || "",
    currentContext: summarizeAgentContext(session),
    operationScope: scopeText,
  }, userText);
}

async function assertAgentSyncReady() {
  const sync = await desktopSyncStatus();
  if (!sync.ready && sync.desktopSyncRequired && process.env.WPS_CONNECTOR_AGENT_ALLOW_UNSYNCED !== "1") {
    throw {
      code: "AGENT_DESKTOP_SYNC_REQUIRED",
      message: sync.configurationRequired
        ? "Codex Desktop 尚未启用共享会话通道，请先运行 Connector Suite 桌面通道配置。"
        : sync.restartRequired
          ? "共享会话通道已配置，请重启 Codex Desktop 一次后再发送。"
          : "Codex Desktop 共享会话通道尚未连接，请检查 Connector 服务状态。",
      details: sync,
    };
  }
  return sync;
}
async function loadCatalog() { try { const raw = await readFile(catalogPath, "utf8"); const json = JSON.parse(raw); return { projects: Array.isArray(json.projects) ? json.projects : [], threads: Array.isArray(json.threads) ? json.threads : [], updatedAt: json.updatedAt || "", source: json.source || "" }; } catch { return { projects: [], threads: [], updatedAt: "", source: "" }; } }
async function refreshCatalog() {
  try {
    const response = await fetch(`${connectorPlatformUrl}/api/catalog`);
    const json = await response.json();
    if (!response.ok || !json.ok) throw new Error(json.error?.message || `HTTP ${response.status}`);
    const catalog = {
      updatedAt: json.updatedAt || nowIso(),
      source: json.source || "connector-platform",
      projects: Array.isArray(json.projects) ? json.projects : [],
      threads: Array.isArray(json.threads) ? json.threads : [],
    };
    await mkdir(dirname(catalogPath), { recursive: true });
    await writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
    return catalog;
  } catch {}
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
function parseProductVersion(source = "") {
  const product = JSON.parse(source);
  const version = String(product.productVersion || "");
  if (!version) throw new Error("Connector Suite 产品信息缺少 productVersion");
  return { version, build: String(product.build || "") };
}
async function checkForUpdates(input = {}) {
  const cacheMs = Number(process.env.WPS_CONNECTOR_UPDATE_CHECK_CACHE_MS || 300000);
  if (!queryBool(input.refresh, false) && updateCheckCache && Date.now() - updateCheckCache.checkedAtMs < cacheMs) return updateCheckCache.payload;
  const localPath = join(process.cwd(), "apps/wps-addin/main.js");
  const localSource = await readFile(localPath, "utf8");
  const current = parseConnectorVersion(localSource);
  const payload = {
    current,
    latest: null,
    updateAvailable: false,
    versionState: "unknown",
    checkedAt: nowIso(),
    source: { localPath, productUpdateCheckUrl, updateCheckUrl, updateCheckFallbackUrl },
  };
  if (!queryBool(input.skipRemote, false)) {
    const timeoutMs = Number(process.env.WPS_CONNECTOR_UPDATE_CHECK_TIMEOUT_MS || 30000);
    const sources = [
      { kind: "product", url: productUpdateCheckUrl },
      { kind: "legacy-wps", url: updateCheckUrl },
      { kind: "legacy-wps", url: updateCheckFallbackUrl },
    ].filter((item) => item.url);
    const failures = [];
    for (const source of sources) {
      try {
        const remoteSource = await fetchUpdateSource(source.url, timeoutMs);
        payload.latest = source.kind === "product"
          ? parseProductVersion(remoteSource)
          : parseConnectorVersion(remoteSource);
        payload.source.remoteUrl = source.url;
        payload.source.remoteKind = source.kind;
        const comparison = payload.latest.version ? compareVersions(current.version, payload.latest.version) : 0;
        payload.versionState = comparison < 0 ? "update_available" : comparison > 0 ? "local_ahead" : "up_to_date";
        payload.updateAvailable = payload.versionState === "update_available";
        payload.warning = null;
        break;
      } catch (error) {
        failures.push({ kind: source.kind, url: source.url, message: error.message || String(error) });
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
    `cd ${JSON.stringify(suiteSourceRoot)}`,
    "npm run update:mac"
  ].join(" && ");
  const child = spawn("/bin/zsh", ["-lc", `mkdir -p ${JSON.stringify(join(runtimeRoot, "logs"))}; (${command}) >> ${JSON.stringify(logPath)} 2>&1`], { detached: true, stdio: "ignore" });
  child.unref();
  return {
    started: true,
    suiteSourceRoot,
    runtimeRoot,
    logPath,
    message: "Connector Suite 统一更新已开始。WPS、Office 和共享内核会一起更新；安装完成后请重启 WPS/Office 使新版插件生效。",
  };
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
    if (session?.binding && requested && !hasBindingSelector(requested)) throw { code: "PROJECT_BINDING_REQUIRED", message: "请提供项目或对话绑定信息（项目、对话或 bindingId）。", details: { sessionId: session.sessionId } };
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
  if (!hasBindingSelector(requested)) throw { code: "PROJECT_BINDING_REQUIRED", message: "请提供项目或对话绑定信息后再执行 " + toolName + ".", details: { requestedBinding: requested } };
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

function publicCommand(command) {
  return {
    commandId: command.commandId,
    sessionId: command.sessionId,
    toolName: command.toolName,
    status: command.status,
    createdAt: command.createdAt,
    deliveredAt: command.deliveredAt || null,
    completedAt: command.completedAt || null,
    timedOutAt: command.timedOutAt || null,
    ageMs: Date.now() - Date.parse(command.createdAt || nowIso()),
    error: command.error ? { code: command.error.code || "COMMAND_FAILED", message: command.error.message || String(command.error) } : null,
  };
}
function commandDebugSummary() {
  const all = [...commands.values()].sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
  const active = all.filter((command) => ["queued", "delivered"].includes(command.status));
  const byStatus = all.reduce((acc, command) => { acc[command.status] = (acc[command.status] || 0) + 1; return acc; }, {});
  return {
    total: all.length,
    activeCount: active.length,
    byStatus,
    active: active.map(publicCommand),
    recent: all.slice(0, 20).map(publicCommand),
  };
}

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

function tableSyncError(code, message, details = {}, status = 400) { throw { code, message, details, status }; }
function findOnlineHostSession(hostPrefix, sessionId = "") {
  pruneOfflineSessions();
  if (sessionId) {
    const session = sessions.get(sessionId);
    if (!session || session.status !== "online") return null;
    return String(session.host || "").startsWith(hostPrefix) ? session : null;
  }
  return [...sessions.values()]
    .filter((session) => session.status === "online" && String(session.host || "").startsWith(hostPrefix))
    .sort((a, b) => sessionLastSeenMs(b) - sessionLastSeenMs(a))[0] || null;
}
function findOnlineDocumentSession(hostPrefix, documentKey = "") {
  pruneOfflineSessions();
  const key = canonicalDocumentKey(documentKey);
  return [...sessions.values()]
    .filter((session) => session.status === "online" && String(session.host || "").startsWith(hostPrefix))
    .find((session) => canonicalDocumentKey(session.documentKey || documentKeyFor(session)) === key) || null;
}
async function runSessionCommand(session, toolName, input = {}) {
  if (!session || session.status !== "online") tableSyncError("SESSION_OFFLINE", "目标 WPS 文档不在线，请打开对应面板后重试。", { toolName, sessionId: session?.sessionId }, 409);
  const command = enqueueCommand(session, toolName, { ...input, sessionId: session.sessionId });
  const result = await waitForCommand(command);
  return { command, result };
}
function normalizeWpsMatrix(value) {
  if (!Array.isArray(value)) return [[value ?? ""]];
  if (!Array.isArray(value[0])) return [value.map((cell) => cell ?? "")];
  return asMatrix(value);
}
function localEtAddress(sheetName, address) {
  const raw = String(address || "").trim();
  if (!raw) return "";
  const bangIndex = raw.lastIndexOf("!");
  if (bangIndex < 0) return raw;
  const prefix = raw.slice(0, bangIndex).replace(/^'|'$/g, "");
  const expectedSheet = String(sheetName || "").replace(/^'|'$/g, "").trim();
  return !expectedSheet || prefix === expectedSheet || prefix.endsWith(`]${expectedSheet}`) ? raw.slice(bangIndex + 1) : raw;
}
function defaultEtWppDataSourceName(documentKey, sheetName, address) {
  const sources = tableSyncsStore.sources.filter((item) => item.documentKey === documentKey);
  const usedNumbers = sources.map((item) => String(item.name || "").match(/^表\s*(\d+)-/)).filter(Boolean).map((match) => Number(match[1])).filter((value) => Number.isInteger(value) && value > 0);
  const nextNumber = usedNumbers.length ? Math.max(...usedNumbers) + 1 : 1;
  const sheet = String(sheetName || "Sheet").trim() || "Sheet";
  return `表 ${nextNumber}-${sheet}：${localEtAddress(sheet, address) || "当前选区"}`;
}
function publicEtWppDataSource(source) {
  const boundSyncs = tableSyncsStore.syncs.filter((sync) => (sync.sourceId || "") === source.sourceId).map((sync) => ({
    syncId: sync.syncId,
    name: sync.name || "",
    wppDocumentName: sync.target?.documentName || "",
    wppTableIndex: sync.target?.fallbackTableIndex ?? null,
    lastSyncedAt: sync.lastSyncedAt || null,
  }));
  return {
    sourceId: source.sourceId,
    name: source.name || "",
    etDocumentKey: source.documentKey || "",
    etDocumentName: source.documentName || "",
    sheetName: source.sheetName || "",
    address: localEtAddress(source.sheetName, source.address),
    rowCount: Number(source.rowCount || 0),
    columnCount: Number(source.columnCount || 0),
    status: boundSyncs.length ? "bound" : "pending",
    boundSyncs,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
  };
}
function publicEtWppTableSync(sync) {
  return {
    syncId: sync.syncId,
    modelVersion: sync.modelVersion || 2,
    name: sync.name || "",
    sourceId: sync.sourceId || "",
    source: sync.source || null,
    target: sync.target || null,
    valueSource: sync.valueSource || "values",
    allowStructuralChanges: Boolean(sync.allowStructuralChanges),
    config: sync.config || null,
    createdAt: sync.createdAt,
    updatedAt: sync.updatedAt,
    lastSyncedAt: sync.lastSyncedAt || null,
    lastSyncSummary: sync.lastSyncSummary || null,
  };
}
async function createEtWppDataSource(input = {}) {
  const etSession = findOnlineHostSession("et", input.etSessionId || input.sessionId);
  if (!etSession) tableSyncError("NO_ACTIVE_ET_SESSION", "当前没有在线的 WPS 表格会话。", {}, 404);
  let sheetName = input.sheetName || "";
  let address = input.address || "";
  let values = null;
  let selection = null;
  if (!address || input.refreshSelection === true) {
    const selected = await runSessionCommand(etSession, "et.read_selection", { sessionId: etSession.sessionId });
    selection = selected.result;
    sheetName = input.sheetName || selection.sheetName || sheetName;
    address = input.address || selection.address || address;
    values = selection.values;
  }
  if (!address) tableSyncError("ET_SELECTION_REQUIRED", "请先在 WPS 表格中选择要同步的数据区域。", { sessionId: etSession.sessionId }, 400);
  const read = values ? null : await runSessionCommand(etSession, "et.read_range", { sessionId: etSession.sessionId, sheetName, address });
  const rows = normalizeWpsMatrix(values ?? read?.result?.values);
  const sourceId = input.sourceId || randomUUID();
  const existingIndex = tableSyncsStore.sources.findIndex((source) => source.sourceId === sourceId);
  const previous = existingIndex >= 0 ? tableSyncsStore.sources[existingIndex] : null;
  const now = nowIso();
  const source = {
    sourceId,
    name: String(input.name || "").trim() || previous?.name || defaultEtWppDataSourceName(etSession.documentKey || documentKeyFor(etSession), sheetName, address),
    documentKey: etSession.documentKey || documentKeyFor(etSession),
    documentName: etSession.documentName,
    sheetName: sheetName || read?.result?.sheetName || "",
    address: localEtAddress(sheetName, address),
    rowCount: rows.length,
    columnCount: Math.max(0, ...rows.map((row) => row.length)),
    createdAt: previous?.createdAt || now,
    updatedAt: now,
  };
  if (existingIndex >= 0) tableSyncsStore.sources[existingIndex] = source; else tableSyncsStore.sources.push(source);
  await saveTableSyncs();
  return { created: existingIndex < 0, source: publicEtWppDataSource(source), selection, preview: { values: rows.slice(0, 5), rowCount: source.rowCount, columnCount: source.columnCount } };
}
async function unbindEtWppDataSource(input = {}) {
  const sourceId = String(input.sourceId || "").trim();
  if (!sourceId) tableSyncError("ET_WPP_DATA_SOURCE_ID_REQUIRED", "sourceId is required.");
  const removedSyncs = tableSyncsStore.syncs.filter((sync) => (sync.sourceId || "") === sourceId && (!input.syncId || sync.syncId === input.syncId));
  if (!removedSyncs.length) tableSyncError("ET_WPP_BINDING_NOT_FOUND", "未找到对应的 WPS 表格-文字绑定。", { sourceId, syncId: input.syncId || "" }, 404);
  tableSyncsStore.syncs = tableSyncsStore.syncs.filter((sync) => !removedSyncs.includes(sync));
  await saveTableSyncs();
  const source = tableSyncsStore.sources.find((item) => item.sourceId === sourceId);
  return { unbound: true, sourceId, removedSyncIds: removedSyncs.map((sync) => sync.syncId), removedCount: removedSyncs.length, source: source ? publicEtWppDataSource(source) : null };
}
async function deleteEtWppDataSource(input = {}) {
  const sourceId = String(input.sourceId || "").trim();
  if (!sourceId) tableSyncError("ET_WPP_DATA_SOURCE_ID_REQUIRED", "sourceId is required.");
  const source = tableSyncsStore.sources.find((item) => item.sourceId === sourceId);
  if (!source) tableSyncError("ET_WPP_DATA_SOURCE_NOT_FOUND", `WPS 表格数据源不存在：${sourceId}`, { sourceId }, 404);
  const bound = tableSyncsStore.syncs.filter((sync) => (sync.sourceId || "") === sourceId);
  if (bound.length) tableSyncError("ET_WPP_DATA_SOURCE_STILL_BOUND", "请先解除文字表格绑定，再删除该数据源。", { sourceId, boundSyncIds: bound.map((sync) => sync.syncId) }, 409);
  tableSyncsStore.sources = tableSyncsStore.sources.filter((item) => item.sourceId !== sourceId);
  await saveTableSyncs();
  return { deleted: true, sourceId };
}
async function createEtWppTableSync(input = {}) {
  const registeredSource = input.sourceId ? tableSyncsStore.sources.find((source) => source.sourceId === input.sourceId) : null;
  if (input.sourceId && !registeredSource) tableSyncError("ET_WPP_DATA_SOURCE_NOT_FOUND", `WPS 表格数据源不存在：${input.sourceId}`, {}, 404);
  const etSession = registeredSource ? findOnlineDocumentSession("et", registeredSource.documentKey) : findOnlineHostSession("et", input.etSessionId);
  if (!etSession) tableSyncError("NO_ACTIVE_ET_SESSION", "源 WPS 表格文档不在线。", {}, 404);
  const wppSession = findOnlineHostSession("wpp", input.wppSessionId || input.wordSessionId);
  if (!wppSession) tableSyncError("NO_ACTIVE_WPP_SESSION", "目标 WPS 文字文档不在线。", {}, 404);
  const tableIndex = Math.max(0, Math.floor(Number(input.wppTableIndex ?? input.wordTableIndex ?? input.tableIndex ?? 0)));
  const sourceRead = await runSessionCommand(etSession, "et.read_range", { sessionId: etSession.sessionId, sheetName: registeredSource?.sheetName || input.sheetName, address: registeredSource?.address || input.address });
  const sourceRows = normalizeWpsMatrix(sourceRead.result?.values);
  const tableRead = await runSessionCommand(wppSession, "wpp.list_tables", { sessionId: wppSession.sessionId, includeValues: false, maxTables: 200 });
  const targetTable = (tableRead.result?.tables || []).find((table) => Number(table.tableIndex ?? table.index) === tableIndex);
  if (!targetTable) tableSyncError("WPP_TABLE_NOT_FOUND", "目标 WPS 文字表格不存在。", { tableIndex, tableCount: tableRead.result?.count || 0 }, 404);
  const config = normalizeSyncConfig(input, Math.max(0, ...sourceRows.map((row) => row.length)), Number(targetTable.columnCount || 0));
  const syncId = input.syncId || randomUUID();
  const existingIndex = tableSyncsStore.syncs.findIndex((item) => item.syncId === syncId);
  const previous = existingIndex >= 0 ? tableSyncsStore.syncs[existingIndex] : null;
  const now = nowIso();
  const sync = {
    syncId,
    modelVersion: 2,
    name: String(input.name || "").trim() || registeredSource?.name || "WPS 表格同步",
    sourceId: registeredSource?.sourceId || input.sourceId || "",
    source: { documentKey: etSession.documentKey || documentKeyFor(etSession), documentName: etSession.documentName, sheetName: sourceRead.result?.sheetName || registeredSource?.sheetName || input.sheetName || "", address: localEtAddress(sourceRead.result?.sheetName || registeredSource?.sheetName || input.sheetName, registeredSource?.address || input.address) },
    target: { documentKey: wppSession.documentKey || documentKeyFor(wppSession), documentName: wppSession.documentName, fallbackTableIndex: tableIndex, anchorTag: `wps-sync-${syncId}` },
    valueSource: input.valueSource || "values",
    allowStructuralChanges: input.allowStructuralChanges !== false,
    config,
    createdAt: previous?.createdAt || now,
    updatedAt: now,
    lastSyncedAt: previous?.lastSyncedAt || null,
    lastSyncSummary: previous?.lastSyncSummary || null,
  };
  if (existingIndex >= 0) tableSyncsStore.syncs[existingIndex] = sync; else tableSyncsStore.syncs.push(sync);
  await saveTableSyncs();
  return { created: existingIndex < 0, mapping: publicEtWppTableSync(sync), sourceShape: { rowCount: sourceRows.length, columnCount: Math.max(0, ...sourceRows.map((row) => row.length)) }, targetTable };
}
async function insertEtWppDataSource(input = {}) {
  const source = tableSyncsStore.sources.find((item) => item.sourceId === input.sourceId);
  if (!source) tableSyncError("ET_WPP_DATA_SOURCE_NOT_FOUND", `WPS 表格数据源不存在：${input.sourceId}`, {}, 404);
  const etSession = findOnlineDocumentSession("et", source.documentKey);
  if (!etSession) tableSyncError("NO_ACTIVE_ET_SESSION", "源 WPS 表格文档不在线。", {}, 409);
  const wppSession = findOnlineHostSession("wpp", input.wppSessionId || input.wordSessionId);
  if (!wppSession) tableSyncError("NO_ACTIVE_WPP_SESSION", "目标 WPS 文字文档不在线。", {}, 409);
  const read = await runSessionCommand(etSession, "et.read_range", { sessionId: etSession.sessionId, sheetName: source.sheetName, address: source.address });
  const rows = normalizeWpsMatrix(read.result?.values);
  if (!rows.length || !rows[0]?.length) tableSyncError("EMPTY_ET_RANGE", "源 WPS 表格区域为空，无法插入。", { sourceId: source.sourceId });
  const inserted = await runSessionCommand(wppSession, "wpp.insert_table", { sessionId: wppSession.sessionId, rowCount: rows.length, columnCount: Math.max(1, ...rows.map((row) => row.length)), values: rows, border: input.border === true, headerRowBold: false, releaseSelection: true, ensureTrailingParagraph: true });
  const oneBased = Number(inserted.result?.tableIndex || 1);
  const binding = await createEtWppTableSync({ sourceId: source.sourceId, etSessionId: etSession.sessionId, wppSessionId: wppSession.sessionId, wppTableIndex: Math.max(0, oneBased - 1), name: source.name, allowStructuralChanges: true, headerRowCount: Number(input.headerRowCount ?? 1), syncHeader: input.syncHeader !== false });
  return { inserted: true, insert: inserted.result, binding };
}
async function syncEtWppTable(input = {}) {
  const sync = tableSyncsStore.syncs.find((item) => item.syncId === input.syncId);
  if (!sync) tableSyncError("ET_WPP_SYNC_NOT_FOUND", `WPS 表格-文字同步关系不存在：${input.syncId}`, {}, 404);
  const etSession = findOnlineDocumentSession("et", sync.source?.documentKey);
  const wppSession = findOnlineDocumentSession("wpp", sync.target?.documentKey);
  if (!etSession || !wppSession) tableSyncError("ET_WPP_SYNC_SESSION_OFFLINE", "请同时打开源 WPS 表格和目标 WPS 文字文档，再同步。", { etOnline: Boolean(etSession), wppOnline: Boolean(wppSession), source: sync.source, target: sync.target }, 409);
  const read = await runSessionCommand(etSession, "et.read_range", { sessionId: etSession.sessionId, sheetName: sync.source?.sheetName, address: sync.source?.address });
  const rawSourceRows = normalizeWpsMatrix(read.result?.values);
  if (!rawSourceRows.length || !rawSourceRows[0]?.length) tableSyncError("EMPTY_ET_RANGE", "映射的 WPS 表格区域为空。", { syncId: sync.syncId });
  const tableRead = await runSessionCommand(wppSession, "wpp.list_tables", { sessionId: wppSession.sessionId, includeValues: true, maxTables: 200, maxRows: 500, maxColumns: 200 });
  const targetTable = (tableRead.result?.tables || []).find((table) => Number(table.tableIndex ?? table.index) === Number(sync.target?.fallbackTableIndex ?? 0));
  if (!targetTable) tableSyncError("WPP_SYNC_TARGET_MISSING", "映射的 WPS 文字表格不存在。", { syncId: sync.syncId, tableCount: tableRead.result?.count || 0 }, 409);
  const config = normalizeSyncConfig({ ...(sync.config || {}), ...(input.config || {}), ...input }, Math.max(0, ...rawSourceRows.map((row) => row.length)), Number(targetTable.columnCount || 0));
  const mapped = mapSyncRows(rawSourceRows, config);
  const targetColumnCount = Number(targetTable.columnCount || config.columnMapping.length || Math.max(0, ...rawSourceRows.map((row) => row.length)));
  let finalRows = mapped.valuesForTarget;
  let rowMerge = { enabled: false, reason: "header only or disabled" };
  if (!config.syncHeader) {
    rowMerge = mergeRowsByKey(mapped.mappedDataRows, targetTable.values || [], config, targetColumnCount);
    finalRows = rowMerge.rows;
  }
  if (input.previewOnly) {
    return { previewOnly: true, syncId: sync.syncId, sourceShape: { rowCount: rawSourceRows.length, columnCount: Math.max(0, ...rawSourceRows.map((row) => row.length)) }, targetShape: { rowCount: targetTable.rowCount, columnCount: targetTable.columnCount }, rowMerge, values: finalRows.slice(0, 20), valueCount: finalRows.length };
  }
  const replace = await runSessionCommand(wppSession, "wpp.replace_table_values", { sessionId: wppSession.sessionId, tableIndex: sync.target?.fallbackTableIndex || 0, values: finalRows, allowStructuralChanges: sync.allowStructuralChanges !== false, headerRowCount: config.headerRowCount, syncHeader: config.syncHeader });
  const now = nowIso();
  sync.config = config;
  sync.lastSyncedAt = now;
  sync.updatedAt = now;
  sync.lastSyncSummary = { rowCount: finalRows.length, columnCount: targetColumnCount, rowMerge, replaced: replace.result };
  await saveTableSyncs();
  return { synced: true, syncId: sync.syncId, mapping: publicEtWppTableSync(sync), sourceShape: { rowCount: rawSourceRows.length, columnCount: Math.max(0, ...rawSourceRows.map((row) => row.length)) }, targetShape: { rowCount: replace.result?.rowCount, columnCount: replace.result?.columnCount }, rowMerge, replace: replace.result };
}

async function runTool(toolName, input) {
  if (toolName === "wps.list_sessions") return { sessions: listSessions(input) };
  if (toolName === "wps.connection_status") return connectionStatus(input);
  if (toolName === "wps.batch") return runBatch(input);
  if (toolName === "wps.create_et_wpp_data_source") return createEtWppDataSource(input || {});
  if (toolName === "wps.list_et_wpp_data_sources") {
    const items = tableSyncsStore.sources.map(publicEtWppDataSource).filter((source) => !input?.status || source.status === input.status);
    return { sources: items, count: items.length };
  }
  if (toolName === "wps.delete_et_wpp_data_source") return deleteEtWppDataSource(input || {});
  if (toolName === "wps.unbind_et_wpp_data_source") return unbindEtWppDataSource(input || {});
  if (toolName === "wps.create_et_wpp_table_sync") return createEtWppTableSync(input || {});
  if (toolName === "wps.insert_et_wpp_data_source") return insertEtWppDataSource(input || {});
  if (toolName === "wps.list_et_wpp_table_syncs") {
    const syncs = tableSyncsStore.syncs.map(publicEtWppTableSync).filter((sync) => !input?.sourceId || sync.sourceId === input.sourceId);
    return { syncs, count: syncs.length };
  }
  if (toolName === "wps.sync_et_wpp_table") return syncEtWppTable(input || {});
  const localSyncPrimitiveTools = new Set(["et.select_range", "et.inspect_sheet_overlays", "et.delete_sheet_overlays", "wpp.list_tables", "wpp.select_table", "wpp.replace_table_values", "wpp.ensure_table_sync_anchor", "wpp.resolve_table_sync_anchor"]);
  if (localSyncPrimitiveTools.has(toolName)) {
    const expectedHost = expectedHostForTool(toolName);
    const session = findOnlineHostSession(expectedHost, input?.sessionId);
    if (!session) throw { code: "SESSION_NOT_FOUND", message: `No online WPS session found for ${toolName}.` };
    assertSessionHost(session, expectedHost, toolName);
    const command = enqueueCommand(session, toolName, input || {});
    const result = await waitForCommand(command);
    return { commandId: command.commandId, sessionId: session.sessionId, ...result };
  }
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
    if (req.method === "GET" && pathname === "/api/health") return sendJson(res, 200, { ok: true, name: "wps-connector", time: nowIso(), connectorPlatform: connectorPlatformStatus(), connectorState: connectorStateStatus });
    if (pathname === "/api/clipboard" && req.method === "GET") {
      assertAgentOrigin(req);
      return sendJson(res, 200, { ok: true, text: await readSystemClipboard() });
    }
    if (pathname === "/api/clipboard" && req.method === "POST") {
      assertAgentOrigin(req);
      const input = await readJson(req);
      await writeSystemClipboard(input.text);
      return sendJson(res, 200, { ok: true });
    }
    if (req.method === "GET" && pathname === "/api/update/check") { const result = await checkForUpdates(Object.fromEntries(url.searchParams.entries())); return sendJson(res, 200, { ok: true, ...result }); }
    if (req.method === "POST" && pathname === "/api/update/apply") { return sendJson(res, 202, { ok: true, ...applyUpdate() }); }
    if (req.method === "GET" && pathname === "/api/tools/schema") return sendJson(res, 200, { ok: true, tools });
    if (req.method === "GET" && pathname === "/api/debug/commands") return sendJson(res, 200, { ok: true, ...commandDebugSummary() });
    if (req.method === "POST" && pathname === "/api/catalog/refresh") { const catalog = await refreshCatalog(); return sendJson(res, 200, { ok: true, projects: catalog.projects, threads: catalog.threads, updatedAt: catalog.updatedAt, source: catalog.source }); }
    if (req.method === "GET" && pathname === "/api/catalog") { const catalog = await refreshCatalog(); return sendJson(res, 200, { ok: true, projects: catalog.projects, threads: catalog.threads, updatedAt: catalog.updatedAt, source: catalog.source }); }
    if (req.method === "GET" && pathname === "/api/catalog/projects") { const catalog = await refreshCatalog(); return sendJson(res, 200, { ok: true, projects: catalog.projects, updatedAt: catalog.updatedAt, source: catalog.source }); }
    if (req.method === "GET" && pathname === "/api/catalog/threads") { const catalog = await refreshCatalog(); return sendJson(res, 200, { ok: true, threads: catalog.threads, updatedAt: catalog.updatedAt, source: catalog.source }); }
    const agentHistory = /^\/api\/agent\/([^/]+)\/history$/.exec(pathname);
    if (req.method === "GET" && agentHistory) {
      assertAgentOrigin(req);
      const { session, binding } = agentBindingForSession(agentHistory[1]);
      if (!binding?.threadId) {
        warmAgentTransport();
        return sendJson(res, 200, {
          ok: true,
          sessionId: session.sessionId,
          documentName: session.documentName,
          binding: null,
          thread: null,
          messages: [],
          run: null,
          sync: await desktopSyncStatus(),
        });
      }
      const result = await codexAgent.readThread(binding.threadId, Number(url.searchParams.get("limit") || 200));
      return sendJson(res, 200, { ok: true, sessionId: session.sessionId, documentName: session.documentName, binding, thread: { id: result.thread?.id || binding.threadId, name: result.thread?.name || binding.threadTitle || "" }, messages: result.messages, run: result.run, sync: await desktopSyncStatus() });
    }
    const agentMessage = /^\/api\/agent\/([^/]+)\/message$/.exec(pathname);
    if (req.method === "POST" && agentMessage) {
      assertAgentOrigin(req);
      const { session } = agentBindingForSession(agentMessage[1]);
      const body = await readJson(req);
      const text = String(body.text || "").trim();
      if (!text) return sendError(res, 400, "AGENT_MESSAGE_REQUIRED", "请输入要发送给 Agent 的内容。");
      const sync = await assertAgentSyncReady();
      const binding = await ensureAgentBinding(session);
      const prompt = buildAgentPrompt(session, binding, text);
      const run = await codexAgent.startTurn(binding.threadId, prompt, { cwd: binding.threadCwd || binding.projectPath || binding.projectId || "" });
      return sendJson(res, 202, { ok: true, sessionId: session.sessionId, documentName: session.documentName, threadId: binding.threadId, binding, thread: { id: binding.threadId, name: binding.threadTitle || "" }, run, sync });
    }
    const agentStatus = /^\/api\/agent\/([^/]+)\/status$/.exec(pathname);
    if (req.method === "GET" && agentStatus) {
      assertAgentOrigin(req);
      const { session, binding } = agentBindingForSession(agentStatus[1], { requireThread: true });
      return sendJson(res, 200, { ok: true, sessionId: session.sessionId, threadId: binding.threadId, run: codexAgent.getRun(binding.threadId), sync: await desktopSyncStatus() });
    }
    const agentInterrupt = /^\/api\/agent\/([^/]+)\/interrupt$/.exec(pathname);
    if (req.method === "POST" && agentInterrupt) {
      assertAgentOrigin(req);
      const { session, binding } = agentBindingForSession(agentInterrupt[1], { requireThread: true });
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
    const sessionRefreshContext = /^\/api\/sessions\/([^/]+)\/active-context\/refresh$/.exec(pathname);
    if (sessionRefreshContext && req.method === "POST") {
      const session = sessions.get(sessionRefreshContext[1]);
      if (!session) return sendError(res, 404, "SESSION_NOT_FOUND", `Session not found: ${sessionRefreshContext[1]}`);
      if (session.status !== "online") return sendError(res, 409, "SESSION_OFFLINE", "Session is offline.", { sessionId: session.sessionId });
      const tool = String(session.host || "").startsWith("et") ? "et.read_selection" : String(session.host || "").startsWith("wpp") ? "wpp.read_selection" : "";
      if (!tool) return sendError(res, 400, "HOST_UNSUPPORTED", "Active context refresh is only supported for WPS ET/WPP sessions.", { host: session.host });
      try {
        const body = await readJson(req).catch(() => ({}));
        const force = body.force === true;
        const lastRefreshMs = Number(session.lastActiveContextRefreshMs || 0);
        const elapsedMs = Date.now() - lastRefreshMs;
        if (!force && session.activeContext && elapsedMs >= 0 && elapsedMs < activeContextRefreshMinIntervalMs) {
          session.lastSeenAt = nowIso();
          return sendJson(res, 200, { ok: true, session: publicSession(session), activeContext: session.activeContext, cached: true, nextRefreshAfterMs: activeContextRefreshMinIntervalMs - elapsedMs });
        }
        const commandResult = await runSessionCommand(session, tool, { sessionId: session.sessionId });
        session.activeContext = commandResult.result || session.activeContext;
        session.lastActiveContextRefreshMs = Date.now();
        session.lastSeenAt = nowIso();
        return sendJson(res, 200, { ok: true, session: publicSession(session), activeContext: session.activeContext, commandId: commandResult.command.commandId, cached: false });
      } catch (error) {
        return sendError(res, statusForError(error), error.code || "ACTIVE_CONTEXT_REFRESH_FAILED", error.message || String(error), error.details || {});
      }
    }
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
await loadTableSyncs();
await reconcileConnectorState();
process.on("exit", () => codexAgent.close());
codexAgent.ensureStarted().catch((error) => console.error(`[codex-agent] Shared transport preflight failed: ${error.message}`));
startConnectorPlatformHeartbeat({ version: "0.2.1" });
createServer(handle).listen(port, host, () => { console.error(`wps-connector bridge listening on http://${host}:${port}`); });
