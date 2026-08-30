/**
 * Host-neutral table format contract.
 *
 * Host adapters read/write native WPS or Office objects. This module owns the
 * persisted shape, normalization, comparison, apply planning and transaction
 * result semantics used by both adapters.
 */
export const TABLE_FORMAT_TEMPLATE_SCHEMA_VERSION = 2;
export const LEGACY_TABLE_FORMAT_TEMPLATE_SCHEMA_VERSION = 1;

const META_KEYS = new Set([
  "tableIndex", "oneBasedTableIndex", "host", "formatHost", "warnings", "warning",
  "unsupported", "unsupportedFields", "attemptedButUnverified", "perCellDirectFormattingSummary",
  "captured", "found", "source", "commandId", "durationMs", "fastPath", "hostCallsSaved",
  "affectedCells", "fallbackCellCount", "readStrategy", "formatReadStrategy", "sampleRows", "sampleCount",
]);
const TABLE_KEYS = new Set([
  "style", "styleBuiltIn", "headerRowCount", "repeatHeaderRows", "headerRowRepeatOnNewPage",
  "bandedRows", "bandedColumns", "firstColumn", "lastColumn", "totalRow",
  "styleBandedRows", "styleBandedColumns", "styleFirstColumn", "styleLastColumn", "styleTotalRow",
  "alignment", "tableAlignment", "horizontalAlignment", "verticalAlignment", "width", "tableWidth",
  "preferredWidth", "preferredWidthType", "allowAutoFit", "autoFit", "autoFitBehavior", "shadingColor",
  "fontName", "fontSize", "fontColor", "bold", "italic", "cellPadding", "padding",
  "borderColor", "borderType", "borderWidth", "borders", "headerRowStyle", "bodyRowStyle",
  "headerRowFontName", "headerRowFontSize", "headerRowFontColor", "headerRowBold",
  "headerRowAlignment", "headerRowHorizontalAlignment", "headerRowVerticalAlignment", "headerRowShadingColor",
  "bodyFontName", "bodyFontSize", "bodyFontColor", "bodyBold", "bodyHorizontalAlignment", "bodyVerticalAlignment",
  "distributeColumns", "selectTable", "textDirection", "horizontalText",
]);
const CELL_KEYS = new Set([
  "row", "column", "col", "width", "height", "font", "paragraph", "shading", "borders", "padding",
  "verticalAlignment", "horizontalAlignment", "numberFormat", "numberFormatLocal", "wrapText", "merged",
]);
const FONT_KEYS = new Set(["name", "fontName", "size", "fontSize", "bold", "italic", "underline", "color", "fontColor", "highlightColor"]);
const PARAGRAPH_KEYS = new Set([
  "alignment", "horizontalAlignment", "verticalAlignment", "spaceBefore", "spaceAfter", "lineSpacing",
  "lineSpacingRule", "lineSpacingValue", "firstLineIndent", "leftIndent", "rightIndent", "wordWrap",
  "keepWithNext", "keepTogether", "pageBreakBefore",
]);
const SHADING_KEYS = new Set(["backgroundColor", "foregroundColor", "texture", "color", "shadingColor", "pattern"]);
const BORDER_KEYS = new Set(["enable", "items", "edges", "top", "left", "bottom", "right", "insideH", "insideV", "start", "end", "lineStyle", "lineWidth", "color", "type", "width", "rawSize", "space", "ooxml"]);
const DIMENSION_KEYS = new Set(["row", "column", "index", "height", "width", "heightRule", "unit", "columnWidth", "rowHeight"]);
const MERGE_KEYS = new Set(["startRow", "startColumn", "endRow", "endColumn", "row", "column", "rowSpan", "columnSpan"]);

export const TABLE_FORMAT_FIELD_WHITELIST = Object.freeze([
  "table.*", "cells[].row", "cells[].column", "cells[].font.*", "cells[].paragraph.*", "cells[].shading.*",
  "cells[].borders.*", "cells[].padding.*", "cells[].verticalAlignment", "cells[].numberFormat", "cells[].numberFormatLocal",
  "rowHeights[].*", "columnWidths[].*", "mergedCells[].*", "rowCount", "columnCount",
]);

