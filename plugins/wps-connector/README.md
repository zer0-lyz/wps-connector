# WPS Connector Codex Plugin

This plugin gives Codex an MCP entrypoint for WPS Writer and WPS Spreadsheet.

## One-Command Install From A Cloned Repo

From the repository root:

```bash
bash scripts/bootstrap-mac.sh
```

The bootstrap script installs both sides:

- Codex plugin source into `~/plugins/wps-connector`.
- Personal Codex marketplace entry in `~/.agents/plugins/marketplace.json`.
- Codex plugin cache through `codex plugin add wps-connector@personal` when the Codex CLI is available.
- WPS runtime into `~/.local/share/wps-connector/runtime`.
- LaunchAgent services for the bridge at `http://127.0.0.1:40215` and add-in server at `http://127.0.0.1:3891`.

## Use

1. Open WPS Writer or WPS Spreadsheet.
2. Open the WPS Connector Pane from the installed WPS add-in entry.
3. Bind the document to a Codex project/thread if needed.
4. In Codex, call `wps.list_sessions` / `wps_list_sessions` and operate on the bound session.

WPS add-in loading is host-version dependent. If WPS keeps an old WebView script, reopen the Connector Pane or restart WPS after upgrades.
