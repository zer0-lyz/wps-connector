---
name: wps-connector
description: Use when the user asks to connect Codex to WPS Spreadsheets or WPS Writer through the local WPS Connector MCP bridge.
---

# WPS Connector

Use the WPS Connector MCP server exposed by this plugin. Runtime files live at `~/.local/share/wps-connector/runtime`; the default bridge URL is `http://127.0.0.1:40215`.

Before calling live WPS tools, confirm the bridge is running and list active sessions with `wps.list_sessions` or `wps_list_sessions`. For project-specific work, require the WPS session binding to match the Codex project/thread to avoid cross-window routing.

Prefer bound, online sessions with non-empty `documentName` and `documentPath`. If a session is offline, ask the user to reopen the WPS Connector Pane in that document.
