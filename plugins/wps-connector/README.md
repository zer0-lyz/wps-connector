# WPS Connector Plugin

This plugin exposes the local WPS Connector runtime to Codex through MCP.

## Install

Recommended one-command install:

```bash
curl -fsSL https://raw.githubusercontent.com/zer0-lyz/wps-connector/main/scripts/install-mac.sh | bash
```

The live runtime is deployed to:

```text
$HOME/.local/share/wps-connector/runtime
```

The bundled MCP configuration is updated during deployment to point Codex to:

```text
$HOME/.local/share/wps-connector/runtime/apps/mcp/server.js
```

The bridge and add-in services are managed by LaunchAgent after installation:

```bash
cd "$HOME/.local/share/wps-connector/runtime"
npm run launchd:install
```

Health checks:

```bash
curl http://127.0.0.1:40215/api/health
curl http://127.0.0.1:3891/health
```

## Agent Preflight

Call `wps.connection_status` or `wps_connection_status` before Writer/Spreadsheet writes. Stop on non-empty `issues`; otherwise use `recommendedSession.sessionId` or pass the same binding selector to the target tool.
