# 实验报告：Doc2X Subscription MCP 第一阶段实现与验证

## 1. 实验背景

本实验围绕 `Doc2X Subscription MCP` 展开，目标是验证是否能够在保持运行时纯 HTTP 的前提下，将 Doc2X 网页订阅端的核心 PDF 解析能力封装为可调用的 MCP 工具，并为后续扩展翻译、图片解析和工具链能力建立稳定基础。

实验时间：2026-05-11  
实验地点：`/home/oliviero/AgenticProjects/textbook/doc2x`

## 2. 实验目标

本阶段目标如下：

- 实现基于网页登录会话导入的 MCP 调用能力
- 实现一步式受管浏览器认证能力 `doc2x_auth_browser`
- 打通单文件本地 PDF 的完整解析链路
- 在 MCP 中暴露高层工具 `doc2x_parse_pdf` 与 `doc2x_get_parse_status`
- 在解析完成后补齐 Markdown 结果消费能力 `doc2x_get_parse_markdown`
- 基于真实网页抓包补齐已验证的 `parseVersion` 参数
- 新增网页同款导出工具 `doc2x_export_parse_result`
- 通过真实订阅账号和测试 PDF 完成一次端到端验证
- 编写可重复执行的 MCP 验证脚本

明确不纳入本阶段范围的能力包括：

- 文档翻译
- 图片解析
- PPT / 画板
- 在线转存
- 批量处理

## 3. 实验环境

### 3.1 软件环境

- Node.js `v22.22.2`
- TypeScript
- `@modelcontextprotocol/sdk`
- 操作系统环境：Linux

### 3.2 账号与会话环境

- 使用真实 Doc2X 网页订阅账号
- 会话来源为已登录浏览器实例导入
- 本地会话持久化文件：`.doc2x/session.json`

### 3.3 测试输入

- 测试 PDF：`/tmp/doc2x-test.pdf`
- 文档特征：单页、无敏感内容、用于验证上传与解析闭环
- 多页测试 PDF：`/tmp/doc2x-multipage-test.pdf`
- 文档特征：3 页、本地生成、用于验证分页标记、`pages[]` 返回与多页落盘一致性

## 4. 实验设计

### 4.1 总体策略

实验采用“逆向分析 + 真实联调”的方式推进：

1. 分析网页前端 bundle 和已登录浏览器流量
2. 确认网页订阅端实际调用的核心接口
3. 在 MCP 中实现纯 HTTP 工作流
4. 用真实会话和真实 PDF 进行闭环验证
5. 编写自动化验证脚本，沉淀为可复用验收手段

### 4.2 MCP 工具设计

本阶段交付三个核心工具：

- `doc2x_auth_browser({ timeoutMs?, executablePath?, profileDir?, debugPort?, notes? })`
  - 优先静默复用受管浏览器 profile
  - 必要时自动打开可见 Chrome/Chromium
  - 自动导入并探活浏览器会话
  - 成功后重写 `.doc2x/session.json`

- `doc2x_parse_pdf(filePath, timeoutMs?)`
  - 执行上传、建任务、轮询、结果补查
  - 默认阻塞到终态或超时
- `doc2x_get_parse_status({ taskId?, objectId? })`
  - 查询任务快照
  - 在任务完成时补齐对象与解析结果元数据
- `doc2x_get_parse_markdown({ taskId?, objectId?, outputPath? })`
  - 提取合并后的 Markdown 正文
  - 返回页级 `pages` 明细
  - 可选写出本地 `.md` 文件
- `doc2x_export_parse_result({ taskId?, objectId?, exportFormat?, outputPath })`
  - 执行真实网页导出链路
  - 轮询 convert 任务
  - 下载最终导出产物到本地文件

当前正式支持的新增参数/格式严格受浏览器证据约束：

- `doc2x_parse_pdf.parseVersion`
  - 当前接受已抓包确认的 `0 | 3`
- `doc2x_export_parse_result.exportFormat`
  - 当前仅接受已抓包确认的 `markdown / latex / word`
  - `markdown` 与 `latex` 当前下载到本地的是 zip 包
  - `word` 当前下载到本地的是 `.docx`

同时保留调试逃生舱：

- `doc2x_request`
- 网关原语工具

## 5. 实验实现

### 5.1 请求与会话层增强

为支撑真实网页订阅流量，实验对客户端请求层进行了如下增强：

- 为 `v2c` 请求补充默认头：
  - `x-doc2x-api-version: 2025-06-04`
  - `x-doc2x-error-format: v2`
- 支持按请求控制：
  - 是否带 bearer token
  - 是否带 cookie
  - 自定义 `Origin`
  - 自定义 `Referer`
- 增加一次自动 `refreshToken` 刷新能力，并在刷新后写回 `.doc2x/session.json`

### 5.2 PDF 解析工作流实现

实际工作流如下：

1. `GET /v2/user/profile`
2. `POST /gateway.v1.TaskService/CreateUploadTask`
3. 向返回的对象存储地址执行 multipart 上传
4. `POST /gateway.v1.TaskService/CreateParseTask`
5. `POST /gateway.v1.TaskService/GetTaskStatus` 轮询任务状态
6. 在成功后调用：
   - `GetObjectParse`
   - `GetObjectParseList`
   - `GetObjectParseResult`
   - `GetSpaceObject`

### 5.3 一步式受管浏览器认证实现

新增高层认证工具：

- `doc2x_auth_browser`

其内部工作流为：

