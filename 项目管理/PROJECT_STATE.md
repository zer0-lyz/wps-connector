# 当前状态

## 2026-08-30 ET 数据源加入清单性能优化

- 根因：WPS 表格面板的“加入清单”强制使用 `formatReadMode:"full"`，逐单元读取完整格式；同时重复读取选区并完整刷新同步视图。
- 修复：默认改为 `formatReadMode:"profile"`，创建数据源时复用已读取的地址，避免重复 `et.read_selection`；完成后只刷新数据源/绑定清单，不再次刷新选区。
- 边界：轻量 profile 仍保留字体、字号、加粗、斜体、下划线、对齐、换行和缩进等代表性格式；需要逐单元精确快照时仍可显式传 `formatReadMode:"full"`。
- 版本：WPS Add-in `clientVersion=0.2.1`，`clientBuild=2026.08.30-wps-table-sync-text-format.6`。
- 验证：`npm run check`、`npm test`、`git diff --check` 通过；Bridge 健康，源码/插件 runtime/正式 runtime 关键文件一致。
- 部署：正式 runtime `/Users/lin/.local/share/wps-connector/runtime`；备份 `/Users/lin/Library/Application Support/Connector Suite/backups/wps-runtime/20260830-154130/runtime`；未推送 GitHub。
- 真实 WPS：等待用户重启 WPS 后验证“加入清单”耗时和格式效果，状态为 `PENDING_REAL_HOST_ACCEPTANCE`。

## 2026-08-30 ET→WPS Writer 文本格式刷新性能修复

- 状态：`deployed / pending real WPS reload and acceptance`。
- 修复：profile 格式刷新改为表头及各数据列代表单元格的有界采样，不再对整块区域逐字段逐单元读取；保留 `bold`、`italic`、`underline`、字体、字号、颜色、对齐、换行和缩进迁移。
- 校验：WPP 颜色比较统一 OLE 数值与 RGB 文本；旧格式快照按需刷新；进度摘要保留 `formatting.verified` 和抽样差异。
- 版本：WPS Add-in `clientVersion=0.2.1`，`clientBuild=2026.08.30-wps-table-sync-text-format.2`，页面 cache key 为 `20260830-wps-table-sync-text-format-0.2.1.2`。
- 验证：`npm run check`、`npm test`、`git diff --check` 通过；真实 WPS 当前仍显示旧 `.1`，重启并重新加载 WPS 后再执行真实插入回读。
- 部署：正式 runtime `/Users/lin/.local/share/wps-connector/runtime`；本轮备份 `/Users/lin/Library/Application Support/Connector Suite/backups/wps-runtime/20260830-130645/runtime`；未推送 GitHub。

## 2026-08-30 ET→WPS Writer 文字格式同步补齐

- 状态：`deployed / pending real WPS acceptance`。
- 同步字段：数据源单元格的 `bold`、`italic`、`underline`、`fontName`、`fontSize`、`fontColor`、水平/垂直对齐、自动换行、`indentLevel`、`leftIndent`、`firstLineIndent`、`rightIndent` 现在会进入 Writer 表格格式 payload，并在插入后的抽样回读中校验。
- 主动设置：`et.format_range` 的公开 schema 和 Add-in 执行层补齐斜体、下划线及缩进字段，避免只能读取不能设置。
- 稳定性：修复 WPP `read_table_cell`/`write_table_cell` 合并区域判断引用未定义 `format` 的运行时异常；合并信息读取可复用已提供的快照。
- 版本：WPS Add-in `clientVersion=0.2.1`，`clientBuild=2026.08.30-wps-table-sync-text-format.1`。
- 验证：`npm run check`、`npm test`、`git diff --check` 通过；模拟 ET→WPP 插入、字体强调、缩进、对齐、换行和格式回读通过。
- 部署：已同步插件 runtime，并准备原子部署到 `/Users/lin/.local/share/wps-connector/runtime`；正式 runtime 备份路径以本轮部署输出为准；未推送 GitHub。
- 真实验收：需重启 WPS 并重新打开 Connector 面板加载新 build，再用真实 ET 源表和 WPP 目标表验证斜体、下划线、缩进及保存重开，当前保持 `PENDING_REAL_HOST_ACCEPTANCE`。

## 2026-08-30 WPS Writer 表格插入批量格式与实时进度

