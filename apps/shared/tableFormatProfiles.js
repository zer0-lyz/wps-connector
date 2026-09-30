const POLICY_MODEL_VERSION = 3;

export const TABLE_FORMAT_POLICY_MODEL_VERSION = POLICY_MODEL_VERSION;
export const TABLE_FORMAT_MODES = Object.freeze(["preserve_target", "saved_template", "template_table", "preset", "custom"]);
export const TABLE_FORMAT_PRESETS = Object.freeze({
  formal: Object.freeze({
    fontName: "宋体",
    fontSize: 10.5,
    headerBold: true,
    headerShading: "#D9EAF7",
    headerAlignment: "center",
    bodyTextAlignment: "left",
    bodyNumericAlignment: "right",
    border: true,
    verticalAlignment: "center",
    padding: Object.freeze({ top: 3, bottom: 3, left: 4, right: 4 }),
    fitToPageWidth: true,
    equalDataColumnWidths: 54,
    rowHeightRule: "auto",
    textDirection: "horizontal",
  }),
  simple: Object.freeze({
    fontName: "宋体",
    fontSize: 10.5,
    headerBold: true,
    headerAlignment: "center",
    bodyTextAlignment: "left",
    bodyNumericAlignment: "right",
    border: true,
    verticalAlignment: "center",
    fitToPageWidth: true,
    rowHeightRule: "auto",
    textDirection: "horizontal",
  }),
  report: Object.freeze({
    fontName: "仿宋_GB2312",
    fontSize: 10.5,
    headerBold: true,
    headerShading: "#F2F2F2",
    headerAlignment: "center",
    bodyTextAlignment: "left",
    bodyNumericAlignment: "right",
    border: true,
    verticalAlignment: "center",
    padding: Object.freeze({ top: 3, bottom: 3, left: 4, right: 4 }),
    fitToPageWidth: true,
    rowHeightRule: "auto",
    textDirection: "horizontal",
  }),
});

export const DEFAULT_TEMPLATE_SCOPE = Object.freeze(["border", "font", "headerShading", "alignment", "padding"]);

