# Doc2X Subscription MCP Reference

这份文档承接原根目录 `README.md` 的详细内容，面向需要了解能力边界、工作流、验证状态和维护背景的读者。

更简短的项目入口请看根目录 [README.md](/home/oliviero/AgenticProjects/textbook/doc2x/README.md)。

## 项目定位

这是一个面向 Doc2X 网页订阅版的 MCP Server，目标是通过与网页一致的接口链路，把认证、PDF 解析、Markdown 提取和已验证导出能力封装为可调用工具。

当前实现是 HTTP-first：

- 运行时主链路优先走 HTTP
- 支持一步式受管浏览器认证 `doc2x_auth_browser`
- 支持从 Chrome DevTools 会话导入登录态
- 会话默认持久化到 `.doc2x/session.json`
- 对未正式封装的能力保留原语/调试工具

## MCP 配置方式

这个项目通过 `stdio` 暴露 MCP 服务，入口文件是：

- `dist/index.js`

也就是说，MCP Client 需要把它作为一个子进程启动，并通过标准输入输出与它通信。

推荐配置：

```json
{
  "mcpServers": {
    "doc2x": {
      "command": "node",
      "args": [
        "/abs/path/to/doc2x/dist/index.js"
      ],
      "cwd": "/abs/path/to/doc2x"
    }
  }
}
```

开发态配置：

```json
{
  "mcpServers": {
    "doc2x": {
      "command": "npm",
      "args": [
        "run",
        "dev"
      ],
      "cwd": "/abs/path/to/doc2x"
    }
  }
}
```

### 为什么 `cwd` 很重要

当前本项目的会话文件默认路径不是用户目录固定值，而是基于进程工作目录：

- `<cwd>/.doc2x/session.json`

因此如果：

- 你改了 `cwd`
- 或不同客户端使用了不同的 `cwd`

那么它们看到的本地会话文件也会不同。

### 认证相关目录

除了会话文件外，一步式浏览器认证还有一套默认受管浏览器目录，位于用户目录下：

- `~/.doc2x-mcp/managed-browser-profile`

这一路径与 `cwd` 无关，主要供 `doc2x_auth_browser` 复用浏览器登录态。

### 推荐初始化顺序

完成 MCP 配置并启动后，推荐按下面顺序使用：

1. `doc2x_auth_browser`
2. `doc2x_parse_pdf`
3. `doc2x_get_parse_markdown`
4. `doc2x_export_parse_result`

## 当前覆盖范围

当前已经覆盖：

- 单文件本地 PDF 解析全链路
  - `CreateUploadTask`
  - 上传到返回的对象存储地址
  - `CreateParseTask`
  - `GetTaskStatus`
  - `GetObjectParse`
  - `GetObjectParseList`
  - `GetObjectParseResult`
  - `GetSpaceObject`
- 一步式受管浏览器认证
- 通过 `taskId` 或 `objectId` 恢复解析状态
- 通过 `taskId` 或 `objectId` 获取 Markdown 结果，并可落盘为 `.md`
- 浏览器同款导出链路
  - `CreateConvertParseTask`
  - `GetConvertTaskStatus`
  - 下载最终导出产物
- 会话导入、写入、清空
- 登录、短信登录、短信验证码请求
- 账号套餐/额度查询
- 网关原语调用、SpaceService/Pay/User/Util 调用、原始 HTTP 请求

## 工具目录

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

调试与原语工具：

- `doc2x_surface_catalog`
- `doc2x_create_task`
- `doc2x_space_operation`
- `doc2x_pay_operation`
- `doc2x_user_gateway_operation`
- `doc2x_util_operation`
- `doc2x_request`
- `doc2x_browser_fallback_plan`

## 会话策略

推荐认证路径：

1. 调用 `doc2x_auth_browser`
2. 工具优先尝试静默复用受管浏览器 profile
3. 如果没有有效登录态，则自动拉起可见 Chrome/Chromium 供手动登录
4. 工具自动导入 `cookie + bearer token + refresh token + default headers`
5. 通过真实 Doc2X 账户接口探活成功后再持久化到 `.doc2x/session.json`

已验证的关键行为：

- 可以复用带 DevTools 的已登录受管浏览器
- 成功认证后会以 `clearExisting = true` 重写本地会话
- 超时不会作为协议错误，而会返回结构化 `timedOut = true`
- 如果显式传入 `debugPort`，会优先探测这个端口