1. 解析受管 profile 路径
2. 优先检查显式 `debugPort`
3. 再检查受管 profile 的活动浏览器状态文件
4. 如果有可用 DevTools 端点，直接导入浏览器会话并执行真实 API 探活
5. 如果没有可用端点，先尝试 headless 静默复用该 profile
6. 如果静默复用仍无法得到有效登录态，则启动可见 Chrome/Chromium
7. 在等待窗口内循环：
   - `importBrowserSession`
   - `getAccountBundle` 探活
8. 成功后用 `clearExisting = true` 写回 `.doc2x/session.json`

该实现同时补了两个运行层细节：

- 显式 `debugPort` 优先于受管状态文件
- 在确认没有活动受管浏览器时，清理陈旧 Chrome `Singleton*` 锁文件

### 5.4 MCP 验证脚本实现

新增验证脚本：

- `scripts/verify-mcp.mjs`

脚本分为两种模式：

- 离线模式
  - 验证 MCP server 构建产物是否可被客户端加载
  - 验证 `tools/list` 和若干安全工具调用
- 在线模式
  - 验证会话型接口
  - 验证 `doc2x_parse_pdf`
  - 验证 `doc2x_get_parse_status`
  - 验证 `doc2x_get_parse_markdown`
  - 验证 `doc2x_export_parse_result`
  - 验证落盘文件与返回 Markdown 全文完全一致

脚本入口：

- `npm run verify:mcp`
- `npm run verify:mcp -- --online --pdf /abs/path/to/file.pdf`

## 6. 实验过程中的关键发现

### 6.1 浏览器上传控件不适合作为最终运行时方案

在真实页面中，`开始解析文件` 入口本质上是 `label + hidden input[type=file]` 模式。即使通过自动化手段向隐藏 input 注入文件并触发事件，也不一定能稳定复现网页前端的内部状态流。因此浏览器更适合作为分析工具，而非第一阶段运行时依赖。

### 6.2 网关返回体使用 snake_case

真实联调确认，当前 Doc2X 网关返回体主要采用 snake_case，例如：

- `output_id`
- `form_data`
- `object_parse_list`
- `object_id`

这意味着 MCP 实现不能只按 camelCase 推断响应结构，必须兼容当前实际格式。

### 6.3 `CreateParseTask` 存在短暂传播延迟

上传成功后，第一次调用 `CreateParseTask` 可能会返回：

- `404`
- `code: "not_found"`
- `msg: "未找到"`

但在短暂等待后重试即可成功。这说明对象上传成功到后台可见之间存在短暂传播窗口，因此 MCP 实现中加入了自动重试机制。

### 6.4 子进程 stdio 自检受当前环境限制

实验中发现，在当前执行环境下，直接通过子进程 stdio 启动本 MCP 进行自检时，子进程 stdin 会被立即关闭，导致连接验证不稳定。这属于当前环境约束，而非 MCP 协议实现本身的问题。

为此，验证脚本最终改为：

- 加载编译后的 `dist/server.js`
- 使用 MCP SDK 的 `InMemoryTransport`
- 进行真实 client/server 协议级握手与工具调用验证

该方案仍然验证了 MCP 协议层行为，同时规避了当前环境的 stdio 管道限制。

### 6.5 解析结果消费层应与任务执行层解耦

在第一阶段闭环跑通后可以确认，`doc2x_parse_pdf` 已经能拿到 `GetObjectParseResult`，但对调用方来说仍偏向“元数据/原始 JSON”。因此第二阶段的小范围扩展不应继续把结果消费塞回 `parse` 工具，而应单独暴露 `doc2x_get_parse_markdown`，让历史任务和新鲜任务都能复用同一套结果提取逻辑。

## 7. 实验结果

### 7.1 编译与启动验证

以下命令执行成功：

```bash
npm run check
npm run build
timeout 2s node dist/index.js
```

### 7.2 MCP 离线验证

以下命令执行成功：

```bash
npm run verify:mcp
```

本次离线验证的实际控制台输出摘录如下：

```text
[verify-mcp] Connecting in-memory MCP client and server
[verify-mcp] Listing tools
[verify-mcp] Found 21 tools
[verify-mcp] Calling doc2x_surface_catalog
[verify-mcp] Calling doc2x_browser_fallback_plan
[verify-mcp] Calling doc2x_session_get
[verify-mcp] Calling doc2x_auth_browser
[verify-mcp] Online checks skipped. Pass --online to verify session-backed APIs.
[verify-mcp] Verification passed
```

验证结果包括：

- MCP client/server 握手成功
- 工具列表可用
- `doc2x_surface_catalog` 可用
- `doc2x_browser_fallback_plan` 可用
- `doc2x_session_get` 可用
- `doc2x_auth_browser` 已注册
- `doc2x_get_parse_markdown` 已进入工具列表

### 7.3 MCP 在线验证

以下命令执行成功：

```bash
npm run verify:mcp -- --online --pdf /tmp/doc2x-test.pdf
```

本次在线验证的实际控制台输出摘录如下：

```text
[verify-mcp] Connecting in-memory MCP client and server
[verify-mcp] Listing tools
[verify-mcp] Found 19 tools
[verify-mcp] Calling doc2x_surface_catalog
[verify-mcp] Calling doc2x_browser_fallback_plan
[verify-mcp] Calling doc2x_session_get
[verify-mcp] Calling doc2x_auth_browser
[verify-mcp] Running online checks
[verify-mcp] Calling doc2x_auth_browser
[verify-mcp] Calling doc2x_request
[verify-mcp] Calling doc2x_get_account_bundle
[verify-mcp] Calling doc2x_parse_pdf
[verify-mcp] Calling doc2x_get_parse_status
[verify-mcp] Calling doc2x_get_parse_markdown
[verify-mcp] Calling doc2x_export_parse_result
[verify-mcp] Verification passed
```

