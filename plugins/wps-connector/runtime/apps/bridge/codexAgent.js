import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import net from "node:net";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import WebSocket from "ws";

const bundledCodex = "/Applications/ChatGPT.app/Contents/Resources/codex";
const execFileAsync = promisify(execFile);

function agentPath() {
  const parts = String(process.env.PATH || "").split(":").filter(Boolean);
  for (const path of ["/usr/local/bin", "/opt/homebrew/bin", "/usr/bin", "/bin"]) {
    if (!parts.includes(path)) parts.push(path);
  }
  return parts.join(":");
}

function textFromUserItem(item) {
  return (item?.content || [])
    .filter((part) => part?.type === "text")
    .map((part) => String(part.text || ""))
    .join("\n")
    .trim();
}

export function threadToMessages(thread, limit = 200) {
  const messages = [];
  for (const [turnIndex, turn] of (thread?.turns || []).entries()) {
    for (const item of turn?.items || []) {
      if (item?.type === "userMessage") {
        const text = textFromUserItem(item);
        if (text) messages.push({ id: item.id, turnId: turn.id, turnIndex, role: "user", text });
      }
      if (item?.type === "agentMessage") {
        const text = String(item.text || "").trim();
        if (text) messages.push({ id: item.id, turnId: turn.id, turnIndex, role: "assistant", phase: item.phase || "", text });
      }
    }
  }
  return messages.slice(-Math.max(1, Number(limit) || 200));
}

function parseArgs(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : null;
  } catch {
    return null;
  }
}

export class CodexAgentClient extends EventEmitter {
  constructor(options = {}) {
    super();
    this.command = options.command || process.env.WPS_CONNECTOR_CODEX_BIN || (existsSync(bundledCodex) ? bundledCodex : "codex");
    const configuredArgs = options.args || parseArgs(process.env.WPS_CONNECTOR_CODEX_ARGS);
    this.args = configuredArgs || ["-c", "features.code_mode_host=true", "app-server"];
    this.sharedTransport = options.sharedTransport ?? !configuredArgs;
    this.socketPath = options.socketPath || process.env.WPS_CONNECTOR_CODEX_SOCKET || join(homedir(), ".codex/app-server-control/app-server-control.sock");
    this.requestTimeoutMs = Number(options.requestTimeoutMs || process.env.WPS_CONNECTOR_CODEX_TIMEOUT_MS || 30000);
    this.child = null;
    this.socket = null;
    this.starting = null;
    this.buffer = "";
    this.nextId = 1;
    this.pending = new Map();
    this.runs = new Map();
    this.subscribedThreads = new Set();
  }

  async ensureStarted() {
    if (this.starting) return this.starting;
    if (this.socket?.readyState === WebSocket.OPEN) return;
    if (this.child && !this.child.killed) return;
    this.starting = this.start();
    try {
      await this.starting;
    } finally {
      this.starting = null;
    }
  }

  async start() {
    if (this.sharedTransport) return this.startShared();
    return this.startStdio();
  }

