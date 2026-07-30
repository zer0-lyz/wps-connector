(function installConnectorSuiteUi(root) {
  const views = [
  {
    "id": "connector",
    "label": "连接面板",
    "hosts": [
      "Office",
      "WPS"
    ],
    "aliases": [
      "binding"
    ],
    "moduleId": "connection-binding",
    "moduleVersion": "0.2.0"
  },
  {
    "id": "agent",
    "label": "Agent 对话",
    "hosts": [
      "Office",
      "WPS"
    ],
    "aliases": [],
    "moduleId": "agent-chat",
    "moduleVersion": "0.2.0"
  },
  {
    "id": "sync",
    "label": "表格同步",
    "hosts": [
      "Office",
      "WPS"
    ],
    "aliases": [
      "table-sync"
    ],
    "moduleId": "table-sync",
    "moduleVersion": "0.2.0"
  }
];
  const model = Object.freeze({
    productVersion: "0.2.0",
    sharedVersion: "0.2.0",
    views: Object.freeze(views.map((view) => Object.freeze({
      ...view,
      hosts: Object.freeze(view.hosts),
      aliases: Object.freeze(view.aliases),
    }))),
    resolveView(value, connector) {
      const requested = String(value || "").trim().toLowerCase();
      const available = this.views.filter((view) => !connector || view.hosts.includes(connector));
      const match = available.find((view) => view.id === requested || view.aliases.includes(requested));
      return match?.id || (connector === "Office" ? "agent" : "connector");
    },
    viewsFor(connector) {
      return this.views.filter((view) => !connector || view.hosts.includes(connector));
    },
    operationScopeView(session = {}) {
      const scope = session.operationScope && typeof session.operationScope === "object"
        ? session.operationScope
        : {};
      const limited = scope.mode === "selection";
      const context = limited && scope.context && typeof scope.context === "object"
        ? scope.context
        : {};
      const host = String(session.host || "").toLowerCase();
      let confirmedSelection = "当前确认选区";
      if (host === "excel" || host.startsWith("et")) {
        const sheetName = String(context.sheetName || "").trim();
        const address = String(context.address || "").trim();
        confirmedSelection = address.includes("!")
          ? address
          : [sheetName, address].filter(Boolean).join(" ") || confirmedSelection;
      } else if (host === "word" || host.startsWith("wpp")) {
        const length = Number(context.length || 0);
        const hasRange = Number.isFinite(Number(context.start)) && Number.isFinite(Number(context.end));
        confirmedSelection = [
          hasRange ? `位置 ${context.start}-${context.end}` : "",
          length > 0 ? `${length} 字` : "",
        ].filter(Boolean).join(" · ") || confirmedSelection;
      }
      return Object.freeze({
        mode: limited ? "selection" : "document",
        limited,
        scopeLabel: limited ? `当前确认选区：${confirmedSelection}` : "整个文档/表格",
        confirmLabel: limited ? "更新选区" : "读取并确认",
        clearLabel: "取消限定",
        clearHidden: !limited,
        confirmDisabled: !session.sessionId,
        confirmTitle: limited
          ? "重新读取当前选区，并更新后续操作范围"
          : "读取当前选区，并将后续操作限制在该范围",
        clearTitle: "取消选区限定，后续操作恢复为整个文档/表格",
      });
    },
  });
  root.ConnectorSuiteUI = model;
  if (root.document?.documentElement) {
    root.document.documentElement.dataset.connectorProductVersion = model.productVersion;
    root.document.documentElement.dataset.connectorSharedVersion = model.sharedVersion;
  }
})(globalThis);