在线验证中，`doc2x_auth_browser` 真实走通了“静默复用受管 profile”路径：

- 输入：
  - `profileDir = /tmp/doc2x-monitorable-profile`
  - `debugPort = 9222`
- 返回：
  - `ok = true`
  - `authenticated = true`
  - `openedBrowser = false`
  - `reusedManagedProfile = true`
  - `timedOut = false`

本次认证成功后，返回体中的 `persistedSession` 确认：

- `hasBearerToken = true`
- `hasRefreshToken = true`
- `cookieCount = 4`
- `cookieDomains = [".noedgeai.com"]`

同时，额外人工联调还验证了一次“无登录态超时”路径：

- 输入：
  - `profileDir = /tmp/doc2x-auth-timeout-profile`
  - `timeoutMs = 5000`
- 返回：
  - `ok = false`
  - `authenticated = false`
  - `openedBrowser = true`
  - `reusedManagedProfile = false`
  - `timedOut = true`

这说明新工具不仅能成功复用已登录浏览器，也能在 fresh profile 下进入“打开可见浏览器等待用户登录”的恢复路径。

这轮在线验证不是“只调用到成功为止”，而是脚本内显式做了以下断言：

1. `doc2x_parse_pdf`
   - `ok === true`
   - `status === "success"`
   - `taskId` 为非空字符串
2. `doc2x_get_parse_status`
   - `ok === true`
   - `status === "success"`
3. `doc2x_get_parse_markdown`
   - `ok === true`
   - `status === "success"`
   - `markdown` 为非空字符串
   - `pages` 为非空数组
   - `wroteFile === true`
   - `outputPath === "/tmp/doc2x-verify-output.md"`
4. 落盘一致性检查
   - 读取 `/tmp/doc2x-verify-output.md`
   - 断言文件全文与 `markdownResult.markdown` 完全一致
5. `doc2x_export_parse_result`
   - `ok === true`
   - `status === "success"`
   - `exportFormat === "markdown"`
   - `downloadUrl` 为非空字符串
   - `wroteFile === true`
   - `outputPath === "/tmp/doc2x-verify-export.zip"`
   - 导出文件非空，且文件头为 `PK`
   - `byteLength` 与真实落盘文件大小一致

也就是说，本次验证已经覆盖了“新鲜任务链路 -> Markdown 消费 -> 本地 `.md` 导出 -> 文件内容一致性”这一整条新增能力，而不是只验证工具名称存在。

需要说明的是，现有自动化脚本在多页场景下仍主要断言“返回非空 Markdown、非空 `pages`、落盘一致”，并不会直接断言 `pageCount === 3`。因此，针对多页行为，本报告下面额外补充了一轮专门的证据采集。

验证结果包括：

- `doc2x_request` 成功访问在线接口
- `doc2x_get_account_bundle` 成功获取账号信息
- `doc2x_parse_pdf` 成功完成 PDF 上传、建任务、轮询和结果补查
- `doc2x_get_parse_status` 成功返回完成态与解析元数据
- `doc2x_get_parse_markdown` 成功返回 Markdown 正文、页级明细，并成功落盘到本地 `.md` 文件
- `doc2x_export_parse_result` 成功执行网页同款导出链路，并成功落盘已验证格式产物

### 7.4 浏览器证据驱动的新增能力

本轮实现不是继续“推断网页行为”，而是直接基于 `docs/analysis/doc2x-parse-browser-analysis-2026-05-11.md` 中的真实浏览器证据落地：

- `CreateParseTask` 的真实请求已确认包含：
  - `source_id`
  - `parse_version = 3`
- 进一步的真实网页切换又确认：
  - 选择 `doc2x-v2-2410` 后，`CreateParseTask` 会省略 `parse_version`
  - 但后续 `GetObjectParseList.parse_param.parse_version = 0`
- `parse_model = 3` 当前只在结果元数据中出现，因此没有进入正式 MCP schema
- 默认网页导出已确认走：
  - `CreateConvertParseTask`
  - `GetConvertTaskStatus`
  - `GET convert URL`
- 默认网页导出请求已确认包含：
  - `parse_id`
  - `formula_mode = "normal"`
  - `convert_to = 1`
  - `filename`
  - `merge_cross_page_forms = false`
  - `formula_level = 0`
- 默认网页导出下载产物 MIME 已确认是：
  - `application/zip`
- 补充浏览器抓包又进一步确认了两种格式：
  - `LateX -> convert_to = 2 -> application/zip`
  - `Word -> convert_to = 3 -> application/vnd.openxmlformats-officedocument.wordprocessingml.document`
- 同时也确认了解析弹窗中的：
  - `页码范围`
  - `下次解析不再显示`
  当前仍只具备“UI 可见”证据，尚未确认它们进入真实请求 payload

因此，这轮实现新增的正式接口边界被收束为：

- `doc2x_parse_pdf`：正式开放 `parseVersion = 0 | 3`
- `doc2x_export_parse_result`：正式开放 `exportFormat = "markdown" | "latex" | "word"`
  - `markdown` 输出为本地 zip 文件
  - `latex` 输出为本地 zip 文件
  - `word` 输出为本地 `.docx` 文件

其它解析弹窗项和其它导出格式仍然保留在“网页可见但未正式进入 MCP”的状态，等待后续逐项抓包验证。

### 7.4.1 补充浏览器格式映射证据

