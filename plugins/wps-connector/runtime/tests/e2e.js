import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { CodexAgentClient } from "../apps/bridge/codexAgent.js";

const port = 40216;
const updatePort = 40218;
const bridgeUrl = `http://127.0.0.1:${port}`;
const updateUrl = `http://127.0.0.1:${updatePort}/main.js`;
const children = [];
const servers = [];

function startNode(args, env = {}) {
  const child = spawn(process.execPath, args, {
    env: { ...process.env, ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  children.push(child);
  return child;
}

async function runNode(args, env = {}) {
  const child = spawn(process.execPath, args, { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const [code] = await once(child, "close");
  if (code !== 0) throw new Error(stderr || stdout || `Node command exited with ${code}`);
  return JSON.parse(stdout);
}

async function request(path, options = {}) {
  const response = await fetch(`${bridgeUrl}${path}`, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) },
  });
  const json = await response.json();
  if (!json.ok) throw new Error(json.error?.message || `Request failed: ${path}`);
  return json;
}
async function rawRequest(path, options = {}) {
  const response = await fetch(`${bridgeUrl}${path}`, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) },
  });
  const json = await response.json();
  json.httpStatus = response.status;
  return json;
}
async function requestAt(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) },
  });
  const json = await response.json();
  json.httpStatus = response.status;
  return json;
}

async function waitForHealth() {
  for (let i = 0; i < 40; i += 1) {
    try {
      await request("/api/health");
      return;
    } catch {
      await sleep(100);
    }
  }
  throw new Error("Bridge did not become healthy.");
}
async function waitForHealthAt(baseUrl) {
  for (let i = 0; i < 40; i += 1) {
    try {
      const json = await requestAt(baseUrl, "/api/health");
      if (json.ok) return;
    } catch {}
    await sleep(100);
  }
  throw new Error(`Bridge did not become healthy: ${baseUrl}`);
}

async function waitForSessions(count) {
  for (let i = 0; i < 40; i += 1) {
    const json = await request("/api/sessions");
    if (json.sessions.length >= count) return json.sessions;
    await sleep(100);
  }
  throw new Error(`Expected ${count} sessions.`);
}