高级/维护路径：

1. 已有独立登录浏览器时，可调用 `doc2x_import_browser_session`
2. 无法走浏览器导入时，可手动调用 `doc2x_session_set`

## 解析工作流

`doc2x_parse_pdf` 当前刻意只收敛到第一条稳定主链路：

- 单个本地 PDF
- 默认网页解析配置
- 返回结构化任务/对象/结果元数据
- 保留 `raw` 快照用于调试

当前实际请求顺序：

1. `GET /v2/user/profile`
2. `POST /gateway.v1.TaskService/CreateUploadTask`
3. 上传文件到返回的对象存储地址
4. `POST /gateway.v1.TaskService/CreateParseTask`
5. 轮询 `POST /gateway.v1.TaskService/GetTaskStatus`
6. 成功后补查：
   - `GetObjectParse`
   - `GetObjectParseList`
   - `GetObjectParseResult`
   - `GetSpaceObject`

`doc2x_get_parse_status` 用于超时后的恢复查询。  
`doc2x_get_parse_markdown` 用于获取合并后的 Markdown、分页 Markdown 以及可选本地落盘。

### 当前正式支持的 `parseVersion`

- `3`
  - 浏览器实际请求：`{"source_id":"...","parse_version":3}`
- `0`
  - 浏览器实际请求只发送：`{"source_id":"..."}`
  - 结果元数据中的 `parse_param.parse_version = 0`

除 `0 | 3` 外，其余 parse 弹窗参数目前都不算正式 MCP 输入。

## 导出工作流

`doc2x_export_parse_result` 是已按真实网页导出链路封装的导出工具。

当前支持：

- 接收 `taskId` 或 `objectId`
- 内部解析 `parseId`
- 执行：
  - `CreateConvertParseTask`
  - `GetConvertTaskStatus`
  - 下载 convert URL
- 将导出产物写入本地绝对路径

### 当前正式支持的导出格式

- `markdown`
  - `convert_to = 1`
  - 下载产物是 zip
  - 当前 `outputPath` 需要以 `.zip` 结尾
  - 已验证高级参数：
    - `formulaMode = "normal" | "dollar"`
    - `mergeCrossPageForms = true | false`
- `latex`
  - `convert_to = 2`
  - 下载产物是 zip
  - 当前 `outputPath` 需要以 `.zip` 结尾
  - 已验证高级参数：
    - `mergeCrossPageForms = true | false`
- `word`
  - `convert_to = 3`
  - 下载产物是 `.docx`
  - 当前 `outputPath` 需要以 `.docx` 结尾
  - 已验证高级参数：
    - `mergeCrossPageForms = true | false`

当前仍未正式纳入 MCP schema 的网页可见项包括：

- `html`
- `pdf(html)`
- 非默认 `formula_level`
- `在线图床` 相关分支
- Word 专属的公式退化级别变体

## 当前已知限制

- 验证码或强交互流程可能仍需浏览器介入
- 当前不覆盖文档翻译、图片解析、PPT/画板、在线转存和批量任务
- 仅对“已抓包确认并完成端到端验证”的参数/格式做正式暴露

## 开发与验证

常用命令：

```bash
npm install
npm run check
npm run build
npm run dev
npm run start
npm run verify:mcp
```

在线验证：

```bash
npm run verify:mcp -- --online --pdf /abs/path/to/file.pdf
```

如果受管浏览器 profile 不在默认位置：

```bash
npm run verify:mcp -- --online --pdf /abs/path/to/file.pdf --browser-profile /abs/path/to/profile
```

## 延伸文档

- 详细实验记录：[docs/experiment/EXPERIMENT_REPORT.md](/home/oliviero/AgenticProjects/textbook/doc2x/docs/experiment/EXPERIMENT_REPORT.md)
- 浏览器抓包分析：[docs/analysis/doc2x-parse-browser-analysis-2026-05-11.md](/home/oliviero/AgenticProjects/textbook/doc2x/docs/analysis/doc2x-parse-browser-analysis-2026-05-11.md)
- 用户 skill：[skills/doc2x-mcp-user/SKILL.md](/home/oliviero/AgenticProjects/textbook/doc2x/skills/doc2x-mcp-user/SKILL.md)
