import { spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { setTimeout as sleep } from "node:timers/promises";

const port = 40216;
const bridgeUrl = `http://127.0.0.1:${port}`;
const children = [];

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
  const bridge = startNode(["apps/bridge/server.js"], { WPS_CONNECTOR_PORT: String(port) });
  bridge.on("exit", (code) => {
    if (code !== null && code !== 0) process.stderr.write(`bridge exited with code ${code}\n`);
  });
  await waitForHealth();

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

  const sessions = await waitForSessions(2);
  assert(sessions.some((session) => session.host === "et"), "ET session was not registered.");
  assert(sessions.some((session) => session.host === "wpp"), "WPP session was not registered.");

  const mcp = startNode(["apps/mcp/server.js"], { WPS_CONNECTOR_BRIDGE_URL: bridgeUrl });
  const mcpClient = createMcpClient(mcp);
  const init = await mcpClient.request("initialize", {});
  assert(init.serverInfo?.name === "wps-connector", "MCP initialize returned unexpected server name.");
  const listedTools = await mcpClient.request("tools/list", {});
  assert(listedTools.tools.some((tool) => tool.name === "et.read_selection"), "MCP tools/list missed et.read_selection.");
  assert(listedTools.tools.some((tool) => tool.name === "et.read_range"), "MCP tools/list missed et.read_range.");
  assert(listedTools.tools.some((tool) => tool.name === "wpp.insert_table"), "MCP tools/list missed wpp.insert_table.");
  assert(listedTools.tools.some((tool) => tool.name === "wpp.read_document_text"), "MCP tools/list missed wpp.read_document_text.");
  assert(listedTools.tools.some((tool) => tool.name === "wpp.add_comment"), "MCP tools/list missed wpp.add_comment.");
  assert(listedTools.tools.some((tool) => tool.name === "wpp.insert_table_rows"), "MCP tools/list missed wpp.insert_table_rows.");
  assert(listedTools.tools.some((tool) => tool.name === "wpp.insert_image"), "MCP tools/list missed wpp.insert_image.");
  assert(listedTools.tools.some((tool) => tool.name === "wps_list_sessions"), "MCP tools/list missed underscore alias wps_list_sessions.");
  assert(listedTools.tools.some((tool) => tool.name === "wpp_add_comment"), "MCP tools/list missed underscore alias wpp_add_comment.");
  const mcpSessions = await mcpClient.request("tools/call", { name: "wps.list_sessions", arguments: {} });
  assert(mcpSessions.content?.[0]?.text?.includes("test-et-session"), "MCP tools/call did not return registered sessions.");
  const mcpSessionsAlias = await mcpClient.request("tools/call", { name: "wps_list_sessions", arguments: { onlyOnline: true } });
  assert(mcpSessionsAlias.content?.[0]?.text?.includes("test-wpp-session"), "MCP underscore tools/call did not return registered sessions.");

  const bindEt = await request("/api/sessions/test-et-session/binding", {
    method: "POST",
    body: JSON.stringify({ binding: { projectId: "project-a", projectName: "Project A", projectPath: "/tmp/project-a", threadId: "thread-a" } }),
  });
  assert(bindEt.binding?.projectId === "project-a", "ET binding was not saved.");
  const bindWpp = await request("/api/sessions/test-wpp-session/binding", {
    method: "POST",
    body: JSON.stringify({ binding: { projectId: "project-b", projectName: "Project B", projectPath: "/tmp/project-b", threadId: "thread-b" } }),
  });
  assert(bindWpp.binding?.threadId === "thread-b", "WPP binding was not saved.");

  const onlineSessions = await request("/api/tools/wps/list_sessions", { method: "POST", body: JSON.stringify({ onlyOnline: true }) });
  assert(onlineSessions.sessions.every((session) => session.status === "online"), "wps.list_sessions onlyOnline returned non-online session.");
  const boundSessions = await request("/api/tools/wps/list_sessions", { method: "POST", body: JSON.stringify({ onlyBound: true }) });
  assert(boundSessions.sessions.length >= 2 && boundSessions.sessions.every((session) => session.binding), "wps.list_sessions onlyBound missed bindings.");
  const etSessionsOnly = await request("/api/tools/wps/list_sessions", { method: "POST", body: JSON.stringify({ host: "et" }) });
  assert(etSessionsOnly.sessions.every((session) => session.host === "et"), "wps.list_sessions host filter returned wrong host.");

  const boundEtSelection = await request("/api/tools/et/read_selection", {
    method: "POST",
    body: JSON.stringify({ binding: { projectId: "project-a", threadId: "thread-a" } }),
  });
  assert(boundEtSelection.sessionId === "test-et-session", "Bound ET selection did not route to the project-a session.");

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
    body: JSON.stringify({ sessionId: "test-et-session" }),
  });
  assert(etSelection.values?.[0]?.[0] === "Name", "ET selection read returned unexpected values.");

  const etScope = await request("/api/sessions/test-et-session/operation-scope", {
    method: "POST",
    body: JSON.stringify({ mode: "selection", context: { sheetName: "Sheet1", address: "A1:B2", textPreview: "Name\tAmount" } }),
  });
  assert(etScope.operationScope?.mode === "selection" && etScope.operationScope?.context?.address === "A1:B2", "ET operation scope was not confirmed.");

  const etScopedRead = await request("/api/tools/et/read_range", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-et-session" }),
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
      sessionId: "test-et-session",
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
    body: JSON.stringify({ sessionId: "test-et-session" }),
  });
  assert(sheets.worksheets?.some((sheet) => sheet.name === "Sheet1"), "ET worksheet listing missed Sheet1.");

  const etReadRange = await request("/api/tools/et/read_range", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-et-session", address: "C3:E4", includeFormulas: true, includeFormats: true }),
  });
  assert(etReadRange.values?.[0]?.[0] === "Item", "ET read_range returned unexpected values.");
  assert(Array.isArray(etReadRange.formulas), "ET read_range did not return formulas when requested.");

  const missingSheet = await rawRequest("/api/tools/et/read_range", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-et-session", sheetName: "NoSuchSheet", address: "A1:B2" }),
  });
  assert(missingSheet.ok === false && missingSheet.error?.code === "SHEET_NOT_FOUND", "ET missing sheet did not return SHEET_NOT_FOUND.");

  const invalidAddress = await rawRequest("/api/tools/et/read_range", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-et-session", address: "bad address" }),
  });
  assert(invalidAddress.ok === false && invalidAddress.error?.code === "INVALID_ADDRESS", "ET invalid address did not return INVALID_ADDRESS.");

  const deleteLastSheet = await rawRequest("/api/tools/et/delete_worksheet", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-et-session", sheetName: "Sheet1" }),
  });
  assert(deleteLastSheet.ok === false && deleteLastSheet.error?.code === "LAST_SHEET_DELETE_REFUSED", "ET deleting the last user sheet did not return LAST_SHEET_DELETE_REFUSED.");

  const etBadValues = await rawRequest("/api/tools/et/write_range", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-et-session", address: "A10:B10", values: ["bad", "shape"] }),
  });
  assert(etBadValues.ok === false && etBadValues.error?.code === "INVALID_ARGUMENT", "ET one-dimensional values did not return INVALID_ARGUMENT.");

  const etFormat = await request("/api/tools/et/format_range", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-et-session", address: "C3:E4", bold: true, fillColor: "#D9EAF7", numberFormat: "#,##0.00", horizontalAlignment: "center", border: true, autofit: true }),
  });
  assert(etFormat.formatted === true, "ET format_range did not confirm formatting.");

  const etFind = await request("/api/tools/et/find_cells", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-et-session", query: "Beta" }),
  });
  assert(etFind.count >= 1, "ET find_cells did not find written value.");

  const etBlocks = await request("/api/tools/et/write_blocks", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-et-session", continueOnError: true, blocks: [{ address: "E1:F1", values: [["A", "B"]], format: { bold: true } }, { address: "E2:F2", formulas: [["=1+1", "=2+2"]], format: { border: true } }, { sheetName: "NoSuchSheet", address: "E3:F3", values: [["X", "Y"]] }] }),
  });
  assert(etBlocks.results?.length === 3 && etBlocks.failedCount === 1, "ET write_blocks returned unexpected mixed results.");
  assert(etBlocks.results[2]?.error?.code === "SHEET_NOT_FOUND", "ET write_blocks failed block missed SHEET_NOT_FOUND.");

  const wppSelection = await request("/api/tools/wpp/read_selection", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session" }),
  });
  assert(wppSelection.text === "原选区", "WPP selection read returned unexpected text.");

  const wppWrongHost = await rawRequest("/api/tools/wpp/read_selection", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-et-session" }),
  });
  assert(wppWrongHost.ok === false && wppWrongHost.error?.code === "SESSION_HOST_MISMATCH", "WPP tool with ET session did not return SESSION_HOST_MISMATCH.");
  assert(wppWrongHost.httpStatus === 409, "SESSION_HOST_MISMATCH did not return HTTP 409.");
  const mcpWrongHost = await mcpClient.request("tools/call", { name: "wpp.read_document_identity", arguments: { sessionId: "test-et-session" } });
  const mcpWrongHostPayload = JSON.parse(mcpWrongHost.content?.[0]?.text || "{}");
  assert(mcpWrongHostPayload.ok === false && mcpWrongHostPayload.error?.code === "SESSION_HOST_MISMATCH", "MCP did not preserve SESSION_HOST_MISMATCH in JSON result.");

  const wppScope = await request("/api/sessions/test-wpp-session/operation-scope", {
    method: "POST",
    body: JSON.stringify({ mode: "selection", context: { start: wppSelection.start, end: wppSelection.end, length: wppSelection.length, textPreview: wppSelection.text } }),
  });
  assert(wppScope.operationScope?.mode === "selection" && wppScope.operationScope?.context?.textPreview === "原选区", "WPP operation scope was not confirmed.");

  const wppInsert = await request("/api/tools/wpp/insert_text", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", text: "测试插入" }),
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
    body: JSON.stringify({ sessionId: "test-wpp-session", start: 0, maxLength: 100 }),
  });
  assert(wppText.text.includes("测试插入"), "WPP read_document_text did not return inserted text.");

  const wppSelectRange = await request("/api/tools/wpp/select_range", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", start: 0, end: 2 }),
  });
  assert(wppSelectRange.selected === true && wppSelectRange.resolvedText === "测试" && wppSelectRange.exactMatch === true, "WPP select_range returned unexpected resolved selection.");

  const wppCommentSelection = await request("/api/tools/wpp/add_comment", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", text: "当前选区批注", author: "Codex Test" }),
  });
  assert(wppCommentSelection.added === true && wppCommentSelection.rangeText === "测试", "WPP add_comment did not comment current selection.");

  const wppCommentRange = await request("/api/tools/wpp/add_comment", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", start: 2, end: 4, text: "指定范围批注" }),
  });
  assert(wppCommentRange.added === true && wppCommentRange.rangeText === "插入" && wppCommentRange.exactMatch === true, "WPP add_comment did not comment specified range.");
  const wppCommentThird = await request("/api/tools/wpp/add_comment", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", start: 0, end: 4, text: "第三条批注" }),
  });
  assert(wppCommentThird.added === true && wppCommentThird.commentId !== wppCommentRange.commentId, "WPP third add_comment did not return a unique commentId.");

  const wppCommentsBeforeDelete = await request("/api/tools/wpp/read_comments", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session" }),
  });
  const commentIds = new Set(wppCommentsBeforeDelete.comments.map((comment) => comment.commentId));
  assert(wppCommentsBeforeDelete.count === 3 && commentIds.size === 3 && wppCommentsBeforeDelete.comments.some((comment) => comment.commentId === wppCommentRange.commentId && comment.rangeText === "插入"), "WPP read_comments did not return stable unique comments.");

  const wppDeleteComment = await request("/api/tools/wpp/delete_comment", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", index: 1 }),
  });
  assert(wppDeleteComment.deleted === true, "WPP delete_comment did not confirm deletion.");

  const wppCommentsAfterDelete = await request("/api/tools/wpp/read_comments", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session" }),
  });
  assert(wppCommentsAfterDelete.count === 2 && !wppCommentsAfterDelete.comments.some((comment) => comment.text === "当前选区批注"), "WPP read_comments still returned deleted comment.");

  const wppEmptyComment = await rawRequest("/api/tools/wpp/add_comment", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", text: "" }),
  });
  assert(wppEmptyComment.ok === false && wppEmptyComment.error?.code === "INVALID_ARGUMENT", "WPP empty comment did not return INVALID_ARGUMENT.");
  assert(wppEmptyComment.httpStatus === 400, "INVALID_ARGUMENT did not return HTTP 400.");

  const wppBadCommentRange = await rawRequest("/api/tools/wpp/add_comment", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", start: 4, end: 2, text: "bad" }),
  });
  assert(wppBadCommentRange.ok === false && wppBadCommentRange.error?.code === "INVALID_ARGUMENT", "WPP invalid comment range did not return INVALID_ARGUMENT.");

  const wppMissingComment = await rawRequest("/api/tools/wpp/delete_comment", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", index: 999 }),
  });
  assert(wppMissingComment.ok === false && wppMissingComment.error?.code === "COMMENT_NOT_FOUND", "WPP missing comment did not return COMMENT_NOT_FOUND.");
  assert(wppMissingComment.httpStatus === 404, "COMMENT_NOT_FOUND did not return HTTP 404.");

  const wppTrackOn = await request("/api/tools/wpp/set_track_changes", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", enabled: true }),
  });
  assert(wppTrackOn.enabled === true, "WPP set_track_changes did not enable revisions.");
  await request("/api/tools/wpp/insert_text", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", text: "修订文本" }),
  });
  const wppRevisions = await request("/api/tools/wpp/read_revisions", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session" }),
  });
  assert(wppRevisions.count >= 1 && wppRevisions.revisions.some((revision) => revision.rangeText === "修订文本"), "WPP read_revisions did not return tracked insertion.");
  const wppAcceptAll = await request("/api/tools/wpp/accept_all_revisions", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session" }),
  });
  assert(wppAcceptAll.acceptedAll === true, "WPP accept_all_revisions did not confirm acceptance.");

  const wppIdentity = await request("/api/tools/wpp/read_document_identity", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session" }),
  });
  assert(wppIdentity.documentIdentity?.name === "simulated-writer.docx", "WPP identity returned unexpected document name.");

  const wppFormat = await request("/api/tools/wpp/format_selection", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", fontName: "宋体", fontSize: 12, bold: true }),
  });
  assert(wppFormat.formatted === true, "WPP format_selection did not confirm formatting.");

  const wppReadFormat = await request("/api/tools/wpp/read_format", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session" }),
  });
  assert(wppReadFormat.font?.bold === true, "WPP read_format did not return formatted font state.");

  const wppBadTableValues = await rawRequest("/api/tools/wpp/insert_table", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", rowCount: 2, columnCount: 2, values: ["bad", "shape"] }),
  });
  assert(wppBadTableValues.ok === false && wppBadTableValues.error?.code === "INVALID_ARGUMENT", "WPP one-dimensional table values did not return INVALID_ARGUMENT.");

  const wppTable = await request("/api/tools/wpp/insert_table", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", rowCount: 2, columnCount: 2, values: [["A", "B"], ["C", "D"]], headerRowBold: true, alignment: "center", border: true }),
  });
  assert(wppTable.insertedTable === true && wppTable.tableIndex === 1, "WPP insert_table did not confirm insertion with tableIndex.");

  const wppReadTable = await request("/api/tools/wpp/read_table", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", tableIndex: 1 }),
  });
  assert(wppReadTable.rowCount === 2 && wppReadTable.values?.[1]?.[1] === "D", "WPP read_table returned unexpected values.");

  const wppInsertRows = await request("/api/tools/wpp/insert_table_rows", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", tableIndex: 1, rowIndex: 1, count: 1, position: "after" }),
  });
  assert(wppInsertRows.rowCount === 3, "WPP insert_table_rows did not update row count.");

  const wppDeleteRows = await request("/api/tools/wpp/delete_table_rows", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", tableIndex: 1, rowIndex: 2, count: 1 }),
  });
  assert(wppDeleteRows.rowCount === 2, "WPP delete_table_rows did not update row count.");

  const wppInsertColumns = await request("/api/tools/wpp/insert_table_columns", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", tableIndex: 1, columnIndex: 1, count: 1, position: "after" }),
  });
  assert(wppInsertColumns.columnCount === 3, "WPP insert_table_columns did not update column count.");

  const wppDeleteColumns = await request("/api/tools/wpp/delete_table_columns", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", tableIndex: 1, columnIndex: 2, count: 1 }),
  });
  assert(wppDeleteColumns.columnCount === 2, "WPP delete_table_columns did not update column count.");

  const wppMergeCells = await request("/api/tools/wpp/merge_table_cells", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", tableIndex: 1, startRow: 1, startColumn: 1, endRow: 1, endColumn: 2 }),
  });
  assert(wppMergeCells.merged === true, "WPP merge_table_cells did not confirm merge.");

  const wppFormatTable = await request("/api/tools/wpp/format_table", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", tableIndex: 1, border: true, alignment: "center", headerRowBold: true, autofit: true }),
  });
  assert(wppFormatTable.formattedTable === true && wppFormatTable.applied?.includes("border"), "WPP format_table did not confirm formatting.");

  const wppBadMerge = await rawRequest("/api/tools/wpp/merge_table_cells", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", tableIndex: 1, startRow: 2, startColumn: 2, endRow: 1, endColumn: 1 }),
  });
  assert(wppBadMerge.ok === false && wppBadMerge.error?.code === "INVALID_ARGUMENT", "WPP invalid merge range did not return INVALID_ARGUMENT.");
  assert(wppBadMerge.httpStatus === 400, "INVALID_ARGUMENT table merge did not return HTTP 400.");

  const wppImage = await request("/api/tools/wpp/insert_image", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", path: "/tmp/wps-test-image.png", width: 120, height: 80, lockAspectRatio: true }),
  });
  assert(wppImage.insertedImage === true && wppImage.width === 120, "WPP insert_image did not confirm insertion.");

  const wppImages = await request("/api/tools/wpp/read_images", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session" }),
  });
  assert(wppImages.count === 1 && wppImages.images?.[0]?.source === "/tmp/wps-test-image.png", "WPP read_images did not return inserted image.");

  const wppFormatImage = await request("/api/tools/wpp/format_image", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", imageIndex: 1, width: 144, height: 96, lockAspectRatio: false }),
  });
  assert(wppFormatImage.formattedImage === true && wppFormatImage.width === 144, "WPP format_image did not update image width.");

  const wppBadImage = await rawRequest("/api/tools/wpp/insert_image", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session" }),
  });
  assert(wppBadImage.ok === false && wppBadImage.error?.code === "INVALID_ARGUMENT", "WPP empty image source did not return INVALID_ARGUMENT.");
  assert(wppBadImage.httpStatus === 400, "INVALID_ARGUMENT image source did not return HTTP 400.");

  const wppMissingImage = await rawRequest("/api/tools/wpp/format_image", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", imageIndex: 999, width: 100 }),
  });
  assert(wppMissingImage.ok === false && wppMissingImage.error?.code === "IMAGE_NOT_FOUND", "WPP missing image did not return IMAGE_NOT_FOUND.");
  assert(wppMissingImage.httpStatus === 404, "IMAGE_NOT_FOUND did not return HTTP 404.");

  const wppDeleteImage = await request("/api/tools/wpp/delete_image", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", imageIndex: 1 }),
  });
  assert(wppDeleteImage.deletedImage === true, "WPP delete_image did not confirm deletion.");

  const wppImagesAfterDelete = await request("/api/tools/wpp/read_images", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session" }),
  });
  assert(wppImagesAfterDelete.count === 0, "WPP read_images still returned deleted image.");

  const wppBadTable = await rawRequest("/api/tools/wpp/insert_table", {
    method: "POST",
    body: JSON.stringify({ sessionId: "test-wpp-session", rowCount: 0, columnCount: 2 }),
  });
  assert(wppBadTable.ok === false && wppBadTable.error?.code === "INVALID_ARGUMENT", "WPP invalid table dimensions did not return INVALID_ARGUMENT.");

  console.log(JSON.stringify({
    ok: true,
    sessions: sessions.map((session) => ({ sessionId: session.sessionId, host: session.host })),
    bindingRouting: { etSessionId: boundEtSelection.sessionId, mismatchCode: wrongExplicitBinding.error?.code, missingCode: missingBoundEt.error?.code },
    operationScope: { etScopedAddress: etScopedRead.address, wppInsertScope: wppInsert.operationScope?.mode },
    etSelection: { address: etSelection.address, firstCell: etSelection.values[0][0] },
    etWrite: { address: etWrite.address, rowCount: etWrite.rowCount, columnCount: etWrite.columnCount },
    etReadRange: { address: etReadRange.address, firstCell: etReadRange.values[0][0] },
    etFind: { count: etFind.count },
    wppSelection: { text: wppSelection.text },
    wppInsert: { insertedLength: wppInsert.insertedLength },
    wppText: { length: wppText.length },
    wppComments: { beforeDelete: wppCommentsBeforeDelete.count, afterDelete: wppCommentsAfterDelete.count },
    wppRevisions: { beforeAcceptAll: wppRevisions.count },
    wppTable: { rowCount: wppTable.rowCount, columnCount: wppTable.columnCount },
    wppReadTable: { rowCount: wppReadTable.rowCount, columnCount: wppReadTable.columnCount },
    wppTableOps: { rows: wppDeleteRows.rowCount, columns: wppDeleteColumns.columnCount, merged: wppMergeCells.merged },
    wppImages: { inserted: wppImage.insertedImage, afterDelete: wppImagesAfterDelete.count },
  }, null, 2));
}

try {
  await main();
} finally {
  for (const child of children.reverse()) {
    if (!child.killed) child.kill("SIGTERM");
    await Promise.race([once(child, "exit"), sleep(500)]).catch(() => {});
  }
}
