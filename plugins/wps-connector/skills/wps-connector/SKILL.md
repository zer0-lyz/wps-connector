---
name: wps-connector
description: Use for WPS Writer or Spreadsheet automation. If MCP returns unsupported call, especially through AiMaMi, DeepSeek, or MiniMax, immediately use the local agent-tool-call gateway without retrying MCP or asking the user for another prompt.
---

# WPS Connector

## Mandatory Routing

Try one exact MCP tool handle only when tool discovery returned that handle. Never invent a full `mcp__...` function name. If any WPS MCP call returns `unsupported call`, stop retrying MCP immediately and use `scripts/agent-tool-call.js` for the current and all remaining WPS calls in that task. Do this automatically without asking the user to provide an extra prompt.

The gateway accepts the same dotted or underscore tool name and the same JSON arguments. Always preserve `sessionId`, `bindingId`, `projectId`, and `threadId` when present. A gateway result is authoritative for bridge and WPS execution status.

Use the WPS Connector MCP server exposed by this plugin. Runtime files live at `$HOME/.local/share/wps-connector/runtime` unless `WPS_CONNECTOR_RUNTIME_ROOT` overrides it. Project folders are source code or documents, not the live runtime directory. The default bridge URL is `http://127.0.0.1:40215`.

Use one fast connection call before live WPS work: `wps.connection_status` or `wps_connection_status` with `onlyOnline:true` plus the current Codex `projectPath` or `projectId`, and `host` only when the requested host is already known. Do not call `wps.list_sessions` first and do not scan all sessions repeatedly. When `issues` is empty, reuse `recommendedSession.sessionId` and its binding fields for the rest of the task.

For Writer paragraph format work, prefer `wpp.copy_paragraph_format`, `wpp.apply_paragraph_format_by_indexes`, `wpp.compare_paragraph_format`, and `wpp.copy_selected_paragraph_format_to_indexes`.

For Writer comments, prefer `wpp.add_comment_by_text` and `wpp.add_comments_batch` over manual `find_text` plus `add_comment`.

Dotted and underscore MCP names are both supported.

Fallback CLI for non-MCP agents:

```bash
node "$HOME/.local/share/wps-connector/runtime/scripts/agent-connection-status.js" --onlyOnline --host wpp
node "$HOME/.local/share/wps-connector/runtime/scripts/agent-tool-call.js" wps.connection_status '{"onlyOnline":true}'
node "$HOME/.local/share/wps-connector/runtime/scripts/agent-tool-call.js" et.list_worksheets '{"sessionId":"wps-et-example"}'
```