- 状态：`deployed / pending real WPS acceptance`。
- 修复：Writer 表格格式应用按格式签名分组，并将连续目标拆为矩形区域后批量设置；同一批次只读取一次合并单元格信息；无法使用区域快路径时保留逐单元格回退并返回 `fallbackCellCount`。
- 新增：`wps.insert_et_wpp_data_source` 支持 `operationId`；Bridge 提供 `GET /api/operations/:operationId` 轻量进度查询，阶段覆盖检查、读取源表、创建表格、写入内容、批量格式化、建立绑定和完成。
- 面板：插入期间轮询任务状态，显示百分比、当前阶段、已用秒数和已处理单元格数；完成保留 100% 状态，失败清理进度提示。
- 版本：WPS Add-in `clientVersion=0.2.1`，`clientBuild=2026.08.30-wps-table-sync-progress.1`；pane/runtime cache key 为 `20260830-wps-table-sync-progress-0.2.1.1`。
- 验证：`npm run check`、`npm test`、`git diff --check` 通过；模拟同步、格式批量应用、回读、保存和进度查询通过。
- 部署：已备份并原子部署到 `/Users/lin/.local/share/wps-connector/runtime`；备份 `/Users/lin/Library/Application Support/Connector Suite/backups/wps-runtime/20260830-111820/runtime`；未推送 GitHub。
- 真实验收：当前在线 WPS 文字会话可见，但本轮未向业务文档执行插入；真实大表插入耗时、WPS 视觉格式和面板进度展示保持 `PENDING_REAL_HOST_ACCEPTANCE`。

## 2026-08-30 WPS Writer 插入数字千分位兼容修复

- 状态：`deployed / pending real WPS readback`。
- 根因：历史数据源格式快照中的 `numberFormat` 为空，Writer 不具备 Excel 原生数字格式，插入时只能写入未分组的原始数字文本。
- 修复：Bridge 在格式字段为空且宿主显示值仍是普通数字时，按原始小数位数补充千分位；显式格式、日期文本、百分比和带前导零字符串保持原样。
- 验证：模拟 ET→WPP 插入读回 `108139.15` 为 `108,139.15`、`282510` 为 `282,510`；`npm run check`、`npm test`、`git diff --check` 通过。
- 部署：已原子部署到 `/Users/lin/.local/share/wps-connector/runtime`，备份位于 `/Users/lin/Library/Application Support/Connector Suite/backups/wps-runtime/20260830-105517/runtime`；未推送 GitHub。
- 真实验收：`npm run test:et` 在真实表格会话变为 `SESSION_WAITING_FOR_DOCUMENT` 后超时，未完成真实 Writer 千分位回读，状态保持 `PENDING_REAL_HOST_ACCEPTANCE`。

## 2026-08-29 WPS 文字“插入并绑定”无响应反馈修复

- 状态：`deployed / pending real source-document acceptance`。
- 现场根因：当前文字会话 `wps-wpp-1nereq5` 在线，但待插入数据源所属源表文档没有在线 ET 会话；本机仅有一个空的 ET 会话，因此服务端在插入前返回 `NO_ACTIVE_ET_SESSION`。已用真实接口复现，未改动文字文档。
- 前端修复：插入前刷新在线会话，严格按数据源 `etDocumentKey` 匹配 ET 会话，增加源表/文字会话预检；按钮现在有“检查中/发送请求/处理中”反馈，阻止宿主默认点击行为，并显示结构化错误码和下一步；插入成功后绑定状态刷新失败不再覆盖“已插入并建立绑定”的结果。
- 网关修复：统一处理 Bridge HTTP/JSON 错误；`wps.insert_et_wpp_data_source`、`wps.create_et_wpp_table_sync`、`wps.sync_et_wpp_table` 增加 `[table-sync]` 请求/完成/失败审计日志。
- 版本：WPS Add-in `clientBuild=2026.08.29-wps-table-sync-click-feedback.1`；runtime 资源缓存标识同步升级，避免 WPS WebView 继续使用旧脚本。
- 验证：`npm run check` 通过；`npm test` 通过；`git diff --check` 通过；正式 Bridge `40215`、Add-in `3891` 健康；源码、插件 runtime、正式 runtime 的 `main.js`、`runtime.html`、`pane.html` 和 `server.js` SHA-256 一致；正式现场预检返回 `NO_ACTIVE_ET_SESSION`，日志已记录 request/failed；当前无活跃命令队列。
- 部署与备份：正式 runtime `/Users/zer0y/.local/share/wps-connector/runtime`；最近一次备份 `/Users/zer0y/Library/Application Support/Connector Suite/backups/wps-runtime/20260829-222617/runtime`；已重启 `com.codex.wps-connector.bridge` 与 `com.codex.wps-connector.addin`。
- 待用户验收：打开与数据源记录相同的源 WPS 表格文档 `/Users/zer0y/Library/CloudStorage/OneDrive-个人/共享/2026-天源/20260605镇洋项目/03评估底稿/一级复核/02-底稿/收益法底稿-镇洋化工V1.1.xlsx`，重新打开其 Connector 面板；确认源表会话显示真实文档名后，在 WPS 文字同步页点击“插入并绑定”，核对表格内容、数字显示、段落对齐/换行、绑定关系和保存后回读。

