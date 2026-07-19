import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";

const bundledCodex = "/Applications/ChatGPT.app/Contents/Resources/codex";

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
    this.args = options.args || parseArgs(process.env.WPS_CONNECTOR_CODEX_ARGS) || ["-c", "features.code_mode_host=true", "app-server"];
    this.requestTimeoutMs = Number(options.requestTimeoutMs || process.env.WPS_CONNECTOR_CODEX_TIMEOUT_MS || 30000);
    this.child = null;
    this.starting = null;
    this.buffer = "";
    this.nextId = 1;
    this.pending = new Map();
    this.runs = new Map();
  }

  async ensureStarted() {
    if (this.starting) return this.starting;
    if (this.child && !this.child.killed) return;
    this.starting = this.start();
    try {
      await this.starting;
    } finally {
      this.starting = null;
    }
  }

  async start() {
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
      clientInfo: { name: "wps-connector", title: "WPS Connector", version: "1.1.1" },
      capabilities: { experimentalApi: true },
    }, true);
    this.notify("initialized", {});
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
    const run = this.runs.get(threadId);
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
  }

  write(message) {
    if (!this.child?.stdin?.writable) throw new Error("Codex App Server is not running.");
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
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

  close() {
    if (this.child && !this.child.killed) this.child.kill("SIGTERM");
    this.child = null;
  }
}
