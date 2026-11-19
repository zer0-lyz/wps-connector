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
  "preferredWidth", "preferredWidthType", "allowAutoFit", "autoFit", "autoFitBehavior", "autoFitMode", "shadingColor", "tableWidthType",
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
const BORDER_KEYS = new Set(["enable", "items", "edges", "top", "left", "bottom", "right", "insideH", "insideV", "start", "end", "lineStyle", "lineWidth", "lineWidthPoints", "color", "type", "width", "rawSize", "space", "ooxml"]);
const DIMENSION_KEYS = new Set(["row", "column", "index", "height", "width", "heightRule", "unit", "columnWidth", "rowHeight"]);
const MERGE_KEYS = new Set(["startRow", "startColumn", "endRow", "endColumn", "row", "column", "rowSpan", "columnSpan"]);

export const TABLE_FORMAT_FIELD_WHITELIST = Object.freeze([
  "table.*", "cells[].row", "cells[].column", "cells[].font.*", "cells[].paragraph.*", "cells[].shading.*",
  "cells[].borders.*", "cells[].padding.*", "cells[].verticalAlignment", "cells[].numberFormat", "cells[].numberFormatLocal",
  "rowHeights[].*", "columnWidths[].*", "mergedCells[].*", "rowCount", "columnCount",
]);

/**
 * First-release table settings preset. Values are host-neutral; adapters map
 * alignment names, font properties and the point-based row height to their
 * native WPS/Word APIs. Border widths are expressed in points; the shared
 * builder emits them both as the semantic `type`/`width`/`color` edges that
 * the shipped WPS/Office adapters already persist and apply, and as
 * host-neutral `lineStyle`/`lineWidthPoints` hints for newer hosts. The
 * preset deliberately contains no number display format: this feature
 * changes appearance, not cell values. Its border geometry follows the
 * approved Writer layout: thick top/bottom rules, thin internal horizontal
 * and vertical rules, and no outer side borders.
 */