function clone(value) {
  if (value === undefined || value === null) return value;
  return JSON.parse(JSON.stringify(value));
}
function defined(value) { return value !== undefined && value !== null && value !== "" && value !== "unsupported"; }
function canonicalColor(value) {
  if (typeof value !== "string") return value;
  const text = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(text)) return text.toUpperCase();
  if (/^[0-9a-f]{6}$/i.test(text)) return `#${text.toUpperCase()}`;
  return text;
}
function normalizeLeaf(value, key = "") {
  if (!defined(value)) return undefined;
  if (typeof value === "string") {
    const text = value.trim();
    if (!text || text === "unsupported") return undefined;
    return /color/i.test(key) ? canonicalColor(text) : text;
  }
  return value;
}
function normalizeObject(value, allowed, context = "") {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const output = {};
  for (const [key, raw] of Object.entries(value)) {
    if (META_KEYS.has(key) || !allowed.has(key)) continue;
    if (Array.isArray(raw)) {
      const itemAllowed = key === "items" || key === "edges" ? BORDER_KEYS : key === "cells" ? CELL_KEYS : key === "rowHeights" || key === "columnWidths" ? DIMENSION_KEYS : key === "mergedCells" ? MERGE_KEYS : null;
      output[key] = itemAllowed
        ? raw.map((item) => normalizeObject(item, itemAllowed, `${context}.${key}[]`)).filter((item) => Object.keys(item).length)
        : raw.map((item) => normalizeFormatValue(item, `${context}.${key}[]`));
      continue;
    }
    if (raw && typeof raw === "object") {
      const nestedAllowed = key === "font" ? FONT_KEYS : key === "paragraph" ? PARAGRAPH_KEYS : key === "shading" ? SHADING_KEYS : key === "borders" ? BORDER_KEYS : key === "padding" || key === "cellPadding" ? DIMENSION_KEYS : key === "headerRowStyle" || key === "bodyRowStyle" ? TABLE_KEYS : null;
      output[key] = nestedAllowed ? normalizeObject(raw, nestedAllowed, `${context}.${key}`) : normalizeFormatValue(raw, `${context}.${key}`);
      if (!Object.keys(output[key] || {}).length) delete output[key];
      continue;
    }
    const leaf = normalizeLeaf(raw, key);
    if (leaf !== undefined || typeof raw === "boolean" || typeof raw === "number") output[key] = leaf === undefined ? raw : leaf;
  }
  return output;
}
function normalizeFormatValue(value, key = "") {
  if (Array.isArray(value)) return value.map((item) => normalizeFormatValue(item, key));
  if (!value || typeof value !== "object") return normalizeLeaf(value, key);
  const allowed = key === "table" ? TABLE_KEYS : key === "cells[]" ? CELL_KEYS : key === "font" ? FONT_KEYS : key === "paragraph" ? PARAGRAPH_KEYS : key === "shading" ? SHADING_KEYS : key === "borders" ? BORDER_KEYS : key === "padding" ? DIMENSION_KEYS : TABLE_KEYS;
  return normalizeObject(value, allowed, key);
}
function normalizeDimensionArray(value, kind) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => normalizeObject(item, DIMENSION_KEYS, kind)).filter((item) => {
    const index = Number(item[kind === "rowHeights" ? "row" : "column"] ?? item.index);
    const size = Number(item[kind === "rowHeights" ? "height" : "width"]);
    const validSize = kind === "rowHeights" ? Number.isFinite(size) && size >= 0 : Number.isFinite(size) && size > 0;
    return Number.isInteger(index) && index > 0 && validSize;
  });
}
function normalizeCells(value) {
  if (!Array.isArray(value)) return [];
  return value.map((raw) => {
    const source = raw?.format && typeof raw.format === "object" ? { ...raw.format, row: raw.row, column: raw.column ?? raw.col } : raw;
    const cell = normalizeObject(source, CELL_KEYS, "cells[]");
    if (cell.column === undefined && cell.col !== undefined) cell.column = cell.col;
    delete cell.col;
    return cell;
  }).filter((cell) => Number.isInteger(Number(cell.row)) && Number(cell.row) > 0 && Number.isInteger(Number(cell.column)) && Number(cell.column) > 0);
}
function normalizeMergedCells(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => normalizeObject(item, MERGE_KEYS, "mergedCells[]")).filter((item) => Object.keys(item).length);
}