在后续补充抓包中，又额外验证了两种真实网页导出格式：

- `LateX`
  - `CreateConvertParseTask` 请求体：
    - `{"parse_id":"...","formula_mode":"normal","convert_to":2,"filename":"doc2x-test","merge_cross_page_forms":false,"formula_level":0}`
  - 最终下载响应 MIME：
    - `application/zip`
- `Word`
  - `CreateConvertParseTask` 请求体：
    - `{"parse_id":"...","formula_mode":"normal","convert_to":3,"filename":"doc2x-test","merge_cross_page_forms":false,"formula_level":0}`
  - 最终下载响应 MIME：
    - `application/vnd.openxmlformats-officedocument.wordprocessingml.document`

同时，针对解析弹窗也补做了一次输入面验证。当前已确认网页 UI 中确实存在：

- 文件名输入显示
- 页码范围输入框
- `下次解析不再显示` 复选框

但在当前抓到的真实请求中，仍然只明确看到：

- `CreateUploadTask.filename`
- `CreateParseTask.source_id`
- `CreateParseTask.parse_version = 3`

后续补充浏览器验证又进一步确认：

- 选择 `doc2x-v2-2410` 时，`CreateParseTask` 真实请求中不会显式发送 `parse_version = 0`
- 但最终 `GetObjectParseList.parse_param.parse_version` 会真实落成 `0`

因此页码范围和复选框目前仍然只具备“UI 可见”证据，而不是“已确认请求参数”。

### 7.5 真实解析结果

一次真实解析已成功完成，返回结果中包含：

- `taskId`
- `objectId`
- `parseResult`
- 页面级 Markdown 内容
- 合并后的 Markdown 文本
- 本地导出的 `.md` 文件

说明本阶段目标“打通 PDF 解析闭环”已经达成。

为避免报告只停留在“验证通过”的摘要层，本次又额外执行了一轮针对当前修改版本的在线证据采集。该轮证据采集仍然基于真实订阅会话和同一份测试 PDF，直接取回了 `parse/status/markdown` 三个工具的真实返回结果。

本轮证据采集中，测试 PDF 返回了如下关键结果：

- `taskId`: `op_d80n80k91nqc73f3cst0`
- `parseId`: `op_d80n80k91nqc73f3cst0`
- `objectId`: `019e15ad-3005-79aa-b2ed-fa8a82bb7fa0`
- 任务状态：`status = success`
- 原始状态码：`rawStatus = 2`
- 进度：`progress = 100`

返回的 `resultMeta` 中，至少已确认包含以下结果对象：

- `spaceObject`
  - 文件名：`doc2x-test.pdf`
  - 页数：`1`
  - 文件大小：`634 bytes`
- `parseDetail`
  - `parse_param.parse_version = 3`
  - `parse_param.parse_model = 3`
- `parseResult`
  - `layout_response.pages[0].page_idx = 0`
  - `layout_response.pages[0].page_width = 1653`
  - `layout_response.pages[0].page_height = 2339`
  - `layout_response.pages[0].md` 已成功返回正文内容

本次测试中实际提取出的 Markdown 文本为：

```text
Doc2X MCP PDF Test This is a one-page sample.
```

本次新增的 `doc2x_get_parse_markdown` 在同一条新鲜任务链路上返回的合并 Markdown 文本为：

```markdown
<!-- page: 1 -->

Doc2X MCP PDF Test This is a one-page sample.
```

对应的页级结果可以概括为：

```json
{
  "pages": [
    {
      "pageIndex": 0,
      "markdown": "Doc2X MCP PDF Test This is a one-page sample."
    }
  ],
  "pageCount": 1,
  "wroteFile": true,
  "outputPath": "/tmp/doc2x-verify-output.md"
}
```

为了证明“新增的 Markdown 消费能力”不是报告中的推断，而是这轮真实修改后的返回结果，下面给出本轮证据采集得到的精简 JSON：

```json
{
  "parseResult": {
    "ok": true,
    "taskId": "op_d80n80k91nqc73f3cst0",
    "parseId": "op_d80n80k91nqc73f3cst0",
    "objectId": "019e15ad-3005-79aa-b2ed-fa8a82bb7fa0",
    "status": "success",
    "rawStatus": 2,
    "progress": 100
  },
  "statusResult": {
    "ok": true,
    "taskId": "op_d80n80k91nqc73f3cst0",
    "parseId": "op_d80n80k91nqc73f3cst0",
    "objectId": "019e15ad-3005-79aa-b2ed-fa8a82bb7fa0",
    "status": "success",
    "rawStatus": 2,
    "progress": 100
  },
  "markdownResult": {
    "ok": true,
    "taskId": "op_d80n80k91nqc73f3cst0",
    "parseId": "op_d80n80k91nqc73f3cst0",
    "objectId": "019e15ad-3005-79aa-b2ed-fa8a82bb7fa0",
    "status": "success",
    "pageCount": 1,
    "wroteFile": true,
    "outputPath": "/tmp/doc2x-evidence-output.md",
    "warnings": [],
    "pages": [
      {
        "pageIndex": 0,
        "markdown": "Doc2X MCP PDF Test This is a one-page sample."
      }
    ],
    "markdown": "<!-- page: 1 -->\n\nDoc2X MCP PDF Test This is a one-page sample."
  }
}
```

本轮同时还对落盘文件做了可核对校验：

- 输出文件路径：`/tmp/doc2x-evidence-output.md`
- 文件大小：`63 bytes`
- `sha256`：`8b9b0eee7e9c38ce7655800dfd088cbe286480897e65a68887182d923629810f`
- `matchesReturnedMarkdown = true`

