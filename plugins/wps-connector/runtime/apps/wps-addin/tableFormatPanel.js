(function installTableFormatPanel(root) {
  const STYLE_ID = "connector-table-format-panel-style";
  const panelMarkup = `
    <section class="table-format-card" aria-label="表格格式模板">
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
    .table-format-result[data-state="error"]{color:#cf222e;background:#fff5f5}
    .table-format-empty{padding:10px;border:1px dashed #d8dee4;border-radius:12px;color:#8c959f;background:#fff;font-size:12px}
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
    const binding = session?.binding || session?.actualBinding || {};
    return {
      ...(session?.sessionId ? { sessionId: session.sessionId } : {}),
      ...(session?.documentKey ? { documentKey: session.documentKey } : {}),
      ...(binding.bindingId ? { bindingId: binding.bindingId } : {}),
      ...(binding.projectId ? { projectId: binding.projectId } : {}),
      ...(binding.threadId ? { threadId: binding.threadId } : {}),
    };
  }

  function formatSummary(template) {
    const shape = template?.shape || {};
    const format = template?.format || {};
    const fields = Object.keys(format).filter((key) => !["rowCount", "columnCount"].includes(key));
    return `${shape.rowCount || 0} 行 x ${shape.columnCount || 0} 列 · 已抓取 ${fields.length} 类格式`;
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
    const state = { host: "", templates: [], selectedTemplate: null, captured: null, loading: false };

    function setResult(message, status = "") {
      resultNode.textContent = String(message || "");
      if (status) resultNode.dataset.state = status;
      else delete resultNode.dataset.state;
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

    async function run(button, workingText, operation) {
      if (state.loading) return null;
      state.loading = true;
      const original = button.textContent;
      button.disabled = true;
      button.textContent = workingText;
      try {
        return await operation();
      } catch (error) {
        setResult(`${error.code ? `[${error.code}] ` : ""}${error.message || error}`, "error");
        return null;
      } finally {
        state.loading = false;
        button.textContent = original;
        renderTemplates();
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
    }

    captureButton.addEventListener("click", () => run(captureButton, "抓取中...", () => capture(false)));
    saveButton.addEventListener("click", () => run(saveButton, "保存中...", () => capture(true)));
    updateButton.addEventListener("click", () => run(updateButton, "更新中...", () => capture(true, state.selectedTemplate?.templateId || "")));
    applyButton.addEventListener("click", () => run(applyButton, "应用中...", apply));
    deleteButton.addEventListener("click", () => run(deleteButton, "删除中...", remove));
    refreshButton.addEventListener("click", () => run(refreshButton, "刷新中...", loadTemplates));
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
    void loadTemplates();
    const refreshOnViewChange = (event) => {
      if (event.detail?.view === "table-format") {
        configure();
        void loadTemplates();
      }
    };
    root.addEventListener?.("connectorSuiteViewChanged", refreshOnViewChange);
    root.addEventListener?.("wpsConnectorViewChanged", refreshOnViewChange);
    return { refresh: loadTemplates, configure };
  }

  root.ConnectorTableFormatPanel = { mount };
})(globalThis);