const POLICY_FIELDS = new Set([
  "mode", "preset", "templateId", "templateTableIndex", "templateScope", "fontName", "fontSize",
  "headerBold", "headerShading", "headerAlignment", "bodyTextAlignment", "bodyNumericAlignment",
  "bodyTextColumns", "bodyNumericColumns", "border", "verticalAlignment", "padding", "indent",
  "fitToPageWidth", "preferredWidthPercent", "firstColumnWidth", "equalDataColumnWidths",
  "rowHeightRule", "textDirection", "applyOnInsert", "applyOnSync", "applyToNewRowsOnly",
  "customFormat", "format", "name",
]);

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function own(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function normalizeMode(value) {
  const mode = String(value || "preserve_target").trim().toLowerCase();
  if (mode === "preserve" || mode === "preserve-target") return "preserve_target";
  if (mode === "template" || mode === "template-table") return "template_table";
  return TABLE_FORMAT_MODES.includes(mode) ? mode : "preserve_target";
}

function normalizePreset(value) {
  const preset = String(value || "formal").trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(TABLE_FORMAT_PRESETS, preset) ? preset : "formal";
}

function normalizeIndexList(value) {
  if (!Array.isArray(value)) return undefined;
  const result = [...new Set(value.map((item) => Number(item)).filter((item) => Number.isInteger(item) && item >= 1))];
  return result.length ? result : [];
}

function normalizePadding(value) {
  if (!isObject(value)) return value;
  const result = {};
  for (const key of ["top", "bottom", "left", "right", "spacing"]) {
    if (!own(value, key)) continue;
    const number = Number(value[key]);
    result[key] = Number.isFinite(number) ? number : value[key];
  }
  return result;
}

function normalizePolicyInput(input) {
  if (isObject(input?.formatPolicy)) return input.formatPolicy;
  if (isObject(input)) return input;
  return {};
}

function mergePolicyInput(previous, input) {
  const prior = isObject(previous) ? previous : {};
  const patch = isObject(input) ? input : {};
  const merged = { ...prior, ...patch };
  for (const key of ["padding", "indent", "customFormat", "format"]) {
    if (isObject(prior[key]) && isObject(patch[key])) merged[key] = { ...prior[key], ...patch[key] };
  }
  return merged;
}

export function presetFormatPolicy(name = "formal") {
  const preset = normalizePreset(name);
  return clone(TABLE_FORMAT_PRESETS[preset]);
}

export function normalizeFormatPolicy(input = {}, previous = null) {
  const rawInput = normalizePolicyInput(input);
  const prior = isObject(previous) ? normalizePolicyInput(previous) : {};
  const raw = mergePolicyInput(prior, rawInput);
  const mode = normalizeMode(raw.mode);
  const preset = normalizePreset(raw.preset);
  const out = { mode };

  if (mode === "preset") Object.assign(out, presetFormatPolicy(preset));
  for (const key of POLICY_FIELDS) {
    if (!own(raw, key) || raw[key] === undefined || key === "mode" || key === "preset") continue;
    out[key] = clone(raw[key]);
  }
  if (mode === "preset") out.preset = preset;
  if (mode === "template_table") out.templateScope = Array.isArray(raw.templateScope) && raw.templateScope.length ? [...raw.templateScope] : [...DEFAULT_TEMPLATE_SCOPE];
  if (mode === "saved_template") out.templateScope = Array.isArray(raw.templateScope) && raw.templateScope.length ? [...raw.templateScope] : ["appearance"];
  if (mode !== "template_table" && own(raw, "templateScope")) out.templateScope = clone(raw.templateScope);
  if (own(raw, "padding")) out.padding = normalizePadding(raw.padding);
  if (own(raw, "bodyTextColumns")) out.bodyTextColumns = normalizeIndexList(raw.bodyTextColumns);
  if (own(raw, "bodyNumericColumns")) out.bodyNumericColumns = normalizeIndexList(raw.bodyNumericColumns);
  out.applyOnInsert = own(raw, "applyOnInsert") ? Boolean(raw.applyOnInsert) : mode !== "preserve_target";
  out.applyOnSync = own(raw, "applyOnSync") ? Boolean(raw.applyOnSync) : mode !== "preserve_target";
  out.applyToNewRowsOnly = own(raw, "applyToNewRowsOnly") ? Boolean(raw.applyToNewRowsOnly) : false;
  return out;
}

export function mergeFormatPolicy(previous, patch) {
  return normalizeFormatPolicy(patch, previous);
}

export function isPreserveTargetPolicy(policy) {
  return normalizeFormatPolicy(policy).mode === "preserve_target";
}

export function shouldApplyFormatPolicy(policy, trigger = "sync") {
  const normalized = normalizeFormatPolicy(policy);
  if (normalized.mode === "preserve_target") return false;
  return trigger === "insert" ? normalized.applyOnInsert !== false : normalized.applyOnSync !== false;
}

export function formatPolicySummary(policy) {
  const normalized = normalizeFormatPolicy(policy);
  const parts = [normalized.mode];
  if (normalized.mode === "preset") parts.push(normalized.preset);
  if (normalized.mode === "saved_template") parts.push(`样式模板 ${normalized.templateId || "未指定"}`);
  if (normalized.mode === "template_table") parts.push(`模板表 ${normalized.templateTableIndex ?? "未指定"}`);
  if (normalized.fontName) parts.push(normalized.fontName);
  if (normalized.fontSize !== undefined) parts.push(`${normalized.fontSize}pt`);
  if (normalized.fitToPageWidth) parts.push("页面宽度");
  if (normalized.applyOnInsert) parts.push("插入时应用");
  if (normalized.applyOnSync) parts.push("同步时应用");
  return parts.join(" · ");
}

function addAccepted(accepted, ...fields) {
  fields.filter(Boolean).forEach((field) => accepted.add(field));
}

function shadingFormat(value) {
  if (typeof value === "string") return { backgroundColor: value };
  if (isObject(value)) return clone(value);
  return null;
}

function paragraphIndent(value) {
  if (typeof value === "number" && Number.isFinite(value)) return { leftIndent: value };
  if (!isObject(value)) return null;
  const result = {};
  for (const key of ["leftIndent", "firstLineIndent", "rightIndent"]) if (value[key] !== undefined) result[key] = value[key];
  return Object.keys(result).length ? result : null;
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function commandTableIndex(context) {
  if (context.commandTableIndex !== undefined) return Number(context.commandTableIndex);
  const internal = Number(context.tableIndex ?? 0);
  return Number.isInteger(internal) ? internal + 1 : internal;
}

function tableRowCount(context) {
  return Math.max(0, Math.floor(Number(context.rowCount || context.targetRowCount || 0)));
}

function tableColumnCount(context) {
  return Math.max(0, Math.floor(Number(context.columnCount || context.targetColumnCount || 0)));
}

function buildWidthItems(policy, context) {
  const columnCount = tableColumnCount(context);
  if (!columnCount) return [];
  const first = positiveNumber(policy.firstColumnWidth);
  let equal = positiveNumber(policy.equalDataColumnWidths);
  if (!equal && policy.equalDataColumnWidths === true) {
    const available = positiveNumber(context.availableWidth || context.pageWidth);
    if (available) equal = (available - (first || 0)) / Math.max(1, columnCount - 1);
  }
  if (!first && !equal) return [];
  return Array.from({ length: columnCount }, (_, index) => ({ column: index + 1, width: index === 0 && first ? first : equal || first }));
}

function rangeStartRow(policy, context) {
  if (!policy.applyToNewRowsOnly) return 1;
  const previousRowCount = Math.floor(Number(context.previousRowCount || 0));
  return previousRowCount > 0 ? Math.max(2, previousRowCount + 1) : 1;
}

function bodyStartRow(policy, context) {
  return Math.max(2, rangeStartRow(policy, context));
}

function addRangeCommand(commands, policy, context, accepted, rejected) {
  const rowCount = tableRowCount(context);
  const columnCount = tableColumnCount(context);
  const startRow = rangeStartRow(policy, context);
  const newRowsOnly = policy.applyToNewRowsOnly && Number(context.previousRowCount || 0) > 0;
  const format = {};
  if (newRowsOnly && (policy.fontName !== undefined || policy.fontSize !== undefined)) {
    format.font = {};
    if (policy.fontName !== undefined) format.font.name = policy.fontName;
    if (policy.fontSize !== undefined) format.font.size = Number(policy.fontSize);
  }
  const paragraph = paragraphIndent(policy.indent);
  if (policy.padding && isObject(policy.padding)) format.padding = clone(policy.padding);
  if (paragraph) format.paragraph = paragraph;
  if (policy.verticalAlignment !== undefined) format.verticalAlignment = policy.verticalAlignment;
  if (newRowsOnly && typeof policy.border === "boolean") format.borders = { enable: policy.border ? 1 : 0 };
  if (policy.border && isObject(policy.border)) format.borders = clone(policy.border);
  if (isObject(policy.customFormat)) Object.assign(format, clone(policy.customFormat));
  if (isObject(policy.format)) Object.assign(format, clone(policy.format));
  if (!Object.keys(format).length || !rowCount || !columnCount || startRow > rowCount) return;
  commands.push({
    tool: "wpp.format_table_range",
    input: { tableIndex: commandTableIndex(context), startRow, endRow: rowCount, startCol: 1, endCol: columnCount, format, fastPath: true },
    reason: "cell_style",
  });
  addAccepted(accepted, newRowsOnly && policy.fontName !== undefined && "fontName", newRowsOnly && policy.fontSize !== undefined && "fontSize", policy.padding && "padding", paragraph && "indent", policy.verticalAlignment !== undefined && "verticalAlignment", (newRowsOnly && typeof policy.border === "boolean") || isObject(policy.border) ? "border" : "", isObject(policy.customFormat) && "customFormat", isObject(policy.format) && "format");
  if (policy.applyToNewRowsOnly) addAccepted(accepted, "applyToNewRowsOnly");
  if (policy.padding && !isObject(policy.padding)) rejected.push({ field: "padding", reason: "padding must be an object" });
}

export function buildTableFormatCommands(policyInput, context = {}, options = {}) {
  const policy = normalizeFormatPolicy(policyInput);
  const commands = [];
  const accepted = new Set();
  const rejected = [];
  const warnings = [];
  const tableIndex = commandTableIndex(context);
  const rowCount = tableRowCount(context);
  const columnCount = tableColumnCount(context);
  const skipInsertHandledLayout = options.skipInsertHandledLayout === true;
  const newRowsOnly = policy.applyToNewRowsOnly && Number(context.previousRowCount || 0) > 0;
  const skippedFields = new Set();

  if (policy.mode === "preserve_target") return { policy, commands, acceptedFields: [], rejectedFields: [], warnings, targetTableIndex: tableIndex };
  if (policy.mode === "template_table") {
    const sourceTableIndex = Number(policy.templateTableIndex ?? context.sourceTableIndex);
    if (!Number.isInteger(sourceTableIndex) || sourceTableIndex < 1) {
      rejected.push({ field: "templateTableIndex", reason: "template_table requires a 1-based templateTableIndex" });
      return { policy, commands, acceptedFields: [], rejectedFields: rejected, warnings, targetTableIndex: tableIndex };
    }
    commands.push({ tool: "wpp.copy_table_style", input: { sourceTableIndex, targetTableIndex: tableIndex, scope: policy.templateScope || [...DEFAULT_TEMPLATE_SCOPE] }, reason: "template_table" });
    addAccepted(accepted, "templateTableIndex", "templateScope");
    return { policy, commands, acceptedFields: [...accepted], rejectedFields: rejected, warnings, targetTableIndex: tableIndex };
  }
  if (policy.mode === "saved_template") {
    if (!policy.templateId) {
      rejected.push({ field: "templateId", reason: "saved_template requires templateId" });
      return { policy, commands, acceptedFields: [], rejectedFields: rejected, warnings, targetTableIndex: tableIndex };
    }
    commands.push({
      tool: "wps.apply_wpp_table_style_template",
      input: {
        templateId: policy.templateId,
        targetTableIndexes: [tableIndex],
        scope: policy.templateScope || ["appearance"],
        preserveContent: true,
        verify: false,
      },
      reason: "saved_template",
    });
    addAccepted(accepted, "templateId", "templateScope");
    return { policy, commands, acceptedFields: [...accepted], rejectedFields: rejected, warnings, targetTableIndex: tableIndex };
  }

  const tableInput = { tableIndex };
  if (!skipInsertHandledLayout && !newRowsOnly) {
    if (typeof policy.border === "boolean") { tableInput.border = policy.border; addAccepted(accepted, "border"); }
    if (policy.fitToPageWidth !== undefined) { tableInput.fitToPageWidth = Boolean(policy.fitToPageWidth); addAccepted(accepted, "fitToPageWidth"); }
    if (policy.preferredWidthPercent !== undefined) { tableInput.preferredWidthPercent = Number(policy.preferredWidthPercent); addAccepted(accepted, "preferredWidthPercent"); }
    if (policy.fontName !== undefined) { tableInput.fontName = policy.fontName; addAccepted(accepted, "fontName"); }
    if (policy.fontSize !== undefined) { tableInput.fontSize = Number(policy.fontSize); addAccepted(accepted, "fontSize"); }
    if (policy.rowHeightRule !== undefined) { tableInput.rowHeightRule = policy.rowHeightRule; addAccepted(accepted, "rowHeightRule"); }
    if (policy.textDirection !== undefined) { tableInput.textDirection = policy.textDirection; addAccepted(accepted, "textDirection"); }
  }
  if (Object.keys(tableInput).length > 1) commands.push({ tool: "wpp.format_table", input: tableInput, reason: "table_style" });
  if (newRowsOnly) {
    for (const field of ["fitToPageWidth", "preferredWidthPercent", "rowHeightRule", "textDirection", "firstColumnWidth", "equalDataColumnWidths"]) {
      if (policy[field] !== undefined) {
        skippedFields.add(field);
        warnings.push({ code: "FORMAT_FIELD_SKIPPED_FOR_NEW_ROWS_ONLY", field, reason: "Writer table-level layout cannot be limited to newly added rows" });
      }
    }
  }

  const header = {};
  if (policy.headerBold !== undefined) header.font = { bold: Boolean(policy.headerBold) };
  if (policy.headerAlignment !== undefined) header.paragraph = { alignment: policy.headerAlignment };
  const headerShading = shadingFormat(policy.headerShading);
  if (headerShading) header.shading = headerShading;
  if (Object.keys(header).length && rowCount > 0 && columnCount > 0 && (!policy.applyToNewRowsOnly || rangeStartRow(policy, context) <= 1)) {
    commands.push({ tool: "wpp.format_table_rows", input: { tableIndex, rows: [1], startCol: 1, endCol: columnCount, format: header, fastPath: true }, reason: "header_style" });
    addAccepted(accepted, policy.headerBold !== undefined && "headerBold", policy.headerAlignment !== undefined && "headerAlignment", headerShading && "headerShading");
  }

  const bodyRow = bodyStartRow(policy, context);
  if (rowCount >= bodyRow && columnCount > 0) {
    const textColumns = policy.bodyTextColumns || (policy.bodyTextAlignment !== undefined ? [1] : []);
    const numericColumns = policy.bodyNumericColumns || (policy.bodyNumericAlignment !== undefined ? Array.from({ length: Math.max(0, columnCount - 1) }, (_, index) => index + 2) : []);
    if (policy.bodyTextAlignment !== undefined && textColumns.length) {
      commands.push({ tool: "wpp.format_table_columns", input: { tableIndex, columns: textColumns, startRow: bodyRow, endRow: rowCount, format: { paragraph: { alignment: policy.bodyTextAlignment } }, fastPath: true }, reason: "body_text_alignment" });
      addAccepted(accepted, "bodyTextAlignment", "bodyTextColumns");
    }
    if (policy.bodyNumericAlignment !== undefined && numericColumns.length) {
      commands.push({ tool: "wpp.format_table_columns", input: { tableIndex, columns: numericColumns, startRow: bodyRow, endRow: rowCount, format: { paragraph: { alignment: policy.bodyNumericAlignment } }, fastPath: true }, reason: "body_numeric_alignment" });
      addAccepted(accepted, "bodyNumericAlignment", "bodyNumericColumns");
    }
  }

  addRangeCommand(commands, policy, context, accepted, rejected);
  if (!skipInsertHandledLayout) {
    const widths = buildWidthItems(policy, context);
    if (widths.length) {
      commands.push({ tool: "wpp.set_column_widths", input: { tableIndex, columnWidths: widths, disableAutoFit: true }, reason: "column_width" });
      addAccepted(accepted, "firstColumnWidth", "equalDataColumnWidths");
    } else if (policy.firstColumnWidth !== undefined || policy.equalDataColumnWidths !== undefined) {
      rejected.push({ field: "firstColumnWidth/equalDataColumnWidths", reason: "table columnCount or available width is unavailable" });
    }
  }
  if (skipInsertHandledLayout) {
    addAccepted(accepted,
      typeof policy.border === "boolean" && "border",
      policy.fitToPageWidth !== undefined && "fitToPageWidth",
      policy.preferredWidthPercent !== undefined && "preferredWidthPercent",
      policy.fontName !== undefined && "fontName",
      policy.fontSize !== undefined && "fontSize",
      policy.rowHeightRule !== undefined && "rowHeightRule",
      policy.textDirection !== undefined && "textDirection",
      (policy.firstColumnWidth !== undefined || policy.equalDataColumnWidths !== undefined) && "firstColumnWidth",
      policy.equalDataColumnWidths !== undefined && "equalDataColumnWidths",
    );
  }

  const supported = new Set([...accepted, ...skippedFields, "mode", "preset", "applyOnInsert", "applyOnSync", "applyToNewRowsOnly"]);
  for (const key of Object.keys(policy)) if (POLICY_FIELDS.has(key) && !supported.has(key) && policy[key] !== undefined) rejected.push({ field: key, reason: "no compatible Writer command was generated" });
  return { policy, commands, acceptedFields: [...accepted], rejectedFields: rejected, skippedFields: [...skippedFields], warnings, targetTableIndex: tableIndex };
}

export function buildInsertTableInput(policyInput, context = {}) {
  const policy = normalizeFormatPolicy(policyInput);
  const input = {
    rowCount: Number(context.rowCount || 0),
    columnCount: Number(context.columnCount || 0),
    values: clone(context.values),
    releaseSelection: true,
    ensureTrailingParagraph: true,
    preserveUnspecified: true,
  };
  if (policy.fontName !== undefined) input.fontName = policy.fontName;
  if (policy.fontSize !== undefined) input.fontSize = Number(policy.fontSize);
  if (policy.headerBold !== undefined) input.headerRowBold = Boolean(policy.headerBold);
  if (typeof policy.border === "boolean") input.border = policy.border;
  if (policy.fitToPageWidth !== undefined) input.fitToPageWidth = Boolean(policy.fitToPageWidth);
  if (policy.preferredWidthPercent !== undefined) input.preferredWidthPercent = Number(policy.preferredWidthPercent);
  if (policy.rowHeightRule !== undefined) input.rowHeightRule = policy.rowHeightRule;
  if (policy.textDirection !== undefined) input.horizontalText = String(policy.textDirection).toLowerCase() !== "vertical";
  if (policy.padding && isObject(policy.padding)) input.cellPadding = clone(policy.padding);
  const widths = buildWidthItems(policy, context);
  if (widths.length) input.columnWidths = widths;
  return input;
}

export function migrateTableSyncRecord(record) {
  if (!isObject(record)) return record;
  const migrated = { ...record, modelVersion: POLICY_MODEL_VERSION, formatPolicy: normalizeFormatPolicy(record.formatPolicy) };
  return migrated;
}

export function migrateTableSyncStore(store) {
  const input = isObject(store) ? store : {};
  const syncs = Array.isArray(input.syncs) ? input.syncs.map(migrateTableSyncRecord) : [];
  return { ...input, sources: Array.isArray(input.sources) ? input.sources : [], syncs };
}