/** Convert the old WPS nested snapshot and old Office flat snapshots. */
export function normalizeTableFormatSnapshot(format = {}) {
  const source = format && typeof format === "object" ? clone(format) : {};
  const nested = source.table && typeof source.table === "object" ? source.table : source;
  const table = normalizeObject(nested, TABLE_KEYS, "table");
  const normalized = {
    table,
    cells: normalizeCells(source.cells),
    rowHeights: normalizeDimensionArray(source.rowHeights, "rowHeights"),
    columnWidths: normalizeDimensionArray(source.columnWidths, "columnWidths"),
    mergedCells: normalizeMergedCells(source.mergedCells),
  };
  if (defined(source.rowCount) || typeof source.rowCount === "number") normalized.rowCount = Number(source.rowCount);
  if (defined(source.columnCount) || typeof source.columnCount === "number") normalized.columnCount = Number(source.columnCount);
  return {
    schemaVersion: TABLE_FORMAT_TEMPLATE_SCHEMA_VERSION,
    format: normalized,
    unsupportedFields: Array.isArray(source.unsupportedFields) ? source.unsupportedFields.map(String) : [],
    warnings: Array.isArray(source.warnings) ? source.warnings.map(String) : [],
  };
}

export function normalizeTableFormatTemplate(input = {}) {
  const templateId = String(input.templateId || input.id || "").trim();
  const name = String(input.name || "").trim();
  if (!templateId) throw new Error("table format templateId is required.");
  if (!name) throw new Error("table format template name is required.");
  const snapshot = normalizeTableFormatSnapshot(input.format || input.snapshot?.format || {});
  const now = new Date().toISOString();
  return {
    templateId,
    name,
    schemaVersion: TABLE_FORMAT_TEMPLATE_SCHEMA_VERSION,
    host: String(input.host || "").trim(),
    formatHost: String(input.formatHost || input.host || "").trim(),
    source: clone(input.source || {}),
    shape: clone(input.shape || { rowCount: snapshot.format.rowCount || 0, columnCount: snapshot.format.columnCount || 0 }),
    format: snapshot.format,
    unsupportedFields: [...new Set([...(input.unsupportedFields || []), ...snapshot.unsupportedFields])],
    warnings: [...new Set([...(input.warnings || []), ...snapshot.warnings])],
    createdAt: input.createdAt || now,
    updatedAt: input.updatedAt || input.createdAt || now,
  };
}

function officeTableFields(format) {
  const output = { ...(format?.table || {}) };
  delete output.cells;
  return {
    ...output,
    ...(format?.rowCount !== undefined ? { rowCount: Number(format.rowCount) } : {}),
    ...(format?.columnCount !== undefined ? { columnCount: Number(format.columnCount) } : {}),
    ...(format?.rowHeights?.length ? { rowHeights: clone(format.rowHeights) } : {}),
    ...(format?.columnWidths?.length ? { columnWidths: clone(format.columnWidths) } : {}),
    ...(format?.cells?.length ? { cells: clone(format.cells) } : {}),
    ...(format?.mergedCells?.length ? { mergedCells: clone(format.mergedCells) } : {}),
  };
}
export function tableFormatForApply(template = {}, options = {}) {
  const format = normalizeTableFormatSnapshot(template.format || template).format;
  const host = String(options.host || template.host || template.formatHost || "").toLowerCase();
  return host === "office" || host === "word" ? officeTableFields(format) : clone(format);
}