这意味着：

- `doc2x_parse_pdf` 返回的 `taskId/objectId` 与 `doc2x_get_parse_status` 一致
- `doc2x_get_parse_markdown` 确实返回了新的合并 Markdown 结构，而不是仅靠旧的 `parseResult` 文本描述
- 返回体中的 `markdown` 与本地真实落盘文件逐字一致
- 新增修改的核心能力“结果消费 + 本地 `.md` 导出”已经被真实会话再次验证

### 7.6 网页同款导出验证

在新增导出工具后，本次还基于真实网页登录会话和同一份测试 PDF 补做了一轮网页同款导出验证。

真实浏览器抓包已确认默认导出请求为：

```json
{
  "parse_id": "op_d80oor2lb0pc7385hfg0",
  "formula_mode": "normal",
  "convert_to": 1,
  "filename": "doc2x-test",
  "merge_cross_page_forms": false,
  "formula_level": 0
}
```

对应真实下载结果的关键证据为：

- `mimeType = "application/zip"`
- `content-length = "317"`（浏览器抓包样本）

后续补充浏览器抓包，又额外确认了一条“非默认 Markdown 导出配置”的真实请求：

```json
{
  "parse_id": "op_d80rkmk91nqc738mntcg",
  "formula_mode": "dollar",
  "convert_to": 1,
  "filename": "doc2x-test",
  "merge_cross_page_forms": true,
  "formula_level": 0
}
```

这条请求证明了：

- `formula_mode` 的非默认值 `"dollar"` 已经进入真实网页请求
- `merge_cross_page_forms = true` 已经进入真实网页请求
- `formula_level` 在该次非默认导出中仍然保持默认 `0`

对应链路仍然完整走通：

- `CreateConvertParseTask`
- `GetConvertTaskStatus`
- `GET https://oss.consumer.doc2x.noedgeai.com/convert/<id>`

最终下载产物依然是：

- `mimeType = "application/zip"`

本轮 MCP 验证脚本新增导出断言后，会将结果写到：

- `/tmp/doc2x-verify-export.zip`
- `/tmp/doc2x-verify-export-dollar.zip`

导出工具成功态需要同时满足：

- convert 任务完成
- 返回非空 `downloadUrl`
- 本地 zip 文件真实写出
- 落盘文件非空
- 文件头为 `PK`
- 返回的 `byteLength` 与真实文件大小一致

因此，这一阶段已经不仅能“取回 parse 结果”，还能够沿着真实网页导出链路拿到最终下载产物。

补充后的在线验证还额外断言了这条高级导出路径：

1. `doc2x_export_parse_result`
   - `exportFormat = "markdown"`
   - `formulaMode = "dollar"`
   - `mergeCrossPageForms = true`
2. 返回体里的请求回显
   - `raw.createConvertPayload.formula_mode === "dollar"`
   - `raw.createConvertPayload.merge_cross_page_forms === true`
3. 本地导出文件
   - `/tmp/doc2x-verify-export-dollar.zip`
   - 文件非空
   - 文件头为 `PK`

为避免报告停留在“脚本通过”的层面，本次还额外采集了一轮当前修改版本的真实 MCP 返回值。该轮证据采集的关键结果如下：

```json
{
  "parseResult": {
    "ok": true,
    "taskId": "op_d80pepc91nqc73f3f7e0",
    "parseId": "op_d80pepc91nqc73f3f7e0",
    "objectId": "019e1637-6b06-7135-9c0d-3b83beb3e0c4",
    "parseVersion": 3,
    "status": "success",
    "rawStatus": 2,
    "progress": 100,
    "parseParam": {
      "parse_model": 3,
      "parse_version": 3,
      "model": 7
    }
  },
  "exportResult": {
    "ok": true,
    "taskId": "op_d80pepc91nqc73f3f7e0",
    "parseId": "op_d80pepc91nqc73f3f7e0",
    "objectId": "019e1637-6b06-7135-9c0d-3b83beb3e0c4",
    "exportTaskId": "cv_d80peq491nqc73f3f7f0",
    "exportFormat": "markdown",
    "status": "success",
    "rawStatus": 2,
    "outputPath": "/tmp/doc2x-phase2-evidence.zip",
    "wroteFile": true,
    "downloadUrl": "https://oss.consumer.doc2x.noedgeai.com/convert/cv_d80peq491nqc73f3f7f0",
    "contentType": "application/zip",
    "byteLength": 339,
    "warnings": []
  }
}
```

这轮额外证据说明：

- `doc2x_parse_pdf` 返回的 `parseVersion = 3` 已经与真实上游元数据对齐
- `doc2x_export_parse_result` 确实拿到了真实 `exportTaskId`
- 导出返回的 `contentType` 为 `application/zip`
- 工具返回了真实 `downloadUrl`，而不是本地伪造路径

随后补做的网页模型切换验证又补上了另一半证据：

- `PDF 解析模型` 在真实网页中可从 `doc2x-v3-2509-beta` 切到 `doc2x-v2-2410`
- 切到 `doc2x-v2-2410` 后，真实 `CreateParseTask` 请求为：
  - `{"source_id":"..."}`
- 对应结果元数据真实返回：
  - `parse_param.parse_version = 0`
  - `parse_param.parse_model = 3`
  - `parse_param.model = 6`

这说明当前 MCP 中 `parseVersion = 0` 已经不是代码候选值，而是网页实证值。

导出落盘文件的可核对结果如下：

