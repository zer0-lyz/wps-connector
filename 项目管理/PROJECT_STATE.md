# 当前状态

## 2026-09-02 WPS 绑定稳定性修复部署与运行态核验

- 状态：`deployed / pending real WPS Writer acceptance`。
- 目标：修复 WPS Writer 文档重开后绑定丢失、同名文件误匹配、多源绑定状态不稳定，以及“全部同步”可能跨文档操作的问题。
- 修复：共享源文件匹配器保留稳定文档路径、文件名和版本系列信息；同名但路径不同的文件不再误匹配；仅保存旧名称的多源绑定可恢复全部关系；Writer 面板按当前文档隔离绑定、源文件选择、绑定管理和全部同步范围；跨源绑定明细及批量解绑继续使用精确 `sourceId + syncId`。
- 修改文件：`vendor/connector-shared/sourceFileMatcher.js`、`apps/bridge/server.js`、`apps/shared/toolSchemas.js`、`apps/wps-addin/pane.html`、`apps/wps-addin/main.js`、`apps/wps-addin/runtime.html`、`apps/wps-addin/server.js`、`tests/source-file-matcher.test.js`、`tests/e2e.js`、`package.json`；对应插件 runtime 副本已同步。
- 自动验证：`npm run check`、`npm test`、`git diff --check`、源文件匹配回归、多表绑定/批量解绑回归、源码与插件 runtime/正式 runtime 一致性检查均通过。
- 客户端版本：WPS `0.2.1`，build `2026.09.02-binding-stability.1`。
- 部署：正式 runtime `/Users/zer0y/.local/share/wps-connector/runtime`；部署前备份 `/Users/zer0y/Library/Application Support/Connector Suite/backups/wps-runtime/20260902-131138/runtime`；`com.codex.wps-connector.bridge` 与 `com.codex.wps-connector.addin` 均已重启并 running。
- 运行回读：Platform `/api/product` 返回 `ok:true`、`compatible:true`，Office/WPS adapter 均为 `0.2.1`、`ok:true`、`compatible:true`；健康 adapter 数量为 `2`；WPS Bridge `40215/api/health`、Add-in `3891/health` 均 HTTP 200/`ok:true`。
- 当前宿主：最终回读时在线 WPS 表格会话 5 个，均为当前 build 且可执行；WPS Writer 会话 0 个。未使用假 session，未修改用户文档、历史绑定、源表、用户配置或证书。
- 真实验收边界：Writer 重开后按当前文档恢复绑定、多源绑定“全部同步”、源表更新后一键同步，以及保存/关闭/重开后的绑定持久性尚未完成，当前保持 `PENDING_REAL_HOST_ACCEPTANCE`。
- 下一步：完全退出并重新打开 WPS Writer 和 Connector 面板，确认当前 Writer 文档键；在已有多个绑定的文档中核对绑定对象、批量解绑和全部同步，再修改源表执行一次批量同步并保存重开回读。

## 2026-09-01 WPS 表格同步显示文本空白清洗修复

- 状态：`deployed / PENDING_REAL_HOST_ACCEPTANCE`。
- 根因：WPS ET 显示值快照中的占位单元格实际为 `"                           -   "`；原逻辑只清理数值显示文本，非数值文本被原样传入 WPS Writer。
- 修复：共享 table-sync 核心新增显示文本归一化；去除首尾空白，纯空白转空字符串，空白包围的短横线统一为 `-`，保留中文正文内部空格。Bridge 的首次插入、后续同步、旧缓存和无格式快照回退均使用该规则。
- 缓存：WPS Add-in build/cache 更新为 `2026.09.01-table-sync-whitespace.1`，避免 WPS WebView 复用旧页面。
- 验证：`npm run check`、`npm test`、共享显示文本回归、插件运行时显示文本回归和 `git diff --check` 通过；Bridge `40215`、Add-in `3891` 均返回 HTTP 200。
- 部署：正式 runtime `/Users/zer0y/.local/share/wps-connector/runtime`；原子部署备份 `/Users/zer0y/Library/Application Support/Connector Suite/backups/wps-runtime/20260901-205848/runtime`；Bridge/Add-in LaunchAgent 已重启。
- 待验收：用户完全退出并重新打开 WPS 及 Connector 面板后，使用原数据源重新执行插入或同步，确认该单元格显示为 `-` 且没有前后空格；本轮未直接写入用户文档。

## 2026-09-01 表格同步显示值策略部署