  async startStdio() {
    const child = spawn(this.command, this.args, {
      env: { ...process.env, PATH: agentPath() },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;
    await new Promise((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => this.onData(chunk));
    child.stderr.on("data", (chunk) => this.emit("log", String(chunk)));
    child.on("error", (error) => this.emit("log", `Codex App Server process error: ${error.message}`));
    child.on("exit", (code, signal) => this.onExit(code, signal));
    await this.request("initialize", {
      clientInfo: { name: "wps-connector", title: "WPS Connector", version: "1.1.2" },
      capabilities: { experimentalApi: true },
    }, true);
    this.notify("initialized", {});
  }

  async daemonVersion() {
    try {
      const { stdout } = await execFileAsync(this.command, ["app-server", "daemon", "version"], {
        env: { ...process.env, PATH: agentPath() },
        timeout: 2500,
      });
      const result = JSON.parse(stdout);
      return result?.status === "running" && result?.socketPath ? result : null;
    } catch {
      return null;
    }
  }

  async ensureSharedServer() {
    const running = await this.daemonVersion();
    if (running?.socketPath === this.socketPath) return running;
    await mkdir(dirname(this.socketPath), { recursive: true });
    const child = spawn(this.command, ["-c", "features.code_mode_host=true", "app-server", "--listen", `unix://${this.socketPath}`], {
      detached: true,
      env: { ...process.env, PATH: agentPath() },
      stdio: "ignore",
    });
    child.unref();
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const status = await this.daemonVersion();
      if (status?.socketPath === this.socketPath) return status;
    }
    throw Object.assign(new Error("无法启动 Codex 共享会话服务。"), { code: "AGENT_SHARED_SERVER_UNAVAILABLE" });
  }

  async startShared() {
    await this.ensureSharedServer();
    const socket = new WebSocket("ws://localhost/rpc", {
      createConnection: () => net.createConnection(this.socketPath),
      perMessageDeflate: false,
    });
    this.socket = socket;
    try {
      await new Promise((resolve, reject) => {
        socket.once("open", resolve);
        socket.once("error", reject);
      });
    } catch (error) {
      this.socket = null;
      socket.close();
      throw error;
    }
    socket.on("message", (data) => this.onMessageData(String(data)));
    socket.on("error", (error) => this.emit("log", `Codex shared App Server socket error: ${error.message}`));
    socket.on("close", (code, reason) => this.onExit(code, String(reason || "")));
    await this.request("initialize", {
      clientInfo: { name: "wps-connector", title: "WPS Connector", version: "1.1.2" },
      capabilities: { experimentalApi: true },
    }, true);
    this.notify("initialized", {});
  }

  onMessageData(data) {
    try {
      this.onMessage(JSON.parse(data));
    } catch (error) {
      this.emit("log", `Invalid Codex shared App Server message: ${error.message}`);
    }
  }

  onData(chunk) {
    this.buffer += chunk;
    while (this.buffer.includes("\n")) {
      const newline = this.buffer.indexOf("\n");
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;
      try {
        this.onMessage(JSON.parse(line));
      } catch (error) {
        this.emit("log", `Invalid Codex App Server message: ${error.message}`);
      }
    }
  }

  onMessage(message) {
    if (message.id != null && (message.result !== undefined || message.error)) {
      const key = String(message.id);
      const pending = this.pending.get(key);
      if (!pending) return;
      this.pending.delete(key);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(Object.assign(new Error(message.error.message || "Codex request failed"), { code: message.error.code, details: message.error.data }));
      else pending.resolve(message.result);
      return;
    }
    if (message.id != null && message.method) {
      this.write({ jsonrpc: "2.0", id: message.id, error: { code: -32001, message: "WPS Agent prototype cannot answer interactive Codex requests yet." } });
      return;
    }
    if (message.method) this.onNotification(message.method, message.params || {});
  }

  onNotification(method, params) {
    const threadId = String(params.threadId || "");
    let run = this.runs.get(threadId);
    if (threadId && method === "turn/started" && (!run || !["starting", "running"].includes(run.status))) {
      const now = new Date().toISOString();
      run = {
        runId: `external:${params.turn?.id || randomUUID()}`,
        threadId,
        turnId: params.turn?.id || "",
        status: "running",
        delta: "",
        finalText: "",
        error: "",
        source: "external",
        startedAt: now,
        updatedAt: now,
      };
      this.runs.set(threadId, run);
    }
    if (run && method === "item/agentMessage/delta") {
      run.turnId = run.turnId || params.turnId || "";
      run.delta += String(params.delta || "");
      run.updatedAt = new Date().toISOString();
    }
    if (run && method === "item/completed" && params.item?.type === "agentMessage") {
      run.turnId = run.turnId || params.turnId || "";
      run.finalText = String(params.item.text || run.finalText || "");
      run.updatedAt = new Date().toISOString();
    }
    if (run && method === "turn/completed") {
      run.turnId = params.turn?.id || run.turnId || "";
      run.status = params.turn?.status === "completed" ? "completed" : (params.turn?.status || "completed");
      run.completedAt = new Date().toISOString();
      run.updatedAt = run.completedAt;
    }
    if (run && method === "error") {
      run.status = "failed";
      run.error = params.error?.message || params.message || "Codex turn failed.";
      run.updatedAt = new Date().toISOString();
    }
    this.emit("notification", { method, params });
  }

  onExit(code, signal) {
    const error = new Error(`Codex App Server exited (${code ?? signal ?? "unknown"}).`);
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    for (const run of this.runs.values()) {
      if (run.status === "running" || run.status === "starting") {
        run.status = "failed";
        run.error = error.message;
        run.updatedAt = new Date().toISOString();
      }
    }
    this.child = null;
    this.socket = null;
  }

  write(message) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
      return;
    }
    if (this.child?.stdin?.writable) {
      this.child.stdin.write(`${JSON.stringify(message)}\n`);
      return;
    }
    throw new Error("Codex App Server is not running.");
  }