- 输出文件路径：`/tmp/doc2x-phase2-evidence.zip`
- 文件大小：`339 bytes`
- 文件头魔数：`504b0304`
- `sha256`：`f4dbc388e0848588dd428c33f422c07e9fad15c01c45607a77aff27fdfba9835`

这意味着当前默认网页 Markdown 导出，在 MCP 里已经被真实验证为“zip 包下载链路”，而不是裸 `.md` 文件写出。

### 7.6.1 `merge_cross_page_forms = true` 的 LateX / Word 补证

为了确认 `merge_cross_page_forms = true` 不是只在 Markdown 导出里成立，又专门对跨页表格样本

- `/tmp/doc2x-cross-table-test.pdf`

补做了两轮浏览器抓包：

- LateX：
  - `/tmp/doc2x-table-latex-merge-true.json`
  - 真实请求：

```json
{
  "parse_id": "op_d80va62lb0pc73810fmg",
  "formula_mode": "normal",
  "convert_to": 2,
  "filename": "doc2x-cross-table-test",
  "merge_cross_page_forms": true,
  "formula_level": 0
}
```

- Word：
  - `/tmp/doc2x-table-word-merge-true.json`
  - 真实请求：

```json
{
  "parse_id": "op_d80va62lb0pc73810fmg",
  "formula_mode": "normal",
  "convert_to": 3,
  "filename": "doc2x-cross-table-test",
  "merge_cross_page_forms": true,
  "formula_level": 0
}
```

随后又用当前 MCP 对同一个 `taskId = op_d80va62lb0pc73810fmg` 做了默认/开启两组导出对比：

| 格式 | `merge_cross_page_forms` | 输出文件 | 字节数 | SHA-256 |
| --- | --- | --- | --- | --- |
| LateX | `false` | `/tmp/doc2x-latex-default.zip` | `2455` | `0809760ae00d1666acc900abd81cef0858fd7edb2c53d9e3c632e43a1cf83c69` |
| LateX | `true` | `/tmp/doc2x-latex-merge.zip` | `2527` | `cf9efae1735ae33750e866c09c55aa12fc579c48006e88bcb012c7d0ec7bc88a` |
| Word | `false` | `/tmp/doc2x-word-default.docx` | `14733` | `2d707e2690a075b768d7644ee00ff08666194180fd802123f423040168816f97` |
| Word | `true` | `/tmp/doc2x-word-merge.docx` | `14667` | `f3e5f3d1350ff85ac74164317bafa9ccf62547a210264eb28e966ccc01698384` |

这说明：

- `merge_cross_page_forms = true` 在 `markdown / latex / word` 三种正式导出格式中都已经拿到真实请求证据
- 当前 MCP 也能成功写出对应产物
- 默认版与开启版产物在大小和哈希上都发生了变化，因此这不是“请求有了但结果没变”的伪参数

### 7.6.2 未完成项的继续浏览器实验

在默认导出、`formula_mode = "dollar"` 和 `merge_cross_page_forms = true` 已经坐实后，又继续追了两项之前悬而未决的网页能力：

1. `formula_level` 的非默认值
2. `图片来源` 的其它取值

#### A. `formula_level` 非默认值

重新打开导出弹窗并切回 `图片来源 = 本地图片` 后，补采了一份当前 live 页面证据：

- `/tmp/doc2x-local-formula-ui.json`

该次 `bodyText` 中实际出现的相关项只有：

- `合并跨页表格`
- `导出格式`
- `导出Markdown`
- `公式符`
- `图片来源`

没有出现：

- `退化公式级别`
- `退化公式`

这说明在当前 live 网页的已验证 Markdown 导出路径里，已经**看不到可操作的 `formula_level` 非默认值控件**。

不过，随后又在 Word 导出弹窗里补抓到了 `退化公式级别` 的真实 UI 选项：

- `/tmp/doc2x-word-formula-level-options.json`
- `/tmp/doc2x-word-formula-level-options.json.png`

可见选项是：

- `不退化公式`
- `行内公式变为普通文本`
- `全部公式变为普通文本`

之后又尝试通过自动化点击：

- `/tmp/doc2x-word-formula-inline-text.json`
- `/tmp/doc2x-word-formula-all-text.json`

这两轮都只成功坐实了“选项文本真实存在”，但没有继续进入 `CreateConvertParseTask`。因此，到本轮为止，`formula_level != 0` 仍然不能作为正式 MCP 输入参数开放。

#### B. `图片来源 = 在线图床`

重新打开导出弹窗后，当前 live UI 证据见：

- `/tmp/doc2x-after-topbar-click.png`

该次弹窗真实可见项为：

- `图片来源 = 在线图床`
- `清除注释信息`
- `代码缩进兼容性增强`

随后，针对弹窗里的真实 `导 出` 按钮做了一次独立抓包：

- `/tmp/doc2x-capture-image-host-submit.json`

该次点击的关键网络结果不是 `CreateConvertParseTask`，而是：

```json
[
  {
    "url": "https://v2c.doc2x.noedgeai.com/gateway.v1.SpaceService/GetObjectParseResult",
    "method": "POST"
  },
  {
    "url": "https://doc2x-observe.cn-beijing.log.aliyuncs.com/logstores/doc2x-opentelemetry-raw/track?APIVersion=0.6.0",
    "method": "POST"
  }
]
```

也就是说，这次真实点击里：

- 看到了结果刷新
- 看到了前端埋点上报
- **没有**看到：
  - `CreateConvertParseTask`
  - `GetConvertTaskStatus`
  - `/convert/<id>` 下载 URL

因此，到本轮为止，对这两项更准确的结论是：

