export function cleanCellValue(value) {
  return String(value ?? "").replace(/\r?\n/g, " ").trim();
}

export function asMatrix(value) {
  if (!Array.isArray(value)) return [];
  if (!Array.isArray(value[0])) return [value.map((cell) => cell ?? "")];
  return value.map((row) => (Array.isArray(row) ? row.map((cell) => cell ?? "") : [row ?? ""]));
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

export function mapSyncRows(rows, config) {
  const sourceRows = normalizeTableRows(rows, {
    preserveEmptyRows: true,
    columnCount: Math.max(0, ...asMatrix(rows).map((row) => row.length)),
  });
  const headerRows = sourceRows.slice(0, config.headerRowCount);
  const dataRows = sourceRows.slice(config.headerRowCount);
  const mapped = (row) => config.columnMapping.map((sourceIndex) => row[sourceIndex - 1] ?? "");
  const sortedDataRows = [...dataRows];
  if (config.sort.enabled) {
    const sortIndex = config.sort.column - 1;
    sortedDataRows.sort((left, right) => {
      const leftValue = cleanCellValue(left[sortIndex]);
      const rightValue = cleanCellValue(right[sortIndex]);
      const leftOther = config.sort.otherItemsBottom && leftValue === "其他";
      const rightOther = config.sort.otherItemsBottom && rightValue === "其他";
      if (leftOther !== rightOther) return leftOther ? 1 : -1;
      const comparison = leftValue.localeCompare(rightValue, "zh-CN", { numeric: true });
      return config.sort.direction === "asc" ? comparison : -comparison;
    });
  }
  const mappedHeaderRows = headerRows.map(mapped);
  const mappedDataRows = sortedDataRows.map(mapped);
  const valuesForTarget = config.syncHeader ? [...mappedHeaderRows, ...mappedDataRows] : mappedDataRows;
  return {
    sourceRows,
    headerRows,
    dataRows: sortedDataRows,
    mappedHeaderRows,
    mappedDataRows,
    valuesForTarget,
    valuesForWord: valuesForTarget,
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
  };
}
