---
name: wps-connector
description: Use when the user asks to connect Codex to WPS Spreadsheets or WPS Writer through the local WPS Connector MCP bridge.
---

# WPS Connector

Use the WPS Connector MCP server exposed by this plugin. Runtime files live at `$HOME/.local/share/wps-connector/runtime` unless `WPS_CONNECTOR_RUNTIME_ROOT` overrides it. Project folders are source code or documents, not the live runtime directory. The default bridge URL is `http://127.0.0.1:40215`.

Before calling live WPS tools, run `wps.connection_status` or `wps_connection_status` with `onlyOnline:true` and the expected host/project/thread selector. Use `recommendedSession.sessionId` only when `issues` is empty. For project-specific work, require the WPS session binding to match the Codex project/thread to avoid cross-window routing.

For Writer paragraph format work, prefer `wpp.copy_paragraph_format`, `wpp.apply_paragraph_format_by_indexes`, `wpp.compare_paragraph_format`, and `wpp.copy_selected_paragraph_format_to_indexes`.

For Writer comments, prefer `wpp.add_comment_by_text` and `wpp.add_comments_batch` over manual `find_text` plus `add_comment`.

Dotted and underscore MCP names are both supported.

Fallback CLI for non-MCP agents:

```bash
node "$HOME/.local/share/wps-connector/runtime/scripts/agent-connection-status.js" --onlyOnline --host wpp
```
