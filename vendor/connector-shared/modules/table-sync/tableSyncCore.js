export const DEFAULT_TRANSFER_POLICY = Object.freeze({
  transferPolicy: "display-values-only",
  preserveTargetStyle: true,
  applySourceFormatting: false,
});

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export function normalizeTransferPolicy(input = {}) {
  const record = isRecord(input) ? input : {};
  const nested = isRecord(record.transferPolicy) ? record.transferPolicy : record;
  const requestedPolicy = typeof record.transferPolicy === "string"
    ? record.transferPolicy
    : nested.transferPolicy ?? nested.valueMode ?? nested.mode;
  const transferPolicy = requestedPolicy === "display-values-only"
    ? requestedPolicy
    : DEFAULT_TRANSFER_POLICY.transferPolicy;

  // Formatting switches from legacy records are intentionally not carried forward.
  return {
    transferPolicy,
    preserveTargetStyle: true,
    applySourceFormatting: false,
  };
}

export function cleanCellValue(value) {
  return String(value ?? "").replace(/\r?\n/g, " ").trim();
}

function toMatrix(value) {
  if (!Array.isArray(value) || value.length === 0) return [];
  if (!Array.isArray(value[0])) return [value.slice()];
  return value.map((row) => (Array.isArray(row) ? row.slice() : [row]));
}

export function asMatrix(value) {
  if (!Array.isArray(value)) return [];
  if (!Array.isArray(value[0])) return [value.map((cell) => cell ?? "")];
  return value.map((row) => (Array.isArray(row) ? row.map((cell) => cell ?? "") : [row ?? ""]));
}

const DISPLAY_PLACEHOLDER_DASHES = "-‐‑‒–—−－";

/**
 * Normalize text copied from a spreadsheet without changing meaningful spaces
 * inside a text value. Spreadsheet hosts commonly pad a dash placeholder with
 * spaces, so treat that shape as a single dash before transferring it.
 */
export function normalizeDisplayText(value, display) {
  const source = display === undefined || display === null ? value : display;
  if (source === undefined || source === null) return "";
  const raw = String(source);
  const trimmed = raw.replace(/\r?\n/g, " ").trim();
  if (!trimmed) return "";
  if (new RegExp(`^\\s*[${DISPLAY_PLACEHOLDER_DASHES}]\\s*$`, "u").test(raw)) return "-";
  return trimmed;
}

function resolveDisplayText(value) {
  if (!isRecord(value)) return value;
  if (hasOwn(value, "displayText") && value.displayText !== undefined && value.displayText !== null) {
    return value.displayText;
  }
  if (hasOwn(value, "text")) return value.text;
  return undefined;
}

const NUMERIC_DISPLAY_CHARACTERS = /^[+\-−()（）$€£¥￥₹,.\d%]+$/;