  notify(method, params = {}) {
    this.write({ jsonrpc: "2.0", method, params });
  }

  async request(method, params = {}, starting = false) {
    if (!starting) await this.ensureStarted();
    const id = String(this.nextId++);
    const result = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex App Server request timed out: ${method}`));
      }, this.requestTimeoutMs);
      this.pending.set(id, { resolve, reject, timer, method });
    });
    this.write({ jsonrpc: "2.0", id, method, params });
    return result;
  }

  async readThread(threadId, limit = 200) {
    if (!this.subscribedThreads.has(threadId)) {
      await this.request("thread/resume", { threadId, excludeTurns: true });
      this.subscribedThreads.add(threadId);
    }
    let thread;
    try {
      const turnLimit = Math.max(10, Math.min(100, Math.ceil((Number(limit) || 80) / 2)));
      const [metadata, turns] = await Promise.all([
        this.request("thread/read", { threadId, includeTurns: false }),
        this.request("thread/turns/list", { threadId, limit: turnLimit, sortDirection: "desc", itemsView: "full" }),
      ]);
      thread = { ...metadata.thread, turns: [...(turns.data || [])].reverse() };
    } catch {
      const result = await this.request("thread/read", { threadId, includeTurns: true });
      thread = result.thread;
    }
    return {
      thread,
      messages: threadToMessages(thread, limit),
      run: this.getRun(threadId),
    };
  }

  async startTurn(threadId, text, options = {}) {
    const current = this.runs.get(threadId);
    if (current && (current.status === "starting" || current.status === "running")) {
      throw Object.assign(new Error("The bound Codex conversation already has an active Agent turn."), { code: "AGENT_TURN_ACTIVE" });
    }
    await this.request("thread/resume", { threadId, excludeTurns: true });
    this.subscribedThreads.add(threadId);
    const now = new Date().toISOString();
    const run = {
      runId: randomUUID(),
      threadId,
      turnId: "",
      status: "starting",
      delta: "",
      finalText: "",
      error: "",
      startedAt: now,
      updatedAt: now,
    };
    this.runs.set(threadId, run);
    try {
      const result = await this.request("turn/start", {
        threadId,
        input: [{ type: "text", text, text_elements: [] }],
        clientUserMessageId: randomUUID(),
        approvalPolicy: "never",
        cwd: options.cwd || null,
      });
      run.turnId = result.turn?.id || "";
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
    if (!run?.turnId) throw Object.assign(new Error("No active Agent turn to stop."), { code: "AGENT_TURN_NOT_FOUND" });
    await this.request("turn/interrupt", { threadId, turnId: run.turnId });
    run.status = "interrupted";
    run.updatedAt = new Date().toISOString();
    return this.getRun(threadId);
  }

  getRun(threadId) {
    const run = this.runs.get(threadId);
    return run ? { ...run } : null;
  }

  getTransportStatus() {
    return {
      mode: this.sharedTransport ? "shared-daemon" : "stdio",
      shared: this.sharedTransport,
      socketPath: this.sharedTransport ? this.socketPath : "",
      connected: this.socket?.readyState === WebSocket.OPEN || Boolean(this.child && !this.child.killed),
      desktopSyncRequired: this.sharedTransport,
    };
  }

  close() {
    if (this.child && !this.child.killed) this.child.kill("SIGTERM");
    if (this.socket && this.socket.readyState < WebSocket.CLOSING) this.socket.close();
    this.child = null;
    this.socket = null;
  }
}
