import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";

function textFromMessage(message) {
  if (typeof message?.text === "string") return message.text.trim();
  if (typeof message?.content === "string") return message.content.trim();
  if (!Array.isArray(message?.content)) return "";
  return message.content.map((part) => {
    if (typeof part === "string") return part;
    return String(part?.text || part?.content || "");
  }).join("\n").trim();
}

function normalizeRunStatus(status) {
  if (["starting", "prewarming"].includes(status)) return "starting";
  if (["running", "draft"].includes(status)) return "running";
  if (["completedSuccess", "completed", "idle"].includes(status)) return "completed";
  if (["completedInterrupted", "interrupted"].includes(status)) return "interrupted";
  if (["error", "failed"].includes(status)) return "failed";
  return "running";
}

function messagesFromResult(result, limit = 200) {
  const rows = Array.isArray(result?.messages) ? result.messages : [];
  return rows.map((message, index) => ({
    id: message?.id || `zcode-message-${index}`,
    role: message?.role === "user" ? "user" : "assistant",
    phase: message?.phase || message?.kind || "",
    text: textFromMessage(message),
  })).filter((message) => message.text).slice(-Math.max(1, Number(limit) || 200));
}

export class ZcodeAgentClient extends EventEmitter {
  constructor(options = {}) {
    super();
    this.command = options.command;
    this.args = options.args || [];
    this.env = { ...process.env, ...(options.env || {}) };
    this.model = options.model || null;
    this.providerAccountConfig = options.providerAccountConfig || null;
    this.requestTimeoutMs = Number(options.requestTimeoutMs || 30000);
    this.child = null;
    this.starting = null;
    this.ready = null;
    this.buffer = "";
    this.nextId = 1;
    this.pending = new Map();
    this.runs = new Map();
  }

  async ensureStarted() {
    if (this.starting) return this.starting;
    if (this.child && !this.child.killed) return;
    this.starting = this.start().finally(() => { this.starting = null; });
    return this.starting;
  }

