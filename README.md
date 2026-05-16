# Doc2X Subscription MCP

面向 Doc2X 网页订阅版的 MCP Server，当前重点是把“认证 -> PDF 解析 -> Markdown 获取 -> 已验证导出”这条主链路稳定封装出来。

详细能力边界、工作流、验证记录请看 [docs/PROJECT_REFERENCE.md](/home/oliviero/AgenticProjects/textbook/doc2x/docs/PROJECT_REFERENCE.md)。

## 如何使用

安装与构建：

```bash
npm install
npm run check
npm run build
```

本地启动 MCP Server：

```bash
npm run dev
```

构建后启动：

```bash
npm run start
```

离线验证：

```bash
npm run verify:mcp
```

在线验证：

```bash
npm run verify:mcp -- --online --pdf /abs/path/to/file.pdf
```

推荐使用顺序：

1. 调用 `doc2x_auth_browser` 建立或复用登录态
2. 调用 `doc2x_parse_pdf` 解析本地 PDF
3. 调用 `doc2x_get_parse_markdown` 获取 Markdown
4. 如需导出，再调用 `doc2x_export_parse_result`

会话默认保存在 `.doc2x/session.json`。

## 主要工具

核心用户工具：

- `doc2x_auth_browser`
- `doc2x_parse_pdf`
- `doc2x_get_parse_status`
- `doc2x_get_parse_markdown`
- `doc2x_export_parse_result`

会话与账号工具：

- `doc2x_session_get`
- `doc2x_session_set`
- `doc2x_import_browser_session`
- `doc2x_session_clear`
- `doc2x_login_password`
- `doc2x_login_code`
- `doc2x_send_sms_code`
- `doc2x_get_account_bundle`

原语与调试工具：

- `doc2x_surface_catalog`
- `doc2x_create_task`
- `doc2x_space_operation`
- `doc2x_pay_operation`
- `doc2x_user_gateway_operation`
- `doc2x_util_operation`
- `doc2x_request`
- `doc2x_browser_fallback_plan`

## Skill

仓库内置用户 skill：

- [skills/doc2x-mcp-user/SKILL.md](/home/oliviero/AgenticProjects/textbook/doc2x/skills/doc2x-mcp-user/SKILL.md)
  - 用于按当前已验证边界操作 Doc2X MCP
  - 覆盖认证、解析、Markdown 获取、导出

维护与验证细节请参考：

- [docs/PROJECT_REFERENCE.md](/home/oliviero/AgenticProjects/textbook/doc2x/docs/PROJECT_REFERENCE.md)
- [docs/experiment/EXPERIMENT_REPORT.md](/home/oliviero/AgenticProjects/textbook/doc2x/docs/experiment/EXPERIMENT_REPORT.md)
- [docs/analysis/doc2x-parse-browser-analysis-2026-05-11.md](/home/oliviero/AgenticProjects/textbook/doc2x/docs/analysis/doc2x-parse-browser-analysis-2026-05-11.md)
