# WPS Connector (ZCode 插件)

通过本地 MCP 桥接自动化操作 WPS 文字（Writer）与表格（Spreadsheet），暴露 133 个工具：
选区/范围读写、公式与数字格式、段落与文本格式、文本锚点批注、修订、表格批量格式化、
跨文档表格同步、图表插入等。

## 前提

- WPS Office 桌面版正在运行，且已部署 WPS Connector 运行时
  （bridge `http://127.0.0.1:40215`、add-in `http://127.0.0.1:3891`）。
- 运行时目录：`~/.local/share/wps-connector/runtime`。

## 使用

1. 打开 WPS 文档与 Connector 窗格。
2. 写操作前先做连接检查：`wps.connection_status`（`onlyOnline: true`）。
3. 工具名支持 `wps.connection_status` 与 `wps_connection_status` 两种写法。

## 降级路径

若 MCP 调用被客户端拒绝（`unsupported call`），改用命令行网关：

```bash
node "$HOME/.local/share/wps-connector/runtime/scripts/agent-tool-call.js" \
  wps.connection_status '{"onlyOnline":true}'
```

来源：https://github.com/zer0-lyz/wps-connector