function createMcpClient(child) {
  const lines = createInterface({ input: child.stdout });
  const waiters = [];
  lines.on("line", (line) => {
    const waiter = waiters.shift();
    if (waiter) waiter(JSON.parse(line));
  });
  let id = 1;
  return {
    async request(method, params = {}) {
      const requestId = id;
      id += 1;
      const responsePromise = new Promise((resolve) => waiters.push(resolve));
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params })}\n`);
      const response = await responsePromise;
      if (response.error) throw new Error(response.error.message);
      return response.result;
    },
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const externalTurnProbe = new CodexAgentClient({ sharedTransport: false });
  externalTurnProbe.onNotification("turn/started", { threadId: "external-thread", turn: { id: "external-turn" } });
  externalTurnProbe.onNotification("item/agentMessage/delta", { threadId: "external-thread", turnId: "external-turn", delta: "外部回复" });
  externalTurnProbe.onNotification("turn/completed", { threadId: "external-thread", turn: { id: "external-turn", status: "completed" } });
  assert(externalTurnProbe.getRun("external-thread")?.delta === "外部回复" && externalTurnProbe.getRun("external-thread")?.status === "completed", "Agent client did not surface a turn started by Codex Desktop.");
  const pluginSkill = readFileSync("plugins/wps-connector/skills/wps-connector/SKILL.md", "utf8");
  assert(pluginSkill.includes("Two-Path Routing") && pluginSkill.includes("unsupported call") && pluginSkill.includes("restart WPS"), "Plugin skill missed mandatory automatic MCP fallback guidance.");
  for (const deployScript of ["scripts/deploy-runtime-mac.sh", "plugins/wps-connector/runtime/scripts/deploy-runtime-mac.sh"]) {
    const source = readFileSync(deployScript, "utf8");
    assert(source.includes("--exclude 'project-bindings.local.json'"), `${deployScript} may delete saved bindings during deployment.`);
    assert(source.includes("--exclude 'codex-catalog.snapshot.json'"), `${deployScript} may delete the local catalog snapshot during deployment.`);
  }
  const updateServer = createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
    res.end('const WPS_CONNECTOR_CLIENT_VERSION = "9.9.9";\nconst WPS_CONNECTOR_CLIENT_BUILD = "2099.01.01-test-update.1";\n');
  });
  updateServer.listen(updatePort, "127.0.0.1");
  servers.push(updateServer);
  await once(updateServer, "listening");

  const bridge = startNode(["apps/bridge/server.js"], { WPS_CONNECTOR_PORT: String(port), WPS_CONNECTOR_BINDINGS_PATH: `/tmp/wps-connector-e2e-bindings-${process.pid}.json`, WPS_CONNECTOR_UPDATE_CHECK_URL: updateUrl, WPS_CONNECTOR_UPDATE_CHECK_FALLBACK_URL: "", WPS_CONNECTOR_CODEX_BIN: process.execPath, WPS_CONNECTOR_CODEX_ARGS: JSON.stringify(["tests/fixtures/fake-codex-app-server.js"]) });
  bridge.on("exit", (code) => {
    if (code !== null && code !== 0) process.stderr.write(`bridge exited with code ${code}\n`);
  });
  await waitForHealth();
  const updateCheck = await requestAt(bridgeUrl, "/api/update/check?skipRemote=true");
  assert(updateCheck.ok === true && updateCheck.current?.version === "1.1.3", "Update check did not return the current connector version.");
  const remoteUpdateCheck = await requestAt(bridgeUrl, "/api/update/check?refresh=true");
  assert(remoteUpdateCheck.ok === true && remoteUpdateCheck.latest?.version === "9.9.9" && remoteUpdateCheck.updateAvailable === true && remoteUpdateCheck.versionState === "update_available", "Update check did not discover a newer remote version.");

  const stalePort = port + 1;
  const staleBridgeUrl = `http://127.0.0.1:${stalePort}`;
  startNode(["apps/bridge/server.js"], {
    WPS_CONNECTOR_PORT: String(stalePort),
    WPS_CONNECTOR_BINDINGS_PATH: `/tmp/wps-connector-e2e-stale-bindings-${process.pid}.json`,
    WPS_CONNECTOR_SESSION_OFFLINE_MS: "100",
    WPS_CONNECTOR_SESSION_RETAIN_OFFLINE_MS: "250",
    WPS_CONNECTOR_MAX_OFFLINE_SESSIONS: "5",
  });
  await waitForHealthAt(staleBridgeUrl);
  for (let i = 0; i < 80; i += 1) {
    const json = await requestAt(staleBridgeUrl, "/api/sessions/register", {
      method: "POST",
      body: JSON.stringify({ sessionId: `stale-${i}`, host: "wpp", documentName: `stale-${i}.docx`, documentKey: `/tmp/stale-${i}.docx` }),
    });
    assert(json.ok === true, "Stale session setup failed.");
  }
  await requestAt(staleBridgeUrl, "/api/sessions/register", { method: "POST", body: JSON.stringify({ sessionId: "dup-old", host: "wpp", documentName: "dup.docx", documentKey: "/tmp/dup.docx" }) });
  await requestAt(staleBridgeUrl, "/api/sessions/register", { method: "POST", body: JSON.stringify({ sessionId: "dup-new", host: "wpp", documentName: "dup.docx", documentKey: "/tmp/dup.docx" }) });
  const duplicateDoc = await requestAt(staleBridgeUrl, "/api/sessions?documentKey=%2Ftmp%2Fdup.docx&includeOffline=true");
  assert(duplicateDoc.sessions.length === 1 && duplicateDoc.sessions[0].sessionId === "dup-new", "Register did not replace duplicate host/documentKey session.");
  await sleep(160);
  const staleDefault = await requestAt(staleBridgeUrl, "/api/sessions");
  assert(staleDefault.ok === true && staleDefault.sessions.length === 0 && JSON.stringify(staleDefault).length < 2000, "Default /api/sessions returned stale offline sessions.");
  const staleIncluded = await requestAt(staleBridgeUrl, "/api/sessions?includeOffline=true");
  assert(staleIncluded.ok === true && staleIncluded.sessions.length <= 5, "includeOffline did not cap retained offline sessions.");
  await sleep(140);
  const staleDeleted = await requestAt(staleBridgeUrl, "/api/sessions?includeOffline=true");
  assert(staleDeleted.ok === true && staleDeleted.sessions.length === 0, "Retained offline sessions were not deleted after retention window.");

  startNode(["apps/wps-addin/simulator.js"], {
    WPS_CONNECTOR_BRIDGE_URL: bridgeUrl,
    WPS_CONNECTOR_SIM_HOST: "et",
    WPS_CONNECTOR_SIM_SESSION_ID: "test-et-session",
  });
  startNode(["apps/wps-addin/simulator.js"], {
    WPS_CONNECTOR_BRIDGE_URL: bridgeUrl,
    WPS_CONNECTOR_SIM_HOST: "wpp",
    WPS_CONNECTOR_SIM_SESSION_ID: "test-wpp-session",
  });
  startNode(["apps/wps-addin/simulator.js"], {
    WPS_CONNECTOR_BRIDGE_URL: bridgeUrl,
    WPS_CONNECTOR_SIM_HOST: "et",
    WPS_CONNECTOR_SIM_SESSION_ID: "test-et-large-selection",
    WPS_CONNECTOR_SIM_DOCUMENT_KEY: "simulated-et-large-selection.xlsx",
    WPS_CONNECTOR_SIM_SELECTION_ADDRESS: "A:A",
    WPS_CONNECTOR_SIM_SELECTION_ROWS: "1048576",
    WPS_CONNECTOR_SIM_SELECTION_COLUMNS: "1",
  });
  startNode(["apps/wps-addin/simulator.js"], {
    WPS_CONNECTOR_BRIDGE_URL: bridgeUrl,
    WPS_CONNECTOR_SIM_HOST: "et",
    WPS_CONNECTOR_SIM_SESSION_ID: "test-et-parallel",
    WPS_CONNECTOR_SIM_DOCUMENT_KEY: "simulated-et-parallel.xlsx",
  });

  const sessions = await waitForSessions(4);
  assert(sessions.some((session) => session.host === "et"), "ET session was not registered.");
  assert(sessions.some((session) => session.host === "wpp"), "WPP session was not registered.");
  const largeSession = sessions.find((session) => session.sessionId === "test-et-large-selection");
  assert(largeSession?.activeContext?.previewSkipped === true && largeSession.activeContext.cellCount === 1048576, "Large ET selection heartbeat did not skip preview.");
  const agentPaneView = await request("/api/sessions/test-wpp-session/pane-view", { method: "POST", body: JSON.stringify({ view: "agent" }) });
  assert(agentPaneView.view === "agent", "Pane view endpoint did not save the Agent view.");
  const savedPaneView = await request("/api/sessions/test-wpp-session/pane-view");
  assert(savedPaneView.view === "agent" && savedPaneView.updatedAt, "Pane view endpoint did not return the cross-context view state.");
  const connectorPaneView = await request("/api/sessions/test-wpp-session/pane-view", { method: "POST", body: JSON.stringify({ view: "connector" }) });
  assert(connectorPaneView.view === "connector", "Pane view endpoint did not switch back to the connector view.");

  const mcp = startNode(["apps/mcp/server.js"], { WPS_CONNECTOR_BRIDGE_URL: bridgeUrl, WPS_CONNECTOR_MCP_EXPOSE_DOTTED: "true", CODEX_THREAD_ID: "", CODEX_THREAD: "" });
  const mcpClient = createMcpClient(mcp);
  const init = await mcpClient.request("initialize", {});
  assert(init.serverInfo?.name === "wps-connector", "MCP initialize returned unexpected server name.");
  const listedTools = await mcpClient.request("tools/list", {});
  assert(listedTools.tools.some((tool) => tool.name === "et.read_selection"), "MCP tools/list missed et.read_selection.");
  assert(listedTools.tools.some((tool) => tool.name === "et.read_range"), "MCP tools/list missed et.read_range.");
  assert(listedTools.tools.some((tool) => tool.name === "et.save_workbook"), "MCP tools/list missed et.save_workbook.");
  assert(listedTools.tools.some((tool) => tool.name === "wpp.insert_table"), "MCP tools/list missed wpp.insert_table.");
  assert(listedTools.tools.some((tool) => tool.name === "wpp.read_document_text"), "MCP tools/list missed wpp.read_document_text.");
  assert(listedTools.tools.some((tool) => tool.name === "wpp.find_text"), "MCP tools/list missed wpp.find_text.");
  for (const name of ["wpp.select_paragraph", "wpp.select_current_paragraph", "wpp.get_selection_range", "wpp.list_paragraphs", "wpp.get_paragraph_range", "wpp.find_block", "wpp.replace_paragraph", "wpp.replace_current_paragraph", "wpp.replace_block", "wpp.insert_after_paragraph", "wpp.insert_before_paragraph", "wpp.insert_table_after_paragraph", "wpp.insert_table_before_paragraph", "wpp.read_text_format", "wpp.apply_text_format", "wpp.read_paragraph_format", "wpp.apply_paragraph_format_by_indexes", "wpp.copy_paragraph_format", "wpp.copy_selected_paragraph_format_to_indexes", "wpp.compare_paragraph_format", "wpp.list_styles", "wpp.apply_style", "wpp.insert_page_break", "wpp.insert_paragraph_break", "wpp.delete_extra_blank_paragraphs"]) assert(listedTools.tools.some((tool) => tool.name === name), `MCP tools/list missed ${name}.`);
  assert(listedTools.tools.some((tool) => tool.name === "wpp.replace_text"), "MCP tools/list missed wpp.replace_text.");
  assert(listedTools.tools.some((tool) => tool.name === "wpp.replace_between_anchors"), "MCP tools/list missed wpp.replace_between_anchors.");
  assert(listedTools.tools.some((tool) => tool.name === "wpp.read_table_cell"), "MCP tools/list missed wpp.read_table_cell.");
  assert(listedTools.tools.some((tool) => tool.name === "wpp.write_table_cell"), "MCP tools/list missed wpp.write_table_cell.");
  assert(listedTools.tools.some((tool) => tool.name === "wpp.save_document"), "MCP tools/list missed wpp.save_document.");
  assert(listedTools.tools.some((tool) => tool.name === "wpp.add_comment"), "MCP tools/list missed wpp.add_comment.");
  assert(listedTools.tools.some((tool) => tool.name === "wpp.add_comment_by_text"), "MCP tools/list missed wpp.add_comment_by_text.");
  assert(listedTools.tools.some((tool) => tool.name === "wpp.add_comments_batch"), "MCP tools/list missed wpp.add_comments_batch.");
  assert(listedTools.tools.some((tool) => tool.name === "wpp.insert_table_rows"), "MCP tools/list missed wpp.insert_table_rows.");
  assert(listedTools.tools.some((tool) => tool.name === "wpp.insert_image"), "MCP tools/list missed wpp.insert_image.");
  assert(listedTools.tools.some((tool) => tool.name === "wpp.read_table_format"), "MCP tools/list missed wpp.read_table_format.");
  for (const name of ["wps.batch", "wpp.format_table_range", "wpp.format_table_rows", "wpp.format_table_columns", "wpp.read_table_format_sample", "wpp.read_table_format_range", "wpp.read_table_structure", "wpp.read_table_cell_styles", "et.read_format_sample", "et.verify_range"]) assert(listedTools.tools.some((tool) => tool.name === name), `MCP tools/list missed ${name}.`);
  assert(listedTools.tools.some((tool) => tool.name === "wpp.copy_table_style"), "MCP tools/list missed wpp.copy_table_style.");
  assert(listedTools.tools.some((tool) => tool.name === "wpp.duplicate_table_appearance"), "MCP tools/list missed wpp.duplicate_table_appearance.");
  assert(listedTools.tools.some((tool) => tool.name === "wpp.insert_table_with_layout"), "MCP tools/list missed wpp.insert_table_with_layout.");
  assert(listedTools.tools.some((tool) => tool.name === "wpp.reset_table_layout"), "MCP tools/list missed wpp.reset_table_layout.");
  assert(listedTools.tools.some((tool) => tool.name === "wps.connection_status"), "MCP tools/list missed wps.connection_status.");
  assert(listedTools.tools.some((tool) => tool.name === "wps_connection_status"), "MCP tools/list missed underscore alias wps_connection_status.");
  assert(listedTools.tools.some((tool) => tool.name === "wps_list_sessions"), "MCP tools/list missed underscore alias wps_list_sessions.");
  assert(listedTools.tools.some((tool) => tool.name === "wpp_add_comment"), "MCP tools/list missed underscore alias wpp_add_comment.");
  const compactMcp = startNode(["apps/mcp/server.js"], { WPS_CONNECTOR_BRIDGE_URL: bridgeUrl, CODEX_THREAD_ID: "", CODEX_THREAD: "" });
  const compactMcpClient = createMcpClient(compactMcp);
  const compactListedTools = await compactMcpClient.request("tools/list", {});
  assert(compactListedTools.tools.length < listedTools.tools.length && compactListedTools.tools.every((tool) => tool.name.includes("_")), "Default MCP tools/list was not compacted to underscore aliases.");
  const mcpSessions = await mcpClient.request("tools/call", { name: "wps.list_sessions", arguments: {} });
  assert(mcpSessions.content?.[0]?.text?.includes("test-et-session"), "MCP tools/call did not return registered sessions.");
  const mcpSessionsAlias = await mcpClient.request("tools/call", { name: "wps_list_sessions", arguments: { onlyOnline: true } });
  assert(mcpSessionsAlias.content?.[0]?.text?.includes("test-wpp-session"), "MCP underscore tools/call did not return registered sessions.");
  const mcpSessionsWrapped = await mcpClient.request("tools/call", { name: "mcp__wps_connector__wps_list_sessions_ebe1f6191424", arguments: { onlyOnline: true } });
  assert(mcpSessionsWrapped.content?.[0]?.text?.includes("test-et-session"), "MCP wrapped tool name did not route to wps.list_sessions.");
  const mcpSessionsGenerated = await mcpClient.request("tools/call", { name: "wps_list_sessions_ebe1f6191424", arguments: { onlyOnline: true } });
  assert(mcpSessionsGenerated.content?.[0]?.text?.includes("test-et-session"), "MCP generated bare tool name did not route to wps.list_sessions.");
  const mcpConnectionStatus = await mcpClient.request("tools/call", { name: "wps_connection_status", arguments: { onlyOnline: true, host: "wpp" } });
  const mcpConnectionPayload = JSON.parse(mcpConnectionStatus.content?.[0]?.text || "{}");
  assert(mcpConnectionPayload.counts?.online >= 1, "MCP connection_status did not report online sessions.");
  assert(mcpConnectionPayload.agentUsage?.dottedAndUnderscoreNamesSupported === true, "MCP connection_status missed agent usage metadata.");

  const bindEt = await request("/api/sessions/test-et-session/binding", {
    method: "POST",
    body: JSON.stringify({ binding: { projectId: "project-a", projectName: "Project A", projectPath: "/tmp/project-a", threadId: "thread-a" } }),
  });
  assert(bindEt.binding?.projectId === "project-a", "ET binding was not saved.");
  const bindParallelEt = await request("/api/sessions/test-et-parallel/binding", {
    method: "POST",
    body: JSON.stringify({ binding: { projectId: "project-a", projectName: "Project A", projectPath: "/tmp/project-a", threadId: "thread-a", bindingId: bindEt.binding.bindingId } }),
  });
  assert(bindParallelEt.binding?.projectId === "project-a", "Parallel ET binding was not saved.");
  assert(bindParallelEt.binding?.bindingId !== bindEt.binding.bindingId, "Separate ET documents reused the same bindingId.");
  const originalEtBindingAfterParallel = await request("/api/sessions/test-et-session/binding");
  assert(originalEtBindingAfterParallel.binding?.bindingId === bindEt.binding.bindingId, "Binding another ET document overwrote the original document binding.");
  const bindWpp = await request("/api/sessions/test-wpp-session/binding", {
    method: "POST",
    body: JSON.stringify({ binding: { projectId: "project-b", projectName: "Project B", projectPath: "/tmp/project-b", threadId: "thread-b" } }),
  });
  assert(bindWpp.binding?.threadId === "thread-b", "WPP binding was not saved.");
  const agentHistory = await request("/api/agent/test-wpp-session/history");
  assert(agentHistory.thread?.id === "thread-b" && agentHistory.messages?.length === 2, "Agent history did not read the bound Codex conversation.");
  assert(agentHistory.messages[0]?.role === "user" && agentHistory.messages[1]?.text === "历史回答", "Agent history did not normalize Codex messages.");
  const refusedAgentOrigin = await requestAt(bridgeUrl, "/api/agent/test-wpp-session/history", { headers: { origin: "https://example.invalid" } });
  assert(refusedAgentOrigin.ok === false && refusedAgentOrigin.httpStatus === 403 && refusedAgentOrigin.error?.code === "AGENT_ORIGIN_REFUSED", "Agent API accepted a foreign browser origin.");
  const agentMessage = await requestAt(bridgeUrl, "/api/agent/test-wpp-session/message", {
    method: "POST",
    body: JSON.stringify({ text: "新问题", threadId: "spoofed-thread" }),
  });
  assert(agentMessage.ok === true && agentMessage.threadId === "thread-b", "Agent message did not stay anchored to the saved WPS binding.");
  let liveAgentStatus = null;
  for (let i = 0; i < 20; i += 1) {
    liveAgentStatus = await requestAt(bridgeUrl, "/api/agent/test-wpp-session/status");
    if (liveAgentStatus.run?.status === "completed") break;
    await sleep(20);
  }
  assert(liveAgentStatus?.run?.status === "completed" && liveAgentStatus.run.finalText === "模拟回复" && liveAgentStatus.run.delta === "模拟回复", "Agent message did not stream and complete through the Codex App Server bridge.");

  const unboundExecution = await rawRequest("/api/tools/et/list_worksheets", { method: "POST", body: JSON.stringify({ sessionId: "test-et-large-selection" }) });
  assert(unboundExecution.ok === false && unboundExecution.error?.code === "PROJECT_BINDING_REQUIRED", "Unbound execution was not rejected.");
  const unboundAgent = await rawRequest("/api/agent/test-et-large-selection/history");
  assert(unboundAgent.ok === false && unboundAgent.error?.code === "AGENT_THREAD_BINDING_REQUIRED", "Agent history accepted an unbound WPS document.");
  const bindLargeEt = await request("/api/sessions/test-et-large-selection/binding", {
    method: "POST",
    body: JSON.stringify({ binding: { projectId: "project-a", projectName: "Project A", projectPath: "/tmp/project-a", threadId: "thread-a" } }),
  });
  assert(bindLargeEt.binding?.projectId === "project-a", "Large-selection ET binding was not saved.");
  const agentStatus = await runNode(["scripts/agent-tool-call.js", "wps.connection_status", JSON.stringify({ onlyOnline: true })], { WPS_CONNECTOR_BRIDGE_URL: bridgeUrl });
  assert(agentStatus.ok === true && agentStatus.counts?.online >= 2, "Agent gateway did not return live connection status.");
  const agentSheets = await runNode(["scripts/agent-tool-call.js", "et.list_worksheets", JSON.stringify({ sessionId: "test-et-session", projectId: "project-a", threadId: "thread-a" })], { WPS_CONNECTOR_BRIDGE_URL: bridgeUrl });
  assert(agentSheets.ok === true && agentSheets.worksheets?.some((sheet) => sheet.name === "Sheet1"), "Agent gateway did not route bound ET worksheet listing.");
  const trustedProjectAMeta = { threadId: "thread-a", codex_cwd: "/tmp/project-a" };
  const mcpSheetsGenerated = await mcpClient.request("tools/call", { name: "et_list_worksheets_fca6f791e28c", arguments: { sessionId: "test-et-session" }, _meta: trustedProjectAMeta });
  assert(mcpSheetsGenerated.content?.[0]?.text?.includes("Sheet1"), "MCP generated ET tool name did not route to bound et.list_worksheets.");
  const mcpMissingTrustedContext = await mcpClient.request("tools/call", { name: "et_list_worksheets_fca6f791e28c", arguments: { sessionId: "test-et-session", projectId: "project-a", threadId: "thread-a" } });
  assert(mcpMissingTrustedContext.isError === true && mcpMissingTrustedContext.content?.[0]?.text?.includes("MCP_TRUSTED_CONTEXT_REQUIRED"), "MCP document tool accepted caller-supplied binding without trusted task metadata.");
  const mcpSpoofedBinding = await mcpClient.request("tools/call", { name: "wpp_insert_text", arguments: { sessionId: "test-wpp-session", projectId: "project-b", threadId: "thread-b", text: "must-not-write" }, _meta: trustedProjectAMeta });
  assert(mcpSpoofedBinding.isError === true && mcpSpoofedBinding.content?.[0]?.text?.includes("CALLER_BINDING_OVERRIDE_REFUSED"), "MCP accepted a caller-supplied binding from another Codex task.");
  const mcpBoundStatus = await mcpClient.request("tools/call", { name: "wps_connection_status", arguments: { onlyOnline: true, host: "et" }, _meta: trustedProjectAMeta });
  const mcpBoundStatusPayload = JSON.parse(mcpBoundStatus.content?.[0]?.text || "{}");
  assert(mcpBoundStatusPayload.recommendedSession?.binding?.threadId === "thread-a", "MCP connection_status did not filter its recommended session to the trusted current task.");

  const bridgeConnectionStatus = await rawRequest("/api/tools/wps/connection_status", { method: "POST", body: JSON.stringify({ onlyOnline: true, host: "et" }) });
  assert(bridgeConnectionStatus.ok === false && bridgeConnectionStatus.issues?.some((issue) => issue.code === "AMBIGUOUS_SESSION"), `Bridge connection_status did not expose ambiguous multiple-ET routing: ${JSON.stringify(bridgeConnectionStatus)}`);
  assert(bridgeConnectionStatus.issues.find((issue) => issue.code === "AMBIGUOUS_SESSION")?.details?.candidates?.length >= 2, "Bridge connection_status did not return ET candidates for disambiguation.");

  const onlineSessions = await request("/api/tools/wps/list_sessions", { method: "POST", body: JSON.stringify({ onlyOnline: true }) });
  assert(onlineSessions.sessions.every((session) => session.status === "online"), "wps.list_sessions onlyOnline returned non-online session.");
  const boundSessions = await request("/api/tools/wps/list_sessions", { method: "POST", body: JSON.stringify({ onlyBound: true }) });
  assert(boundSessions.sessions.length >= 2 && boundSessions.sessions.every((session) => session.binding), "wps.list_sessions onlyBound missed bindings.");
  const etSessionsOnly = await request("/api/tools/wps/list_sessions", { method: "POST", body: JSON.stringify({ host: "et" }) });
  assert(etSessionsOnly.sessions.every((session) => session.host === "et"), "wps.list_sessions host filter returned wrong host.");

  const boundEtSelection = await request("/api/tools/et/read_selection", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-et-session", projectId: "project-a", threadId: "thread-a" }),
  });
  assert(boundEtSelection.sessionId === "test-et-session", "Bound ET selection did not route to the project-a session.");

  const missingExplicitBinding = await rawRequest("/api/tools/et/read_selection", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-et-session" }),
  });
  assert(missingExplicitBinding.ok === false && missingExplicitBinding.error?.code === "SESSION_BINDING_REQUIRED", "Bound sessionId without binding did not return SESSION_BINDING_REQUIRED.");
  assert(missingExplicitBinding.httpStatus === 409, "SESSION_BINDING_REQUIRED for explicit bound session did not return HTTP 409.");

  const ambiguousEt = await rawRequest("/api/tools/et/read_selection", {
    method: "POST",
    body: JSON.stringify({ projectId: "project-a", threadId: "thread-a" }),
  });
  assert(ambiguousEt.ok === false && ambiguousEt.error?.code === "AMBIGUOUS_SESSION", "Multiple bound ET documents without an explicit selector were not rejected as ambiguous.");
  assert(ambiguousEt.httpStatus === 409 && ambiguousEt.error?.details?.candidates?.length >= 2, "AMBIGUOUS_SESSION did not return the spreadsheet candidates.");

  const parallelStarted = performance.now();
  const [parallelEtA, parallelEtB] = await Promise.all([
    request("/api/tools/et/read_selection", {
      method: "POST",
      body: JSON.stringify({ sessionId: "test-et-session", projectId: "project-a", threadId: "thread-a" }),
    }),
    request("/api/tools/et/read_selection", {
      method: "POST",
      body: JSON.stringify({ sessionId: "test-et-parallel", projectId: "project-a", threadId: "thread-a" }),
    }),
  ]);
  const parallelElapsed = performance.now() - parallelStarted;
  assert(parallelEtA.sessionId === "test-et-session" && parallelEtB.sessionId === "test-et-parallel", "Explicit ET sessionIds did not route to their own spreadsheets.");
  assert(parallelEtA.values?.[0]?.[0] === "Name" && parallelEtB.values?.[0]?.[0] === "Name", "Parallel ET calls did not both execute successfully.");
  assert(parallelElapsed < 5000, `Parallel ET calls took unexpectedly long: ${parallelElapsed}ms.`);

  const wrongExplicitBinding = await rawRequest("/api/tools/et/read_selection", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-et-session", projectId: "project-b", threadId: "thread-b" }),
  });
  assert(wrongExplicitBinding.ok === false && wrongExplicitBinding.error?.code === "SESSION_BINDING_MISMATCH", "Explicit session with wrong project binding did not return SESSION_BINDING_MISMATCH.");
  assert(wrongExplicitBinding.httpStatus === 409, "SESSION_BINDING_MISMATCH did not return HTTP 409.");

  const missingBoundEt = await rawRequest("/api/tools/et/read_selection", {
    method: "POST",
    body: JSON.stringify({ binding: { projectId: "project-b", threadId: "thread-b" } }),
  });
  assert(missingBoundEt.ok === false && missingBoundEt.error?.code === "SESSION_BINDING_REQUIRED", "ET request for a WPP-bound project did not return SESSION_BINDING_REQUIRED.");
  assert(missingBoundEt.httpStatus === 409, "SESSION_BINDING_REQUIRED did not return HTTP 409.");

  const etSelection = await request("/api/tools/et/read_selection", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-et-session", projectId: "project-a", threadId: "thread-a" }),
  });
  assert(etSelection.values?.[0]?.[0] === "Name", "ET selection read returned unexpected values.");
  const etLargeSelection = await request("/api/tools/et/read_selection", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-et-large-selection", projectId: "project-a", threadId: "thread-a" }),
  });
  assert(etLargeSelection.previewSkipped === true && etLargeSelection.values === null && etLargeSelection.cellCount === 1048576 && etLargeSelection.warning, "ET large selection did not return a safe lightweight response.");

  const etScope = await request("/api/sessions/test-et-session/operation-scope", {
    method: "POST",
    body: JSON.stringify({ mode: "selection", context: { sheetName: "Sheet1", address: "A1:B2", textPreview: "Name\tAmount" } }),
  });
  assert(etScope.operationScope?.mode === "selection" && etScope.operationScope?.context?.address === "A1:B2", "ET operation scope was not confirmed.");

  const etScopedRead = await request("/api/tools/et/read_range", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-et-session", projectId: "project-a", threadId: "thread-a" }),
  });
  assert(etScopedRead.address === "A1:B2" && etScopedRead.values?.[0]?.[0] === "Name", "ET scoped read_range did not use confirmed selection address.");

  const etClearScope = await request("/api/sessions/test-et-session/operation-scope", {
    method: "POST",
    body: JSON.stringify({ mode: "document" }),
  });
  assert(etClearScope.operationScope?.mode === "document", "ET operation scope was not cleared.");

  const etWrite = await request("/api/tools/et/write_range", {
    method: "POST",
    body: JSON.stringify({
      sessionId: "test-et-session", projectId: "project-a", threadId: "thread-a",
      address: "C3:E4",
      values: [["Item", "Value", "Total"], ["Beta", 200, null]],
      formulas: [["", "", ""], ["", "", "=B4*2"]],
      numberFormats: [["@", "#,##0.00", "#,##0.00"], ["@", "#,##0.00", "#,##0.00"]],
    }),
  });
  assert(etWrite.address === "C3:E4", "ET write returned unexpected address.");
  assert(etWrite.rowCount === 2 && etWrite.columnCount === 3, "ET write returned unexpected dimensions.");
  assert(etWrite.formulasApplied === true, "ET write did not report formula application.");
  assert(etWrite.numberFormatsApplied === true, "ET write did not report number format application.");

  const sheets = await request("/api/tools/et/list_worksheets", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-et-session", projectId: "project-a", threadId: "thread-a" }),
  });
  assert(sheets.worksheets?.some((sheet) => sheet.name === "Sheet1"), "ET worksheet listing missed Sheet1.");

  const etReadRange = await request("/api/tools/et/read_range", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-et-session", projectId: "project-a", threadId: "thread-a", address: "C3:E4", includeFormulas: true, includeFormats: true }),
  });
  assert(etReadRange.values?.[0]?.[0] === "Item", "ET read_range returned unexpected values.");
  assert(Array.isArray(etReadRange.formulas), "ET read_range did not return formulas when requested.");

  const missingSheet = await rawRequest("/api/tools/et/read_range", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-et-session", projectId: "project-a", threadId: "thread-a", sheetName: "NoSuchSheet", address: "A1:B2" }),
  });
  assert(missingSheet.ok === false && missingSheet.error?.code === "SHEET_NOT_FOUND", "ET missing sheet did not return SHEET_NOT_FOUND.");

  const invalidAddress = await rawRequest("/api/tools/et/read_range", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-et-session", projectId: "project-a", threadId: "thread-a", address: "bad address" }),
  });
  assert(invalidAddress.ok === false && invalidAddress.error?.code === "INVALID_ADDRESS", "ET invalid address did not return INVALID_ADDRESS.");

  const deleteLastSheet = await rawRequest("/api/tools/et/delete_worksheet", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-et-session", projectId: "project-a", threadId: "thread-a", sheetName: "Sheet1" }),
  });
  assert(deleteLastSheet.ok === false && deleteLastSheet.error?.code === "LAST_SHEET_DELETE_REFUSED", "ET deleting the last user sheet did not return LAST_SHEET_DELETE_REFUSED.");

  const etBadValues = await rawRequest("/api/tools/et/write_range", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-et-session", projectId: "project-a", threadId: "thread-a", address: "A10:B10", values: ["bad", "shape"] }),
  });
  assert(etBadValues.ok === false && etBadValues.error?.code === "INVALID_ARGUMENT", "ET one-dimensional values did not return INVALID_ARGUMENT.");

  const etFormat = await request("/api/tools/et/format_range", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-et-session", projectId: "project-a", threadId: "thread-a", address: "C3:E4", bold: true, fillColor: "#D9EAF7", numberFormat: "#,##0.00", horizontalAlignment: "center", border: true, autofit: true }),
  });
  assert(etFormat.formatted === true, "ET format_range did not confirm formatting.");
  const etFormatSample = await request("/api/tools/et/read_format_sample", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-et-session", projectId: "project-a", threadId: "thread-a", cells: [{ address: "C3:E4" }], fields: ["bold", "numberFormat", "horizontalAlignment"] }),
  });
  assert(etFormatSample.count === 1 && etFormatSample.cells[0].format.bold === true, "ET read_format_sample did not return selected format fields.");
  const etVerifyRange = await request("/api/tools/et/verify_range", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-et-session", projectId: "project-a", threadId: "thread-a", address: "C3:E4" }),
  });
  assert(etVerifyRange.ok === true && etVerifyRange.formulaErrorCount === 0, "ET verify_range reported unexpected formula errors.");

  const etFind = await request("/api/tools/et/find_cells", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-et-session", projectId: "project-a", threadId: "thread-a", query: "Beta" }),
  });
  assert(etFind.count >= 1, "ET find_cells did not find written value.");

  const etBlocks = await request("/api/tools/et/write_blocks", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-et-session", projectId: "project-a", threadId: "thread-a", continueOnError: true, blocks: [{ address: "E1:F1", values: [["A", "B"]], format: { bold: true } }, { address: "E2:F2", formulas: [["=1+1", "=2+2"]], format: { border: true } }, { sheetName: "NoSuchSheet", address: "E3:F3", values: [["X", "Y"]] }] }),
  });
  assert(etBlocks.results?.length === 3 && etBlocks.failedCount === 1, "ET write_blocks returned unexpected mixed results.");
  assert(etBlocks.results[2]?.error?.code === "SHEET_NOT_FOUND", "ET write_blocks failed block missed SHEET_NOT_FOUND.");

  const wppSelection = await request("/api/tools/wpp/read_selection", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", projectId: "project-b", threadId: "thread-b" }),
  });
  assert(wppSelection.text === "原选区", "WPP selection read returned unexpected text.");

  const wppWrongHost = await rawRequest("/api/tools/wpp/read_selection", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-et-session", projectId: "project-a", threadId: "thread-a" }),
  });
  assert(wppWrongHost.ok === false && wppWrongHost.error?.code === "SESSION_HOST_MISMATCH", "WPP tool with ET session did not return SESSION_HOST_MISMATCH.");
  assert(wppWrongHost.httpStatus === 409, "SESSION_HOST_MISMATCH did not return HTTP 409.");
  const mcpWrongHost = await mcpClient.request("tools/call", { name: "wpp.read_document_identity", arguments: { sessionId: "test-et-session" }, _meta: trustedProjectAMeta });
  const mcpWrongHostPayload = JSON.parse(mcpWrongHost.content?.[0]?.text || "{}");
  assert(mcpWrongHostPayload.ok === false && mcpWrongHostPayload.error?.code === "SESSION_HOST_MISMATCH", "MCP did not preserve SESSION_HOST_MISMATCH in JSON result.");

  const wppScope = await request("/api/sessions/test-wpp-session/operation-scope", {
    method: "POST",
    body: JSON.stringify({ mode: "selection", context: { start: wppSelection.start, end: wppSelection.end, length: wppSelection.length, textPreview: wppSelection.text } }),
  });
  assert(wppScope.operationScope?.mode === "selection" && wppScope.operationScope?.context?.textPreview === "原选区", "WPP operation scope was not confirmed.");

  const wppInsert = await request("/api/tools/wpp/insert_text", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", projectId: "project-b", threadId: "thread-b", text: "测试插入" }),
  });
  assert(wppInsert.insertedLength === 4, "WPP insert returned unexpected length.");
  assert(wppInsert.operationScope?.mode === "selection", "WPP insert_text did not receive confirmed operation scope.");

  const wppClearScope = await request("/api/sessions/test-wpp-session/operation-scope", {
    method: "POST",
    body: JSON.stringify({ mode: "document" }),
  });
  assert(wppClearScope.operationScope?.mode === "document", "WPP operation scope was not cleared.");

  const wppText = await request("/api/tools/wpp/read_document_text", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", projectId: "project-b", threadId: "thread-b", start: 0, maxLength: 100 }),
  });
  assert(wppText.text.includes("测试插入"), "WPP read_document_text did not return inserted text.");

  const wppSelectRange = await request("/api/tools/wpp/select_range", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", projectId: "project-b", threadId: "thread-b", start: 0, end: 2 }),
  });
  assert(wppSelectRange.selected === true && wppSelectRange.resolvedText === "测试" && wppSelectRange.exactMatch === true, "WPP select_range returned unexpected resolved selection.");




  await request("/api/tools/wpp/insert_text", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", projectId: "project-b", threadId: "thread-b", text: "\nQW-5 原问题五\nQW-6 原问题六\nQW-7 原问题七" }),
  });

  const wppParagraphs = await request("/api/tools/wpp/list_paragraphs", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", projectId: "project-b", threadId: "thread-b", maxCount: 20 }),
  });
  const qw5 = wppParagraphs.paragraphs.find((p) => p.text.includes("QW-5"));
  const qw6 = wppParagraphs.paragraphs.find((p) => p.text.includes("QW-6"));
  const qw7 = wppParagraphs.paragraphs.find((p) => p.text.includes("QW-7"));
  assert(qw5 && qw6 && qw7 && qw6.paragraphIndex === qw5.paragraphIndex + 1, "WPP list_paragraphs did not return stable QW paragraph indexes.");

  const wppQw6Range = await request("/api/tools/wpp/get_paragraph_range", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", projectId: "project-b", threadId: "thread-b", index: qw6.paragraphIndex }),
  });
  assert(wppQw6Range.resolvedTextPreview.includes("QW-6"), "WPP get_paragraph_range did not return QW-6 preview.");

  const wppFindQw6 = await request("/api/tools/wpp/find_block", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", projectId: "project-b", threadId: "thread-b", anchorText: "QW-6", options: { blockType: "paragraph" } }),
  });
  assert(wppFindQw6.affectedParagraphIndex === qw6.paragraphIndex && wppFindQw6.exactMatch === true, "WPP find_block did not locate QW-6 paragraph.");

  const wppReplaceQw6 = await request("/api/tools/wpp/replace_block", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", projectId: "project-b", threadId: "thread-b", anchorText: "QW-6", text: "QW-6 替换后的问题六", options: { blockType: "paragraph" } }),
  });
  assert(wppReplaceQw6.applied === true && wppReplaceQw6.affectedParagraphIndex === qw6.paragraphIndex && wppReplaceQw6.afterText.includes("替换后的问题六"), "WPP replace_block did not replace QW-6 only.");

  const wppInsertTableAfterQw5 = await request("/api/tools/wpp/insert_table_after_paragraph", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", projectId: "project-b", threadId: "thread-b", index: qw5.paragraphIndex, rowCount: 2, columnCount: 2, values: [["字段", "值"], ["A", "B"]], border: true }),
  });
  assert(wppInsertTableAfterQw5.insertedTable === true && wppInsertTableAfterQw5.affectedParagraphIndex === qw5.paragraphIndex, "WPP insert_table_after_paragraph did not anchor after QW-5.");

  const wppFindQw6AfterTable = await request("/api/tools/wpp/find_block", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", projectId: "project-b", threadId: "thread-b", anchorText: "QW-6", options: { blockType: "paragraph" } }),
  });
  const wppFindQw7AfterTable = await request("/api/tools/wpp/find_block", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", projectId: "project-b", threadId: "thread-b", anchorText: "QW-7", options: { blockType: "paragraph" } }),
  });
  assert(wppFindQw6AfterTable.affectedParagraphIndex === qw6.paragraphIndex && wppFindQw7AfterTable.affectedParagraphIndex === qw7.paragraphIndex, "WPP paragraph anchors drifted after table insertion.");

  await request("/api/tools/wpp/select_range", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", projectId: "project-b", threadId: "thread-b", start: 0, end: 2 }),
  });

  const wppSelectionRange = await request("/api/tools/wpp/get_selection_range", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", projectId: "project-b", threadId: "thread-b" }),
  });
  assert(wppSelectionRange.selection?.text === "测试", "WPP get_selection_range returned unexpected selection text.");

  const wppApplyTextFormat = await request("/api/tools/wpp/apply_text_format", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", projectId: "project-b", threadId: "thread-b", start: 0, end: 2, format: { fontName: "宋体", fontSize: 18, bold: true, italic: true, underline: true, color: "#FF0000", highlightColor: "#FFFF00" } }),
  });
  assert(wppApplyTextFormat.applied === true && wppApplyTextFormat.hostAcceptedFields.includes("bold"), "WPP apply_text_format did not accept bold formatting.");

  const wppReadTextFormat = await request("/api/tools/wpp/read_text_format", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", projectId: "project-b", threadId: "thread-b", start: 0, end: 2 }),
  });
  assert(wppReadTextFormat.effectiveFormat?.bold === true && wppReadTextFormat.effectiveFormat?.fontSize === 18, "WPP read_text_format did not return applied font state.");

  const wppSetParagraphRich = await request("/api/tools/wpp/set_paragraph", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", projectId: "project-b", threadId: "thread-b", start: 0, end: 2, format: { alignment: "center", lineSpacingRule: "exactly", lineSpacingValue: 19, spaceAfter: 6, firstLineIndent: 12, keepWithNext: true, pageBreakBefore: false } }),
  });
  assert(wppSetParagraphRich.applied === true && wppSetParagraphRich.hostAcceptedFields.includes("lineSpacingRule") && wppSetParagraphRich.hostAcceptedFields.includes("lineSpacingValue"), "WPP set_paragraph rich format did not apply explicit fixed line spacing.");

  const wppReadParagraphFormat = await request("/api/tools/wpp/read_paragraph_format", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", projectId: "project-b", threadId: "thread-b", start: 0, end: 2 }),
  });
  assert(wppReadParagraphFormat.effectiveFormat?.alignment === "center" || wppReadParagraphFormat.effectiveFormat?.alignment === 1, "WPP read_paragraph_format did not return paragraph state.");

  const wppParagraphPage = await request("/api/tools/wpp/list_paragraphs", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", projectId: "project-b", threadId: "thread-b", start: 1, maxCount: 2, fields: ["index", "text", "range", "formatSummary"] }),
  });
  assert(wppParagraphPage.count === 2 && wppParagraphPage.nextStartIndex === 3 && wppParagraphPage.paragraphs[0].styleName === undefined, "WPP list_paragraphs lightweight pagination did not return the expected field projection.");

  const wppBatchParagraphFormat = await request("/api/tools/wpp/apply_paragraph_format_by_indexes", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", projectId: "project-b", threadId: "thread-b", paragraphIndexes: [1], format: { alignment: "left", firstLineIndent: 24, lineSpacingRule: "multiple", lineSpacingValue: 1.5, spaceBefore: 0, spaceAfter: 6 } }),
  });
  assert(wppBatchParagraphFormat.applied === true && wppBatchParagraphFormat.affectedCount === 1 && wppBatchParagraphFormat.acceptedFields?.includes("lineSpacingValue") && !JSON.stringify(wppBatchParagraphFormat).includes("QW-"), "WPP apply_paragraph_format_by_indexes did not return lightweight fixed fields.");

  const wppCompareBeforeCopy = await request("/api/tools/wpp/compare_paragraph_format", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", projectId: "project-b", threadId: "thread-b", sourceParagraphIndex: 1, targetParagraphIndexes: [2, 3] }),
  });
  assert(wppCompareBeforeCopy.allMatch === false && wppCompareBeforeCopy.diffCount > 0, "WPP compare_paragraph_format did not detect pre-copy differences.");

  const wppCopyParagraphFormat = await request("/api/tools/wpp/copy_paragraph_format", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", projectId: "project-b", threadId: "thread-b", sourceParagraphIndex: 1, targetParagraphIndexes: [2, 3], includeFont: false }),
  });
  assert(wppCopyParagraphFormat.copied === true && wppCopyParagraphFormat.affectedCount === 2 && wppCopyParagraphFormat.fastPath === "contiguous-range" && wppCopyParagraphFormat.hostCallsSaved === 1 && !JSON.stringify(wppCopyParagraphFormat).includes("QW-"), "WPP copy_paragraph_format did not use the contiguous-range fast path.");

  const wppCopySelectedParagraphFormat = await request("/api/tools/wpp/copy_selected_paragraph_format_to_indexes", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", projectId: "project-b", threadId: "thread-b", targetParagraphIndexes: [2], includeFont: false }),
  });
  assert(wppCopySelectedParagraphFormat.copied === true && wppCopySelectedParagraphFormat.sourceParagraphIndex === 1, "WPP copy_selected_paragraph_format_to_indexes did not copy from the selected paragraph.");

  const wppCompareAfterCopy = await request("/api/tools/wpp/compare_paragraph_format", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", projectId: "project-b", threadId: "thread-b", sourceParagraphIndex: 1, targetParagraphIndexes: [2, 3] }),
  });
  assert(wppCompareAfterCopy.allMatch === true, "WPP compare_paragraph_format did not confirm copied paragraph formats.");

  const wppReadCopiedParagraphFormat = await request("/api/tools/wpp/read_paragraph_format", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", projectId: "project-b", threadId: "thread-b", paragraphIndexes: [1, 2, 3] }),
  });
  assert(wppReadCopiedParagraphFormat.perParagraphFormats?.length === 3 && wppReadCopiedParagraphFormat.mixedFields?.length === 0, "WPP read_paragraph_format did not return stable per-paragraph copied formats.");

  const wppStyles = await request("/api/tools/wpp/list_styles", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", projectId: "project-b", threadId: "thread-b" }),
  });
  assert(wppStyles.styles?.some((style) => style.name === "标题1"), "WPP list_styles missed 标题1.");

  const wppApplyStyle = await request("/api/tools/wpp/apply_style", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", projectId: "project-b", threadId: "thread-b", start: 0, end: 2, styleName: "标题1" }),
  });
  assert(wppApplyStyle.applied === true && wppApplyStyle.effectiveFormat?.styleName === "标题1", "WPP apply_style did not apply 标题1.");

  const wppSelectParagraph = await request("/api/tools/wpp/select_paragraph", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", projectId: "project-b", threadId: "thread-b", index: 1 }),
  });
  assert(wppSelectParagraph.selected === true && wppSelectParagraph.paragraphIndex === 1, "WPP select_paragraph did not select paragraph 1.");

  const wppCurrentParagraph = await request("/api/tools/wpp/select_current_paragraph", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", projectId: "project-b", threadId: "thread-b" }),
  });
  assert(wppCurrentParagraph.selected === true, "WPP select_current_paragraph did not confirm selection.");

  const wppParagraphBreak = await request("/api/tools/wpp/insert_paragraph_break", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", projectId: "project-b", threadId: "thread-b" }),
  });
  assert(wppParagraphBreak.inserted === true && wppParagraphBreak.breakType === "paragraph", "WPP insert_paragraph_break did not confirm insertion.");

  const wppPageBreak = await request("/api/tools/wpp/insert_page_break", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", projectId: "project-b", threadId: "thread-b" }),
  });
  assert(wppPageBreak.inserted === true && wppPageBreak.breakType === "page", "WPP insert_page_break did not confirm insertion.");

  const wppCleanBlanks = await request("/api/tools/wpp/delete_extra_blank_paragraphs", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", projectId: "project-b", threadId: "thread-b" }),
  });
  assert(typeof wppCleanBlanks.deletedCount === "number", "WPP delete_extra_blank_paragraphs did not return deletedCount.");

  const wppFindText = await request("/api/tools/wpp/find_text", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", projectId: "project-b", threadId: "thread-b", query: "测试" }),
  });
  assert(wppFindText.count >= 1 && wppFindText.results?.[0]?.text === "测试" && wppFindText.results?.[0]?.rangeId, "WPP find_text did not find inserted document text with a rangeId.");

  const wppSelectFoundRange = await request("/api/tools/wpp/select_range", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", projectId: "project-b", threadId: "thread-b", rangeId: wppFindText.results[0].rangeId, expectedText: "测试", failOnInexact: true }),
  });
  assert(wppSelectFoundRange.exactMatch === true && wppSelectFoundRange.resolvedText === "测试", "WPP select_range did not select the find_text rangeId exactly.");

  const wppReplaceText = await request("/api/tools/wpp/replace_text", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", projectId: "project-b", threadId: "thread-b", findText: "测试", replaceText: "验收", occurrence: "first" }),
  });
  assert(wppReplaceText.replacedCount === 1 && wppReplaceText.replacements?.[0]?.before === "测试", "WPP replace_text did not replace the first occurrence.");

  const wppFindAfterReplace = await request("/api/tools/wpp/find_text", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", projectId: "project-b", threadId: "thread-b", query: "验收" }),
  });
  assert(wppFindAfterReplace.count >= 1, "WPP find_text did not find replacement text.");

  const wppReplaceBetweenAnchors = await request("/api/tools/wpp/replace_between_anchors", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", projectId: "project-b", threadId: "thread-b", startAnchorText: "验收", endAnchorText: "插入", replacementText: "", includeStart: false, includeEnd: false, verifyVisibleText: true }),
  });
  assert(wppReplaceBetweenAnchors.replaced === true && wppReplaceBetweenAnchors.verification?.containsReplacement === true, "WPP replace_between_anchors did not replace and verify visible text.");

  const wppMissingText = await rawRequest("/api/tools/wpp/replace_text", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", projectId: "project-b", threadId: "thread-b", findText: "不存在文本", replaceText: "X" }),
  });
  assert(wppMissingText.ok === false && wppMissingText.error?.code === "TEXT_NOT_FOUND", "WPP missing replace text did not return TEXT_NOT_FOUND.");

  const wppReselectForComment = await request("/api/tools/wpp/select_range", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", projectId: "project-b", threadId: "thread-b", start: 0, end: 2 }),
  });
  assert(wppReselectForComment.resolvedText === "验收", "WPP reselect before comment returned unexpected text.");

  const wppCommentSelection = await request("/api/tools/wpp/add_comment", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", projectId: "project-b", threadId: "thread-b", text: "当前选区批注", author: "Codex Test" }),
  });
  assert(wppCommentSelection.added === true && wppCommentSelection.rangeText === "验收", "WPP add_comment did not comment current selection.");

  const wppCommentRange = await request("/api/tools/wpp/add_comment", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", projectId: "project-b", threadId: "thread-b", start: 2, end: 4, text: "指定范围批注" }),
  });
  assert(wppCommentRange.added === true && wppCommentRange.rangeText === "插入" && wppCommentRange.exactMatch === true, "WPP add_comment did not comment specified range.");
  const wppCommentThird = await request("/api/tools/wpp/add_comment", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", projectId: "project-b", threadId: "thread-b", start: 0, end: 4, text: "第三条批注" }),
  });
  assert(wppCommentThird.added === true && wppCommentThird.commentId !== wppCommentRange.commentId, "WPP third add_comment did not return a unique commentId.");

  const wppCommentByText = await request("/api/tools/wpp/add_comment_by_text", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", projectId: "project-b", threadId: "thread-b", query: "验收", text: "按文本批注", occurrence: "first" }),
  });
  assert(wppCommentByText.added === true && wppCommentByText.rangeText === "验收" && wppCommentByText.exactMatch === true, "WPP add_comment_by_text did not verify the target text.");

  const wppCommentBatch = await request("/api/tools/wpp/add_comments_batch", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", projectId: "project-b", threadId: "thread-b", items: [{ query: "验收", text: "批量批注1" }, { query: "插入", text: "批量批注2" }], verify: true }),
  });
  assert(wppCommentBatch.addedCount === 2 && wppCommentBatch.results.every((item) => item.ok && item.exactMatch), "WPP add_comments_batch did not add verified comments.");

  const wppCommentsBeforeDelete = await request("/api/tools/wpp/read_comments", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", projectId: "project-b", threadId: "thread-b", summaryOnly: true }),
  });
  const commentIds = new Set(wppCommentsBeforeDelete.comments.map((comment) => comment.commentId));
  assert(wppCommentsBeforeDelete.count === 6 && commentIds.size === 6 && wppCommentsBeforeDelete.summaryOnly === true && wppCommentsBeforeDelete.comments.some((comment) => comment.commentId === wppCommentRange.commentId && comment.rangeText === "插入"), "WPP read_comments did not return stable unique comments.");

  const wppDeleteComment = await request("/api/tools/wpp/delete_comment", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", projectId: "project-b", threadId: "thread-b", index: 1 }),
  });
  assert(wppDeleteComment.deleted === true, "WPP delete_comment did not confirm deletion.");

  const wppCommentsAfterDelete = await request("/api/tools/wpp/read_comments", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", projectId: "project-b", threadId: "thread-b" }),
  });
  assert(wppCommentsAfterDelete.count === 5 && !wppCommentsAfterDelete.comments.some((comment) => comment.text === "当前选区批注"), "WPP read_comments still returned deleted comment.");

  const wppEmptyComment = await rawRequest("/api/tools/wpp/add_comment", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", projectId: "project-b", threadId: "thread-b", text: "" }),
  });
  assert(wppEmptyComment.ok === false && wppEmptyComment.error?.code === "INVALID_ARGUMENT", "WPP empty comment did not return INVALID_ARGUMENT.");
  assert(wppEmptyComment.httpStatus === 400, "INVALID_ARGUMENT did not return HTTP 400.");

  const wppBadCommentRange = await rawRequest("/api/tools/wpp/add_comment", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", projectId: "project-b", threadId: "thread-b", start: 4, end: 2, text: "bad" }),
  });
  assert(wppBadCommentRange.ok === false && wppBadCommentRange.error?.code === "INVALID_ARGUMENT", "WPP invalid comment range did not return INVALID_ARGUMENT.");

  const wppMissingComment = await rawRequest("/api/tools/wpp/delete_comment", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", projectId: "project-b", threadId: "thread-b", index: 999 }),
  });
  assert(wppMissingComment.ok === false && wppMissingComment.error?.code === "COMMENT_NOT_FOUND", "WPP missing comment did not return COMMENT_NOT_FOUND.");
  assert(wppMissingComment.httpStatus === 404, "COMMENT_NOT_FOUND did not return HTTP 404.");

  const wppTrackOn = await request("/api/tools/wpp/set_track_changes", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", projectId: "project-b", threadId: "thread-b", enabled: true }),
  });
  assert(wppTrackOn.enabled === true, "WPP set_track_changes did not enable revisions.");
  await request("/api/tools/wpp/insert_text", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", projectId: "project-b", threadId: "thread-b", text: "修订文本" }),
  });
  const wppRevisions = await request("/api/tools/wpp/read_revisions", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", projectId: "project-b", threadId: "thread-b" }),
  });
  assert(wppRevisions.count >= 1 && wppRevisions.revisions.some((revision) => revision.rangeText === "修订文本"), "WPP read_revisions did not return tracked insertion.");
  const wppAcceptAll = await request("/api/tools/wpp/accept_all_revisions", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", projectId: "project-b", threadId: "thread-b" }),
  });
  assert(wppAcceptAll.acceptedAll === true, "WPP accept_all_revisions did not confirm acceptance.");

  const wppIdentity = await request("/api/tools/wpp/read_document_identity", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", projectId: "project-b", threadId: "thread-b" }),
  });
  assert(wppIdentity.documentIdentity?.name === "simulated-writer.docx", "WPP identity returned unexpected document name.");

  const wppFormat = await request("/api/tools/wpp/format_selection", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", projectId: "project-b", threadId: "thread-b", fontName: "宋体", fontSize: 12, bold: true }),
  });
  assert(wppFormat.formatted === true, "WPP format_selection did not confirm formatting.");

  const wppReadFormat = await request("/api/tools/wpp/read_format", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", projectId: "project-b", threadId: "thread-b" }),
  });
  assert(wppReadFormat.font?.bold === true, "WPP read_format did not return formatted font state.");

  const wppBadTableValues = await rawRequest("/api/tools/wpp/insert_table", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", projectId: "project-b", threadId: "thread-b", rowCount: 2, columnCount: 2, values: ["bad", "shape"] }),
  });
  assert(wppBadTableValues.ok === false && wppBadTableValues.error?.code === "INVALID_ARGUMENT", "WPP one-dimensional table values did not return INVALID_ARGUMENT.");

  const wppTable = await request("/api/tools/wpp/insert_table", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", projectId: "project-b", threadId: "thread-b", rowCount: 2, columnCount: 2, values: [["A", "B"], ["C", "D"]], headerRowBold: true, alignment: "center", border: true }),
  });
  assert(wppTable.insertedTable === true && wppTable.tableIndex === 1, "WPP insert_table did not confirm insertion with tableIndex.");

  const wppReadTable = await request("/api/tools/wpp/read_table", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", projectId: "project-b", threadId: "thread-b", tableIndex: 1 }),
  });
  assert(wppReadTable.rowCount === 2 && wppReadTable.values?.[1]?.[1] === "D", "WPP read_table returned unexpected values.");


  const wppReadTableCell = await request("/api/tools/wpp/read_table_cell", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", projectId: "project-b", threadId: "thread-b", tableIndex: 1, row: 2, column: 2 }),
  });
  assert(wppReadTableCell.text === "D" && wppReadTableCell.format, "WPP read_table_cell returned unexpected cell data.");

  const wppWriteTableCell = await request("/api/tools/wpp/write_table_cell", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", projectId: "project-b", threadId: "thread-b", tableIndex: 1, row: 2, column: 2, text: "评分80", preserveStyle: true }),
  });
  assert(wppWriteTableCell.written === true && wppWriteTableCell.beforeText === "D" && wppWriteTableCell.afterText === "评分80", "WPP write_table_cell did not return expected before/after text.");

  const wppReadTableCellAfter = await request("/api/tools/wpp/read_table_cell", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", projectId: "project-b", threadId: "thread-b", tableIndex: 1, row: 2, column: 2 }),
  });
  assert(wppReadTableCellAfter.text === "评分80", "WPP read_table_cell did not verify written text.");

  const wppInsertRows = await request("/api/tools/wpp/insert_table_rows", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", projectId: "project-b", threadId: "thread-b", tableIndex: 1, rowIndex: 1, count: 1, position: "after" }),
  });
  assert(wppInsertRows.rowCount === 3, "WPP insert_table_rows did not update row count.");

  const wppDeleteRows = await request("/api/tools/wpp/delete_table_rows", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", projectId: "project-b", threadId: "thread-b", tableIndex: 1, rowIndex: 2, count: 1 }),
  });
  assert(wppDeleteRows.rowCount === 2, "WPP delete_table_rows did not update row count.");

  const wppInsertColumns = await request("/api/tools/wpp/insert_table_columns", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", projectId: "project-b", threadId: "thread-b", tableIndex: 1, columnIndex: 1, count: 1, position: "after" }),
  });
  assert(wppInsertColumns.columnCount === 3, "WPP insert_table_columns did not update column count.");

  const wppDeleteColumns = await request("/api/tools/wpp/delete_table_columns", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", projectId: "project-b", threadId: "thread-b", tableIndex: 1, columnIndex: 2, count: 1 }),
  });
  assert(wppDeleteColumns.columnCount === 2, "WPP delete_table_columns did not update column count.");

  const wppMergeCells = await request("/api/tools/wpp/merge_table_cells", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", projectId: "project-b", threadId: "thread-b", tableIndex: 1, startRow: 1, startColumn: 1, endRow: 1, endColumn: 2 }),
  });
  assert(wppMergeCells.merged === true, "WPP merge_table_cells did not confirm merge.");

  const wppFormatTable = await request("/api/tools/wpp/format_table", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", projectId: "project-b", threadId: "thread-b", tableIndex: 1, border: true, alignment: "center", headerRowBold: true, autofit: true }),
  });
  assert(wppFormatTable.formattedTable === true && wppFormatTable.applied?.includes("border"), "WPP format_table did not confirm formatting.");
  const wppFormatRows = await request("/api/tools/wpp/format_table_rows", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", projectId: "project-b", threadId: "thread-b", tableIndex: 1, rows: [1], format: { font: { bold: true }, paragraph: { alignment: 1 } } }),
  });
  assert(wppFormatRows.affectedCells === 2 && wppFormatRows.applied === true && wppFormatRows.fastPath === "table-range", "WPP format_table_rows did not use the table-range fast path.");
  const wppFormatColumns = await request("/api/tools/wpp/format_table_columns", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", projectId: "project-b", threadId: "thread-b", tableIndex: 1, columns: [2], startRow: 2, endRow: 2, format: { paragraph: { alignment: 2 } } }),
  });
  assert(wppFormatColumns.affectedCells === 1 && wppFormatColumns.applied === true, "WPP format_table_columns did not format the numeric column.");
  const wppFormatRange = await request("/api/tools/wpp/format_table_range", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", projectId: "project-b", threadId: "thread-b", tableIndex: 1, startRow: 2, endRow: 2, startCol: 1, endCol: 1, format: { paragraph: { leftIndent: 12, firstLineIndent: 0 }, padding: { left: 6 } } }),
  });
  assert(wppFormatRange.affectedCells === 1 && wppFormatRange.affectedRange.startRow === 2, "WPP format_table_range did not format the target cell.");
  const wppTableSample = await request("/api/tools/wpp/read_table_format_sample", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", projectId: "project-b", threadId: "thread-b", tableIndex: 1, cells: [{ row: 1, column: 1 }, { row: 2, column: 1 }, { row: 2, column: 2 }], fields: ["font.bold", "paragraph.alignment", "paragraph.leftIndent", "padding.left"] }),
  });
  assert(wppTableSample.count === 3 && wppTableSample.cells[0].format.font.bold === true && wppTableSample.cells[1].format.paragraph.leftIndent === 12 && wppTableSample.cells[2].format.paragraph.alignment === 2, "WPP read_table_format_sample did not verify lightweight fields.");
  const wppLightTableFormat = await request("/api/tools/wpp/read_table_format", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", projectId: "project-b", threadId: "thread-b", tableIndex: 1, summaryOnly: true, cells: [{ row: 1, column: 1 }], fields: ["font.bold", "paragraph.alignment"] }),
  });
  assert(wppLightTableFormat.count === 1 && wppLightTableFormat.cells[0].format.font.bold === true, "WPP read_table_format summaryOnly did not use lightweight cell readback.");
  const wppTableRangeFormat = await request("/api/tools/wpp/read_table_format_range", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", projectId: "project-b", threadId: "thread-b", tableIndex: 1, startRow: 1, endRow: 2, startCol: 1, endCol: 2, fields: ["font.bold", "paragraph.alignment"] }),
  });
  assert(wppTableRangeFormat.count === 4, "WPP read_table_format_range did not return the expected cell count.");
  const wppTableStructure = await request("/api/tools/wpp/read_table_structure", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", projectId: "project-b", threadId: "thread-b", tableIndex: 1, includeColumnWidths: true }),
  });
  assert(wppTableStructure.rowCount === 2 && Array.isArray(wppTableStructure.columnWidths), "WPP read_table_structure did not return lightweight structure.");
  const wpsBatchDryRun = await request("/api/tools/wps/batch", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", projectId: "project-b", threadId: "thread-b", dryRun: true, operations: [{ operationId: "header", tool: "wpp.format_table_rows", input: { tableIndex: 1, rows: [1], format: { font: { bold: true } } } }] }),
  });
  assert(wpsBatchDryRun.dryRun === true && wpsBatchDryRun.results[0].wouldRun === true, "WPS batch dryRun did not validate operations.");
  const wpsBatch = await request("/api/tools/wps/batch", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", projectId: "project-b", threadId: "thread-b", operations: [{ operationId: "first-col", tool: "wpp.format_table_columns", input: { tableIndex: 1, columns: [1], format: { paragraph: { alignment: 0 } } } }, { operationId: "data-col", tool: "wpp.format_table_columns", input: { tableIndex: 1, columns: [2], startRow: 2, format: { paragraph: { alignment: 2 } } } }], verifyAfter: [{ operationId: "sample", tool: "wpp.read_table_format_sample", input: { tableIndex: 1, cells: [{ row: 2, column: 1 }, { row: 2, column: 2 }], fields: ["paragraph.alignment"] } }] }),
  });
  assert(wpsBatch.batch === true && wpsBatch.failedCount === 0 && wpsBatch.verification[0].result.cells[0].format.paragraph.alignment === 0, "WPS batch did not execute and verify table formatting.");

  const wppBadMerge = await rawRequest("/api/tools/wpp/merge_table_cells", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", projectId: "project-b", threadId: "thread-b", tableIndex: 1, startRow: 2, startColumn: 2, endRow: 1, endColumn: 1 }),
  });
  assert(wppBadMerge.ok === false && wppBadMerge.error?.code === "INVALID_ARGUMENT", "WPP invalid merge range did not return INVALID_ARGUMENT.");
  assert(wppBadMerge.httpStatus === 400, "INVALID_ARGUMENT table merge did not return HTTP 400.");

  const wppTableFormat = await request("/api/tools/wpp/read_table_format", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", projectId: "project-b", threadId: "thread-b", tableIndex: 1 }),
  });
  assert(wppTableFormat.format?.cells?.length >= 1, "WPP read_table_format did not return cell formats.");

  const wppRowHeights = await request("/api/tools/wpp/read_row_heights", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", projectId: "project-b", threadId: "thread-b", tableIndex: 1 }),
  });
  assert(Array.isArray(wppRowHeights.rowHeights), "WPP read_row_heights did not return row heights.");

  const wppSetWidths = await request("/api/tools/wpp/set_column_widths", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", projectId: "project-b", threadId: "thread-b", tableIndex: 1, columnWidths: [{ column: 1, width: 88 }, { column: 2, width: 99 }] }),
  });
  assert(wppSetWidths.appliedColumns?.length === 2, "WPP set_column_widths did not apply widths.");
  assert(wppSetWidths.verifiedColumns?.length === 2 && Array.isArray(wppSetWidths.results), "WPP set_column_widths did not return readback verification.");

  const wppLayoutTable = await request("/api/tools/wpp/insert_table_with_layout", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", projectId: "project-b", threadId: "thread-b", rowCount: 3, columnCount: 7, values: [["H1", "H2", "H3", "H4", "H5", "H6", "H7"], ["A", "B", "C", "D", "E", "F", "G"], ["1", "2", "3", "4", "5", "6", "7"]], fitToPageWidth: true, firstColumnWidth: 90, equalDataColumnWidths: 54, fontName: "宋体", fontSize: 10.5, horizontalText: true, rowHeightRule: "auto", cellPadding: { left: 4, right: 4 }, border: true, headerRowBold: true }),
  });
  assert(wppLayoutTable.insertedTableWithLayout === true && wppLayoutTable.columnCount === 7, "WPP insert_table_with_layout did not create 7-column layout table.");
  assert(wppLayoutTable.widthResult?.verifiedColumns?.length === 7, "WPP insert_table_with_layout did not verify column widths.");

  const wppResetLayout = await request("/api/tools/wpp/reset_table_layout", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", projectId: "project-b", threadId: "thread-b", tableIndex: wppLayoutTable.tableIndex, fitToPageWidth: true, horizontalText: true, rowHeightRule: "auto" }),
  });
  assert(wppResetLayout.resetLayout === true && !wppResetLayout.warnings?.length, "WPP reset_table_layout did not reset layout cleanly.");

  const wppSecondTable = await request("/api/tools/wpp/insert_table", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", projectId: "project-b", threadId: "thread-b", rowCount: 2, columnCount: 2, values: [["T2A", "T2B"], ["T2C", "T2D"]], border: false }),
  });
  assert(wppSecondTable.tableIndex > wppLayoutTable.tableIndex, "WPP second insert_table did not create a later table.");

  const wppDuplicateAppearance = await request("/api/tools/wpp/duplicate_table_appearance", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", projectId: "project-b", threadId: "thread-b", sourceTableIndex: 1, targetTableIndex: wppSecondTable.tableIndex, keepContent: true }),
  });
  assert(wppDuplicateAppearance.duplicatedAppearance === true && wppDuplicateAppearance.keepContent === true, "WPP duplicate_table_appearance did not confirm copy.");

  const wppSafeCopy = await request("/api/tools/wpp/copy_table_style", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", projectId: "project-b", threadId: "thread-b", sourceTableIndex: 1, targetTableIndex: wppSecondTable.tableIndex }),
  });
  assert(wppSafeCopy.copied === true && wppSafeCopy.layoutCopied === false, "WPP copy_table_style default should not copy layout dimensions.");

  const wppSecondRead = await request("/api/tools/wpp/read_table", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", projectId: "project-b", threadId: "thread-b", tableIndex: wppSecondTable.tableIndex }),
  });
  assert(wppSecondRead.values?.[0]?.[0] === "T2A" && wppSecondRead.values?.[1]?.[1] === "T2D", "WPP duplicate_table_appearance changed target table content.");

  const wppSecondFormat = await request("/api/tools/wpp/read_table_format", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", projectId: "project-b", threadId: "thread-b", tableIndex: wppSecondTable.tableIndex }),
  });
  assert(wppSecondFormat.format?.table?.alignment === wppTableFormat.format?.table?.alignment, "WPP copied table format did not match source alignment.");

  const wppImage = await request("/api/tools/wpp/insert_image", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", projectId: "project-b", threadId: "thread-b", path: "/tmp/wps-test-image.png", width: 120, height: 80, lockAspectRatio: true }),
  });
  assert(wppImage.insertedImage === true && wppImage.width === 120, "WPP insert_image did not confirm insertion.");

  const wppImages = await request("/api/tools/wpp/read_images", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", projectId: "project-b", threadId: "thread-b" }),
  });
  assert(wppImages.count === 1 && wppImages.images?.[0]?.source === "/tmp/wps-test-image.png", "WPP read_images did not return inserted image.");

  const wppFormatImage = await request("/api/tools/wpp/format_image", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", projectId: "project-b", threadId: "thread-b", imageIndex: 1, width: 144, height: 96, lockAspectRatio: false }),
  });
  assert(wppFormatImage.formattedImage === true && wppFormatImage.width === 144, "WPP format_image did not update image width.");

  const wppBadImage = await rawRequest("/api/tools/wpp/insert_image", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", projectId: "project-b", threadId: "thread-b" }),
  });
  assert(wppBadImage.ok === false && wppBadImage.error?.code === "INVALID_ARGUMENT", "WPP empty image source did not return INVALID_ARGUMENT.");
  assert(wppBadImage.httpStatus === 400, "INVALID_ARGUMENT image source did not return HTTP 400.");

  const wppMissingImage = await rawRequest("/api/tools/wpp/format_image", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", projectId: "project-b", threadId: "thread-b", imageIndex: 999, width: 100 }),
  });
  assert(wppMissingImage.ok === false && wppMissingImage.error?.code === "IMAGE_NOT_FOUND", "WPP missing image did not return IMAGE_NOT_FOUND.");
  assert(wppMissingImage.httpStatus === 404, "IMAGE_NOT_FOUND did not return HTTP 404.");

  const wppDeleteImage = await request("/api/tools/wpp/delete_image", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", projectId: "project-b", threadId: "thread-b", imageIndex: 1 }),
  });
  assert(wppDeleteImage.deletedImage === true, "WPP delete_image did not confirm deletion.");

  const wppImagesAfterDelete = await request("/api/tools/wpp/read_images", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", projectId: "project-b", threadId: "thread-b" }),
  });
  assert(wppImagesAfterDelete.count === 0, "WPP read_images still returned deleted image.");


  const etSave = await request("/api/tools/et/save_workbook", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-et-session", projectId: "project-a", threadId: "thread-a", checksum: true }),
  });
  assert(etSave.saved === true && etSave.path && etSave.savedAt && etSave.readback?.checksum, "ET save_workbook did not return save metadata and checksum.");

  const etBatchSave = await request("/api/tools/wps/batch", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-et-session", projectId: "project-a", threadId: "thread-a", saveAfter: true, operations: [{ tool: "et.write_range", input: { address: "H1", values: [["batch-save"]] } }] }),
  });
  assert(etBatchSave.saveResult?.saved === true && etBatchSave.saveResult?.host === "et", "ET wps.batch saveAfter did not call et.save_workbook.");

  const wppSave = await request("/api/tools/wpp/save_document", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", projectId: "project-b", threadId: "thread-b", checksum: true }),
  });
  assert(wppSave.saved === true && wppSave.path && wppSave.savedAt && wppSave.readbackVisibleText?.checksum, "WPP save_document did not return save metadata and checksum.");

  const wppBadTable = await rawRequest("/api/tools/wpp/insert_table", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", projectId: "project-b", threadId: "thread-b", rowCount: 0, columnCount: 2 }),
  });
  assert(wppBadTable.ok === false && wppBadTable.error?.code === "INVALID_ARGUMENT", "WPP invalid table dimensions did not return INVALID_ARGUMENT.");

  console.log(JSON.stringify({
    ok: true,
    sessions: sessions.map((session) => ({ sessionId: session.sessionId, host: session.host })),
    connectionStatus: { matched: bridgeConnectionStatus.counts?.matched, recommended: bridgeConnectionStatus.recommendedSession?.sessionId || null },
    agentChat: { historyMessages: agentHistory.messages.length, status: liveAgentStatus.run.status, finalText: liveAgentStatus.run.finalText },
    bindingRouting: { etSessionId: boundEtSelection.sessionId, mismatchCode: wrongExplicitBinding.error?.code, missingCode: missingBoundEt.error?.code },
    operationScope: { etScopedAddress: etScopedRead.address, wppInsertScope: wppInsert.operationScope?.mode },
    etSelection: { address: etSelection.address, firstCell: etSelection.values[0][0] },
    etWrite: { address: etWrite.address, rowCount: etWrite.rowCount, columnCount: etWrite.columnCount },
    etReadRange: { address: etReadRange.address, firstCell: etReadRange.values[0][0] },
    etFind: { count: etFind.count },
    wppSelection: { text: wppSelection.text },
    wppInsert: { insertedLength: wppInsert.insertedLength },
    wppText: { length: wppText.length, findCount: wppFindText.count, replacedCount: wppReplaceText.replacedCount },
    wppLayout: { textAccepted: wppApplyTextFormat.hostAcceptedFields.length, paragraphAccepted: wppSetParagraphRich.hostAcceptedFields.length, batchParagraphs: wppCopyParagraphFormat.affectedParagraphIndexes.length, style: wppApplyStyle.effectiveFormat?.styleName, pageBreak: wppPageBreak.inserted },
    wppParagraphBlocks: { qw6: wppFindQw6.affectedParagraphIndex, replaced: wppReplaceQw6.applied, tableAfterQw5: wppInsertTableAfterQw5.insertedTable, qw7AfterTable: wppFindQw7AfterTable.affectedParagraphIndex },
    wppComments: { beforeDelete: wppCommentsBeforeDelete.count, afterDelete: wppCommentsAfterDelete.count },
    wppRevisions: { beforeAcceptAll: wppRevisions.count },
    wppTable: { rowCount: wppTable.rowCount, columnCount: wppTable.columnCount },
    wppReadTable: { rowCount: wppReadTable.rowCount, columnCount: wppReadTable.columnCount },
    wppTableOps: { rows: wppDeleteRows.rowCount, columns: wppDeleteColumns.columnCount, merged: wppMergeCells.merged, cellAfter: wppReadTableCellAfter.text },
    wppImages: { inserted: wppImage.insertedImage, afterDelete: wppImagesAfterDelete.count },
    etSave: { saved: etSave.saved, path: etSave.path },
    wppSave: { saved: wppSave.saved, path: wppSave.path },
  }, null, 2));
}

try {
  await main();
} finally {
  for (const server of servers.reverse()) {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
  for (const child of children.reverse()) {
    if (!child.killed) child.kill("SIGTERM");
    await Promise.race([once(child, "exit"), sleep(500)]).catch(() => {});
  }
}