function numericCellValue(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const raw = value.trim();
  // String values with leading zeroes may be identifiers, not numbers.
  if (!raw || /^[-+]?0\d/.test(raw) || !/^[-+]?\d+(?:\.\d+)?$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeNumericDisplayText(value, display) {
  const original = normalizeDisplayText(value, display);
  if (numericCellValue(value) === null) return original;
  const trimmed = String(original).trim();
  if (trimmed === "-") return "-";
  const compact = trimmed.replace(/\s+/g, "");
  if (!compact || !/\d/.test(compact) || !NUMERIC_DISPLAY_CHARACTERS.test(compact)) return original;
  return compact;
}

export function buildDisplayValueMatrix(values, displayTextOrText) {
  const valueMatrix = toMatrix(values);
  const displayMatrix = toMatrix(resolveDisplayText(displayTextOrText));
  const rowCount = Math.max(valueMatrix.length, displayMatrix.length);
  const columnCount = Math.max(
    0,
    ...valueMatrix.map((row) => row.length),
    ...displayMatrix.map((row) => row.length),
  );

  return Array.from({ length: rowCount }, (_, rowIndex) => {
    const valueRow = valueMatrix[rowIndex] || [];
    const displayRow = displayMatrix[rowIndex] || [];
    return Array.from({ length: columnCount }, (_, columnIndex) => {
      const displayCell = displayRow[columnIndex];
      if (displayCell !== undefined && displayCell !== null) {
        return normalizeNumericDisplayText(valueRow[columnIndex], displayCell);
      }
      const valueCell = valueRow[columnIndex] ?? "";
      return typeof valueCell === "string" ? normalizeDisplayText(valueCell) : valueCell;
    });
  });
}

/**
 * Both first insert and subsequent sync use this value-only payload shape.
 * Formatting is intentionally absent so the target remains the style owner.
 */
export function buildValueOnlyTransferPayload(values, displayTextOrText, policyInput = {}) {
  return {
    values: buildDisplayValueMatrix(values, displayTextOrText),
    transferPolicy: normalizeTransferPolicy(policyInput),
  };
}

export function normalizeTableRows(rows, options = {}) {
  const matrix = asMatrix(rows);
  const columnCount = Math.max(Number(options.columnCount || 0), ...matrix.map((row) => row.length), 0);
  return matrix
    .map((row) => {
      const next = [...row];
      while (next.length < columnCount) next.push("");
      return next.slice(0, columnCount).map((cell) => cell ?? "");
    })
    .filter((row) => options.preserveEmptyRows || row.some((cell) => cleanCellValue(cell)));
}

export function normalizeSyncConfig(input = {}, sourceColumnCount = 0, targetColumnCount = 0) {
  const headerRowCount = Math.max(0, Math.floor(Number(input.headerRowCount ?? 1)));
  const syncHeader = input.syncHeader === true;
  const requestedColumns = Array.isArray(input.columnMapping) ? input.columnMapping : [];
  const columnMapping = requestedColumns.length
    ? requestedColumns.map((value) => Math.floor(Number(value))).filter((value) => Number.isInteger(value) && value > 0)
    : Array.from({ length: targetColumnCount || sourceColumnCount }, (_, index) => index + 1);
  if (columnMapping.length && new Set(columnMapping).size !== columnMapping.length) {
    throw { status: 400, code: "DUPLICATE_COLUMN_MAPPING", message: "Each target column may map to a source column only once." };
  }
  if (sourceColumnCount && columnMapping.some((value) => value > sourceColumnCount)) {
    throw { status: 400, code: "COLUMN_MAPPING_OUT_OF_RANGE", message: "A mapped column is outside the source range.", details: { columnMapping, sourceColumnCount } };
  }
  if (targetColumnCount && columnMapping.length !== targetColumnCount) {
    throw { status: 400, code: "COLUMN_MAPPING_TARGET_MISMATCH", message: "Column mapping count must equal the target table column count.", details: { columnMapping, targetColumnCount } };
  }
  const sortColumn = Number(input.sortColumn || 0);
  return {
    transferPolicy: normalizeTransferPolicy(input),
    headerRowCount,
    syncHeader,
    columnMapping,
    sort: {
      enabled: Number.isInteger(sortColumn) && sortColumn > 0,
      column: Number.isInteger(sortColumn) && sortColumn > 0 ? sortColumn : null,
      direction: input.sortDirection === "asc" ? "asc" : "desc",
      otherItemsBottom: Boolean(input.otherItemsBottom),
    },
    rowMatch: {
      enabled: input.rowMatchEnabled !== false,
      keyColumn: Math.max(1, Math.floor(Number(input.rowMatchKeyColumn || 1))),
      preserveUnmatchedWordRows: input.preserveUnmatchedWordRows !== false,
      appendNewExcelRows: input.appendNewExcelRows !== false,
      mode: input.rowMatchMode || "key",
    },
  };
}

export function mapSyncRows(rows, config, displayTextOrText) {
  const syncConfig = isRecord(config) ? config : normalizeSyncConfig();
  const rowEnvelope = isRecord(rows) && hasOwn(rows, "values") ? rows : null;
  const sourceValues = rowEnvelope ? rowEnvelope.values : rows;
  const displayInput = displayTextOrText !== undefined
    ? displayTextOrText
    : rowEnvelope;
  const transfer = buildValueOnlyTransferPayload(sourceValues, displayInput, syncConfig);
  const sourceRows = normalizeTableRows(transfer.values, {
    preserveEmptyRows: true,
    columnCount: Math.max(0, ...transfer.values.map((row) => row.length)),
  });
  const headerRows = sourceRows.slice(0, syncConfig.headerRowCount);
  const dataRows = sourceRows.slice(syncConfig.headerRowCount);
  const mapped = (row) => syncConfig.columnMapping.map((sourceIndex) => row[sourceIndex - 1] ?? "");
  const sortedDataRows = [...dataRows];
  if (syncConfig.sort.enabled) {
    const sortIndex = syncConfig.sort.column - 1;
    sortedDataRows.sort((left, right) => {
      const leftValue = cleanCellValue(left[sortIndex]);
      const rightValue = cleanCellValue(right[sortIndex]);
      const leftOther = syncConfig.sort.otherItemsBottom && leftValue === "其他";
      const rightOther = syncConfig.sort.otherItemsBottom && rightValue === "其他";
      if (leftOther !== rightOther) return leftOther ? 1 : -1;
      const comparison = leftValue.localeCompare(rightValue, "zh-CN", { numeric: true });
      return syncConfig.sort.direction === "asc" ? comparison : -comparison;
    });
  }
  const mappedHeaderRows = headerRows.map(mapped);
  const mappedDataRows = sortedDataRows.map(mapped);
  const valuesForTarget = syncConfig.syncHeader ? [...mappedHeaderRows, ...mappedDataRows] : mappedDataRows;
  return {
    sourceRows,
    headerRows,
    dataRows: sortedDataRows,
    mappedHeaderRows,
    mappedDataRows,
    valuesForTarget,
    valuesForWord: valuesForTarget,
    transferPolicy: transfer.transferPolicy,
  };
}

function rowMatchKey(row, keyColumn = 1) {
  return cleanCellValue(Array.isArray(row) ? row[keyColumn - 1] : "");
}

function rowSignature(row) {
  return (Array.isArray(row) ? row : []).map((cell) => cleanCellValue(cell)).join("\u241f");
}

function padSyncRow(row, columnCount) {
  const output = Array.isArray(row) ? [...row] : [];
  while (output.length < columnCount) output.push("");
  return output.slice(0, columnCount);
}

export function mergeRowsByKey(sourceDataRows, targetValues, config, targetColumnCount) {
  const transferPolicy = normalizeTransferPolicy(config);
  const rowMatch = config.rowMatch || {};
  const keyColumn = Math.max(1, Math.floor(Number(rowMatch.keyColumn || 1)));
  const headerRowCount = config.syncHeader ? 0 : Math.max(0, Math.floor(Number(config.headerRowCount || 0)));
  const targetDataRows = asMatrix(targetValues || []).slice(headerRowCount).map((row) => padSyncRow(row, targetColumnCount));
  const sourceRows = asMatrix(sourceDataRows || []).map((row) => padSyncRow(row, targetColumnCount));
  const keyedSourceRows = sourceRows
    .map((row, index) => ({ row, index, key: rowMatchKey(row, keyColumn), signature: rowSignature(row) }))
    .filter((item) => item.key);
  const keyedTargetRows = targetDataRows
    .map((row, index) => ({ row, index, key: rowMatchKey(row, keyColumn), signature: rowSignature(row) }))
    .filter((item) => item.key);
  if (!rowMatch.enabled || !keyedSourceRows.length || !keyedTargetRows.length) {
    return {
      enabled: false,
      reason: !rowMatch.enabled ? "disabled" : "no usable row keys",
      rows: sourceRows,
      matchedCount: 0,
      preservedWordRowCount: 0,
      appendedExcelRowCount: 0,
      fallbackToPosition: true,
      keyColumn,
      transferPolicy,
    };
  }
  const sourceByKey = new Map();
  for (const item of keyedSourceRows) {
    if (!sourceByKey.has(item.key)) sourceByKey.set(item.key, []);
    sourceByKey.get(item.key).push(item);
  }
  const usedSourceIndexes = new Set();
  const output = [];
  let matchedCount = 0;
  let preservedWordRowCount = 0;
  for (const targetRow of targetDataRows) {
    const key = rowMatchKey(targetRow, keyColumn);
    const match = (sourceByKey.get(key) || []).find((item) => !usedSourceIndexes.has(item.index));
    if (match) {
      output.push(match.row);
      usedSourceIndexes.add(match.index);
      matchedCount += 1;
    } else if (rowMatch.preserveUnmatchedWordRows !== false) {
      output.push(targetRow);
      preservedWordRowCount += 1;
    }
  }
  let appendedExcelRowCount = 0;
  if (rowMatch.appendNewExcelRows !== false) {
    const existingBlankSignatures = new Map();
    for (const row of output) {
      const key = rowMatchKey(row, keyColumn);
      if (!key) existingBlankSignatures.set(rowSignature(row), (existingBlankSignatures.get(rowSignature(row)) || 0) + 1);
    }
    for (const item of sourceRows.map((row, index) => ({
      row,
      index,
      key: rowMatchKey(row, keyColumn),
      signature: rowSignature(row),
    }))) {
      if (usedSourceIndexes.has(item.index)) continue;
      if (!item.key) {
        const remaining = existingBlankSignatures.get(item.signature) || 0;
        if (remaining > 0) {
          existingBlankSignatures.set(item.signature, remaining - 1);
          continue;
        }
      }
      output.push(item.row);
      appendedExcelRowCount += 1;
    }
  }
  return {
    enabled: true,
    reason: "key match",
    rows: output,
    matchedCount,
    preservedWordRowCount,
    appendedExcelRowCount,
    fallbackToPosition: false,
    keyColumn,
    sourceKeyCount: keyedSourceRows.length,
    targetKeyCount: keyedTargetRows.length,
    excelKeyCount: keyedSourceRows.length,
    wordKeyCount: keyedTargetRows.length,
    transferPolicy,
  };
}