export const TABLE_SETTINGS_DEFAULT_PRESET = Object.freeze({
  id: "default",
  name: "默认表格格式",
  textFontName: "宋体",
  numberFontName: "Times New Roman",
  fontSize: 10,
  rowHeightCm: 0.6,
  rowHeightPoints: 17.00787401574803,
  rowHeightRule: "atLeast",
  autoFit: "window",
  repeatHeaderRows: true,
  headerBold: true,
  headerAlignment: "center",
  numberAlignment: "right",
  textAlignment: "left",
  verticalAlignment: "center",
  borderLineStyle: 1,
  borderInnerWidthPoints: 0.5,
  borderOuterWidthPoints: 1.5,
  borderColor: "#000000",
});

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
function canonicalAlignment(value) {
  if (value === undefined || value === null || value === "") return value;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && String(value).trim() !== "") {
    if (numeric === 0) return "left";
    if (numeric === 1) return "center";
    if (numeric === 2) return "right";
    if (numeric === 3) return "justify";
  }
  const text = String(value).trim().toLowerCase().replace(/[\s_-]+/g, "");
  if (/^(left|start|wdalignparagraphleft)$/.test(text)) return "left";
  if (/^(center|centred|centered|middle|wdalignparagraphcenter)$/.test(text)) return "center";
  if (/^(right|end|wdalignparagraphright)$/.test(text)) return "right";
  if (/^(justify|justified|wdalignparagraphjustify)$/.test(text)) return "justify";
  return text;
}
function normalizeLeaf(value, key = "") {
  if (!defined(value)) return undefined;
  if (typeof value === "string") {
    const text = value.trim();
    if (!text || text === "unsupported") return undefined;
    if (/color/i.test(key)) return canonicalColor(text);
    if (/alignment/i.test(key)) return canonicalAlignment(text);
    return text;
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
      const nestedAllowed = key === "font" ? FONT_KEYS : key === "paragraph" ? PARAGRAPH_KEYS : key === "shading" ? SHADING_KEYS : key === "borders" || key === "edges" || ["top", "left", "bottom", "right", "insideH", "insideV", "start", "end"].includes(key) ? BORDER_KEYS : key === "padding" || key === "cellPadding" ? DIMENSION_KEYS : key === "headerRowStyle" || key === "bodyRowStyle" ? TABLE_KEYS : null;
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
  const allowed = key === "table" ? TABLE_KEYS : key === "cells[]" ? CELL_KEYS : key === "font" ? FONT_KEYS : key === "paragraph" ? PARAGRAPH_KEYS : key === "shading" ? SHADING_KEYS : key === "borders" || key === "edges" || ["top", "left", "bottom", "right", "insideH", "insideV", "start", "end"].includes(key) ? BORDER_KEYS : key === "padding" ? DIMENSION_KEYS : TABLE_KEYS;
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
const BORDER_EDGE_PATH = /(?:^|\.)borders\.edges\.[A-Za-z]+$/;
const BORDER_EDGE_LINE_STYLES = new Map([
  ["none", 0], ["nil", 0], ["single", 1], ["solid", 1],
]);
function isBorderEdgePath(path) {
  return BORDER_EDGE_PATH.test(String(path || ""));
}
/** Collapse the dual border-edge spellings into one comparable view. */
function canonicalBorderEdge(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const output = {};
  const lineStyle = value.lineStyle ?? value.type;
  const widthPoints = value.lineWidthPoints ?? value.width;
  if (lineStyle !== undefined && lineStyle !== null && lineStyle !== "") {
    const numeric = Number(lineStyle);
    output.type = Number.isFinite(numeric) && String(lineStyle).trim() !== ""
      ? (numeric === 0 ? "nil" : numeric === 1 ? "single" : String(lineStyle))
      : String(lineStyle).trim().toLowerCase();
  }
  if (widthPoints !== undefined && widthPoints !== null) output.width = Number(widthPoints);
  // A `nil` edge has no visible line: hosts legitimately omit its color, and
  // the aggregate tri-state can flip it, so color is only meaningful when the
  // edge actually draws something.
  if (output.type !== "nil" && value.color !== undefined && value.color !== null && value.color !== "") {
    output.color = canonicalColor(String(value.color));
  }
  if (value.rawSize !== undefined) output.rawSize = value.rawSize;
  if (value.space !== undefined) output.space = value.space;
  return output;
}
function canonicalAutoFit(value) {
  if (value === true) return "enabled";
  if (value === false) return "disabled";
  const text = typeof value === "string" ? value.trim().toLowerCase() : value;
  if (["true", "enabled", "window"].includes(text)) return "enabled";
  if (["false", "disabled", "none"].includes(text)) return "disabled";
  return text;
}
function numericEqual(expected, actual, options) {
  if (typeof expected !== "number" || typeof actual !== "number") return false;
  const tolerance = Number(options.numericTolerance ?? 0.01);
  return Number.isFinite(expected) && Number.isFinite(actual) && Math.abs(expected - actual) <= tolerance;
}
function canonicalRowHeightRule(value) {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && String(value ?? "").trim() !== "") {
    if (numeric === 0) return "auto";
    if (numeric === 1 || numeric === 3) return "atLeast";
    if (numeric === 2 || numeric === 4) return "exactly";
  }
  const text = String(value ?? "").trim().toLowerCase().replace(/[\s_-]+/g, "");
  if (["atleast", "minimum", "min"].includes(text)) return "atLeast";
  if (["exactly", "exact", "fixed"].includes(text)) return "exactly";
  if (["auto", "automatic"].includes(text)) return "auto";
  return text;
}
function compareRowHeightItem(expected, actual, path, mismatches, options = {}) {
  const expectedRule = expected?.heightRule === undefined || expected?.heightRule === null
    ? undefined
    : canonicalRowHeightRule(expected.heightRule);
  const expectedHeight = Number(expected?.height);
  const actualHeight = Number(actual?.height);
  if (Number.isFinite(expectedHeight)) {
    const tolerance = Number(options.rowHeightTolerance ?? Math.max(Number(options.numericTolerance ?? 0.01), 0.2));
    const heightMatches = expectedRule === "atLeast"
      ? Number.isFinite(actualHeight) && actualHeight + tolerance >= expectedHeight
      : Number.isFinite(actualHeight) && Math.abs(actualHeight - expectedHeight) <= tolerance;
    if (!heightMatches) mismatches.push({ path: `${path}.height`, expected: expected.height, actual: actual?.height ?? null });
  }
  for (const [key, value] of Object.entries(expected || {})) {
    if (key === "row" || key === "index" || key === "height") continue;
    if (key === "heightRule") {
      const actualRule = actual?.heightRule === undefined || actual?.heightRule === null
        ? undefined
        : canonicalRowHeightRule(actual.heightRule);
      if (expectedRule !== actualRule) mismatches.push({ path: `${path}.heightRule`, expected: value, actual: actual?.heightRule ?? null });
      continue;
    }
    compareValue(value, actual?.[key], `${path}.${key}`, mismatches, options);
  }
}
function compareValue(expected, actual, path, mismatches, options = {}) {
  if (!defined(expected) && typeof expected !== "boolean" && typeof expected !== "number") return;
  if (expected && typeof expected === "object" && !Array.isArray(expected)) {
    // Border edges can legitimately appear in two spellings: the semantic
    // `type`/`width`/`color` form saved in existing documents and applied by
    // the shipped adapters, and the host-neutral `lineStyle`/`lineWidthPoints`
    // hints the shared preset carries. Hosts echo back only the spelling they
    // natively produce, so before descending, collapse both spellings of the
    // same edge into one canonical view; otherwise every real verification
    // would fail on fields the host never reports.
    if (isBorderEdgePath(path) && !options.edgeCanonicalized) {
      const canonicalExpected = canonicalBorderEdge(expected);
      const canonicalActual = canonicalBorderEdge(actual);
      if (canonicalExpected && canonicalActual) {
        compareValue(canonicalExpected, canonicalActual, path, mismatches, { ...options, edgeCanonicalized: true });
        return;
      }
    }
    if (!actual || typeof actual !== "object") { mismatches.push({ path: pathLabel(path), expected, actual: null }); return; }
    // Border `enable` is an aggregate/tri-state host property on both WPS and
    // Word. When explicit edge geometry is present, a host may legitimately
    // report it as false or mixed even though the requested visible edges are
    // correct (in particular, no outer side borders plus visible inside
    // rules). The edge entries below are the authoritative verification in
    // that case; do not let the aggregate flag trigger a destructive rollback.
    const explicitBorderGeometry = (path.endsWith("borders") || path.endsWith("edges"))
      && (Object.keys(expected.edges || {}).length > 0 || (Array.isArray(expected.items) && expected.items.length > 0));
    for (const [key, value] of Object.entries(expected)) {
      if (META_KEYS.has(key)) continue;
      if (explicitBorderGeometry && key === "enable") continue;
      if (options.ignoreShape && ["rowCount", "columnCount"].includes(key)) continue;
      if (options.ignoreLayout && ["rowHeights", "columnWidths", "mergedCells"].includes(key)) continue;
      compareValue(value, actual[key], path ? `${path}.${key}` : key, mismatches, options);
    }
    return;
  }
  if (Array.isArray(expected)) {
    // An empty keyed collection means that the caller did not request this
    // dimension/merge set. Default table settings intentionally leave column
    // widths and merged cells untouched, so an existing host collection must
    // not turn a verified write into a false mismatch.
    if (!expected.length) return;
    if (!Array.isArray(actual)) { mismatches.push({ path: pathLabel(path), expected, actual: null }); return; }
    const keyed = path.endsWith("cells") || path.endsWith("rowHeights") || path.endsWith("columnWidths") || path.endsWith("mergedCells");
    if (keyed) {
      const keys = path.endsWith("cells") ? ["row", "column"] : path.endsWith("rowHeights") ? ["row"] : path.endsWith("columnWidths") ? ["column"] : ["startRow", "startColumn", "endRow", "endColumn"];
      for (const item of expected) {
        const found = actual.find((candidate) => keys.every((key) => candidate?.[key] === item?.[key]));
        if (!found) mismatches.push({ path: `${path}[${keys.map((key) => item?.[key]).join(":")}]`, expected: item, actual: null });
        else if (path.endsWith("rowHeights")) compareRowHeightItem(item, found, `${path}[${keys.map((key) => item?.[key]).join(":")}]`, mismatches, options);
        else compareValue(item, found, `${path}[${keys.map((key) => item?.[key]).join(":")}]`, mismatches, options);
      }
      return;
    }
    if (expected.length !== actual.length) { mismatches.push({ path: pathLabel(path), expectedLength: expected.length, actualLength: actual.length }); return; }
    expected.forEach((value, index) => compareValue(value, actual[index], `${path}[${index}]`, mismatches, options));
    return;
  }
  if (numericEqual(expected, actual, options)) return;
  const expectedComparable = /alignment/i.test(path)
    ? canonicalAlignment(expected)
    : /(?:^|\.)autoFit$/i.test(path)
      ? canonicalAutoFit(expected)
      : comparablePrimitive(expected);
  const actualComparable = /alignment/i.test(path)
    ? canonicalAlignment(actual)
    : /(?:^|\.)autoFit$/i.test(path)
      ? canonicalAutoFit(actual)
      : comparablePrimitive(actual);
  if (expectedComparable !== actualComparable) mismatches.push({ path: pathLabel(path), expected, actual: actual ?? null });
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

/** Recognize numeric display values without classifying dates or identifiers. */
export function isNumericTableValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) return true;
  const text = String(value ?? "").trim();
  if (!text || /^[-+]?\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}$/.test(text)) return false;
  return /^\(?[-+]?\s*(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\s*%?\)?$/.test(text);
}