- 状态：`IN_PROGRESS`
- 分支：`codex/table-format-module-debug-0.2.1`
- 基线：`ed1e44d`
- 已完成：静态检查通过；已确认共享模板核心仍为基础 v1；已确认 WPS Writer 有适配器、源码仓库没有可执行 Office Word 适配层；已读取外部 Office Word 适配器作对照。
- 进行中：共享核心、批量回退、数字格式和 WPS/Office 统一接口。
- 测试：本轮 `npm run check`、`npm test`、`git diff --check` 均通过；模拟 ET→WPP 插入/重复同步已验证数字显示、常规数字右对齐/文本左对齐、自动换行和样式回读。
- 真实验收：`PENDING_REAL_HOST_ACCEPTANCE`。不能使用绑定到其他项目的 WPS 会话，也不能创建假 session。
- 部署：已部署到 `/Users/zer0y/.local/share/wps-connector/runtime`，源码/runtime/插件副本已同步；备份位于 `/Users/zer0y/Library/Application Support/Connector Suite/backups/wps-runtime/20260829-220708/runtime`。
- 遗留：当前 WPS 在线会话仍报告旧 `clientBuild=2026.08.29-wps-table-sync-performance.1`，需要重开 WPS 文档/面板后确认新 build；Office Word 真实文档回读、WPS 真实格式回读、保存重开持久性和宿主耗时/调用数仍待验收。

## 2026-08-30 WPS Writer“插入并绑定”卡死保护

- 状态：`deployed / pending real WPS Writer acceptance`。
- 根因判断：WPS Writer 的 `Row.Range.Text` 内部单元格标记批量写入路径可能同步阻塞宿主；插入流程还会先读空表、失败恢复，并在插入后强制 `InsertParagraphAfter`/释放选区，放大宿主重排风险。之前现场请求已到达 Bridge，但 WPP 命令 60 秒超时，最终 WPS 被卡死。
- 修复：默认关闭 `Row.Range.Text` 实验路径，仅允许显式 `fastPath: "row-range-bulk"`；新表直接使用已验证的单元格 Range 写入，跳过空表预读/恢复；`insert_et_wpp_data_source` 不再要求插入后追加段落或强制释放选区；当前文档已激活时跳过 `Document.Activate()`，避免从 Writer 面板回入宿主 UI。
- 诊断：Bridge 已在插入并绑定链路记录 `read_source_start/complete`、`insert_table_start/complete`、`apply_format_start/complete`、`binding_start/complete` 阶段，后续失败可直接定位阶段。
- 验证：`npm run check`、`npm test`、`git diff --check` 通过；模拟插入和格式回读通过；Bridge `40215`、Add-in `3891` 健康，Platform `0.2.1`，shared transport available，当前无在线 WPS session。
- 部署：正式 runtime `/Users/zer0y/.local/share/wps-connector/runtime`；本轮备份 `/Users/zer0y/Library/Application Support/Connector Suite/backups/wps-runtime/20260830-021644/runtime`；已同步插件 runtime 并重启 `com.codex.wps-connector.bridge`、`com.codex.wps-connector.addin`。
- 待验收：完全退出并重新打开 WPS Writer，重新打开源表与目标文字文档的 Connector 面板，确认新 `clientBuild=2026.08.29-wps-table-sync-click-feedback.1`，在小范围数据源上点击“插入并绑定”；检查 WPS 不再卡死、表格创建、格式回读、绑定和保存。若仍失败，保留 Bridge 日志 `/Users/zer0y/.local/share/wps-connector/runtime/logs/bridge.launchd.err.log`，最后一个 `phase` 即为阻塞阶段。

