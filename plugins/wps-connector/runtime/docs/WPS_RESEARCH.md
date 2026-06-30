# WPS Research Notes

## 已验证

- WPS has a distinct add-in system. Official WPS documentation describes a WPS add-in as a combination of a custom ribbon and web/JavaScript logic. The ribbon file is `ribbon.xml`, and WPS creates/opens an `index.html` that loads `main.js`.
- WPS add-ins expose an automation model through `Application`, not Microsoft `Office.js`.
- WPS Spreadsheet API documentation includes `Application`, `ActiveSheet`, `Range`, `Cells`, `Selection`, and examples assigning `Range("A5").Value2 = Range("A1").Value2`.
- WPS Writer API documentation includes `Application.ActiveDocument` and `Application.Selection`, and says `Application.Selection` returns a `Selection` object representing the selected range or insertion point.
- WPS add-in deployment has version-specific constraints. WPS community guidance says newer personal versions require `wpsjs publish`; older `oem.ini` / `jsplugins.xml` style deployment is restricted in personal edition after `12.1.0.16910`.

## 从现有 Office Connector 推断

- Keep Codex-facing tools stable and host-neutral.
- Keep the MCP server thin: MCP stdio validates tool names and forwards calls to the local bridge.
- Keep the bridge responsible for session lifecycle, command queue, timeouts, and HTTP tool endpoints.
- Keep WPS host code responsible for executing only one delivered command at a time and posting results back.

## 待 WPS 文档验证

- Exact macOS WPS add-in installation path and publish/debug workflow.
- Whether the WPS personal edition on this Mac allows local `main.js` loading through `wpsjs debug` or requires `wpsjs publish`.
- Exact behavior of cross-origin `fetch("http://127.0.0.1:40215")` from the WPS add-in JavaScript runtime.
- Exact shape returned by WPS Spreadsheet `Range.Value2` for single-cell and multi-cell ranges.
- Exact callable/property semantics for `Selection.Address`, `Range.Address`, and Writer `Selection.Text`.

## Primary Source URLs

- WPS add-in development instructions: `https://qn.cache.wpscdn.cn/encs/doc/office_v8/topics/WPS%20%E5%8A%A0%E8%BD%BD%E9%A1%B9%E5%BC%80%E5%8F%91/WPS%20%E5%8A%A0%E8%BD%BD%E9%A1%B9%E5%BC%80%E5%8F%91%E8%AF%B4%E6%98%8E.html`
- WPS Spreadsheet Range object: `https://qn.cache.wpscdn.cn/encs/doc/office_v8/topics/WPS%20%E5%8A%A0%E8%BD%BD%E9%A1%B9%E5%BC%80%E5%8F%91/%E8%A1%A8%E6%A0%BC%20API%20%E5%8F%82%E8%80%83/Range/Range%20%E5%AF%B9%E8%B1%A1.htm`
- WPS Spreadsheet Application object: `https://qn.cache.wpscdn.cn/encs/doc/office_v8/topics/WPS%20%E5%8A%A0%E8%BD%BD%E9%A1%B9%E5%BC%80%E5%8F%91/%E8%A1%A8%E6%A0%BC%20API%20%E5%8F%82%E8%80%83/Application/Application%20%E5%AF%B9%E8%B1%A1.htm`
- WPS Writer Application object: `https://qn.cache.wpscdn.cn/encs/doc/office_v8/topics/WPS%20%E5%8A%A0%E8%BD%BD%E9%A1%B9%E5%BC%80%E5%8F%91/%E6%96%87%E5%AD%97%20API%20%E5%8F%82%E8%80%83/Application/Application%20%E5%AF%B9%E8%B1%A1.htm`
- WPS Writer Range object: `https://qn.cache.wpscdn.cn/encs/doc/office_v8/topics/WPS%20%E5%8A%A0%E8%BD%BD%E9%A1%B9%E5%BC%80%E5%8F%91/%E6%96%87%E5%AD%97%20API%20%E5%8F%82%E8%80%83/Range/Range%20%E5%AF%B9%E8%B1%A1.htm`

