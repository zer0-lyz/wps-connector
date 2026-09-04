import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import net from "node:net";
import { homedir } from "node:os";
import { delimiter, dirname, isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import WebSocket from "ws";
import { displayTextFromPrompt, sourceLabelFromPrompt } from "../../vendor/connector-shared/sourceMetadata.js";

const bundledCodex = "/Applications/ChatGPT.app/Contents/Resources/codex";
const execFileAsync = promisify(execFile);

function agentPath() {
  const separator = process.platform === "win32" ? delimiter : ":";
  const inherited = process.platform === "win32"
    ? [process.env.PATH, process.env.Path, process.env.CONNECTOR_SUITE_MACHINE_PATH, process.env.CONNECTOR_SUITE_USER_PATH]
    : [process.env.PATH];
  const parts = inherited.flatMap((value) => String(value || "").split(separator)).filter(Boolean);
  const defaults = process.platform === "win32"
    ? [
        join(process.env.LOCALAPPDATA || "", "Microsoft", "WindowsApps"),
        join(process.env.APPDATA || "", "npm"),
        join(process.env.LOCALAPPDATA || "", "Programs", "ChatGPT"),
        join(process.env.ProgramFiles || "", "ChatGPT"),
      ]
    : ["/usr/local/bin", "/opt/homebrew/bin", "/usr/bin", "/bin"];
  for (const path of defaults.filter(Boolean)) {
    if (!parts.includes(path)) parts.push(path);
  }
  return parts.join(separator);
}

function commandCandidates(command) {
  const raw = String(command || "").trim();
  if (!raw) return [];
  if (process.platform !== "win32") return [raw];
  const names = [raw];
  if (!/\.(?:exe|cmd|bat)$/i.test(raw)) names.push(`${raw}.exe`, `${raw}.cmd`, `${raw}.bat`);
  return [...new Set(names)];
}

function knownWindowsCodexPaths() {
  const localAppData = process.env.LOCALAPPDATA || "";
  const appData = process.env.APPDATA || "";
  const programFiles = process.env.ProgramFiles || "";
  const userProfile = process.env.USERPROFILE || homedir();
  return [
    join(localAppData, "Microsoft", "WindowsApps", "codex.exe"),
    join(appData, "npm", "codex.cmd"),
    join(localAppData, "Programs", "ChatGPT", "resources", "codex.exe"),
    join(localAppData, "Programs", "ChatGPT", "resources", "codex.cmd"),
    join(programFiles, "ChatGPT", "resources", "codex.exe"),
    join(programFiles, "ChatGPT", "resources", "codex.cmd"),
    join(userProfile, ".local", "bin", "codex.exe"),
  ].filter(Boolean);
}

async function resolveCommand(command) {
  const candidates = commandCandidates(command);
  for (const candidate of [...candidates, ...knownWindowsCodexPaths()]) {
    if ((isAbsolute(candidate) || process.platform === "win32") && existsSync(candidate)) return candidate;
  }
  if (process.platform === "win32") {
    for (const candidate of candidates) {
      try {
        const { stdout } = await execFileAsync("where.exe", [candidate], {
          env: { ...process.env, PATH: agentPath() },
          windowsHide: true,
          timeout: 2500,
        });
        const match = String(stdout || "").split(/\r?\n/).map((line) => line.trim()).find(Boolean);
        if (match && existsSync(match)) return match;
      } catch {
        // Try the next candidate and report an unavailable warning if none run.
      }
    }
  }
  return command;
}

function spawnFailure(error, command) {
  const originalCode = String(error?.code || "UNKNOWN").toUpperCase();
  const code = originalCode === "ENOENT"
    ? "AGENT_CODEX_EXECUTABLE_NOT_FOUND"
    : originalCode === "EPERM" || originalCode === "EACCES"
      ? "AGENT_CODEX_EXECUTION_BLOCKED"
      : "AGENT_CODEX_SPAWN_FAILED";
  return Object.assign(new Error(`Codex executable could not start (${originalCode}): ${command}`), {
    code,
    cause: error,
    details: { command, originalCode },
  });
}

function textFromUserItem(item) {
  return (item?.content || [])
    .filter((part) => part?.type === "text")
    .map((part) => String(part.text || ""))
    .join("\n")
    .trim();
}

function displayTextFromAgentPanelPrompt(text = "") {
  return displayTextFromPrompt(text);
}

function metaFromAgentPanelPrompt(text = "") {
  return sourceLabelFromPrompt(text);
}

export function threadToMessages(thread, limit = 200) {
  const messages = [];
  for (const [turnIndex, turn] of (thread?.turns || []).entries()) {
    for (const item of turn?.items || []) {
      if (item?.type === "userMessage") {
        const text = textFromUserItem(item);
        if (text) messages.push({
          id: item.id,
          turnId: turn.id,
          turnIndex,
          role: "user",
          text: displayTextFromAgentPanelPrompt(text),
          sourceMeta: metaFromAgentPanelPrompt(text),
        });
      }
      if (item?.type === "agentMessage") {
        const text = String(item.text || "").trim();
        if (text) messages.push({ id: item.id, turnId: turn.id, turnIndex, role: "assistant", phase: item.phase || "", text });
      }
    }
  }
  return messages.slice(-Math.max(1, Number(limit) || 200));
}

function isNotMaterializedError(error) {
  return /not materialized yet/i.test(String(error?.message || error || ""));
}

function emptyThreadState(threadId, run) {
  return {
    thread: { id: threadId, turns: [] },
    messages: [],
    run,
  };
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
    this.configuredCommand = options.command
      || process.env.CONNECTOR_SUITE_CODEX_COMMAND
      || process.env.CODEX_COMMAND
      || process.env.WPS_CONNECTOR_CODEX_BIN
      || (existsSync(bundledCodex) ? bundledCodex : "codex");
    this.command = this.configuredCommand;
    this.resolvedCommand = "";
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
    // A thread/start response arrives before Codex persists its first user turn.
    // Keep that short-lived state so a new conversation is never resumed/read too early.
    this.unmaterializedThreads = new Map();
    this.sharedTransportState = {
      status: this.sharedTransport ? "pending" : "unavailable",
      required: process.env.WPS_CONNECTOR_AGENT_SHARED_TRANSPORT_REQUIRED === "1",
      warning: "",
      code: "",
      command: this.command,
    };
  }

  sharedTransportStatus() {
    return { ...this.sharedTransportState, command: this.resolvedCommand || this.command };
  }

  markSharedTransportUnavailable(error) {
    const warning = `Codex shared transport unavailable: ${error.message || error}`;
    this.sharedTransportState = {
      ...this.sharedTransportState,
      status: "unavailable",
      warning,
      code: error.code || "AGENT_SHARED_SERVER_UNAVAILABLE",
      command: this.resolvedCommand || this.command,
    };
    this.emit("warning", { message: warning, code: this.sharedTransportState.code, details: error.details || {} });
  }

  markSharedTransportAvailable() {
    this.sharedTransportState = {
      ...this.sharedTransportState,
      status: "available",
      warning: "",
      code: "",
      command: this.resolvedCommand || this.command,
    };
  }

  async resolveCodexCommand() {
    if (this.resolvedCommand) return this.resolvedCommand;
    const resolved = await resolveCommand(this.configuredCommand);
    this.resolvedCommand = resolved;
    this.command = resolved;
    if (process.platform === "win32" && !existsSync(resolved) && !commandCandidates(resolved).some((candidate) => existsSync(candidate))) {
      throw Object.assign(new Error(`Codex executable was not found: ${this.configuredCommand}`), {
        code: "AGENT_CODEX_EXECUTABLE_NOT_FOUND",
        details: { configuredCommand: this.configuredCommand, resolvedCommand: resolved, path: agentPath() },
      });
    }
    return resolved;
  }

  async ensureStarted() {
    if (this.starting) return this.starting;
    if (this.socket?.readyState === WebSocket.OPEN) return;
    if (this.child && !this.child.killed) return;
    this.starting = this.start().catch((error) => {
      this.markSharedTransportUnavailable(error);
      throw error;
    });
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
    const command = await this.resolveCodexCommand();
    const child = spawn(command, this.args, {
      env: { ...process.env, PATH: agentPath() },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;
    child.on("error", (error) => this.emit("warning", { message: `Codex App Server process error: ${error.message}`, code: error.code || "AGENT_CODEX_SPAWN_FAILED" }));
    await new Promise((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", (error) => reject(spawnFailure(error, command)));
    });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => this.onData(chunk));
    child.stderr.on("data", (chunk) => this.emit("log", String(chunk)));
    child.on("exit", (code, signal) => this.onExit(code, signal));
    await this.request("initialize", {
      clientInfo: { name: "wps-connector", title: "WPS Connector", version: "0.2.1" },
      capabilities: { experimentalApi: true },
    }, true);
    this.notify("initialized", {});
    this.markSharedTransportAvailable();
  }

  async daemonVersion() {
    try {
      const command = await this.resolveCodexCommand();
      const { stdout } = await execFileAsync(command, ["app-server", "daemon", "version"], {
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
    const command = await this.resolveCodexCommand();
    const running = await this.daemonVersion();
    if (running?.socketPath === this.socketPath) return running;
    await mkdir(dirname(this.socketPath), { recursive: true });
    const child = spawn(command, ["-c", "features.code_mode_host=true", "app-server", "--listen", `unix://${this.socketPath}`], {
      detached: true,
      env: { ...process.env, PATH: agentPath() },
      stdio: "ignore",
    });
    child.on("error", (error) => this.emit("warning", { message: `Codex shared server process error: ${error.message}`, code: error.code || "AGENT_CODEX_SPAWN_FAILED" }));
    const spawnError = await new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      child.once("spawn", () => finish(null));
      child.once("error", (error) => finish(spawnFailure(error, command)));
    });
    if (spawnError) throw spawnError;
    child.unref();
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const status = await this.daemonVersion();
      if (status?.socketPath === this.socketPath) return status;
    }
    throw Object.assign(new Error("无法启动 Codex 共享会话服务。"), {
      code: "AGENT_SHARED_SERVER_UNAVAILABLE",
      details: { command, socketPath: this.socketPath },
    });
  }

  async startShared() {
    await this.ensureSharedServer();
    const socket = new WebSocket("ws://localhost/rpc", {
      createConnection: () => net.createConnection(this.socketPath),
      perMessageDeflate: false,
    });
    this.socket = socket;
    socket.on("error", (error) => this.emit("warning", { message: `Codex shared App Server socket error: ${error.message}`, code: error.code || "AGENT_SHARED_SOCKET_FAILED" }));
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
    socket.on("close", (code, reason) => this.onExit(code, String(reason || "")));
    await this.request("initialize", {
      clientInfo: { name: "wps-connector", title: "WPS Connector", version: "0.2.1" },
      capabilities: { experimentalApi: true },
    }, true);
    this.notify("initialized", {});
    this.markSharedTransportAvailable();
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
    const pendingThread = this.unmaterializedThreads.get(threadId);
    if (pendingThread) {
      return {
        thread: { ...pendingThread, id: threadId, turns: [] },
        messages: [],
        run: this.getRun(threadId),
      };
    }
    let thread;
    try {
      if (!this.subscribedThreads.has(threadId)) {
        await this.request("thread/resume", { threadId, excludeTurns: true });
        this.subscribedThreads.add(threadId);
      }
      const turnLimit = Math.max(10, Math.min(100, Math.ceil((Number(limit) || 80) / 2)));
      const [metadata, turns] = await Promise.all([
        this.request("thread/read", { threadId, includeTurns: false }),
        this.request("thread/turns/list", { threadId, limit: turnLimit, sortDirection: "desc", itemsView: "full" }),
      ]);
      thread = { ...metadata.thread, turns: [...(turns.data || [])].reverse() };
    } catch (error) {
      if (isNotMaterializedError(error)) {
        this.unmaterializedThreads.set(threadId, { id: threadId });
        return emptyThreadState(threadId, this.getRun(threadId));
      }
      try {
        const result = await this.request("thread/read", { threadId, includeTurns: true });
        thread = result.thread;
      } catch (fallbackError) {
        if (isNotMaterializedError(fallbackError)) {
          this.unmaterializedThreads.set(threadId, { id: threadId });
          return emptyThreadState(threadId, this.getRun(threadId));
        }
        throw fallbackError;
      }
    }
    return {
      thread,
      messages: threadToMessages(thread, limit),
      run: this.getRun(threadId),
    };
  }

  async startThread(options = {}) {
    const result = await this.request("thread/start", {
      cwd: options.cwd || null,
    });
    const thread = result?.thread || result;
    const threadId = String(thread?.id || thread?.threadId || "").trim();
    if (!threadId) {
      throw Object.assign(new Error("Codex App Server did not return a new thread id."), {
        code: "AGENT_THREAD_CREATE_FAILED",
        details: { result },
      });
    }
    this.subscribedThreads.add(threadId);
    this.unmaterializedThreads.set(threadId, thread);
    return {
      threadId,
      thread,
    };
  }

  async startTurn(threadId, text, options = {}) {
    const current = this.runs.get(threadId);
    if (current && (current.status === "starting" || current.status === "running")) {
      throw Object.assign(new Error("The bound Codex conversation already has an active Agent turn."), { code: "AGENT_TURN_ACTIVE" });
    }
    const unmaterialized = this.unmaterializedThreads.has(threadId);
    if (!unmaterialized) {
      try {
        await this.request("thread/resume", { threadId, excludeTurns: true });
      } catch (error) {
        if (!isNotMaterializedError(error)) throw error;
        this.unmaterializedThreads.set(threadId, { id: threadId });
      }
    }
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
      this.unmaterializedThreads.delete(threadId);
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
      sharedTransportStatus: this.sharedTransportStatus(),
    };
  }

  close() {
    if (this.child && !this.child.killed) this.child.kill("SIGTERM");
    if (this.socket && this.socket.readyState < WebSocket.CLOSING) this.socket.close();
    this.child = null;
    this.socket = null;
  }
}
