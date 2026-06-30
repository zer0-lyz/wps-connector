const bridgeUrl = process.env.WPS_CONNECTOR_BRIDGE_URL || 'http://127.0.0.1:40215';
const requestedSessionId = process.env.WPS_SESSION_ID || '';
const logSheetName = process.env.WPS_ET_LOG_SHEET || '__WPS_Test_Log__';

async function getJson(path, options = {}) {
  const res = await fetch(`${bridgeUrl}${path}`, { ...options, headers: { 'content-type': 'application/json', ...(options.headers || {}) } });
  const json = await res.json();
  if (!json.ok) {
    const error = new Error(`${path}: ${json.error?.code || 'ERROR'} ${json.error?.message || ''}`);
    error.response = json;
    throw error;
  }
  return json;
}

async function tool(name, input) {
  return getJson(`/api/tools/${name.replaceAll('.', '/')}`, { method: 'POST', body: JSON.stringify(input) });
}

async function rawTool(name, input) {
  const res = await fetch(`${bridgeUrl}/api/tools/${name.replaceAll('.', '/')}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  return res.json();
}

function assert(ok, message) {
  if (!ok) throw new Error(message);
}

function safeText(value, limit = 500) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value.slice(0, limit);
  return JSON.stringify(value).slice(0, limit);
}

async function ensureLogSheet(sessionId) {
  const listed = await tool('et.list_worksheets', { sessionId });
  if (!listed.worksheets?.some((sheet) => sheet.name === logSheetName)) {
    await tool('et.add_worksheet', { sessionId, name: logSheetName, activate: false });
    await tool('et.write_range', {
      sessionId,
      sheetName: logSheetName,
      address: 'A1:F1',
      values: [['time', 'sessionId', 'command', 'ok', 'result', 'failureReason']],
    });
    await tool('et.format_range', {
      sessionId,
      sheetName: logSheetName,
      address: 'A1:F1',
      bold: true,
      fillColor: '#1F4E78',
      fontColor: '#FFFFFF',
      horizontalAlignment: 'center',
      border: true,
      autofit: true,
    });
  }
}

async function appendAuditLog(sessionId, rows) {
  await ensureLogSheet(sessionId);
  const existing = await tool('et.read_range', { sessionId, sheetName: logSheetName, address: 'A1:F200' });
  const values = Array.isArray(existing.values) ? existing.values : [];
  const nextRow = Math.max(values.filter((row) => Array.isArray(row) && row.some((cell) => cell !== null && cell !== '')).length + 1, 2);
  const address = `A${nextRow}:F${nextRow + rows.length - 1}`;
  await tool('et.write_range', { sessionId, sheetName: logSheetName, address, values: rows });
  await tool('et.format_range', { sessionId, sheetName: logSheetName, address, border: true, wrapText: true, autofit: true });
}

async function main() {
  const sessions = await getJson('/api/sessions');
  const session = requestedSessionId
    ? sessions.sessions.find((s) => s.sessionId === requestedSessionId)
    : sessions.sessions.filter((s) => s.host === 'et' && s.status === 'online').sort((a, b) => Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt))[0];
  assert(session, 'No online WPS Spreadsheet session found. Set WPS_SESSION_ID if needed.');
  const sessionId = session.sessionId;
  assert(String(session.clientVersion || '') === '1.0.4', `Expected clientVersion 1.0.4, got ${session.clientVersion || '<empty>'}. Reopen Connector Pane before running real regression.`);
  const listedForTarget = await tool('et.list_worksheets', { sessionId });
  const sheetName = listedForTarget.worksheets?.some((sheet) => sheet.name === 'Sheet1')
    ? 'Sheet1'
    : (listedForTarget.worksheets || []).find((sheet) => sheet.name !== logSheetName)?.name || session.documentIdentity?.sheetName || 'Sheet1';
  const prefix = `回归_${Date.now().toString().slice(-6)}`;
  const tempSheet = `${prefix}_tmp`;
  const report = [];
  await ensureLogSheet(sessionId);

  async function recordAuditRow(row) {
    try {
      await appendAuditLog(sessionId, [row]);
    } catch (error) {
      console.error(JSON.stringify({ ok: false, auditLogError: error.message, row }, null, 2));
    }
  }

  async function step(name, fn, options = {}) {
    const started = new Date().toISOString();
    try {
      const result = await fn();
      if (options.expectError) throw new Error(`Expected structured error ${options.expectError}, but command succeeded.`);
      if (typeof options.validate === 'function') options.validate(result);
      report.push({ name, ok: true, result });
      await recordAuditRow([started, sessionId, name, 'TRUE', safeText(result), '']);
      return result;
    } catch (error) {
      const code = error.response?.error?.code || '';
      const message = error.response?.error?.message || error.message;
      const ok = options.expectError && code === options.expectError;
      report.push({ name, ok, errorCode: code, error: message });
      await recordAuditRow([started, sessionId, name, ok ? 'TRUE' : 'FALSE', ok ? `expected ${code}` : '', safeText(error.response?.error || message)]);
      if (!ok) throw error;
      return error.response;
    }
  }

  await step('list_worksheets', () => tool('et.list_worksheets', { sessionId }));
  await step('read_missing_sheet_structured_error', () => rawTool('et.read_range', { sessionId, sheetName: 'NoSuchSheet', address: 'A1:B2' }).then((json) => {
    if (json.ok) return json;
    const error = new Error(json.error?.message || 'raw tool failed');
    error.response = json;
    throw error;
  }), { expectError: 'SHEET_NOT_FOUND' });
  await step('read_invalid_address_structured_error', () => rawTool('et.read_range', { sessionId, sheetName, address: 'bad address' }).then((json) => {
    if (json.ok) return json;
    const error = new Error(json.error?.message || 'raw tool failed');
    error.response = json;
    throw error;
  }), { expectError: 'INVALID_ADDRESS' });
  await step('delete_protected_sheet_structured_error', () => rawTool('et.delete_worksheet', { sessionId, sheetName }).then((json) => {
    if (json.ok) return json;
    const error = new Error(json.error?.message || 'raw tool failed');
    error.response = json;
    throw error;
  }), { expectError: 'LAST_SHEET_DELETE_REFUSED' });
  await step('add_worksheet', () => tool('et.add_worksheet', { sessionId, name: tempSheet, activate: false }));
  await step('delete_worksheet', () => tool('et.delete_worksheet', { sessionId, sheetName: tempSheet }));
  await step('write_range_values_formulas_formats', () => tool('et.write_range', {
    sessionId, sheetName, address: 'A1:H6',
    values: [
      ['日期', '项目', '数量', '单价', '金额', '税率', '税额', '含税合计'],
      ['2026-06-29', '项目A', 10, 12.5, null, 0.13, null, null],
      ['2026-06-30', '项目B', 8, 18.2, null, 0.13, null, null],
      ['2026-07-01', '项目C', 6, 21.0, null, 0.06, null, null],
      ['合计', '', '=SUM(C2:C4)', '', '=SUM(E2:E4)', '', '=SUM(G2:G4)', '=SUM(H2:H4)'],
      ['校验', '公式与格式', '', '', '', '', '', ''],
    ],
    formulaRanges: [
      { address: 'E2:E4', formulas: [['=C2*D2'], ['=C3*D3'], ['=C4*D4']] },
      { address: 'G2:G4', formulas: [['=E2*F2'], ['=E3*F3'], ['=E4*F4']] },
      { address: 'H2:H4', formulas: [['=E2+G2'], ['=E3+G3'], ['=E4+G4']] },
      { address: 'C5:C5', formulas: [['=SUM(C2:C4)']] },
      { address: 'E5:E5', formulas: [['=SUM(E2:E4)']] },
      { address: 'G5:G5', formulas: [['=SUM(G2:G4)']] },
      { address: 'H5:H5', formulas: [['=SUM(H2:H4)']] },
    ],
    numberFormats: [['yyyy-mm-dd', '@', '0', '#,##0.00', '#,##0.00', '0%', '#,##0.00', '#,##0.00']],
  }));
  await step('format_header', () => tool('et.format_range', { sessionId, sheetName, address: 'A1:H1', bold: true, fontColor: '#FFFFFF', fillColor: '#1F4E78', horizontalAlignment: 'center', border: true, autofit: true }));
  await step('format_body', () => tool('et.format_range', { sessionId, sheetName, address: 'A2:H6', fontName: '微软雅黑', fontSize: 10, border: true, horizontalAlignment: 'center', autofit: true }));
  await step('format_date', () => tool('et.format_range', { sessionId, sheetName, address: 'A2:A4', numberFormat: 'yyyy-mm-dd' }));
  await step('format_percent', () => tool('et.format_range', { sessionId, sheetName, address: 'F2:F4', numberFormat: '0%' }));
  await step('format_money', () => tool('et.format_range', { sessionId, sheetName, address: 'D2:E5', numberFormat: '#,##0.00' }));
  await step('read_range_with_formulas_formats', () => tool('et.read_range', { sessionId, sheetName, address: 'A1:H6', includeFormulas: true, includeFormats: true }), { validate(read) {
    assert(read.values?.length >= 6, 'read_range did not return expected rows.');
    assert(read.formats && Object.prototype.hasOwnProperty.call(read.formats, 'numberFormat'), 'read_range did not return numberFormat details.');
  } });
  await step('find_cells_fuzzy_case_insensitive', () => tool('et.find_cells', { sessionId, sheetName, query: '项目b', maxResults: 5 }), { validate(found) {
    assert(found.count >= 1, 'find_cells fuzzy/case-insensitive did not find 项目B.');
  } });
  await step('find_cells_exact_miss', () => tool('et.find_cells', { sessionId, sheetName, address: 'B2:B4', query: '项目', matchEntireCell: true, maxResults: 5 }), { validate(exactMiss) {
    assert(exactMiss.count === 0, 'find_cells matchEntireCell should not match partial text in data rows.');
  } });
  await step('find_cells_exact_hit', () => tool('et.find_cells', { sessionId, sheetName, address: 'B2:B4', query: '项目B', matchEntireCell: true, maxResults: 5 }), { validate(exactHit) {
    assert(exactHit.count >= 1, 'find_cells matchEntireCell should match the full 项目B cell.');
  } });
  await step('write_blocks_mixed_success_and_failure', () => tool('et.write_blocks', { sessionId, continueOnError: true, blocks: [
    { sheetName, address: 'J1:K2', values: [['区块', '值'], ['A', 1]], format: { bold: true, fillColor: '#D9EAF7', border: true } },
    { sheetName, address: 'J4:K5', values: [['区块', '公式'], ['B', null]], formulas: [['', ''], ['', '=SUM(K2:K2)']], format: { border: true } },
    { sheetName: 'NoSuchSheet', address: 'A1:B1', values: [['失败', '区块']] },
  ] }), { validate(blocks) {
    assert(blocks.results?.length === 3, 'write_blocks did not return every block.');
    assert(blocks.results[0]?.ok === true && blocks.results[1]?.ok === true, 'write_blocks success blocks failed.');
    assert(blocks.results[2]?.ok === false && blocks.results[2]?.error?.code === 'SHEET_NOT_FOUND', 'write_blocks failure block did not return SHEET_NOT_FOUND.');
  } });
  await step('insert_range', () => tool('et.insert_range', { sessionId, sheetName, address: 'A8:H8', shift: 'Down' }));
  await step('delete_range', () => tool('et.delete_range', { sessionId, sheetName, address: 'A8:H8', shift: 'Up' }));

  console.log(JSON.stringify({
    ok: true,
    sessionId,
    documentName: session.documentName,
    sheetName,
    logSheetName,
    capabilityMatrix: report.map((r) => ({ name: r.name, ok: r.ok, errorCode: r.errorCode || '', error: r.error || '' })),
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message, response: error.response || null }, null, 2));
  process.exit(1);
});