- 状态：`deployed / PENDING_REAL_HOST_ACCEPTANCE`。
- 架构：WPS 表格数据源与 WPS 文字目标关系独立于 Codex 项目、任务和对话；一个数据源可绑定多个目标表格。
- 首次插入：读取源表显示值，保留日期、百分比、千分位和货币等显示结果，不复制字体、段落、边框、底纹、行高或列宽。
- 后续同步：只调用内容替换并回读值和形状，返回 `formatting.applied=false`、`targetStylesPreserved=true`；目标 Writer 样式由用户维护。
- 性能：优先整块读取 `Range.Text`；不可用时读取数字格式矩阵，小范围才逐单元格回退；保留分块读取、超限保护、进度、取消和命令泵。
- UI：数据源改为可复用清单，已绑定来源仍可再次“插入并绑定”；build/cache 为 `2026.09.01-table-sync-display-values.1`。
- 验证：`npm run check`、`npm test`、`git diff --check` 通过；E2E 覆盖显示值、一源多目标、目标样式保留、取消、读回和保存。
- 部署：正式 runtime `/Users/zer0y/.local/share/wps-connector/runtime`，Bridge/Add-in LaunchAgent 已重启；备份 `/Users/zer0y/Library/Application Support/Connector Suite/backups/wps-runtime/20260901-085507/runtime`。
- 运行态：`40215/api/health`、`3891/health` 均返回 200；当前 WPS 在线 session 为 0，真实 ET/Writer 首插、再次同步、新增行样式继承和保存重开待用户验收。

## 2026-08-31 Connector Suite 表格格式模块专项收尾核验

- 状态：`PENDING_REAL_HOST_ACCEPTANCE`。
- 分支：`codex/table-format-module-debug-0.2.1`；基线 `ed1e44d`；当前 HEAD `9df5c2b`。源码工作区仍为 dirty，保留既有及本专项未提交修改；本轮未执行 reset、`checkout --`、删除或覆盖用户成果。
- 根因：旧实现把宿主命令返回成功当作格式生效，且 WPS/Office 的读取、写入和回读逻辑分散；WPS Writer 数字格式不能直接承载 Excel `numberFormat`，Office Word 段落格式必须通过 `range.paragraphs`/`Word.Paragraph`，表格宽度和边框需要 OOXML 回写后刷新读取。
- 共享核心：`vendor/connector-shared/modules/table-format-template/` 统一负责旧模板兼容、schema、字段白名单、归一化、差异比较、应用计划、回读验证、事务回滚和性能统计；WPS/Office 仅保留宿主适配调用。
- WPS 适配：连续同格式单元格使用表格/矩形 Range 批量设置；合并单元格、控制字符、范围写入或读回失败时回退逐单元格，并记录 `fastPath`、`hostCallsSaved`、`affectedCells`、`fallbackCellCount`、`durationMs`。
- Office 适配：使用 `range.paragraphs` 读取段落格式；表格宽度统一归一化为 `auto/percent/points`，宽度与边框合并为一次 OOXML 替换，刷新后再回读；不支持或无法确认的字段不进入成功列表。
- 数字格式：WPS/Office 文字表格不直接写入 Excel 数字格式；优先保留源表显示文本，历史空格式快照对普通数字使用安全千分位兜底；Writer 数字格式字段标记为 `unsupported`，不伪报已应用。
- 源码验证：`npm run check`、指定 `node --check`、`git diff --check`、源码 `npm test`、WPS 正式 runtime `npm test`、Office 正式 runtime `npm test` 和 Office 安装插件 runtime `npm test` 均已通过；Office 安装插件先补齐缺失的生产依赖 `sql.js/ws` 后通过。以上均为模拟器/自动化验证，不等于真实宿主验收。
- 运行时：WPS 正式 runtime `/Users/zer0y/.local/share/wps-connector/runtime`；Office 正式 runtime `/Users/zer0y/.local/share/office-connector/runtime`；WPS 插件副本已同步。Office 安装插件 `/Users/zer0y/plugins/office-connector` 已备份并同步实际漂移的共享核心、Word Add-in、Bridge 和 E2E 文件。
- 备份：WPS `/Users/zer0y/Library/Application Support/Connector Suite/backups/wps-runtime/20260831-table-format-module-wps/runtime`；Office `/Users/zer0y/Library/Application Support/Connector Suite/backups/office-runtime/20260831-table-format-module-office/runtime`；Office 安装插件 `/Users/zer0y/Library/Application Support/Connector Suite/backups/office-plugin/20260831-table-format-module-office`。
- 健康检查：WPS Bridge `40215`、WPS Add-in `3891`、Platform `40315` 健康；Office HTTPS `https://127.0.0.1:40116/api/health` 返回 `protocol=https`，HTTP `40115` 仅为 fallback，未用 HTTP 降级冒充 HTTPS。产品探针显示 Connector Suite/WPS/Office 均为 `0.2.1`，shared `0.2.0`。
- 当前会话：WPS 在线 ET/WPP 会话均未绑定本任务；WPS 当前 `clientVersion=0.2.1`、`clientBuild=2026.08.30-wps-table-sync-text-format.9`。Office Word 在线 Add-in session 数为 0；不能取得可写的 Word `sessionId`、`bindingId`、`documentKey`。
- 一致性：源码、WPS 插件 runtime、WPS 正式 runtime 的共享 `templateCore.js`/`state.js` 与 WPS Add-in 关键文件一致；Office 正式 runtime 与安装插件的 `templateCore.js`、`state.js`、`taskpane.js`、`tableFormatPanel.js`、Bridge、E2E 文件一致。
- ERROR：无静态检查或模拟测试失败；未执行真实文档写入，因此没有真实宿主写入错误可报告。
- WARNING：Office 日志出现项目目录预热超过 10000ms及 Codex shared transport unavailable 警告，但 HTTPS 健康和 Connector Platform 当前探针通过；Office 交接目录中的旧源码快照未用来覆盖当前正式 runtime。
- PENDING：真实 WPS 抓取/保存/应用/多表回读、真实 Office Word 抓取/应用/回读、保存重开持久性、真实数字显示、真实宿主耗时和调用次数，均待匹配的测试文档与绑定可用后验收；不得创建假 session。
- 回滚：停止对应 LaunchAgent 后，将正式 runtime 备份中的 `runtime` 恢复到原路径并重新 kickstart；Office 安装插件可从其备份目录恢复。未提交 GitHub，未生成安装包。

