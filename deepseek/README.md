# DeepSeek Harness 接入

安装并运行 WPS Connector 后，在本机终端执行：

```sh
bash "$HOME/.local/share/wps-connector/runtime/deepseek/setup-mac.sh"
```

脚本添加 DeepSeek Desktop 的本机适配器并备份配置，不读取模型凭据。若适配器没有自动加载，待 DeepSeek 中任务结束后重启 DeepSeek。打开 WPS 连接面板，选择 DeepSeek Harness、工作目录和具体对话并保存绑定，再到同一 DeepSeek 对话操作 WPS 文档。已有连接器和文档绑定会保留。

当前通过 Agent 的会话身份匹配文档；同一对话绑定多个同类文档时，需要指定 WPS sessionId。支持 15 项常用 WPS 文字和表格工具及连接状态；工作目录从已有会话归集，不列出空工作区。WPS 面板内向 DeepSeek 发送消息尚未支持。更换或关闭 DeepSeek 后，等待其适配器重新加载再刷新 WPS 面板。

恢复时从 Desktop 的 `cordis.patch.yml` 删除 `wps-connector-deepseek` 对应插入项，删除 `node_modules/@local/wps-connector-deepseek` 符号链接；不要用备份整体覆盖后续配置。