function pathLabel(path) { return path || "format"; }
function comparablePrimitive(value) { return typeof value === "string" ? value.trim().toLowerCase() : value; }
function numericEqual(expected, actual, options) {
  if (typeof expected !== "number" || typeof actual !== "number") return false;
  const tolerance = Number(options.numericTolerance ?? 0.01);
  return Number.isFinite(expected) && Number.isFinite(actual) && Math.abs(expected - actual) <= tolerance;
}
function compareValue(expected, actual, path, mismatches, options = {}) {
  if (!defined(expected) && typeof expected !== "boolean" && typeof expected !== "number") return;
  if (expected && typeof expected === "object" && !Array.isArray(expected)) {
    if (!actual || typeof actual !== "object") { mismatches.push({ path: pathLabel(path), expected, actual: null }); return; }
    for (const [key, value] of Object.entries(expected)) {
      if (META_KEYS.has(key)) continue;
      if (options.ignoreShape && ["rowCount", "columnCount"].includes(key)) continue;
      if (options.ignoreLayout && ["rowHeights", "columnWidths", "mergedCells"].includes(key)) continue;
      compareValue(value, actual[key], path ? `${path}.${key}` : key, mismatches, options);
    }
    return;
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) { mismatches.push({ path: pathLabel(path), expected, actual: null }); return; }
    const keyed = path.endsWith("cells") || path.endsWith("rowHeights") || path.endsWith("columnWidths") || path.endsWith("mergedCells");
    if (keyed) {
      const keys = path.endsWith("cells") ? ["row", "column"] : path.endsWith("rowHeights") ? ["row"] : path.endsWith("columnWidths") ? ["column"] : ["startRow", "startColumn", "endRow", "endColumn"];
      for (const item of expected) {
        const found = actual.find((candidate) => keys.every((key) => candidate?.[key] === item?.[key]));
        if (!found) mismatches.push({ path: `${path}[${keys.map((key) => item?.[key]).join(":")}]`, expected: item, actual: null });
        else compareValue(item, found, `${path}[${keys.map((key) => item?.[key]).join(":")}]`, mismatches, options);
      }
      return;
    }
    if (expected.length !== actual.length) { mismatches.push({ path: pathLabel(path), expectedLength: expected.length, actualLength: actual.length }); return; }
    expected.forEach((value, index) => compareValue(value, actual[index], `${path}[${index}]`, mismatches, options));
    return;
  }
  if (numericEqual(expected, actual, options)) return;
  if (comparablePrimitive(expected) !== comparablePrimitive(actual)) mismatches.push({ path: pathLabel(path), expected, actual: actual ?? null });
}
export function compareTableFormat(expected = {}, actual = {}, options = {}) {
  const mismatches = [];
  compareValue(normalizeTableFormatSnapshot(expected).format, normalizeTableFormatSnapshot(actual).format, "", mismatches, options);
  return { matched: mismatches.length === 0, mismatches };
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}
function cellSignature(cell) {
  const copy = { ...cell };
  delete copy.row; delete copy.column; delete copy.col;
  return JSON.stringify(stable(copy));
}
export function collectTableFormatFields(format = {}) {
  const normalized = normalizeTableFormatSnapshot(format).format;
  const paths = [];
  const walk = (value, path) => {
    if (Array.isArray(value)) return value.forEach((item) => walk(item, path));
    if (!value || typeof value !== "object") { if (defined(value) || typeof value === "boolean" || typeof value === "number") paths.push(path); return; }
    for (const [key, child] of Object.entries(value)) walk(child, path ? `${path}.${key}` : key);
  };
  walk(normalized, "");
  return [...new Set(paths.filter(Boolean))];
}
export function selectTableFormatVerificationCells(format = {}, limit = 8) {
  const normalized = normalizeTableFormatSnapshot(format).format;
  const cells = normalized.cells || [];
  if (!cells.length) return [];
  const byKey = new Map(cells.map((cell) => [`${cell.row}:${cell.column}`, cell]));
  const rowCount = Number(normalized.rowCount || Math.max(...cells.map((cell) => Number(cell.row) || 0)));
  const columnCount = Number(normalized.columnCount || Math.max(...cells.map((cell) => Number(cell.column) || 0)));
  const output = []; const seen = new Set();
  for (const [row, column] of [[1, 1], [1, columnCount], [rowCount, 1], [rowCount, columnCount], [2, 1], [2, columnCount]]) {
    const key = `${row}:${column}`;
    if (byKey.has(key) && !seen.has(key)) { output.push(byKey.get(key)); seen.add(key); }
  }
  for (const cell of cells) { const key = `${cell.row}:${cell.column}`; if (!seen.has(key)) { output.push(cell); seen.add(key); } if (output.length >= limit) break; }
  return output.slice(0, Math.max(1, limit));
}
export function fitTableFormatToShape(format = {}, shape = {}) {
  const normalized = normalizeTableFormatSnapshot(format).format;
  const rowCount = Number(shape.rowCount || 0); const columnCount = Number(shape.columnCount || 0);
  const next = clone(normalized);
  if (Array.isArray(next.cells) && rowCount && columnCount) next.cells = next.cells.filter((cell) => Number(cell.row) <= rowCount && Number(cell.column) <= columnCount);
  if (Array.isArray(next.rowHeights) && rowCount) next.rowHeights = next.rowHeights.filter((item) => Number(item.row ?? item.index) <= rowCount);
  if (Array.isArray(next.columnWidths) && columnCount) next.columnWidths = next.columnWidths.filter((item) => Number(item.column ?? item.index) <= columnCount);
  if (Array.isArray(next.mergedCells) && rowCount && columnCount) next.mergedCells = next.mergedCells.filter((item) => Number(item.startRow) >= 1 && Number(item.startColumn) >= 1 && Number(item.endRow) <= rowCount && Number(item.endColumn) <= columnCount);
  next.rowCount = rowCount || next.rowCount; next.columnCount = columnCount || next.columnCount;
  return next;
}
export function buildTableFormatApplyPlan(format = {}, options = {}) {
  const normalized = normalizeTableFormatSnapshot(format).format;
  const groups = new Map();
  for (const cell of normalized.cells || []) {
    const key = cellSignature(cell);
    if (!groups.has(key)) groups.set(key, { format: cell, cells: [] });
    groups.get(key).cells.push({ row: Number(cell.row), column: Number(cell.column) });
  }
  const mergedCells = normalized.mergedCells || [];
  const affectedCells = (normalized.cells || []).length;
  const rangeCount = [...groups.values()].filter((group) => group.cells.length > 1).length;
  return {
    format: normalized,
    table: normalized.table,
    cellGroups: [...groups.values()],
    rowHeights: normalized.rowHeights || [],
    columnWidths: normalized.columnWidths || [],
    mergedCells,
    verifyCells: selectTableFormatVerificationCells(normalized, Number(options.verifyLimit || 8)).map((cell) => ({ row: cell.row, column: cell.column })),
    affectedCells,
    fastPath: mergedCells.length ? "per-cell" : rangeCount ? "grouped-range" : "per-cell",
    hostCallsSaved: mergedCells.length ? 0 : Math.max(0, affectedCells - rangeCount),
    fallbackCellCount: 0,
    fallbackReason: mergedCells.length ? "mergedCells" : "",
  };
}
export function performanceStats(input = {}) {
  return {
    fastPath: input.fastPath || "per-cell",
    hostCallsSaved: Math.max(0, Number(input.hostCallsSaved || 0)),
    affectedCells: Math.max(0, Number(input.affectedCells || 0)),
    fallbackCellCount: Math.max(0, Number(input.fallbackCellCount || 0)),
    durationMs: Math.max(0, Number(input.durationMs || 0)),
  };
}
export function summarizeTemplateApplication(results = []) {
  const normalized = Array.isArray(results) ? results : [];
  return {
    targetCount: normalized.length,
    successCount: normalized.filter((item) => item?.ok === true).length,
    verifiedCount: normalized.filter((item) => item?.verification?.matched === true).length,
    failedCount: normalized.filter((item) => item?.ok !== true).length,
    unsupportedCount: normalized.reduce((count, item) => count + (item?.unsupported?.length || 0), 0),
    attemptedButUnverifiedCount: normalized.reduce((count, item) => count + (item?.attemptedButUnverified?.length || 0), 0),
    results: normalized,
  };
}

