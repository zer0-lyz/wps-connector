import assert from "node:assert/strict";
import {
  applyTableFormatTransactions,
  buildDefaultTableSettingsFormat,
  buildTableFormatApplyPlan,
  compareTableFormat,
  normalizeTableFormatTemplate,
  tableFormatForApply,
} from "../vendor/connector-shared/modules/table-format-template/templateCore.js";

const sourceFormat = {
  style: "TableGrid",
  allowAutoFit: false,
  cells: [
    { row: 1, column: 1, font: { name: "宋体", size: 10.5, bold: true, italic: false, color: "#ff0000" }, paragraph: { alignment: 1, wordWrap: true }, shading: { backgroundColor: "#D9EAF7" } },
    { row: 1, column: 2, font: { name: "宋体", size: 10.5, bold: true, italic: false, color: "#ff0000" }, paragraph: { alignment: 1, wordWrap: true }, shading: { backgroundColor: "#D9EAF7" } },
    { row: 2, column: 1, font: { name: "宋体", size: 10.5, bold: false, italic: true, color: "#000000" }, paragraph: { alignment: 2, firstLineIndent: 6, wordWrap: false } },
    { row: 2, column: 2, font: { name: "宋体", size: 10.5, bold: false, italic: true, color: "#000000" }, paragraph: { alignment: 2, firstLineIndent: 6, wordWrap: false } },
  ],
  rowHeights: [{ row: 1, height: 24, unit: "point" }, { row: 2, height: 18, unit: "point" }],
  columnWidths: [{ column: 1, width: 80, unit: "point" }, { column: 2, width: 120, unit: "point" }],
  mergedCells: [],
  rowCount: 2,
  columnCount: 2,
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function templateFormat() {
  return normalizeTableFormatTemplate({
    templateId: "unit-template",
    name: "单元测试模板",
    host: "WPS",
    format: sourceFormat,
    shape: { rowCount: 2, columnCount: 2 },
  }).format;
}

function assertPerformance(stats) {
  for (const key of ["fastPath", "hostCallsSaved", "affectedCells", "fallbackCellCount", "durationMs"]) {
    assert.ok(Object.prototype.hasOwnProperty.call(stats, key), `performance missing ${key}`);
  }
}

const defaultSettings = buildDefaultTableSettingsFormat({
  rowCount: 2,
  columnCount: 3,
  values: [["项目", "金额", "说明"], ["甲", "1,234.50", "文本"]],
});
assert.equal(defaultSettings.table.autoFit, "window");
assert.equal(defaultSettings.table.repeatHeaderRows, true);
assert.deepEqual(defaultSettings.table.borders.edges.top, { type: "single", width: 1.5, color: "#000000" });
assert.deepEqual(defaultSettings.table.borders.edges.bottom, { type: "single", width: 1.5, color: "#000000" });
assert.equal(defaultSettings.table.borders.edges.left.type, "nil");
assert.equal(defaultSettings.table.borders.edges.right.type, "nil");
assert.equal(defaultSettings.table.borders.edges.insideH.width, 0.5);
assert.equal(defaultSettings.table.borders.edges.insideV.width, 0.5);
assert.equal(defaultSettings.cells.find((cell) => cell.row === 1 && cell.column === 1).verticalAlignment, "center");
assert.equal(defaultSettings.cells.find((cell) => cell.row === 2 && cell.column === 2).font.name, "Times New Roman");
const wpsDefaultApplyFormat = tableFormatForApply({ format: defaultSettings, host: "WPS" }, { host: "WPS" });
assert.deepEqual(wpsDefaultApplyFormat.table.borders.edges.top, { type: "single", width: 1.5, color: "#000000" });
assert.deepEqual(wpsDefaultApplyFormat.table.borders.edges.right, { type: "nil", width: 0, color: "#000000" });
assert.deepEqual(wpsDefaultApplyFormat.table.borders.edges.insideH, { type: "single", width: 0.5, color: "#000000" });

// Legacy flat snapshots normalize into the v2 shared shape and remain valid
// when the host adapter asks for its native apply representation.
const legacy = normalizeTableFormatTemplate({
  id: "legacy-template",
  name: "旧模板",
  host: "Office",
  format: { styleBuiltIn: "TableGrid", rowCount: 1, columnCount: 1, cells: [{ row: 1, column: 1, font: { name: "Calibri", size: 11 } }] },
});
assert.equal(legacy.schemaVersion, 2);
assert.equal(legacy.format.table.styleBuiltIn, "TableGrid");
assert.equal(tableFormatForApply(legacy, { host: "Office" }).styleBuiltIn, "TableGrid");

const widthTemplate = normalizeTableFormatTemplate({
  templateId: "width-template",
  name: "宽度模板",
  host: "Office",
  format: { table: { tableWidthType: "percent", tableWidth: 85 }, rowCount: 1, columnCount: 1 },
});
assert.equal(widthTemplate.format.table.tableWidthType, "percent");
assert.equal(tableFormatForApply(widthTemplate, { host: "Office" }).tableWidthType, "percent");

const groupedPlan = buildTableFormatApplyPlan(templateFormat());
assert.equal(groupedPlan.fastPath, "grouped-range");
assert.equal(groupedPlan.affectedCells, 4);
assert.equal(groupedPlan.hostCallsSaved, 2);
assert.deepEqual(groupedPlan.verifyCells.length > 0, true);
assertPerformance(groupedPlan);

const mergedPlan = buildTableFormatApplyPlan(normalizeTableFormatTemplate({
  templateId: "merged-template",
  name: "合并模板",
  host: "WPS",
  format: { ...sourceFormat, mergedCells: [{ startRow: 1, startColumn: 1, endRow: 1, endColumn: 2 }] },
}).format);
assert.equal(mergedPlan.fastPath, "per-cell");
assert.equal(mergedPlan.fallbackReason, "mergedCells");

const states = new Map([
  [0, { table: { style: "Old", allowAutoFit: true }, cells: [] }],
  [1, { table: { style: "Old", allowAutoFit: true }, cells: [] }],
  [2, clone(templateFormat())],
]);
const restoreCalls = [];
const transaction = await applyTableFormatTransactions({
  targets: [{ tableIndex: 0, shape: { rowCount: 2, columnCount: 2 } }, { tableIndex: 1, shape: { rowCount: 2, columnCount: 2 } }, { tableIndex: 2, shape: { rowCount: 2, columnCount: 2 } }],
  format: templateFormat(),
  host: "WPS",
  read: async (tableIndex) => ({ format: clone(states.get(tableIndex)) }),
  apply: async (tableIndex, requested) => {
    if (tableIndex === 0) states.set(tableIndex, clone(templateFormat()));
    if (tableIndex === 1) states.set(tableIndex, { table: { style: "Wrong", allowAutoFit: true }, cells: [] });
    // The third target is deliberately identical after the write, but the
    // adapter explicitly reports a rejected field. It must not be successful.
    if (tableIndex === 2) return { unsupported: ["table.allowAutoFit"], attemptedFields: Object.keys(requested) };
    return { hostCallsSaved: 2, fallbackCellCount: 0 };
  },
  restore: async (tableIndex, before) => {
    restoreCalls.push(tableIndex);
    states.set(tableIndex, clone(before));
    return { ok: true };
  },
});
assert.equal(transaction.summary.targetCount, 3);
assert.equal(transaction.summary.successCount, 1);
assert.equal(transaction.summary.verifiedCount, 1);
assert.equal(transaction.verified, false);
assert.deepEqual(restoreCalls, [1]);
assert.ok(transaction.summary.results[0].applied.includes("table.allowAutoFit"));
assert.ok(!transaction.summary.results[2].applied.includes("table.allowAutoFit"), "unsupported fields must not be listed as applied");
assert.equal(transaction.summary.results[2].unsupported[0], "table.allowAutoFit");
assert.equal(transaction.summary.results[1].rollback.verification.matched, true);
assertPerformance(transaction.performance);

const markerState = clone(templateFormat());
const markerTransaction = await applyTableFormatTransactions({
  targets: [{ tableIndex: 0, shape: { rowCount: 2, columnCount: 2 } }],
  format: templateFormat(),
  host: "WPS",
  read: async () => ({ format: clone(markerState) }),
  apply: async () => ({ attemptedButUnverified: ["table.allowAutoFit"] }),
});
assert.equal(markerTransaction.verified, true);
assert.equal(markerTransaction.summary.results[0].attemptedButUnverified.length, 0);
assert.ok(markerTransaction.summary.results[0].applied.includes("table.allowAutoFit"));

const mismatch = compareTableFormat(sourceFormat, { ...sourceFormat, table: { style: "Wrong" } });
assert.equal(mismatch.matched, false);

console.log("table format core tests ok");
