# 实验报告：Doc2X Subscription MCP 第一阶段实现与验证

## 1. 实验背景

本实验围绕 `Doc2X Subscription MCP` 展开，目标是验证是否能够在保持运行时纯 HTTP 的前提下，将 Doc2X 网页订阅端的核心 PDF 解析能力封装为可调用的 MCP 工具，并为后续扩展翻译、图片解析和工具链能力建立稳定基础。

实验时间：2026-05-11  
实验地点：`/home/oliviero/AgenticProjects/textbook/doc2x`

## 2. 实验目标

本阶段目标如下：

- 实现基于网页登录会话导入的 MCP 调用能力
- 打通单文件本地 PDF 的完整解析链路
- 在 MCP 中暴露高层工具 `doc2x_parse_pdf` 与 `doc2x_get_parse_status`
- 在解析完成后补齐 Markdown 结果消费能力 `doc2x_get_parse_markdown`
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

### 5.3 MCP 验证脚本实现

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
[verify-mcp] Found 19 tools
[verify-mcp] Calling doc2x_surface_catalog
[verify-mcp] Calling doc2x_browser_fallback_plan
[verify-mcp] Calling doc2x_session_get
[verify-mcp] Online checks skipped. Pass --online to verify session-backed APIs.
[verify-mcp] Verification passed
```

验证结果包括：

- MCP client/server 握手成功
- 工具列表可用
- `doc2x_surface_catalog` 可用
- `doc2x_browser_fallback_plan` 可用
- `doc2x_session_get` 可用
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
[verify-mcp] Running online checks
[verify-mcp] Calling doc2x_request
[verify-mcp] Calling doc2x_get_account_bundle
[verify-mcp] Calling doc2x_parse_pdf
[verify-mcp] Calling doc2x_get_parse_status
[verify-mcp] Calling doc2x_get_parse_markdown
[verify-mcp] Verification passed
```

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

也就是说，本次验证已经覆盖了“新鲜任务链路 -> Markdown 消费 -> 本地 `.md` 导出 -> 文件内容一致性”这一整条新增能力，而不是只验证工具名称存在。

需要说明的是，现有自动化脚本在多页场景下仍主要断言“返回非空 Markdown、非空 `pages`、落盘一致”，并不会直接断言 `pageCount === 3`。因此，针对多页行为，本报告下面额外补充了一轮专门的证据采集。

验证结果包括：

- `doc2x_request` 成功访问在线接口
- `doc2x_get_account_bundle` 成功获取账号信息
- `doc2x_parse_pdf` 成功完成 PDF 上传、建任务、轮询和结果补查
- `doc2x_get_parse_status` 成功返回完成态与解析元数据
- `doc2x_get_parse_markdown` 成功返回 Markdown 正文、页级明细，并成功落盘到本地 `.md` 文件

### 7.4 真实解析结果

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

### 7.5 多页 PDF 验证

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

这表明当前 MCP 已经具备“获取解析结果”的能力，只是本阶段返回形式仍以结构化 JSON 和元数据为主，尚未进一步封装为独立的 `.md`、`.docx` 或 `.tex` 导出文件。

## 8. 结论

本实验成功完成了 Doc2X Subscription MCP 第一阶段目标，证明了以下结论：

- 基于网页登录会话导入，可以稳定驱动订阅端核心 API
- 在运行时不依赖浏览器的前提下，可以完成单文件 PDF 的完整解析闭环
- 真实订阅账号与真实 PDF 验证表明，该 MCP 已具备实际可用的 `PDF parse-only` 能力
- 通过自动化验证脚本，项目已具备可重复验收手段

## 9. 不足与风险

- 当前只覆盖 PDF parse-only，尚未进入翻译和图片解析链路
- `parseVersion` 目前默认使用 `3`，虽已被成功联调验证，但仍建议后续继续抓取网页原始请求进一步固化证据
- 当前环境下的 stdio 子进程自检存在限制，未来若进入 CI 或不同宿主环境，需要再次确认 stdio 模式行为

## 10. 后续工作建议

建议下一阶段按以下顺序推进：

1. 固化 `translate` 链路
2. 增加术语表相关工具
3. 继续补齐更多解析参数分支
4. 评估图片解析是否能沿用当前 HTTP 工作流
5. 在更接近真实部署环境的场景下补做 stdio 端到端验证