/** Shared transaction runner. Only callback implementations touch host APIs. */
export async function applyTableFormatTransactions({ targets = [], format = {}, host = "", read, apply, restore, options = {} }) {
  const started = Date.now();
  const results = [];
  for (const target of targets) {
    const tableIndex = typeof target === "object" ? target.tableIndex : target;
    const targetShape = typeof target === "object" ? target.shape || {} : {};
    const plan = buildTableFormatApplyPlan(fitTableFormatToShape(format, targetShape), options);
    const requested = tableFormatForApply({ format: plan.format, host }, { host });
    let before;
    try {
      before = await read(tableIndex, { phase: "before", plan });
      const writeResult = await apply(tableIndex, requested, plan);
      const after = await read(tableIndex, { phase: "after", plan });
      const verification = compareTableFormat(plan.format, after?.format || after || {}, { ignoreShape: true, numericTolerance: options.numericTolerance });
      const attemptedFields = collectTableFormatFields(plan.format);
      const unsupported = [...new Set([
        ...(writeResult?.unsupported || []),
        ...(writeResult?.hostRejectedFields || []),
        ...(after?.unsupported || []),
        ...(after?.unsupportedFields || []),
      ])];
      const mismatchedFields = verification.mismatches.map((item) => item.path);
      const attemptedButUnverified = [...new Set([
        ...(writeResult?.attemptedButUnverified || []),
        ...(writeResult?.attemptedFields || []),
        ...(after?.attemptedButUnverified || []),
        ...(verification.matched ? [] : mismatchedFields),
      ])].filter((field) => !unsupported.includes(field));
      // A host adapter may need to use an API that cannot acknowledge a
      // setter synchronously (for example Word repeat-header or OOXML
      // insertion).  The post-write snapshot is the authoritative result:
      // when every requested field matches, those provisional markers must be
      // promoted to applied instead of making an actually verified operation
      // fail.  Explicit unsupported fields remain a hard boundary.
      const unresolvedAttemptedButUnverified = verification.matched ? [] : attemptedButUnverified;
      let rollback = null;
      if (!verification.matched) {
        try { rollback = await restore?.(tableIndex, before?.format || before || {}); } catch (error) { rollback = { ok: false, error: { code: error.code || "ROLLBACK_FAILED", message: error.message || String(error) } }; }
        if (rollback && options.verifyRestore !== false) {
          try {
            const restored = await read(tableIndex, { phase: "restore" });
            rollback.verification = compareTableFormat(before?.format || before || {}, restored?.format || restored || {}, { ignoreShape: true, numericTolerance: options.numericTolerance });
            rollback.ok = rollback.ok !== false && rollback.verification.matched;
          } catch (error) {
            rollback.ok = false;
            rollback.verification = { matched: false, mismatches: [{ path: "restore", expected: "readback", actual: error.message || String(error) }] };
          }
        }
      }
      results.push({
        tableIndex,
        ok: verification.matched && unsupported.length === 0 && unresolvedAttemptedButUnverified.length === 0,
        applied: verification.matched ? attemptedFields : [],
        unsupported,
        attemptedButUnverified: unresolvedAttemptedButUnverified,
        warning: verification.matched && unsupported.length === 0 && unresolvedAttemptedButUnverified.length === 0
          ? undefined
          : verification.matched
            ? "部分格式字段未被宿主接受或无法确认，未计入成功字段。"
            : "写入后回读不一致，已尝试恢复原格式。",
        write: writeResult,
        verification,
        rollback,
        plan: performanceStats(plan),
      });
    } catch (error) {
      let rollback = null;
      if (before) {
        try { rollback = await restore?.(tableIndex, before?.format || before || {}); } catch (rollbackError) { rollback = { ok: false, error: { code: rollbackError.code || "ROLLBACK_FAILED", message: rollbackError.message || String(rollbackError) } }; }
        if (rollback && options.verifyRestore !== false) {
          try {
            const restored = await read(tableIndex, { phase: "restore" });
            rollback.verification = compareTableFormat(before?.format || before || {}, restored?.format || restored || {}, { ignoreShape: true, numericTolerance: options.numericTolerance });
            rollback.ok = rollback.ok !== false && rollback.verification.matched;
          } catch (rollbackReadError) {
            rollback.ok = false;
            rollback.verification = { matched: false, mismatches: [{ path: "restore", expected: "readback", actual: rollbackReadError.message || String(rollbackReadError) }] };
          }
        }
      }
      results.push({ tableIndex, ok: false, warning: "应用表格格式失败，已尝试恢复原格式。", error: { code: error.code || "TABLE_FORMAT_APPLY_FAILED", message: error.message || String(error) }, rollback, plan: performanceStats(plan) });
    }
  }
  const summary = summarizeTemplateApplication(results);
  return {
    summary,
    verified: summary.targetCount > 0 && summary.successCount === summary.targetCount,
    performance: performanceStats({
      fastPath: results.every((item) => item.plan?.fastPath === "grouped-range") ? "grouped-range" : "mixed",
      affectedCells: results.reduce((sum, item) => sum + Number(item.plan?.affectedCells || 0), 0),
      hostCallsSaved: results.reduce((sum, item) => sum + Number(item.write?.hostCallsSaved || item.plan?.hostCallsSaved || 0), 0),
      fallbackCellCount: results.reduce((sum, item) => sum + Number(item.write?.fallbackCellCount || item.plan?.fallbackCellCount || 0), 0),
      durationMs: Date.now() - started,
    }),
  };
}