/** Build the shared default settings format for one concrete table shape. */
export function buildDefaultTableSettingsFormat({ rowCount = 0, columnCount = 0, values = [], preset = TABLE_SETTINGS_DEFAULT_PRESET } = {}) {
  const rows = Math.max(0, Math.floor(Number(rowCount) || 0));
  const columns = Math.max(0, Math.floor(Number(columnCount) || 0));
  const cells = [];
  const rowHeights = [];
  for (let row = 1; row <= rows; row += 1) {
    rowHeights.push({ row, height: Number(preset.rowHeightPoints), unit: "points", heightRule: 1 });
    for (let column = 1; column <= columns; column += 1) {
      const header = row === 1;
      const numeric = !header && isNumericTableValue(values?.[row - 1]?.[column - 1]);
      cells.push({
        row,
        column,
        font: { name: numeric ? preset.numberFontName : preset.textFontName, size: Number(preset.fontSize), bold: header ? Boolean(preset.headerBold) : false },
        paragraph: { alignment: header ? preset.headerAlignment : numeric ? preset.numberAlignment : preset.textAlignment },
        verticalAlignment: preset.verticalAlignment,
      });
    }
  }
  const borderStyle = Number(preset.borderLineStyle);
  const outerWidth = Number(preset.borderOuterWidthPoints);
  const innerWidth = Number(preset.borderInnerWidthPoints);
  const borderColor = preset.borderColor ?? "#000000";
  // Border edges use exactly the semantic shape (`type`/`width`/`color`) that
  // the shipped WPS/Office adapters already apply, verify against and persist
  // in saved documents. The point-based preset values above stay host-neutral;
  // adapter converters translate them to native enums at apply time.
  const edge = (lineStyle, widthPoints) => lineStyle === 0
    ? { type: "nil", width: 0, color: borderColor }
    : { type: "single", width: widthPoints, color: borderColor };
  return {
    table: {
      repeatHeaderRows: rows > 0 ? Boolean(preset.repeatHeaderRows) : false,
      // Both adapters already ship `autoFit: "window"` semantics (WPS maps
      // true/"window"/2 to fit-to-window, Office treats true and "window"
      // identically). Keep the canonical string form so verification and the
      // saved format stay identical across hosts.
      autoFit: preset.autoFit || "window",
      borders: {
        enable: true,
        edges: {
          top: edge(borderStyle, outerWidth),
          bottom: edge(borderStyle, outerWidth),
          left: edge(0, 0),
          right: edge(0, 0),
          insideH: edge(borderStyle, innerWidth),
          insideV: edge(borderStyle, innerWidth),
        },
      },
    },
    rowHeights,
    columnWidths: [],
    mergedCells: [],
    cells,
    rowCount: rows,
    columnCount: columns,
  };
}

