# Technical Plan

## MVP Architecture

```text
Codex MCP client
  -> apps/mcp/server.js
  -> http://127.0.0.1:40215/api/tools/*
  -> apps/bridge/server.js
  -> per-session command queue
  -> apps/wps-addin/main.js polling loop
  -> WPS Application object
```

## 已验证

- The existing Office Connector uses this structure successfully for Microsoft Office: MCP wrapper, localhost bridge, session registration, command queue, add-in polling, command result callback.
- The current workspace is independent and initially empty except for this new project.
- Node syntax checks pass through `npm run check` after implementation.

## 从现有 Office Connector 推断

- Keep HTTP bridge endpoints simple and inspectable.
- Return `ok: false` with `{ code, message }` instead of throwing raw host errors to MCP.
- Store sessions in memory for MVP; persistent project binding can wait.
- Use explicit `sessionId` when provided; otherwise select the newest online session matching host type.

## 待 WPS 文档验证

- Whether WPS ET and WPS Writer add-ins run in one shared JS runtime or per-host runtime.
- Whether a ribbon callback can start background polling automatically without a visible taskpane.
- Whether WPS allows localhost HTTP calls without HTTPS or CORS limitations in the installed version.

## Phase 1 Scope

- List WPS sessions.
- Read WPS Spreadsheet current selection.
- Write WPS Spreadsheet target range.
- Read WPS Writer selection.
- Insert text into WPS Writer selection/insertion point.

## Phase 2 Deferred

- Project binding.
- Formatting tables and cells.
- Comments, images, document structure reads.
- Packaging with `wpsjs publish`.
- LaunchAgent installer and HTTPS certificate.

