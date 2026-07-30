export const METADATA_HEADER = "【Connector 来源元数据】";
export const LEGACY_OFFICE_HEADER = "【Office Connector 来源元数据】";
export const LEGACY_WPS_HEADER = "【WPS Connector 来源元数据】";
export const USER_REQUEST_HEADER = "【用户需求】";

const metadataHeaders = [METADATA_HEADER, LEGACY_OFFICE_HEADER, LEGACY_WPS_HEADER];

function hasMetadataHeader(text = "") {
  return metadataHeaders.some((header) => String(text || "").includes(header));
}

function lineValue(raw, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped}:\\s*(.*)$`, "m").exec(String(raw || ""))?.[1]?.trim() || "";
}

function connectorFromHeader(raw) {
  if (String(raw || "").includes(LEGACY_OFFICE_HEADER)) return "Office";
  if (String(raw || "").includes(LEGACY_WPS_HEADER)) return "WPS";
  return "";
}

export function buildSourcePrompt(metadata, userText) {
  const lines = [
    METADATA_HEADER,
    `Connector: ${metadata.connector || ""}`,
    `Host: ${metadata.host || ""}`,
    `Document: ${metadata.document || ""}`,
    `SessionId: ${metadata.sessionId || ""}`,
    `DocumentKey: ${metadata.documentKey || ""}`,
    `BindingId: ${metadata.bindingId || ""}`,
    `ThreadId: ${metadata.threadId || ""}`,
    `Project: ${metadata.project?.name || metadata.project?.path || metadata.project || ""}`,
    `Current context: ${metadata.currentContext || ""}`,
    `Operation scope: ${metadata.operationScope || ""}`,
    "",
    "路由规则：本轮需求来自上述 Connector/Host/SessionId。处理工具调用时，必须使用该 SessionId；不要因为同一对话里还有其他 session 在线就改用 recommended session。",
    "",
    USER_REQUEST_HEADER,
    String(userText || "").trim(),
  ];
  return lines.join("\n");
}

export function displayTextFromPrompt(text = "") {
  const raw = String(text || "").trim();
  if (!raw.includes(USER_REQUEST_HEADER)) return raw;
  if (!hasMetadataHeader(raw)) return raw;
  return raw.split(USER_REQUEST_HEADER).slice(1).join(USER_REQUEST_HEADER).trim() || raw;
}

export function metadataFromPrompt(text = "") {
  const raw = String(text || "");
  if (!hasMetadataHeader(raw)) return null;
  return {
    connector: lineValue(raw, "Connector") || connectorFromHeader(raw),
    host: lineValue(raw, "Host"),
    document: lineValue(raw, "Document"),
    sessionId: lineValue(raw, "SessionId"),
    documentKey: lineValue(raw, "DocumentKey"),
    bindingId: lineValue(raw, "BindingId"),
    threadId: lineValue(raw, "ThreadId"),
    project: lineValue(raw, "Project"),
    currentContext: lineValue(raw, "Current context"),
    operationScope: lineValue(raw, "Operation scope"),
  };
}

export function sourceLabelFromPrompt(text = "") {
  const metadata = metadataFromPrompt(text);
  if (!metadata) return "";
  const host = metadata.host || metadata.connector || "Connector";
  const range = /Range:\s*([^;]+)/.exec(metadata.currentContext || "")?.[1]?.trim() || "";
  return [host, range].filter(Boolean).join(" · ");
}