- `formula_level` 非默认值
  - Markdown 路径里未再暴露控件
  - Word 路径里可见 `行内公式变为普通文本 / 全部公式变为普通文本`
  - 但仍未抓到可靠请求映射
- `图片来源 = 在线图床`
  - UI 与附带开关可见
  - 但当前真实提交实验没有进入已验证的 HTTP 导出链路
  - 所以仍然不能作为正式 MCP 输入参数开放

#### C. `图片来源` 真实语义验证

为了确认“`在线图床` 到底是不是让导出的 Markdown 继续引用 Doc2X 远程图片链接”，又补做了一轮包含真实位图图片的验证。

本地构造的样本文件为：

- `/tmp/doc2x-raster-figure.svg`
- `/tmp/doc2x-raster-figure.png`
- `/tmp/doc2x-raster-test.pdf`

随后对 `/tmp/doc2x-raster-test.pdf` 执行真实解析，返回的 `GetObjectParseResult` 中已经包含远程图片：

```html
<img src="https://cdn.noedgeai.com/bo_d80uelk91nqc7388tjm0_0.jpg?x=123&y=324&w=1527&h=815&r=0"/>
```

这说明 parse 结果层本来就是远程 URL。

然后分别验证了两条导出路径：

1. `图片来源 = 本地图片`
   - 通过 MCP 对同一 parse 结果执行默认 Markdown 导出
   - 输出文件：`/tmp/doc2x-raster-local.zip`
   - `unzip -l` 结果中出现：
     - `doc2x-raster-local.md`
     - `images/0_123_324_1527_815_0.jpg`
     - `images/bo_d80uelk91nqc7388tjm0_0_123_324_1527_815_0.jpg`
   - 导出的 Markdown 内容为：

```markdown
![0_123_324_1527_815_0.jpg](images/0_123_324_1527_815_0.jpg)
```

2. `图片来源 = 在线图床`
   - 在真实浏览器中切到 `在线图床`
   - 当前弹窗状态截图：
     - `/tmp/doc2x-online-host-dialog-state.png`
   - 点击紫色 `导 出` 后的全量抓包：
     - `/tmp/doc2x-capture-all-export.json`
   - 该次点击只触发：

```json
[
  {
    "url": "https://v2c.doc2x.noedgeai.com/gateway.v1.SpaceService/GetObjectParseResult",
    "method": "POST"
  }
]
```

   - 没有触发：
     - `CreateConvertParseTask`
     - `GetConvertTaskStatus`
     - `/convert/<id>`
   - 但浏览器 `Downloads/` 目录中真实新增了两个 `.md` 文件：
     - `/home/oliviero/Downloads/doc2x-raster-test-20260511223127.md`
     - `/home/oliviero/Downloads/doc2x-raster-test-20260511223348.md`
   - 两个文件内容一致，均保留远程图片：

```html
<img src="https://cdn.noedgeai.com/bo_d80uelk91nqc7388tjm0_0.jpg?x=123&y=324&w=1527&h=815&r=0"/>
```

因此，这轮实验已经把“图片来源”的真实语义坐实：

- `本地图片`
  - 服务器 convert 链路
  - 下载 zip 包
  - 压缩包内带 `images/` 目录
  - Markdown 改写成相对路径图片引用
- `在线图床`
  - 浏览器直接基于 `GetObjectParseResult` 生成 `.md` 下载
  - 不走当前已验证的 convert HTTP 链路
  - Markdown 保留 `cdn.noedgeai.com` 远程图片 URL

### 7.7 多页 PDF 验证

为补强“分页逻辑已被真实验证”的证据，本次又专门构造并验证了一份 3 页测试 PDF。

本地输入文件确认结果如下：

```text
Pages:           3
Page size:       612 x 792 pts (letter)
File size:       1173 bytes
PDF version:     1.4
```

对应文件：

- 路径：`/tmp/doc2x-multipage-test.pdf`
- `file` 识别结果：`PDF document, version 1.4, 3 page(s)`

随后使用这份 3 页 PDF 重新执行：

```bash
npm run verify:mcp -- --online --pdf /tmp/doc2x-multipage-test.pdf
```

该命令已真实通过，说明现有主验收脚本在多页输入下不会打断 `parse -> status -> get_parse_markdown` 主链路。

为了证明多页分页结果本身不是推断，本次还额外采集了一份多页场景的真实返回摘要：

```json
{
  "inputFile": "/tmp/doc2x-multipage-test.pdf",
  "parseResult": {
    "ok": true,
    "taskId": "op_d80nb9qlb0pc7385gn80",
    "parseId": "op_d80nb9qlb0pc7385gn80",
    "objectId": "019e15b3-9e04-7dcf-831c-494759ea9938",
    "status": "success",
    "rawStatus": 2,
    "progress": 100
  },
  "statusResult": {
    "ok": true,
    "taskId": "op_d80nb9qlb0pc7385gn80",
    "parseId": "op_d80nb9qlb0pc7385gn80",
    "objectId": "019e15b3-9e04-7dcf-831c-494759ea9938",
    "status": "success",
    "rawStatus": 2,
    "progress": 100
  },
  "markdownResult": {
    "ok": true,
    "taskId": "op_d80nb9qlb0pc7385gn80",
    "parseId": "op_d80nb9qlb0pc7385gn80",
    "objectId": "019e15b3-9e04-7dcf-831c-494759ea9938",
    "status": "success",
    "pageCount": 3,
    "wroteFile": true,
    "outputPath": "/tmp/doc2x-multipage-output.md",
    "warnings": [],
    "pages": [
      {
        "pageIndex": 0,
        "markdown": "Doc2X Multi Page Test - Page 1"
      },
      {
        "pageIndex": 1,
        "markdown": "\n\nDoc2X Multi Page Test - Page 2"
      },
      {
        "pageIndex": 2,
        "markdown": "\n\nDoc2X Multi Page Test - Page 3"
      }
    ]
  }
}
```

