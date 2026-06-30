const WPS_CONNECTOR_DEFAULT_BRIDGE = "http://127.0.0.1:40215";
const WPS_CONNECTOR_CLIENT_VERSION = "1.0.28";
const WPS_CONNECTOR_CLIENT_BUILD = "2026.06.30-writer-native-find.1";
let wpsConnectorBridgeUrl = WPS_CONNECTOR_DEFAULT_BRIDGE;
let wpsConnectorSessionId = "";
let wpsConnectorCurrentDocumentKey = "";
let wpsConnectorStarted = false;
let wpsConnectorSessionInfo = null;
const wpsConnectorCommentIdMap = {};

function wpsConnectorUuid() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `wps-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
function wpsConnectorHash(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
function wpsConnectorApp() {
  if (typeof Application !== "undefined") return Application;
  if (typeof window !== "undefined" && window.Application) return window.Application;
  throw new Error("WPS Application object is not available.");
}
function wpsConnectorCall(value, ...args) { return typeof value === "function" ? value(...args) : value; }
function wpsConnectorMember(object, name, ...args) {
  if (!object) return "";
  const value = object[name];
  return typeof value === "function" ? value.apply(object, args) : value;
}
function wpsConnectorEtAddress(selection) {
  return String(
    wpsConnectorMember(selection, "Address", false, false)
      || wpsConnectorMember(selection, "Address")
      || "",
  );
}
function wpsConnectorPreviewValues(values) {
  const rows = wpsConnectorNormalizeValues(values).slice(0, 4).map((row) => row.slice(0, 6).map((cell) => String(cell ?? "")).join("\t"));
  return rows.join("\n").slice(0, 500);
}

function wpsConnectorColumnName(index) {
  let n = Number(index || 1);
  let name = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name || "A";
}
function wpsConnectorA1(row, column) {
  return `${wpsConnectorColumnName(column)}${row}`;
}
class WpsConnectorError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "WpsConnectorError";
    this.code = code;
    this.details = details;
  }
}
function wpsConnectorFail(code, message, details = {}) {
  throw new WpsConnectorError(code, message, details);
}
function wpsConnectorValidateAddress(address, field = "address") {
  const text = String(address || "").trim();
  if (!text) wpsConnectorFail("INVALID_ADDRESS", `${field} is required.`, { field });
  if (!/^[A-Za-z]{1,3}\d{1,7}(:[A-Za-z]{1,3}\d{1,7})?$/.test(text)) {
    wpsConnectorFail("INVALID_ADDRESS", `Invalid range address: ${text}`, { field, address: text });
  }
  return text;
}
function wpsConnectorWorksheets() {
  const app = wpsConnectorApp();
  const sheets = app.Worksheets || app.ActiveWorkbook?.Worksheets;
  if (!sheets) wpsConnectorFail("HOST_UNSUPPORTED", "WPS worksheets collection is not available.");
  return sheets;
}
function wpsConnectorWorksheetNames(sheets) {
  const count = Number(wpsConnectorMember(sheets, "Count") || 0);
  const names = [];
  for (let i = 1; i <= count; i += 1) {
    try { names.push(String(wpsConnectorMember(sheets.Item(i), "Name") || "")); } catch {}
  }
  return names.filter(Boolean);
}
function wpsConnectorIsSystemWorksheetName(name) {
  return /^__WPS_.*__$/.test(String(name || ""));
}
function wpsConnectorIsProtectedWorksheetName(name) {
  const text = String(name || "");
  return wpsConnectorIsSystemWorksheetName(text) || /^Sheet1$/i.test(text);
}
function wpsConnectorWorksheetInfos(sheets) {
  const count = Number(wpsConnectorMember(sheets, "Count") || 0);
  const items = [];
  for (let i = 1; i <= count; i += 1) {
    try {
      const sheet = sheets.Item(i);
      const name = String(wpsConnectorMember(sheet, "Name") || "");
      items.push({ index: i, name, system: wpsConnectorIsSystemWorksheetName(name) });
    } catch {}
  }
  return items;
}
function wpsConnectorSheet(input = {}) {
  const app = wpsConnectorApp();
  const sheets = wpsConnectorWorksheets();
  if (!input.sheetName) return app.ActiveSheet;
  let sheet = null;
  try { sheet = sheets.Item(input.sheetName); } catch {}
  if (!sheet) wpsConnectorFail("SHEET_NOT_FOUND", `Worksheet not found: ${input.sheetName}`, { sheetName: input.sheetName, availableSheets: wpsConnectorWorksheetNames(sheets) });
  return sheet;
}
function wpsConnectorRange(input = {}, field = "address") {
  const address = wpsConnectorValidateAddress(input[field], field);
  const sheet = wpsConnectorSheet(input);
  try {
    const range = sheet.Range(address);
    if (!range) wpsConnectorFail("INVALID_ADDRESS", `Range not found: ${address}`, { address, sheetName: input.sheetName || String(wpsConnectorMember(sheet, "Name") || "") });
    return { sheet, range, address };
  } catch (error) {
    if (error?.code) throw error;
    wpsConnectorFail("INVALID_ADDRESS", `Invalid range address: ${address}`, { address, sheetName: input.sheetName || String(wpsConnectorMember(sheet, "Name") || ""), hostMessage: error?.message || String(error) });
  }
}
function wpsConnectorRangeShape(range, values) {
  const normalized = wpsConnectorNormalizeValues(values);
  return {
    row: Number(wpsConnectorMember(range, "Row") || 1),
    column: Number(wpsConnectorMember(range, "Column") || 1),
    rowCount: Number(wpsConnectorMember(wpsConnectorMember(range, "Rows"), "Count") || normalized.length || 1),
    columnCount: Number(wpsConnectorMember(wpsConnectorMember(range, "Columns"), "Count") || normalized[0]?.length || 1),
  };
}
function wpsConnectorErrorDetails(error, phase = "host") {
  if (error?.code) return { code: error.code, phase, message: error.message || String(error), details: error.details || {} };
  const message = error?.message || String(error);
  let code = "WPS_HOST_ERROR";
  if (/worksheet|sheet/i.test(message) && /not found|不存在|找不到/i.test(message)) code = "SHEET_NOT_FOUND";
  if (/last worksheet|last sheet/i.test(message)) code = "LAST_SHEET_DELETE_REFUSED";
  if (/range|address/i.test(message)) code = "INVALID_ADDRESS";
  if (/required|invalid|missing|address|formula/i.test(message)) code = "INVALID_ARGUMENT";
  if (/not supported|unsupported|not a function|undefined|null/i.test(message)) code = "HOST_UNSUPPORTED";
  return { code, phase, message };
}
function wpsConnectorReadFormats(range, includeTopLeft = true) {
  const out = {};
  try { out.numberFormat = String(wpsConnectorMember(range, "NumberFormatLocal") || wpsConnectorMember(range, "NumberFormat") || ""); } catch {}
  try { out.fontName = String(wpsConnectorMember(range.Font, "Name") || ""); } catch {}
  try { out.fontSize = Number(wpsConnectorMember(range.Font, "Size") || 0) || undefined; } catch {}
  try { out.bold = Boolean(wpsConnectorMember(range.Font, "Bold")); } catch {}
  try { out.fontColor = wpsConnectorMember(range.Font, "Color"); } catch {}
  try { out.fillColor = wpsConnectorMember(range.Interior, "Color"); } catch {}
  try { out.horizontalAlignment = wpsConnectorMember(range, "HorizontalAlignment"); } catch {}
  try { out.verticalAlignment = wpsConnectorMember(range, "VerticalAlignment"); } catch {}
  try { out.wrapText = Boolean(wpsConnectorMember(range, "WrapText")); } catch {}
  try { out.rowHeight = Number(wpsConnectorMember(range, "RowHeight") || 0) || undefined; } catch {}
  try { out.columnWidth = Number(wpsConnectorMember(range, "ColumnWidth") || 0) || undefined; } catch {}
  try { out.borderLineStyle = wpsConnectorMember(range.Borders, "LineStyle"); } catch {}
  try { out.borderColor = wpsConnectorMember(range.Borders, "Color"); } catch {}
  try {
    const cell = typeof range.Cells === "function" ? range.Cells(1, 1) : null;
    if (cell) out.topLeft = wpsConnectorReadFormats(cell, false);
  } catch {}
  return out;
}
function wpsConnectorSetMatrixProperty(range, prop, matrix) {
  if (matrix === undefined || matrix === null) return false;
  range[prop] = wpsConnectorNormalizeValues(matrix);
  return true;
}

function wpsConnectorApplyFormulaMatrix(sheet, range, formulas) {
  if (!formulas) return false;
  const matrix = wpsConnectorNormalizeValues(formulas);
  const shape = wpsConnectorRangeShape(range, matrix);
  let applied = false;
  for (let r = 0; r < matrix.length; r += 1) {
    const row = Array.isArray(matrix[r]) ? matrix[r] : [matrix[r]];
    for (let c = 0; c < row.length; c += 1) {
      const formula = row[c];
      if (typeof formula === "string" && formula.trim()) {
        sheet.Range(wpsConnectorA1(shape.row + r, shape.column + c)).Formula = formula;
        applied = true;
      }
    }
  }
  return applied;
}

function wpsConnectorLeadingEqualsToFormulas(values) {
  const formulas = [];
  const normalized = wpsConnectorNormalizeValues(values);
  let found = false;
  for (const row of normalized) {
    const out = [];
    for (const cell of row) {
      if (typeof cell === "string" && cell.startsWith("=")) { out.push(cell); found = true; }
      else out.push("");
    }
    formulas.push(out);
  }
  return found ? formulas : null;
}

function wpsConnectorDetectHost(app) {
  try { if (app.ActiveWorkbook || app.ActiveSheet || app.Workbooks) return "et"; } catch {}
  try { if (app.ActiveDocument || app.Documents) return "wpp"; } catch {}
  return "wps";
}
function wpsConnectorDocumentIdentity(app, host) {
  try {
    if (host === "et") {
      const workbook = app.ActiveWorkbook;
      const sheet = app.ActiveSheet;
      return {
        name: String(wpsConnectorCall(workbook?.Name) || wpsConnectorCall(workbook?.FullName) || ""),
        fullPath: String(wpsConnectorCall(workbook?.FullName) || ""),
        windowTitle: String(wpsConnectorCall(workbook?.Name) || ""),
        sheetName: String(wpsConnectorCall(sheet?.Name) || ""),
      };
    }
    if (host === "wpp") {
      const document = app.ActiveDocument;
      return {
        name: String(wpsConnectorCall(document?.Name) || wpsConnectorCall(document?.FullName) || ""),
        fullPath: String(wpsConnectorCall(document?.FullName) || ""),
        windowTitle: String(wpsConnectorCall(document?.Name) || ""),
      };
    }
  } catch (error) {
    return { name: "", error: error.message };
  }
  return { name: "" };
}
function wpsConnectorDocumentKey(host, identity) {
  const stable = identity?.fullPath || identity?.url || identity?.windowTitle || identity?.name || identity?.caption || identity?.title || "";
  return `${host}::${stable || wpsConnectorUuid()}`;
}
function wpsConnectorActiveContext(app, host) {
  try {
    if (host === "et") {
      const selection = app.Selection;
      const values = wpsConnectorMember(selection, "Value2");
      const text = String(wpsConnectorMember(selection, "Text") || "");
      return {
        sheetName: String(wpsConnectorCall(app.ActiveSheet?.Name) || ""),
        address: wpsConnectorEtAddress(selection),
        textPreview: text || wpsConnectorPreviewValues(values),
      };
    }
    if (host === "wpp") {
      const selection = app.Selection;
      const range = selection?.Range;
      const text = String(wpsConnectorCall(selection?.Text) || wpsConnectorCall(range?.Text) || "");
      const start = Number(wpsConnectorCall(range?.Start));
      const end = Number(wpsConnectorCall(range?.End));
      return { start: Number.isFinite(start) ? start : null, end: Number.isFinite(end) ? end : null, textPreview: text.slice(0, 500), length: text.length };
    }
  } catch (error) {
    return { error: error.message };
  }
  return null;
}
async function wpsConnectorRequest(path, options = {}) {
  const response = await fetch(`${wpsConnectorBridgeUrl}${path}`, { ...options, headers: { "content-type": "application/json", ...(options.headers || {}) } });
  const json = await response.json();
  if (!json.ok) throw new Error(json.error?.message || `Bridge request failed: ${path}`);
  return json;
}
function wpsConnectorScope() {
  const app = wpsConnectorApp();
  const host = wpsConnectorDetectHost(app);
  const documentIdentity = wpsConnectorDocumentIdentity(app, host);
  const documentKey = wpsConnectorDocumentKey(host, documentIdentity);
  const sessionId = `wps-${host}-${wpsConnectorHash(documentKey)}`;
  const capabilities = host === "et" ? ["et.read_selection", "et.list_worksheets", "et.add_worksheet", "et.rename_worksheet", "et.delete_worksheet", "et.read_range", "et.write_range", "et.format_range", "et.clear_range", "et.insert_range", "et.delete_range", "et.find_cells", "et.write_blocks"] : host === "wpp" ? ["wpp.read_selection", "wpp.read_document_identity", "wpp.read_document_text", "wpp.select_range", "wpp.select_paragraph", "wpp.select_current_paragraph", "wpp.get_selection_range", "wpp.list_paragraphs", "wpp.get_paragraph_range", "wpp.find_block", "wpp.find_text", "wpp.replace_text", "wpp.replace_paragraph", "wpp.replace_current_paragraph", "wpp.replace_block", "wpp.insert_after_paragraph", "wpp.insert_before_paragraph", "wpp.insert_table_after_paragraph", "wpp.insert_table_before_paragraph", "wpp.read_format", "wpp.read_text_format", "wpp.apply_text_format", "wpp.read_paragraph_format", "wpp.apply_paragraph_format_by_indexes", "wpp.copy_paragraph_format", "wpp.copy_selected_paragraph_format_to_indexes", "wpp.compare_paragraph_format", "wpp.read_table", "wpp.read_table_cell", "wpp.write_table_cell", "wpp.insert_table_rows", "wpp.delete_table_rows", "wpp.insert_table_columns", "wpp.delete_table_columns", "wpp.merge_table_cells", "wpp.format_table", "wpp.read_table_format", "wpp.apply_table_format", "wpp.copy_table_style", "wpp.duplicate_table_appearance", "wpp.read_cell_format", "wpp.apply_cell_format", "wpp.read_row_heights", "wpp.set_row_heights", "wpp.read_column_widths", "wpp.set_column_widths", "wpp.read_merged_cells", "wpp.apply_merged_cells", "wpp.insert_image", "wpp.read_images", "wpp.format_image", "wpp.delete_image", "wpp.add_comment", "wpp.add_comment_by_text", "wpp.add_comments_batch", "wpp.read_comments", "wpp.delete_comment", "wpp.set_track_changes", "wpp.read_revisions", "wpp.accept_revision", "wpp.reject_revision", "wpp.accept_all_revisions", "wpp.reject_all_revisions", "wpp.list_styles", "wpp.apply_style", "wpp.insert_page_break", "wpp.insert_paragraph_break", "wpp.delete_extra_blank_paragraphs", "wpp.save_document", "wpp.insert_text", "wpp.insert_news_article", "wpp.format_selection", "wpp.set_paragraph", "wpp.insert_table", "wps.open_pane"] : [];
  return { app, host, documentIdentity, documentKey, sessionId, capabilities };
}
async function wpsConnectorRegister() {
  const { app, host, documentIdentity, documentKey, sessionId, capabilities } = wpsConnectorScope();
  wpsConnectorSessionId = sessionId;
  wpsConnectorCurrentDocumentKey = documentKey;
  const json = await wpsConnectorRequest("/api/sessions/register", {
    method: "POST",
    body: JSON.stringify({
      sessionId,
      host,
      documentName: documentIdentity.name,
      documentIdentity,
      documentKey,
      activeContext: wpsConnectorActiveContext(app, host),
      capabilities,
      clientVersion: WPS_CONNECTOR_CLIENT_VERSION,
      clientBuild: WPS_CONNECTOR_CLIENT_BUILD,
    }),
  });
  wpsConnectorSessionInfo = {
    status: "已注册",
    sessionId: json.session?.sessionId || sessionId,
    host: json.session?.host || host,
    documentName: json.session?.documentName || documentIdentity.name,
    documentKey: json.session?.documentKey || documentKey,
    clientVersion: json.session?.clientVersion || WPS_CONNECTOR_CLIENT_VERSION,
    clientBuild: json.session?.clientBuild || WPS_CONNECTOR_CLIENT_BUILD,
  };
  if (typeof window !== "undefined") window.wpsConnectorSessionInfo = wpsConnectorSessionInfo;
  return json.session;
}
async function wpsConnectorEnsureSession() {
  const { documentKey, sessionId } = wpsConnectorScope();
  if (wpsConnectorSessionId !== sessionId || wpsConnectorCurrentDocumentKey !== documentKey) {
    return wpsConnectorRegister();
  }
  return wpsConnectorSessionInfo;
}
function wpsConnectorNormalizeValues(values) {
  if (!Array.isArray(values)) return [[values]];
  if (!Array.isArray(values[0])) return [values];
  return values;
}
function wpsConnectorRequireMatrix(value, field) {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value) || !value.every((row) => Array.isArray(row))) {
    wpsConnectorFail("INVALID_ARGUMENT", String(field) + " must be a two-dimensional array.", { field, expected: "array[]", valueType: Array.isArray(value) ? "array" : typeof value });
  }
  return value;
}
function wpsConnectorEtSelection() {
  const app = wpsConnectorApp();
  const selection = app.Selection;
  const values = wpsConnectorMember(selection, "Value2");
  return {
    host: "et",
    sheetName: String(wpsConnectorCall(app.ActiveSheet?.Name) || ""),
    address: wpsConnectorEtAddress(selection),
    values,
    text: String(wpsConnectorMember(selection, "Text") || ""),
  };
}
function wpsConnectorEtListWorksheets() {
  const app = wpsConnectorApp();
  const sheets = app.Worksheets || app.ActiveWorkbook?.Worksheets;
  const count = Number(wpsConnectorMember(sheets, "Count") || 0);
  const items = [];
  for (let i = 1; i <= count; i += 1) {
    const sheet = sheets.Item(i);
    items.push({ index: i, name: String(wpsConnectorMember(sheet, "Name") || ""), active: sheet === app.ActiveSheet });
  }
  return { host: "et", count, worksheets: items };
}
function wpsConnectorEtAddWorksheet(input = {}) {
  const app = wpsConnectorApp();
  const sheets = app.Worksheets || app.ActiveWorkbook?.Worksheets;
  const sheet = wpsConnectorMember(sheets, "Add") || sheets.Add();
  const name = input.name || input.sheetName;
  if (name) sheet.Name = name;
  if (input.activate !== false && typeof sheet.Activate === "function") sheet.Activate();
  return { host: "et", sheetName: String(wpsConnectorMember(sheet, "Name") || name || ""), added: true };
}
function wpsConnectorEtRenameWorksheet(input = {}) {
  const sheet = wpsConnectorSheet({ sheetName: input.oldName });
  sheet.Name = input.newName;
  if (input.activate && typeof sheet.Activate === "function") sheet.Activate();
  return { host: "et", oldName: input.oldName, newName: input.newName, renamed: true };
}
function wpsConnectorEtDeleteWorksheet(input = {}) {
  const app = wpsConnectorApp();
  const sheets = wpsConnectorWorksheets();
  const sheet = wpsConnectorSheet({ sheetName: input.sheetName });
  const infos = wpsConnectorWorksheetInfos(sheets);
  const count = infos.length || Number(wpsConnectorMember(sheets, "Count") || 0);
  const targetName = String(wpsConnectorMember(sheet, "Name") || input.sheetName || "");
  const userSheets = infos.filter((item) => !item.system);
  if (!input.force && wpsConnectorIsProtectedWorksheetName(targetName)) {
    wpsConnectorFail("LAST_SHEET_DELETE_REFUSED", "Refusing to delete a protected worksheet.", { sheetName: targetName, sheetCount: count, userSheetCount: userSheets.length, worksheets: infos, forceSupported: true });
  }
  if (count <= 1 || (!wpsConnectorIsSystemWorksheetName(targetName) && userSheets.length <= 1)) {
    wpsConnectorFail("LAST_SHEET_DELETE_REFUSED", "Refusing to delete the last user worksheet.", { sheetName: targetName, sheetCount: count, userSheetCount: userSheets.length, worksheets: infos });
  }
  try { app.DisplayAlerts = false; } catch {}
  if (typeof sheet.Delete === "function") sheet.Delete();
  try { app.DisplayAlerts = true; } catch {}
  return { host: "et", sheetName: input.sheetName, deleted: true };
}
function wpsConnectorEtReadRange(input = {}) {
  const { sheet, range, address } = wpsConnectorRange(input);
  const values = wpsConnectorMember(range, "Value2");
  const result = { host: "et", sheetName: String(wpsConnectorMember(sheet, "Name") || input.sheetName || ""), address, values, text: String(wpsConnectorMember(range, "Text") || wpsConnectorPreviewValues(values)) };
  if (input.includeFormulas) {
    try { result.formulas = wpsConnectorMember(range, "Formula") || wpsConnectorMember(range, "FormulaLocal"); } catch (error) { result.formulaWarning = error.message; }
  }
  if (input.includeFormats) {
    try { result.formats = wpsConnectorReadFormats(range); } catch (error) { result.formatWarning = error.message; }
  }
  return result;
}
function wpsConnectorEtWriteRange(input = {}) {
  const { sheet, range, address } = wpsConnectorRange(input);
  let values = input.values !== undefined ? wpsConnectorRequireMatrix(input.values, "values") : null;
  let formulasApplied = false;
  let numberFormatsApplied = false;
  if (values) range.Value2 = values;
  const explicitFormulas = input.formulas !== undefined ? wpsConnectorRequireMatrix(input.formulas, "formulas") : null;
  const formulas = explicitFormulas || (input.treatLeadingEqualsAsFormula !== false && values ? wpsConnectorLeadingEqualsToFormulas(values) : null);
  if (formulas) formulasApplied = wpsConnectorApplyFormulaMatrix(sheet, range, formulas);
  if (Array.isArray(input.formulaRanges)) {
    for (const item of input.formulaRanges) {
      const targetAddress = wpsConnectorValidateAddress(item?.address, "formulaRanges[].address");
      const target = sheet.Range(targetAddress);
      wpsConnectorApplyFormulaMatrix(sheet, target, wpsConnectorRequireMatrix(item.formulas, "formulaRanges[].formulas"));
    }
    formulasApplied = true;
  }
  if (input.numberFormats) numberFormatsApplied = wpsConnectorSetMatrixProperty(range, "NumberFormatLocal", wpsConnectorRequireMatrix(input.numberFormats, "numberFormats"));
  const shape = wpsConnectorRangeShape(range, values || formulas || [[null]]);
  return { host: "et", sheetName: String(wpsConnectorCall(sheet.Name) || input.sheetName || ""), address, rowCount: shape.rowCount, columnCount: shape.columnCount, formulasApplied, numberFormatsApplied };
}
function wpsConnectorColorValue(value) {
  const text = String(value || "").replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(text)) return value;
  const r = parseInt(text.slice(0, 2), 16);
  const g = parseInt(text.slice(2, 4), 16);
  const b = parseInt(text.slice(4, 6), 16);
  return r + g * 256 + b * 65536;
}
function wpsConnectorAlignment(value) {
  const map = { left: -4131, center: -4108, right: -4152 };
  return map[String(value || "").toLowerCase()];
}
function wpsConnectorEtFormatRange(input = {}) {
  const { sheet, range, address } = wpsConnectorRange(input);
  const applied = [];
  if (input.fontName) { range.Font.Name = input.fontName; applied.push("fontName"); }
  if (input.fontSize) { range.Font.Size = input.fontSize; applied.push("fontSize"); }
  if (typeof input.bold === "boolean") { range.Font.Bold = input.bold ? -1 : 0; applied.push("bold"); }
  if (input.fontColor) { range.Font.Color = wpsConnectorColorValue(input.fontColor); applied.push("fontColor"); }
  if (input.fillColor) { range.Interior.Color = wpsConnectorColorValue(input.fillColor); applied.push("fillColor"); }
  if (input.numberFormat) { range.NumberFormatLocal = input.numberFormat; applied.push("numberFormat"); }
  const hAlign = wpsConnectorAlignment(input.horizontalAlignment);
  if (hAlign !== undefined) { range.HorizontalAlignment = hAlign; applied.push("horizontalAlignment"); }
  const vAlign = wpsConnectorAlignment(input.verticalAlignment);
  if (vAlign !== undefined) { range.VerticalAlignment = vAlign; applied.push("verticalAlignment"); }
  if (typeof input.wrapText === "boolean") { range.WrapText = input.wrapText; applied.push("wrapText"); }
  if (input.rowHeight) { range.RowHeight = input.rowHeight; applied.push("rowHeight"); }
  if (input.columnWidth) { range.ColumnWidth = input.columnWidth; applied.push("columnWidth"); }
  if (input.border) { range.Borders.LineStyle = 1; if (input.borderColor) range.Borders.Color = wpsConnectorColorValue(input.borderColor); applied.push("border"); }
  if (input.autofit) {
    try { range.Columns.AutoFit(); applied.push("autofitColumns"); } catch {}
    try { range.Rows.AutoFit(); applied.push("autofitRows"); } catch {}
  }
  return { host: "et", sheetName: String(wpsConnectorCall(sheet.Name) || input.sheetName || ""), address, formatted: true, applied };
}
function wpsConnectorEtClearRange(input = {}) {
  const { range, address } = wpsConnectorRange(input);
  const applyTo = String(input.applyTo || "contents").toLowerCase();
  if (applyTo === "all" && typeof range.Clear === "function") range.Clear();
  else if (applyTo === "formats" && typeof range.ClearFormats === "function") range.ClearFormats();
  else if (typeof range.ClearContents === "function") range.ClearContents();
  else range.Value2 = "";
  return { host: "et", address, cleared: applyTo };
}
function wpsConnectorEtInsertRange(input = {}) {
  const { range, address } = wpsConnectorRange(input);
  const shift = String(input.shift || "Down").toLowerCase() === "right" ? -4161 : -4121;
  if (typeof range.Insert === "function") range.Insert(shift);
  return { host: "et", address, inserted: true, shift: input.shift || "Down" };
}
function wpsConnectorEtDeleteRange(input = {}) {
  const { range, address } = wpsConnectorRange(input);
  const shift = String(input.shift || "Up").toLowerCase() === "left" ? -4159 : -4162;
  if (typeof range.Delete === "function") range.Delete(shift);
  return { host: "et", address, deleted: true, shift: input.shift || "Up" };
}
function wpsConnectorAddressForCell(cell) {
  return String(wpsConnectorMember(cell, "Address", false, false) || wpsConnectorMember(cell, "Address") || "");
}
function wpsConnectorEtFindCells(input = {}) {
  const sheet = wpsConnectorSheet(input);
  const used = input.address ? wpsConnectorRange(input).range : (sheet.UsedRange || sheet.Range("A1:Z200"));
  const values = wpsConnectorNormalizeValues(wpsConnectorMember(used, "Value2"));
  const shape = wpsConnectorRangeShape(used, values);
  const query = String(input.query || "");
  const needle = input.matchCase ? query : query.toLowerCase();
  const max = Number(input.maxResults || 50);
  const results = [];
  for (let r = 0; r < values.length && results.length < max; r += 1) {
    const row = Array.isArray(values[r]) ? values[r] : [values[r]];
    for (let c = 0; c < row.length && results.length < max; c += 1) {
      const raw = String(row[c] ?? "");
      const hay = input.matchCase ? raw : raw.toLowerCase();
      const ok = input.matchEntireCell ? hay === needle : hay.includes(needle);
      if (ok) {
        const rowNumber = shape.row + r;
        const columnNumber = shape.column + c;
        results.push({ address: wpsConnectorA1(rowNumber, columnNumber), value: raw, row: rowNumber, column: columnNumber });
      }
    }
  }
  return { host: "et", sheetName: String(wpsConnectorMember(sheet, "Name") || input.sheetName || ""), query, count: results.length, results };
}
function wpsConnectorEtWriteBlocks(input = {}) {
  const results = [];
  for (const [index, block] of (input.blocks || []).entries()) {
    const steps = [];
    try {
      if (!block.address) wpsConnectorFail("INVALID_ADDRESS", "blocks[].address is required.", { field: "blocks[].address", index });
      if (block.values !== undefined || block.formulas || block.formulaRanges || block.numberFormats) {
        steps.push({ step: "write", ok: true, result: wpsConnectorEtWriteRange({ ...block, sessionId: input.sessionId }) });
      }
      if (block.format) {
        steps.push({ step: "format", ok: true, result: wpsConnectorEtFormatRange({ ...block.format, sheetName: block.sheetName, address: block.address, sessionId: input.sessionId }) });
      }
      results.push({ index, address: block.address, ok: true, steps });
    } catch (error) {
      const details = wpsConnectorErrorDetails(error, `block:${index}`);
      results.push({ index, address: block.address || "", ok: false, error: details });
      if (!input.continueOnError) break;
    }
  }
  return { host: "et", blockCount: (input.blocks || []).length, okCount: results.filter((r) => r.ok).length, failedCount: results.filter((r) => !r.ok).length, results };
}
function wpsConnectorWppSelection() {
  const app = wpsConnectorApp();
  const selection = app.Selection;
  const range = selection?.Range;
  const text = String(wpsConnectorCall(selection?.Text) || wpsConnectorCall(range?.Text) || "");
  const start = Number(wpsConnectorCall(range?.Start));
  const end = Number(wpsConnectorCall(range?.End));
  return { host: "wpp", text, length: text.length, start: Number.isFinite(start) ? start : null, end: Number.isFinite(end) ? end : null };
}
function wpsConnectorApplyOperationScope(input = {}) {
  if (input.operationScope?.mode !== "selection") return;
  const context = input.operationScope.context || {};
  if (Number.isFinite(Number(context.start)) && Number.isFinite(Number(context.end))) {
    wpsConnectorWppSelectRange({ start: Number(context.start), end: Number(context.end) });
  }
}
function wpsConnectorWppDocumentIdentity() {
  const app = wpsConnectorApp();
  return { host: "wpp", documentIdentity: wpsConnectorDocumentIdentity(app, "wpp") };
}
function wpsConnectorInteger(value, field, min = 0) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min) wpsConnectorFail("INVALID_ARGUMENT", `${field} must be an integer >= ${min}.`, { field, value });
  return n;
}
function wpsConnectorWppTextModel() {
  const app = wpsConnectorApp();
  const document = app.ActiveDocument;
  if (!document) wpsConnectorFail("HOST_UNSUPPORTED", "WPS Writer active document is not available.");
  const content = document.Content || document.Range?.();
  if (!content) wpsConnectorFail("HOST_UNSUPPORTED", "WPS Writer document range is not available.");
  const raw = String(wpsConnectorCall(content.Text) || "");
  const contentStart = Number(wpsConnectorMember(content, "Start") || 0);
  const normalizedToRaw = [];
  let text = "";
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (ch === "\x07") continue;
    normalizedToRaw.push(i);
    text += ch === "\r" ? "\n" : ch;
  }
  return { app, document, content, raw, text, normalizedToRaw, contentStart };
}
function wpsConnectorWppNormalizeRangeText(value) {
  return String(value || "").replace(/\x07/g, "").replace(/\r/g, "\n");
}
function wpsConnectorWppNativeEnd(model, normalizedEnd) {
  if (normalizedEnd <= 0) return model.contentStart;
  if (normalizedEnd >= model.normalizedToRaw.length) return model.contentStart + model.raw.length;
  return model.contentStart + model.normalizedToRaw[normalizedEnd];
}
function wpsConnectorWppResolveRange(input = {}) {
  const model = wpsConnectorWppTextModel();
  const requestedStart = input.start === undefined ? 0 : wpsConnectorInteger(input.start, "start", 0);
  const requestedEnd = input.end === undefined ? model.text.length : wpsConnectorInteger(input.end, "end", 0);
  if (requestedEnd < requestedStart) wpsConnectorFail("INVALID_ARGUMENT", "end must be >= start.", { start: requestedStart, end: requestedEnd });
  const clampedStart = Math.min(requestedStart, model.text.length);
  const clampedEnd = Math.min(requestedEnd, model.text.length);
  const expected = model.text.slice(clampedStart, clampedEnd);
  const attempts = [];
  function makeRange(label, start, end) {
    const nativeStart = wpsConnectorWppNativeEnd(model, start);
    const nativeEnd = wpsConnectorWppNativeEnd(model, end);
    try {
      const range = typeof model.document.Range === "function" ? model.document.Range(nativeStart, nativeEnd) : null;
      if (!range) throw new Error("document.Range returned null");
      const resolvedText = wpsConnectorWppNormalizeRangeText(wpsConnectorCall(range.Text));
      const exactMatch = resolvedText === expected;
      attempts.push({ label, start, end, nativeStart, nativeEnd, resolvedText, exactMatch });
      return { model, range, requestedStart, requestedEnd, resolvedStart: start, resolvedEnd: end, nativeStart, nativeEnd, requestedText: expected, resolvedText, exactMatch, attempts };
    } catch (error) {
      attempts.push({ label, start, end, error: error.message || String(error) });
      return null;
    }
  }
  let resolved = makeRange("direct-map", clampedStart, clampedEnd);
  if (resolved?.exactMatch || !expected) return resolved;
  const windowStart = Math.max(0, clampedStart - 80);
  const windowEnd = Math.min(model.text.length, clampedEnd + 80);
  const localIndex = model.text.slice(windowStart, windowEnd).indexOf(expected);
  if (localIndex >= 0) {
    const start = windowStart + localIndex;
    resolved = makeRange("nearby-text-search", start, start + expected.length) || resolved;
    if (resolved?.exactMatch) return resolved;
  }
  const globalIndex = expected ? model.text.indexOf(expected) : -1;
  if (globalIndex >= 0 && globalIndex !== clampedStart) {
    resolved = makeRange("global-text-search", globalIndex, globalIndex + expected.length) || resolved;
    if (resolved?.exactMatch) return resolved;
  }
  if (!resolved?.range) wpsConnectorFail("RANGE_RESOLUTION_FAILED", "Unable to resolve requested Writer range.", { requestedStart, requestedEnd, attempts });
  return resolved;
}
function wpsConnectorWppDocumentRange(input = {}) {
  const resolved = wpsConnectorWppResolveRange(input);
  return { app: resolved.model.app, document: resolved.model.document, content: resolved.model.content, text: resolved.model.text, start: resolved.requestedStart, end: resolved.requestedEnd, resolved };
}
function wpsConnectorWppReadDocumentText(input = {}) {
  const model = wpsConnectorWppTextModel();
  const start = input.start === undefined ? 0 : wpsConnectorInteger(input.start, "start", 0);
  const end = input.end === undefined ? model.text.length : wpsConnectorInteger(input.end, "end", 0);
  if (end < start) wpsConnectorFail("INVALID_ARGUMENT", "end must be >= start.", { start, end });
  const maxLength = input.maxLength === undefined ? 20000 : wpsConnectorInteger(input.maxLength, "maxLength", 1);
  const selected = model.text.slice(start, Math.min(end, model.text.length));
  return { host: "wpp", start, end, length: selected.length, truncated: selected.length > maxLength, textModel: "normalized-wps-range-v1", text: selected.slice(0, maxLength) };
}
function wpsConnectorWppSelectRange(input = {}) {
  const resolved = wpsConnectorWppResolveRange(input);
  if (typeof resolved.range.Select === "function") resolved.range.Select();
  else wpsConnectorFail("HOST_UNSUPPORTED", "WPS Writer range selection is not available.");
  return { host: "wpp", selected: true, start: resolved.requestedStart, end: resolved.requestedEnd, text: resolved.resolvedText, requestedStart: resolved.requestedStart, requestedEnd: resolved.requestedEnd, resolvedStart: resolved.resolvedStart, resolvedEnd: resolved.resolvedEnd, resolvedText: resolved.resolvedText, exactMatch: resolved.exactMatch, attempts: resolved.attempts };
}


function wpsConnectorWppNativeToNormalized(model, nativeOffset) {
  const rawOffset = Math.max(0, Number(nativeOffset || 0) - model.contentStart);
  for (let i = 0; i < model.normalizedToRaw.length; i += 1) if (model.normalizedToRaw[i] >= rawOffset) return i;
  return model.text.length;
}
function wpsConnectorWppRangeDetails(range) {
  const model = wpsConnectorWppTextModel();
  const nativeStart = Number(wpsConnectorSafeGet(range, "Start"));
  const nativeEnd = Number(wpsConnectorSafeGet(range, "End"));
  const start = Number.isFinite(nativeStart) ? wpsConnectorWppNativeToNormalized(model, nativeStart) : null;
  const end = Number.isFinite(nativeEnd) ? wpsConnectorWppNativeToNormalized(model, nativeEnd) : null;
  const text = wpsConnectorWppNormalizeRangeText(wpsConnectorCall(range?.Text));
  return { start, end, normalizedStart: start, normalizedEnd: end, nativeStart: Number.isFinite(nativeStart) ? nativeStart : null, nativeEnd: Number.isFinite(nativeEnd) ? nativeEnd : null, text, selectedText: text, length: text.length, ...wpsConnectorWppRangeContext(range) };
}
function wpsConnectorWppSelectionRange() {
  const range = wpsConnectorApp().Selection?.Range;
  if (!range) wpsConnectorFail("HOST_UNSUPPORTED", "WPS Writer selection range is not available.");
  return range;
}
function wpsConnectorWppOptionalRange(input = {}) {
  if (input.start !== undefined || input.end !== undefined) return wpsConnectorWppResolveRange({ start: input.start ?? 0, end: input.end ?? input.start ?? 0 }).range;
  return wpsConnectorWppSelectionRange();
}
function wpsConnectorWppGetSelectionRange() {
  return { host: "wpp", selection: wpsConnectorWppRangeDetails(wpsConnectorWppSelectionRange()) };
}
function wpsConnectorWppSelectParagraph(input = {}) {
  const index = wpsConnectorInteger(input.index, "index", 1);
  const paragraphs = wpsConnectorApp().ActiveDocument?.Paragraphs;
  const count = Number(wpsConnectorSafeGet(paragraphs, "Count") || 0);
  if (!paragraphs || index > count) wpsConnectorFail("PARAGRAPH_NOT_FOUND", "Paragraph not found: " + index, { index, paragraphCount: count });
  const paragraph = paragraphs.Item(index);
  const range = paragraph?.Range;
  if (!range?.Select) wpsConnectorFail("HOST_UNSUPPORTED", "WPS Writer paragraph selection is not available.");
  range.Select();
  return { host: "wpp", selected: true, paragraphIndex: index, paragraphCount: count, affectedRange: wpsConnectorWppRangeDetails(range) };
}
function wpsConnectorWppSelectCurrentParagraph() {
  const paragraphs = wpsConnectorApp().Selection?.Paragraphs;
  let paragraph = null;
  try { paragraph = paragraphs?.Item(1); } catch {}
  const range = paragraph?.Range;
  if (!range?.Select) wpsConnectorFail("HOST_UNSUPPORTED", "WPS Writer current paragraph selection is not available.");
  range.Select();
  return { host: "wpp", selected: true, affectedRange: wpsConnectorWppRangeDetails(range) };
}
function wpsConnectorWppReadTextFormat(input = {}) {
  const range = wpsConnectorWppOptionalRange(input);
  const font = wpsConnectorSafeGet(range, "Font");
  const shading = wpsConnectorSafeGet(range, "Shading");
  return { host: "wpp", affectedRange: wpsConnectorWppRangeDetails(range), effectiveFormat: { fontName: wpsConnectorSafeGet(font, "Name"), fontSize: wpsConnectorSafeGet(font, "Size"), bold: wpsConnectorBoolFormat(wpsConnectorSafeGet(font, "Bold")), italic: wpsConnectorBoolFormat(wpsConnectorSafeGet(font, "Italic")), underline: Boolean(wpsConnectorSafeGet(font, "Underline")), color: wpsConnectorSafeGet(font, "Color"), highlightColor: wpsConnectorSafeGet(shading, "BackgroundPatternColor") } };
}
function wpsConnectorWppFontFormatSummary(range) {
  const font = wpsConnectorSafeGet(range, "Font");
  return { fontName: wpsConnectorSafeGet(font, "Name"), fontSize: wpsConnectorSafeGet(font, "Size"), bold: wpsConnectorBoolFormat(wpsConnectorSafeGet(font, "Bold")), italic: wpsConnectorBoolFormat(wpsConnectorSafeGet(font, "Italic")), underline: Boolean(wpsConnectorSafeGet(font, "Underline")), color: wpsConnectorSafeGet(font, "Color") };
}
function wpsConnectorWppLineSpacingRule(value) {
  const map = { single: 0, one: 0, onehalf: 1, "1.5": 1, double: 2, atleast: 3, atLeast: 3, fixed: 4, exactly: 4, exact: 4, multiple: 5 };
  if (value === undefined || value === null || value === "") return undefined;
  return map[String(value).replace(/\s+/g, "").toLowerCase()] ?? value;
}
function wpsConnectorWppLineSpacingSemantic(rule, raw) {
  const names = { 0: "single", 1: "oneAndHalf", 2: "double", 3: "atLeast", 4: "exactly", 5: "multiple" };
  const numericRule = Number(rule);
  if (numericRule === 5 && Number.isFinite(Number(raw))) return { lineSpacingRule: "multiple", lineSpacingValue: Number(raw) / 12, lineSpacingRaw: raw, lineSpacingRuleRaw: rule };
  if (numericRule === 4 && Number.isFinite(Number(raw))) return { lineSpacingRule: "exactly", lineSpacingValue: Number(raw), lineSpacingRaw: raw, lineSpacingRuleRaw: rule };
  if (numericRule === 3 && Number.isFinite(Number(raw))) return { lineSpacingRule: "atLeast", lineSpacingValue: Number(raw), lineSpacingRaw: raw, lineSpacingRuleRaw: rule };
  return { lineSpacingRule: names[numericRule] || rule, lineSpacingValue: raw, lineSpacingRaw: raw, lineSpacingRuleRaw: rule };
}
function wpsConnectorWppParagraphFormatSummary(range) {
  const pf = wpsConnectorSafeGet(range, "ParagraphFormat");
  const lineSpacing = wpsConnectorSafeGet(pf, "LineSpacing");
  const lineSpacingRule = wpsConnectorSafeGet(pf, "LineSpacingRule");
  return { alignment: wpsConnectorSafeGet(pf, "Alignment"), lineSpacing, ...wpsConnectorWppLineSpacingSemantic(lineSpacingRule, lineSpacing), spaceBefore: wpsConnectorSafeGet(pf, "SpaceBefore"), spaceAfter: wpsConnectorSafeGet(pf, "SpaceAfter"), firstLineIndent: wpsConnectorSafeGet(pf, "FirstLineIndent"), leftIndent: wpsConnectorSafeGet(pf, "LeftIndent"), rightIndent: wpsConnectorSafeGet(pf, "RightIndent"), keepWithNext: wpsConnectorBoolFormat(wpsConnectorSafeGet(pf, "KeepWithNext")), pageBreakBefore: wpsConnectorBoolFormat(wpsConnectorSafeGet(pf, "PageBreakBefore")) };
}
function wpsConnectorWppMergeParagraphFormats(items) {
  const fields = ["alignment", "lineSpacing", "lineSpacingRule", "lineSpacingValue", "spaceBefore", "spaceAfter", "firstLineIndent", "leftIndent", "rightIndent", "keepWithNext", "pageBreakBefore"];
  const effective = {};
  const mixedFields = [];
  for (const field of fields) {
    const values = items.map((item) => item.format?.[field]);
    const first = values[0];
    const mixed = values.some((value) => String(value) !== String(first));
    effective[field] = mixed ? null : first;
    if (mixed) mixedFields.push(field);
  }
  return { effectiveFormat: effective, mixedFields };
}
function wpsConnectorWppParagraphIndexesFromInput(input = {}) {
  const paragraphs = wpsConnectorWppParagraphs();
  const count = Number(wpsConnectorSafeGet(paragraphs, "Count") || 0);
  let indexes = [];
  if (Array.isArray(input.paragraphIndexes) && input.paragraphIndexes.length) {
    indexes = input.paragraphIndexes.map((value) => wpsConnectorInteger(value, "paragraphIndexes", 1));
  } else if (input.startParagraphIndex !== undefined || input.endParagraphIndex !== undefined) {
    const start = wpsConnectorInteger(input.startParagraphIndex ?? input.endParagraphIndex, "startParagraphIndex", 1);
    const end = wpsConnectorInteger(input.endParagraphIndex ?? start, "endParagraphIndex", 1);
    if (end < start) wpsConnectorFail("INVALID_ARGUMENT", "endParagraphIndex must be >= startParagraphIndex.", { startParagraphIndex: start, endParagraphIndex: end });
    for (let i = start; i <= end; i += 1) indexes.push(i);
  }
  indexes = [...new Set(indexes)];
  for (const index of indexes) if (index > count) wpsConnectorFail("PARAGRAPH_NOT_FOUND", "Paragraph not found: " + index, { index, paragraphCount: count });
  return { paragraphCount: count, indexes };
}
function wpsConnectorWppParagraphItemsFromRange(range) {
  const details = wpsConnectorWppRangeDetails(range);
  const nativeStart = Number(details.nativeStart);
  const nativeEnd = Number(details.nativeEnd);
  const paragraphs = wpsConnectorWppParagraphs();
  const count = Number(wpsConnectorSafeGet(paragraphs, "Count") || 0);
  const items = [];
  for (let i = 1; i <= count; i += 1) {
    let paragraphRange = null;
    try { paragraphRange = paragraphs.Item(i).Range; } catch { continue; }
    const ps = Number(wpsConnectorSafeGet(paragraphRange, "Start"));
    const pe = Number(wpsConnectorSafeGet(paragraphRange, "End"));
    if (!Number.isFinite(ps) || !Number.isFinite(pe)) continue;
    const overlaps = Number.isFinite(nativeStart) && Number.isFinite(nativeEnd) ? pe >= nativeStart && ps <= nativeEnd : i === details.paragraphIndex;
    if (!overlaps) continue;
    const item = wpsConnectorWppParagraphItem(i);
    items.push({ paragraphIndex: i, affectedRange: item.range, textPreview: item.preview, styleName: item.styleName, format: wpsConnectorWppParagraphFormatSummary(paragraphRange), font: wpsConnectorWppFontFormatSummary(paragraphRange) });
  }
  return items.length ? items : [{ paragraphIndex: details.paragraphIndex, affectedRange: details, textPreview: details.text.slice(0, 240), styleName: String(wpsConnectorSafeGet(range, "Style") || ""), format: wpsConnectorWppParagraphFormatSummary(range), font: wpsConnectorWppFontFormatSummary(range) }];
}
function wpsConnectorWppApplyFontFormatToRange(range, format = {}) {
  const accepted = [];
  const rejected = [];
  const font = wpsConnectorSafeGet(range, "Font");
  const apply = (key, prop, value, convert) => {
    if (value === undefined) return;
    const ok = wpsConnectorSafeSet(font, prop, convert ? convert(value) : value);
    (ok ? accepted : rejected).push(`font.${key}`);
  };
  apply("fontName", "Name", format.fontName);
  apply("fontSize", "Size", format.fontSize);
  apply("bold", "Bold", format.bold, (v) => v ? -1 : 0);
  apply("italic", "Italic", format.italic, (v) => v ? -1 : 0);
  apply("underline", "Underline", format.underline, (v) => v ? 1 : 0);
  apply("color", "Color", format.color, wpsConnectorColorValue);
  return { accepted, rejected };
}
function wpsConnectorWppResultOptions(input = {}) {
  return { summaryOnly: input.summaryOnly !== false, includeText: input.includeText === true, includeRanges: input.includeRanges === true };
}
function wpsConnectorWppParagraphFormatInput(input = {}) {
  const format = { ...(input.format || {}) };
  for (const key of ["alignment", "spaceBefore", "spaceAfter", "lineSpacing", "lineSpacingRule", "lineSpacingValue", "firstLineIndent", "leftIndent", "rightIndent", "keepWithNext", "pageBreakBefore"]) if (input[key] !== undefined) format[key] = input[key];
  return format;
}
function wpsConnectorWppSlimParagraphResult(result, input = {}) {
  const options = wpsConnectorWppResultOptions(input);
  if (!options.summaryOnly) return result;
  const slimParagraph = (item) => {
    const out = { paragraphIndex: item.paragraphIndex, ok: item.ok, matches: item.matches, differingFields: item.differingFields, acceptedFields: item.hostAcceptedFields, rejectedFields: item.hostRejectedFields };
    if (options.includeText) out.textPreview = item.textPreview;
    if (options.includeRanges) out.affectedRange = item.affectedRange;
    return Object.fromEntries(Object.entries(out).filter(([, value]) => value !== undefined));
  };
  const affected = result.affectedParagraphs || result.comparisons || [];
  const diffCount = result.diffCount ?? affected.reduce((sum, item) => sum + (Array.isArray(item.differingFields) ? item.differingFields.length : 0), 0);
  const out = { host: "wpp", ok: result.ok !== false, applied: result.applied, copied: result.copied, dryRun: result.dryRun, sourceParagraphIndex: result.sourceParagraphIndex, targetParagraphIndexes: result.targetParagraphIndexes || result.affectedParagraphIndexes, affectedCount: result.affectedCount ?? affected.length, affectedParagraphIndexes: result.affectedParagraphIndexes, acceptedFields: result.acceptedFields || result.hostAcceptedFields || [], rejectedFields: result.rejectedFields || result.hostRejectedFields || [], copiedFields: result.copiedFields, allMatch: result.allMatch, diffCount, elapsedMs: result.elapsedMs, includeFont: result.includeFont };
  if (options.includeText || options.includeRanges) out.paragraphs = affected.map(slimParagraph).filter((item) => Object.keys(item).length);
  return out;
}
function wpsConnectorWppApplyTextFormat(input = {}) {
  const range = wpsConnectorWppOptionalRange(input);
  const format = input.format || {};
  const accepted = [];
  const rejected = [];
  const font = wpsConnectorSafeGet(range, "Font");
  const shading = wpsConnectorSafeGet(range, "Shading");
  const apply = (key, object, prop, value, convert) => {
    if (value === undefined) return;
    const ok = wpsConnectorSafeSet(object, prop, convert ? convert(value) : value);
    (ok ? accepted : rejected).push(key);
  };
  apply("fontName", font, "Name", format.fontName);
  apply("fontSize", font, "Size", format.fontSize);
  apply("bold", font, "Bold", format.bold, (v) => v ? -1 : 0);
  apply("italic", font, "Italic", format.italic, (v) => v ? -1 : 0);
  apply("underline", font, "Underline", format.underline, (v) => v ? 1 : 0);
  apply("color", font, "Color", format.color, wpsConnectorColorValue);
  apply("highlightColor", shading, "BackgroundPatternColor", format.highlightColor, wpsConnectorColorValue);
  const readback = wpsConnectorWppReadTextFormat(input);
  return { host: "wpp", applied: accepted.length > 0, affectedRange: readback.affectedRange, effectiveFormat: readback.effectiveFormat, hostAcceptedFields: accepted, hostRejectedFields: rejected };
}
function wpsConnectorWppReadParagraphFormat(input = {}) {
  const indexed = wpsConnectorWppParagraphIndexesFromInput(input);
  let items = [];
  if (indexed.indexes.length) {
    items = indexed.indexes.map((paragraphIndex) => {
      const item = wpsConnectorWppParagraphItem(paragraphIndex);
      const range = wpsConnectorWppParagraphRange(paragraphIndex).range;
      return { paragraphIndex, affectedRange: item.range, textPreview: item.preview, styleName: item.styleName, format: wpsConnectorWppParagraphFormatSummary(range), font: wpsConnectorWppFontFormatSummary(range) };
    });
  } else {
    const range = wpsConnectorWppOptionalRange(input);
    items = wpsConnectorWppParagraphItemsFromRange(range);
  }
  const merged = wpsConnectorWppMergeParagraphFormats(items);
  return { host: "wpp", affectedRange: items[0]?.affectedRange || null, effectiveFormat: merged.effectiveFormat, mixedFields: merged.mixedFields, perParagraphFormats: items };
}
function wpsConnectorWppApplyParagraphFormatToRange(range, format = {}) {
  const accepted = [];
  const rejected = [];
  const pf = wpsConnectorSafeGet(range, "ParagraphFormat");
  const apply = (key, prop, value, convert) => {
    if (value === undefined) return;
    const ok = wpsConnectorSafeSet(pf, prop, convert ? convert(value) : value);
    (ok ? accepted : rejected).push(key);
  };
  apply("alignment", "Alignment", wpsConnectorWppAlignment(format.alignment));
  apply("lineSpacingRule", "LineSpacingRule", wpsConnectorWppLineSpacingRule(format.lineSpacingRule));
  const lineSpacingValue = format.lineSpacingValue !== undefined && String(format.lineSpacingRule || "").toLowerCase() === "multiple" ? Number(format.lineSpacingValue) * 12 : format.lineSpacingValue;
  apply("lineSpacingValue", "LineSpacing", lineSpacingValue);
  apply("lineSpacing", "LineSpacing", format.lineSpacing);
  apply("spaceBefore", "SpaceBefore", format.spaceBefore);
  apply("spaceAfter", "SpaceAfter", format.spaceAfter);
  apply("firstLineIndent", "FirstLineIndent", format.firstLineIndent);
  apply("leftIndent", "LeftIndent", format.leftIndent);
  apply("rightIndent", "RightIndent", format.rightIndent);
  apply("keepWithNext", "KeepWithNext", format.keepWithNext, (v) => v ? -1 : 0);
  apply("pageBreakBefore", "PageBreakBefore", format.pageBreakBefore, (v) => v ? -1 : 0);
  return { accepted, rejected };
}
function wpsConnectorWppSetParagraph(input = {}) {
  const format = wpsConnectorWppParagraphFormatInput(input);
  const indexed = wpsConnectorWppParagraphIndexesFromInput(input);
  if (indexed.indexes.length) return wpsConnectorWppApplyParagraphFormatByIndexes({ ...input, paragraphIndexes: indexed.indexes, format });
  const range = wpsConnectorWppOptionalRange(input);
  const result = wpsConnectorWppApplyParagraphFormatToRange(range, format);
  const readback = wpsConnectorWppReadParagraphFormat(input);
  return { host: "wpp", paragraphFormatted: result.accepted.length > 0, applied: result.accepted.length > 0, affectedRange: readback.affectedRange, effectiveFormat: readback.effectiveFormat, hostAcceptedFields: result.accepted, hostRejectedFields: result.rejected };
}
function wpsConnectorWppApplyParagraphFormatByIndexes(input = {}) {
  const started = Date.now();
  const resolved = wpsConnectorWppParagraphIndexesFromInput(input);
  if (!resolved.indexes.length) wpsConnectorFail("INVALID_ARGUMENT", "paragraphIndexes or startParagraphIndex/endParagraphIndex is required.", { fields: ["paragraphIndexes", "startParagraphIndex", "endParagraphIndex"] });
  const options = wpsConnectorWppResultOptions(input);
  const needsDetails = !options.summaryOnly || options.includeText || options.includeRanges;
  const format = wpsConnectorWppParagraphFormatInput(input);
  const fontFormat = { ...(input.font || {}) };
  const dryRun = Boolean(input.dryRun);
  const results = [];
  for (const paragraphIndex of resolved.indexes) {
    const range = wpsConnectorWppParagraphRange(paragraphIndex).range;
    const item = needsDetails ? wpsConnectorWppParagraphItem(paragraphIndex) : null;
    const before = needsDetails ? wpsConnectorWppParagraphFormatSummary(range) : null;
    const beforeFont = needsDetails ? wpsConnectorWppFontFormatSummary(range) : null;
    const applied = dryRun ? { accepted: [], rejected: [] } : wpsConnectorWppApplyParagraphFormatToRange(range, format);
    const fontApplied = dryRun ? { accepted: [], rejected: [] } : wpsConnectorWppApplyFontFormatToRange(range, fontFormat);
    const after = needsDetails ? (dryRun ? before : wpsConnectorWppParagraphFormatSummary(range)) : null;
    const afterFont = needsDetails ? (dryRun ? beforeFont : wpsConnectorWppFontFormatSummary(range)) : null;
    results.push({ paragraphIndex, ok: dryRun || applied.accepted.length > 0 || fontApplied.accepted.length > 0 || (Object.keys(format).length === 0 && Object.keys(fontFormat).length === 0), dryRun, affectedRange: item?.range, textPreview: item?.preview, styleName: item?.styleName, beforeFormat: before, beforeFont, effectiveFormat: after, font: afterFont, hostAcceptedFields: [...applied.accepted, ...fontApplied.accepted], hostRejectedFields: [...applied.rejected, ...fontApplied.rejected] });
  }
  const readback = needsDetails ? results.map((result) => ({ paragraphIndex: result.paragraphIndex, affectedRange: result.affectedRange, textPreview: result.textPreview, styleName: result.styleName, format: result.effectiveFormat, font: result.font })) : [];
  const merged = needsDetails ? wpsConnectorWppMergeParagraphFormats(readback) : { effectiveFormat: {}, mixedFields: [] };
  const full = { host: "wpp", applied: !dryRun && results.some((result) => result.hostAcceptedFields.length > 0), dryRun, paragraphCount: resolved.paragraphCount, affectedCount: results.length, affectedParagraphIndexes: resolved.indexes, affectedParagraphs: results, effectiveFormat: merged.effectiveFormat, mixedFields: merged.mixedFields, perParagraphFormats: readback, hostAcceptedFields: [...new Set(results.flatMap((result) => result.hostAcceptedFields))], hostRejectedFields: [...new Set(results.flatMap((result) => result.hostRejectedFields))], elapsedMs: Date.now() - started };
  return wpsConnectorWppSlimParagraphResult(full, input);
}
function wpsConnectorWppCopyParagraphFormat(input = {}) {
  const started = Date.now();
  const sourceIndex = wpsConnectorInteger(input.sourceParagraphIndex, "sourceParagraphIndex", 1);
  const sourceRange = wpsConnectorWppParagraphRange(sourceIndex).range;
  const sourceFormat = wpsConnectorWppParagraphFormatSummary(sourceRange);
  const sourceFont = wpsConnectorWppFontFormatSummary(sourceRange);
  const fields = Array.isArray(input.fields) && input.fields.length ? input.fields : ["alignment", "lineSpacingRule", "lineSpacingValue", "spaceBefore", "spaceAfter", "firstLineIndent", "leftIndent", "rightIndent", "keepWithNext", "pageBreakBefore"];
  const format = {};
  for (const field of fields) if (sourceFormat[field] !== undefined && sourceFormat[field] !== null) format[field] = sourceFormat[field];
  const font = input.includeFont ? sourceFont : {};
  const targetInput = { paragraphIndexes: input.targetParagraphIndexes, startParagraphIndex: input.startParagraphIndex, endParagraphIndex: input.endParagraphIndex };
  const target = wpsConnectorWppParagraphIndexesFromInput(targetInput);
  if (!target.indexes.length) wpsConnectorFail("INVALID_ARGUMENT", "targetParagraphIndexes or target range is required.", { fields: ["targetParagraphIndexes", "startParagraphIndex", "endParagraphIndex"] });
  const result = wpsConnectorWppApplyParagraphFormatByIndexes({ ...input, paragraphIndexes: target.indexes, format, font, dryRun: Boolean(input.dryRun), preview: input.preview });
  const full = { ...result, copied: !result.dryRun && result.applied, sourceParagraphIndex: sourceIndex, sourceFormat, sourceFont, includeFont: Boolean(input.includeFont), copiedFields: [...Object.keys(format), ...Object.keys(font).map((field) => `font.${field}`)], targetParagraphIndexes: target.indexes, elapsedMs: Date.now() - started };
  return wpsConnectorWppSlimParagraphResult(full, input);
}
function wpsConnectorWppCopySelectedParagraphFormatToIndexes(input = {}) {
  const selected = wpsConnectorWppSelectedParagraphRangeInfo();
  const sourceFormat = wpsConnectorWppParagraphFormatSummary(selected.range);
  const sourceFont = wpsConnectorWppFontFormatSummary(selected.range);
  const fields = Array.isArray(input.fields) && input.fields.length ? input.fields : ["alignment", "lineSpacingRule", "lineSpacingValue", "spaceBefore", "spaceAfter", "firstLineIndent", "leftIndent", "rightIndent", "keepWithNext", "pageBreakBefore"];
  const format = {};
  for (const field of fields) if (sourceFormat[field] !== undefined && sourceFormat[field] !== null) format[field] = sourceFormat[field];
  const font = input.includeFont ? sourceFont : {};
  const target = wpsConnectorWppParagraphIndexesFromInput({ paragraphIndexes: input.targetParagraphIndexes, startParagraphIndex: input.startParagraphIndex, endParagraphIndex: input.endParagraphIndex });
  if (!target.indexes.length) wpsConnectorFail("INVALID_ARGUMENT", "targetParagraphIndexes or target range is required.", { fields: ["targetParagraphIndexes", "startParagraphIndex", "endParagraphIndex"] });
  const started = Date.now();
  const result = wpsConnectorWppApplyParagraphFormatByIndexes({ ...input, paragraphIndexes: target.indexes, format, font, dryRun: Boolean(input.dryRun), preview: input.preview });
  const full = { ...result, copied: !result.dryRun && result.applied, sourceParagraphIndex: selected.paragraphIndex, sourceRange: selected.details, sourceFormat, sourceFont, includeFont: Boolean(input.includeFont), copiedFields: [...Object.keys(format), ...Object.keys(font).map((field) => `font.${field}`)], targetParagraphIndexes: target.indexes, elapsedMs: Date.now() - started };
  return wpsConnectorWppSlimParagraphResult(full, input);
}
function wpsConnectorWppCompareParagraphFormat(input = {}) {
  const started = Date.now();
  const options = wpsConnectorWppResultOptions(input);
  const needsDetails = !options.summaryOnly || options.includeText || options.includeRanges;
  const sourceIndex = wpsConnectorInteger(input.sourceParagraphIndex, "sourceParagraphIndex", 1);
  const sourceRange = wpsConnectorWppParagraphRange(sourceIndex).range;
  const sourceFormat = wpsConnectorWppParagraphFormatSummary(sourceRange);
  const sourceFont = wpsConnectorWppFontFormatSummary(sourceRange);
  const fields = Array.isArray(input.fields) && input.fields.length ? input.fields : ["alignment", "lineSpacingRule", "lineSpacingValue", "spaceBefore", "spaceAfter", "firstLineIndent", "leftIndent", "rightIndent", "keepWithNext", "pageBreakBefore"];
  const target = wpsConnectorWppParagraphIndexesFromInput({ paragraphIndexes: input.targetParagraphIndexes, startParagraphIndex: input.startParagraphIndex, endParagraphIndex: input.endParagraphIndex });
  if (!target.indexes.length) wpsConnectorFail("INVALID_ARGUMENT", "targetParagraphIndexes or target range is required.", { fields: ["targetParagraphIndexes", "startParagraphIndex", "endParagraphIndex"] });
  const comparisons = target.indexes.map((paragraphIndex) => {
    const range = wpsConnectorWppParagraphRange(paragraphIndex).range;
    const targetFormat = wpsConnectorWppParagraphFormatSummary(range);
    const targetFont = wpsConnectorWppFontFormatSummary(range);
    const diffs = [];
    for (const field of fields) if (String(sourceFormat[field]) !== String(targetFormat[field])) diffs.push({ field, source: sourceFormat[field], target: targetFormat[field] });
    if (input.includeFont) for (const field of ["fontName", "fontSize", "bold", "italic", "underline", "color"]) if (String(sourceFont[field]) !== String(targetFont[field])) diffs.push({ field: `font.${field}`, source: sourceFont[field], target: targetFont[field] });
    const item = needsDetails ? wpsConnectorWppParagraphItem(paragraphIndex) : null;
    return { paragraphIndex, matches: diffs.length === 0, differingFields: diffs.map((diff) => diff.field), diffs, textPreview: item?.preview, affectedRange: item?.range, format: needsDetails ? targetFormat : undefined, font: needsDetails ? targetFont : undefined };
  });
  const full = { host: "wpp", sourceParagraphIndex: sourceIndex, sourceFormat, sourceFont: input.includeFont ? sourceFont : undefined, includeFont: Boolean(input.includeFont), targetParagraphIndexes: target.indexes, allMatch: comparisons.every((item) => item.matches), diffCount: comparisons.reduce((sum, item) => sum + item.differingFields.length, 0), comparisons, elapsedMs: Date.now() - started };
  return wpsConnectorWppSlimParagraphResult(full, input);
}
function wpsConnectorWppListStyles() {
  const styles = wpsConnectorApp().ActiveDocument?.Styles;
  const count = Number(wpsConnectorSafeGet(styles, "Count") || 0);
  const items = [];
  for (let i = 1; i <= count; i += 1) {
    try { const style = styles.Item(i); items.push({ index: i, name: String(wpsConnectorSafeGet(style, "NameLocal") || wpsConnectorSafeGet(style, "Name") || ""), type: wpsConnectorSafeGet(style, "Type") }); } catch {}
  }
  const builtIn = ["标题1", "标题2", "标题3", "正文", "项目符号", "编号列表", "Heading 1", "Heading 2", "Heading 3", "Normal"];
  return { host: "wpp", count: items.length, styles: items.filter((item) => item.name), builtIn };
}
function wpsConnectorWppApplyStyle(input = {}) {
  const styleName = String(input.styleName || "").trim();
  if (!styleName) wpsConnectorFail("INVALID_ARGUMENT", "styleName is required.", { field: "styleName" });
  const range = wpsConnectorWppOptionalRange(input);
  const lower = styleName.toLowerCase();
  const accepted = [];
  const rejected = [];
  try {
    if (["项目符号", "bullet", "bullets"].includes(lower)) { range.ListFormat?.ApplyBulletDefault?.(); accepted.push("list.bullet"); }
    else if (["编号列表", "number", "numbered", "numbering"].includes(lower)) { range.ListFormat?.ApplyNumberDefault?.(); accepted.push("list.number"); }
    else { range.Style = styleName; accepted.push("styleName"); }
  } catch (error) { rejected.push("styleName"); }
  const affectedRange = wpsConnectorWppRangeDetails(range);
  return { host: "wpp", applied: accepted.length > 0, styleName, affectedRange, effectiveFormat: { styleName: String(wpsConnectorSafeGet(range, "Style") || styleName) }, hostAcceptedFields: accepted, hostRejectedFields: rejected };
}
function wpsConnectorWppInsertionRange(input = {}) {
  if (input.start !== undefined) return wpsConnectorWppResolveRange({ start: input.start, end: input.start }).range;
  return wpsConnectorWppSelectionRange();
}
function wpsConnectorWppInsertPageBreak(input = {}) {
  const range = wpsConnectorWppInsertionRange(input);
  try { if (typeof range.InsertBreak === "function") range.InsertBreak(7); else wpsConnectorApp().Selection?.InsertBreak?.(7); } catch (error) { wpsConnectorFail("HOST_UNSUPPORTED", "WPS Writer failed to insert page break.", { hostMessage: error.message }); }
  return { host: "wpp", inserted: true, breakType: "page", affectedRange: wpsConnectorWppRangeDetails(range) };
}
function wpsConnectorWppInsertParagraphBreak(input = {}) {
  const range = wpsConnectorWppInsertionRange(input);
  try { if (typeof range.InsertParagraphBefore === "function") range.InsertParagraphBefore(); else if (typeof range.InsertAfter === "function") range.InsertAfter("\r"); else wpsConnectorApp().Selection?.TypeParagraph?.(); } catch (error) { wpsConnectorFail("HOST_UNSUPPORTED", "WPS Writer failed to insert paragraph break.", { hostMessage: error.message }); }
  return { host: "wpp", inserted: true, breakType: "paragraph", affectedRange: wpsConnectorWppRangeDetails(range) };
}
function wpsConnectorWppDeleteExtraBlankParagraphs() {
  const paragraphs = wpsConnectorApp().ActiveDocument?.Paragraphs;
  const count = Number(wpsConnectorSafeGet(paragraphs, "Count") || 0);
  if (!paragraphs) wpsConnectorFail("HOST_UNSUPPORTED", "WPS Writer paragraphs collection is not available.");
  let deletedCount = 0;
  let previousBlank = false;
  for (let i = count; i >= 1; i -= 1) {
    let range = null;
    try { range = paragraphs.Item(i).Range; } catch { continue; }
    const text = wpsConnectorWppNormalizeRangeText(wpsConnectorCall(range?.Text)).replace(/\n/g, "").trim();
    const blank = text === "";
    if (blank && previousBlank) { try { range.Delete(); deletedCount += 1; } catch {} }
    previousBlank = blank;
  }
  return { host: "wpp", applied: deletedCount > 0, deletedCount, paragraphCountBefore: count };
}


function wpsConnectorWppRangeContext(range) {
  const context = { paragraphIndex: null, isInsideTable: false, tableIndex: null, cellRow: null, cellColumn: null };
  try {
    const paragraphs = wpsConnectorApp().ActiveDocument?.Paragraphs;
    const count = Number(wpsConnectorSafeGet(paragraphs, "Count") || 0);
    const start = Number(wpsConnectorSafeGet(range, "Start"));
    for (let i = 1; i <= count; i += 1) {
      const pr = paragraphs.Item(i).Range;
      const ps = Number(wpsConnectorSafeGet(pr, "Start"));
      const pe = Number(wpsConnectorSafeGet(pr, "End"));
      if (Number.isFinite(start) && start >= ps && start <= pe) { context.paragraphIndex = i; break; }
    }
  } catch {}
  try { context.isInsideTable = Boolean(wpsConnectorMember(range, "Information", 12)); } catch {}
  try {
    const cells = range.Cells;
    const cell = Number(wpsConnectorSafeGet(cells, "Count") || 0) ? cells.Item(1) : null;
    if (cell) {
      context.isInsideTable = true;
      context.cellRow = wpsConnectorSafeGet(cell, "RowIndex");
      context.cellColumn = wpsConnectorSafeGet(cell, "ColumnIndex");
    }
  } catch {}
  try {
    const tables = wpsConnectorApp().ActiveDocument?.Tables;
    const tableCount = Number(wpsConnectorSafeGet(tables, "Count") || 0);
    const start = Number(wpsConnectorSafeGet(range, "Start"));
    for (let i = 1; i <= tableCount; i += 1) {
      const tr = tables.Item(i).Range;
      const ts = Number(wpsConnectorSafeGet(tr, "Start"));
      const te = Number(wpsConnectorSafeGet(tr, "End"));
      if (Number.isFinite(start) && start >= ts && start <= te) { context.tableIndex = i; break; }
    }
  } catch {}
  return context;
}
function wpsConnectorWppParagraphs() {
  const paragraphs = wpsConnectorApp().ActiveDocument?.Paragraphs;
  if (!paragraphs) wpsConnectorFail("HOST_UNSUPPORTED", "WPS Writer paragraphs collection is not available.");
  return paragraphs;
}
function wpsConnectorWppParagraphRange(index) {
  const paragraphs = wpsConnectorWppParagraphs();
  const count = Number(wpsConnectorSafeGet(paragraphs, "Count") || 0);
  const paragraphIndex = wpsConnectorInteger(index, "index", 1);
  if (paragraphIndex > count) wpsConnectorFail("PARAGRAPH_NOT_FOUND", "Paragraph not found: " + paragraphIndex, { index: paragraphIndex, paragraphCount: count });
  return { paragraphIndex, paragraphCount: count, range: paragraphs.Item(paragraphIndex).Range };
}
function wpsConnectorWppParagraphItem(index) {
  const { paragraphIndex, paragraphCount, range } = wpsConnectorWppParagraphRange(index);
  const details = wpsConnectorWppRangeDetails(range);
  const text = details.text.replace(new RegExp("\\n+$", "g"), "");
  return { index: paragraphIndex, paragraphIndex, paragraphCount, text, preview: text.slice(0, 240), range: details, styleName: String(wpsConnectorSafeGet(range, "Style") || ""), formatSummary: wpsConnectorWppParagraphFormatSummary(range), ...wpsConnectorWppRangeContext(range) };
}
function wpsConnectorWppListParagraphs(input = {}) {
  const paragraphs = wpsConnectorWppParagraphs();
  const count = Number(wpsConnectorSafeGet(paragraphs, "Count") || 0);
  const rangeMode = input.rangeMode || "paragraph";
  const start = input.start === undefined ? null : wpsConnectorInteger(input.start, "start", rangeMode === "text" ? 0 : 1);
  const end = input.end === undefined ? null : wpsConnectorInteger(input.end, "end", rangeMode === "text" ? 0 : 1);
  const startIndex = wpsConnectorInteger(input.startIndex ?? (rangeMode === "paragraph" ? start ?? 1 : 1), "startIndex", 1);
  const endIndex = input.endIndex !== undefined ? wpsConnectorInteger(input.endIndex, "endIndex", 1) : (rangeMode === "paragraph" && end !== null ? end : count);
  if (endIndex < startIndex) wpsConnectorFail("INVALID_ARGUMENT", "end index must be >= start index.", { startIndex, endIndex });
  const maxCount = input.maxCount === undefined ? 100 : wpsConnectorInteger(input.maxCount, "maxCount", 1);
  const includeFormatSummary = input.includeFormatSummary !== false;
  const fields = Array.isArray(input.fields) && input.fields.length ? input.fields : null;
  const items = [];
  let lastIndex = startIndex - 1;
  for (let i = startIndex; i <= count && i <= endIndex && items.length < maxCount; i += 1) {
    const full = wpsConnectorWppParagraphItem(i);
    lastIndex = i;
    if (rangeMode === "text") {
      if (start !== null && full.range.normalizedEnd < start) continue;
      if (end !== null && full.range.normalizedStart > end) continue;
    }
    const item = { index: full.index, paragraphIndex: full.paragraphIndex, paragraphCount: full.paragraphCount, text: full.text, preview: full.preview, range: full.range, styleName: full.styleName, isInsideTable: full.isInsideTable, tableIndex: full.tableIndex, cellRow: full.cellRow, cellColumn: full.cellColumn };
    if (includeFormatSummary) item.formatSummary = full.formatSummary;
    if (fields) {
      const light = {};
      for (const field of fields) {
        if (field === "index") light.index = item.index;
        else if (field === "paragraphIndex") light.paragraphIndex = item.paragraphIndex;
        else if (field === "text") light.text = item.text;
        else if (field === "preview") light.preview = item.preview;
        else if (field === "range") light.range = item.range;
        else if (field === "style" || field === "styleName") light.styleName = item.styleName;
        else if (field === "formatSummary") light.formatSummary = item.formatSummary;
        else if (Object.prototype.hasOwnProperty.call(item, field)) light[field] = item[field];
      }
      items.push(light);
    } else {
      items.push(item);
    }
  }
  const nextStartIndex = lastIndex < Math.min(count, endIndex) ? lastIndex + 1 : null;
  return { host: "wpp", paragraphCount: count, count: items.length, startIndex, endIndex, maxCount, nextStartIndex, truncated: nextStartIndex !== null, paragraphs: items };
}
function wpsConnectorWppGetParagraphRange(input = {}) {
  const item = wpsConnectorWppParagraphItem(input.index);
  return { host: "wpp", paragraphIndex: item.paragraphIndex, affectedRange: item.range, resolvedTextPreview: item.preview, styleName: item.styleName, isInsideTable: item.isInsideTable, tableIndex: item.tableIndex, cellRow: item.cellRow, cellColumn: item.cellColumn };
}
function wpsConnectorWppFindBlock(input = {}) {
  const anchorText = String(input.anchorText || "").trim();
  if (!anchorText) wpsConnectorFail("INVALID_ARGUMENT", "anchorText is required.", { field: "anchorText" });
  const options = input.options || {};
  const blockType = options.blockType || "paragraph";
  const paragraphs = wpsConnectorWppListParagraphs({ maxCount: 2000 }).paragraphs;
  const match = paragraphs.find((p) => options.matchWholeParagraph ? p.text.trim() === anchorText : p.text.includes(anchorText));
  if (!match) wpsConnectorFail("BLOCK_NOT_FOUND", "Block anchor not found: " + anchorText, { anchorText, blockType });
  if (blockType === "table") {
    const tables = wpsConnectorApp().ActiveDocument?.Tables;
    const tableCount = Number(wpsConnectorSafeGet(tables, "Count") || 0);
    for (let i = 1; i <= tableCount; i += 1) {
      const range = tables.Item(i).Range;
      const text = wpsConnectorWppNormalizeRangeText(wpsConnectorCall(range?.Text));
      if (text.includes(anchorText)) return { host: "wpp", found: true, blockType: "table", tableIndex: i, affectedParagraphIndex: match.paragraphIndex, affectedRange: wpsConnectorWppRangeDetails(range), resolvedTextPreview: text.slice(0, 500), exactMatch: true };
    }
  }
  const following = Math.max(0, Number(options.includeFollowingParagraphs || 0));
  let endIndex = Math.min(paragraphs.length, match.paragraphIndex + following);
  if (options.stopAtNextAnchor) {
    const anchorPattern = new RegExp("^\\s*(Q[A-Z]-\\d+|【.+?】|第[一二三四五六七八九十]+部分)");
    for (let i = match.paragraphIndex + 1; i <= endIndex; i += 1) {
      const text = paragraphs[i - 1]?.text || "";
      if (anchorPattern.test(text)) { endIndex = i - 1; break; }
    }
  }
  const startRange = wpsConnectorWppParagraphRange(match.paragraphIndex).range;
  const endRange = wpsConnectorWppParagraphRange(endIndex).range;
  const nativeStart = Number(wpsConnectorSafeGet(startRange, "Start"));
  const nativeEnd = Number(wpsConnectorSafeGet(endRange, "End"));
  const document = wpsConnectorApp().ActiveDocument;
  const range = document.Range(nativeStart, nativeEnd);
  const details = wpsConnectorWppRangeDetails(range);
  return { host: "wpp", found: true, blockType, anchorText, affectedParagraphIndex: match.paragraphIndex, startParagraphIndex: match.paragraphIndex, endParagraphIndex: endIndex, affectedRange: details, resolvedTextPreview: details.text.slice(0, 500), exactMatch: details.text.includes(anchorText), hostAcceptedFields: [], hostRejectedFields: [] };
}
function wpsConnectorWppEditableParagraphRange(index) {
  const info = wpsConnectorWppParagraphRange(index);
  const range = info.range;
  let editRange = null;
  try { editRange = typeof range.Duplicate === "function" ? range.Duplicate() : range.Duplicate; } catch {}
  if (!editRange) {
    const start = Number(wpsConnectorSafeGet(range, "Start"));
    const end = Number(wpsConnectorSafeGet(range, "End"));
    editRange = wpsConnectorApp().ActiveDocument.Range(start, Math.max(start, end - 1));
  }
  const end = Number(wpsConnectorSafeGet(editRange, "End"));
  const start = Number(wpsConnectorSafeGet(editRange, "Start"));
  if (Number.isFinite(start) && Number.isFinite(end) && end > start) { try { editRange.End = end - 1; } catch {} }
  return { ...info, editRange };
}
function wpsConnectorWppReplaceParagraph(input = {}) {
  if (input.text === undefined || input.text === null) wpsConnectorFail("INVALID_ARGUMENT", "text is required.", { field: "text" });
  const before = wpsConnectorWppParagraphItem(input.index);
  const { paragraphIndex, editRange } = wpsConnectorWppEditableParagraphRange(input.index);
  try { editRange.Text = String(input.text); } catch (error) { wpsConnectorFail("PARAGRAPH_REPLACE_FAILED", "WPS Writer failed to replace paragraph.", { index: paragraphIndex, hostMessage: error.message }); }
  const after = wpsConnectorWppParagraphItem(paragraphIndex);
  return { host: "wpp", applied: true, exactMatch: after.text === String(input.text), affectedParagraphIndex: paragraphIndex, affectedRange: after.range, beforeText: before.text, afterText: after.text, resolvedTextPreview: after.preview, hostAcceptedFields: ["text"], hostRejectedFields: [] };
}
function wpsConnectorWppSelectedParagraphRangeInfo() {
  const selectionParagraphs = wpsConnectorApp().Selection?.Paragraphs;
  let selectedParagraph = null;
  try { selectedParagraph = selectionParagraphs?.Item(1); } catch {}
  const selectedRange = selectedParagraph?.Range;
  if (!selectedRange) {
    const details = wpsConnectorWppRangeDetails(wpsConnectorWppSelectionRange());
    if (!details.paragraphIndex) wpsConnectorFail("PARAGRAPH_NOT_FOUND", "Current selection is not inside a paragraph.", details);
    return { paragraphIndex: details.paragraphIndex, range: wpsConnectorWppParagraphRange(details.paragraphIndex).range, details };
  }
  const selectedStart = Number(wpsConnectorSafeGet(selectedRange, "Start"));
  const selectedEnd = Number(wpsConnectorSafeGet(selectedRange, "End"));
  const paragraphs = wpsConnectorWppParagraphs();
  const count = Number(wpsConnectorSafeGet(paragraphs, "Count") || 0);
  let overlapMatch = null;
  for (let i = 1; i <= count; i += 1) {
    let range = null;
    try { range = paragraphs.Item(i).Range; } catch { continue; }
    const start = Number(wpsConnectorSafeGet(range, "Start"));
    const end = Number(wpsConnectorSafeGet(range, "End"));
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    if (start === selectedStart && end === selectedEnd) return { paragraphIndex: i, range, details: wpsConnectorWppRangeDetails(range) };
    const overlaps = Number.isFinite(selectedStart) && Number.isFinite(selectedEnd) && end > selectedStart && start < selectedEnd;
    if (overlaps && !overlapMatch) overlapMatch = { paragraphIndex: i, range, details: wpsConnectorWppRangeDetails(range) };
  }
  if (overlapMatch) return overlapMatch;
  const details = wpsConnectorWppRangeDetails(selectedRange);
  if (!details.paragraphIndex) wpsConnectorFail("PARAGRAPH_NOT_FOUND", "Current selection paragraph could not be matched.", { selectedStart, selectedEnd });
  return { paragraphIndex: details.paragraphIndex, range: selectedRange, details };
}
function wpsConnectorWppCurrentParagraphIndex() {
  return wpsConnectorWppSelectedParagraphRangeInfo().paragraphIndex;
}
function wpsConnectorWppReplaceCurrentParagraph(input = {}) { return wpsConnectorWppReplaceParagraph({ index: wpsConnectorWppCurrentParagraphIndex(), text: input.text }); }
function wpsConnectorWppReplaceBlock(input = {}) {
  const block = wpsConnectorWppFindBlock({ anchorText: input.anchorText, options: input.options || {} });
  if (block.blockType === "paragraph" && block.startParagraphIndex === block.endParagraphIndex) return wpsConnectorWppReplaceParagraph({ index: block.affectedParagraphIndex, text: input.text });
  const range = wpsConnectorApp().ActiveDocument.Range(block.affectedRange.nativeStart, Math.max(block.affectedRange.nativeStart, block.affectedRange.nativeEnd - 1));
  const beforeText = block.affectedRange.text.replace(new RegExp("\\n+$", "g"), "");
  try { range.Text = String(input.text); } catch (error) { wpsConnectorFail("BLOCK_REPLACE_FAILED", "WPS Writer failed to replace block.", { anchorText: input.anchorText, hostMessage: error.message }); }
  return { host: "wpp", applied: true, exactMatch: true, affectedParagraphIndex: block.affectedParagraphIndex, affectedRange: block.affectedRange, beforeText, afterText: String(input.text), resolvedTextPreview: String(input.text).slice(0, 500), hostAcceptedFields: ["text"], hostRejectedFields: [] };
}
function wpsConnectorWppInsertTextAtParagraph(input = {}, position = "after") {
  if (input.text === undefined || input.text === null) wpsConnectorFail("INVALID_ARGUMENT", "text is required.", { field: "text" });
  const { paragraphIndex, range } = wpsConnectorWppParagraphRange(input.index);
  const native = position === "before" ? Number(wpsConnectorSafeGet(range, "Start")) : Number(wpsConnectorSafeGet(range, "End"));
  const insertRange = wpsConnectorApp().ActiveDocument.Range(native, native);
  const text = String(input.text);
  try { insertRange.InsertBefore(position === "before" ? text + "\\r" : "\\r" + text); } catch (error) { wpsConnectorFail("PARAGRAPH_INSERT_FAILED", "WPS Writer failed to insert text around paragraph.", { index: paragraphIndex, position, hostMessage: error.message }); }
  return { host: "wpp", applied: true, exactMatch: true, affectedParagraphIndex: paragraphIndex, position, affectedRange: wpsConnectorWppRangeDetails(insertRange), resolvedTextPreview: text.slice(0, 500), hostAcceptedFields: ["text"], hostRejectedFields: [] };
}
function wpsConnectorWppInsertTableAtParagraph(input = {}, position = "after") {
  const { paragraphIndex, range } = wpsConnectorWppParagraphRange(input.index);
  const native = position === "before" ? Number(wpsConnectorSafeGet(range, "Start")) : Number(wpsConnectorSafeGet(range, "End"));
  const insertRange = wpsConnectorApp().ActiveDocument.Range(native, native);
  try { insertRange.Select(); } catch (error) { wpsConnectorFail("PARAGRAPH_INSERT_FAILED", "WPS Writer failed to select paragraph insertion point.", { index: paragraphIndex, position, hostMessage: error.message }); }
  const result = wpsConnectorWppInsertTable(input);
  return { ...result, applied: true, exactMatch: true, affectedParagraphIndex: paragraphIndex, position, affectedRange: wpsConnectorWppRangeDetails(insertRange), hostAcceptedFields: ["table"], hostRejectedFields: [] };
}

function wpsConnectorWppTextPreview(text, start, end, radius = 40) {
  const previewStart = Math.max(0, start - radius);
  const previewEnd = Math.min(text.length, end + radius);
  return { before: text.slice(previewStart, start), match: text.slice(start, end), after: text.slice(end, previewEnd), previewStart, previewEnd };
}
function wpsConnectorWppIsWholeWord(text, start, end) {
  const isWord = (ch) => /[A-Za-z0-9_]/.test(ch || "");
  return !isWord(text[start - 1]) && !isWord(text[end]);
}
function wpsConnectorWppFindText(input = {}) {
  const query = String(input.query || "");
  if (!query) wpsConnectorFail("INVALID_ARGUMENT", "query is required.", { field: "query" });
  const maxResults = input.maxResults === undefined ? 50 : wpsConnectorInteger(input.maxResults, "maxResults", 1);
  const model = wpsConnectorWppTextModel();
  const haystack = input.matchCase ? model.text : model.text.toLowerCase();
  const needle = input.matchCase ? query : query.toLowerCase();
  const results = [];
  let pos = 0;
  while (results.length < maxResults) {
    const index = haystack.indexOf(needle, pos);
    if (index < 0) break;
    const end = index + query.length;
    if (!input.matchWholeWord || wpsConnectorWppIsWholeWord(model.text, index, end)) {
      const nativeStart = wpsConnectorWppNativeEnd(model, index);
      const nativeEnd = wpsConnectorWppNativeEnd(model, end);
      results.push({ index: results.length + 1, text: model.text.slice(index, end), start: index, end, normalizedStart: index, normalizedEnd: end, nativeStart, nativeEnd, preview: wpsConnectorWppTextPreview(model.text, index, end) });
    }
    pos = Math.max(index + 1, end);
  }
  return { host: "wpp", query, count: results.length, truncated: results.length >= maxResults, textModel: "normalized-wps-range-v1", results };
}
function wpsConnectorWppRangeDuplicate(range) {
  try {
    const duplicate = wpsConnectorMember(range, "Duplicate");
    if (duplicate) return duplicate;
  } catch {}
  const document = wpsConnectorApp().ActiveDocument;
  const start = Number(wpsConnectorMember(range, "Start"));
  const end = Number(wpsConnectorMember(range, "End"));
  if (document?.Range && Number.isFinite(start) && Number.isFinite(end)) return document.Range(start, end);
  return null;
}
function wpsConnectorWppFindNativeText(input = {}) {
  const query = String(input.query ?? input.findText ?? "");
  if (!query) wpsConnectorFail("INVALID_ARGUMENT", "query is required.", { field: "query" });
  const maxResults = input.maxResults === undefined ? 1000 : wpsConnectorInteger(input.maxResults, "maxResults", 1);
  const document = wpsConnectorApp().ActiveDocument;
  const content = document?.Content || document?.Range?.();
  if (!document || !content) wpsConnectorFail("HOST_UNSUPPORTED", "WPS Writer document range is not available.");
  const contentEnd = Number(wpsConnectorMember(content, "End"));
  const results = [];
  const attempts = [];
  let searchRange = wpsConnectorWppRangeDuplicate(content) || content;
  for (let guard = 0; guard < maxResults + 20 && results.length < maxResults; guard += 1) {
    const find = searchRange?.Find;
    if (!find) break;
    try {
      try { find.ClearFormatting?.(); } catch {}
      try { find.Text = query; } catch {}
      try { find.Forward = true; } catch {}
      try { find.Wrap = 0; } catch {}
      try { find.MatchCase = Boolean(input.matchCase); } catch {}
      try { find.MatchWholeWord = Boolean(input.matchWholeWord); } catch {}
      let found = false;
      try { found = Boolean(find.Execute()); } catch (error) {
        attempts.push({ label: "Find.Execute()", error: error.message || String(error) });
        try { found = Boolean(find.Execute(query)); } catch (error2) { attempts.push({ label: "Find.Execute(query)", error: error2.message || String(error2) }); }
      }
      if (!found) break;
      const matchRange = wpsConnectorWppRangeDuplicate(searchRange) || searchRange;
      const nativeStart = Number(wpsConnectorMember(matchRange, "Start"));
      const nativeEnd = Number(wpsConnectorMember(matchRange, "End"));
      const text = wpsConnectorWppNormalizeRangeText(wpsConnectorCall(matchRange.Text));
      const exactMatch = input.matchCase ? text === query : text.toLowerCase() === query.toLowerCase();
      results.push({ index: results.length + 1, text, start: null, end: null, normalizedStart: null, normalizedEnd: null, nativeStart, nativeEnd, range: matchRange, exactMatch, textModel: "native-wps-find-v1", preview: { before: "", match: text, after: "" } });
      const nextStart = Math.max(nativeEnd, nativeStart + 1);
      if (!Number.isFinite(nextStart) || !Number.isFinite(contentEnd) || nextStart >= contentEnd) break;
      searchRange = document.Range(nextStart, contentEnd);
    } catch (error) {
      attempts.push({ label: "native-find-loop", error: error.message || String(error) });
      break;
    }
  }
  return { query, count: results.length, truncated: results.length >= maxResults, textModel: "native-wps-find-v1", results, attempts };
}
function wpsConnectorWppTextTargets(input = {}) {
  const query = String(input.query ?? input.findText ?? "");
  const field = input.query !== undefined ? "query" : "findText";
  if (!query) wpsConnectorFail("INVALID_ARGUMENT", `${field} is required.`, { field });
  const found = input.preferNormalized === true ? wpsConnectorWppFindText({ query, matchCase: input.matchCase, matchWholeWord: input.matchWholeWord, maxResults: input.maxResults || 1000 }) : wpsConnectorWppFindNativeText({ query, matchCase: input.matchCase, matchWholeWord: input.matchWholeWord, maxResults: input.maxResults || 1000 });
  if (!found.results.length) wpsConnectorFail("TEXT_NOT_FOUND", "Text not found: " + query, { query });
  const occurrence = input.occurrence === undefined ? "first" : input.occurrence;
  if (occurrence === "all") return { query, targets: found.results };
  if (occurrence === "last") return { query, targets: [found.results[found.results.length - 1]] };
  if (occurrence === "first") return { query, targets: [found.results[0]] };
  const wanted = occurrence === "index" ? wpsConnectorInteger(input.index, "index", 1) : wpsConnectorInteger(occurrence, "occurrence", 1);
  if (wanted > found.results.length) wpsConnectorFail("TEXT_NOT_FOUND", "Text occurrence not found: " + wanted, { query, occurrence: wanted, count: found.results.length });
  return { query, targets: [found.results[wanted - 1]] };
}
function wpsConnectorWppReplacementTargets(input = {}) {
  const findText = String(input.findText || "");
  if (!findText) wpsConnectorFail("INVALID_ARGUMENT", "findText is required.", { field: "findText" });
  return wpsConnectorWppTextTargets(input).targets;
}
function wpsConnectorWppReplaceText(input = {}) {
  const replaceText = String(input.replaceText ?? "");
  const targets = wpsConnectorWppReplacementTargets(input);
  const replacements = [];
  for (const target of [...targets].sort((a, b) => Number(b.nativeStart ?? b.start ?? 0) - Number(a.nativeStart ?? a.start ?? 0))) {
    const resolved = target.range ? wpsConnectorWppResolvedFromRange(target.range, target.text) : wpsConnectorWppResolveRange({ start: target.start, end: target.end });
    if (!resolved.exactMatch) wpsConnectorFail("RANGE_MAPPING_DRIFT", "Resolved range does not match target text.", { target: { ...target, range: undefined }, resolvedText: resolved.resolvedText, attempts: resolved.attempts });
    const before = resolved.resolvedText;
    try { resolved.range.Text = replaceText; } catch (error) { wpsConnectorFail("HOST_UNSUPPORTED", "WPS Writer text replacement is not available.", { hostMessage: error.message, target: { ...target, range: undefined } }); }
    replacements.unshift({ index: target.index, start: target.start, end: target.end, nativeStart: target.nativeStart, nativeEnd: target.nativeEnd, before, after: replaceText, beforePreview: target.preview });
  }
  return { host: "wpp", replaced: replacements.length > 0, replacedCount: replacements.length, findText: String(input.findText || ""), replaceText, replacements };
}

function wpsConnectorWppReadFormat() {
  const selection = wpsConnectorApp().Selection;
  if (!selection) wpsConnectorFail("HOST_UNSUPPORTED", "WPS Writer selection is not available.");
  const font = selection.Font || {};
  const paragraph = selection.ParagraphFormat || {};
  return {
    host: "wpp",
    font: {
      name: String(wpsConnectorMember(font, "Name") || ""),
      size: Number(wpsConnectorMember(font, "Size") || 0) || undefined,
      bold: Boolean(wpsConnectorMember(font, "Bold")),
      italic: Boolean(wpsConnectorMember(font, "Italic")),
      color: wpsConnectorMember(font, "Color"),
    },
    paragraph: {
      alignment: wpsConnectorMember(paragraph, "Alignment"),
      spaceBefore: wpsConnectorMember(paragraph, "SpaceBefore"),
      spaceAfter: wpsConnectorMember(paragraph, "SpaceAfter"),
      lineSpacing: wpsConnectorMember(paragraph, "LineSpacing"),
    },
  };
}
function wpsConnectorWppFormatSelection(input = {}) {
  wpsConnectorApplyOperationScope(input);
  wpsConnectorSetSelectionFont({ name: input.fontName, size: input.fontSize, bold: input.bold, italic: input.italic });
  if (input.fontColor) {
    const font = wpsConnectorApp().Selection?.Font;
    if (font) font.Color = wpsConnectorColorValue(input.fontColor);
  }
  wpsConnectorSetParagraph({ alignment: wpsConnectorWppAlignment(input.alignment), spaceBefore: input.spaceBefore, spaceAfter: input.spaceAfter, lineSpacing: input.lineSpacing });
  return { host: "wpp", formatted: true };
}
function wpsConnectorWppAlignment(value) {
  const map = { left: 0, center: 1, right: 2, justify: 3 };
  if (value === undefined || value === null || value === "") return undefined;
  return map[String(value).toLowerCase()] ?? value;
}
function wpsConnectorWppTableCellText(table, row, column) {
  try {
    const cell = table.Cell(row, column);
    return String(wpsConnectorCall(cell?.Range?.Text) || "").replace(/\r?\x07/g, "").replace(/\r+$/g, "");
  } catch {
    return "";
  }
}
function wpsConnectorWppReadTable(input = {}) {
  const app = wpsConnectorApp();
  const tables = app.ActiveDocument?.Tables;
  if (!tables) wpsConnectorFail("HOST_UNSUPPORTED", "WPS Writer tables collection is not available.");
  const tableIndex = input.tableIndex === undefined ? 1 : wpsConnectorInteger(input.tableIndex, "tableIndex", 1);
  const count = Number(wpsConnectorMember(tables, "Count") || 0);
  if (tableIndex > count) wpsConnectorFail("TABLE_NOT_FOUND", `Table not found: ${tableIndex}`, { tableIndex, tableCount: count });
  const table = tables.Item(tableIndex);
  const rowCount = Number(wpsConnectorMember(wpsConnectorMember(table, "Rows"), "Count") || 0);
  const columnCount = Number(wpsConnectorMember(wpsConnectorMember(table, "Columns"), "Count") || 0);
  const values = [];
  for (let r = 1; r <= rowCount; r += 1) {
    const row = [];
    for (let c = 1; c <= columnCount; c += 1) row.push(wpsConnectorWppTableCellText(table, r, c));
    values.push(row);
  }
  return { host: "wpp", tableIndex, tableCount: count, rowCount, columnCount, values };
}
function wpsConnectorWppTable(input = {}) {
  const app = wpsConnectorApp();
  const tables = app.ActiveDocument?.Tables;
  if (!tables) wpsConnectorFail("HOST_UNSUPPORTED", "WPS Writer tables collection is not available.");
  const tableIndex = input.tableIndex === undefined ? 1 : wpsConnectorInteger(input.tableIndex, "tableIndex", 1);
  const count = Number(wpsConnectorMember(tables, "Count") || 0);
  if (tableIndex > count) wpsConnectorFail("TABLE_NOT_FOUND", `Table not found: ${tableIndex}`, { tableIndex, tableCount: count });
  return { table: tables.Item(tableIndex), tableIndex, tableCount: count };
}
function wpsConnectorWppTableSize(table) {
  return {
    rowCount: Number(wpsConnectorMember(wpsConnectorMember(table, "Rows"), "Count") || 0),
    columnCount: Number(wpsConnectorMember(wpsConnectorMember(table, "Columns"), "Count") || 0),
  };
}
function wpsConnectorWppAssertCell(table, row, column) {
  const size = wpsConnectorWppTableSize(table);
  if (row < 1 || row > size.rowCount) wpsConnectorFail("INVALID_ARGUMENT", "row index is outside table bounds.", { row, rowCount: size.rowCount });
  if (column < 1 || column > size.columnCount) wpsConnectorFail("INVALID_ARGUMENT", "column index is outside table bounds.", { column, columnCount: size.columnCount });
  return size;
}

function wpsConnectorWppCellMergeInfo(table, tableIndex, row, column) {
  let cell = null;
  try { cell = table.Cell(row, column); } catch {}
  const mergedCells = (() => { try { return wpsConnectorWppReadMergedCells({ tableIndex }).mergedCells || []; } catch { return []; } })();
  const region = mergedCells.find((item) => row >= item.startRow && row <= item.endRow && column >= item.startColumn && column <= item.endColumn) || null;
  return { merged: Boolean(region), mergeAnchor: region ? { row: region.startRow, column: region.startColumn } : { row, column }, mergeRegion: region, isMergeAnchor: !region || (region.startRow === row && region.startColumn === column), cellAvailable: Boolean(cell) };
}
function wpsConnectorWppCellRangeForText(cell) {
  const range = wpsConnectorSafeGet(cell, "Range");
  if (!range) wpsConnectorFail("HOST_UNSUPPORTED", "WPS Writer cell range is not available.");
  let editRange = null;
  try { editRange = typeof range.Duplicate === "function" ? range.Duplicate() : range.Duplicate; } catch {}
  if (!editRange) {
    const app = wpsConnectorApp();
    const document = app.ActiveDocument;
    const start = Number(wpsConnectorSafeGet(range, "Start"));
    const end = Number(wpsConnectorSafeGet(range, "End"));
    if (document?.Range && Number.isFinite(start) && Number.isFinite(end)) editRange = document.Range(start, Math.max(start, end - 1));
  }
  if (!editRange) editRange = range;
  const start = Number(wpsConnectorSafeGet(editRange, "Start"));
  const end = Number(wpsConnectorSafeGet(editRange, "End"));
  if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
    try { editRange.End = end - 1; } catch {}
  }
  return editRange;
}
function wpsConnectorWppReadTableCell(input = {}) {
  const { table, tableIndex } = wpsConnectorWppTable(input);
  const row = wpsConnectorInteger(input.row, "row", 1);
  const column = wpsConnectorInteger(input.col ?? input.column, "column", 1);
  wpsConnectorWppAssertCell(table, row, column);
  let cell = null;
  try { cell = table.Cell(row, column); } catch (error) { wpsConnectorFail("CELL_IN_MERGED_REGION", "Target cell is inside a merged region and is not directly addressable.", { tableIndex, row, column, hostMessage: error.message }); }
  const merge = wpsConnectorWppCellMergeInfo(table, tableIndex, row, column);
  return { host: "wpp", tableIndex, row, column, text: wpsConnectorWppTableCellText(table, row, column), merged: merge.merged, mergeAnchor: merge.mergeAnchor, mergeRegion: merge.mergeRegion, isMergeAnchor: merge.isMergeAnchor, format: wpsConnectorWppCellFormat(cell, row, column) };
}
function wpsConnectorWppWriteTableCell(input = {}) {
  const { table, tableIndex } = wpsConnectorWppTable(input);
  const row = wpsConnectorInteger(input.row, "row", 1);
  const column = wpsConnectorInteger(input.col ?? input.column, "column", 1);
  if (input.text === undefined || input.text === null) wpsConnectorFail("INVALID_ARGUMENT", "text is required.", { field: "text" });
  wpsConnectorWppAssertCell(table, row, column);
  let cell = null;
  try { cell = table.Cell(row, column); } catch (error) { wpsConnectorFail("CELL_IN_MERGED_REGION", "Target cell is inside a merged region and is not directly addressable.", { tableIndex, row, column, hostMessage: error.message }); }
  const merge = wpsConnectorWppCellMergeInfo(table, tableIndex, row, column);
  if (merge.merged && !merge.isMergeAnchor) wpsConnectorFail("CELL_IN_MERGED_REGION", "Only the anchor cell of a merged region can be written.", { tableIndex, row, column, mergeAnchor: merge.mergeAnchor, mergeRegion: merge.mergeRegion });
  const beforeText = wpsConnectorWppTableCellText(table, row, column);
  const text = String(input.text);
  try { wpsConnectorWppCellRangeForText(cell).Text = text; } catch (error) { wpsConnectorFail("HOST_UNSUPPORTED", "WPS Writer failed to write table cell text.", { tableIndex, row, column, hostMessage: error.message }); }
  const afterText = wpsConnectorWppTableCellText(table, row, column);
  return { host: "wpp", tableIndex, row, column, written: true, preserveStyle: input.preserveStyle !== false, beforeText, afterText, merged: merge.merged, mergeAnchor: merge.mergeAnchor, mergeRegion: merge.mergeRegion };
}

function wpsConnectorWppInsertTableRows(input = {}) {
  const { table, tableIndex } = wpsConnectorWppTable(input);
  const rowIndex = wpsConnectorInteger(input.rowIndex, "rowIndex", 1);
  const count = input.count === undefined ? 1 : wpsConnectorInteger(input.count, "count", 1);
  wpsConnectorWppAssertCell(table, rowIndex, 1);
  const after = String(input.position || "after").toLowerCase() !== "before";
  const rows = table.Rows;
  for (let i = 0; i < count; i += 1) {
    try {
      const ref = rows.Item(after ? rowIndex + i : rowIndex);
      if (after && typeof rows.Add === "function") rows.Add(ref);
      else if (typeof rows.Add === "function") rows.Add(ref);
      else wpsConnectorFail("HOST_UNSUPPORTED", "WPS Writer row insertion is not available.");
    } catch (error) {
      if (error?.code) throw error;
      wpsConnectorFail("HOST_UNSUPPORTED", "WPS Writer failed to insert table rows.", { hostMessage: error.message });
    }
  }
  return { host: "wpp", insertedRows: count, tableIndex, rowIndex, position: after ? "after" : "before", ...wpsConnectorWppTableSize(table) };
}
function wpsConnectorWppDeleteTableRows(input = {}) {
  const { table, tableIndex } = wpsConnectorWppTable(input);
  const rowIndex = wpsConnectorInteger(input.rowIndex, "rowIndex", 1);
  const count = input.count === undefined ? 1 : wpsConnectorInteger(input.count, "count", 1);
  const size = wpsConnectorWppAssertCell(table, rowIndex, 1);
  if (rowIndex + count - 1 > size.rowCount) wpsConnectorFail("INVALID_ARGUMENT", "row delete range exceeds table bounds.", { rowIndex, count, rowCount: size.rowCount });
  for (let i = 0; i < count; i += 1) {
    try { table.Rows.Item(rowIndex).Delete(); } catch (error) { wpsConnectorFail("HOST_UNSUPPORTED", "WPS Writer failed to delete table rows.", { hostMessage: error.message }); }
  }
  return { host: "wpp", deletedRows: count, tableIndex, rowIndex, ...wpsConnectorWppTableSize(table) };
}
function wpsConnectorWppInsertTableColumns(input = {}) {
  const { table, tableIndex } = wpsConnectorWppTable(input);
  const columnIndex = wpsConnectorInteger(input.columnIndex, "columnIndex", 1);
  const count = input.count === undefined ? 1 : wpsConnectorInteger(input.count, "count", 1);
  wpsConnectorWppAssertCell(table, 1, columnIndex);
  const after = String(input.position || "after").toLowerCase() !== "before";
  const columns = table.Columns;
  for (let i = 0; i < count; i += 1) {
    try {
      const ref = columns.Item(after ? columnIndex + i : columnIndex);
      if (typeof columns.Add === "function") columns.Add(ref);
      else wpsConnectorFail("HOST_UNSUPPORTED", "WPS Writer column insertion is not available.");
    } catch (error) {
      if (error?.code) throw error;
      wpsConnectorFail("HOST_UNSUPPORTED", "WPS Writer failed to insert table columns.", { hostMessage: error.message });
    }
  }
  return { host: "wpp", insertedColumns: count, tableIndex, columnIndex, position: after ? "after" : "before", ...wpsConnectorWppTableSize(table) };
}
function wpsConnectorWppDeleteTableColumns(input = {}) {
  const { table, tableIndex } = wpsConnectorWppTable(input);
  const columnIndex = wpsConnectorInteger(input.columnIndex, "columnIndex", 1);
  const count = input.count === undefined ? 1 : wpsConnectorInteger(input.count, "count", 1);
  const size = wpsConnectorWppAssertCell(table, 1, columnIndex);
  if (columnIndex + count - 1 > size.columnCount) wpsConnectorFail("INVALID_ARGUMENT", "column delete range exceeds table bounds.", { columnIndex, count, columnCount: size.columnCount });
  for (let i = 0; i < count; i += 1) {
    try { table.Columns.Item(columnIndex).Delete(); } catch (error) { wpsConnectorFail("HOST_UNSUPPORTED", "WPS Writer failed to delete table columns.", { hostMessage: error.message }); }
  }
  return { host: "wpp", deletedColumns: count, tableIndex, columnIndex, ...wpsConnectorWppTableSize(table) };
}
function wpsConnectorWppMergeTableCells(input = {}) {
  const { table, tableIndex } = wpsConnectorWppTable(input);
  const startRow = wpsConnectorInteger(input.startRow, "startRow", 1);
  const startColumn = wpsConnectorInteger(input.startColumn, "startColumn", 1);
  const endRow = wpsConnectorInteger(input.endRow, "endRow", 1);
  const endColumn = wpsConnectorInteger(input.endColumn, "endColumn", 1);
  if (endRow < startRow || endColumn < startColumn) wpsConnectorFail("INVALID_ARGUMENT", "merge end cell must be after start cell.", { startRow, startColumn, endRow, endColumn });
  wpsConnectorWppAssertCell(table, startRow, startColumn);
  wpsConnectorWppAssertCell(table, endRow, endColumn);
  try { table.Cell(startRow, startColumn).Merge(table.Cell(endRow, endColumn)); } catch (error) { wpsConnectorFail("HOST_UNSUPPORTED", "WPS Writer failed to merge table cells.", { hostMessage: error.message }); }
  return { host: "wpp", merged: true, tableIndex, startRow, startColumn, endRow, endColumn };
}
function wpsConnectorWppFormatTable(input = {}) {
  const { table, tableIndex } = wpsConnectorWppTable(input);
  const applied = [];
  if (input.border !== undefined) { try { table.Borders.Enable = input.border ? 1 : 0; applied.push("border"); } catch {} }
  const align = wpsConnectorWppAlignment(input.alignment);
  if (align !== undefined) { try { table.Range.ParagraphFormat.Alignment = align; applied.push("alignment"); } catch {} }
  if (input.headerRowBold !== undefined) { try { table.Rows.Item(1).Range.Font.Bold = input.headerRowBold ? -1 : 0; applied.push("headerRowBold"); } catch {} }
  if (input.autofit) {
    try { table.AutoFitBehavior?.(1); applied.push("autofit"); } catch {}
  }
  return { host: "wpp", formattedTable: true, tableIndex, applied, ...wpsConnectorWppTableSize(table) };
}
function wpsConnectorSafeGet(object, name) { try { return object ? wpsConnectorMember(object, name) : null; } catch { return null; } }
function wpsConnectorSafeSet(object, name, value) { if (!object || value === undefined || value === null) return false; try { object[name] = /Color$/i.test(name) ? wpsConnectorColorValue(value) : value; return true; } catch { return false; } }
function wpsConnectorBoolFormat(value) { return value === -1 || value === true; }
function wpsConnectorBorderFormat(borders) {
  const out = { enable: wpsConnectorSafeGet(borders, "Enable"), items: [] };
  for (let index = 1; index <= 6; index += 1) {
    let border = null;
    try { border = typeof borders?.Item === "function" ? borders.Item(index) : null; } catch {}
    if (!border) continue;
    out.items.push({ index, lineStyle: wpsConnectorSafeGet(border, "LineStyle"), lineWidth: wpsConnectorSafeGet(border, "LineWidth"), color: wpsConnectorSafeGet(border, "Color") });
  }
  return out;
}
function wpsConnectorApplyBorderFormat(borders, format = {}) {
  const applied = [];
  if (!borders || !format) return applied;
  if (format.enable !== undefined && wpsConnectorSafeSet(borders, "Enable", format.enable)) applied.push("borders.enable");
  for (const item of format.items || []) {
    let border = null;
    try { border = typeof borders.Item === "function" ? borders.Item(item.index) : null; } catch {}
    if (!border) continue;
    if (wpsConnectorSafeSet(border, "LineStyle", item.lineStyle)) applied.push(`border:${item.index}:lineStyle`);
    if (wpsConnectorSafeSet(border, "LineWidth", item.lineWidth)) applied.push(`border:${item.index}:lineWidth`);
    if (wpsConnectorSafeSet(border, "Color", item.color)) applied.push(`border:${item.index}:color`);
  }
  return applied;
}
function wpsConnectorWppRangeFormat(range) {
  const font = wpsConnectorSafeGet(range, "Font");
  const paragraph = wpsConnectorSafeGet(range, "ParagraphFormat");
  const shading = wpsConnectorSafeGet(range, "Shading");
  return {
    font: { name: wpsConnectorSafeGet(font, "Name"), size: wpsConnectorSafeGet(font, "Size"), bold: wpsConnectorBoolFormat(wpsConnectorSafeGet(font, "Bold")), italic: wpsConnectorBoolFormat(wpsConnectorSafeGet(font, "Italic")), color: wpsConnectorSafeGet(font, "Color") },
    paragraph: { alignment: wpsConnectorSafeGet(paragraph, "Alignment"), spaceBefore: wpsConnectorSafeGet(paragraph, "SpaceBefore"), spaceAfter: wpsConnectorSafeGet(paragraph, "SpaceAfter"), lineSpacing: wpsConnectorSafeGet(paragraph, "LineSpacing") },
    shading: { backgroundColor: wpsConnectorSafeGet(shading, "BackgroundPatternColor"), foregroundColor: wpsConnectorSafeGet(shading, "ForegroundPatternColor"), texture: wpsConnectorSafeGet(shading, "Texture") },
  };
}
function wpsConnectorApplyWppRangeFormat(range, format = {}) {
  const applied = [];
  const font = wpsConnectorSafeGet(range, "Font");
  const paragraph = wpsConnectorSafeGet(range, "ParagraphFormat");
  const shading = wpsConnectorSafeGet(range, "Shading");
  const f = format.font || {};
  if (wpsConnectorSafeSet(font, "Name", f.name)) applied.push("font.name");
  if (wpsConnectorSafeSet(font, "Size", f.size)) applied.push("font.size");
  if (typeof f.bold === "boolean" && wpsConnectorSafeSet(font, "Bold", f.bold ? -1 : 0)) applied.push("font.bold");
  if (typeof f.italic === "boolean" && wpsConnectorSafeSet(font, "Italic", f.italic ? -1 : 0)) applied.push("font.italic");
  if (wpsConnectorSafeSet(font, "Color", f.color)) applied.push("font.color");
  const p = format.paragraph || {};
  if (wpsConnectorSafeSet(paragraph, "Alignment", p.alignment)) applied.push("paragraph.alignment");
  if (wpsConnectorSafeSet(paragraph, "SpaceBefore", p.spaceBefore)) applied.push("paragraph.spaceBefore");
  if (wpsConnectorSafeSet(paragraph, "SpaceAfter", p.spaceAfter)) applied.push("paragraph.spaceAfter");
  if (wpsConnectorSafeSet(paragraph, "LineSpacing", p.lineSpacing)) applied.push("paragraph.lineSpacing");
  const s = format.shading || {};
  if (wpsConnectorSafeSet(shading, "BackgroundPatternColor", s.backgroundColor)) applied.push("shading.backgroundColor");
  if (wpsConnectorSafeSet(shading, "ForegroundPatternColor", s.foregroundColor)) applied.push("shading.foregroundColor");
  if (wpsConnectorSafeSet(shading, "Texture", s.texture)) applied.push("shading.texture");
  return applied;
}
function wpsConnectorWppCellFormat(cell, row, column) {
  const range = wpsConnectorSafeGet(cell, "Range");
  return { row, column, width: wpsConnectorSafeGet(cell, "Width"), height: wpsConnectorSafeGet(cell, "Height"), verticalAlignment: wpsConnectorSafeGet(cell, "VerticalAlignment"), padding: { top: wpsConnectorSafeGet(cell, "TopPadding"), bottom: wpsConnectorSafeGet(cell, "BottomPadding"), left: wpsConnectorSafeGet(cell, "LeftPadding"), right: wpsConnectorSafeGet(cell, "RightPadding") }, borders: wpsConnectorBorderFormat(wpsConnectorSafeGet(cell, "Borders")), ...wpsConnectorWppRangeFormat(range) };
}
function wpsConnectorApplyWppCellFormat(cell, format = {}) {
  const applied = [];
  applied.push(...wpsConnectorApplyWppRangeFormat(wpsConnectorSafeGet(cell, "Range"), format));
  applied.push(...wpsConnectorApplyBorderFormat(wpsConnectorSafeGet(cell, "Borders"), format.borders));
  if (wpsConnectorSafeSet(cell, "VerticalAlignment", format.verticalAlignment)) applied.push("cell.verticalAlignment");
  const p = format.padding || {};
  for (const [key, prop] of [["top", "TopPadding"], ["bottom", "BottomPadding"], ["left", "LeftPadding"], ["right", "RightPadding"]]) if (wpsConnectorSafeSet(cell, prop, p[key])) applied.push(`cell.padding.${key}`);
  return applied;
}
function wpsConnectorWppReadRowHeights(input = {}) {
  const { table, tableIndex } = wpsConnectorWppTable(input); const { rowCount } = wpsConnectorWppTableSize(table); const rows = [];
  for (let r = 1; r <= rowCount; r += 1) { const row = wpsConnectorSafeGet(table.Rows, "Item", r); rows.push({ row: r, height: wpsConnectorSafeGet(row, "Height"), heightRule: wpsConnectorSafeGet(row, "HeightRule") }); }
  return { host: "wpp", tableIndex, rowHeights: rows };
}
function wpsConnectorWppSetRowHeights(input = {}) { const { table, tableIndex } = wpsConnectorWppTable(input); const items = input.rowHeights || input.rows || []; const applied = []; for (const item of items) { const rowIndex = wpsConnectorInteger(item.row ?? item.index, "row", 1); wpsConnectorWppAssertCell(table, rowIndex, 1); const row = table.Rows.Item(rowIndex); if (wpsConnectorSafeSet(row, "Height", item.height)) applied.push(rowIndex); wpsConnectorSafeSet(row, "HeightRule", item.heightRule); } return { host: "wpp", tableIndex, appliedRows: applied }; }
function wpsConnectorWppReadColumnWidths(input = {}) { const { table, tableIndex } = wpsConnectorWppTable(input); const { columnCount } = wpsConnectorWppTableSize(table); const columns = []; for (let c = 1; c <= columnCount; c += 1) { const column = wpsConnectorSafeGet(table.Columns, "Item", c); columns.push({ column: c, width: wpsConnectorSafeGet(column, "Width") }); } return { host: "wpp", tableIndex, columnWidths: columns }; }
function wpsConnectorWppSetColumnWidths(input = {}) { const { table, tableIndex } = wpsConnectorWppTable(input); const items = input.columnWidths || input.columns || []; const applied = []; for (const item of items) { const columnIndex = wpsConnectorInteger(item.column ?? item.index, "column", 1); wpsConnectorWppAssertCell(table, 1, columnIndex); const column = table.Columns.Item(columnIndex); if (wpsConnectorSafeSet(column, "Width", item.width)) applied.push(columnIndex); } return { host: "wpp", tableIndex, appliedColumns: applied }; }
function wpsConnectorWppReadMergedCells(input = {}) {
  const { table, tableIndex } = wpsConnectorWppTable(input); const { rowCount, columnCount } = wpsConnectorWppTableSize(table); const mergedCells = [];
  for (let r = 1; r <= rowCount; r += 1) for (let c = 1; c <= columnCount; c += 1) {
    let cell = null; try { cell = table.Cell(r, c); } catch { continue; }
    let endColumn = c; while (endColumn + 1 <= columnCount) { try { table.Cell(r, endColumn + 1); break; } catch { endColumn += 1; } }
    let endRow = r; while (endRow + 1 <= rowCount) { try { table.Cell(endRow + 1, c); break; } catch { endRow += 1; } }
    if (endRow > r || endColumn > c) mergedCells.push({ startRow: r, startColumn: c, endRow, endColumn });
  }
  return { host: "wpp", tableIndex, mergedCells };
}
function wpsConnectorWppApplyMergedCells(input = {}) { const { table, tableIndex } = wpsConnectorWppTable(input); const mergedCells = input.mergedCells || []; const results = []; for (const item of mergedCells) { try { const startRow = wpsConnectorInteger(item.startRow, "startRow", 1); const startColumn = wpsConnectorInteger(item.startColumn, "startColumn", 1); const endRow = wpsConnectorInteger(item.endRow, "endRow", 1); const endColumn = wpsConnectorInteger(item.endColumn, "endColumn", 1); wpsConnectorWppAssertCell(table, startRow, startColumn); wpsConnectorWppAssertCell(table, endRow, endColumn); table.Cell(startRow, startColumn).Merge(table.Cell(endRow, endColumn)); results.push({ ...item, ok: true }); } catch (error) { results.push({ ...item, ok: false, error: error.code || "MERGE_FAILED" }); } } return { host: "wpp", tableIndex, appliedMergedCells: results.filter((r) => r.ok).length, results }; }
function wpsConnectorWppReadCellFormat(input = {}) { const { table, tableIndex } = wpsConnectorWppTable(input); const row = wpsConnectorInteger(input.row, "row", 1); const column = wpsConnectorInteger(input.col ?? input.column, "col", 1); wpsConnectorWppAssertCell(table, row, column); return { host: "wpp", tableIndex, row, column, format: wpsConnectorWppCellFormat(table.Cell(row, column), row, column) }; }
function wpsConnectorWppApplyCellFormat(input = {}) { const { table, tableIndex } = wpsConnectorWppTable(input); const row = wpsConnectorInteger(input.row, "row", 1); const column = wpsConnectorInteger(input.col ?? input.column, "col", 1); wpsConnectorWppAssertCell(table, row, column); const applied = wpsConnectorApplyWppCellFormat(table.Cell(row, column), input.format || {}); return { host: "wpp", tableIndex, row, column, applied }; }
function wpsConnectorWppReadTableFormat(input = {}) {
  const { table, tableIndex } = wpsConnectorWppTable(input); const size = wpsConnectorWppTableSize(table); const cells = [];
  for (let r = 1; r <= size.rowCount; r += 1) for (let c = 1; c <= size.columnCount; c += 1) { try { cells.push(wpsConnectorWppCellFormat(table.Cell(r, c), r, c)); } catch {} }
  return { host: "wpp", tableIndex, format: { table: { style: String(wpsConnectorSafeGet(table, "Style") || ""), alignment: wpsConnectorSafeGet(wpsConnectorSafeGet(table, "Range")?.ParagraphFormat, "Alignment"), allowAutoFit: wpsConnectorSafeGet(table, "AllowAutoFit"), preferredWidth: wpsConnectorSafeGet(table, "PreferredWidth"), padding: { top: wpsConnectorSafeGet(table, "TopPadding"), bottom: wpsConnectorSafeGet(table, "BottomPadding"), left: wpsConnectorSafeGet(table, "LeftPadding"), right: wpsConnectorSafeGet(table, "RightPadding"), spacing: wpsConnectorSafeGet(table, "Spacing") }, borders: wpsConnectorBorderFormat(wpsConnectorSafeGet(table, "Borders")) }, rowHeights: wpsConnectorWppReadRowHeights(input).rowHeights, columnWidths: wpsConnectorWppReadColumnWidths(input).columnWidths, mergedCells: wpsConnectorWppReadMergedCells(input).mergedCells, cells, ...size } };
}
function wpsConnectorWppApplyTableFormat(input = {}) {
  const { table, tableIndex } = wpsConnectorWppTable(input); const format = input.format || {}; const applied = [];
  const tf = format.table || {}; if (wpsConnectorSafeSet(table, "Style", tf.style)) applied.push("table.style"); if (wpsConnectorSafeSet(table, "AllowAutoFit", tf.allowAutoFit)) applied.push("table.allowAutoFit"); if (wpsConnectorSafeSet(table, "PreferredWidth", tf.preferredWidth)) applied.push("table.preferredWidth"); applied.push(...wpsConnectorApplyBorderFormat(wpsConnectorSafeGet(table, "Borders"), tf.borders));
  const padding = tf.padding || {}; for (const [key, prop] of [["top", "TopPadding"], ["bottom", "BottomPadding"], ["left", "LeftPadding"], ["right", "RightPadding"], ["spacing", "Spacing"]]) if (wpsConnectorSafeSet(table, prop, padding[key])) applied.push(`table.padding.${key}`);
  if (tf.alignment !== undefined) { try { table.Range.ParagraphFormat.Alignment = tf.alignment; applied.push("table.alignment"); } catch {} }
  if (format.rowHeights) applied.push(...wpsConnectorWppSetRowHeights({ tableIndex, rowHeights: format.rowHeights }).appliedRows.map((r) => `row:${r}:height`));
  if (format.columnWidths) applied.push(...wpsConnectorWppSetColumnWidths({ tableIndex, columnWidths: format.columnWidths }).appliedColumns.map((c) => `column:${c}:width`));
  if (format.cells) for (const cell of format.cells) { try { applied.push(...wpsConnectorApplyWppCellFormat(table.Cell(cell.row, cell.column), cell).map((x) => `cell:${cell.row}:${cell.column}:${x}`)); } catch {} }
  if (format.mergedCells) applied.push(`merged:${wpsConnectorWppApplyMergedCells({ tableIndex, mergedCells: format.mergedCells }).appliedMergedCells}`);
  return { host: "wpp", tableIndex, applied, ...wpsConnectorWppTableSize(table) };
}
function wpsConnectorWppFilterTableFormat(format, scope) {
  const scopes = new Set(Array.isArray(scope) ? scope : [scope || "all"]); if (scopes.has("all")) return format; const out = { rowCount: format.rowCount, columnCount: format.columnCount };
  if (scopes.has("table_only")) out.table = format.table; if (scopes.has("cell_style")) out.cells = format.cells; if (scopes.has("row_height")) out.rowHeights = format.rowHeights; if (scopes.has("col_width")) out.columnWidths = format.columnWidths; if (scopes.has("merged_cells")) out.mergedCells = format.mergedCells; return out;
}
function wpsConnectorWppCopyTableStyle(input = {}) { const sourceTableIndex = wpsConnectorInteger(input.sourceTableIndex, "sourceTableIndex", 1); const targetTableIndex = wpsConnectorInteger(input.targetTableIndex, "targetTableIndex", 1); const source = wpsConnectorWppReadTableFormat({ tableIndex: sourceTableIndex }).format; const filtered = wpsConnectorWppFilterTableFormat(source, input.scope || "all"); const result = wpsConnectorWppApplyTableFormat({ tableIndex: targetTableIndex, format: filtered }); return { host: "wpp", copied: true, sourceTableIndex, targetTableIndex, scope: input.scope || "all", applied: result.applied }; }
function wpsConnectorWppDuplicateTableAppearance(input = {}) { return { ...wpsConnectorWppCopyTableStyle({ sourceTableIndex: input.sourceTableIndex, targetTableIndex: input.targetTableIndex, scope: "all" }), duplicatedAppearance: true, keepContent: input.keepContent !== false }; }

function wpsConnectorPositiveNumber(value, field) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) wpsConnectorFail("INVALID_ARGUMENT", `${field} must be a positive number.`, { field, value });
  return n;
}
function wpsConnectorWppImageSource(input = {}) {
  const source = String(input.path || input.url || "").trim();
  if (!source) wpsConnectorFail("INVALID_ARGUMENT", "path or url is required.", { fields: ["path", "url"] });
  return source;
}
function wpsConnectorWppImageCollectionCount(collection) {
  try { return Number(wpsConnectorMember(collection, "Count") || 0); } catch { return 0; }
}
function wpsConnectorWppImageCollections() {
  const document = wpsConnectorApp().ActiveDocument;
  const items = [];
  if (document?.InlineShapes) items.push({ collectionType: "inline", sourceType: "InlineShapes", collection: document.InlineShapes });
  if (document?.Shapes) items.push({ collectionType: "shape", sourceType: "Shapes", collection: document.Shapes });
  if (!items.length) wpsConnectorFail("HOST_UNSUPPORTED", "WPS Writer image collections are not available.");
  return items.map((item) => ({ ...item, count: wpsConnectorWppImageCollectionCount(item.collection) }));
}
function wpsConnectorWppImageTotal() {
  return wpsConnectorWppImageCollections().reduce((sum, item) => sum + item.count, 0);
}
function wpsConnectorWppImageItem(shape, index, meta = {}) {
  return {
    index,
    collectionType: meta.collectionType || "",
    sourceType: meta.sourceType || "",
    collectionIndex: meta.collectionIndex,
    imageId: String(wpsConnectorMember(shape, "ID") || index),
    width: Number(wpsConnectorMember(shape, "Width") || 0) || undefined,
    height: Number(wpsConnectorMember(shape, "Height") || 0) || undefined,
    lockAspectRatio: wpsConnectorMember(shape, "LockAspectRatio"),
    source: String(wpsConnectorMember(shape?.LinkFormat, "SourceFullName") || wpsConnectorMember(shape, "Name") || ""),
  };
}
function wpsConnectorWppReadImages() {
  const collections = wpsConnectorWppImageCollections();
  const images = [];
  let index = 1;
  for (const item of collections) {
    for (let i = 1; i <= item.count; i += 1) {
      try {
        images.push(wpsConnectorWppImageItem(item.collection.Item(i), index, { collectionType: item.collectionType, sourceType: item.sourceType, collectionIndex: i }));
        index += 1;
      } catch {}
    }
  }
  return { host: "wpp", count: images.length, imageCount: images.length, collections: collections.map(({ collectionType, sourceType, count }) => ({ collectionType, sourceType, count })), images };
}
function wpsConnectorWppFindImage(input = {}) {
  const collections = wpsConnectorWppImageCollections();
  const count = collections.reduce((sum, item) => sum + item.count, 0);
  const imageIndex = input.imageIndex === undefined ? count : wpsConnectorInteger(input.imageIndex, "imageIndex", 1);
  if (imageIndex < 1 || imageIndex > count) wpsConnectorFail("IMAGE_NOT_FOUND", `Image not found: ${imageIndex}`, { imageIndex, imageCount: count });
  let cursor = 1;
  for (const item of collections) {
    for (let i = 1; i <= item.count; i += 1) {
      if (cursor === imageIndex) return { shape: item.collection.Item(i), imageIndex, imageCount: count, collectionType: item.collectionType, sourceType: item.sourceType, collectionIndex: i };
      cursor += 1;
    }
  }
  wpsConnectorFail("IMAGE_NOT_FOUND", `Image not found: ${imageIndex}`, { imageIndex, imageCount: count });
}
function wpsConnectorWppApplyImageFormat(shape, input = {}) {
  const applied = [];
  if (typeof input.lockAspectRatio === "boolean") { try { shape.LockAspectRatio = input.lockAspectRatio ? -1 : 0; applied.push("lockAspectRatio"); } catch {} }
  if (input.width !== undefined) { shape.Width = wpsConnectorPositiveNumber(input.width, "width"); applied.push("width"); }
  if (input.height !== undefined) { shape.Height = wpsConnectorPositiveNumber(input.height, "height"); applied.push("height"); }
  return applied;
}
function wpsConnectorWppInsertImage(input = {}) {
  wpsConnectorApplyOperationScope(input);
  const source = wpsConnectorWppImageSource(input);
  const collections = wpsConnectorWppImageCollections();
  const selection = wpsConnectorApp().Selection;
  const before = wpsConnectorWppImageTotal();
  let shape = null;
  let lastError = null;
  const inline = collections.find((item) => item.collectionType === "inline")?.collection;
  const floating = collections.find((item) => item.collectionType === "shape")?.collection;
  const sources = /^https?:/i.test(source) || /^file:/i.test(source) ? [source] : [source, "file://" + source];
  const attempts = [];
  for (const candidate of sources) {
    attempts.push(["InlineShapes.AddPicture(range)", () => inline?.AddPicture?.(candidate, false, true, selection?.Range)]);
    attempts.push(["InlineShapes.AddPicture", () => inline?.AddPicture?.(candidate)]);
    attempts.push(["Selection.InlineShapes.AddPicture", () => selection?.InlineShapes?.AddPicture?.(candidate, false, true)]);
    attempts.push(["Selection.InlineShapes.AddPicture(simple)", () => selection?.InlineShapes?.AddPicture?.(candidate)]);
    attempts.push(["Shapes.AddPicture", () => floating?.AddPicture?.(candidate, false, true, 0, 0, input.width || -1, input.height || -1)]);
    attempts.push(["Shapes.AddPicture(simple)", () => floating?.AddPicture?.(candidate)]);
  }
  const errors = [];
  for (const [label, attempt] of attempts) {
    try {
      shape = attempt();
      if (shape || wpsConnectorWppImageTotal() > before) {
        if (wpsConnectorWppImageTotal() > before) break;
      }
    } catch (error) {
      lastError = error;
      errors.push({ attempt: label, message: error?.message || String(error) });
    }
  }
  const after = wpsConnectorWppImageTotal();
  if (after <= before) {
    wpsConnectorFail("IMAGE_INSERT_FAILED", "WPS Writer did not add the image to InlineShapes or Shapes.", { source, hostMessage: lastError?.message || "", attempts: errors });
  }
  const imageIndex = after;
  const found = wpsConnectorWppFindImage({ imageIndex });
  const applied = wpsConnectorWppApplyImageFormat(found.shape, input);
  return { host: "wpp", insertedImage: true, imageIndex, source, collectionType: found.collectionType, sourceType: found.sourceType, applied, ...wpsConnectorWppImageItem(found.shape, imageIndex, found) };
}
function wpsConnectorWppFormatImage(input = {}) {
  const { shape, imageIndex, collectionType, sourceType, collectionIndex } = wpsConnectorWppFindImage(input);
  const applied = wpsConnectorWppApplyImageFormat(shape, input);
  return { host: "wpp", formattedImage: true, imageIndex, collectionType, sourceType, applied, ...wpsConnectorWppImageItem(shape, imageIndex, { collectionType, sourceType, collectionIndex }) };
}
function wpsConnectorWppDeleteImage(input = {}) {
  const { shape, imageIndex, collectionType, sourceType } = wpsConnectorWppFindImage(input);
  try {
    if (typeof shape.Delete === "function") shape.Delete();
    else wpsConnectorFail("HOST_UNSUPPORTED", "WPS Writer image deletion is not available.");
  } catch (error) {
    if (error?.code) throw error;
    wpsConnectorFail("HOST_UNSUPPORTED", "WPS Writer failed to delete image.", { hostMessage: error.message });
  }
  return { host: "wpp", deletedImage: true, imageIndex, collectionType, sourceType, imageCount: wpsConnectorWppImageTotal() };
}
function wpsConnectorWppComments() {
  const comments = wpsConnectorApp().ActiveDocument?.Comments;
  if (!comments) wpsConnectorFail("HOST_UNSUPPORTED", "WPS Writer Comments API is not available.");
  return comments;
}
function wpsConnectorWppSelectionRangeDetails() {
  const range = wpsConnectorApp().Selection?.Range;
  if (!range) wpsConnectorFail("HOST_UNSUPPORTED", "WPS Writer selection range is not available.");
  const start = Number(wpsConnectorMember(range, "Start") || 0);
  const end = Number(wpsConnectorMember(range, "End") || start);
  const text = wpsConnectorWppNormalizeRangeText(wpsConnectorCall(range.Text));
  return { range, requestedStart: null, requestedEnd: null, resolvedStart: start, resolvedEnd: end, resolvedText: text, exactMatch: true, attempts: [{ label: "current-selection", nativeStart: start, nativeEnd: end, resolvedText: text, exactMatch: true }] };
}
function wpsConnectorWppCommentRange(input = {}) {
  const hasStart = input.start !== undefined || input.end !== undefined;
  if (!hasStart) return wpsConnectorWppSelectionRangeDetails();
  return wpsConnectorWppResolveRange(input);
}
function wpsConnectorWppResolvedFromRange(range, expectedText = "") {
  const nativeStart = Number(wpsConnectorMember(range, "Start"));
  const nativeEnd = Number(wpsConnectorMember(range, "End"));
  const resolvedText = wpsConnectorWppNormalizeRangeText(wpsConnectorCall(range.Text));
  const expected = String(expectedText || "");
  const exactMatch = expected ? resolvedText === expected : true;
  return { range, requestedStart: null, requestedEnd: null, resolvedStart: null, resolvedEnd: null, nativeStart, nativeEnd, resolvedText, exactMatch, attempts: [{ label: "native-range", nativeStart, nativeEnd, resolvedText, expectedText: expected, exactMatch }] };
}
function wpsConnectorWppCommentRangeFromNative(target) {
  const document = wpsConnectorApp().ActiveDocument;
  const range = target.range ? wpsConnectorWppRangeDuplicate(target.range) : document?.Range?.(target.nativeStart, target.nativeEnd);
  if (!range) wpsConnectorFail("RANGE_RESOLUTION_FAILED", "WPS Writer failed to create native comment range.", { target });
  const resolved = wpsConnectorWppResolvedFromRange(range, target.text);
  return { ...resolved, requestedStart: target.start, requestedEnd: target.end, resolvedStart: target.start, resolvedEnd: target.end, attempts: [{ label: "native-find-result", nativeStart: resolved.nativeStart, nativeEnd: resolved.nativeEnd, resolvedText: resolved.resolvedText, expectedText: target.text, exactMatch: resolved.exactMatch }] };
}
function wpsConnectorWppCommentText(comment) {
  return String(wpsConnectorCall(comment?.Range?.Text) || wpsConnectorCall(comment?.Text) || "").replace(/\r+$/g, "");
}
function wpsConnectorWppCommentRangeText(comment) {
  return String(wpsConnectorCall(comment?.Scope?.Text) || wpsConnectorCall(comment?.Reference?.Text) || "").replace(/\r+$/g, "");
}
function wpsConnectorWppCommentSignature(comment) {
  return [wpsConnectorMember(comment, "Author"), wpsConnectorWppCommentText(comment), wpsConnectorWppCommentRangeText(comment), wpsConnectorMember(comment, "Date")].map((v) => String(v || "")).join("\u001f");
}
function wpsConnectorWppStableCommentId(comment, index) {
  const signature = wpsConnectorWppCommentSignature(comment);
  if (!wpsConnectorCommentIdMap[signature]) wpsConnectorCommentIdMap[signature] = "comment-" + wpsConnectorHash(signature || String(index));
  return wpsConnectorCommentIdMap[signature];
}
function wpsConnectorWppCommentItem(comment, index) {
  const dateValue = wpsConnectorMember(comment, "Date");
  return {
    index,
    commentId: wpsConnectorWppStableCommentId(comment, index),
    nativeCommentId: String(wpsConnectorMember(comment, "ID") || index),
    commentIdStable: true,
    author: String(wpsConnectorMember(comment, "Author") || ""),
    text: wpsConnectorWppCommentText(comment),
    rangeText: wpsConnectorWppCommentRangeText(comment),
    createdAt: dateValue ? String(dateValue) : "",
  };
}
function wpsConnectorWppCommentSummaryItem(comment, index) {
  const nativeCommentId = String(wpsConnectorMember(comment, "ID") || index);
  return {
    index,
    commentId: nativeCommentId ? `native-${nativeCommentId}` : `index-${index}`,
    nativeCommentId,
    author: String(wpsConnectorMember(comment, "Author") || ""),
    rangeText: wpsConnectorWppCommentRangeText(comment),
  };
}
function wpsConnectorWppReadComments(input = {}) {
  const comments = wpsConnectorWppComments();
  const count = Number(wpsConnectorMember(comments, "Count") || 0);
  const summaryOnly = input.summaryOnly === true;
  const sinceCommentId = String(input.sinceCommentId || "").trim();
  const items = [];
  let include = sinceCommentId ? false : true;
  for (let i = 1; i <= count; i += 1) {
    try {
      const comment = comments.Item(i);
      const item = summaryOnly ? wpsConnectorWppCommentSummaryItem(comment, i) : wpsConnectorWppCommentItem(comment, i);
      if (sinceCommentId && !include && (item.commentId === sinceCommentId || item.nativeCommentId === sinceCommentId)) { include = true; continue; }
      if (!include) continue;
      items.push(item);
    } catch {}
  }
  return { host: "wpp", count, returnedCount: items.length, summaryOnly, sinceCommentId: sinceCommentId || undefined, comments: items };
}
function wpsConnectorWppFindComment(input = {}) {
  const comments = wpsConnectorWppComments();
  const count = Number(wpsConnectorMember(comments, "Count") || 0);
  if (input.index !== undefined) {
    const index = wpsConnectorInteger(input.index, "index", 1);
    if (index > count) wpsConnectorFail("COMMENT_NOT_FOUND", `Comment not found: ${index}`, { index, commentCount: count });
    return { comments, comment: comments.Item(index), index, count };
  }
  const id = String(input.commentId || "").trim();
  if (!id) wpsConnectorFail("INVALID_ARGUMENT", "index or commentId is required.", { fields: ["index", "commentId"] });
  for (let i = 1; i <= count; i += 1) {
    const comment = comments.Item(i);
    if (wpsConnectorWppStableCommentId(comment, i) === id || String(wpsConnectorMember(comment, "ID") || i) === id) return { comments, comment, index: i, count };
  }
  wpsConnectorFail("COMMENT_NOT_FOUND", `Comment not found: ${id}`, { commentId: id, commentCount: count });
}
function wpsConnectorWppAddCommentResolved(input = {}, resolved) {
  const text = String(input.text || "").trim();
  if (!text) wpsConnectorFail("INVALID_ARGUMENT", "comment text is required.", { field: "text" });
  if (!resolved.exactMatch && input.allowInexact !== true) wpsConnectorFail("RANGE_MAPPING_DRIFT", "Comment range does not exactly match the requested anchor.", { requestedArgs: input, resolvedText: resolved.resolvedText, fallbackAttempts: resolved.attempts });
  const comments = wpsConnectorWppComments();
  const before = Number(wpsConnectorMember(comments, "Count") || 0);
  let addedComment = null;
  try { addedComment = comments.Add(resolved.range, text); } catch (error) { wpsConnectorFail("COMMENT_INSERT_FAILED", "WPS Writer failed to add a real comment.", { hostMessage: error.message, requestedArgs: input, fallbackAttempts: resolved.attempts }); }
  if (input.author && addedComment) {
    try { addedComment.Author = String(input.author); } catch {}
  }
  const after = Number(wpsConnectorMember(comments, "Count") || 0);
  if (after <= before) wpsConnectorFail("COMMENT_INSERT_FAILED", "WPS Writer did not increase the Comments count after insertion.", { before, after, requestedArgs: input, fallbackAttempts: resolved.attempts });
  let item = null;
  for (let i = after; i >= 1; i -= 1) {
    try {
      const candidate = wpsConnectorWppCommentItem(comments.Item(i), i);
      if (candidate.text === text && (!resolved.resolvedText || candidate.rangeText === resolved.resolvedText || resolved.resolvedText.includes(candidate.rangeText) || candidate.rangeText.includes(resolved.resolvedText))) { item = candidate; break; }
    } catch {}
  }
  if (!item && addedComment) {
    try { item = wpsConnectorWppCommentItem(addedComment, after); } catch {}
  }
  if (!item) wpsConnectorFail("COMMENT_INSERTED_BUT_UNVERIFIED", "Comment count increased but the inserted comment could not be verified.", { before, after, text, rangeText: resolved.resolvedText, requestedArgs: input, fallbackAttempts: resolved.attempts });
  if (input.verify !== false && resolved.resolvedText && item.rangeText !== resolved.resolvedText) wpsConnectorFail("COMMENT_INSERTED_BUT_UNVERIFIED", "Inserted comment range did not match the requested anchor.", { before, after, text, expectedRangeText: resolved.resolvedText, actualRangeText: item.rangeText, requestedArgs: input, fallbackAttempts: resolved.attempts });
  return { host: "wpp", added: true, commentIndex: item.index, commentId: item.commentId, nativeCommentId: item.nativeCommentId, commentIdStable: item.commentIdStable, text: item.text || text, rangeText: item.rangeText, author: item.author, requestedStart: resolved.requestedStart, requestedEnd: resolved.requestedEnd, resolvedStart: resolved.resolvedStart, resolvedEnd: resolved.resolvedEnd, resolvedText: resolved.resolvedText, exactMatch: resolved.exactMatch, attempts: resolved.attempts };
}
function wpsConnectorWppAddComment(input = {}) {
  if (input.start === undefined && input.end === undefined) wpsConnectorApplyOperationScope(input);
  const resolved = wpsConnectorWppCommentRange(input);
  return wpsConnectorWppAddCommentResolved(input, resolved);
}
function wpsConnectorWppAddCommentByText(input = {}) {
  const query = String(input.query || "").trim();
  if (!query) wpsConnectorFail("INVALID_ARGUMENT", "query is required.", { field: "query" });
  const targets = wpsConnectorWppTextTargets({ ...input, maxResults: input.maxResults || 1000 }).targets;
  if (targets.length !== 1) wpsConnectorFail("AMBIGUOUS_MATCH", "add_comment_by_text requires exactly one target occurrence.", { query, count: targets.length, occurrence: input.occurrence });
  const resolved = wpsConnectorWppCommentRangeFromNative(targets[0]);
  return { ...wpsConnectorWppAddCommentResolved({ ...input, start: targets[0].start, end: targets[0].end }, resolved), query, occurrence: input.occurrence ?? "first" };
}
function wpsConnectorWppAddCommentsBatch(input = {}) {
  const items = Array.isArray(input.items) ? input.items : [];
  if (!items.length) wpsConnectorFail("INVALID_ARGUMENT", "items must be a non-empty array.", { field: "items" });
  const verify = input.verify !== false;
  const resolvedItems = items.map((item, index) => {
    const query = String(item.query || "").trim();
    if (!query) wpsConnectorFail("INVALID_ARGUMENT", "item.query is required.", { index, field: "query" });
    const targets = wpsConnectorWppTextTargets({ ...item, maxResults: item.maxResults || 1000 }).targets;
    if (targets.length !== 1) wpsConnectorFail("AMBIGUOUS_MATCH", "Batch comment item requires exactly one target occurrence.", { index, query, count: targets.length, occurrence: item.occurrence });
    return { index, input: item, target: targets[0] };
  });
  const ordered = String(input.mode || "reverse-order") === "forward-order" ? resolvedItems : [...resolvedItems].sort((a, b) => Number(b.target.nativeStart ?? b.target.start ?? 0) - Number(a.target.nativeStart ?? a.target.start ?? 0));
  const results = [];
  const started = Date.now();
  for (const item of ordered) {
    try {
      const resolved = wpsConnectorWppCommentRangeFromNative(item.target);
      const result = wpsConnectorWppAddCommentResolved({ ...item.input, text: item.input.text, author: item.input.author, start: item.target.start, end: item.target.end, verify }, resolved);
      results.push({ itemIndex: item.index, ok: true, query: item.input.query, commentId: result.commentId, commentIndex: result.commentIndex, rangeText: result.rangeText, exactMatch: result.exactMatch });
    } catch (error) {
      results.push({ itemIndex: item.index, ok: false, query: item.input.query, expected: item.target.text, actual: error.details?.actualRangeText || error.details?.resolvedText || "", error: { code: error.code || "COMMENT_INSERT_FAILED", message: error.message, details: error.details || {} } });
      if (input.continueOnError !== true) break;
    }
  }
  results.sort((a, b) => a.itemIndex - b.itemIndex);
  const failed = results.filter((item) => !item.ok);
  if (failed.length) wpsConnectorFail("COMMENT_BATCH_FAILED", "One or more batch comments failed.", { failed, results, elapsedMs: Date.now() - started });
  return { host: "wpp", added: true, addedCount: results.length, requestedCount: items.length, mode: input.mode || "reverse-order", verify, elapsedMs: Date.now() - started, results };
}
function wpsConnectorWppDeleteComment(input = {}) {
  const found = wpsConnectorWppFindComment(input);
  try {
    if (typeof found.comment.Delete === "function") found.comment.Delete();
    else wpsConnectorFail("HOST_UNSUPPORTED", "WPS Writer comment deletion is not available.");
  } catch (error) {
    if (error?.code) throw error;
    wpsConnectorFail("HOST_UNSUPPORTED", "WPS Writer failed to delete comment.", { hostMessage: error.message });
  }
  return { host: "wpp", deleted: true, commentIndex: found.index, commentId: wpsConnectorWppStableCommentId(found.comment, found.index), nativeCommentId: String(wpsConnectorMember(found.comment, "ID") || found.index) };
}
function wpsConnectorWppRevisionCollection() {
  const document = wpsConnectorApp().ActiveDocument;
  if (!document) wpsConnectorFail("HOST_UNSUPPORTED", "WPS Writer active document is not available.");
  const revisions = document.Revisions;
  if (!revisions) wpsConnectorFail("TRACK_CHANGES_UNSUPPORTED", "WPS Writer Revisions API is not available.", { capability: "Revisions" });
  return { document, revisions };
}
function wpsConnectorWppSetTrackChanges(input = {}) {
  const document = wpsConnectorApp().ActiveDocument;
  if (!document) wpsConnectorFail("HOST_UNSUPPORTED", "WPS Writer active document is not available.");
  if (typeof input.enabled !== "boolean") wpsConnectorFail("INVALID_ARGUMENT", "enabled must be boolean.", { field: "enabled", value: input.enabled });
  try { document.TrackRevisions = input.enabled ? true : false; }
  catch (error) { wpsConnectorFail("TRACK_CHANGES_UNSUPPORTED", "WPS Writer TrackRevisions API is not available.", { hostMessage: error.message, requestedArgs: input }); }
  let enabled = input.enabled;
  try { enabled = Boolean(wpsConnectorMember(document, "TrackRevisions")); } catch {}
  return { host: "wpp", enabled };
}
function wpsConnectorWppRevisionItem(revision, index) {
  const dateValue = wpsConnectorMember(revision, "Date");
  return { index, revisionId: String(wpsConnectorMember(revision, "ID") || index), type: String(wpsConnectorMember(revision, "Type") || ""), author: String(wpsConnectorMember(revision, "Author") || ""), rangeText: wpsConnectorWppNormalizeRangeText(wpsConnectorCall(revision?.Range?.Text)), createdAt: dateValue ? String(dateValue) : "" };
}
function wpsConnectorWppReadRevisions() {
  const { revisions } = wpsConnectorWppRevisionCollection();
  const count = Number(wpsConnectorMember(revisions, "Count") || 0);
  const items = [];
  for (let i = 1; i <= count; i += 1) { try { items.push(wpsConnectorWppRevisionItem(revisions.Item(i), i)); } catch {} }
  return { host: "wpp", count, revisions: items };
}
function wpsConnectorWppRevision(input = {}) {
  const { revisions } = wpsConnectorWppRevisionCollection();
  const count = Number(wpsConnectorMember(revisions, "Count") || 0);
  const index = wpsConnectorInteger(input.index, "index", 1);
  if (index > count) wpsConnectorFail("REVISION_NOT_FOUND", "Revision not found: " + index, { index, revisionCount: count });
  return { revisions, revision: revisions.Item(index), index, count };
}
function wpsConnectorWppAcceptRevision(input = {}) {
  const found = wpsConnectorWppRevision(input);
  try { if (typeof found.revision.Accept === "function") found.revision.Accept(); else wpsConnectorFail("TRACK_CHANGES_UNSUPPORTED", "Revision.Accept is not available."); }
  catch (error) { if (error?.code) throw error; wpsConnectorFail("TRACK_CHANGES_UNSUPPORTED", "WPS Writer failed to accept revision.", { hostMessage: error.message, requestedArgs: input }); }
  return { host: "wpp", accepted: true, index: found.index };
}
function wpsConnectorWppRejectRevision(input = {}) {
  const found = wpsConnectorWppRevision(input);
  try { if (typeof found.revision.Reject === "function") found.revision.Reject(); else wpsConnectorFail("TRACK_CHANGES_UNSUPPORTED", "Revision.Reject is not available."); }
  catch (error) { if (error?.code) throw error; wpsConnectorFail("TRACK_CHANGES_UNSUPPORTED", "WPS Writer failed to reject revision.", { hostMessage: error.message, requestedArgs: input }); }
  return { host: "wpp", rejected: true, index: found.index };
}
function wpsConnectorWppAcceptAllRevisions() {
  const { document, revisions } = wpsConnectorWppRevisionCollection();
  const before = Number(wpsConnectorMember(revisions, "Count") || 0);
  try { if (typeof document.AcceptAllRevisions === "function") document.AcceptAllRevisions(); else if (typeof revisions.AcceptAll === "function") revisions.AcceptAll(); else wpsConnectorFail("TRACK_CHANGES_UNSUPPORTED", "Accept all revisions API is not available."); }
  catch (error) { if (error?.code) throw error; wpsConnectorFail("TRACK_CHANGES_UNSUPPORTED", "WPS Writer failed to accept all revisions.", { hostMessage: error.message }); }
  return { host: "wpp", acceptedAll: true, before };
}
function wpsConnectorWppRejectAllRevisions() {
  const { document, revisions } = wpsConnectorWppRevisionCollection();
  const before = Number(wpsConnectorMember(revisions, "Count") || 0);
  try { if (typeof document.RejectAllRevisions === "function") document.RejectAllRevisions(); else if (typeof revisions.RejectAll === "function") revisions.RejectAll(); else wpsConnectorFail("TRACK_CHANGES_UNSUPPORTED", "Reject all revisions API is not available."); }
  catch (error) { if (error?.code) throw error; wpsConnectorFail("TRACK_CHANGES_UNSUPPORTED", "WPS Writer failed to reject all revisions.", { hostMessage: error.message }); }
  return { host: "wpp", rejectedAll: true, before };
}

function wpsConnectorWppInsertTable(input = {}) {
  wpsConnectorApplyOperationScope(input);
  const app = wpsConnectorApp();
  const selection = app.Selection;
  const rows = wpsConnectorInteger(input.rowCount, "rowCount", 1);
  const cols = wpsConnectorInteger(input.columnCount, "columnCount", 1);
  let table = null;
  if (app.ActiveDocument?.Tables?.Add) table = app.ActiveDocument.Tables.Add(selection.Range, rows, cols);
  const values = input.values !== undefined ? wpsConnectorRequireMatrix(input.values, "values") : null;
  if (table && values) {
    for (let r = 1; r <= rows; r += 1) for (let c = 1; c <= cols; c += 1) {
      const cell = table.Cell(r, c);
      const text = String(values?.[r - 1]?.[c - 1] ?? "");
      try { cell.Range.Text = text; } catch {}
    }
    if (input.headerRowBold) {
      try { table.Rows.Item(1).Range.Font.Bold = -1; } catch {}
    }
    const align = wpsConnectorWppAlignment(input.alignment);
    if (align !== undefined) {
      try { table.Range.ParagraphFormat.Alignment = align; } catch {}
    }
    if (input.border !== false) {
      try { table.Borders.Enable = 1; } catch {}
    }
  } else if (values) {
    const text = values.map((row) => row.join("\t")).join("\n");
    if (typeof selection.TypeText === "function") selection.TypeText(text);
    else selection.Text = text;
  }
  const tables = app.ActiveDocument?.Tables;
  const tableIndex = Number(wpsConnectorMember(tables, "Count") || 0) || undefined;
  return { host: "wpp", insertedTable: true, tableIndex, rowCount: rows, columnCount: cols, headerRowBold: Boolean(input.headerRowBold), border: input.border !== false, alignment: input.alignment || "" };
}

function wpsConnectorSetSelectionFont(options = {}) {
  const selection = wpsConnectorApp().Selection;
  const font = selection?.Font;
  if (!font) return;
  if (options.name) font.Name = options.name;
  if (options.size) font.Size = options.size;
  if (typeof options.bold === "boolean") font.Bold = options.bold ? -1 : 0;
  if (typeof options.italic === "boolean") font.Italic = options.italic ? -1 : 0;
}
function wpsConnectorSetParagraph(options = {}) {
  const selection = wpsConnectorApp().Selection;
  const pf = selection?.ParagraphFormat;
  if (!pf) return;
  if (options.alignment !== undefined) pf.Alignment = options.alignment;
  if (options.spaceBefore !== undefined) pf.SpaceBefore = options.spaceBefore;
  if (options.spaceAfter !== undefined) pf.SpaceAfter = options.spaceAfter;
  if (options.lineSpacing !== undefined) pf.LineSpacing = options.lineSpacing;
}
function wpsConnectorTypeFormattedText(text, font, paragraph) {
  const selection = wpsConnectorApp().Selection;
  wpsConnectorSetSelectionFont(font);
  wpsConnectorSetParagraph(paragraph);
  if (typeof selection.TypeText === "function") selection.TypeText(text);
  else selection.Text = text;
}

function wpsConnectorWppSaveDocument() {
  const app = wpsConnectorApp();
  const document = app.ActiveDocument;
  if (!document) wpsConnectorFail("HOST_UNSUPPORTED", "WPS Writer active document is not available.");
  const identity = wpsConnectorDocumentIdentity(app, "wpp");
  try {
    if (typeof document.Save === "function") document.Save();
    else wpsConnectorFail("HOST_UNSUPPORTED", "WPS Writer document Save API is not available.");
  } catch (error) {
    if (error?.code) throw error;
    wpsConnectorFail("SAVE_FAILED", "WPS Writer failed to save the active document.", { hostMessage: error.message, documentIdentity: identity });
  }
  return { host: "wpp", saved: true, path: identity.fullPath || identity.path || identity.name || "", savedAt: new Date().toISOString(), documentIdentity: identity };
}

function wpsConnectorWppInsertNewsArticle(input) {
  wpsConnectorApplyOperationScope(input);
  const title = String(input.title || "").trim();
  const subtitle = String(input.subtitle || "").trim();
  const body = String(input.body || "").trim();
  const sourceNote = String(input.sourceNote || "").trim();
  const normalFont = { name: "宋体", size: 12, bold: false, italic: false };
  const normalPara = { alignment: 0, spaceBefore: 0, spaceAfter: 6, lineSpacing: 18 };
  wpsConnectorTypeFormattedText(`${title}