## 2026-08-30 开发快照

- 目标：将当前统一连接器、表格格式模块、WPS Writer 卡死保护和插件运行时副本作为开发版快照推送到 GitHub，供 Mac mini 继续开发。
- 发布边界：仅推送当前开发分支 `codex/table-format-module-debug-0.2.1`；不修改 `main`，不创建正式 tag/release，不上传安装包。
- 发布前验证：`npm run check`、`npm test`、`git diff --check` 通过；模拟 ET/WPP 会话、表格同步、格式回读、绑定路由回归通过。
- 真实宿主状态：WPS Writer 现场验收仍为 `PENDING_REAL_HOST_ACCEPTANCE`，模拟测试与服务健康不能替代真实 WPS 文档验收。
- GitHub：已推送提交 `928f7b2` 到 `https://github.com/zer0-lyz/wps-connector/tree/codex/table-format-module-debug-0.2.1`；该分支已设置跟踪 `origin/codex/table-format-module-debug-0.2.1`。
- Mac mini 接续：克隆 `https://github.com/zer0-lyz/wps-connector.git` 后切换到 `codex/table-format-module-debug-0.2.1`，从该开发分支继续，不要直接改 `main`。

## 2026-08-30 目标分支继续维护

- 状态：`deployed / pending real WPS Writer and Spreadsheet acceptance`。
- 工作方式：保留原工作树 `/Users/lin/.local/share/wps-connector/source` 的未提交修改，在独立 worktree `/Users/lin/.local/share/wps-connector/worktrees/table-format-module-debug-0.2.1` 基于远端 `7082516` 继续。
- 修复：macOS 原子部署和插件 runtime 同步脚本现在会保留 `table-format-templates.local.json`，避免表格格式模板因升级丢失；ET 回归脚本默认 build 已与当前 Add-in `2026.08.29-wps-table-sync-click-feedback.1` 对齐。
- 验证：`npm run check`、`npm test`、`git diff --check` 通过；`npm run test:et` 在真实 WPS 仍加载旧 `clientVersion=1.1.8` 时按版本预检安全停止，状态为 `PENDING_REAL_HOST_ACCEPTANCE`，未写入用户工作簿。
- 部署：已原子部署到 `/Users/lin/.local/share/wps-connector/runtime`；本轮备份为 `/Users/lin/Library/Application Support/Connector Suite/backups/wps-runtime/20260830-092423/runtime`；绑定、目录、同步和表格模板状态均已保留。
- 真实宿主：Bridge、Add-in、Connector Platform 健康；当前可见 WPS session 仍是旧 `1.1.8` 页面。Mac 自动 GUI 操作因锁屏无法继续，Writer 插入并绑定、Spreadsheet session 新版本回读、格式回读和保存重开均保持 `PENDING_REAL_HOST_ACCEPTANCE`。
- 推送边界：只提交并推送 `codex/table-format-module-debug-0.2.1`，不修改 `main`，不上传日志、缓存、证书、用户配置或安装包。

## 2026-08-30 表格同步执行层快照修复

- 根因：数据源清单只持久化文档、Sheet、地址和格式元数据；插入前端又强制要求源 ET session 在线，导致“清单可见”但执行链路无法进入。快照只存在 Bridge 内存时，重启后也无法后备读取。
- 修复：新增本机 `et-wpp-source-cache.local.json` 快照；Bridge 启动时恢复快照，插入和已有表绑定可在源表暂时离线时复用；面板在有快照时不再错误拦截，并按文档/Sheet/地址复用数据源 ID 刷新快照。
- 边界：旧数据源若创建于本修复前且没有快照，仍需打开源 Excel 后在表格同步面板刷新一次；当前真实 WPS 无在线 session，真实插入和保存重开保持 `PENDING_REAL_HOST_ACCEPTANCE`。
- 验证：`npm run check`、`npm test`、`git diff --check` 通过；源码、插件 runtime、正式 runtime 的 Bridge 和 pane 文件 SHA-256 一致。
- 部署：正式 runtime `/Users/lin/.local/share/wps-connector/runtime`；备份 `/Users/lin/Library/Application Support/Connector Suite/backups/wps-runtime/20260830-102130/runtime`、`20260830-102323/runtime`；未推送 GitHub。
