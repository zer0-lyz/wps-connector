(function installTableFormatPanel(root) {
  const STYLE_ID = "connector-table-format-panel-style";
  const panelMarkup = `
    <section class="table-format-card" aria-label="表格设置">
      <section class="table-settings-card" aria-label="批量表格调整格式">
        <div class="table-settings-head">
          <div>
            <span class="table-format-label">表格设置</span>
            <h2>批量表格调整格式</h2>
            <p>默认：文本宋体、数字 Times New Roman、10 号字；按窗口调整；行高最小值 0.6 厘米；重复标题；标题加粗并居中；文本左对齐、数字右对齐、单元格垂直居中；上下边框 1.5 磅、内部横竖线 0.5 磅、左右无边框。</p>
          </div>
          <button id="tableSettingsRefresh" type="button" class="secondary">刷新清单</button>
        </div>
        <div class="table-settings-toolbar">
          <button id="tableSettingsSelectAll" type="button" class="secondary">全选</button>
          <button id="tableSettingsClear" type="button" class="secondary">清空选择</button>
          <span id="tableSettingsSummary" class="table-format-meta">正在读取表格清单...</span>
        </div>
        <div id="tableSettingsList" class="table-settings-list" role="list" aria-live="polite"></div>
        <div class="table-settings-actions">
          <button id="tableSettingsApplySelected" type="button" disabled>应用已选表格</button>
          <button id="tableSettingsApplyAll" type="button" class="secondary" disabled>全部表格</button>
        </div>
        <pre id="tableSettingsResult" class="table-format-result" aria-live="polite">等待操作。</pre>
      </section>
      <section class="table-format-legacy" hidden aria-hidden="true">
      <div class="table-format-head">
        <div>
          <span class="table-format-label">表格格式模板</span>
          <h2>抓取并批量复用表格样式</h2>
          <p>只保存格式，不改变表格正文。应用后会逐表回读验证。</p>
        </div>
        <div class="table-format-head-actions">
          <button id="tableFormatBack" type="button" class="secondary">返回</button>
          <button id="tableFormatRefresh" type="button" class="secondary">刷新</button>
        </div>
      </div>
      <div id="tableFormatUnsupported" class="table-format-empty" hidden></div>
      <div id="tableFormatControls" class="table-format-controls">
        <div class="table-format-source">
          <div>
            <span class="table-format-label">格式来源</span>
            <strong id="tableFormatSource">当前选中的表格</strong>
            <span id="tableFormatCaptureSummary" class="table-format-meta">先选中一个表格，再抓取格式。</span>
          </div>
          <button id="tableFormatCapture" type="button">抓取当前格式</button>
        </div>
        <div class="table-format-field">
          <label for="tableFormatName">模板名称</label>
          <input id="tableFormatName" type="text" placeholder="例如：报告正文表格" maxlength="80" />
        </div>
        <div class="table-format-actions">
          <button id="tableFormatSave" type="button">保存为新模板</button>
          <button id="tableFormatUpdate" type="button" class="secondary" disabled>更新所选模板</button>
        </div>
        <div class="table-format-field">
          <label for="tableFormatSelect">已保存模板</label>
          <select id="tableFormatSelect">
            <option value="">暂无模板</option>
          </select>
        </div>
        <div class="table-format-field">
          <label for="tableFormatTarget">应用范围</label>
          <select id="tableFormatTarget">
            <option value="Selection">当前选中的表格</option>
            <option value="All">全文全部表格</option>
            <option value="ExceptSelection">全文表格（排除当前表格）</option>
          </select>
        </div>
        <div class="table-format-actions">
          <button id="tableFormatApply" type="button" disabled>应用并验证</button>
          <button id="tableFormatDelete" type="button" class="secondary" disabled>删除模板</button>
        </div>
      </div>
      <pre id="tableFormatResult" class="table-format-result" aria-live="polite">等待操作。</pre>
      </section>
    </section>`;

  const css = `
    .table-format-view{display:grid;gap:10px;width:100%;max-width:100%;min-width:0}
    .table-format-view[hidden]{display:none!important}
    .table-format-card{display:grid;gap:10px;min-width:0;padding:10px;border:1px solid #e5e7eb;border-radius:14px;background:rgba(255,255,255,.9);box-shadow:0 1px 2px rgba(31,35,40,.04)}
    .table-format-head{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:start}
    .table-format-head-actions{display:flex;gap:6px;align-items:start}
    .table-format-head h2{margin:0;font-size:14px;line-height:18px;color:#24292f}
    .table-format-head p{margin:3px 0 0;color:#8c959f;font-size:11px;overflow-wrap:anywhere}
    .table-format-label{display:block;color:#8c959f;font-size:11px;font-weight:650}
    .table-format-source{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center;padding:9px;border:1px solid #eef2f7;border-radius:12px;background:#fff}
    .table-format-source strong{display:block;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#24292f;font-size:13px}
    .table-format-meta{display:block;margin-top:3px;color:#8c959f;font-size:11px;overflow-wrap:anywhere}
    .table-format-controls{display:grid;gap:9px;min-width:0}
    .table-format-field{display:grid;gap:4px;min-width:0}
    .table-format-field label{color:#57606a;font-size:12px;font-weight:650}
    .table-format-field input,.table-format-field select{width:100%;min-width:0;padding:8px;border:1px solid #e5e7eb;border-radius:10px;background:#fff;color:#24292f;font:inherit}
    .table-format-field input:focus,.table-format-field select:focus{outline:2px solid rgba(31,35,40,.12);border-color:#8c959f}
    .table-format-actions{display:flex;flex-wrap:wrap;gap:6px;min-width:0}
    .table-format-actions button{min-height:30px;padding:5px 10px}
    .table-format-actions button:disabled{opacity:.45;cursor:not-allowed}
    .table-format-result{min-height:42px;max-height:180px;margin:0;padding:8px;overflow:auto;border:1px solid #eef2f7;border-radius:10px;background:#f8fafc;color:#57606a;font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;overflow-wrap:anywhere}
    .table-format-result[data-state="ok"]{color:#1a7f37;background:#f0fff4}
    .table-format-result[data-state="warning"]{color:#9a6700;background:#fff8c5}
    .table-format-result[data-state="error"]{color:#cf222e;background:#fff5f5}
    .table-format-empty{padding:10px;border:1px dashed #d8dee4;border-radius:12px;color:#8c959f;background:#fff;font-size:12px}
    .table-settings-card{display:grid;gap:8px;padding:10px;border:1px solid #d8dee4;border-radius:12px;background:#fff}
    .table-settings-head{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:start}
    .table-settings-head h2{margin:0;font-size:14px;line-height:18px;color:#24292f}
    .table-settings-head p{margin:3px 0 0;color:#8c959f;font-size:11px;line-height:16px;overflow-wrap:anywhere}
    .table-settings-toolbar,.table-settings-actions{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
    .table-settings-list{display:grid;gap:6px;max-height:260px;overflow:auto;padding:1px}
    .table-settings-empty{padding:10px;border:1px dashed #d8dee4;border-radius:10px;color:#8c959f;font-size:12px}
    .table-settings-item{display:grid;grid-template-columns:auto minmax(0,1fr);gap:8px;align-items:start;padding:8px;border:1px solid #eef2f7;border-radius:10px;background:#fafbfc}
    .table-settings-item input{margin-top:3px}
    .table-settings-item-title{display:flex;gap:6px;align-items:baseline;min-width:0;color:#24292f;font-size:12px;font-weight:650}
    .table-settings-item-meta{color:#8c959f;font-size:11px;font-weight:400}
    .table-settings-preview{margin-top:4px;color:#57606a;font:10px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;overflow-wrap:anywhere}
    @media (max-width:360px){.table-format-source{grid-template-columns:1fr}.table-format-source button{justify-self:start}}
  `;

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>\"]/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
    }[character]));
  }

  function ensureStyle() {
    if (root.document?.getElementById(STYLE_ID)) return;
    const style = root.document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = css;
    root.document.head.append(style);
  }

  function hostKind(value) {
    const text = String(value || "").toLowerCase();
    if (text === "word" || text === "wpp" || text.includes("writer")) return text === "word" ? "word" : "wpp";
    return "";
  }

  function sessionPayload(session) {
    // Table settings are document-local. Keeping this payload to the stable
    // session key prevents strict tool schemas from rejecting unrelated
    // project/thread binding metadata.
    return session?.sessionId ? { sessionId: session.sessionId } : {};
  }

  function formatSummary(template) {
    const shape = template?.shape || {};
    const format = template?.format || {};
    const fields = Object.keys(format).filter((key) => !["rowCount", "columnCount"].includes(key));
    return `${shape.rowCount || 0} 行 x ${shape.columnCount || 0} 列 · 已抓取 ${fields.length} 类格式`;
  }

  function responseResult(json) {
    // Bridge responses have historically been returned as either a direct
    // payload, `{ result }`, or (during a proxy hand-off) `{ result: { result } }`.
    // Keep the panel independent of that transport detail. In particular, do
    // not turn a successful table read into an empty UI merely because the
    // result gained one envelope.
    let value = json;
    for (let depth = 0; depth < 4 && value && typeof value === "object"; depth += 1) {
      if (Array.isArray(value.tables)) return value;
      if (value.result && typeof value.result === "object" && value.result !== value) {
        value = value.result;
        continue;
      }
      if (value.data && typeof value.data === "object" && value.data !== value) {
        value = value.data;
        continue;
      }
      break;
    }
    return value || {};
  }

  function tableIndexOf(table) {
    const value = Number(table?.tableIndex ?? table?.index);
    return Number.isInteger(value) && value >= 0 ? value : null;
  }

  function tableValues(table) {
    const values = Array.isArray(table?.values) ? table.values : Array.isArray(table?.preview) ? table.preview : Array.isArray(table?.cellPreview) ? table.cellPreview : [];
    return values.filter(Array.isArray).slice(0, 2).map((row) => row.slice(0, 5).map((value) => String(value ?? "")));
  }

  function tablePreview(table) {
    const values = tableValues(table);
    if (!values.length) return "暂无预览";
    return values.map((row) => row.map((value) => escapeHtml(value)).join(" | ")).join("\n");
  }

  function tableShape(table) {
    const values = tableValues(table);
    return {
      rowCount: Number(table?.rowCount || values.length || 0),
      columnCount: Number(table?.columnCount || Math.max(0, ...values.map((row) => row.length))),
    };
  }

  function mount(options = {}) {
    const section = root.document?.getElementById(options.containerId || "tableFormatPanel");
    if (!section || section.dataset.tableFormatMounted === "true") return null;
    ensureStyle();
    section.classList.add("table-format-view");
    section.innerHTML = panelMarkup;
    section.dataset.tableFormatMounted = "true";

    const unsupported = section.querySelector("#tableFormatUnsupported");
    const controls = section.querySelector("#tableFormatControls");
    const resultNode = section.querySelector("#tableFormatResult");
    const settingsResultNode = section.querySelector("#tableSettingsResult");
    const settingsSummaryNode = section.querySelector("#tableSettingsSummary");
    const settingsListNode = section.querySelector("#tableSettingsList");
    const settingsRefreshButton = section.querySelector("#tableSettingsRefresh");
    const settingsSelectAllButton = section.querySelector("#tableSettingsSelectAll");
    const settingsClearButton = section.querySelector("#tableSettingsClear");
    const settingsApplySelectedButton = section.querySelector("#tableSettingsApplySelected");
    const settingsApplyAllButton = section.querySelector("#tableSettingsApplyAll");
    const sourceNode = section.querySelector("#tableFormatSource");
    const captureSummaryNode = section.querySelector("#tableFormatCaptureSummary");
    const nameInput = section.querySelector("#tableFormatName");
    const templateSelect = section.querySelector("#tableFormatSelect");
    const targetSelect = section.querySelector("#tableFormatTarget");
    const captureButton = section.querySelector("#tableFormatCapture");
    const saveButton = section.querySelector("#tableFormatSave");
    const updateButton = section.querySelector("#tableFormatUpdate");
    const applyButton = section.querySelector("#tableFormatApply");
    const deleteButton = section.querySelector("#tableFormatDelete");
    const refreshButton = section.querySelector("#tableFormatRefresh");
    const backButton = section.querySelector("#tableFormatBack");
    const state = { host: "", templates: [], selectedTemplate: null, captured: null, tables: [], selectedTableIndexes: new Set(), loading: false, tablesLoading: false, tableLoadPromise: null };

    function setResult(message, status = "") {
      resultNode.textContent = String(message || "");
      if (status) resultNode.dataset.state = status;
      else delete resultNode.dataset.state;
    }

    function setSettingsResult(message, status = "") {
      settingsResultNode.textContent = String(message || "");
      if (status) settingsResultNode.dataset.state = status;
      else delete settingsResultNode.dataset.state;
    }

    function currentSession() {
      try { return options.getSession?.() || null; } catch { return null; }
    }

    async function callTool(action, input = {}) {
      const toolName = `${state.host === "word" ? "word" : "wpp"}.${action}`;
      if (typeof options.callTool === "function") return options.callTool(toolName, input);
      const [namespace, name] = toolName.split(".");
      const bridge = String(options.bridgeUrl || "http://127.0.0.1:40215").replace(/\/$/, "");
      const response = await root.fetch(`${bridge}/api/tools/${namespace}/${name}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      const json = await response.json();
      if (!response.ok || json.ok === false) {
        const error = new Error(json.error?.message || `HTTP ${response.status}`);
        error.code = json.error?.code || `HTTP_${response.status}`;
        error.details = json.error?.details || {};
        throw error;
      }
      return json;
    }

    function selectedTemplate() {
      return state.templates.find((item) => String(item.templateId) === String(templateSelect.value)) || null;
    }

    function renderTableSettings() {
      const available = new Set(state.tables.map(tableIndexOf).filter((value) => value !== null));
      state.selectedTableIndexes = new Set([...state.selectedTableIndexes].filter((value) => available.has(value)));
      if (!state.tables.length) {
        settingsListNode.innerHTML = `<div class="table-settings-empty">当前文档没有可操作的表格，或尚未连接到文字文档。</div>`;
      } else {
        settingsListNode.innerHTML = state.tables.map((table) => {
          const index = tableIndexOf(table);
          if (index === null) return "";
          const shape = tableShape(table);
          return `<label class="table-settings-item" role="listitem"><input type="checkbox" data-table-index="${index}" ${state.selectedTableIndexes.has(index) ? "checked" : ""} aria-label="选择第 ${index + 1} 个表格" /><span><span class="table-settings-item-title">第 ${index + 1} 个表格 <span class="table-settings-item-meta">${shape.rowCount} 行 × ${shape.columnCount} 列</span></span><span class="table-settings-preview">${tablePreview(table)}</span></span></label>`;
        }).join("");
      }
      const selectedCount = state.selectedTableIndexes.size;
      settingsSummaryNode.textContent = state.tables.length ? `共 ${state.tables.length} 个表格 · 已选 ${selectedCount} 个` : "暂无表格清单";
      const tableControlsBusy = state.loading || state.tablesLoading;
      settingsSelectAllButton.disabled = !state.tables.length || tableControlsBusy;
      settingsClearButton.disabled = !selectedCount || tableControlsBusy;
      settingsApplySelectedButton.disabled = !selectedCount || tableControlsBusy;
      settingsApplyAllButton.disabled = !state.tables.length || tableControlsBusy;
      settingsListNode.querySelectorAll("input[data-table-index]").forEach((checkbox) => {
        checkbox.addEventListener("change", () => {
          const index = Number(checkbox.dataset.tableIndex);
          if (checkbox.checked) state.selectedTableIndexes.add(index);
          else state.selectedTableIndexes.delete(index);
          renderTableSettings();
        });
      });
    }

    async function loadTableSettingsTables() {
      // Opening a pane and registering its session are independent async steps.
      // Coalesce all initial/manual refreshes so a stale first read cannot leave
      // the UI in a permanent "刷新中" state or race the current session.
      if (state.tableLoadPromise) return state.tableLoadPromise;
      state.tableLoadPromise = (async () => {
        state.tablesLoading = true;
        renderTableSettings();
        try {
          if (typeof options.ensureSession === "function") await options.ensureSession();
          configure();
          const session = currentSession();
          if (!state.host || !session?.sessionId) {
            state.tables = [];
            state.selectedTableIndexes.clear();
            setSettingsResult("当前文字文档尚未注册 session。请关闭并重新打开连接面板后重试。", "warning");
            return { tables: [] };
          }
          const startedAt = Date.now();
          setSettingsResult("正在读取当前文档的表格清单…");
          const action = state.host === "word" ? "read_tables" : "list_tables";
          const json = await callTool(action, {
            ...sessionPayload(session),
            includeValues: true,
            ...(state.host === "word" ? { includeStyles: false } : {}),
            maxTables: 500,
            maxRows: 2,
            maxColumns: 5,
          });
          const data = responseResult(json);
          state.tables = Array.isArray(data.tables) ? data.tables : [];
          const durationMs = Number(data?.timings?.totalMs ?? json?.timings?.totalMs) || Math.max(0, Date.now() - startedAt);
          const reportedCount = Number(data.returnedCount ?? data.count ?? state.tables.length);
          if (state.tables.length) {
            setSettingsResult(`已加载 ${state.tables.length} 张表格（宿主读取 ${durationMs} ms）。`, "ok");
          } else if (reportedCount > 0) {
            setSettingsResult(`已读取 ${reportedCount} 张表格，但返回清单为空。请刷新后重试；该结果已记录为兼容性异常。`, "warning");
          } else {
            setSettingsResult(`当前文档未读取到表格（宿主读取 ${durationMs} ms）。`, "warning");
          }
          return data;
        } finally {
          state.tablesLoading = false;
          renderTableSettings();
        }
      })();
      try {
        return await state.tableLoadPromise;
      } finally {
        state.tableLoadPromise = null;
      }
    }

    async function applyDefaultTableSettings(target) {
      const session = currentSession();
      if (!session?.sessionId) throw new Error("当前文档尚未注册 session，请重新打开插件面板。");
      const indexes = [...state.selectedTableIndexes].sort((a, b) => a - b);
      if (target === "tableIndexes" && !indexes.length) throw new Error("请至少选择一个表格。");
      const json = await callTool("apply_table_settings", {
        ...sessionPayload(session),
        target,
        ...(target === "tableIndexes" ? { tableIndexes: indexes } : {}),
      });
      const data = responseResult(json);
      const summary = data.summary || {};
      setSettingsResult(JSON.stringify({
        preset: data.preset || "default",
        applied: data.applied,
        verified: data.verified,
        target: data.target || target,
        targetIndexes: data.targetIndexes || indexes,
        excludedTableIndexes: data.excludedTableIndexes || [],
        summary: {
          targetCount: summary.targetCount || 0,
          successCount: summary.successCount || 0,
          verifiedCount: summary.verifiedCount || 0,
          failedCount: summary.failedCount || 0,
          unsupportedCount: summary.unsupportedCount || 0,
          attemptedButUnverifiedCount: summary.attemptedButUnverifiedCount || 0,
        },
        performance: data.performance || null,
        warnings: data.warnings || [],
      }, null, 2), data.verified === true ? "ok" : (data.applied === false ? "error" : "warning"));
      await loadTableSettingsTables();
      return json;
    }

    function renderTemplates() {
      const selectedId = state.selectedTemplate?.templateId || templateSelect.value || "";
      if (!state.templates.length) {
        templateSelect.innerHTML = `<option value="">暂无模板</option>`;
      } else {
        templateSelect.innerHTML = `<option value="">请选择模板</option>${state.templates.map((template) => `<option value="${escapeHtml(template.templateId)}">${escapeHtml(template.name)} · ${escapeHtml(formatSummary(template))}</option>`).join("")}`;
        templateSelect.value = state.templates.some((item) => String(item.templateId) === String(selectedId)) ? selectedId : "";
      }
      state.selectedTemplate = selectedTemplate();
      if (state.selectedTemplate) {
        nameInput.value = state.selectedTemplate.name || "";
        updateButton.disabled = false;
        applyButton.disabled = false;
        deleteButton.disabled = false;
      } else {
        updateButton.disabled = true;
        applyButton.disabled = true;
        deleteButton.disabled = true;
      }
    }

    async function loadTemplates() {
      if (!state.host) return;
      try {
        const json = await callTool("list_table_format_templates");
        state.templates = Array.isArray(json.templates) ? json.templates : [];
        renderTemplates();
        if (!state.templates.length) setResult("暂无已保存模板。选中一个表格后即可抓取并保存。", "");
      } catch (error) {
        setResult(`模板加载失败：${error.message || error}`, "error");
      }
    }

    async function refreshAll() {
      await loadTableSettingsTables();
    }

    async function capture(save = false, templateId = "") {
      const session = currentSession();
      if (!session?.sessionId) throw new Error("当前文档尚未注册 session，请重新打开插件面板。");
      const json = await callTool("capture_table_format", { ...sessionPayload(session), target: "Selection" });
      const template = json.template || {};
      state.captured = template;
      sourceNode.textContent = template.source?.tableIndex === undefined ? "当前选中的表格" : `当前选中的第 ${Number(template.source.tableIndex) + 1} 个表格`;
      captureSummaryNode.textContent = formatSummary(template);
      if (!save) {
        setResult(JSON.stringify({ captured: true, shape: template.shape, formatFields: Object.keys(template.format || {}) }, null, 2), "ok");
        return json;
      }
      const name = nameInput.value.trim();
      if (!name) throw new Error("请先填写模板名称。");
      const saved = await callTool("save_table_format_template", { ...sessionPayload(session), target: "Selection", name, ...(templateId ? { templateId } : {}) });
      state.captured = saved.template || template;
      await loadTemplates();
      templateSelect.value = saved.template?.templateId || templateId || "";
      renderTemplates();
      setResult(JSON.stringify({ saved: true, created: saved.created, template: saved.template }, null, 2), "ok");
      return saved;
    }

    async function apply() {
      const session = currentSession();
      const template = selectedTemplate();
      if (!session?.sessionId) throw new Error("当前文档尚未注册 session，请重新打开插件面板。");
      if (!template) throw new Error("请先选择一个模板。");
      const json = await callTool("apply_table_format_template", { ...sessionPayload(session), templateId: template.templateId, target: targetSelect.value });
      const summary = json.summary || {};
      const failed = (summary.results || []).filter((item) => !item.ok);
      setResult(JSON.stringify({
        applied: json.applied,
        verified: json.verified,
        target: json.target,
        targetCount: summary.targetCount,
        successCount: summary.successCount,
        failedCount: summary.failedCount,
        failedTables: failed.map((item) => ({ tableIndex: item.tableIndex, error: item.error, mismatches: item.verification?.mismatches })),
      }, null, 2), json.verified ? "ok" : "error");
      return json;
    }

    async function remove() {
      const template = selectedTemplate();
      if (!template) throw new Error("请先选择一个模板。");
      if (typeof root.confirm === "function" && !root.confirm(`确定删除模板“${template.name}”吗？`)) return null;
      const json = await callTool("delete_table_format_template", { templateId: template.templateId });
      state.selectedTemplate = null;
      await loadTemplates();
      setResult(JSON.stringify({ deleted: true, templateId: json.templateId }, null, 2), "ok");
      return json;
    }

    async function run(button, workingText, operation, { errorTarget = "template" } = {}) {
      if (state.loading) return null;
      state.loading = true;
      const original = button.textContent;
      button.disabled = true;
      button.textContent = workingText;
      try {
        return await operation();
      } catch (error) {
        const message = `${error.code ? `[${error.code}] ` : ""}${error.message || error}`;
        if (errorTarget === "settings") setSettingsResult(message, "error");
        else setResult(message, "error");
        return null;
      } finally {
        state.loading = false;
        button.textContent = original;
        renderTemplates();
        renderTableSettings();
      }
    }

    function configure() {
      const session = currentSession();
      state.host = hostKind(options.getHost?.() || session?.host || "");
      const supported = Boolean(state.host);
      unsupported.hidden = supported;
      controls.hidden = !supported;
      if (!supported) {
        unsupported.textContent = "表格格式模板目前仅支持 Word 和 WPS 文字。请在文字文档中使用。";
        return;
      }
      sourceNode.textContent = session?.documentName ? `${session.documentName} · 当前选中的表格` : "当前选中的表格";
      renderTableSettings();
    }

    captureButton.addEventListener("click", () => run(captureButton, "抓取中...", () => capture(false)));
    saveButton.addEventListener("click", () => run(saveButton, "保存中...", () => capture(true)));
    updateButton.addEventListener("click", () => run(updateButton, "更新中...", () => capture(true, state.selectedTemplate?.templateId || "")));
    applyButton.addEventListener("click", () => run(applyButton, "应用中...", apply));
    deleteButton.addEventListener("click", () => run(deleteButton, "删除中...", remove));
    settingsRefreshButton.addEventListener("click", () => run(settingsRefreshButton, "刷新中...", refreshAll, { errorTarget: "settings" }));
    settingsSelectAllButton.addEventListener("click", () => {
      state.selectedTableIndexes = new Set(state.tables.map(tableIndexOf).filter((value) => value !== null));
      renderTableSettings();
    });
    settingsClearButton.addEventListener("click", () => {
      state.selectedTableIndexes.clear();
      renderTableSettings();
    });
    settingsApplySelectedButton.addEventListener("click", () => run(settingsApplySelectedButton, "应用中...", () => applyDefaultTableSettings("tableIndexes"), { errorTarget: "settings" }));
    settingsApplyAllButton.addEventListener("click", () => run(settingsApplyAllButton, "应用中...", () => applyDefaultTableSettings("All"), { errorTarget: "settings" }));
    refreshButton.addEventListener("click", () => run(refreshButton, "刷新中...", refreshAll));
    backButton.addEventListener("click", () => options.onBack?.());
    templateSelect.addEventListener("change", () => {
      state.selectedTemplate = selectedTemplate();
      renderTemplates();
      if (state.selectedTemplate) setResult(`已选择模板：${state.selectedTemplate.name}`, "");
    });
    nameInput.addEventListener("input", () => {
      updateButton.disabled = !state.selectedTemplate || !nameInput.value.trim();
    });

    configure();
    void refreshAll().catch((error) => setSettingsResult(`表格清单加载失败：${error.message || error}`, "error"));
    const refreshOnViewChange = (event) => {
      if (event.detail?.view === "table-format") {
        configure();
        void refreshAll().catch((error) => setSettingsResult(`表格清单加载失败：${error.message || error}`, "error"));
      }
    };
    root.addEventListener?.("connectorSuiteViewChanged", refreshOnViewChange);
    root.addEventListener?.("wpsConnectorViewChanged", refreshOnViewChange);
    return { refresh: refreshAll, configure };
  }

  root.ConnectorTableFormatPanel = { mount };
})(globalThis);
