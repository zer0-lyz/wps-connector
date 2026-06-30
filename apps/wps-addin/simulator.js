const bridgeUrl = (process.env.WPS_CONNECTOR_BRIDGE_URL || "http://127.0.0.1:40215").replace(/\/$/, "");
const host = process.env.WPS_CONNECTOR_SIM_HOST || "et";
const sessionId = process.env.WPS_CONNECTOR_SIM_SESSION_ID || `sim-${host}-${Date.now()}`;

const state = {
  et: {
    documentName: "simulated-et.xlsx",
    sheetName: "Sheet1",
    selectionAddress: "A1:B2",
    worksheets: ["Sheet1"],
    cells: {
      "A1:B2": [["Name", "Amount"], ["Alpha", 100]],
    },
    formats: {},
    formulas: {},
  },
  wpp: {
    documentName: "simulated-writer.docx",
    selectionText: "原选区",
    selectionStart: 0,
    selectionEnd: 3,
    insertedText: "",
    format: { font: {}, paragraph: {} },
    tables: [],
    comments: [],
    nextCommentId: 1,
    images: [],
    nextImageId: 1,
    trackChanges: false,
    revisions: [],
  },
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request(path, options = {}) {
  const response = await fetch(`${bridgeUrl}${path}`, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) },
  });
  const json = await response.json();
  if (!json.ok) throw new Error(json.error?.message || `Bridge request failed: ${path}`);
  return json;
}

function activeContext() {
  if (host === "et") return { sheetName: state.et.sheetName, address: state.et.selectionAddress };
  if (host === "wpp") return { start: state.wpp.selectionStart, end: state.wpp.selectionEnd, textPreview: state.wpp.selectionText.slice(0, 500), length: state.wpp.selectionText.length };
  return null;
}

async function register() {
  const capabilities = host === "et" ? ["et.read_selection", "et.list_worksheets", "et.add_worksheet", "et.rename_worksheet", "et.delete_worksheet", "et.read_range", "et.write_range", "et.format_range", "et.clear_range", "et.find_cells", "et.write_blocks"] : ["wpp.read_selection", "wpp.read_document_identity", "wpp.read_document_text", "wpp.select_range", "wpp.read_format", "wpp.read_table", "wpp.insert_table_rows", "wpp.delete_table_rows", "wpp.insert_table_columns", "wpp.delete_table_columns", "wpp.merge_table_cells", "wpp.format_table", "wpp.read_table_format", "wpp.apply_table_format", "wpp.copy_table_style", "wpp.duplicate_table_appearance", "wpp.read_cell_format", "wpp.apply_cell_format", "wpp.read_row_heights", "wpp.set_row_heights", "wpp.read_column_widths", "wpp.set_column_widths", "wpp.read_merged_cells", "wpp.apply_merged_cells", "wpp.insert_image", "wpp.read_images", "wpp.format_image", "wpp.delete_image", "wpp.add_comment", "wpp.read_comments", "wpp.delete_comment", "wpp.set_track_changes", "wpp.read_revisions", "wpp.accept_revision", "wpp.reject_revision", "wpp.accept_all_revisions", "wpp.reject_all_revisions", "wpp.insert_text", "wpp.format_selection", "wpp.set_paragraph", "wpp.insert_table"];
  await request("/api/sessions/register", {
    method: "POST",
    body: JSON.stringify({
      sessionId,
      host,
      documentName: state[host].documentName,
      activeContext: activeContext(),
      capabilities,
    }),
  });
}

async function heartbeat() {
  await request(`/api/sessions/${sessionId}/heartbeat`, {
    method: "POST",
    body: JSON.stringify({ activeContext: activeContext() }),
  });
}

