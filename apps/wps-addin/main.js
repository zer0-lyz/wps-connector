const WPS_CONNECTOR_DEFAULT_BRIDGE = "http://127.0.0.1:40215";
const WPS_CONNECTOR_CLIENT_VERSION = "1.0.21";
const WPS_CONNECTOR_CLIENT_BUILD = "2026.06.30-writer-layout-tools.1";
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
  const capabilities = host === "et" ? ["et.read_selection", "et.list_worksheets", "et.add_worksheet", "et.rename_worksheet", "et.delete_worksheet", "et.read_range", "et.write_range", "et.format_range", "et.clear_range", "et.insert_range", "et.delete_range", "et.find_cells", "et.write_blocks"] : host === "wpp" ? ["wpp.read_selection", "wpp.read_document_identity", "wpp.read_document_text", "wpp.select_range", "wpp.select_paragraph", "wpp.select_current_paragraph", "wpp.get_selection_range", "wpp.find_text", "wpp.replace_text", "wpp.read_format", "wpp.read_text_format", "wpp.apply_text_format", "wpp.read_paragraph_format", "wpp.read_table", "wpp.read_table_cell", "wpp.write_table_cell", "wpp.insert_table_rows", "wpp.delete_table_rows", "wpp.insert_table_columns", "wpp.delete_table_columns", "wpp.merge_table_cells", "wpp.format_table", "wpp.read_table_format", "wpp.apply_table_format", "wpp.copy_table_style", "wpp.duplicate_table_appearance", "wpp.read_cell_format", "wpp.apply_cell_format", "wpp.read_row_heights", "wpp.set_row_heights", "wpp.read_column_widths", "wpp.set_column_widths", "wpp.read_merged_cells", "wpp.apply_merged_cells", "wpp.insert_image", "wpp.read_images", "wpp.format_image", "wpp.delete_image", "wpp.add_comment", "wpp.read_comments", "wpp.delete_comment", "wpp.set_track_changes", "wpp.read_revisions", "wpp.accept_revision", "wpp.reject_revision", "wpp.accept_all_revisions", "wpp.reject_all_revisions", "wpp.list_styles", "wpp.apply_style", "wpp.insert_page_break", "wpp.insert_paragraph_break", "wpp.delete_extra_blank_paragraphs", "wpp.save_document", "wpp.insert_text", "wpp.insert_news_article", "wpp.format_selection", "wpp.set_paragraph", "wpp.insert_table", "wps.open_pane"] : [];
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
  return { start, end, normalizedStart: start, normalizedEnd: end, nativeStart: Number.isFinite(nativeStart) ? nativeStart : null, nativeEnd: Number.isFinite(nativeEnd) ? nativeEnd : null, text, length: text.length };
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
  const range = wpsConnectorWppOptionalRange(input);
  const pf = wpsConnectorSafeGet(range, "ParagraphFormat");
  return { host: "wpp", affectedRange: wpsConnectorWppRangeDetails(range), effectiveFormat: { alignment: wpsConnectorSafeGet(pf, "Alignment"), lineSpacing: wpsConnectorSafeGet(pf, "LineSpacing"), spaceBefore: wpsConnectorSafeGet(pf, "SpaceBefore"), spaceAfter: wpsConnectorSafeGet(pf, "SpaceAfter"), firstLineIndent: wpsConnectorSafeGet(pf, "FirstLineIndent"), leftIndent: wpsConnectorSafeGet(pf, "LeftIndent"), rightIndent: wpsConnectorSafeGet(pf, "RightIndent"), keepWithNext: wpsConnectorBoolFormat(wpsConnectorSafeGet(pf, "KeepWithNext")), pageBreakBefore: wpsConnectorBoolFormat(wpsConnectorSafeGet(pf, "PageBreakBefore")) } };
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
  const range = wpsConnectorWppOptionalRange(input);
  const format = { ...(input.format || {}) };
  for (const key of ["alignment", "spaceBefore", "spaceAfter", "lineSpacing", "firstLineIndent", "leftIndent", "rightIndent", "keepWithNext", "pageBreakBefore"]) if (input[key] !== undefined) format[key] = input[key];
  const result = wpsConnectorWppApplyParagraphFormatToRange(range, format);
  const readback = wpsConnectorWppReadParagraphFormat(input);
  return { host: "wpp", paragraphFormatted: result.accepted.length > 0, applied: result.accepted.length > 0, affectedRange: readback.affectedRange, effectiveFormat: readback.effectiveFormat, hostAcceptedFields: result.accepted, hostRejectedFields: result.rejected };
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
function wpsConnectorWppReplacementTargets(input = {}) {
  const findText = String(input.findText || "");
  if (!findText) wpsConnectorFail("INVALID_ARGUMENT", "findText is required.", { field: "findText" });
  const found = wpsConnectorWppFindText({ query: findText, matchCase: input.matchCase, matchWholeWord: input.matchWholeWord, maxResults: 1000 });
  if (!found.results.length) wpsConnectorFail("TEXT_NOT_FOUND", "Text not found: " + findText, { findText });
  const occurrence = input.occurrence === undefined ? "first" : input.occurrence;
  if (occurrence === "all") return found.results;
  if (occurrence === "last") return [found.results[found.results.length - 1]];
  if (occurrence === "first") return [found.results[0]];
  const wanted = occurrence === "index" ? wpsConnectorInteger(input.index, "index", 1) : wpsConnectorInteger(occurrence, "occurrence", 1);
  if (wanted > found.results.length) wpsConnectorFail("TEXT_NOT_FOUND", "Text occurrence not found: " + wanted, { findText, occurrence: wanted, count: found.results.length });
  return [found.results[wanted - 1]];
}
function wpsConnectorWppReplaceText(input = {}) {
  const replaceText = String(input.replaceText ?? "");
  const targets = wpsConnectorWppReplacementTargets(input);
  const replacements = [];
  for (const target of [...targets].sort((a, b) => b.start - a.start)) {
    const resolved = wpsConnectorWppResolveRange({ start: target.start, end: target.end });
    if (!resolved.exactMatch) wpsConnectorFail("RANGE_MAPPING_DRIFT", "Resolved range does not match target text.", { target, resolvedText: resolved.resolvedText, attempts: resolved.attempts });
    const before = resolved.resolvedText;
    try { resolved.range.Text = replaceText; } catch (error) { wpsConnectorFail("HOST_UNSUPPORTED", "WPS Writer text replacement is not available.", { hostMessage: error.message, target }); }
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
function wpsConnectorWppReadComments() {
  const comments = wpsConnectorWppComments();
  const count = Number(wpsConnectorMember(comments, "Count") || 0);
  const items = [];
  for (let i = 1; i <= count; i += 1) {
    try { items.push(wpsConnectorWppCommentItem(comments.Item(i), i)); } catch {}
  }
  return { host: "wpp", count, comments: items };
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
function wpsConnectorWppAddComment(input = {}) {
  if (input.start === undefined && input.end === undefined) wpsConnectorApplyOperationScope(input);
  const text = String(input.text || "").trim();
  if (!text) wpsConnectorFail("INVALID_ARGUMENT", "comment text is required.", { field: "text" });
  const comments = wpsConnectorWppComments();
  const resolved = wpsConnectorWppCommentRange(input);
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
  return { host: "wpp", added: true, commentIndex: item.index, commentId: item.commentId, nativeCommentId: item.nativeCommentId, commentIdStable: item.commentIdStable, text: item.text || text, rangeText: item.rangeText, author: item.author, requestedStart: resolved.requestedStart, requestedEnd: resolved.requestedEnd, resolvedStart: resolved.resolvedStart, resolvedEnd: resolved.resolvedEnd, resolvedText: resolved.resolvedText, exactMatch: resolved.exactMatch, attempts: resolved.attempts };
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
  if (command.toolName === "wpp.find_text") return wpsConnectorWppFindText(command.input || {});
  if (command.toolName === "wpp.replace_text") return wpsConnectorWppReplaceText(command.input || {});
  if (command.toolName === "wpp.read_format") return wpsConnectorWppReadFormat(command.input || {});
  if (command.toolName === "wpp.read_text_format") return wpsConnectorWppReadTextFormat(command.input || {});
  if (command.toolName === "wpp.apply_text_format") return wpsConnectorWppApplyTextFormat(command.input || {});
  if (command.toolName === "wpp.read_paragraph_format") return wpsConnectorWppReadParagraphFormat(command.input || {});
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
