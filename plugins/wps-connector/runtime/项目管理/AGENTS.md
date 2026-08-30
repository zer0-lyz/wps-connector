# 表格格式模块专项调试规则

- 本分支只处理 Connector Suite 0.2.1 的 WPS Writer / Microsoft Word 表格格式模块。
- 保留进入分支前的所有未提交修改；不得 reset、checkout --、删除或覆盖未知成果。
- 共享模板 schema、归一化、比较、应用计划、回读状态和性能统计放在 `vendor/connector-shared/modules/table-format-template/`；宿主差异只放在 WPS/Office 适配器。
- 命令成功不等于格式生效。必须写入后回读；不能确认的字段分别标为 `unsupported` 或 `attemptedButUnverified`，并记录 `warning`。
- 真实 WPS/Office 文档未绑定本专项测试文档前，不得写入；报告状态使用 `PENDING_REAL_HOST_ACCEPTANCE`。
- runtime 部署先备份并原子替换；不得上传 GitHub 或生成安装包。
