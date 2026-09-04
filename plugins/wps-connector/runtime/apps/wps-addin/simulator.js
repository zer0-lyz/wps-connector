const bridgeUrl = (process.env.WPS_CONNECTOR_BRIDGE_URL || "http://127.0.0.1:40215").replace(/\/$/, "");
const host = process.env.WPS_CONNECTOR_SIM_HOST || "et";
const sessionId = process.env.WPS_CONNECTOR_SIM_SESSION_ID || `sim-${host}-${Date.now()}`;
const selectionPreviewCellLimit = Number(process.env.WPS_CONNECTOR_SELECTION_PREVIEW_CELL_LIMIT || 1000);

const state = {
  et: {
    documentName: "simulated-et.xlsx",
    sheetName: "Sheet1",
    selectionAddress: process.env.WPS_CONNECTOR_SIM_SELECTION_ADDRESS || "A1:B2",
    selectionRowCount: Number(process.env.WPS_CONNECTOR_SIM_SELECTION_ROWS || 2),
    selectionColumnCount: Number(process.env.WPS_CONNECTOR_SIM_SELECTION_COLUMNS || 2),
    worksheets: ["Sheet1"],
    cells: {
      "A1:B2": [["Name", "Amount"], ["Alpha", 100]],
    },
    formats: {},
    formulas: {},
    shapes: [],
    comments: [],
    validations: [],
  },
  wpp: {
    documentName: "simulated-writer.docx",
    selectionText: "原选区",
    selectionStart: 0,
    selectionEnd: 3,
    insertedText: "",
    format: { font: {}, paragraph: {} },
    paragraphFormats: {},
    selectedTableIndex: null,
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
function getPathValue(object, path) {
  return String(path || "").split(".").reduce((current, key) => (current && Object.prototype.hasOwnProperty.call(current, key) ? current[key] : undefined), object);
}
function setPathValue(object, path, value) {
  const parts = String(path || "").split(".").filter(Boolean);
  let cursor = object;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i];
    if (!cursor[key] || typeof cursor[key] !== "object") cursor[key] = {};
    cursor = cursor[key];
  }
  if (parts.length) cursor[parts[parts.length - 1]] = value;
  return object;
}
function pickFields(object, fields) {
  if (!Array.isArray(fields) || !fields.length) return object;
  const out = {};
  for (const field of fields) {
    const value = getPathValue(object, field);
    if (value !== undefined) setPathValue(out, field, value);
  }
  return out;
}
function simRangeBounds(address) {
  const text = String(address || "").split("!").pop().replace(/\$/g, "");
  const match = /^([A-Za-z]{1,3})(\d+)(?::([A-Za-z]{1,3})(\d+))?$/.exec(text);
  if (!match) return null;
  const columnNumber = (letters) => [...letters.toUpperCase()].reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0);
  const startRow = Number(match[2]);
  const startColumn = columnNumber(match[1]);
  return { startRow, startColumn, endRow: Number(match[4] || match[2]), endColumn: columnNumber(match[3] || match[1]) };
}
function simMergeFormat(target, patch) {
  for (const [key, value] of Object.entries(patch || {})) {
    if (value !== undefined && value !== null) target[key] = value;
  }
  return target;
}
function simFormatForCell(sheetName, row, column) {
  const result = {};
  for (const [address, format] of Object.entries(state.et.formats)) {
    const bounds = simRangeBounds(address);
    if (!bounds || row < bounds.startRow || row > bounds.endRow || column < bounds.startColumn || column > bounds.endColumn) continue;
    if (format?.sheetName && String(format.sheetName) !== String(sheetName)) continue;
    const patch = { ...(format || {}) };
    if (Array.isArray(format?.numberFormat)) {
      const relativeRow = row - bounds.startRow;
      const relativeColumn = column - bounds.startColumn;
      const matrix = Array.isArray(format.numberFormat[0]) ? format.numberFormat : [format.numberFormat];
      patch.numberFormat = matrix[relativeRow]?.[relativeColumn] ?? matrix[0]?.[relativeColumn] ?? "";
    }
    simMergeFormat(result, patch);
  }
  return result;
}
function simDisplayValue(value, format) {
  if (value === null || value === undefined) return "";
  const numberFormat = String(format?.numberFormat || "");
  const numericValue = typeof value === "number" ? value : (typeof value === "string" && /^[-+]?\d+(?:\.\d+)?$/.test(value.trim()) ? Number(value) : NaN);
  if (!Number.isFinite(numericValue) || !numberFormat || /^general$/i.test(numberFormat) || numberFormat === "@") return String(value);
  const dateSection = numberFormat.split(";")[0];
  if (/[ymdhHs]/i.test(dateSection) && !/[#0]/.test(dateSection)) {
    const date = new Date(Date.UTC(1899, 11, 30) + numericValue * 86400000);
    const two = (number) => String(number).padStart(2, "0");
    const dateMask = dateSection.replace(/(h{1,2}[^a-z]*)(m{1,2})/gi, "$1__MIN__");
    return dateMask.replace(/yyyy/gi, String(date.getUTCFullYear())).replace(/yy/gi, String(date.getUTCFullYear()).slice(-2))
      .replace(/hh/gi, two(date.getUTCHours())).replace(/h/gi, String(date.getUTCHours()))
      .replace(/ss/gi, two(date.getUTCSeconds())).replace(/s/gi, String(date.getUTCSeconds()))
      .replace(/mm/g, two(date.getUTCMonth() + 1)).replace(/m/g, String(date.getUTCMonth() + 1))
      .replace(/dd/gi, two(date.getUTCDate())).replace(/d/gi, String(date.getUTCDate()))
      .replace(/__MIN__/g, two(date.getUTCMinutes()));
  }
  const sections = numberFormat.split(";");
  const section = sections[numericValue < 0 ? 1 : numericValue === 0 ? 2 : 0] || sections[0];
  const percent = section.includes("%");
  const cleaned = section.replace(/"([^"]*)"/g, "$1").replace(/_.|\*./g, "");
  const tokenMatch = cleaned.match(/[0#?][0#?,]*(?:\.[0#?]+)?/);
  if (!tokenMatch) return String(value);
  const token = tokenMatch[0];
  const decimals = token.includes(".") ? token.split(".")[1].replace(/[^0#?]/g, "").length : 0;
  const scaled = percent ? numericValue * 100 : numericValue;
  const numericText = Math.abs(scaled).toLocaleString("en-US", { useGrouping: token.split(".")[0].includes(","), minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  const prefix = cleaned.slice(0, tokenMatch.index);
  const suffix = cleaned.slice(tokenMatch.index + token.length);
  const wrappedPrefix = prefix.replace(/[()]/g, "");
  const wrappedSuffix = suffix.replace(/[()]/g, "");
  if (numericValue < 0 && section.includes("(")) return `(${wrappedPrefix}${numericText}${wrappedSuffix})`;
  return `${prefix}${numericValue < 0 && !prefix.includes("-") ? "-" : ""}${numericText}${suffix}`;
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
  if (host === "et") {
    const cellCount = state.et.selectionRowCount * state.et.selectionColumnCount;
    const shape = { sheetName: state.et.sheetName, address: state.et.selectionAddress, rowCount: state.et.selectionRowCount, columnCount: state.et.selectionColumnCount, cellCount };
    if (cellCount > selectionPreviewCellLimit) return { ...shape, previewSkipped: true, textPreview: "大选区已跳过预览，避免 WPS 卡顿" };
    return { ...shape, previewSkipped: false, textPreview: JSON.stringify(state.et.cells[state.et.selectionAddress] || []) };
  }
  if (host === "wpp") return { start: state.wpp.selectionStart, end: state.wpp.selectionEnd, textPreview: state.wpp.selectionText.slice(0, 500), length: state.wpp.selectionText.length };
  return null;
}

async function register() {
  const capabilities = host === "et" ? ["et.read_selection", "et.select_range", "et.inspect_sheet_overlays", "et.delete_sheet_overlays", "et.list_worksheets", "et.add_worksheet", "et.rename_worksheet", "et.delete_worksheet", "et.read_range", "et.write_range", "et.format_range", "et.read_format_sample", "et.verify_range", "et.clear_range", "et.find_cells", "et.write_blocks", "et.save_workbook", "et.create_chart", "et.insert_picture", "et.insert_shape"] : ["wpp.read_selection", "wpp.read_document_identity", "wpp.read_document_text", "wpp.select_range", "wpp.select_paragraph", "wpp.select_current_paragraph", "wpp.get_selection_range", "wpp.list_paragraphs", "wpp.get_paragraph_range", "wpp.find_block", "wpp.find_text", "wpp.replace_text", "wpp.replace_between_anchors", "wpp.replace_paragraph", "wpp.replace_current_paragraph", "wpp.replace_block", "wpp.insert_after_paragraph", "wpp.insert_before_paragraph", "wpp.insert_table_after_paragraph", "wpp.insert_table_before_paragraph", "wpp.read_format", "wpp.read_text_format", "wpp.apply_text_format", "wpp.read_paragraph_format", "wpp.apply_paragraph_format_by_indexes", "wpp.copy_paragraph_format", "wpp.copy_selected_paragraph_format_to_indexes", "wpp.compare_paragraph_format", "wpp.list_tables", "wpp.select_table", "wpp.replace_table_values", "wpp.ensure_table_sync_anchor", "wpp.resolve_table_sync_anchor", "wpp.read_table", "wpp.read_table_cell", "wpp.write_table_cell", "wpp.insert_table_rows", "wpp.delete_table_rows", "wpp.insert_table_columns", "wpp.delete_table_columns", "wpp.merge_table_cells", "wpp.format_table", "wpp.format_table_range", "wpp.format_table_rows", "wpp.format_table_columns", "wpp.read_table_format_sample", "wpp.read_table_format_range", "wpp.read_table_structure", "wpp.read_table_cell_styles", "wpp.read_table_format", "wpp.capture_table_format", "wpp.save_table_format_template", "wpp.list_table_format_templates", "wpp.apply_table_format_template", "wpp.delete_table_format_template", "wpp.apply_table_format", "wpp.copy_table_style", "wpp.duplicate_table_appearance", "wpp.insert_table_with_layout", "wpp.reset_table_layout", "wpp.read_cell_format", "wpp.apply_cell_format", "wpp.read_row_heights", "wpp.set_row_heights", "wpp.read_column_widths", "wpp.set_column_widths", "wpp.read_merged_cells", "wpp.apply_merged_cells", "wpp.insert_image", "wpp.read_images", "wpp.format_image", "wpp.delete_image", "wpp.add_comment", "wpp.add_comment_by_text", "wpp.add_comments_batch", "wpp.read_comments", "wpp.delete_comment", "wpp.set_track_changes", "wpp.read_revisions", "wpp.accept_revision", "wpp.reject_revision", "wpp.accept_all_revisions", "wpp.reject_all_revisions", "wpp.list_styles", "wpp.apply_style", "wpp.insert_page_break", "wpp.insert_paragraph_break", "wpp.delete_extra_blank_paragraphs", "wpp.save_document", "wpp.insert_text", "wpp.format_selection", "wpp.set_paragraph", "wpp.insert_table"];
  await request("/api/sessions/register", {
    method: "POST",
    body: JSON.stringify({
      sessionId,
      host,
      documentName: state[host].documentName,
      documentKey: process.env.WPS_CONNECTOR_SIM_DOCUMENT_KEY || "",
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

  function simParagraphs() { return state.wpp.insertedText ? state.wpp.insertedText.split(/\n/) : [""]; }
  function simSetParagraphs(paragraphs) { state.wpp.insertedText = paragraphs.join("\n"); }
  function simParagraphItem(index) {
    const paragraphs = simParagraphs();
    const n = simIndex(index, "index");
    if (n > paragraphs.length) fail("PARAGRAPH_NOT_FOUND", "Paragraph not found: " + n, { index: n, paragraphCount: paragraphs.length });
    let start = 0;
    for (let i = 0; i < n - 1; i += 1) start += paragraphs[i].length + 1;
    const text = paragraphs[n - 1];
    const formatSummary = state.wpp.paragraphFormats[n] || state.wpp.format.paragraph || {};
    return { index: n, paragraphIndex: n, paragraphCount: paragraphs.length, text, preview: text.slice(0, 240), range: { start, end: start + text.length, normalizedStart: start, normalizedEnd: start + text.length, nativeStart: start, nativeEnd: start + text.length, text, selectedText: text, length: text.length, paragraphIndex: n, isInsideTable: false, tableIndex: null, cellRow: null, cellColumn: null }, styleName: state.wpp.styleName || "正文", formatSummary, isInsideTable: false, tableIndex: null, cellRow: null, cellColumn: null };
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
    const cellCount = state.et.selectionRowCount * state.et.selectionColumnCount;
    if (cellCount > selectionPreviewCellLimit) {
      return {
        host: "et",
        sheetName: state.et.sheetName,
        address: state.et.selectionAddress,
        rowCount: state.et.selectionRowCount,
        columnCount: state.et.selectionColumnCount,
        cellCount,
        previewSkipped: true,
        textPreview: "大选区已跳过预览，避免 WPS 卡顿",
        values: null,
        text: "",
        warning: "Selection is too large to read safely; pass an explicit smaller address to et.read_range.",
      };
    }
    return {
      host: "et",
      sheetName: state.et.sheetName,
      address: state.et.selectionAddress,
      rowCount: state.et.selectionRowCount,
      columnCount: state.et.selectionColumnCount,
      cellCount,
      previewSkipped: false,
      values: state.et.cells[state.et.selectionAddress] || [],
      text: JSON.stringify(state.et.cells[state.et.selectionAddress] || []),
    };
  }
  if (command.toolName === "et.select_range") { const sheetName = requireSheet(command.input.sheetName); const address = requireAddress(command.input.address); state.et.sheetName = sheetName; state.et.selectionAddress = address; const values = state.et.cells[address] || []; state.et.selectionRowCount = values.length || 1; state.et.selectionColumnCount = values[0]?.length || 1; return { host: "et", selected: true, sheetName, address, rowCount: state.et.selectionRowCount, columnCount: state.et.selectionColumnCount }; }
  if (command.toolName === "et.inspect_sheet_overlays") return { host: "et", sheetName: state.et.sheetName, shapes: state.et.shapes || [], comments: state.et.comments || [], validations: state.et.validations || [], counts: { shapes: (state.et.shapes || []).length, comments: (state.et.comments || []).length, validations: (state.et.validations || []).length } };
  if (command.toolName === "et.delete_sheet_overlays") { const q = String(command.input.query || command.input.text || "").toLowerCase(); const match = (item) => command.input.deleteAll === true || JSON.stringify(item).toLowerCase().includes(q); const before = { shapes: state.et.shapes || [], comments: state.et.comments || [], validations: state.et.validations || [] }; const deleted = { shapes: before.shapes.filter(match), comments: before.comments.filter(match), validations: before.validations.filter(match) }; if (!command.input.dryRun) { state.et.shapes = before.shapes.filter(x => !match(x)); state.et.comments = before.comments.filter(x => !match(x)); state.et.validations = before.validations.filter(x => !match(x)); } return { host: "et", deleted: !command.input.dryRun, dryRun: command.input.dryRun === true, query: q, ...deleted, counts: { shapes: deleted.shapes.length, comments: deleted.comments.length, validations: deleted.validations.length } }; }
  if (command.toolName === "et.create_chart") {
    const sheetName = requireSheet(command.input.sheetName);
    requireAddress(command.input.address);
    const chartType = String(command.input.chartType || "").trim().toLowerCase();
    if (!["column", "bar", "line", "pie", "combo", "area", "scatter"].includes(chartType)) fail("INVALID_ARGUMENT", `Unsupported chartType: ${command.input.chartType}`, { chartType });
    const dataRange = String(command.input.dataRange || "").trim();
    if (!dataRange) fail("INVALID_ARGUMENT", "dataRange is required.", { field: "dataRange" });
    const name = String(command.input.name || `ConnectorChart_${Date.now().toString(36)}`);
    const shape = { index: state.et.shapes.length + 1, name, kind: "chart", chartType, dataRange, categoryRange: command.input.categoryRange || "", seriesRanges: command.input.seriesRanges || [], title: command.input.title || "", width: command.input.width || 360, height: command.input.height || 240, address: command.input.address, sheetName };
    state.et.shapes.push(shape);
    return { host: "et", createdChart: true, chartType, shapeName: name, shapeIndex: shape.index, address: command.input.address, sheetName, dataRange, categoryRange: shape.categoryRange, seriesRanges: shape.seriesRanges, title: shape.title, width: shape.width, height: shape.height, verification: { found: true, object: shape, shapeCount: state.et.shapes.length } };
  }
  if (command.toolName === "et.insert_picture") {
    const sheetName = requireSheet(command.input.sheetName);
    requireAddress(command.input.address);
    const source = String(command.input.imagePath || command.input.imageUrl || "").trim();
    if (!source) fail("INVALID_ARGUMENT", "imagePath or imageUrl is required.", { fields: ["imagePath", "imageUrl"] });
    const name = String(command.input.name || `ConnectorPicture_${Date.now().toString(36)}`);
    const shape = { index: state.et.shapes.length + 1, name, kind: "picture", source, sourceType: command.input.imagePath ? "path" : "url", width: command.input.width || 160, height: command.input.height || 120, lockAspectRatio: command.input.lockAspectRatio === undefined ? true : command.input.lockAspectRatio, address: command.input.address, sheetName };
    state.et.shapes.push(shape);
    return { host: "et", insertedPicture: true, shapeName: name, shapeIndex: shape.index, address: command.input.address, sheetName, source, sourceType: shape.sourceType, width: shape.width, height: shape.height, lockAspectRatio: shape.lockAspectRatio, verification: { found: true, object: shape, shapeCount: state.et.shapes.length } };
  }
  if (command.toolName === "et.insert_shape") {
    const sheetName = requireSheet(command.input.sheetName);
    requireAddress(command.input.address);
    const shapeType = String(command.input.shapeType || "").trim().toLowerCase();
    if (!["textbox", "rectangle", "arrow", "line", "oval"].includes(shapeType)) fail("INVALID_ARGUMENT", `Unsupported shapeType: ${command.input.shapeType}`, { shapeType });
    const name = String(command.input.name || `ConnectorShape_${Date.now().toString(36)}`);
    const shape = { index: state.et.shapes.length + 1, name, kind: shapeType === "textbox" ? "textBox" : "shape", shapeType, text: command.input.text || "", width: command.input.width || 120, height: command.input.height || 80, fillColor: command.input.fillColor || "", lineColor: command.input.lineColor || "", address: command.input.address, sheetName };
    state.et.shapes.push(shape);
    return { host: "et", insertedShape: true, shapeName: name, shapeIndex: shape.index, address: command.input.address, sheetName, shapeType, text: shape.text, width: shape.width, height: shape.height, fillColor: shape.fillColor, lineColor: shape.lineColor, verification: { found: true, object: shape, shapeCount: state.et.shapes.length } };
  }
  if (command.toolName === "et.list_worksheets") return { host: "et", count: state.et.worksheets.length, worksheets: state.et.worksheets.map((name, i) => ({ index: i + 1, name, active: name === state.et.sheetName })) };
  if (command.toolName === "et.add_worksheet") { const name = command.input.name || command.input.sheetName || `Sheet${state.et.worksheets.length + 1}`; state.et.worksheets.push(name); if (command.input.activate !== false) state.et.sheetName = name; return { host: "et", sheetName: name, added: true }; }
  if (command.toolName === "et.rename_worksheet") { const idx = state.et.worksheets.indexOf(command.input.oldName); if (idx < 0) throw new Error("Sheet not found"); state.et.worksheets[idx] = command.input.newName; if (state.et.sheetName === command.input.oldName || command.input.activate) state.et.sheetName = command.input.newName; return { host: "et", oldName: command.input.oldName, newName: command.input.newName, renamed: true }; }
  if (command.toolName === "et.delete_worksheet") { const sheetName = requireSheet(command.input.sheetName); const userSheets = state.et.worksheets.filter((name) => !isSystemSheet(name)); if (!command.input.force && isProtectedSheet(sheetName)) fail("LAST_SHEET_DELETE_REFUSED", "Refusing to delete a protected worksheet.", { sheetName, sheetCount: state.et.worksheets.length, userSheetCount: userSheets.length, forceSupported: true }); if (state.et.worksheets.length <= 1 || (!isSystemSheet(sheetName) && userSheets.length <= 1)) fail("LAST_SHEET_DELETE_REFUSED", "Refusing to delete the last user worksheet.", { sheetName, sheetCount: state.et.worksheets.length, userSheetCount: userSheets.length }); state.et.worksheets = state.et.worksheets.filter((name) => name !== sheetName); state.et.sheetName = state.et.worksheets[0]; return { host: "et", sheetName, deleted: true }; }
  if (command.toolName === "et.read_range") {
    const sheetName = requireSheet(command.input.sheetName);
    const address = requireAddress(command.input.address);
    const values = state.et.cells[address] || [];
    const result = { host: "et", sheetName, address, values, text: JSON.stringify(values) };
    if (command.input.includeFormulas) result.formulas = state.et.formulas[address] || [];
    const bounds = simRangeBounds(address);
    const rowCount = values.length;
    const columnCount = Math.max(0, ...values.map((row) => row.length));
    const cellFormats = Array.from({ length: rowCount }, (_, row) => Array.from({ length: columnCount }, (_, column) => simFormatForCell(sheetName, (bounds?.startRow || 1) + row, (bounds?.startColumn || 1) + column)));
    const displayText = values.map((row, rowIndex) => row.map((value, columnIndex) => simDisplayValue(value, cellFormats[rowIndex]?.[columnIndex])));
    if (command.input.includeDisplayText) result.displayText = displayText;
    if (command.input.includeFormats) {
      const rowHeights = Array.from({ length: rowCount }, (_, row) => {
        const height = Number(cellFormats[row]?.find((format) => Number(format?.rowHeight) > 0)?.rowHeight);
        return height > 0 ? { row: row + 1, height } : null;
      }).filter(Boolean);
      const columnWidths = Array.from({ length: columnCount }, (_, column) => {
        const width = Number(cellFormats.map((row) => row?.[column]).find((format) => Number(format?.columnWidth) > 0)?.columnWidth);
        return width > 0 ? { column: column + 1, width } : null;
      }).filter(Boolean);
      result.formats = cellFormats[0]?.[0] || {};
      result.formatSnapshot = { version: 2, rowCount, columnCount, cells: cellFormats, displayText, rowHeights, columnWidths, readStrategy: command.input.formatMode === "profile" ? "profile" : "full", exactFields: command.input.formatMode === "profile" ? ["numberFormat", "horizontalAlignment", "verticalAlignment", "wrapText", "italic", "underline", "indentLevel", "leftIndent", "firstLineIndent", "rightIndent"] : [], sampleRows: command.input.formatMode === "profile" ? [1, ...(rowCount > 1 ? [2] : [])] : [], sampleCount: command.input.formatMode === "profile" ? Math.min(rowCount, 2) * columnCount : rowCount * columnCount };
      result.formatReadStrategy = result.formatSnapshot.readStrategy;
    }
    return result;
  }
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
  if (command.toolName === "et.format_range") { requireSheet(command.input.sheetName); const address = requireAddress(command.input.address); state.et.formats[address] = { ...(state.et.formats[address] || {}), ...command.input }; return { host: "et", address, formatted: true }; }
  if (command.toolName === "et.read_format_sample") {
    requireSheet(command.input.sheetName);
    const cells = Array.isArray(command.input.cells) && command.input.cells.length ? command.input.cells : [{ address: command.input.address }];
    const results = cells.map((item) => {
      const address = requireAddress(typeof item === "string" ? item : item.address);
      return { address, format: pickFields(state.et.formats[address] || {}, command.input.fields || []) };
    });
    return { host: "et", sheetName: command.input.sheetName || state.et.sheetName, count: results.length, fields: command.input.fields || [], cells: results };
  }
  if (command.toolName === "et.verify_range") {
    requireSheet(command.input.sheetName);
    const address = requireAddress(command.input.address);
    const values = state.et.cells[address] || [];
    const formulas = state.et.formulas[address] || [];
    const errors = [];
    for (let r = 0; r < values.length; r += 1) for (let c = 0; c < (values[r] || []).length; c += 1) if (/^#(REF!|DIV\/0!|VALUE!|NAME\?|N\/A)$/i.test(String(values[r][c] || ""))) errors.push({ address, value: values[r][c], formula: formulas[r]?.[c] });
    return { host: "et", sheetName: command.input.sheetName || state.et.sheetName, address, ok: errors.length === 0, checks: { formulaErrors: errors.length === 0 }, formulaErrorCount: errors.length, formulaErrors: errors };
  }
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
    return { host: "wpp", start, end, length: Math.max(0, end - start), truncated: end - start > maxLength, textModel: "normalized-wps-range-v2", viewMode: command.input.viewMode || "includeRevisions", revisionState: { trackChangesState: Boolean(state.wpp.trackChanges), revisionCount: state.wpp.revisions.length }, text: text.slice(start, end).slice(0, maxLength) };
  }
  if (command.toolName === "wpp.select_range") {
    let start = command.input.start;
    let end = command.input.end;
    if (command.input.rangeId && (start === undefined || end === undefined)) {
      const match = /^sim-range-(\d+)-(\d+)$/.exec(String(command.input.rangeId));
      if (match) { start = Number(match[1]); end = Number(match[2]); }
    }
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start) fail("INVALID_ARGUMENT", "Invalid WPP range.", { start, end });
    state.wpp.selectionStart = start;
    state.wpp.selectionEnd = end;
    state.wpp.selectionText = state.wpp.insertedText.slice(start, end);
    return { host: "wpp", selected: true, start, end, text: state.wpp.selectionText, requestedStart: start, requestedEnd: end, resolvedStart: start, resolvedEnd: end, resolvedText: state.wpp.selectionText, exactMatch: true, attempts: [{ label: "simulated", start, end, resolvedText: state.wpp.selectionText, exactMatch: true }] };
  }


  if (command.toolName === "wpp.get_selection_range") return { host: "wpp", selection: { start: state.wpp.selectionStart, end: state.wpp.selectionEnd, normalizedStart: state.wpp.selectionStart, normalizedEnd: state.wpp.selectionEnd, nativeStart: state.wpp.selectionStart, nativeEnd: state.wpp.selectionEnd, text: state.wpp.selectionText, selectedText: state.wpp.selectionText, length: state.wpp.selectionText.length, paragraphIndex: 1, isInsideTable: false, tableIndex: null, cellRow: null, cellColumn: null } };
  if (command.toolName === "wpp.select_paragraph") {
    const index = simIndex(command.input.index, "index");
    const paragraphs = state.wpp.insertedText.split(/\n+/);
    if (index > paragraphs.length) fail("PARAGRAPH_NOT_FOUND", "Paragraph not found: " + index, { index, paragraphCount: paragraphs.length });
    let start = 0;
    for (let i = 0; i < index - 1; i += 1) start += paragraphs[i].length + 1;
    const text = paragraphs[index - 1];
    state.wpp.selectionStart = start; state.wpp.selectionEnd = start + text.length; state.wpp.selectionText = text;
    return { host: "wpp", selected: true, paragraphIndex: index, paragraphCount: paragraphs.length, affectedRange: { start, end: start + text.length, normalizedStart: start, normalizedEnd: start + text.length, nativeStart: start, nativeEnd: start + text.length, text, length: text.length } };
  }
  if (command.toolName === "wpp.select_current_paragraph") return { host: "wpp", selected: true, affectedRange: { start: state.wpp.selectionStart, end: state.wpp.selectionEnd, normalizedStart: state.wpp.selectionStart, normalizedEnd: state.wpp.selectionEnd, nativeStart: state.wpp.selectionStart, nativeEnd: state.wpp.selectionEnd, text: state.wpp.selectionText, length: state.wpp.selectionText.length } };


  if (command.toolName === "wpp.list_paragraphs") {
    const paragraphs = simParagraphs().map((_, i) => simParagraphItem(i + 1));
    const maxCount = command.input.maxCount || 100;
    const startIndex = command.input.startIndex || command.input.start || 1;
    const endIndex = command.input.endIndex || command.input.end || paragraphs.length;
    const page = paragraphs.filter((p) => p.paragraphIndex >= startIndex && p.paragraphIndex <= endIndex).slice(0, maxCount);
    const last = page[page.length - 1]?.paragraphIndex || startIndex - 1;
    const nextStartIndex = last < Math.min(endIndex, paragraphs.length) ? last + 1 : null;
    const fields = Array.isArray(command.input.fields) && command.input.fields.length ? command.input.fields : null;
    const projected = fields ? page.map((item) => Object.fromEntries(fields.map((field) => [field, field === "index" ? item.index : item[field]]).filter((entry) => entry[1] !== undefined))) : page;
    return { host: "wpp", paragraphCount: paragraphs.length, count: page.length, startIndex, endIndex, maxCount, nextStartIndex, truncated: nextStartIndex !== null, paragraphs: projected };
  }
  if (command.toolName === "wpp.get_paragraph_range") {
    const item = simParagraphItem(command.input.index);
    return { host: "wpp", paragraphIndex: item.paragraphIndex, affectedRange: item.range, resolvedTextPreview: item.preview, styleName: item.styleName, isInsideTable: false, tableIndex: null, cellRow: null, cellColumn: null };
  }
  if (command.toolName === "wpp.find_block") {
    const anchorText = String(command.input.anchorText || "").trim();
    if (!anchorText) fail("INVALID_ARGUMENT", "anchorText is required.", { field: "anchorText" });
    const item = simParagraphs().map((_, i) => simParagraphItem(i + 1)).find((p) => command.input.options?.matchWholeParagraph ? p.text.trim() === anchorText : p.text.includes(anchorText));
    if (!item) fail("BLOCK_NOT_FOUND", "Block anchor not found: " + anchorText, { anchorText });
    return { host: "wpp", found: true, blockType: command.input.options?.blockType || "paragraph", anchorText, affectedParagraphIndex: item.paragraphIndex, startParagraphIndex: item.paragraphIndex, endParagraphIndex: item.paragraphIndex, affectedRange: item.range, resolvedTextPreview: item.preview, exactMatch: item.text.includes(anchorText), hostAcceptedFields: [], hostRejectedFields: [] };
  }

  if (command.toolName === "wpp.find_text") {
    const query = String(command.input.query || "");
    if (!query) fail("INVALID_ARGUMENT", "query is required.", { field: "query" });
    const maxResults = command.input.maxResults || 50;
    const text = state.wpp.insertedText;
    const haystack = command.input.matchCase ? text : text.toLowerCase();
    const needle = command.input.matchCase ? query : query.toLowerCase();
    const results = [];
    let pos = 0;
    while (results.length < maxResults) {
      const index = haystack.indexOf(needle, pos);
      if (index < 0) break;
      const end = index + query.length;
      results.push({ index: results.length + 1, text: text.slice(index, end), rangeId: `sim-range-${index}-${end}`, start: index, end, normalizedStart: index, normalizedEnd: end, nativeStart: index, nativeEnd: end, exactMatch: true, preview: { before: text.slice(Math.max(0, index - 40), index), match: text.slice(index, end), after: text.slice(end, end + 40) } });
      pos = Math.max(index + 1, end);
    }
    return { host: "wpp", query, count: results.length, truncated: results.length >= maxResults, textModel: "native-wps-find-v2", results };
  }
  if (command.toolName === "wpp.replace_text") {
    const findText = String(command.input.findText || "");
    if (!findText) fail("INVALID_ARGUMENT", "findText is required.", { field: "findText" });
    const found = execute({ toolName: "wpp.find_text", input: { query: findText, matchCase: command.input.matchCase, matchWholeWord: command.input.matchWholeWord, maxResults: 1000 } }).results;
    if (!found.length) fail("TEXT_NOT_FOUND", "Text not found: " + findText, { findText });
    const occurrence = command.input.occurrence === undefined ? "first" : command.input.occurrence;
    let targets = [];
    if (occurrence === "all") targets = found;
    else if (occurrence === "last") targets = [found[found.length - 1]];
    else if (occurrence === "first") targets = [found[0]];
    else {
      const wanted = occurrence === "index" ? simIndex(command.input.index, "index") : simIndex(occurrence, "occurrence");
      if (wanted > found.length) fail("TEXT_NOT_FOUND", "Text occurrence not found: " + wanted, { findText, occurrence: wanted, count: found.length });
      targets = [found[wanted - 1]];
    }
    const replaceText = String(command.input.replaceText ?? "");
    const replacements = [];
    for (const target of [...targets].sort((a, b) => b.start - a.start)) {
      state.wpp.insertedText = state.wpp.insertedText.slice(0, target.start) + replaceText + state.wpp.insertedText.slice(target.end);
      replacements.unshift({ index: target.index, start: target.start, end: target.end, nativeStart: target.nativeStart, nativeEnd: target.nativeEnd, before: target.text, after: replaceText, beforePreview: target.preview });
    }
    return { host: "wpp", replaced: replacements.length > 0, replacedCount: replacements.length, findText, replaceText, replacements };
  }
  if (command.toolName === "wpp.replace_between_anchors") {
    const startAnchor = String(command.input.startAnchorText || "");
    const endAnchor = String(command.input.endAnchorText || "");
    const replacementText = String(command.input.replacementText ?? "");
    const startIndex = state.wpp.insertedText.indexOf(startAnchor);
    if (startIndex < 0) fail("TEXT_NOT_FOUND", "Anchor text not found: " + startAnchor, { field: "startAnchorText" });
    const endIndex = state.wpp.insertedText.indexOf(endAnchor, startIndex + startAnchor.length);
    if (endIndex < 0) fail("TEXT_NOT_FOUND", "End anchor not found after start anchor.", { field: "endAnchorText" });
    const replaceStart = command.input.includeStart ? startIndex : startIndex + startAnchor.length;
    const replaceEnd = command.input.includeEnd ? endIndex + endAnchor.length : endIndex;
    const beforeText = state.wpp.insertedText.slice(replaceStart, replaceEnd);
    state.wpp.insertedText = state.wpp.insertedText.slice(0, replaceStart) + replacementText + state.wpp.insertedText.slice(replaceEnd);
    return { host: "wpp", replaced: true, startAnchor: { text: startAnchor, nativeStart: startIndex, nativeEnd: startIndex + startAnchor.length }, endAnchor: { text: endAnchor, nativeStart: endIndex, nativeEnd: endIndex + endAnchor.length }, affectedNativeRange: { nativeStart: replaceStart, nativeEnd: replaceEnd }, beforeSummary: { length: beforeText.length, start: beforeText.slice(0, 300), end: beforeText.slice(-300) }, replacementLength: replacementText.length, verification: { containsReplacement: state.wpp.insertedText.includes(replacementText), containsOldStart: beforeText ? state.wpp.insertedText.includes(beforeText.slice(0, 80)) : false, checksum: String(state.wpp.insertedText.length), length: state.wpp.insertedText.length }, elapsedMs: 1 };
  }


  if (command.toolName === "wpp.read_text_format") return { host: "wpp", affectedRange: { start: state.wpp.selectionStart, end: state.wpp.selectionEnd, text: state.wpp.selectionText }, effectiveFormat: state.wpp.format.font || {} };
  if (command.toolName === "wpp.apply_text_format") {
    const format = command.input.format || {};
    state.wpp.format.font = { ...(state.wpp.format.font || {}), ...format };
    return { host: "wpp", applied: Object.keys(format).length > 0, affectedRange: { start: command.input.start ?? state.wpp.selectionStart, end: command.input.end ?? state.wpp.selectionEnd, text: state.wpp.selectionText }, effectiveFormat: state.wpp.format.font, hostAcceptedFields: Object.keys(format), hostRejectedFields: [] };
  }
  if (command.toolName === "wpp.read_paragraph_format") {
    const indexes = command.input.paragraphIndexes || [];
    const per = indexes.length ? indexes.map((index) => ({ paragraphIndex: index, affectedRange: simParagraphItem(index).range, textPreview: simParagraphItem(index).preview, styleName: "正文", format: state.wpp.paragraphFormats[index] || state.wpp.format.paragraph || {} })) : [{ paragraphIndex: 1, affectedRange: { start: state.wpp.selectionStart, end: state.wpp.selectionEnd, text: state.wpp.selectionText }, textPreview: state.wpp.selectionText, styleName: "正文", format: state.wpp.format.paragraph || {} }];
    return { host: "wpp", affectedRange: per[0].affectedRange, effectiveFormat: per[0].format, mixedFields: [], perParagraphFormats: per };
  }
  if (command.toolName === "wpp.apply_paragraph_format_by_indexes") {
    const indexes = command.input.paragraphIndexes || [];
    const format = command.input.format || {};
    const dryRun = Boolean(command.input.dryRun);
    const affectedParagraphs = indexes.map((index) => {
      const before = state.wpp.paragraphFormats[index] || {};
      if (!dryRun) state.wpp.paragraphFormats[index] = { ...before, ...format };
      const item = simParagraphItem(index);
      return { paragraphIndex: index, ok: true, dryRun, affectedRange: item.range, textPreview: item.preview, styleName: item.styleName, beforeFormat: before, effectiveFormat: dryRun ? before : state.wpp.paragraphFormats[index], hostAcceptedFields: dryRun ? [] : Object.keys(format), hostRejectedFields: [] };
    });
    const full = { host: "wpp", applied: !dryRun && affectedParagraphs.length > 0, dryRun, fastPath: !dryRun && command.input.fastPath !== false ? "contiguous-range" : "per-paragraph", hostCallsSaved: !dryRun && command.input.fastPath !== false ? Math.max(0, indexes.length - 1) : 0, affectedCount: affectedParagraphs.length, affectedParagraphIndexes: indexes, affectedParagraphs, perParagraphFormats: affectedParagraphs.map((p) => ({ paragraphIndex: p.paragraphIndex, affectedRange: p.affectedRange, textPreview: p.textPreview, styleName: p.styleName, format: p.effectiveFormat })), hostAcceptedFields: Object.keys(format), hostRejectedFields: [] };
    if (command.input.summaryOnly === false) return full;
    return { host: "wpp", applied: full.applied, dryRun, fastPath: full.fastPath, hostCallsSaved: full.hostCallsSaved, affectedCount: affectedParagraphs.length, affectedParagraphIndexes: indexes, acceptedFields: Object.keys(format), rejectedFields: [] };
  }
  if (command.toolName === "wpp.copy_paragraph_format" || command.toolName === "wpp.copy_selected_paragraph_format_to_indexes") {
    const source = command.toolName === "wpp.copy_selected_paragraph_format_to_indexes" ? 1 : simIndex(command.input.sourceParagraphIndex, "sourceParagraphIndex");
    const format = state.wpp.paragraphFormats[source] || state.wpp.format.paragraph || {};
    const result = execute({ toolName: "wpp.apply_paragraph_format_by_indexes", input: { paragraphIndexes: command.input.targetParagraphIndexes || [], format, dryRun: command.input.dryRun } });
    return { ...result, copied: !result.dryRun && result.applied, sourceParagraphIndex: source, sourceFormat: format, copiedFields: Object.keys(format), targetParagraphIndexes: command.input.targetParagraphIndexes || [], affectedCount: (command.input.targetParagraphIndexes || []).length };
  }
  if (command.toolName === "wpp.compare_paragraph_format") {
    const source = simIndex(command.input.sourceParagraphIndex, "sourceParagraphIndex");
    const sourceFormat = state.wpp.paragraphFormats[source] || state.wpp.format.paragraph || {};
    const comparisons = (command.input.targetParagraphIndexes || []).map((index) => {
      const targetFormat = state.wpp.paragraphFormats[index] || state.wpp.format.paragraph || {};
      const diffs = Object.keys(sourceFormat).filter((field) => String(sourceFormat[field]) !== String(targetFormat[field])).map((field) => ({ field, source: sourceFormat[field], target: targetFormat[field] }));
      return { paragraphIndex: index, matches: diffs.length === 0, differingFields: diffs.map((diff) => diff.field), diffs, textPreview: simParagraphItem(index).preview, format: targetFormat };
    });
    const full = { host: "wpp", sourceParagraphIndex: source, sourceFormat, targetParagraphIndexes: command.input.targetParagraphIndexes || [], allMatch: comparisons.every((item) => item.matches), diffCount: comparisons.reduce((sum, item) => sum + item.differingFields.length, 0), comparisons };
    if (command.input.summaryOnly === false) return full;
    return { host: "wpp", sourceParagraphIndex: source, targetParagraphIndexes: command.input.targetParagraphIndexes || [], allMatch: full.allMatch, diffCount: full.diffCount };
  }


  if (command.toolName === "wpp.replace_paragraph") {
    const item = simParagraphItem(command.input.index);
    const paragraphs = simParagraphs();
    paragraphs[item.paragraphIndex - 1] = String(command.input.text ?? "");
    simSetParagraphs(paragraphs);
    const after = simParagraphItem(item.paragraphIndex);
    return { host: "wpp", applied: true, exactMatch: after.text === String(command.input.text ?? ""), affectedParagraphIndex: item.paragraphIndex, affectedRange: after.range, beforeText: item.text, afterText: after.text, resolvedTextPreview: after.preview, hostAcceptedFields: ["text"], hostRejectedFields: [] };
  }
  if (command.toolName === "wpp.replace_current_paragraph") return execute({ toolName: "wpp.replace_paragraph", input: { index: 1, text: command.input.text } });
  if (command.toolName === "wpp.replace_block") {
    const block = execute({ toolName: "wpp.find_block", input: { anchorText: command.input.anchorText, options: command.input.options || {} } });
    return execute({ toolName: "wpp.replace_paragraph", input: { index: block.affectedParagraphIndex, text: command.input.text } });
  }
  if (command.toolName === "wpp.insert_after_paragraph" || command.toolName === "wpp.insert_before_paragraph") {
    const item = simParagraphItem(command.input.index);
    const paragraphs = simParagraphs();
    const insertAt = command.toolName === "wpp.insert_before_paragraph" ? item.paragraphIndex - 1 : item.paragraphIndex;
    paragraphs.splice(insertAt, 0, String(command.input.text ?? ""));
    simSetParagraphs(paragraphs);
    return { host: "wpp", applied: true, exactMatch: true, affectedParagraphIndex: item.paragraphIndex, position: command.toolName.includes("before") ? "before" : "after", affectedRange: simParagraphItem(insertAt + 1).range, resolvedTextPreview: String(command.input.text ?? "").slice(0, 500), hostAcceptedFields: ["text"], hostRejectedFields: [] };
  }
  if (command.toolName === "wpp.insert_table_after_paragraph" || command.toolName === "wpp.insert_table_before_paragraph") {
    const item = simParagraphItem(command.input.index);
    return { host: "wpp", insertedTable: true, tableIndex: state.wpp.tables.length + 1, rowCount: Number(command.input.rowCount), columnCount: Number(command.input.columnCount), applied: true, exactMatch: true, affectedParagraphIndex: item.paragraphIndex, position: command.toolName.includes("before") ? "before" : "after", affectedRange: item.range, hostAcceptedFields: ["table"], hostRejectedFields: [] };
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
  if (command.toolName === "wpp.set_paragraph") { const format = { ...(command.input.format || {}) }; for (const key of ["alignment", "spaceBefore", "spaceAfter", "lineSpacing", "lineSpacingRule", "lineSpacingValue", "firstLineIndent", "leftIndent", "rightIndent", "keepWithNext", "pageBreakBefore"]) if (command.input[key] !== undefined) format[key] = command.input[key]; state.wpp.format.paragraph = { ...(state.wpp.format.paragraph || {}), ...format }; return { host: "wpp", paragraphFormatted: Object.keys(format).length > 0, applied: Object.keys(format).length > 0, affectedRange: { start: command.input.start ?? state.wpp.selectionStart, end: command.input.end ?? state.wpp.selectionEnd, text: state.wpp.selectionText }, effectiveFormat: state.wpp.format.paragraph, hostAcceptedFields: Object.keys(format), hostRejectedFields: [] }; }

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



  if (command.toolName === "wpp.list_styles") return { host: "wpp", count: 6, styles: ["标题1", "标题2", "标题3", "正文", "项目符号", "编号列表"].map((name, index) => ({ index: index + 1, name })), builtIn: ["标题1", "标题2", "标题3", "正文", "项目符号", "编号列表"] };
  if (command.toolName === "wpp.apply_style") {
    const styleName = String(command.input.styleName || "").trim();
    if (!styleName) fail("INVALID_ARGUMENT", "styleName is required.", { field: "styleName" });
    state.wpp.styleName = styleName;
    return { host: "wpp", applied: true, styleName, affectedRange: { start: command.input.start ?? state.wpp.selectionStart, end: command.input.end ?? state.wpp.selectionEnd, text: state.wpp.selectionText }, effectiveFormat: { styleName }, hostAcceptedFields: ["styleName"], hostRejectedFields: [] };
  }
  if (command.toolName === "wpp.insert_page_break") { state.wpp.insertedText += "\f"; return { host: "wpp", inserted: true, breakType: "page", affectedRange: { start: command.input.start ?? state.wpp.selectionEnd } }; }
  if (command.toolName === "wpp.insert_paragraph_break") { state.wpp.insertedText += "\n"; return { host: "wpp", inserted: true, breakType: "paragraph", affectedRange: { start: command.input.start ?? state.wpp.selectionEnd } }; }
  if (command.toolName === "wpp.delete_extra_blank_paragraphs") { const before = state.wpp.insertedText; state.wpp.insertedText = before.replace(/\n{3,}/g, "\n\n"); return { host: "wpp", applied: before !== state.wpp.insertedText, deletedCount: before.length - state.wpp.insertedText.length, paragraphCountBefore: before.split(/\n/).length }; }

  if (command.toolName === "et.save_workbook") {
    const readback = command.input.readback || command.input.checksum ? { worksheetCount: state.et.worksheets.length, worksheetNames: [...state.et.worksheets], checksum: String(state.et.worksheets.join("|").length) } : null;
    return { host: "et", saved: true, path: "/tmp/" + state.et.documentName, savedAt: new Date().toISOString(), documentIdentity: { name: state.et.documentName, fullPath: "/tmp/" + state.et.documentName, sheetName: state.et.sheetName }, readback };
  }

  if (command.toolName === "wpp.save_document") {
    const readbackVisibleText = command.input.readbackVisibleText || command.input.checksum ? { length: state.wpp.insertedText.length, checksum: String(state.wpp.insertedText.length), preview: state.wpp.insertedText.slice(0, 500) } : null;
    return { host: "wpp", saved: true, path: "/tmp/" + state.wpp.documentName, savedAt: new Date().toISOString(), documentIdentity: { name: state.wpp.documentName, fullPath: "/tmp/" + state.wpp.documentName }, readbackVisibleText };
  }

  if (command.toolName === "wpp.insert_table" || command.toolName === "wpp.insert_table_with_layout") {
    const rowCount = Number(command.input.rowCount);
    const columnCount = Number(command.input.columnCount);
    if (!Number.isInteger(rowCount) || rowCount < 1) fail("INVALID_ARGUMENT", "rowCount must be an integer >= 1.", { field: "rowCount", value: command.input.rowCount });
    if (!Number.isInteger(columnCount) || columnCount < 1) fail("INVALID_ARGUMENT", "columnCount must be an integer >= 1.", { field: "columnCount", value: command.input.columnCount });
    const suppliedValues = command.input.values !== undefined ? requireMatrix(command.input.values, "values") : null;
    const values = suppliedValues
      ? Array.from({ length: rowCount }, (_, row) => Array.from({ length: columnCount }, (_, column) => String(suppliedValues[row]?.[column] ?? "")))
      : [];
    const tableWidth = columnCount * 72;
    const table = { rowCount, columnCount, values, headerRowBold: Boolean(command.input.headerRowBold), border: command.input.border !== false, alignment: command.input.alignment || "" };
    table.format = { table: { alignment: table.alignment, width: tableWidth, tableWidth: tableWidth, tableWidthType: "points", preferredWidth: tableWidth, preferredWidthType: 3, allowAutoFit: true, autoFit: true, borders: { enable: table.border ? 1 : 0, items: [] } }, rowHeights: Array.from({ length: rowCount }, (_, i) => ({ row: i + 1, height: 18, heightRule: 0 })), columnWidths: Array.from({ length: columnCount }, (_, i) => ({ column: i + 1, width: 72 })), mergedCells: [], cells: Array.from({ length: rowCount }, (_, r) => Array.from({ length: columnCount }, (_, c) => ({ row: r + 1, column: c + 1, font: { bold: table.headerRowBold && r === 0 }, paragraph: { alignment: table.alignment }, shading: {}, borders: { enable: table.border ? 1 : 0, items: [] } }))).flat() };
    if (command.toolName === "wpp.insert_table_with_layout") {
      table.format.table = { ...(table.format.table || {}), fitToPageWidth: command.input.fitToPageWidth !== false, preferredWidthPercent: command.input.preferredWidthPercent || 100, border: command.input.border !== false };
      table.format.rowHeights = Array.from({ length: rowCount }, (_, i) => ({ row: i + 1, height: 0, heightRule: 0 }));
      const first = Number(command.input.firstColumnWidth || 0);
      const equal = Number(command.input.equalDataColumnWidths || 0);
      if (first || equal) table.format.columnWidths = Array.from({ length: columnCount }, (_, i) => ({ column: i + 1, width: i === 0 && first ? first : equal || first }));
      state.wpp.tables.push(table);
      return { host: "wpp", insertedTable: true, insertedTableWithLayout: true, layoutApplied: true, tableIndex: state.wpp.tables.length, warnings: [], widthResult: { appliedColumns: table.format.columnWidths.map((c) => c.column), verifiedColumns: table.format.columnWidths.map((c) => c.column), warnings: [], results: table.format.columnWidths.map((c) => ({ column: c.column, requestedWidth: c.width, actualWidth: c.width, applied: true, verified: true })) }, formatSummary: { rowHeights: table.format.rowHeights, columnWidths: table.format.columnWidths }, ...table };
    }
    state.wpp.tables.push(table);
    const points = [[1, 1], [1, columnCount], [rowCount, 1], [rowCount, columnCount]];
    if (rowCount > 2) points.push([Math.ceil(rowCount / 2), Math.ceil(columnCount / 2)]);
    const seen = new Set();
    const samples = points.filter(([row, column]) => {
      const key = `${row}:${column}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).map(([row, column]) => ({ row, column, expected: values[row - 1]?.[column - 1] ?? "", actual: values[row - 1]?.[column - 1] ?? "", ok: true }));
    const verification = suppliedValues ? { ok: samples.every((item) => item.ok), samples } : null;
    // Keep the simulator aligned with the real WPS runtime: the Row.Range.Text
    // marker path is opt-in because it can block WPS Writer synchronously.
    const safeForRowBulk = suppliedValues && command.input.fastPath === "row-range-bulk" && values.every((row) => row.every((value) => !/[\t\r\n\x07]/.test(value)));
    const write = suppliedValues ? {
      writtenCells: rowCount * columnCount,
      writePath: safeForRowBulk ? "row-range-bulk" : "per-cell",
      hostCallsSaved: safeForRowBulk ? Math.max(0, rowCount * columnCount - rowCount) : 0,
      verification,
      ...(safeForRowBulk ? {} : { fallbackReason: "cell-content-requires-safe-path" }),
      elapsedMs: 0,
    } : null;
    return { host: "wpp", insertedTable: true, tableIndex: state.wpp.tables.length, release: { released: command.input.releaseSelection !== false, method: "simulated" }, write, verification, ...table };
  }
  if (command.toolName === "wpp.select_table") { const tableIndex = Number(command.input.tableIndex || 0); const table = state.wpp.tables[tableIndex]; if (!table) fail("WPP_TABLE_NOT_FOUND", "Table not found: " + tableIndex, { tableIndex, tableCount: state.wpp.tables.length }); state.wpp.selectedTableIndex = tableIndex; return { host: "wpp", selected: true, tableIndex, oneBasedTableIndex: tableIndex + 1, rowCount: table.rowCount, columnCount: table.columnCount }; }
  if (command.toolName === "wpp.list_tables") {
    const includeValues = command.input.includeValues !== false;
    const maxTables = Math.min(state.wpp.tables.length, command.input.maxTables || state.wpp.tables.length);
    const tables = state.wpp.tables.slice(0, maxTables).map((table, index) => ({ host: "wpp", tableIndex: index, index, oneBasedTableIndex: index + 1, name: `表格 ${index + 1}`, rowCount: table.rowCount, columnCount: table.columnCount, values: includeValues ? table.values : undefined, truncated: false }));
    return { host: "wpp", count: state.wpp.tables.length, tableCount: state.wpp.tables.length, tables, truncated: maxTables < state.wpp.tables.length };
  }
  if (command.toolName === "wpp.replace_table_values") {
    const tableIndex = Number(command.input.tableIndex || 0);
    const table = state.wpp.tables[tableIndex];
    if (!table) fail("TABLE_NOT_FOUND", `Table not found: ${tableIndex}`, { tableIndex, tableCount: state.wpp.tables.length });
    const values = requireMatrix(command.input.values, "values");
    const columnCount = Math.max(0, ...values.map((row) => row.length));
    if (columnCount !== table.columnCount) fail("TABLE_COLUMN_MISMATCH", "Column count mismatch.", { tableIndex, sourceColumnCount: columnCount, targetColumnCount: table.columnCount });
    if (values.length !== table.rowCount && command.input.allowStructuralChanges === false) fail("TABLE_ROW_MISMATCH", "Row count mismatch.", { tableIndex, sourceRowCount: values.length, targetRowCount: table.rowCount });
    table.values = values.map((row) => { const next = [...row]; while (next.length < columnCount) next.push(""); return next.slice(0, columnCount); });
    table.rowCount = values.length;
    table.columnCount = columnCount;
    return { host: "wpp", tableIndex, oneBasedTableIndex: tableIndex + 1, updated: true, rowCount: table.rowCount, columnCount: table.columnCount, writtenCells: table.rowCount * table.columnCount, structuralChangesApplied: true };
  }
  if (command.toolName === "wpp.ensure_table_sync_anchor") {
    const tableIndex = Number(command.input.tableIndex || 0);
    const table = state.wpp.tables[tableIndex];
    if (!table) fail("TABLE_NOT_FOUND", `Table not found: ${tableIndex}`, { tableIndex, tableCount: state.wpp.tables.length });
    return { host: "wpp", tableIndex, oneBasedTableIndex: tableIndex + 1, anchorTag: command.input.anchorTag || `wps-sync-table-${tableIndex}`, rowCount: table.rowCount, columnCount: table.columnCount, fallback: true };
  }
  if (command.toolName === "wpp.resolve_table_sync_anchor") {
    const tableIndex = Number(command.input.tableIndex || 0);
    const table = state.wpp.tables[tableIndex];
    if (!table) fail("TABLE_NOT_FOUND", `Table not found: ${tableIndex}`, { tableIndex, tableCount: state.wpp.tables.length });
    return { host: "wpp", tableIndex, index: tableIndex, oneBasedTableIndex: tableIndex + 1, anchorTag: command.input.anchorTag || `wps-sync-table-${tableIndex}`, rowCount: table.rowCount, columnCount: table.columnCount, values: command.input.includeValues !== false ? table.values : undefined, fallback: true };
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

  if (command.toolName === "wpp.read_table_cell") {
    const { table, tableIndex } = simTable(command.input);
    const row = simIndex(command.input.row, "row");
    const column = simIndex(command.input.col ?? command.input.column, "column");
    if (row > table.rowCount || column > table.columnCount) fail("INVALID_ARGUMENT", "cell index is outside table bounds.", { row, column, rowCount: table.rowCount, columnCount: table.columnCount });
    const mergeRegion = (simFormat(table).mergedCells || table.merged || []).find((item) => row >= item.startRow && row <= item.endRow && column >= item.startColumn && column <= item.endColumn) || null;
    return { host: "wpp", tableIndex, row, column, text: table.values?.[row - 1]?.[column - 1] ?? "", merged: Boolean(mergeRegion), mergeAnchor: mergeRegion ? { row: mergeRegion.startRow, column: mergeRegion.startColumn } : { row, column }, mergeRegion, isMergeAnchor: !mergeRegion || (mergeRegion.startRow === row && mergeRegion.startColumn === column), format: (simFormat(table).cells || []).find((cell) => cell.row === row && cell.column === column) || { row, column } };
  }
  if (command.toolName === "wpp.write_table_cell") {
    const { table, tableIndex } = simTable(command.input);
    const row = simIndex(command.input.row, "row");
    const column = simIndex(command.input.col ?? command.input.column, "column");
    if (row > table.rowCount || column > table.columnCount) fail("INVALID_ARGUMENT", "cell index is outside table bounds.", { row, column, rowCount: table.rowCount, columnCount: table.columnCount });
    const beforeText = table.values?.[row - 1]?.[column - 1] ?? "";
    table.values[row - 1] = table.values[row - 1] || [];
    table.values[row - 1][column - 1] = String(command.input.text ?? "");
    const readback = execute({ toolName: "wpp.read_table_cell", input: { tableIndex, row, column } });
    return { host: "wpp", tableIndex, row, column, written: true, preserveStyle: command.input.preserveStyle !== false, beforeText, afterText: readback.text, merged: readback.merged, mergeAnchor: readback.mergeAnchor, mergeRegion: readback.mergeRegion };
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
    table.format = { ...(table.format || {}), border: command.input.border, alignment: command.input.alignment, headerRowBold: command.input.headerRowBold, autofit: command.input.autofit, fitToPageWidth: command.input.fitToPageWidth, preferredWidthPercent: command.input.preferredWidthPercent, rowHeightRule: command.input.rowHeightRule, textDirection: command.input.textDirection || (command.input.horizontalText ? "horizontal" : undefined), fontName: command.input.fontName, fontSize: command.input.fontSize, cellPadding: command.input.cellPadding };
    return { host: "wpp", formattedTable: true, tableIndex, applied: Object.keys(table.format).filter((key) => table.format[key] !== undefined), rowCount: table.rowCount, columnCount: table.columnCount };
  }
  function simClone(value) { return JSON.parse(JSON.stringify(value)); }
  function simFormat(table) { table.format = table.format || { table: {}, rowHeights: [], columnWidths: [], mergedCells: [], cells: [] }; table.format.rowCount = table.rowCount; table.format.columnCount = table.columnCount; return table.format; }
  function simCellFormat(table, row, column) {
    const format = simFormat(table);
    let cell = format.cells.find((item) => item.row === row && item.column === column);
    if (!cell) { cell = { row, column }; format.cells.push(cell); }
    return cell;
  }
  function simMergeFormat(target, patch) {
    for (const [key, value] of Object.entries(patch || {})) {
      if (value && typeof value === "object" && !Array.isArray(value)) target[key] = simMergeFormat(target[key] && typeof target[key] === "object" ? target[key] : {}, value);
      else target[key] = value;
    }
    return target;
  }
  function simFormatTargets(table, tableIndex, targets, input) {
    const started = Date.now();
    const accepted = new Set();
    const unsupportedFields = [];
    for (const target of targets) {
      if (target.row > table.rowCount || target.column > table.columnCount) fail("INVALID_ARGUMENT", "cell index is outside table bounds.", { row: target.row, column: target.column, rowCount: table.rowCount, columnCount: table.columnCount });
      const patch = { ...(input.format || {}) };
      for (const key of ["numberFormat", "numberFormatLocal"]) {
        if (patch[key] !== undefined && patch[key] !== null) {
          unsupportedFields.push(`cells.${key}`);
          delete patch[key];
        }
      }
      if (!input.dryRun && Object.keys(patch).length) simMergeFormat(simCellFormat(table, target.row, target.column), { ...patch, row: target.row, column: target.column });
      Object.keys(patch).forEach((key) => accepted.add(key));
    }
    const rangeSafe = Object.keys(input.format || {}).some((key) => ["font", "paragraph", "shading"].includes(key));
    const out = { host: "wpp", tableIndex, applied: !input.dryRun && accepted.size > 0, dryRun: Boolean(input.dryRun), fastPath: !input.dryRun && input.fastPath !== false && rangeSafe ? "table-range" : "per-cell", hostCallsSaved: !input.dryRun && input.fastPath !== false && rangeSafe ? Math.max(0, targets.length - 1) : 0, affectedCells: targets.length, acceptedFields: [...accepted], unsupportedFields: [...new Set(unsupportedFields)], durationMs: Date.now() - started };
    if (input.includeResults) out.results = targets.map((target) => ({ ...target, ok: true, applied: [...accepted] }));
    return out;
  }
  function simTemplateTable(input = {}) {
    const target = String(input.target || "Selection");
    const tableIndex = target === "Selection"
      ? state.wpp.selectedTableIndex
      : target === "First"
        ? 0
        : Number(input.tableIndex);
    if (!Number.isInteger(tableIndex) || tableIndex < 0) fail("SELECTION_TABLE_NOT_FOUND", "当前 WPS Writer 选区不在表格内，请先选中一个表格。", { target });
    const table = state.wpp.tables[tableIndex];
    if (!table) fail("TABLE_NOT_FOUND", `Table not found: ${tableIndex}`, { tableIndex, tableCount: state.wpp.tables.length });
    return { table, tableIndex, oneBasedTableIndex: tableIndex + 1 };
  }
  if (command.toolName === "wpp.capture_table_format") {
    const { table, tableIndex, oneBasedTableIndex } = simTemplateTable(command.input);
    const read = execute({ toolName: "wpp.read_table_format", input: { tableIndex: oneBasedTableIndex } });
    return {
      ...read,
      captured: true,
      tableIndex,
      oneBasedTableIndex,
      rowCount: table.rowCount,
      columnCount: table.columnCount,
      source: { target: command.input.target || "Selection", tableIndex },
    };
  }
  if (command.toolName === "wpp.read_table_format") {
    const { table, tableIndex } = simTable(command.input);
    if (command.input.summaryOnly || Array.isArray(command.input.cells) || Array.isArray(command.input.fields) || command.input.startRow !== undefined || command.input.endRow !== undefined) {
      if (Array.isArray(command.input.cells) && command.input.cells.length) return execute({ toolName: "wpp.read_table_format_sample", input: command.input });
      return { host: "wpp", tableIndex, summaryOnly: true, rowCount: table.rowCount, columnCount: table.columnCount, fields: command.input.fields || [] };
    }
    return { host: "wpp", tableIndex, format: simClone(simFormat(table)) };
  }
  if (command.toolName === "wpp.apply_table_format") {
    const { table, tableIndex } = simTable(command.input);
    const nextFormat = simClone(command.input.format || {});
    const unsupportedFields = [];
    const sanitizedCells = Array.isArray(nextFormat.cells) ? nextFormat.cells.map((cell) => {
      const next = { ...(cell || {}) };
      for (const key of ["numberFormat", "numberFormatLocal"]) {
        if (next[key] !== undefined && next[key] !== null) {
          unsupportedFields.push(`cells.${key}`);
          delete next[key];
        }
      }
      return next;
    }) : nextFormat.cells;
    const beforeFormat = simClone(simFormat(table));
    table.format = { ...beforeFormat, ...nextFormat, table: { ...(beforeFormat.table || {}), ...(nextFormat.table || {}) }, ...(sanitizedCells ? { cells: sanitizedCells } : {}) };
    table.format.rowCount = table.rowCount;
    table.format.columnCount = table.columnCount;
    const groups = new Map();
    for (const cell of table.format.cells || []) {
      const key = JSON.stringify({ font: cell.font || {}, paragraph: cell.paragraph || {}, shading: cell.shading || {}, borders: cell.borders || {}, verticalAlignment: cell.verticalAlignment });
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(cell);
    }
    const verifyCells = Array.isArray(command.input.verifyCells) ? command.input.verifyCells : [];
    const verification = verifyCells.length ? { host: "wpp", tableIndex, rowCount: table.rowCount, columnCount: table.columnCount, count: verifyCells.length, cells: verifyCells.map((item) => ({ row: item.row, column: item.column, format: simClone(simCellFormat(table, item.row, item.column)) })) } : null;
    const formatGroups = [...groups.values()].map((targets) => ({ affectedCells: targets.length, fastPath: "table-range", hostCallsSaved: Math.max(0, targets.length - 1) }));
    return { host: "wpp", tableIndex, applied: ["table_format"], unsupportedFields, formatGroups, rowCount: table.rowCount, columnCount: table.columnCount, verification };
  }
  if (command.toolName === "wpp.format_table_range") {
    const { table, tableIndex } = simTable(command.input);
    const startRow = simIndex(command.input.startRow || 1, "startRow");
    const endRow = simIndex(command.input.endRow || table.rowCount, "endRow");
    const startCol = simIndex(command.input.startCol ?? command.input.startColumn ?? 1, "startCol");
    const endCol = simIndex(command.input.endCol ?? command.input.endColumn ?? table.columnCount, "endCol");
    if (endRow < startRow || endCol < startCol || endRow > table.rowCount || endCol > table.columnCount) fail("INVALID_ARGUMENT", "Table range is outside table bounds.", { startRow, endRow, startCol, endCol });
    const targets = [];
    for (let row = startRow; row <= endRow; row += 1) for (let column = startCol; column <= endCol; column += 1) targets.push({ row, column });
    return { ...simFormatTargets(table, tableIndex, targets, command.input), affectedRange: { startRow, endRow, startCol, endCol } };
  }
  if (command.toolName === "wpp.format_table_rows") {
    const { table, tableIndex } = simTable(command.input);
    const rows = (Array.isArray(command.input.rows) ? command.input.rows : [command.input.row]).map((row) => simIndex(row, "rows[]"));
    const startCol = simIndex(command.input.startCol ?? command.input.startColumn ?? 1, "startCol");
    const endCol = simIndex(command.input.endCol ?? command.input.endColumn ?? table.columnCount, "endCol");
    const targets = [];
    for (const row of rows) for (let column = startCol; column <= endCol; column += 1) targets.push({ row, column });
    return { ...simFormatTargets(table, tableIndex, targets, command.input), rows, affectedRange: { rows, startCol, endCol } };
  }
  if (command.toolName === "wpp.format_table_columns") {
    const { table, tableIndex } = simTable(command.input);
    const columns = (Array.isArray(command.input.columns) ? command.input.columns : [command.input.column ?? command.input.col]).map((column) => simIndex(column, "columns[]"));
    const startRow = simIndex(command.input.startRow || 1, "startRow");
    const endRow = simIndex(command.input.endRow || table.rowCount, "endRow");
    const targets = [];
    for (let row = startRow; row <= endRow; row += 1) for (const column of columns) targets.push({ row, column });
    return { ...simFormatTargets(table, tableIndex, targets, command.input), columns, affectedRange: { columns, startRow, endRow } };
  }
  if (command.toolName === "wpp.read_table_format_sample") {
    const { table, tableIndex } = simTable(command.input);
    const cells = (command.input.cells || []).map((item) => {
      const row = simIndex(item.row, "cells[].row");
      const column = simIndex(item.col ?? item.column, "cells[].col");
      return { row, column, format: pickFields(simClone(simCellFormat(table, row, column)), command.input.fields || []) };
    });
    return { host: "wpp", tableIndex, count: cells.length, fields: command.input.fields || [], cells, durationMs: 0 };
  }
  if (command.toolName === "wpp.read_table_format_range" || command.toolName === "wpp.read_table_cell_styles") {
    const { table, tableIndex } = simTable(command.input);
    if (Array.isArray(command.input.cells) && command.input.cells.length) return execute({ toolName: "wpp.read_table_format_sample", input: command.input });
    const startRow = simIndex(command.input.startRow || 1, "startRow");
    const endRow = simIndex(command.input.endRow || table.rowCount, "endRow");
    const startCol = simIndex(command.input.startCol ?? command.input.startColumn ?? 1, "startCol");
    const endCol = simIndex(command.input.endCol ?? command.input.endColumn ?? table.columnCount, "endCol");
    const cells = [];
    for (let row = startRow; row <= endRow; row += 1) for (let column = startCol; column <= endCol; column += 1) cells.push({ row, column, format: pickFields(simClone(simCellFormat(table, row, column)), command.input.fields || []) });
    return { host: "wpp", tableIndex, count: cells.length, fields: command.input.fields || [], affectedRange: { startRow, endRow, startCol, endCol }, cells, durationMs: 0 };
  }
  if (command.toolName === "wpp.read_table_structure") {
    const { table, tableIndex } = simTable(command.input);
    const result = { host: "wpp", tableIndex, rowCount: table.rowCount, columnCount: table.columnCount };
    if (command.input.includeMergedCells !== false) result.mergedCells = simClone(simFormat(table).mergedCells || table.merged || []);
    if (command.input.includeRowHeights) result.rowHeights = simClone(simFormat(table).rowHeights || []);
    if (command.input.includeColumnWidths) result.columnWidths = simClone(simFormat(table).columnWidths || []);
    return result;
  }
  if (command.toolName === "wpp.copy_table_style" || command.toolName === "wpp.duplicate_table_appearance") { const source = simTable({ tableIndex: command.input.sourceTableIndex }).table; const targetInfo = simTable({ tableIndex: command.input.targetTableIndex }); const scope = command.toolName === "wpp.copy_table_style" ? (command.input.scope || ["border", "font", "headerShading", "alignment"]) : "all"; const copied = simClone(simFormat(source)); if (command.toolName === "wpp.copy_table_style" && !String(scope).includes("all") && !String(scope).includes("col_width")) delete copied.columnWidths; if (command.toolName === "wpp.copy_table_style" && !String(scope).includes("all") && !String(scope).includes("row_height")) delete copied.rowHeights; targetInfo.table.format = copied; targetInfo.table.format.rowCount = targetInfo.table.rowCount; targetInfo.table.format.columnCount = targetInfo.table.columnCount; return { host: "wpp", copied: true, duplicatedAppearance: command.toolName === "wpp.duplicate_table_appearance", keepContent: command.input.keepContent !== false, sourceTableIndex: command.input.sourceTableIndex, targetTableIndex: command.input.targetTableIndex, scope, layoutCopied: Boolean(copied.columnWidths || copied.rowHeights), applied: ["table_format"] }; }
  if (command.toolName === "wpp.read_cell_format") { const { table, tableIndex } = simTable(command.input); const row = simIndex(command.input.row, "row"); const column = simIndex(command.input.col ?? command.input.column, "col"); const cell = simFormat(table).cells.find((item) => item.row === row && item.column === column) || { row, column }; return { host: "wpp", tableIndex, row, column, format: simClone(cell) }; }
  if (command.toolName === "wpp.apply_cell_format") { const { table, tableIndex } = simTable(command.input); const row = simIndex(command.input.row, "row"); const column = simIndex(command.input.col ?? command.input.column, "col"); const format = simFormat(table); const index = format.cells.findIndex((item) => item.row === row && item.column === column); const next = { ...(command.input.format || {}), row, column }; if (index >= 0) format.cells[index] = next; else format.cells.push(next); return { host: "wpp", tableIndex, row, column, applied: ["cell_format"] }; }
  if (command.toolName === "wpp.read_row_heights") { const { table, tableIndex } = simTable(command.input); return { host: "wpp", tableIndex, rowHeights: simClone(simFormat(table).rowHeights || []) }; }
  if (command.toolName === "wpp.set_row_heights") { const { table, tableIndex } = simTable(command.input); simFormat(table).rowHeights = simClone(command.input.rowHeights || command.input.rows || []); return { host: "wpp", tableIndex, appliedRows: simFormat(table).rowHeights.map((r) => r.row || r.index) }; }
  if (command.toolName === "wpp.read_column_widths") { const { table, tableIndex } = simTable(command.input); return { host: "wpp", tableIndex, columnWidths: simClone(simFormat(table).columnWidths || []) }; }
  if (command.toolName === "wpp.set_column_widths") { const { table, tableIndex } = simTable(command.input); simFormat(table).columnWidths = simClone(command.input.columnWidths || command.input.columns || []); const results = simFormat(table).columnWidths.map((c) => ({ column: c.column || c.index, requestedWidth: c.width, actualWidth: c.width, applied: true, verified: true })); return { host: "wpp", tableIndex, appliedColumns: results.map((r) => r.column), verifiedColumns: results.map((r) => r.column), warnings: [], results }; }
  if (command.toolName === "wpp.reset_table_layout") { const { table, tableIndex } = simTable(command.input); const fmt = simFormat(table); fmt.rowHeights = Array.from({ length: table.rowCount }, (_, i) => ({ row: i + 1, height: 0, heightRule: 0 })); fmt.table = { ...(fmt.table || {}), fitToPageWidth: command.input.fitToPageWidth !== false, preferredWidthPercent: command.input.preferredWidthPercent || 100, textDirection: "horizontal" }; return { host: "wpp", tableIndex, resetLayout: true, applied: ["fitToWindow", "rows.heightAuto", "cells.textDirection"], warnings: [], formatSummary: { rowHeights: fmt.rowHeights, columnWidths: fmt.columnWidths || [] } }; }
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
  if (command.toolName === "wpp.add_comment_by_text") {
    const query = String(command.input.query || "").trim();
    if (!query) fail("INVALID_ARGUMENT", "query is required.", { field: "query" });
    const found = execute({ toolName: "wpp.find_text", input: { query, matchCase: command.input.matchCase, matchWholeWord: command.input.matchWholeWord, maxResults: 1000 } }).results;
    const occurrence = command.input.occurrence === undefined ? "first" : command.input.occurrence;
    let target = occurrence === "last" ? found[found.length - 1] : found[0];
    if (occurrence !== "first" && occurrence !== "last") {
      const wanted = occurrence === "index" ? simIndex(command.input.index, "index") : simIndex(occurrence, "occurrence");
      target = found[wanted - 1];
    }
    if (!target) fail("TEXT_NOT_FOUND", "Text occurrence not found.", { query, occurrence });
    const result = execute({ toolName: "wpp.add_comment", input: { ...command.input, start: target.start, end: target.end } });
    return { ...result, query, occurrence, rangeText: target.text, resolvedText: target.text, exactMatch: true };
  }
  if (command.toolName === "wpp.add_comments_batch") {
    const items = Array.isArray(command.input.items) ? command.input.items : [];
    if (!items.length) fail("INVALID_ARGUMENT", "items must be a non-empty array.", { field: "items" });
    const results = items.map((item, index) => {
      const result = execute({ toolName: "wpp.add_comment_by_text", input: item });
      return { itemIndex: index, ok: true, query: item.query, commentId: result.commentId, commentIndex: result.commentIndex, rangeText: result.rangeText, exactMatch: true };
    });
    return { host: "wpp", added: true, addedCount: results.length, requestedCount: items.length, mode: command.input.mode || "reverse-order", verify: command.input.verify !== false, elapsedMs: 1, results };
  }
  if (command.toolName === "wpp.read_comments") {
    return { host: "wpp", count: state.wpp.comments.length, returnedCount: state.wpp.comments.length, summaryOnly: command.input.summaryOnly === true, comments: state.wpp.comments.map((comment, index) => ({ ...comment, index: index + 1 })) };
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
