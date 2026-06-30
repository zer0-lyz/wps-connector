# WPS Connector

WPS Connector connects Codex to open WPS Writer and WPS Spreadsheet documents through a local MCP bridge and WPS add-in runtime.

中文名：WPS 连接器。

## What It Installs

The full package contains two connected parts:

- Codex plugin: skill, MCP server configuration, and WPS operation tools.
- WPS runtime: local bridge, WPS add-in files, taskpane server, LaunchAgent services, and project/thread binding UI.

Architecture:

```text
Codex
  -> Codex plugin skill / MCP server
  -> local bridge at http://127.0.0.1:40215
  -> command queue
  -> WPS add-in taskpane at http://127.0.0.1:3891
  -> WPS JS API
  -> WPS Writer / WPS Spreadsheet
```

## Requirements

- macOS.
- WPS Office desktop app.
- Node.js 20 or later.
- Codex CLI/app with plugin support.

The Codex plugin shape is cross-platform, but the bundled local runtime installer currently supports macOS only.

## One-Command Install

After cloning or downloading this repository:

```bash
bash scripts/bootstrap-mac.sh
```

The bootstrap script will:

- copy `plugins/wps-connector` to `~/plugins/wps-connector`;
- update `~/.agents/plugins/marketplace.json`;
- run `codex plugin add wps-connector@personal` when the Codex CLI is available;
- deploy runtime files to `~/.local/share/wps-connector/runtime`;
- install LaunchAgents for the bridge and add-in server.

## Verify

```bash
npm test
curl -sS http://127.0.0.1:40215/api/health
curl -sS http://127.0.0.1:40215/api/tools/schema
curl -sS http://127.0.0.1:3891/health
```


## Agent Connection Flow

For Codex sub-agents or other models, use this preflight before any document write:

```bash
node scripts/agent-connection-status.js --onlyOnline --host wpp
node scripts/agent-connection-status.js --onlyOnline --host et --projectId <projectId> --threadId <threadId>
```

The same preflight is exposed as MCP tools with both naming styles:

- `wps.connection_status`
- `wps_connection_status`

The JSON response includes bridge/add-in health, filtered sessions, binding match status, `recommendedSession`, structured `issues`, and `nextActions`. Agents should stop on non-empty `issues` instead of guessing a session. For multi-window work, pass `projectId` + `threadId` or the full `binding` selector so Writer and Spreadsheet calls cannot route to the wrong WPS pane.

## Use With WPS

1. Open WPS Writer or WPS Spreadsheet.
2. Open the `WPS Connector` pane from the WPS add-in entry.
3. In the pane, choose and save the Codex project/thread binding if needed.
4. Return to Codex and ask it to confirm the WPS connection before writing.

WPS add-in loading is version-dependent. If WPS keeps an old WebView script after an upgrade, reopen the Connector Pane or restart WPS so it loads the current `main.js`.

## Important Local Paths

Runtime:

```text
~/.local/share/wps-connector/runtime
```

Codex plugin source:

```text
~/plugins/wps-connector
```

Personal marketplace:

```text
~/.agents/plugins/marketplace.json
```

## Development Commands

```bash
npm test
npm run check
npm run deploy
npm run launchd:install
npm run runtime:start
npm run runtime:stop
```

## Current Version

- UI/clientVersion: `v1.0.25`
- clientBuild: `2026.06.30-writer-paragraph-format-fast.1`

## Current Tool Surface

Session:

- `wps.list_sessions` / `wps_list_sessions`
- `wps.connection_status` / `wps_connection_status`

WPS Spreadsheet (`et`) tools:

- selection, worksheet list/add/rename/delete;
- range read/write/format/clear/insert/delete;
- formulas, number formats, find cells, and batch `write_blocks`.

WPS Writer (`wpp`) tools:

- document identity, document text, selection and format reads;
- stable range selection with resolved text verification;
- paragraph-indexed formatting, batch paragraph format application, and paragraph format copying;
- text/news insertion and paragraph formatting;
- tables, images, comments;
- track changes / revisions where the WPS host API supports them.

## Known Boundaries

- WPS native add-in installation and debugging flows differ by WPS version. The runtime and Codex plugin install automatically; the WPS host may still require enabling/opening the connector pane in WPS.
- Track changes tools return `TRACK_CHANGES_UNSUPPORTED` when the WPS host does not expose a compatible revisions API.
- Writer character offsets use the connector's normalized WPS text model. `select_range` and `add_comment` return `requestedStart`, `requestedEnd`, `resolvedStart`, `resolvedEnd`, `resolvedText`, and `exactMatch` so anchor drift is auditable.
