# 操作日志

## 2026-08-30

- 修复 ET→WPP 文本格式刷新对大范围逐字段读取导致的 WPS 宿主阻塞；profile 现在只使用已读取的代表单元格生成 exactFields，避免刷新失败后继续使用缺少斜体、下划线和缩进的旧快照。
- 统一 WPP 颜色和布尔值比较，避免 OLE 颜色值被误报为格式不一致；递增 Add-in build/cache 到 `2026.08.30-wps-table-sync-text-format.2` / `20260830-wps-table-sync-text-format-0.2.1.2`。
- `npm run check`、`npm test`、`git diff --check` 通过；`npm run test:et` 仍需真实 WPS 重启并绑定项目后执行，当前未写入业务工作簿。
- 已部署并备份正式 runtime：`/Users/lin/.local/share/wps-connector/runtime`，备份 `/Users/lin/Library/Application Support/Connector Suite/backups/wps-runtime/20260830-130645/runtime`；未推送 GitHub。

## 2026-08-30

- 补齐 ET→WPS Writer 文字格式同步：读取并迁移 `bold/italic/underline/fontName/fontSize/fontColor/alignment/wrapText/indentLevel/leftIndent/firstLineIndent/rightIndent`。
- `et.format_range` 新增公开 schema 和宿主写入支持，可直接设置斜体、下划线及缩进字段；数值 0 也会被作为明确设置处理。
- 修复 `wpsConnectorWppCellMergeInfo` 对未定义 `format` 的引用，恢复 WPP 单元格读写接口在合并判断下的正常执行。
- `npm run check`、`npm test`、`git diff --check` 通过；真实 WPS 文字格式与保存重开回读仍标记 `PENDING_REAL_HOST_ACCEPTANCE`。
- Add-in build 为 `2026.08.30-wps-table-sync-text-format.1`；不推送 GitHub。

## 2026-08-30

- 优化 WPS Writer 表格格式批处理：按格式签名分组，连续目标区域使用矩形 Range 批量设置；合并单元格信息在整次表格格式应用中只读取一次，无法使用快路径时逐单元格回退。
- 新增表格插入任务进度：Bridge 记录 `operationId`、阶段、百分比、耗时和单元格计数，提供 `GET /api/operations/:operationId`；面板显示实时进度和当前阶段。
- `wpp.insert_table` 的 WPS 安全 `per-cell` 内容写入保护保持不变，危险 `row-range-bulk` 仍未改为默认路径。
- Add-in build 更新为 `2026.08.30-wps-table-sync-progress.1`，已备份并部署到 `/Users/lin/.local/share/wps-connector/runtime`，备份为 `/Users/lin/Library/Application Support/Connector Suite/backups/wps-runtime/20260830-111820/runtime`。
- `npm run check`、`npm test`、`git diff --check` 通过；真实 WPS 业务文档插入未执行，保持 `PENDING_REAL_HOST_ACCEPTANCE`。

## 2026-08-30

- 修复历史格式快照缺少 `numberFormat` 时的 Writer 显示：普通数字在插入前按原始小数位补充千分位，避免 `108139.15` 直接写入文档；显式数字格式和非普通数字文本不走兜底。
- 新增端到端回归：空数字格式快照插入 Writer 后读回 `108,139.15`、`282,510`；`npm run check`、`npm test`、`git diff --check` 通过。
- 已原子部署并备份正式 runtime：`/Users/lin/.local/share/wps-connector/runtime`，备份 `/Users/lin/Library/Application Support/Connector Suite/backups/wps-runtime/20260830-105517/runtime`。
- 真实 `npm run test:et` 因 WPS 会话等待切回文档导致 `COMMAND_TIMEOUT`，测试创建的临时回归工作表未能自动清理；真实宿主验收保持 `PENDING_REAL_HOST_ACCEPTANCE`，未继续写入业务文档。

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

## 2026-08-30