## 2026-08-31 WPS Writer 插入卡住时停止入口与缓存刷新

- 状态：`deployed / pending real WPS Writer acceptance`。
- 现场根因：截图中的 WPS Writer 页面仍加载 `clientBuild=2026.08.30-wps-table-sync-text-format.8`；进度条的长状态文字占据固定宽度，导致停止按钮在窄面板中被挤出可视区域。正式运行时当时已更新，但已打开的 WPS WebView 尚未重载。
- 修复：进度条改为独占一行，状态文字允许收缩/换行，停止按钮固定显示在下一行右侧；取消请求失败时恢复按钮可重试。客户端 build、页面缓存键更新为 `2026.08.30-wps-table-sync-text-format.9`。
- 取消边界：排队中的 WPS 命令可以立即取消；已经送入 WPS 的 COM 调用只能在宿主调用返回后阻止后续格式化、绑定和保存，面板会提示可能已创建部分表格且未建立绑定，不能安全强杀正在执行的宿主调用。
- 验证：`npm run check`、`npm test`、`git diff --check` 通过；模拟插入、格式回读、取消和“不建立绑定”回归通过。
- 部署：源码、插件 runtime、正式 runtime 已一致；正式 runtime `/Users/zer0y/.local/share/wps-connector/runtime`；本轮备份 `/Users/zer0y/Library/Application Support/Connector Suite/backups/wps-runtime/20260831-001634/runtime`；Bridge `40215`、Add-in `3891` 和 Platform `40315` 健康，两个 LaunchAgent running。
- 当前边界：在线 WPS Writer/Spreadsheet 会话仍报告旧 `.8`，尚未完成真实宿主重载和业务文档验收；未再次对当前文档执行插入。
- 待用户动作：若当前 WPS 仍卡住，先完全退出 WPS 后重新打开；重新打开 Connector 面板确认 build 为 `.9`，再用小范围测试数据点击“插入并绑定”。卡住时应在进度区点击“停止插入”，不要重复点击“插入中…”。

## 2026-08-30 ET 选区数量误判修复