/** Resolve UI/API table scope into a validated, de-duplicated 0-based list. */
export function resolveTableTargetIndexes({ target = "All", tableIndexes = [], tableCount = 0, selectedTableIndex = null } = {}) {
  const count = Math.max(0, Math.floor(Number(tableCount) || 0));
  const all = Array.from({ length: count }, (_, index) => index);
  const selected = Number.isInteger(Number(selectedTableIndex)) && Number(selectedTableIndex) >= 0 && Number(selectedTableIndex) < count
    ? Number(selectedTableIndex) : null;
  const requested = Array.isArray(tableIndexes) ? tableIndexes : [];
  const normalized = [...new Set(requested.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value >= 0))];
  const invalidTableIndexes = normalized.filter((index) => index >= count);
  const kind = String(target || "All").trim().toLowerCase();
  let indexes;
  let excludedTableIndexes = [];
  if (["selection", "selected", "current"].includes(kind)) indexes = selected === null ? [] : [selected];
  else if (["tableindexes", "selectedtables", "multi", "multiple"].includes(kind)) indexes = normalized.filter((index) => index < count);
  else if (["exceptselection", "exceptselected"].includes(kind)) {
    excludedTableIndexes = selected === null ? [] : [selected];
    indexes = selected === null ? [] : all.filter((index) => index !== selected);
  } else indexes = all;
  return { target, tableIndexes: [...indexes], targetIndexes: [...indexes], excludedTableIndexes, invalidTableIndexes, selectedTableIndex: selected, tableCount: count };
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
    durationMs: 0,
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
    verifiedCount: normalized.filter((item) => item?.ok === true && item?.verification?.matched === true).length,
    failedCount: normalized.filter((item) => item?.ok !== true).length,
    unsupportedCount: normalized.reduce((count, item) => count + (item?.unsupported?.length || 0), 0),
    attemptedButUnverifiedCount: normalized.reduce((count, item) => count + (item?.attemptedButUnverified?.length || 0), 0),
    results: normalized,
  };
}

