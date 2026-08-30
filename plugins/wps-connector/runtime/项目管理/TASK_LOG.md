# 操作日志

## 2026-08-29

- 创建专项分支 `codex/table-format-module-debug-0.2.1`，基线为 `ed1e44d`。
- 保留进入分支前已有未提交修改；未执行 reset、checkout --、删除或覆盖原有成果。
- 通过静态检查：`npm run check`、指定 `node --check`、`git diff --check`。
- 已确认项目内原缺少项目管理文件，现已补齐。
- 真实 WPS/Office 写入未执行：当前在线会话不是本专项测试文档，状态保持 `PENDING_REAL_HOST_ACCEPTANCE`。
- 本轮确认 WPS 实际 runtime 曾落后于源码，导致精确读取 `numberFormat`、对齐和 `wrapText` 未加载；已将源码、插件 runtime 与正式 runtime 同步，并将资源缓存键更新为 `20260829-wps-table-format-readback-0.2.1.4`。
- 本轮 `npm run check`、`npm test`、`git diff --check` 通过；已原子部署并备份至 `/Users/zer0y/Library/Application Support/Connector Suite/backups/wps-runtime/20260829-220708/runtime`。
- 部署后健康检查通过，但当前在线 WPS 会话仍为旧 `clientBuild=2026.08.29-wps-table-sync-performance.1`，尚未重载页面；真实 ET→WPP 格式回读继续保持 `PENDING_REAL_HOST_ACCEPTANCE`。

- 修复 WPS 文字同步页“插入并绑定”无反馈：点击处理增加事件阻止、按钮忙状态和阶段提示；Bridge/JSON 错误现在保留错误码；插入前刷新会话并按数据源文档精确匹配 ET session；插入完成后绑定状态刷新失败不再覆盖已完成结果。
- 现场验证：源数据源 `e7025897-4183-4256-af9e-69f3ee1d502a` 指向的表格文档当前不在线，真实请求返回 `NO_ACTIVE_ET_SESSION`，无文档写入；正式 Bridge 日志已记录 `[table-sync] request/failed`。
- 网关新增表格同步审计日志，覆盖 insert/create-sync/sync 的请求、完成和失败阶段。`npm run check`、`npm test`、`git diff --check` 通过；已原子部署并备份至 `/Users/zer0y/Library/Application Support/Connector Suite/backups/wps-runtime/20260829-222357/runtime`。
- 进一步升级 WPS Add-in build/cache 为 `2026.08.29-wps-table-sync-click-feedback.1`，确保重开面板加载本轮点击反馈修复；`npm run check`、`git diff --check` 通过，正式服务健康，当前命令队列为空。
- 第二次原子部署备份至 `/Users/zer0y/Library/Application Support/Connector Suite/backups/wps-runtime/20260829-222617/runtime`。部署后的正式现场仍无在线 WPS session，等待用户重开源表和目标文字面板进行真实插入验收。

## 2026-08-30 开发版推送前核验

- 复核当前分支 `codex/table-format-module-debug-0.2.1` 的代码、共享模块、插件 runtime 副本和项目档案，未发现待纳入的日志、缓存、安装包或用户配置。
- `npm run check`、`npm test`、`git diff --check` 全部通过；`npm test` 的 ET/WPP 表格同步、格式回读和绑定回归通过。
- 真实 WPS Writer 验收保持 `PENDING_REAL_HOST_ACCEPTANCE`，本次开发版推送不将其误报为宿主验收完成。
- 已完成：提交 `928f7b2` 并推送至 `origin/codex/table-format-module-debug-0.2.1`。
- 远程地址：`https://github.com/zer0-lyz/wps-connector/tree/codex/table-format-module-debug-0.2.1`。
- 接续方式：Mac mini 从该开发分支拉取并继续开发；未提交 `main`、未创建正式 tag/release、未上传安装包。