function execute(command) {
  function fail(code, message, details = {}) {
    const error = new Error(message);
    error.code = code;
    error.details = details;
    throw error;
  }
  function requireSheet(name) {
    const sheetName = name || state.et.sheetName;
    if (!state.et.worksheets.includes(sheetName)) fail("SHEET_NOT_FOUND", `Worksheet not found: ${sheetName}`, { sheetName, availableSheets: state.et.worksheets });
    return sheetName;
  }
  function requireAddress(address) {
    const text = String(address || "").trim();
    if (!/^[A-Za-z]{1,3}\d{1,7}(:[A-Za-z]{1,3}\d{1,7})?$/.test(text)) fail("INVALID_ADDRESS", `Invalid range address: ${text}`, { address: text });
    return text;
  }
  function requireMatrix(value, field) {
    if (value === undefined || value === null) return null;
    if (!Array.isArray(value) || !value.every((row) => Array.isArray(row))) fail("INVALID_ARGUMENT", String(field) + " must be a two-dimensional array.", { field, expected: "array[]", valueType: Array.isArray(value) ? "array" : typeof value });
    return value;
  }
  function isSystemSheet(name) {
    return /^__WPS_.*__$/.test(String(name || ""));
  }
  function isProtectedSheet(name) {
    return isSystemSheet(name) || /^Sheet1$/i.test(String(name || ""));
  }
  if (command.toolName === "et.read_selection") {
    return {
      host: "et",
      sheetName: state.et.sheetName,
      address: state.et.selectionAddress,
      values: state.et.cells[state.et.selectionAddress] || [],
      text: JSON.stringify(state.et.cells[state.et.selectionAddress] || []),
    };
  }
  if (command.toolName === "et.list_worksheets") return { host: "et", count: state.et.worksheets.length, worksheets: state.et.worksheets.map((name, i) => ({ index: i + 1, name, active: name === state.et.sheetName })) };
  if (command.toolName === "et.add_worksheet") { const name = command.input.name || command.input.sheetName || `Sheet${state.et.worksheets.length + 1}`; state.et.worksheets.push(name); if (command.input.activate !== false) state.et.sheetName = name; return { host: "et", sheetName: name, added: true }; }
  if (command.toolName === "et.rename_worksheet") { const idx = state.et.worksheets.indexOf(command.input.oldName); if (idx < 0) throw new Error("Sheet not found"); state.et.worksheets[idx] = command.input.newName; if (state.et.sheetName === command.input.oldName || command.input.activate) state.et.sheetName = command.input.newName; return { host: "et", oldName: command.input.oldName, newName: command.input.newName, renamed: true }; }
  if (command.toolName === "et.delete_worksheet") { const sheetName = requireSheet(command.input.sheetName); const userSheets = state.et.worksheets.filter((name) => !isSystemSheet(name)); if (!command.input.force && isProtectedSheet(sheetName)) fail("LAST_SHEET_DELETE_REFUSED", "Refusing to delete a protected worksheet.", { sheetName, sheetCount: state.et.worksheets.length, userSheetCount: userSheets.length, forceSupported: true }); if (state.et.worksheets.length <= 1 || (!isSystemSheet(sheetName) && userSheets.length <= 1)) fail("LAST_SHEET_DELETE_REFUSED", "Refusing to delete the last user worksheet.", { sheetName, sheetCount: state.et.worksheets.length, userSheetCount: userSheets.length }); state.et.worksheets = state.et.worksheets.filter((name) => name !== sheetName); state.et.sheetName = state.et.worksheets[0]; return { host: "et", sheetName, deleted: true }; }
  if (command.toolName === "et.read_range") { const sheetName = requireSheet(command.input.sheetName); const address = requireAddress(command.input.address); const result = { host: "et", sheetName, address, values: state.et.cells[address] || [], text: JSON.stringify(state.et.cells[address] || []) }; if (command.input.includeFormulas) result.formulas = state.et.formulas[address] || []; if (command.input.includeFormats) result.formats = state.et.formats[address] || {}; return result; }
  if (command.toolName === "et.write_range") {
    const sheetName = requireSheet(command.input.sheetName);
    const address = requireAddress(command.input.address);
    const values = command.input.values !== undefined ? requireMatrix(command.input.values, "values") : [];
    state.et.cells[address] = values;
    if (command.input.formulas) state.et.formulas[address] = requireMatrix(command.input.formulas, "formulas");
    if (command.input.numberFormats) state.et.formats[address] = { ...(state.et.formats[address] || {}), numberFormat: requireMatrix(command.input.numberFormats, "numberFormats") };
    state.et.selectionAddress = address;
    return {
      host: "et",
      sheetName,
      address,
      rowCount: values.length,
      columnCount: values[0]?.length || 0,
      formulasApplied: Boolean(command.input.formulas),
      numberFormatsApplied: Boolean(command.input.numberFormats),
    };
  }
  if (command.toolName === "et.format_range") { requireSheet(command.input.sheetName); const address = requireAddress(command.input.address); state.et.formats[address] = command.input; return { host: "et", address, formatted: true }; }
  if (command.toolName === "et.clear_range") { requireSheet(command.input.sheetName); const address = requireAddress(command.input.address); delete state.et.cells[address]; return { host: "et", address, cleared: command.input.applyTo || "contents" }; }
  if (command.toolName === "et.find_cells") { const results = []; for (const [address, values] of Object.entries(state.et.cells)) if (JSON.stringify(values).includes(command.input.query)) results.push({ address, value: command.input.query, row: 1, column: 1 }); return { host: "et", query: command.input.query, count: results.length, results }; }
  if (command.toolName === "et.write_blocks") { const results = []; for (const [index, block] of (command.input.blocks || []).entries()) { const steps = []; try { requireSheet(block.sheetName); const address = requireAddress(block.address); if (block.values) { state.et.cells[address] = requireMatrix(block.values, "blocks[].values"); steps.push({ step: "write", ok: true }); } if (block.formulas) { state.et.formulas[address] = requireMatrix(block.formulas, "blocks[].formulas"); steps.push({ step: "write", ok: true, formulasApplied: true }); } if (block.format) { state.et.formats[address] = block.format; steps.push({ step: "format", ok: true }); } results.push({ index, address, ok: true, steps }); } catch (error) { results.push({ index, address: block.address || "", ok: false, error: { code: error.code || "SIMULATOR_COMMAND_FAILED", message: error.message, details: error.details || {} } }); if (!command.input.continueOnError) break; } } return { host: "et", blockCount: command.input.blocks?.length || 0, okCount: results.filter((r) => r.ok).length, failedCount: results.filter((r) => !r.ok).length, results }; }
  if (command.toolName === "wpp.read_selection") {
    return { host: "wpp", text: state.wpp.selectionText, length: state.wpp.selectionText.length, start: state.wpp.selectionStart, end: state.wpp.selectionEnd };
  }
  if (command.toolName === "wpp.read_document_identity") return { host: "wpp", documentIdentity: { name: state.wpp.documentName } };
  if (command.toolName === "wpp.read_document_text") {
    const text = state.wpp.insertedText;
    const start = command.input.start ?? 0;
    const end = command.input.end ?? text.length;
    const maxLength = command.input.maxLength ?? 20000;
    return { host: "wpp", start, end, length: Math.max(0, end - start), truncated: end - start > maxLength, textModel: "normalized-wps-range-v1", text: text.slice(start, end).slice(0, maxLength) };
  }
  if (command.toolName === "wpp.select_range") {
    const start = command.input.start;
    const end = command.input.end;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start) fail("INVALID_ARGUMENT", "Invalid WPP range.", { start, end });
    state.wpp.selectionStart = start;
    state.wpp.selectionEnd = end;
    state.wpp.selectionText = state.wpp.insertedText.slice(start, end);
    return { host: "wpp", selected: true, start, end, text: state.wpp.selectionText, requestedStart: start, requestedEnd: end, resolvedStart: start, resolvedEnd: end, resolvedText: state.wpp.selectionText, exactMatch: true, attempts: [{ label: "simulated", start, end, resolvedText: state.wpp.selectionText, exactMatch: true }] };
  }
  if (command.toolName === "wpp.read_format") return { host: "wpp", ...state.wpp.format };
  if (command.toolName === "wpp.insert_text") {
    const inserted = command.input.text || "";
    state.wpp.insertedText += inserted;
    if (state.wpp.trackChanges && inserted) state.wpp.revisions.push({ revisionId: String(state.wpp.revisions.length + 1), type: "insert", author: "simulator", rangeText: inserted, createdAt: new Date().toISOString() });
    state.wpp.selectionText = inserted;
    state.wpp.selectionStart = state.wpp.insertedText.length - state.wpp.selectionText.length;
    state.wpp.selectionEnd = state.wpp.insertedText.length;
    return { host: "wpp", insertedLength: String(command.input.text || "").length, text: state.wpp.selectionText, operationScope: command.input.operationScope || null };
  }
  if (command.toolName === "wpp.format_selection") { state.wpp.format = { font: { name: command.input.fontName || "", size: command.input.fontSize, bold: Boolean(command.input.bold), italic: Boolean(command.input.italic), color: command.input.fontColor }, paragraph: { alignment: command.input.alignment, spaceBefore: command.input.spaceBefore, spaceAfter: command.input.spaceAfter, lineSpacing: command.input.lineSpacing } }; return { host: "wpp", formatted: true }; }
  if (command.toolName === "wpp.set_paragraph") { state.wpp.format.paragraph = { alignment: command.input.alignment, spaceBefore: command.input.spaceBefore, spaceAfter: command.input.spaceAfter, lineSpacing: command.input.lineSpacing }; return { host: "wpp", paragraphFormatted: true }; }

  if (command.toolName === "wpp.set_track_changes") {
    if (typeof command.input.enabled !== "boolean") fail("INVALID_ARGUMENT", "enabled must be boolean.", { field: "enabled", value: command.input.enabled });
    state.wpp.trackChanges = command.input.enabled;
    return { host: "wpp", enabled: state.wpp.trackChanges };
  }
  if (command.toolName === "wpp.read_revisions") {
    return { host: "wpp", count: state.wpp.revisions.length, revisions: state.wpp.revisions.map((revision, index) => ({ ...revision, index: index + 1 })) };
  }
  if (command.toolName === "wpp.accept_revision" || command.toolName === "wpp.reject_revision") {
    const index = simIndex(command.input.index, "index");
    if (index > state.wpp.revisions.length) fail("REVISION_NOT_FOUND", "Revision not found: " + index, { index, revisionCount: state.wpp.revisions.length });
    state.wpp.revisions.splice(index - 1, 1);
    return { host: "wpp", [command.toolName === "wpp.accept_revision" ? "accepted" : "rejected"]: true, index };
  }
  if (command.toolName === "wpp.accept_all_revisions" || command.toolName === "wpp.reject_all_revisions") {
    const before = state.wpp.revisions.length;
    state.wpp.revisions = [];
    return { host: "wpp", [command.toolName === "wpp.accept_all_revisions" ? "acceptedAll" : "rejectedAll"]: true, before };
  }

  if (command.toolName === "wpp.insert_table") {
    const rowCount = Number(command.input.rowCount);
    const columnCount = Number(command.input.columnCount);
    if (!Number.isInteger(rowCount) || rowCount < 1) fail("INVALID_ARGUMENT", "rowCount must be an integer >= 1.", { field: "rowCount", value: command.input.rowCount });
    if (!Number.isInteger(columnCount) || columnCount < 1) fail("INVALID_ARGUMENT", "columnCount must be an integer >= 1.", { field: "columnCount", value: command.input.columnCount });
    const values = command.input.values !== undefined ? requireMatrix(command.input.values, "values") : [];
    const table = { rowCount, columnCount, values, headerRowBold: Boolean(command.input.headerRowBold), border: command.input.border !== false, alignment: command.input.alignment || "" };
    table.format = { table: { alignment: table.alignment, borders: { enable: table.border ? 1 : 0, items: [] } }, rowHeights: Array.from({ length: rowCount }, (_, i) => ({ row: i + 1, height: 18, heightRule: 0 })), columnWidths: Array.from({ length: columnCount }, (_, i) => ({ column: i + 1, width: 72 })), mergedCells: [], cells: Array.from({ length: rowCount }, (_, r) => Array.from({ length: columnCount }, (_, c) => ({ row: r + 1, column: c + 1, font: { bold: table.headerRowBold && r === 0 }, paragraph: { alignment: table.alignment }, shading: {}, borders: { enable: table.border ? 1 : 0, items: [] } }))).flat() };
    state.wpp.tables.push(table);
    return { host: "wpp", insertedTable: true, tableIndex: state.wpp.tables.length, ...table };
  }
  if (command.toolName === "wpp.read_table") {
    const tableIndex = command.input.tableIndex || 1;
    const table = state.wpp.tables[tableIndex - 1];
    if (!table) fail("TABLE_NOT_FOUND", `Table not found: ${tableIndex}`, { tableIndex, tableCount: state.wpp.tables.length });
    return { host: "wpp", tableIndex, tableCount: state.wpp.tables.length, rowCount: table.rowCount, columnCount: table.columnCount, values: table.values };
  }
  function simTable(input) {
    const tableIndex = input.tableIndex || 1;
    const table = state.wpp.tables[tableIndex - 1];
    if (!table) fail("TABLE_NOT_FOUND", `Table not found: ${tableIndex}`, { tableIndex, tableCount: state.wpp.tables.length });
    return { table, tableIndex };
  }
  function simIndex(value, field, min = 1) {
    const n = Number(value);
    if (!Number.isInteger(n) || n < min) fail("INVALID_ARGUMENT", `${field} must be an integer >= ${min}.`, { field, value });
    return n;
  }
  if (command.toolName === "wpp.insert_table_rows") {
    const { table, tableIndex } = simTable(command.input);
    const rowIndex = simIndex(command.input.rowIndex, "rowIndex");
    const count = command.input.count === undefined ? 1 : simIndex(command.input.count, "count");
    if (rowIndex > table.rowCount) fail("INVALID_ARGUMENT", "row index is outside table bounds.", { rowIndex, rowCount: table.rowCount });
    const insertAt = String(command.input.position || "after").toLowerCase() === "before" ? rowIndex - 1 : rowIndex;
    for (let i = 0; i < count; i += 1) table.values.splice(insertAt, 0, Array(table.columnCount).fill(""));
    table.rowCount += count;
    return { host: "wpp", insertedRows: count, tableIndex, rowIndex, rowCount: table.rowCount, columnCount: table.columnCount };
  }
  if (command.toolName === "wpp.delete_table_rows") {
    const { table, tableIndex } = simTable(command.input);
    const rowIndex = simIndex(command.input.rowIndex, "rowIndex");
    const count = command.input.count === undefined ? 1 : simIndex(command.input.count, "count");
    if (rowIndex + count - 1 > table.rowCount) fail("INVALID_ARGUMENT", "row delete range exceeds table bounds.", { rowIndex, count, rowCount: table.rowCount });
    table.values.splice(rowIndex - 1, count);
    table.rowCount -= count;
    return { host: "wpp", deletedRows: count, tableIndex, rowIndex, rowCount: table.rowCount, columnCount: table.columnCount };
  }
  if (command.toolName === "wpp.insert_table_columns") {
    const { table, tableIndex } = simTable(command.input);
    const columnIndex = simIndex(command.input.columnIndex, "columnIndex");
    const count = command.input.count === undefined ? 1 : simIndex(command.input.count, "count");
    if (columnIndex > table.columnCount) fail("INVALID_ARGUMENT", "column index is outside table bounds.", { columnIndex, columnCount: table.columnCount });
    const insertAt = String(command.input.position || "after").toLowerCase() === "before" ? columnIndex - 1 : columnIndex;
    for (const row of table.values) row.splice(insertAt, 0, ...Array(count).fill(""));
    table.columnCount += count;
    return { host: "wpp", insertedColumns: count, tableIndex, columnIndex, rowCount: table.rowCount, columnCount: table.columnCount };
  }
  if (command.toolName === "wpp.delete_table_columns") {
    const { table, tableIndex } = simTable(command.input);
    const columnIndex = simIndex(command.input.columnIndex, "columnIndex");
    const count = command.input.count === undefined ? 1 : simIndex(command.input.count, "count");
    if (columnIndex + count - 1 > table.columnCount) fail("INVALID_ARGUMENT", "column delete range exceeds table bounds.", { columnIndex, count, columnCount: table.columnCount });
    for (const row of table.values) row.splice(columnIndex - 1, count);
    table.columnCount -= count;
    return { host: "wpp", deletedColumns: count, tableIndex, columnIndex, rowCount: table.rowCount, columnCount: table.columnCount };
  }
  if (command.toolName === "wpp.merge_table_cells") {
    const { table, tableIndex } = simTable(command.input);
    const startRow = simIndex(command.input.startRow, "startRow");
    const startColumn = simIndex(command.input.startColumn, "startColumn");
    const endRow = simIndex(command.input.endRow, "endRow");
    const endColumn = simIndex(command.input.endColumn, "endColumn");
    if (endRow < startRow || endColumn < startColumn || endRow > table.rowCount || endColumn > table.columnCount) fail("INVALID_ARGUMENT", "Invalid merge range.", { startRow, startColumn, endRow, endColumn });
    table.merged = table.merged || [];
    table.merged.push({ startRow, startColumn, endRow, endColumn });
    return { host: "wpp", merged: true, tableIndex, startRow, startColumn, endRow, endColumn };
  }
  if (command.toolName === "wpp.format_table") {
    const { table, tableIndex } = simTable(command.input);
    table.format = { ...(table.format || {}), border: command.input.border, alignment: command.input.alignment, headerRowBold: command.input.headerRowBold, autofit: command.input.autofit };
    return { host: "wpp", formattedTable: true, tableIndex, applied: Object.keys(table.format).filter((key) => table.format[key] !== undefined), rowCount: table.rowCount, columnCount: table.columnCount };
  }
  function simClone(value) { return JSON.parse(JSON.stringify(value)); }
  function simFormat(table) { table.format = table.format || { table: {}, rowHeights: [], columnWidths: [], mergedCells: [], cells: [] }; table.format.rowCount = table.rowCount; table.format.columnCount = table.columnCount; return table.format; }
  if (command.toolName === "wpp.read_table_format") { const { table, tableIndex } = simTable(command.input); return { host: "wpp", tableIndex, format: simClone(simFormat(table)) }; }
  if (command.toolName === "wpp.apply_table_format") { const { table, tableIndex } = simTable(command.input); table.format = simClone(command.input.format || {}); table.format.rowCount = table.rowCount; table.format.columnCount = table.columnCount; return { host: "wpp", tableIndex, applied: ["table_format"], rowCount: table.rowCount, columnCount: table.columnCount }; }
  if (command.toolName === "wpp.copy_table_style" || command.toolName === "wpp.duplicate_table_appearance") { const source = simTable({ tableIndex: command.input.sourceTableIndex }).table; const targetInfo = simTable({ tableIndex: command.input.targetTableIndex }); targetInfo.table.format = simClone(simFormat(source)); targetInfo.table.format.rowCount = targetInfo.table.rowCount; targetInfo.table.format.columnCount = targetInfo.table.columnCount; return { host: "wpp", copied: true, duplicatedAppearance: command.toolName === "wpp.duplicate_table_appearance", keepContent: command.input.keepContent !== false, sourceTableIndex: command.input.sourceTableIndex, targetTableIndex: command.input.targetTableIndex, scope: command.input.scope || "all", applied: ["table_format"] }; }
  if (command.toolName === "wpp.read_cell_format") { const { table, tableIndex } = simTable(command.input); const row = simIndex(command.input.row, "row"); const column = simIndex(command.input.col ?? command.input.column, "col"); const cell = simFormat(table).cells.find((item) => item.row === row && item.column === column) || { row, column }; return { host: "wpp", tableIndex, row, column, format: simClone(cell) }; }
  if (command.toolName === "wpp.apply_cell_format") { const { table, tableIndex } = simTable(command.input); const row = simIndex(command.input.row, "row"); const column = simIndex(command.input.col ?? command.input.column, "col"); const format = simFormat(table); const index = format.cells.findIndex((item) => item.row === row && item.column === column); const next = { ...(command.input.format || {}), row, column }; if (index >= 0) format.cells[index] = next; else format.cells.push(next); return { host: "wpp", tableIndex, row, column, applied: ["cell_format"] }; }
  if (command.toolName === "wpp.read_row_heights") { const { table, tableIndex } = simTable(command.input); return { host: "wpp", tableIndex, rowHeights: simClone(simFormat(table).rowHeights || []) }; }
  if (command.toolName === "wpp.set_row_heights") { const { table, tableIndex } = simTable(command.input); simFormat(table).rowHeights = simClone(command.input.rowHeights || command.input.rows || []); return { host: "wpp", tableIndex, appliedRows: simFormat(table).rowHeights.map((r) => r.row || r.index) }; }
  if (command.toolName === "wpp.read_column_widths") { const { table, tableIndex } = simTable(command.input); return { host: "wpp", tableIndex, columnWidths: simClone(simFormat(table).columnWidths || []) }; }
  if (command.toolName === "wpp.set_column_widths") { const { table, tableIndex } = simTable(command.input); simFormat(table).columnWidths = simClone(command.input.columnWidths || command.input.columns || []); return { host: "wpp", tableIndex, appliedColumns: simFormat(table).columnWidths.map((c) => c.column || c.index) }; }
  if (command.toolName === "wpp.read_merged_cells") { const { table, tableIndex } = simTable(command.input); return { host: "wpp", tableIndex, mergedCells: simClone(simFormat(table).mergedCells || table.merged || []) }; }
  if (command.toolName === "wpp.apply_merged_cells") { const { table, tableIndex } = simTable(command.input); simFormat(table).mergedCells = simClone(command.input.mergedCells || []); return { host: "wpp", tableIndex, appliedMergedCells: simFormat(table).mergedCells.length, results: simFormat(table).mergedCells.map((item) => ({ ...item, ok: true })) }; }
  if (command.toolName === "wpp.insert_image") {
    const source = String(command.input.path || command.input.url || "").trim();
    if (!source) fail("INVALID_ARGUMENT", "path or url is required.", { fields: ["path", "url"] });
    const image = { index: state.wpp.images.length + 1, imageId: String(state.wpp.nextImageId++), collectionType: "inline", sourceType: "InlineShapes", source, width: command.input.width, height: command.input.height, lockAspectRatio: command.input.lockAspectRatio };
    state.wpp.images.push(image);
    return { host: "wpp", insertedImage: true, imageIndex: image.index, ...image };
  }
  if (command.toolName === "wpp.read_images") {
    return { host: "wpp", count: state.wpp.images.length, imageCount: state.wpp.images.length, collections: [{ collectionType: "inline", sourceType: "InlineShapes", count: state.wpp.images.length }], images: state.wpp.images.map((image, index) => ({ ...image, index: index + 1 })) };
  }
  if (command.toolName === "wpp.format_image") {
    const imageIndex = command.input.imageIndex === undefined ? state.wpp.images.length : simIndex(command.input.imageIndex, "imageIndex");
    const image = state.wpp.images[imageIndex - 1];
    if (!image) fail("IMAGE_NOT_FOUND", `Image not found: ${imageIndex}`, { imageIndex, imageCount: state.wpp.images.length });
    if (command.input.width !== undefined) image.width = command.input.width;
    if (command.input.height !== undefined) image.height = command.input.height;
    if (command.input.lockAspectRatio !== undefined) image.lockAspectRatio = command.input.lockAspectRatio;
    return { host: "wpp", formattedImage: true, imageIndex, ...image };
  }
  if (command.toolName === "wpp.delete_image") {
    const imageIndex = command.input.imageIndex === undefined ? state.wpp.images.length : simIndex(command.input.imageIndex, "imageIndex");
    const image = state.wpp.images[imageIndex - 1];
    if (!image) fail("IMAGE_NOT_FOUND", `Image not found: ${imageIndex}`, { imageIndex, imageCount: state.wpp.images.length });
    state.wpp.images.splice(imageIndex - 1, 1);
    return { host: "wpp", deletedImage: true, imageIndex };
  }
  if (command.toolName === "wpp.add_comment") {
    const text = String(command.input.text || "").trim();
    if (!text) fail("INVALID_ARGUMENT", "comment text is required.", { field: "text" });
    const hasRange = command.input.start !== undefined || command.input.end !== undefined;
    let rangeText = state.wpp.selectionText;
    if (hasRange) {
      const start = command.input.start;
      const end = command.input.end;
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start) fail("INVALID_ARGUMENT", "Invalid WPP comment range.", { start, end });
      rangeText = state.wpp.insertedText.slice(start, end);
    }
    const comment = { index: state.wpp.comments.length + 1, commentId: String(state.wpp.nextCommentId++), author: command.input.author || "", text, rangeText, createdAt: new Date().toISOString() };
    state.wpp.comments.push(comment);
    return { host: "wpp", added: true, commentIndex: comment.index, commentId: comment.commentId, nativeCommentId: comment.commentId, commentIdStable: true, text: comment.text, rangeText: comment.rangeText, author: comment.author, requestedStart: hasRange ? command.input.start : null, requestedEnd: hasRange ? command.input.end : null, resolvedStart: hasRange ? command.input.start : state.wpp.selectionStart, resolvedEnd: hasRange ? command.input.end : state.wpp.selectionEnd, resolvedText: rangeText, exactMatch: true };
  }
  if (command.toolName === "wpp.read_comments") {
    return { host: "wpp", count: state.wpp.comments.length, comments: state.wpp.comments.map((comment, index) => ({ ...comment, index: index + 1 })) };
  }
  if (command.toolName === "wpp.delete_comment") {
    let idx = -1;
    if (command.input.index !== undefined) {
      const index = command.input.index;
      if (!Number.isInteger(index) || index < 1) fail("INVALID_ARGUMENT", "index must be an integer >= 1.", { field: "index", value: command.input.index });
      idx = index - 1;
    } else if (command.input.commentId) {
      idx = state.wpp.comments.findIndex((comment) => comment.commentId === String(command.input.commentId));
    } else {
      fail("INVALID_ARGUMENT", "index or commentId is required.", { fields: ["index", "commentId"] });
    }
    if (idx < 0 || idx >= state.wpp.comments.length) fail("COMMENT_NOT_FOUND", "Comment not found.", { index: command.input.index, commentId: command.input.commentId, commentCount: state.wpp.comments.length });
    const [deleted] = state.wpp.comments.splice(idx, 1);
    return { host: "wpp", deleted: true, commentIndex: idx + 1, commentId: deleted.commentId };
  }
  throw new Error(`Unsupported command for simulator: ${command.toolName}`);
}

async function pollOnce() {
  const json = await request(`/api/sessions/${sessionId}/commands/next`);
  if (!json.command) return;
  try {
    const result = execute(json.command);
    await request(`/api/commands/${json.command.commandId}/result`, {
      method: "POST",
      body: JSON.stringify({ ok: true, result }),
    });
  } catch (error) {
    await request(`/api/commands/${json.command.commandId}/result`, {
      method: "POST",
      body: JSON.stringify({ ok: false, error: { code: error.code || "SIMULATOR_COMMAND_FAILED", message: error.message, details: error.details || {} } }),
    });
  }
}

async function main() {
  await register();
  console.error(`wps-connector simulator online: ${host} ${sessionId}`);
  while (true) {
    await heartbeat().catch((error) => console.error(`heartbeat failed: ${error.message}`));
    await pollOnce().catch((error) => console.error(`poll failed: ${error.message}`));
    await sleep(250);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
