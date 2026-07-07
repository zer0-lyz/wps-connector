# WPS Connector

WPS Connector connects Codex to open WPS Writer and WPS Spreadsheet documents through a local MCP bridge and WPS add-in runtime.

中文名：WPS 连接器。

## What It Installs

The package contains two connected parts:

- Codex plugin: skill, MCP server configuration, and WPS operation tools.
- WPS runtime: local bridge, WPS add-in files, taskpane server, LaunchAgent services, and project/thread binding UI.

Architecture:

```text
Codex
  -> WPS Connector MCP server
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
- git.
- Codex app or CLI with plugin support.

## One-Command Install

Run this on the target Mac:

```bash
curl -fsSL https://raw.githubusercontent.com/zer0-lyz/wps-connector/main/scripts/install-mac.sh | bash
```

The installer will:

- clone or update the repo at `$HOME/.local/share/wps-connector/source`;
- install the Codex plugin into `$HOME/.codex/plugins/cache/personal/wps-connector/0.1.0`;
- deploy runtime files to `$HOME/.local/share/wps-connector/runtime`;
- install LaunchAgents for the bridge and add-in server;
- configure the WPS jsaddons files for the current macOS user;
- run basic health checks.

No `/Users/<name>` path is hard-coded. Override paths with environment variables when needed:

```bash
WPS_CONNECTOR_SOURCE_ROOT="$HOME/Code/wps-connector" \
WPS_CONNECTOR_RUNTIME_ROOT="$HOME/.local/share/wps-connector/runtime" \
WPS_CONNECTOR_PLUGIN_INSTALL_DIR="$HOME/.codex/plugins/cache/personal/wps-connector/0.1.0" \
bash scripts/install-mac.sh
```

## Verify

```bash
curl -sS http://127.0.0.1:40215/api/health
curl -sS http://127.0.0.1:3891/health
node "$HOME/.local/share/wps-connector/runtime/scripts/agent-connection-status.js" --onlyOnline
```

For MCP visibility, Codex should expose both dotted and underscore tool names, including:

- `wps.list_sessions` / `wps_list_sessions`
- `wps.connection_status` / `wps_connection_status`
- `wpp.add_comment_by_text` / `wpp_add_comment_by_text`
- `wpp.add_comments_batch` / `wpp_add_comments_batch`
- `et.read_range` / `et_read_range`

## Use With WPS

1. Open WPS Writer or WPS Spreadsheet.
2. Open the `WPS Connector` pane from the WPS add-in entry.
3. In the pane, choose and save the Codex project/thread binding if needed.
4. Return to Codex and ask it to confirm the WPS connection before writing.

WPS add-in loading is version-dependent. If WPS keeps an old WebView script after an upgrade, reopen the Connector Pane or restart WPS so it loads the current `main.js`.

## Agent Connection Flow

For Codex sub-agents or other models, run this preflight before any document write:

```bash
node "$HOME/.local/share/wps-connector/runtime/scripts/agent-connection-status.js" --onlyOnline --host wpp
node "$HOME/.local/share/wps-connector/runtime/scripts/agent-connection-status.js" --onlyOnline --host et --projectId <projectId> --threadId <threadId>
```

Agents should stop on non-empty `issues`; otherwise use `recommendedSession.sessionId` or pass the same binding selector to the target tool. For multi-window work, pass `projectId` plus `threadId` or the full binding selector so Writer and Spreadsheet calls cannot route to the wrong WPS pane.

## Important Local Paths

Runtime:

```text
$HOME/.local/share/wps-connector/runtime
```

Source checkout used by the one-command installer:

```text
$HOME/.local/share/wps-connector/source
```

Codex plugin install:

```text
$HOME/.codex/plugins/cache/personal/wps-connector/0.1.0
```

WPS jsaddons:

```text
$HOME/Library/Containers/com.kingsoft.wpsoffice.mac/Data/.kingsoft/wps/jsaddons
```

## Development Commands

```bash
npm run check
npm test
npm run deploy
npm run launchd:install
npm run runtime:start
npm run runtime:stop
```

## Current Version

- UI/clientVersion: `v1.0.28`
- clientBuild: `2026.06.30-writer-native-find.1`

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
- text replacement, text-anchored comments, batch comments, and revision tools;
- tables, images, comments, save, and style/layout helpers.

## Known Boundaries

- The installer configures the local runtime and WPS jsaddons files. The user may still need to open the WPS Connector pane in WPS manually.
- Track changes tools return `TRACK_CHANGES_UNSUPPORTED` when the WPS host does not expose a compatible revisions API.
- Codex Desktop may cache MCP tool discovery per conversation. If a newly installed tool is not visible in `tool_search`, reload the plugin or start a new Codex thread.