`, { name: "黑体", size: 20, bold: true }, { alignment: 1, spaceBefore: 0, spaceAfter: 8, lineSpacing: 24 });
  if (subtitle) wpsConnectorTypeFormattedText(`${subtitle}
`, { name: "楷体", size: 12, bold: false }, { alignment: 1, spaceBefore: 0, spaceAfter: 10, lineSpacing: 18 });
  for (const paragraph of body.split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean)) {
    const isSection = /^看点[一二三四五六七八九十]|^评论/.test(paragraph);
    wpsConnectorTypeFormattedText(`${paragraph}
`, isSection ? { name: "黑体", size: 13, bold: true } : normalFont, normalPara);
  }
  if (sourceNote) wpsConnectorTypeFormattedText(`
${sourceNote}
`, { name: "宋体", size: 10, italic: true }, { alignment: 0, spaceBefore: 4, spaceAfter: 0, lineSpacing: 15 });
  return { host: "wpp", inserted: true, titleLength: title.length, bodyLength: body.length };
}

function wpsConnectorWppInsertText(input) {
  wpsConnectorApplyOperationScope(input);
  const app = wpsConnectorApp();
  const selection = app.Selection;
  if (typeof selection.TypeText === "function") selection.TypeText(input.text);
  else selection.Text = input.text;
  return { host: "wpp", insertedLength: String(input.text || "").length };
}
function wpsConnectorGetUrlPath() {
  let value = document.location.toString();
  value = decodeURI(value);
  if (value.includes("/")) value = value.substring(0, value.lastIndexOf("/"));
  return value;
}
function OnAddinLoad(ribbonUI) {
  try {
    const app = wpsConnectorApp();
    if (typeof app.ribbonUI !== "object") app.ribbonUI = ribbonUI;
    setTimeout(() => wpsConnectorStart().catch(console.error), 0);
  } catch (error) {
    console.error(error);
  }
  return true;
}
function wpsConnectorOpenPane() {
  const app = wpsConnectorApp();
  const docKey = encodeURIComponent(`${wpsConnectorCurrentDocumentKey || wpsConnectorScope().documentKey}`);
  const key = `wps_connector_taskpane_id_${docKey}`;
  const taskpaneUrl = `${wpsConnectorGetUrlPath()}/index.html?doc=${docKey}&t=${Date.now()}`;
  let taskpaneId = null;
  try { taskpaneId = app.PluginStorage && app.PluginStorage.getItem(key); } catch {}
  if (!taskpaneId) {
    const taskpane = app.CreateTaskPane(taskpaneUrl);
    if (app.PluginStorage) app.PluginStorage.setItem(key, taskpane.ID);
    taskpane.Visible = true;
    return { opened: true, taskpaneId: taskpane.ID, url: taskpaneUrl };
  }
  const taskpane = app.GetTaskPane(taskpaneId);
  try { taskpane.Url = taskpaneUrl; } catch {}
  taskpane.Visible = true;
  return { opened: true, taskpaneId, url: taskpaneUrl };
}
function OnAction(control) {
  const id = control && (control.Id || control.id);
  if (id === "btnShowConnectorPane" || id === "wpsConnectorPaneButton") wpsConnectorOpenPane();
  wpsConnectorStart().catch(console.error);
  return true;
}
function OnGetEnabled() { return true; }
function OnGetVisible() { return true; }
function GetImage(control) {
  const id = control && (control.Id || control.id);
  if (id === "btnShowConnectorPane" || id === "wpsConnectorPaneButton") return "images/connector.svg";
  return "images/connector.svg";
}
async function wpsConnectorExecute(command) {
  if (command.toolName === "et.read_selection") return wpsConnectorEtSelection(command.input || {});
  if (command.toolName === "et.list_worksheets") return wpsConnectorEtListWorksheets(command.input || {});
  if (command.toolName === "et.add_worksheet") return wpsConnectorEtAddWorksheet(command.input || {});
  if (command.toolName === "et.rename_worksheet") return wpsConnectorEtRenameWorksheet(command.input || {});
  if (command.toolName === "et.delete_worksheet") return wpsConnectorEtDeleteWorksheet(command.input || {});
  if (command.toolName === "et.read_range") return wpsConnectorEtReadRange(command.input || {});
  if (command.toolName === "et.write_range") return wpsConnectorEtWriteRange(command.input || {});
  if (command.toolName === "et.format_range") return wpsConnectorEtFormatRange(command.input || {});
  if (command.toolName === "et.clear_range") return wpsConnectorEtClearRange(command.input || {});
  if (command.toolName === "et.insert_range") return wpsConnectorEtInsertRange(command.input || {});
  if (command.toolName === "et.delete_range") return wpsConnectorEtDeleteRange(command.input || {});
  if (command.toolName === "et.find_cells") return wpsConnectorEtFindCells(command.input || {});
  if (command.toolName === "et.write_blocks") return wpsConnectorEtWriteBlocks(command.input || {});
  if (command.toolName === "wpp.read_selection") return wpsConnectorWppSelection(command.input || {});
  if (command.toolName === "wpp.read_document_identity") return wpsConnectorWppDocumentIdentity(command.input || {});
  if (command.toolName === "wpp.read_document_text") return wpsConnectorWppReadDocumentText(command.input || {});
  if (command.toolName === "wpp.select_range") return wpsConnectorWppSelectRange(command.input || {});
  if (command.toolName === "wpp.select_paragraph") return wpsConnectorWppSelectParagraph(command.input || {});
  if (command.toolName === "wpp.select_current_paragraph") return wpsConnectorWppSelectCurrentParagraph(command.input || {});
  if (command.toolName === "wpp.get_selection_range") return wpsConnectorWppGetSelectionRange(command.input || {});
  if (command.toolName === "wpp.list_paragraphs") return wpsConnectorWppListParagraphs(command.input || {});
  if (command.toolName === "wpp.get_paragraph_range") return wpsConnectorWppGetParagraphRange(command.input || {});
  if (command.toolName === "wpp.find_block") return wpsConnectorWppFindBlock(command.input || {});
  if (command.toolName === "wpp.find_text") return wpsConnectorWppFindText(command.input || {});
  if (command.toolName === "wpp.replace_text") return wpsConnectorWppReplaceText(command.input || {});
  if (command.toolName === "wpp.replace_paragraph") return wpsConnectorWppReplaceParagraph(command.input || {});
  if (command.toolName === "wpp.replace_current_paragraph") return wpsConnectorWppReplaceCurrentParagraph(command.input || {});
  if (command.toolName === "wpp.replace_block") return wpsConnectorWppReplaceBlock(command.input || {});
  if (command.toolName === "wpp.insert_after_paragraph") return wpsConnectorWppInsertTextAtParagraph(command.input || {}, "after");
  if (command.toolName === "wpp.insert_before_paragraph") return wpsConnectorWppInsertTextAtParagraph(command.input || {}, "before");
  if (command.toolName === "wpp.insert_table_after_paragraph") return wpsConnectorWppInsertTableAtParagraph(command.input || {}, "after");
  if (command.toolName === "wpp.insert_table_before_paragraph") return wpsConnectorWppInsertTableAtParagraph(command.input || {}, "before");
  if (command.toolName === "wpp.read_format") return wpsConnectorWppReadFormat(command.input || {});
  if (command.toolName === "wpp.read_text_format") return wpsConnectorWppReadTextFormat(command.input || {});
  if (command.toolName === "wpp.apply_text_format") return wpsConnectorWppApplyTextFormat(command.input || {});
  if (command.toolName === "wpp.read_paragraph_format") return wpsConnectorWppReadParagraphFormat(command.input || {});
  if (command.toolName === "wpp.apply_paragraph_format_by_indexes") return wpsConnectorWppApplyParagraphFormatByIndexes(command.input || {});
  if (command.toolName === "wpp.copy_paragraph_format") return wpsConnectorWppCopyParagraphFormat(command.input || {});
  if (command.toolName === "wpp.copy_selected_paragraph_format_to_indexes") return wpsConnectorWppCopySelectedParagraphFormatToIndexes(command.input || {});
  if (command.toolName === "wpp.compare_paragraph_format") return wpsConnectorWppCompareParagraphFormat(command.input || {});
  if (command.toolName === "wpp.read_table") return wpsConnectorWppReadTable(command.input || {});
  if (command.toolName === "wpp.read_table_cell") return wpsConnectorWppReadTableCell(command.input || {});
  if (command.toolName === "wpp.write_table_cell") return wpsConnectorWppWriteTableCell(command.input || {});
  if (command.toolName === "wpp.insert_table_rows") return wpsConnectorWppInsertTableRows(command.input || {});
  if (command.toolName === "wpp.delete_table_rows") return wpsConnectorWppDeleteTableRows(command.input || {});
  if (command.toolName === "wpp.insert_table_columns") return wpsConnectorWppInsertTableColumns(command.input || {});
  if (command.toolName === "wpp.delete_table_columns") return wpsConnectorWppDeleteTableColumns(command.input || {});
  if (command.toolName === "wpp.merge_table_cells") return wpsConnectorWppMergeTableCells(command.input || {});
  if (command.toolName === "wpp.format_table") return wpsConnectorWppFormatTable(command.input || {});
  if (command.toolName === "wpp.read_table_format") return wpsConnectorWppReadTableFormat(command.input || {});
  if (command.toolName === "wpp.apply_table_format") return wpsConnectorWppApplyTableFormat(command.input || {});
  if (command.toolName === "wpp.copy_table_style") return wpsConnectorWppCopyTableStyle(command.input || {});
  if (command.toolName === "wpp.duplicate_table_appearance") return wpsConnectorWppDuplicateTableAppearance(command.input || {});
  if (command.toolName === "wpp.read_cell_format") return wpsConnectorWppReadCellFormat(command.input || {});
  if (command.toolName === "wpp.apply_cell_format") return wpsConnectorWppApplyCellFormat(command.input || {});
  if (command.toolName === "wpp.read_row_heights") return wpsConnectorWppReadRowHeights(command.input || {});
  if (command.toolName === "wpp.set_row_heights") return wpsConnectorWppSetRowHeights(command.input || {});
  if (command.toolName === "wpp.read_column_widths") return wpsConnectorWppReadColumnWidths(command.input || {});
  if (command.toolName === "wpp.set_column_widths") return wpsConnectorWppSetColumnWidths(command.input || {});
  if (command.toolName === "wpp.read_merged_cells") return wpsConnectorWppReadMergedCells(command.input || {});
  if (command.toolName === "wpp.apply_merged_cells") return wpsConnectorWppApplyMergedCells(command.input || {});
  if (command.toolName === "wpp.insert_image") return wpsConnectorWppInsertImage(command.input || {});
  if (command.toolName === "wpp.read_images") return wpsConnectorWppReadImages(command.input || {});
  if (command.toolName === "wpp.format_image") return wpsConnectorWppFormatImage(command.input || {});
  if (command.toolName === "wpp.delete_image") return wpsConnectorWppDeleteImage(command.input || {});
  if (command.toolName === "wpp.add_comment") return wpsConnectorWppAddComment(command.input || {});
  if (command.toolName === "wpp.add_comment_by_text") return wpsConnectorWppAddCommentByText(command.input || {});
  if (command.toolName === "wpp.add_comments_batch") return wpsConnectorWppAddCommentsBatch(command.input || {});
  if (command.toolName === "wpp.read_comments") return wpsConnectorWppReadComments(command.input || {});
  if (command.toolName === "wpp.delete_comment") return wpsConnectorWppDeleteComment(command.input || {});
  if (command.toolName === "wpp.set_track_changes") return wpsConnectorWppSetTrackChanges(command.input || {});
  if (command.toolName === "wpp.read_revisions") return wpsConnectorWppReadRevisions(command.input || {});
  if (command.toolName === "wpp.accept_revision") return wpsConnectorWppAcceptRevision(command.input || {});
  if (command.toolName === "wpp.reject_revision") return wpsConnectorWppRejectRevision(command.input || {});
  if (command.toolName === "wpp.accept_all_revisions") return wpsConnectorWppAcceptAllRevisions(command.input || {});
  if (command.toolName === "wpp.reject_all_revisions") return wpsConnectorWppRejectAllRevisions(command.input || {});
  if (command.toolName === "wpp.list_styles") return wpsConnectorWppListStyles(command.input || {});
  if (command.toolName === "wpp.apply_style") return wpsConnectorWppApplyStyle(command.input || {});
  if (command.toolName === "wpp.insert_page_break") return wpsConnectorWppInsertPageBreak(command.input || {});
  if (command.toolName === "wpp.insert_paragraph_break") return wpsConnectorWppInsertParagraphBreak(command.input || {});
  if (command.toolName === "wpp.delete_extra_blank_paragraphs") return wpsConnectorWppDeleteExtraBlankParagraphs(command.input || {});
  if (command.toolName === "wpp.save_document") return wpsConnectorWppSaveDocument(command.input || {});
  if (command.toolName === "wpp.insert_text") return wpsConnectorWppInsertText(command.input || {});
  if (command.toolName === "wpp.insert_news_article") return wpsConnectorWppInsertNewsArticle(command.input || {});
  if (command.toolName === "wpp.format_selection") return wpsConnectorWppFormatSelection(command.input || {});
  if (command.toolName === "wpp.set_paragraph") return wpsConnectorWppSetParagraph(command.input || {});
  if (command.toolName === "wpp.insert_table") return wpsConnectorWppInsertTable(command.input || {});
  if (command.toolName === "wps.open_pane") return wpsConnectorOpenPane(command.input || {});
  throw new Error(`Unsupported command: ${command.toolName}`);
}
async function wpsConnectorPollOnce() {
  await wpsConnectorEnsureSession();
  const json = await wpsConnectorRequest(`/api/sessions/${wpsConnectorSessionId}/commands/next`);
  if (!json.command) return;
  try {
    const result = await wpsConnectorExecute(json.command);
    await wpsConnectorRequest(`/api/commands/${json.command.commandId}/result`, { method: "POST", body: JSON.stringify({ ok: true, result }) });
  } catch (error) {
    const details = wpsConnectorErrorDetails(error, json.command.toolName);
    details.details = { ...(details.details || {}), sessionId: wpsConnectorSessionId, toolName: json.command.toolName, requestedArgs: json.command.input || {}, hostMessage: details.details?.hostMessage || error?.message || String(error) };
    await wpsConnectorRequest(`/api/commands/${json.command.commandId}/result`, { method: "POST", body: JSON.stringify({ ok: false, error: details }) });
  }
}
async function wpsConnectorHeartbeat() {
  const { app, host, documentIdentity, documentKey } = wpsConnectorScope();
  if (wpsConnectorSessionId !== `wps-${host}-${wpsConnectorHash(documentKey)}` || wpsConnectorCurrentDocumentKey !== documentKey) {
    await wpsConnectorRegister();
  }
  const json = await wpsConnectorRequest(`/api/sessions/${wpsConnectorSessionId}/heartbeat`, {
    method: "POST",
    body: JSON.stringify({ activeContext: wpsConnectorActiveContext(app, host), documentIdentity, documentName: documentIdentity.name, documentKey, clientVersion: WPS_CONNECTOR_CLIENT_VERSION, clientBuild: WPS_CONNECTOR_CLIENT_BUILD }),
  });
  wpsConnectorSessionInfo = {
    ...(window.wpsConnectorSessionInfo || wpsConnectorSessionInfo),
    host: json.session?.host || host,
    documentName: json.session?.documentName || documentIdentity.name,
    documentKey: json.session?.documentKey || documentKey,
    clientVersion: json.session?.clientVersion || WPS_CONNECTOR_CLIENT_VERSION,
    clientBuild: json.session?.clientBuild || WPS_CONNECTOR_CLIENT_BUILD,
  };
  if (typeof window !== "undefined") {
    window.wpsConnectorSessionInfo = wpsConnectorSessionInfo;
    window.dispatchEvent?.(new CustomEvent("wpsConnectorStateChanged"));
  }
}
async function wpsConnectorStart() {
  if (wpsConnectorStarted) return;
  await wpsConnectorRegister();
  wpsConnectorStarted = true;
  setInterval(() => wpsConnectorPollOnce().catch(console.error), 1000);
  setInterval(() => wpsConnectorHeartbeat().catch(console.error), 1000);
}
if (typeof window !== "undefined") {
  window.wpsConnectorStart = wpsConnectorStart;
  window.wpsConnectorOpenPane = wpsConnectorOpenPane;
  window.OnAction = OnAction;
  window.OnAddinLoad = OnAddinLoad;
  window.OnGetEnabled = OnGetEnabled;
  window.OnGetVisible = OnGetVisible;
  window.GetImage = GetImage;
  window.OnGetImage = GetImage;
}
wpsConnectorStart().catch(console.error);