- 根据真实反馈“点击插入并绑定后 WPS Writer 卡死”排查：Bridge 已收到 `wps.insert_et_wpp_data_source`，但 WPP 命令连续 60 秒超时；此前实现默认尝试 `Row.Range.Text` 内部单元格标记批量写入，并对新表执行预读/恢复，插入后还执行段落追加和选区释放。
- `apps/wps-addin/main.js`：将 `row-range-bulk` 改为显式 opt-in；新表默认强制 `per-cell` 安全路径，跳过空表预读/恢复，使用直接 cell Range setter 减少 COM 往返；当前 Writer 文档已激活时跳过 `Document.Activate()`。
- `apps/bridge/server.js`：为插入并绑定增加源表读取、目标表插入、格式应用、绑定建立的阶段审计日志；同步插入请求关闭 `releaseSelection` 和 `ensureTrailingParagraph`。
- `apps/wps-addin/simulator.js`、`tests/e2e.js`：同步安全路径模型和验收断言，避免模拟测试继续把危险路径当作默认成功路径。
- 验证：`npm run check` 通过；`npm test` 通过；`git diff --check` 通过；正式 Bridge/Add-in 健康检查通过；文件已核对源码、插件 runtime、正式 runtime 一致。
- 部署与备份：原子部署至 `/Users/zer0y/.local/share/wps-connector/runtime`，备份 `/Users/zer0y/Library/Application Support/Connector Suite/backups/wps-runtime/20260830-021644/runtime`；未提交 GitHub、未生成安装包。
- 真实验收仍待用户重启 WPS 后执行；当前 Bridge `/api/debug/commands` 无活跃命令，当前无在线 WPS session。

## 2026-08-30 开发版推送前核验

- 复核当前分支 `codex/table-format-module-debug-0.2.1` 的代码、共享模块、插件 runtime 副本和项目档案，未发现待纳入的日志、缓存、安装包或用户配置。
- `npm run check`、`npm test`、`git diff --check` 全部通过；`npm test` 的 ET/WPP 表格同步、格式回读和绑定回归通过。
- 真实 WPS Writer 验收保持 `PENDING_REAL_HOST_ACCEPTANCE`，本次开发版推送不将其误报为宿主验收完成。
- 已完成：提交 `928f7b2` 并推送至 `origin/codex/table-format-module-debug-0.2.1`。
- 远程地址：`https://github.com/zer0-lyz/wps-connector/tree/codex/table-format-module-debug-0.2.1`。
- 接续方式：Mac mini 从该开发分支拉取并继续开发；未提交 `main`、未创建正式 tag/release、未上传安装包。

## 2026-08-30 继续维护与本机部署

- 从 `origin/codex/table-format-module-debug-0.2.1` 的 `7082516` 创建独立 worktree；原 `/Users/lin/.local/share/wps-connector/source` 工作树未被覆盖。
- 修复 `scripts/deploy-runtime-mac.sh`、`scripts/sync-plugin-runtime-mac.sh` 及其 runtime 副本：将 `table-format-templates.local.json` 纳入排除和迁移列表，部署时保留已保存模板并支持回滚。
- 修复 `scripts/regression-et.js` 默认 `clientBuild`，与 `apps/wps-addin/main.js` 当前 `2026.08.29-wps-table-sync-click-feedback.1` 一致。
- `npm run check`、`npm test`、`git diff --check` 通过；`npm run test:et` 因当前真实 WPS pane 仍报告旧 `clientVersion=1.1.8` 在预检阶段停止，未产生工作簿修改。
- 正式 runtime 已备份并原子替换到 `/Users/lin/.local/share/wps-connector/runtime`，备份 `/Users/lin/Library/Application Support/Connector Suite/backups/wps-runtime/20260830-092423/runtime`；当前 runtime package `0.2.1`，Add-in build `2026.08.29-wps-table-sync-click-feedback.1`。
- Bridge `40215`、Add-in `3891`、Connector Platform `40315` 健康；WPS Writer/Spreadsheet 自动重载和真实插入绑定因 Mac 锁屏无法执行，继续标记 `PENDING_REAL_HOST_ACCEPTANCE`。

## 2026-08-30 表格同步“清单可见但插入不执行”

- 现场确认：`/api/tools/wps/list_et_wpp_data_sources` 能返回数据源的文档、Sheet、地址、行列和格式信息，但 `/api/sessions` 无在线 ET/WPP session；这只能证明配置读取成功。
- 修改：新增本机源表值快照加载/保存；`insert_et_wpp_data_source` 和 `create_et_wpp_table_sync` 支持快照执行路径；面板不再把快照可用的数据源拦截为“源表离线”，并在刷新同一范围时复用 sourceId。
- 测试：`npm run check` PASS；`npm test` PASS；模拟表格插入、格式应用、回读、绑定 PASS；真实 WPS 插入 PENDING_REAL_HOST_ACCEPTANCE。
- 部署：已部署到 `/Users/lin/.local/share/wps-connector/runtime`，备份 `/Users/lin/Library/Application Support/Connector Suite/backups/wps-runtime/20260830-102323/runtime`；未推送。
