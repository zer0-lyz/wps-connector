# WPS Connector Plugin

This plugin exposes the local WPS Connector runtime to Codex through MCP.

Runtime files live in:

```bash
/Users/lin/.local/share/wps-connector/runtime
```

The OneDrive project folder is source code and documentation only. Do not use it as the live runtime directory.

The bundled MCP configuration points Codex to:

```bash
/Users/lin/.local/share/wps-connector/runtime/apps/mcp/server.js
```

The bridge and add-in services should be managed by LaunchAgent after installation:

```bash
cd /Users/lin/.local/share/wps-connector/runtime
npm run launchd:install
```

Health checks:

```bash
curl http://127.0.0.1:40215/api/health
curl http://127.0.0.1:3891/health
```