多页场景下返回的合并 Markdown 文本为：

```markdown
<!-- page: 1 -->

Doc2X Multi Page Test - Page 1

<!-- page: 2 -->



Doc2X Multi Page Test - Page 2

<!-- page: 3 -->



Doc2X Multi Page Test - Page 3
```

这份多页证据说明了三件关键事实：

- `pageCount` 在真实多页 PDF 上返回了 `3`
- `pages[]` 中真实返回了 `pageIndex = 0/1/2`
- 合并 Markdown 中真实出现了 `<!-- page: 1 -->`、`<!-- page: 2 -->`、`<!-- page: 3 -->` 三个分页标记

本轮多页落盘文件的可核对结果如下：

- 输出文件路径：`/tmp/doc2x-multipage-output.md`
- 文件大小：`152 bytes`
- `sha256`：`335df6cb812572eb49d6136dbe1733b9118d7ff3c50f7cc85b1832cb1304f1c7`
- `matchesReturnedMarkdown = true`

另外，这轮多页测试还暴露了一个很有价值的真实行为：第 2 页和第 3 页正文前带有上游返回的前置空行。当前 `doc2x_get_parse_markdown` 按“忠实返回上游正文”的设计保留了这些空白，因此这份结果也能反过来证明报告中的多页样例来自真实返回，而不是人工润色后的示意文本。

因此，本实验已经不仅验证了“任务可以成功提交”，还验证了以下几点：

- 可以拿到任务最终完成态
- 可以拿到对象级元数据
- 可以拿到解析结果对象
- 可以拿到页面级正文 Markdown 内容
- 可以将合并后的 Markdown 正文稳定落盘到本地文件
- 可以验证落盘文件与工具返回文本完全一致

### 7.6 返回结果结构示例

为便于说明 MCP 当前阶段“获取结果”的能力，下面给出一次成功返回结果的精简结构：

```json
{
  "ok": true,
  "sourceId": "os_d80lbfc91nqc73f3c49g",
  "taskId": "op_d80lbg491nqc73f3c4dg",
  "parseId": "op_d80lbg491nqc73f3c4dg",
  "objectId": "019e1536-ff1d-74a8-8b25-27381c9a8216",
  "status": "success",
  "rawStatus": 2,
  "progress": 100,
  "resultMeta": {
    "spaceObject": { "...": "文件对象元数据" },
    "parseDetail": { "...": "解析任务元数据" },
    "parseResult": {
      "layout_response": {
        "pages": [
          {
            "page_idx": 0,
            "md": "Doc2X MCP PDF Test This is a one-page sample."
          }
        ]
      }
    }
  }
}
```

这表明当前 MCP 不仅具备“获取解析结果”的能力，还已经具备两种分层结果消费方式：

- `doc2x_get_parse_markdown`
  - 直接返回正文与页级 Markdown
- `doc2x_export_parse_result`
  - 沿真实网页下载链路获取最终导出产物

## 8. 结论

本实验成功完成了当前阶段的 Doc2X Subscription MCP 目标，证明了以下结论：

- 基于网页登录会话导入，可以稳定驱动订阅端核心 API
- 在运行时不依赖浏览器的前提下，可以完成单文件 PDF 的完整解析闭环
- 真实浏览器证据已经确认：
  - `parseVersion = 3 -> CreateParseTask` 显式发送 `parse_version = 3`
  - `parseVersion = 0 -> CreateParseTask` 省略 `parse_version`，但结果元数据真实落成 `parse_version = 0`
- 真实浏览器证据已经确认：
  - `Markdown -> convert_to = 1 -> application/zip`
  - `LateX -> convert_to = 2 -> application/zip`
  - `Word -> convert_to = 3 -> application/vnd.openxmlformats-officedocument.wordprocessingml.document`
- 真实订阅账号与真实 PDF 验证表明，该 MCP 已具备实际可用的 `PDF parse + Markdown 消费 + 网页同款导出` 能力
- 通过自动化验证脚本，项目已具备可重复验收手段

## 9. 不足与风险

- 当前只覆盖 PDF 主链路，尚未进入翻译和图片解析链路
- 解析弹窗中的页码范围等项，当前仍停留在“网页可见但未正式验证”的状态
- `HTML / PDF(HTML) / 导出到MD编辑器` 仍未形成稳定的 HTTP 导出证据
- 当前网页 `Markdown / LateX` 导出下载到本地的是 zip 包；这与直觉中的“裸文本/源码文件”不同
- 当前环境下的 stdio 子进程自检存在限制，未来若进入 CI 或不同宿主环境，需要再次确认 stdio 模式行为

## 10. 后续工作建议

建议下一阶段按以下顺序推进：

1. 继续逐项抓取解析弹窗，确认页码范围等参数是否真正进入请求 payload
2. 继续逐项抓取下载弹窗，确认 `HTML / PDF(HTML) / 导出到MD编辑器` 的真实链路
3. 在 HTML/PDF/编辑器链路验证完成后，再扩展 `doc2x_export_parse_result` 的正式格式枚举
4. 之后再进入 `translate`、术语表与图片解析链路
5. 在更接近真实部署环境的场景下补做 stdio 端到端验证