function statusPath(value) {
  return String(value || "")
    .replace(/^format\./, "")
    .replace(/\[\d+(?::\d+)?\]/g, "[]")
    .replace(/\[\]/g, "")
    .replace(/\.+/g, ".")
    .replace(/^\.|\.$/g, "");
}

function fieldMatchesStatus(field, status) {
  const left = statusPath(field);
  const right = statusPath(status);
  if (!left || !right) return false;
  return left === right || left.startsWith(`${right}.`) || right.startsWith(`${left}.`);
}

function filterAppliedFields(fields, excluded) {
  return [...new Set(fields || [])].filter((field) => !(excluded || []).some((status) => fieldMatchesStatus(field, status)));
}

function tableFormatVerificationSubset(format, verifyCells = []) {
  const normalized = normalizeTableFormatSnapshot(format).format;
  const positions = new Set((verifyCells || []).map((cell) => `${Number(cell.row)}:${Number(cell.column)}`));
  return {
    ...clone(normalized),
    table: clone(normalized.table || {}),
    cells: (normalized.cells || []).filter((cell) => positions.has(`${Number(cell.row)}:${Number(cell.column)}`)),
    // Row heights are cheap compared with cell formatting and are part of the
    // default preset's contract, so verify the complete height vector.
    rowHeights: clone(normalized.rowHeights || []),
    // The sample-readback path is only used when the caller explicitly opts
    // into it. Layout collections remain untouched unless they were requested.
    columnWidths: (normalized.columnWidths || []).length ? clone(normalized.columnWidths) : [],
    mergedCells: (normalized.mergedCells || []).length ? clone(normalized.mergedCells) : [],
  };
}