- 状态：`deployed / pending real WPS reload and acceptance`。
- 根因：WPS Add-in 的通用 `wpsConnectorRangeShape()` 只返回 `rowCount`/`columnCount`，未返回 `cellCount`；安全检查读取该字段时得到 `undefined`，将正常的 `Sheet1!B12:H21`（70 个单元格）误报为超限。
- 修复：范围形状补充数字型 `cellCount`；“加入清单”前端在旧页面缺少该字段时按行数×列数兜底；Add-in/cache build 更新为 `2026.08.30-wps-table-sync-text-format.8`。
- 验证：`npm run check`、`npm test`、`git diff --check` 通过；源码、插件 runtime、正式 runtime 均已同步；正式 Bridge `40215` 和 Add-in `3891` 健康。
- 部署：正式 runtime `/Users/zer0y/.local/share/wps-connector/runtime`；备份 `/Users/zer0y/Library/Application Support/Connector Suite/backups/wps-runtime/20260830-234353/runtime`。
- 现场状态：当前已在线 WPS 页面仍报告旧 `.7`，需关闭并重新打开 WPS 表格/Connector 面板后，再用 `B12:H21` 点击“加入清单”验证；在此之前保持 `PENDING_REAL_HOST_ACCEPTANCE`。

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

## 2026-09-01 WPS Writer 数据源识别与文档绑定隔离

- 状态：`deployed / pending WPS WebView reload and real Writer acceptance`。
- 修复：共享 `sourceFileMatcher` 新增版本系列源文件分组；同一系列的 V2.0/V1.1 记录合并展示全部 4 条数据源，并保留真实 sourceId、工作簿键和精确源表跳转能力。
- 修复：WPS Writer 面板严格按当前 Writer `documentKey` 过滤绑定；锚点会话不存在、当前文档键缺失或绑定缺少目标文档键时均返回空列表，不回退到其他在线 WPP 会话。
- 验证：源文件匹配器回归、Platform `npm test`、`npm run check`、面板脚本解析、插件 runtime 测试和 `git diff --check` 通过；真实只读回读确认 4 条源记录合并为 1 个源文件组，当前 Writer 绑定数为 0。
- 部署：正式 runtime `/Users/zer0y/.local/share/wps-connector/runtime`；备份 `/Users/zer0y/Library/Application Support/Connector Suite/backups/wps-runtime/20260901-214349/runtime`；Bridge/Add-in running；未提交、未上传 GitHub、未生成安装包。
- 待用户验收：重开 WPS Writer/Connector 面板后确认 build `2026.09.01-table-sync-source-scope.1`，V2.0 文件显示 4 条源，新 Writer 不显示旧绑定，原文档只显示自身绑定。

## 2026-09-03 共享表格格式清单读取兼容与部署

- 统一修复：共享 `vendor/connector-shared/modules/table-format-template/tableFormatPanel.js` 现在兼容直接返回、单层/嵌套 `result`、`data` 的表格清单响应；读取时显示进行状态，完成后明确显示已加载数量和宿主耗时，避免成功结果被错误渲染为空清单。
- 对应 Office Word 的真实只读诊断已返回两张实际表格，证明该修复针对面板层；WPS 复用相同共享文件，无复制业务逻辑。
- build：`2026.09.03-table-format-list-readback.1`；已更新 WPS runtime/pane 缓存标识。
- 验证：`npm run check`、表格格式核心、源文件匹配、数字显示格式测试均通过；全量 `npm test` 进入模拟同步 e2e 阶段，但当前执行环境未可靠返回最终退出码，不能称全量 e2e 已通过。
- 部署：已原子替换 `/Users/zer0y/.local/share/wps-connector/runtime`，同步插件 runtime、保留绑定/模板/同步配置，重启 WPS Bridge/Add-in；备份 `/Users/zer0y/Library/Application Support/Connector Suite/backups/wps-runtime/20260903-table-format-list-readback-wps/runtime`。
- 待验收：当前无在线 WPS session；重开 WPS Connector 面板注册后，确认 session build 并在真实文档检查表格清单。状态 `PENDING_REAL_HOST_ACCEPTANCE`。

## 2026-09-03 表格设置支线已推送 GitHub

- 已提交并推送独立 WPS 支线 `codex/table-format-module-debug-0.2.1`，提交 `1da63b2`（`fix: stabilize table format list loading`）。
- 推送前 `npm run check`、`npm test`、表格格式/源文件匹配/显示文本专项回归和 `git diff --check` 均通过；远端未发现同名支线分叉。
- 清理提交阻塞时仅将无进程占用、创建于 2026-09-01 的 0 字节 Git 锁移动至 `/var/tmp/wps-index-lock-backup.xn0KWz/index.lock` 备份，未删除成果。
- 未创建 PR、未合并主线、未创建 tag/release、未生成安装包；真实 Word/WPS 宿主验收仍为 `PENDING_REAL_HOST_ACCEPTANCE`。