  async start() {
    if (!this.command || !this.args.length) throw Object.assign(new Error("ZCode Agent 启动配置为空。"), { code: "AGENT_PROVIDER_UNAVAILABLE" });
    this.ready = new Promise((resolve, reject) => { this.readyResolve = resolve; this.readyReject = reject; });
    const child = spawn(this.command, this.args, { env: this.env, stdio: ["pipe", "pipe", "pipe"] });
    this.child = child;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => this.onData(chunk));
    child.stderr.on("data", (chunk) => this.emit("log", String(chunk)));
    child.on("error", (error) => this.onExit(error));
    child.on("exit", (code, signal) => this.onExit(new Error(`ZCode Agent exited (${code ?? signal ?? "unknown"}).`)));
    await this.ready;
    if (this.providerAccountConfig) await this.requestReady("provider/updateAccountConfig", this.providerAccountConfig);
  }

  onData(chunk) {
    this.buffer += chunk;
    while (this.buffer.includes("\n")) {
      const newline = this.buffer.indexOf("\n");
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;
      try { this.onMessage(JSON.parse(line)); } catch (error) { this.emit("log", `Invalid ZCode protocol message: ${error.message}`); }
    }
  }

  onMessage(message) {
    if (message.method === "startup/storagePath") {
      this.write({ method: "startup/storagePathReady", reuse: true });
      return;
    }
    if (message.method === "startup/storageState" && message.params?.phase === "ready") {
      this.readyResolve?.();
      this.readyResolve = null;
      this.readyReject = null;
      return;
    }
    if (message.id != null && (message.result !== undefined || message.error)) {
      const pending = this.pending.get(String(message.id));
      if (!pending) return;
      this.pending.delete(String(message.id));
      clearTimeout(pending.timer);
      if (message.error) pending.reject(Object.assign(new Error(message.error.message || "ZCode request failed"), { code: message.error.code, details: message.error.data }));
      else pending.resolve(message.result);
      return;
    }
    if (message.id != null && message.method) {
      void this.handleServerRequest(message);
      return;
    }
    if (message.method) this.onNotification(message.method, message.params || {});
  }

  async handleServerRequest(message) {
    const method = message.method;
    if (method === "session/requestRuntimePreferences") {
      return this.write({ id: message.id, result: { nativeSearchEnhancementsEnabled: true, memoryEnabled: true, askUserQuestionAutoResolutionEnabled: true, modelContextBudgetStrategy: "preflight-v1" } });
    }
    if (method === "interaction/requestOfficialMcpAuthHeaders") {
      return this.write({ id: message.id, result: { ok: false, reason: "runtime_headers_unavailable" } });
    }
    if (method === "interaction/requestProviderRuntimeHeaders") {
      const providerId = String(message.params?.providerId || message.params?.modelSelection?.providerId || this.model?.providerId || "");
      const apiKey = String(this.env.WPS_CONNECTOR_ZCODE_API_KEY || "").trim();
      return this.write({ id: message.id, result: apiKey ? { headersApplied: true, requestAuth: { apiKey } } : { headersApplied: false, errorMessage: `ZCode 独立 Agent 通道未配置模型凭据：${providerId}` } });
    }
    if (method === "interaction/requestPermission") return this.write({ id: message.id, result: { decision: "allow" } });
    if (method === "interaction/requestUserInput") return this.write({ id: message.id, error: { code: -32020, message: "WPS Connector 面板不支持交互式追问。" } });
    this.write({ id: message.id, error: { code: -32601, message: `Unsupported ZCode server request: ${method}` } });
  }

  onNotification(method, params) {
    const sessionId = String(params.sessionId || "");
    const run = this.runs.get(sessionId);
    if (!run) return;
    if (method === "state.updated") {
      const status = params.patch?.status;
      if (status) run.status = normalizeRunStatus(status);
      run.updatedAt = new Date().toISOString();
    }
    if (method === "v4/telemetry/event" && params.kind === "turn.terminal") {
      run.status = params.status === "completedSuccess" ? "completed" : params.status === "completedInterrupted" ? "interrupted" : "failed";
      run.error = params.errorMessage || "";
      run.updatedAt = new Date().toISOString();
    }
    if (method === "computer-use/operation-event" && params.kind === "turn-failed") {
      run.status = "failed";
      run.error = "ZCode Agent 执行失败。";
      run.updatedAt = new Date().toISOString();
    }
    this.emit("notification", { method, params });
  }

  onExit(error) {
    const failure = error instanceof Error ? error : new Error(String(error));
    this.readyReject?.(failure);
    this.readyResolve = null;
    this.readyReject = null;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(failure); }
    this.pending.clear();
    for (const run of this.runs.values()) if (["starting", "running"].includes(run.status)) { run.status = "failed"; run.error = failure.message; run.updatedAt = new Date().toISOString(); }
    this.child = null;
  }

  write(message) {
    if (!this.child?.stdin?.writable) throw new Error("ZCode Agent 未运行。");
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  async request(method, params = {}) {
    await this.ensureStarted();
    return this.requestReady(method, params);
  }

  requestReady(method, params = {}) {
    const id = String(this.nextId++);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(Object.assign(new Error(`ZCode request timed out: ${method}`), { code: "AGENT_REQUEST_TIMEOUT" })); }, this.requestTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.write({ id, method, params });
    });
  }

  async startThread(options = {}) {
    const workspacePath = options.cwd || process.cwd();
    const result = await this.request("session/create", { ...(this.model ? { model: this.model } : {}), workspace: { workspacePath, workspaceKey: workspacePath } });
    const session = result?.session || {};
    const threadId = String(session.sessionId || "").trim();
    if (!threadId) throw Object.assign(new Error("ZCode 未返回新对话 ID。"), { code: "AGENT_THREAD_CREATE_FAILED" });
    return { threadId, thread: { id: threadId, name: session.title || "" } };
  }

  async listSessions() {
    const result = await this.request("session/list", {});
    const rows = Array.isArray(result?.sessions) ? result.sessions : [];
    return rows.map((session) => ({
      id: String(session.sessionId || ""),
      threadId: String(session.sessionId || ""),
      title: String(session.title || ""),
      threadTitle: String(session.title || ""),
      cwd: String(session.workspace?.workspacePath || session.workspace?.workspaceKey || ""),
      updatedAt: session.updatedAt ? new Date(Number(session.updatedAt)).toISOString() : "",
      status: String(session.status || ""),
      mode: String(session.mode || ""),
      workspace: session.workspace || null,
    })).filter((session) => session.id);
  }

  async readThread(threadId, limit = 200) {
    const result = await this.request("session/read", { sessionId: threadId });
    const session = result?.session || {};
    return { thread: { id: session.sessionId || threadId, name: session.title || "" }, messages: messagesFromResult(result, limit), run: this.getRun(threadId) };
  }

  async startTurn(threadId, text, options = {}) {
    const current = this.runs.get(threadId);
    if (current && ["starting", "running"].includes(current.status)) throw Object.assign(new Error("当前 ZCode 对话已有正在执行的任务。"), { code: "AGENT_TURN_ACTIVE" });
    const now = new Date().toISOString();
    const run = { runId: randomUUID(), threadId, turnId: "", status: "starting", delta: "", finalText: "", error: "", startedAt: now, updatedAt: now };
    this.runs.set(threadId, run);
    try {
      const modelSelection = options.model || this.model;
      const result = await this.request("session/send", { sessionId: threadId, content: text, ...(modelSelection ? { modelSelection } : {}) });
      run.turnId = result?.turnId || "";
      run.status = "running";
      run.updatedAt = new Date().toISOString();
      return this.getRun(threadId);
    } catch (error) {
      run.status = "failed";
      run.error = error.message || String(error);
      run.updatedAt = new Date().toISOString();
      throw error;
    }
  }

  async interrupt(threadId) {
    const run = this.runs.get(threadId);
    if (!run || !["starting", "running"].includes(run.status)) throw Object.assign(new Error("没有正在执行的 ZCode 任务。"), { code: "AGENT_TURN_NOT_FOUND" });
    await this.request("session/stop", { sessionId: threadId });
    run.status = "interrupted";
    run.updatedAt = new Date().toISOString();
    return this.getRun(threadId);
  }

  getRun(threadId) { const run = this.runs.get(threadId); return run ? { ...run } : null; }
  getTransportStatus() { return { mode: "stdio-zcode-protocol", shared: false, socketPath: "", connected: Boolean(this.child && !this.child.killed), desktopSyncRequired: false, sharedTransportStatus: { status: this.child ? "available" : "pending", command: this.command } }; }
}