/** Shared transaction runner. Only callback implementations touch host APIs. */
export async function applyTableFormatTransactions({ targets = [], format = {}, host = "", read, apply, execute, executeBatch, restore, options = {} }) {
  const started = Date.now();
  const results = [];
  const beforeByTable = new Map();
  const reportProgress = (phase, details = {}) => {
    try { options.onProgress?.({ phase, ...details }); } catch {}
  };

  // A host adapter may collapse a multi-table operation into one native
  // command. The command must return one real before/after snapshot per
  // target; this runner still performs the authoritative comparison below.
  // If the command is unavailable, the adapter may throw before changing the
  // document and the runner falls back to the established per-target path.
  const preparedTargets = targets.map((target) => {
    const tableIndex = typeof target === "object" ? target.tableIndex : target;
    const targetShape = typeof target === "object" ? target.shape || {} : {};
    const targetFormat = typeof format === "function" ? format(target) : format;
    const plan = buildTableFormatApplyPlan(fitTableFormatToShape(targetFormat, targetShape), options);
    return { target, tableIndex, plan, requested: tableFormatForApply({ format: plan.format, host }, { host }) };
  });
  let batchTransactions = null;
  if (typeof executeBatch === "function" && preparedTargets.length > 1) {
    try {
      reportProgress("batch_start", { targetCount: preparedTargets.length });
      const batchResult = await executeBatch(preparedTargets);
      const batchItems = Array.isArray(batchResult) ? batchResult : batchResult?.results;
      if (!Array.isArray(batchItems) || batchItems.length !== preparedTargets.length) {
        throw Object.assign(new Error("Batch host command returned an incomplete target result."), { code: "TABLE_FORMAT_BATCH_INCOMPLETE" });
      }
      batchTransactions = new Map(batchItems.map((item, index) => [
        Number.isInteger(Number(item?.tableIndex)) ? Number(item.tableIndex) : preparedTargets[index].tableIndex,
        item,
      ]));
      if (batchTransactions.size !== preparedTargets.length) {
        throw Object.assign(new Error("Batch host command returned duplicate table indexes."), { code: "TABLE_FORMAT_BATCH_DUPLICATE_TARGET" });
      }
      reportProgress("batch_ready", { targetCount: preparedTargets.length });
    } catch (error) {
      // An unsupported/new command is safe to retry one target at a time. A
      // host adapter that may have mutated the document must return a complete
      // result instead of throwing, so this fallback never knowingly retries a
      // partially applied batch.
      batchTransactions = null;
      reportProgress("batch_fallback", { targetCount: preparedTargets.length, error: { code: error?.code || "TABLE_FORMAT_BATCH_UNAVAILABLE", message: error?.message || String(error) } });
    }
  }

  const restoreOne = async (tableIndex, before, plan, verify = options.verifyRestore !== false) => {
    if (!before) return null;
    let rollback;
    try {
      rollback = await restore?.(tableIndex, before?.format || before || {});
    } catch (error) {
      rollback = { ok: false, error: { code: error.code || "ROLLBACK_FAILED", message: error.message || String(error) } };
    }
    if (rollback && verify) {
      try {
        const restored = await read(tableIndex, { phase: "restore", plan });
        const expectedRestore = options.verifyRestoreSample === true
          ? tableFormatVerificationSubset(before?.format || before || {}, plan?.verifyCells || [])
          : (before?.format || before || {});
        rollback.verification = compareTableFormat(expectedRestore, restored?.format || restored || {}, { ignoreShape: true, numericTolerance: options.numericTolerance });
        rollback.ok = rollback.ok !== false && rollback.verification.matched;
      } catch (error) {
        rollback.ok = false;
        rollback.verification = { matched: false, mismatches: [{ path: "restore", expected: "readback", actual: error.message || String(error) }] };
      }
    }
    return rollback;
  };

  // A verification mismatch is different from a host-command exception. The
  // adapter has already performed the real write and any bounded field-level
  // retries by this point. Restoring a light snapshot here can be harmful for
  // the fixed WPS preset: WPS may expose an aggregate border or row-height
  // readback that is stale/tri-state even though the visible geometry was just
  // written. Replaying that snapshot can turn the requested no-side-border /
  // 0.6cm result back into the user's old full-grid / 0.55cm layout. Callers
  // may preserve the attempted result on a pure verification failure while
  // still using restoreOne for thrown write errors and prior successful targets
  // in an atomic batch.
  const shouldRestoreVerificationFailure = options.rollbackOnVerificationFailure !== false;

  const rollbackSuccessfulBatch = async () => {
    if (options.atomic !== true) return [];
    const rolledBack = [];
    for (const item of results) {
      if (item?.ok !== true) continue;
      const before = beforeByTable.get(item.tableIndex);
      const rollback = await restoreOne(item.tableIndex, before, item.plan);
      item.rollback = rollback;
      item.batchRolledBack = true;
      item.ok = false;
      item.applied = [];
      item.warning = "批量应用未完整验证，已回滚本批次此前已应用的表格。";
      rolledBack.push({ tableIndex: item.tableIndex, rollback });
    }
    return rolledBack;
  };

  for (const [targetPosition, target] of targets.entries()) {
    const prepared = preparedTargets[targetPosition];
    const tableIndex = prepared.tableIndex;
    const plan = prepared.plan;
    const requested = prepared.requested;
    let before;
    let transactionResult = null;
    let after = null;
    try {
      reportProgress("before_read", { tableIndex, targetIndex: targetPosition, targetCount: targets.length, plan: performanceStats(plan) });
      const batchedTransaction = batchTransactions?.get(tableIndex);
      if (batchedTransaction) {
        reportProgress("apply", { tableIndex, targetIndex: targetPosition, targetCount: targets.length, plan: performanceStats(plan), batch: true });
        transactionResult = batchedTransaction;
        before = transactionResult?.before || null;
        after = transactionResult?.after || null;
        if (!before) before = await read(tableIndex, { phase: "before", plan });
        if (!after) after = await read(tableIndex, { phase: "after", plan });
      } else if (typeof execute === "function") {
        // Host adapters may execute read-before -> write -> read-after inside
        // one host command. This preserves the shared transaction contract
        // while avoiding multiple command-pump round trips for slow WPS/Word
        // documents. The adapter must return actual snapshots, never a
        // synthetic verification result.
        reportProgress("apply", { tableIndex, targetIndex: targetPosition, targetCount: targets.length, plan: performanceStats(plan) });
        transactionResult = await execute(tableIndex, requested, plan);
        before = transactionResult?.before || null;
        after = transactionResult?.after || null;
        if (!before) before = await read(tableIndex, { phase: "before", plan });
        if (!after) after = await read(tableIndex, { phase: "after", plan });
      } else {
        before = await read(tableIndex, { phase: "before", plan });
        reportProgress("apply", { tableIndex, targetIndex: targetPosition, targetCount: targets.length, plan: performanceStats(plan) });
        transactionResult = { write: await apply(tableIndex, requested, plan) };
        after = await read(tableIndex, { phase: "after", plan });
      }
      beforeByTable.set(tableIndex, before);
      reportProgress("after_read", { tableIndex, targetIndex: targetPosition, targetCount: targets.length, plan: performanceStats(plan) });
      const writeResult = transactionResult?.write || transactionResult || {};
      const expectedAfter = options.verifySample === true
        ? tableFormatVerificationSubset(plan.format, plan.verifyCells)
        : plan.format;
      const verification = writeResult?.verification?.authoritative === true && typeof writeResult.verification.matched === "boolean"
        ? writeResult.verification
        : compareTableFormat(expectedAfter, after?.format || after || {}, { ignoreShape: true, numericTolerance: options.numericTolerance });
      const attemptedFields = collectTableFormatFields(plan.format);
      const statusFields = (values) => [...new Set(values || [])].filter((field) => attemptedFields.some((attempted) => fieldMatchesStatus(attempted, field)));
      const unsupported = statusFields([
        ...(writeResult?.unsupported || []),
        ...(writeResult?.unsupportedFields || []),
        ...(writeResult?.hostRejectedFields || []),
        ...(after?.unsupported || []),
        ...(after?.unsupportedFields || []),
      ]);
      const mismatchedFields = verification.mismatches.map((item) => item.path);
      const attemptedButUnverified = statusFields([
        ...(writeResult?.attemptedButUnverified || []),
        ...(writeResult?.attemptedFields || []),
        ...(after?.attemptedButUnverified || []),
        ...(verification.matched ? [] : mismatchedFields),
      ]).filter((field) => !unsupported.includes(field));
      // A host adapter may need to use an API that cannot acknowledge a
      // setter synchronously (for example Word repeat-header or OOXML
      // insertion).  The post-write snapshot is the authoritative result:
      // when every requested field matches, those provisional markers must be
      // promoted to applied instead of making an actually verified operation
      // fail.  Explicit unsupported fields remain a hard boundary.
      const authoritativeAdapterVerification = writeResult?.verification?.authoritative === true;
      const adapterVerifiedFields = new Set(authoritativeAdapterVerification ? (writeResult.verification.verifiedFields || []) : []);
      const unresolvedAttemptedButUnverified = verification.matched
        ? (authoritativeAdapterVerification ? attemptedButUnverified.filter((field) => !adapterVerifiedFields.has(field)) : [])
        : attemptedButUnverified;
      const candidateAppliedFields = verification.matched
        ? filterAppliedFields(attemptedFields, [...unsupported, ...unresolvedAttemptedButUnverified])
        : [];
      const appliedFields = verification.matched && authoritativeAdapterVerification && Array.isArray(writeResult.verification.verifiedFields)
        ? candidateAppliedFields.filter((field) => adapterVerifiedFields.has(field) || [...adapterVerifiedFields].some((verifiedField) => fieldMatchesStatus(field, verifiedField)))
        : candidateAppliedFields;
      let rollback = null;
      if (!verification.matched && shouldRestoreVerificationFailure) {
        reportProgress("restore", { tableIndex, targetIndex: results.length, targetCount: targets.length, plan: performanceStats(plan) });
        rollback = await restoreOne(tableIndex, before, plan);
      } else if (!verification.matched) {
        rollback = {
          ok: false,
          skipped: true,
          reason: "verification-failure-preserved",
          warning: "写入后回读存在未确认字段，保留宿主已写入结果，未用旧快照覆盖目标表格。",
        };
      }
      results.push({
        tableIndex,
        ok: verification.matched && unsupported.length === 0 && unresolvedAttemptedButUnverified.length === 0,
        applied: appliedFields,
        unsupported,
        attemptedButUnverified: unresolvedAttemptedButUnverified,
        warning: writeResult?.warning || (verification.matched && unsupported.length === 0 && unresolvedAttemptedButUnverified.length === 0
          ? undefined
          : verification.matched
            ? "部分格式字段未被宿主接受或无法确认，未计入成功字段。"
            : shouldRestoreVerificationFailure
              ? "写入后回读不一致，已尝试恢复原格式。"
              : "写入后回读存在未确认字段，已保留宿主已写入结果；未确认字段未计入成功。"),
        write: writeResult,
        verification,
        rollback,
        plan: performanceStats(plan),
      });
      if (results.at(-1)?.ok !== true) await rollbackSuccessfulBatch();
    } catch (error) {
      let rollback = null;
      if (before) {
        reportProgress("restore", { tableIndex, targetIndex: results.length, targetCount: targets.length, plan: performanceStats(plan) });
        rollback = await restoreOne(tableIndex, before, plan);
      }
      results.push({ tableIndex, ok: false, warning: "应用表格格式失败，已尝试恢复原格式。", error: { code: error.code || "TABLE_FORMAT_APPLY_FAILED", message: error.message || String(error) }, rollback, plan: performanceStats(plan) });
      await rollbackSuccessfulBatch();
    }
  }
  reportProgress("complete", { targetCount: targets.length, completedCount: results.length });
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
