# Doc2X Parse Browser Analysis (2026-05-11)

## 背景

本分析记录基于真实网页登录态浏览器实例，对 Doc2X 网页订阅端 `parse` 与 `parseDetail` 流程进行逐步点击和抓包得到的证据。

本轮目标不是改代码，而是回答两类问题：

- `PDF parse` 主链路的真实网页请求到底如何发出
- 解析完成后的下载/导出页到底依赖哪些参数和请求

浏览器环境：

- Profile: `/tmp/doc2x-monitorable-profile`
- DevTools: `127.0.0.1:9222`
- 当前登录页：`https://doc2x.noedgeai.com/parseDetail/op_d80oor2lb0pc7385hfg0`

关键抓包文件：

- `/tmp/doc2x-confirm-capture.json`
- `/tmp/doc2x-export-confirm-capture.json`
- `/tmp/doc2x-download-open-capture.json`
- `/tmp/doc2x-upload-capture-5819.json`

## 一、登录态与页面状态

当前浏览器实例中的网页登录态有效：

- `hasBearerToken = true`
- `hasRefreshToken = true`
- `username = Geek-zhu`
- `subscribed = true`
- `subscriptionEnd = 2026-06-09T15:57:52Z`

这说明后续浏览器抓包可以直接代表真实网页订阅端行为。

## 一点五、一步式受管浏览器认证证据

在新增 `doc2x_auth_browser` 之前，仓库里只有：

- `doc2x_import_browser_session`
- `doc2x_session_set`

也就是说，原来只能“导入一个已经登录好的浏览器会话”，还不能像 `notebooklm-mcp` 那样把“启动浏览器 + 登录后自动导入”收成一个正式用户能力。

这轮针对受管浏览器认证补做了两类真实验证：

### A. 静默复用成功态

调用条件：

- `profileDir = /tmp/doc2x-monitorable-profile`
- `debugPort = 9222`
- 当前 `9222` 上已有真实已登录 Doc2X Chrome

实际结果：

```json
{
  "ok": true,
  "authenticated": true,
  "openedBrowser": false,
  "reusedManagedProfile": true,
  "timedOut": false,
  "debugBaseUrl": "http://127.0.0.1:9222",
  "profileDir": "/tmp/doc2x-monitorable-profile"
}
```

真实捕获到的关键会话事实：

- `hasBearerToken = true`
- `hasRefreshToken = true`
- `cookieCount = 4`
- `cookieDomains = [".noedgeai.com"]`

真实探活内容：

- `GET /v2/user/profile`
- `GET /v2/user/quota`
- `GET /v2/user/subscription`
- `GET /v2/product/list`

结论：

- 一步式工具在“已有活着的、带 DevTools 的已登录浏览器”场景下，可以做到**无新窗口、无手工二次导入**地直接完成认证。
- 成功标准已经不是“抓到 cookie/token”，而是“导入后真实账户探活成功”。

### B. 新 profile 可见浏览器超时态

调用条件：

- `profileDir = /tmp/doc2x-auth-timeout-profile`
- `timeoutMs = 5000`
- fresh profile，无预先登录态

实际结果：

```json
{
  "ok": false,
  "authenticated": false,
  "openedBrowser": true,
  "reusedManagedProfile": false,
  "timedOut": true,
  "debugBaseUrl": "http://127.0.0.1:43047",
  "profileDir": "/tmp/doc2x-auth-timeout-profile"
}
```

结论：

- 一步式工具在无登录态时，确实会自动进入“打开可见 Chrome/Chromium 让用户手动登录”的路径。
- 如果在等待窗口内未完成登录，工具不会把这次调用作为协议错误，而是返回结构化超时结果。
- 后续继续调用同一个工具即可沿着受管 profile 继续，而不是改走另一套工具。

### C. 运行层补充发现

实现和实测过程中还确认了两个必要行为：

1. **显式 `debugPort` 应优先于受管状态文件**
   - 否则当 profile 下残留上一次未完成认证的浏览器状态时，工具会错误地优先黏住旧端口。
   - 现已调整为：如果调用时显式传了 `debugPort`，先探测这个端口。

2. **受管 profile 需要清理陈旧 Chrome 单例锁文件**
   - 真实报错：
     - `Failed to create .../SingletonLock`
     - `Failed to create a ProcessSingleton for your profile directory`
   - 现已确认在“没有活着的受管浏览器”前提下，启动前应清理：
     - `SingletonLock`
     - `SingletonSocket`
     - `SingletonCookie`
     - `DevToolsActivePort`

## 二、真实 Parse 主链路

### 1. 页面交互顺序

真实网页流程不是“点一次开始解析就立即建任务”，而是：

1. 选择 PDF
2. 点击 `开始解析文件`
3. 弹出 `解析选项` 弹窗
4. 点击 `确认处理`
5. 才真正开始上传与建解析任务

### 2. 真实请求链路

本次测试文件：

- `doc2x-test.pdf`

真实请求顺序如下：

1. `POST /gateway.v1.TaskService/CreateUploadTask`
2. `POST https://doc2x-backend.oss-cn-beijing.aliyuncs.com/`
3. `POST /gateway.v1.TaskService/GetTaskStatus`
4. `POST /gateway.v1.TaskService/CreateParseTask`
5. `POST /gateway.v1.TaskService/GetTaskStatus`
6. 页面跳转到 `/parseDetail/<parse_id>`
7. `POST /gateway.v1.SpaceService/GetObjectParseList`
8. `POST /gateway.v1.SpaceService/GetSpaceObjectSource`
9. `POST /gateway.v1.SpaceService/GetObjectParseResult`

### 3. 关键请求与响应

#### 3.1 CreateUploadTask

请求：

```json
{
  "filename": "doc2x-test.pdf"
}
```

响应：

```json
{
  "code": "success",
  "data": {
    "output_id": "os_d80oopqlb0pc7385hff0",
    "url": "https://doc2x-backend.oss-cn-beijing.aliyuncs.com/",
    "form_data": {
      "bucket": "doc2x-backend",
      "key": "tmp/prod/bo_d80oopqlb0pc7385hffg",
      "Content-Type": "application/pdf",
      "x-amz-meta-output_id": "os_d80oopqlb0pc7385hff0",
      "x-amz-date": "20260511T075935Z",
      "x-amz-algorithm": "AWS4-HMAC-SHA256",
      "x-amz-credential": "...",
      "x-amz-signature": "...",
      "policy": "..."
    }
  }
}
```

结论：

- 网页上传链路是 `CreateUploadTask -> OSS 表单上传`
- 当前网页不是 multipart chunk 上传，而是单次表单上传到 OSS

#### 3.2 上传完成轮询

请求：

```json
{
  "output_id": "os_d80oopqlb0pc7385hff0"
}
```

响应先后为：

```json
{"data":{"status":1,"progress":0},"code":"success"}
```

```json
{"code":"success","data":{"status":2,"progress":100}}
```

结论：

- 上传对象在变成可解析源之前，需要先对 `source output_id` 轮询状态

#### 3.3 CreateParseTask

请求：

```json
{
  "source_id": "os_d80oopqlb0pc7385hff0",
  "parse_version": 3
}
```

响应：

```json
{
  "data": {
    "output_id": "op_d80oor2lb0pc7385hfg0"
  },
  "code": "success"
}
```

结论：

- `parse_version` 已被真实网页证据确认
- 本轮默认路径下，网页没有额外发送别的 parse 参数

### 4. Parse 弹窗输入面补充验证

在可监控浏览器实例中，`开始解析文件 -> 解析选项` 弹窗里实际可见/可读到的输入面包括：

- 隐藏 `file` input
- 文件名显示输入框：`doc2x-test.pdf`
- 页码范围输入框：`1 ~ 1`
- `下次解析不再显示` 复选框
- `确认处理` 按钮

针对“页码范围”我额外做了一次单独抓包：

- 页面输入尝试改为单页值
- 最终成功发出的请求仍然只有：
  - `CreateUploadTask`: `{"filename":"doc2x-test.pdf"}`
  - `CreateParseTask`: `{"source_id":"...","parse_version":3}`

当前没有抓到任何页码范围相关字段进入 `CreateParseTask`，也没有看到它落在前置或后置请求里。

结论：

- `页码范围` 目前只确认“网页 UI 中存在”
- 还**没有**确认它是否真的影响 HTTP 请求 payload
- `下次解析不再显示` 复选框同样只确认“UI 存在”，未确认其请求映射

### 5. PDF 解析模型列表补充分析

这轮虽然没能重新挂起新的可监控 Chrome 进程，但现有抓包与前端静态资源已经足够确认“页面上看到的 PDF 模型列表”到底落在哪一层。

#### 5.1 页面可见证据

在已有页面抓包文本中，可以明确看到首页展示：

- `图片解析模型 doc2x-v2-2410`
- `PDF 解析模型 doc2x-v3-2509-beta`

这说明网页**确实在 UI 上展示了解析模型/版本选择信息**，而不是只有后台元数据。

#### 5.2 前端状态证据

从被动抓到的前端 bundle 代码看，网页端持久化/状态管理里反复出现的是：

- `parseVersion`
- `setParseVersion`
- `DOC2X_V3_2509`

例如前端状态里有：

- `parseVersion: DOC2X_V3_2509`
- `setParseVersion(...)`

但当前没有抓到对应的：

- `parseModel`
- `setParseModel`

这说明**前端当前明确建模并持久化的是 `parseVersion`，不是单独的 `parseModel` 输入项**。

#### 5.3 请求层证据

这轮在真实网页中进一步完成了“切换 PDF 解析模型 -> 上传 PDF -> 点击确认处理”的完整验证。

切到 `doc2x-v2-2410` 之后，页面顶部 `PDF 解析模型` 的可见值会真实变成：

- `doc2x-v2-2410`

随后 fresh `/parse` 页面中的真实任务链路为：

1. `CreateUploadTask`
2. OSS 表单上传
3. 上传 `GetTaskStatus`
4. `CreateParseTask`
5. 解析 `GetTaskStatus`
6. `GetObjectParseList`

其中关键差异是：

- 选择 `doc2x-v3-2509-beta` 时，真实 `CreateParseTask` 请求为：

```json
{
  "source_id": "...",
  "parse_version": 3
}
```

- 选择 `doc2x-v2-2410` 时，真实 `CreateParseTask` 请求为：

```json
{
  "source_id": "os_d80qeuk91nqc73f3fuv0"
}
```

也就是：

- **没有出现 `parse_model`**
- **也没有显式出现 `parse_version = 0`**
- 但请求形状发生了真实变化：`v2` 路径下 `parse_version` 字段被省略

#### 5.4 元数据证据

后续 `GetObjectParseList` 返回中，确实能看到两组已验证结果：

```json
{
  "parse_param": {
    "parse_model": 3,
    "parse_version": 3,
    "model": 7
  }
}
```

以及本轮 `doc2x-v2-2410` 真实切换后的返回：

```json
{
  "parse_param": {
    "parse_model": 3,
    "parse_version": 0,
    "model": 6
  }
}
```

因此当前更合理的解释是：

- 页面上用户看到的“PDF 解析模型 `doc2x-v3-2509-beta / doc2x-v2-2410`”，在当前网页实现里，确实对应一个**`parseVersion` 选择/展示项**
- `v3` 通过显式 `parse_version = 3` 入参表达
- `v2` 通过**省略 `parse_version` 字段**表达，随后在结果元数据里落为 `parse_version = 0`
- `parse_model` 与 `model` 仍更像后端结果元数据里的内部模型标识，而不是当前已确认的前端可配输入参数

#### 5.5 当前结论

所以，关于“parse 侧能不能设置 PDF 解析模型”，目前最稳的结论是：

- **能看到模型列表/当前模型名**
- **能确认前端显式管理的是 `parseVersion`**
- **能确认 `doc2x-v2-2410` 的真实网页结果会落成 `parse_version = 0`**
- **还不能确认存在一个单独、正式可控的 `parseModel` 请求参数**

换句话说：

- 当前 MCP 正式开放 `parseVersion` 是合理的
- 当前 MCP **不应**正式开放 `parseModel`
- `parseVersion = 0` 不再只是代码候选映射，而是**真实网页切换 `doc2x-v2-2410` 后的已验证结论**

#### 3.4 Parse 轮询

请求：

```json
{
  "output_id": "op_d80oor2lb0pc7385hfg0"
}
```

响应先后为：

```json
{"code":"success","data":{"status":1,"progress":1}}
```

```json
{"code":"success","data":{"status":2,"progress":100}}
```

#### 3.5 结果对象查询

`GetObjectParseList` 请求：

```json
{
  "object_id": "019e160c-8de4-7cae-9fa8-2cde51ae7500"
}
```

响应中的关键字段：

```json
{
  "parse_id": "op_d80oor2lb0pc7385hfg0",
  "object_id": "019e160c-8de4-7cae-9fa8-2cde51ae7500",
  "parse_param": {
    "parse_model": 3,
    "parse_version": 3,
    "model": 7
  }
}
```

结论：

- `parse_model = 3` 本轮只在结果元数据里出现
- `parse_model` 目前还不能当成“已确认请求参数”
- `model = 7` 也只在结果元数据里出现，语义仍待后续确认

#### 3.6 原始文件与解析结果

`GetSpaceObjectSource` 请求：

```json
{
  "object_id": "019e160c-8de4-7cae-9fa8-2cde51ae7500"
}
```

响应：

```json
{
  "data": {
    "url": "https://oss.consumer.doc2x.noedgeai.com/objects/bo_d80oopqlb0pc7385hffg"
  },
  "code": "success"
}
```

`GetObjectParseResult` 请求：

```json
{
  "parse_id": "op_d80oor2lb0pc7385hfg0"
}
```

响应中的关键结果：

```json
{
  "object_id": "019e160c-8de4-7cae-9fa8-2cde51ae7500",
  "layout_response": {
    "pages": [
      {
        "page_idx": 0,
        "md": "Doc2X MCP PDF Test This is a one-page sample."
      }
    ]
  }
}
```

结论：

- `GetSpaceObjectSource` 给出原始 PDF 下载 URL
- `GetObjectParseResult` 给出最终结构化 parse 结果

## 三、左侧结果树与下载入口

在 `parseDetail` 页，左侧结果树中，当前对象下可以展开出：

- `原始 PDF`
- `v3 解析结果 MD`

右侧对应两个 viewer：

- PDF viewer
- Markdown viewer

Markdown viewer header 上的左侧 icon 是下载入口。点击后不会立刻下载，而是先弹出 `导出配置` 页面。

## 四、真实下载/导出配置页

### 1. 导出配置页可见项

抓到的真实文案包括：

- `请选择导出配置`
- `请确认是否导出`
- `合并跨页表格`
- `导出格式`
- `导出Markdown`
- `导出LateX`
- `导出Word`
- `导出HTML`
- `导出PDF(HTML)`
- `导出到MD编辑器`
- `公式符 \\[\\]`
- `退化公式级别`
- `图片来源 本地图片`

### 2. 默认导出动作

默认点击 `导 出` 时，真实请求是：

#### CreateConvertParseTask

请求：

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

响应：

```json
{
  "code": "success",
  "data": {
    "output_id": "cv_d80ov9k91nqc73f3emtg"
  }
}
```

#### GetConvertTaskStatus

请求：

```json
{
  "output_id": "cv_d80ov9k91nqc73f3emtg"
}
```

响应先后为：

```json
{"code":"success","data":{"status":1,"url":""}}
```

```json
{
  "code": "success",
  "data": {
    "status": 2,
    "url": "https://oss.consumer.doc2x.noedgeai.com/convert/cv_d80ov9k91nqc73f3emtg"
  }
}
```

#### 最终下载

请求：

```text
GET https://oss.consumer.doc2x.noedgeai.com/convert/cv_d80ov9k91nqc73f3emtg
```

结论：

- 网页导出链路不是“直接拼本地 markdown 文件”
- 而是明确走：
  - `CreateConvertParseTask`
  - `GetConvertTaskStatus`
  - `convert URL`

## 五、浏览器验证后的输入/输出参数矩阵

### 1. Parse 输入参数矩阵

| 类别 | 字段/网页项 | 真实证据 | 当前结论 |
| --- | --- | --- | --- |
| 上传输入 | `filename` | `CreateUploadTask` 请求：`{"filename":"doc2x-test.pdf"}` | 已验证，真实请求输入 |
| 解析输入 | `source_id` | `CreateParseTask` 请求：`{"source_id":"...","parse_version":3}` | 已验证，真实请求输入 |
| 解析输入 | `parse_version = 3` | 选择 `doc2x-v3-2509-beta` 时：`{"source_id":"...","parse_version":3}` | 已验证，真实请求输入 |
| 解析输入 | `parse_version = 0` | 选择 `doc2x-v2-2410` 时：`CreateParseTask` 真实请求仅有 `{"source_id":"..."}`，后续 `GetObjectParseList.parse_param.parse_version = 0` | 已验证，网页真实切换结果 |
| 解析弹窗 UI | `页码范围` | 输入框可见，但改值后未观察到请求差异 | 仅 UI 可见，未验证进入请求 |
| 解析弹窗 UI | `下次解析不再显示` | 复选框可见，未观察到请求映射 | 仅 UI 可见，未验证进入请求 |
| 解析元数据 | `parse_model` | 在 `parse_version = 3` 和 `parse_version = 0` 两条真实结果里都出现，但未进入 `CreateParseTask` 请求 | 仅输出元数据，不是已验证输入 |
| 解析元数据 | `model` | 已观察到 `v3 -> model = 7`、`v2 -> model = 6`，但未进入 `CreateParseTask` 请求 | 仅输出元数据，语义待确认 |

### 2. Parse 输出参数矩阵

| 接口 | 关键输出字段 | 真实证据 | 当前结论 |
| --- | --- | --- | --- |
| `CreateUploadTask` | `output_id`, `url`, `form_data` | 已抓到完整响应 | 已验证 |
| `GetTaskStatus`（上传） | `status`, `progress` | `1 -> 2`, `0 -> 100` | 已验证 |
| `CreateParseTask` | `output_id` | 返回 `op_d80oor2lb0pc7385hfg0` | 已验证 |
| `GetTaskStatus`（解析） | `status`, `progress` | `1 -> 2`, `1 -> 100` | 已验证 |
| `GetObjectParseList` | `parse_id`, `object_id`, `parse_param.parse_version`, `parse_param.parse_model`, `parse_param.model` | 已抓到真实返回 | 已验证 |
| `GetSpaceObjectSource` | `url` | 返回原始 PDF OSS URL | 已验证 |
| `GetObjectParseResult` | `object_id`, `layout_response.pages[].page_idx`, `layout_response.pages[].md` | 已抓到真实返回 | 已验证 |

### 3. 导出输入参数矩阵

| 网页项/字段 | Markdown | LateX | Word | HTML | PDF(HTML) | 导出到MD编辑器 | 当前结论 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `parse_id` | 已验证 | 已验证 | 已验证 | 未抓到 | 未抓到 | 未抓到 | 当前只对前三种格式确认 |
| `convert_to` | `1` | `2` | `3` | 未抓到 | 未抓到 | 未抓到 | `markdown/latex/word` 已验证 |
| `filename` | 已验证 | 已验证 | 已验证 | 未抓到 | 未抓到 | 未抓到 | 当前只对前三种格式确认 |
| `formula_mode = "normal"` | 已验证 | 已验证 | 已验证 | 未抓到 | 未抓到 | 未抓到 | 只验证默认值 |
| `formula_mode = "dollar"` | 已验证 | 未抓到 | 未抓到 | 未抓到 | 未抓到 | 未抓到 | 仅 Markdown 非默认值已验证 |
| `merge_cross_page_forms = false` | 已验证 | 已验证 | 已验证 | 未抓到 | 未抓到 | 未抓到 | 默认值已验证 |
| `merge_cross_page_forms = true` | 已验证 | 已验证 | 已验证 | 未抓到 | 未抓到 | 未抓到 | `markdown/latex/word` 非默认值已验证 |
| `formula_level = 0` | 已验证 | 已验证 | 已验证 | 未抓到 | 未抓到 | 未抓到 | 只验证默认值 |
| `formula_level != 0` | 未抓到 | 未抓到 | UI 可见 | 未抓到 | 未抓到 | 未抓到 | 当前只在 Word 导出弹窗里观察到 `行内公式变为普通文本 / 全部公式变为普通文本`，但仍未抓到真实请求 |
| `图片来源 本地图片` | UI 可见，语义已验证 | 未抓到 | 未抓到 | 未抓到 | 未抓到 | 未抓到 | 当前仅在 Markdown 导出弹窗里观察到，并已验证为默认 convert 链路 |
| `图片来源 在线图床` | UI 可见 | 未抓到 | 未抓到 | 未抓到 | 未抓到 | 未抓到 | 仅在 Markdown 导出弹窗里观察到；点击真实导出按钮后仍未出现 `CreateConvertParseTask` |
| `清除注释信息` | UI 可见 | 未抓到 | 未抓到 | 未抓到 | 未抓到 | 未抓到 | 仅在 `在线图床` 变体下观察到；点击真实导出按钮后仍未出现请求映射 |
| `代码缩进兼容性增强` | UI 可见 | 未抓到 | 未抓到 | 未抓到 | 未抓到 | 未抓到 | 仅在 `在线图床` 变体下观察到；点击真实导出按钮后仍未出现请求映射 |

### 4. 导出输出参数矩阵

| 网页项/链路 | 真实证据 | 当前结论 |
| --- | --- | --- |
| `CreateConvertParseTask` | `markdown/latex/word` 均抓到真实请求 | 已验证 |
| `GetConvertTaskStatus` | `markdown/latex/word` 均抓到 `status 1 -> 2` | 已验证 |
| 最终下载 URL | `markdown/latex/word` 均抓到 `https://oss.consumer.doc2x.noedgeai.com/convert/<id>` | 已验证 |
| Markdown 导出 MIME | `application/zip` | 已验证 |
| LateX 导出 MIME | `application/zip` | 已验证 |
| Word 导出 MIME | `application/vnd.openxmlformats-officedocument.wordprocessingml.document` | 已验证 |
| HTML 导出 | 当前未抓到 convert 任务或下载 URL | 未验证 |
| PDF(HTML) 导出 | 当前更像跳入编辑器工作流，未抓到 convert 任务 | 未验证 |
| 导出到MD编辑器 | 当前未观察到网络请求 | 浏览器内动作，未进入 HTTP 导出范围 |

## 六、当前最稳的实现结论

### 1. `doc2x_parse_pdf` 先开放哪些参数

目前有真实请求证据、可以直接开放的：

- `parseVersion`

目前还不该贸然开放为“已确认请求参数”的：

- `parseModel`
- `pageRange`
- 其它解析弹窗项

原因：

- `parseModel` 只在结果元数据中出现
- `pageRange` 在当前抓包中没有反映到请求 payload
- 其它弹窗项只确认“页面存在”，没有真实请求映射证据

并且 `parseVersion` 目前已经有两条网页实证路径：

- `doc2x-v3-2509-beta -> CreateParseTask` 显式发送 `parse_version = 3`
- `doc2x-v2-2410 -> CreateParseTask` 省略 `parse_version`，但结果元数据真实落成 `parse_version = 0`

### 2. 当前网页同款导出，哪些格式可以正式进入 MCP

基于本轮真实网页证据，当前可以正式进入 HTTP-first MCP 的是：

- `markdown`
  - `convert_to = 1`
  - 下载 MIME：`application/zip`
- `latex`
  - `convert_to = 2`
  - 下载 MIME：`application/zip`
- `word`
  - `convert_to = 3`
  - 下载 MIME：`application/vnd.openxmlformats-officedocument.wordprocessingml.document`

目前**还不应**正式进入 MCP schema 的是：

- `html`
- `pdfhtml`
- `mdeditor`

原因：

- `HTML` 尚未抓到稳定的 convert 请求与下载 URL
- `PDF(HTML)` 当前更像跳入编辑器工作流，而不是简单的 convert 下载
- `导出到MD编辑器` 当前未观察到网络请求，不属于当前 HTTP-first 导出链路

### 3. 仍待补证据的点

当前还没有单独切换并验证这些导出选项：

- `formula_level` 的非默认取值请求映射
- `图片来源 在线图床` 的真实 HTTP 请求映射
- `清除注释信息`
- `代码缩进兼容性增强`
- `formula_mode` 除 `"normal"` / `"dollar"` 外的其它取值

已经补齐真实请求证据、可以进入 MCP 的导出参数是：

- `formula_mode = "dollar"`（仅 Markdown）
- `merge_cross_page_forms = true`（Markdown / LateX / Word）

所以当前这些项应拆开看：

- `merge_cross_page_forms = true`
  - 已验证，可进入 MCP
- `formula_mode = "dollar"`
  - 已验证，可进入 MCP
- `formula_level` 非默认值、`图片来源` 变体、以及其附带开关
  - 仍然只是“网页已观察到，但尚未抓到可靠请求映射”的状态

### 4. 对剩余两项的后续浏览器实证

为缩小剩余不确定性，又补做了两轮浏览器实验：

1. `formula_level` 非默认值
   - 在当前 live 网页里，Markdown 本地图片路径没有再暴露 `退化公式级别` 控件，证据见：
     - `/tmp/doc2x-local-formula-ui.json`
   - 但 Word 导出弹窗里真实观察到了该控件与两个非默认项：
     - `行内公式变为普通文本`
     - `全部公式变为普通文本`
   - 对应 UI 证据见：
     - `/tmp/doc2x-word-formula-level-options.json`
     - `/tmp/doc2x-word-formula-level-options.json.png`
   - 之后又尝试通过自动化分别点击这两个选项并继续导出：
     - `/tmp/doc2x-word-formula-inline-text.json`
     - `/tmp/doc2x-word-formula-all-text.json`
   - 两次都成功坐实了“选项文本真实存在”，但在当前自动化路径里没有继续进入 `CreateConvertParseTask`，因此仍然**没有拿到可靠的请求字段映射**。

2. `图片来源 = 在线图床`
   - 重新打开导出弹窗后，当前 live UI 证据见：
     - `/tmp/doc2x-after-topbar-click.png`
   - 页面上真实可见的额外项为：
     - `清除注释信息`
     - `代码缩进兼容性增强`
   - 然后对弹窗里的真实 `导 出` 按钮执行点击抓包，证据见：
     - `/tmp/doc2x-capture-image-host-submit.json`
   - 该次请求里只观察到：
     - `GetObjectParseResult`
     - 前端埋点上报
   - **没有**观察到：
     - `CreateConvertParseTask`
     - `GetConvertTaskStatus`
     - `/convert/<id>` 下载 URL

因此，这两项当前更准确的状态不是“还没来得及看”，而是：

- `formula_level` 非默认值
  - 当前只在 Word 导出弹窗里观察到两个非默认值
  - 但仍未抓到可靠请求映射，暂时不能进入正式 MCP
- `图片来源 = 在线图床`
  - UI 与附带开关可见
  - 但在真实提交实验中，没有进入当前已验证的 HTTP 导出链路

### 4.1 图片来源语义实证

为了确认“`在线图床` 到底是不是让导出的 Markdown 保留远程图片 URL”，又额外构造并验证了一份包含真实位图图片的 PDF：

- SVG 样本：`/tmp/doc2x-raster-figure.svg`
- 生成后的位图：`/tmp/doc2x-raster-figure.png`
- 最终测试 PDF：`/tmp/doc2x-raster-test.pdf`

对这份 PDF 的真实 parse 结果，`GetObjectParseResult` 返回的 `layout_response.pages[0].md` 明确包含远程图片：

```html
<img src="https://cdn.noedgeai.com/bo_d80uelk91nqc7388tjm0_0.jpg?x=123&y=324&w=1527&h=815&r=0"/>
```

也就是说，Doc2X 的**原始 parse 结果层**本来就是远程图片 URL。

随后又分别验证了两条导出路径：

1. `图片来源 = 本地图片`
   - 使用 MCP 对同一个 parse 结果执行默认 Markdown 导出
   - 输出文件：`/tmp/doc2x-raster-local.zip`
   - 压缩包结构：
     - `doc2x-raster-local.md`
     - `images/0_123_324_1527_815_0.jpg`
     - `images/bo_d80uelk91nqc7388tjm0_0_123_324_1527_815_0.jpg`
   - 导出的 Markdown 内容为：

```markdown
![0_123_324_1527_815_0.jpg](images/0_123_324_1527_815_0.jpg)
```

这证明默认“本地图片”语义是：

- 走 `CreateConvertParseTask -> GetConvertTaskStatus -> /convert/<id>` 链路
- 下载 zip 包
- 将远程图片**本地化**为 `images/` 目录中的文件
- Markdown 里改写成相对路径引用

2. `图片来源 = 在线图床`
   - 在真实网页导出弹窗中切到 `在线图床`
   - 当前弹窗状态证据：
     - `/tmp/doc2x-online-host-dialog-state.png`
   - 点击紫色 `导 出` 按钮后的全量抓包：
     - `/tmp/doc2x-capture-all-export.json`
   - 该次点击只看到：
     - `POST /gateway.v1.SpaceService/GetObjectParseResult`
   - 没有看到：
     - `CreateConvertParseTask`
     - `GetConvertTaskStatus`
     - `/convert/<id>`
   - 但浏览器 `Downloads/` 目录里真实新增了：
     - `/home/oliviero/Downloads/doc2x-raster-test-20260511223127.md`
     - `/home/oliviero/Downloads/doc2x-raster-test-20260511223348.md`
   - 这两个文件内容一致，均保留远程图片：

```html
<img src="https://cdn.noedgeai.com/bo_d80uelk91nqc7388tjm0_0.jpg?x=123&y=324&w=1527&h=815&r=0"/>
```

因此，这轮可以把“图片来源”两种模式的语义彻底坐实：

- `本地图片`
  - 服务器 convert 链路
  - zip 包
  - `images/` 目录
  - Markdown 使用相对路径图片引用
- `在线图床`
  - 浏览器直接基于 `GetObjectParseResult` 生成 `.md` 下载
  - 不走当前已验证的 convert HTTP 链路
  - Markdown 保留 `cdn.noedgeai.com` 远程图片 URL

这也解释了为什么前面在 `在线图床` 状态下一直抓不到 `CreateConvertParseTask`：这条流本身就不是当前 MCP 已实现的 convert 下载路径。

### 4.2 `merge_cross_page_forms = true` 的 LateX / Word 实证

为确认 `merge_cross_page_forms = true` 不是只在 Markdown 路径中成立，又对跨页表格样本

- `/tmp/doc2x-cross-table-test.pdf`

分别执行了 LateX 与 Word 导出，并抓到了真实请求：

- LateX 证据：
  - `/tmp/doc2x-table-latex-merge-true.json`
  - 关键 payload：

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

- Word 证据：
  - `/tmp/doc2x-table-word-merge-true.json`
  - 关键 payload：

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

随后又使用当前 MCP 对同一个 `taskId = op_d80va62lb0pc73810fmg` 做默认/开启两组导出比对，结果如下：

| 格式 | `merge_cross_page_forms` | 输出文件 | 字节数 | SHA-256 |
| --- | --- | --- | --- | --- |
| LateX | `false` | `/tmp/doc2x-latex-default.zip` | `2455` | `0809760ae00d1666acc900abd81cef0858fd7edb2c53d9e3c632e43a1cf83c69` |
| LateX | `true` | `/tmp/doc2x-latex-merge.zip` | `2527` | `cf9efae1735ae33750e866c09c55aa12fc579c48006e88bcb012c7d0ec7bc88a` |
| Word | `false` | `/tmp/doc2x-word-default.docx` | `14733` | `2d707e2690a075b768d7644ee00ff08666194180fd802123f423040168816f97` |
| Word | `true` | `/tmp/doc2x-word-merge.docx` | `14667` | `f3e5f3d1350ff85ac74164317bafa9ccf62547a210264eb28e966ccc01698384` |

这说明：

- `merge_cross_page_forms = true` 在 LateX / Word 的真实网页请求中都存在
- 当前 MCP 已能成功跑通这两条导出路径
- 默认版与开启版产物在大小和哈希上都发生了变化，差异不是伪参数

## 七、直接结论

1. `PDF parse` 主链路已经有完整网页证据：
   - `CreateUploadTask`
   - OSS 表单上传
   - 上传状态轮询
   - `CreateParseTask`
   - parse 状态轮询
   - `GetObjectParseList`
   - `GetSpaceObjectSource`
   - `GetObjectParseResult`

2. `parse_version = 3` 已被真实请求确认。

3. `doc2x-v2-2410` 已在真实网页中被切换并验证，其结果对应 `parse_version = 0`。

4. `parse_model = 3` 目前只在 parse 元数据里出现，不能视为已确认请求参数。

5. 当前可正式确认的网页导出格式有三种：
   - `Markdown -> convert_to = 1 -> application/zip`
   - `LateX -> convert_to = 2 -> application/zip`
   - `Word -> convert_to = 3 -> application/vnd.openxmlformats-officedocument.wordprocessingml.document`

6. 已补充验证的 Markdown 导出变体包括：
   - `formula_mode = "dollar"`
   - `merge_cross_page_forms = true`

7. `merge_cross_page_forms = true` 已补充验证到三种正式导出格式：
   - `Markdown`
   - `LateX`
   - `Word`

8. `formula_level` 的两个 Word UI 选项
   - `行内公式变为普通文本`
   - `全部公式变为普通文本`
   已经在 live 网页中观察到，但还没有拿到可靠请求映射，因此仍不能进入正式 MCP。

9. `HTML / PDF(HTML) / 导出到MD编辑器` 仍未进入正式 HTTP 导出能力范围。

10. 因此后续 MCP 扩展最稳的顺序应为：
   - 保持 `doc2x_parse_pdf` 的正式输入边界为已验证的 `parseVersion = 0 | 3`
   - 在 `doc2x_export_parse_result` 中正式开放：
     - `markdown / latex / word`
     - `formulaMode = "normal" | "dollar"`（Markdown）
     - `mergeCrossPageForms`（当前真实验证到 `markdown / latex / word`）
   - 再继续逐项补抓 HTML、PDF(HTML)、编辑器流、`formula_level` 非默认值和图片来源变体

## 八、正式能力证据矩阵

以下矩阵用于约束 MCP 正式接口：只有“已验证”的项，才允许进入结构化工具 schema。

### 7.1 Parse 参数矩阵

| 网页项 | 真实请求证据 | 当前状态 | 进入 MCP |
| --- | --- | --- | --- |
| `parse_version = 3` | 已确认：选择 `doc2x-v3-2509-beta` 时为 `{"source_id":"...","parse_version":3}` | 已验证 | 是 |
| `parse_version = 0` | 已确认：选择 `doc2x-v2-2410` 时 `CreateParseTask` 仅发 `{"source_id":"..."}`，结果元数据真实落成 `parse_version = 0` | 已验证 | 是 |
| `parse_model` | 仅在 `GetObjectParseList.parse_param.parse_model = 3` 中出现 | 仅元数据可见 | 否 |
| `页码范围` | 页面文案和输入框可见；本轮抓包未看到它进入真实请求 | 未验证 | 否 |
| 其它解析弹窗项 | 仅页面可见 | 未验证 | 否 |

### 7.2 导出格式矩阵

| 网页导出项 | 真实请求证据 | 当前状态 | 进入 MCP |
| --- | --- | --- | --- |
| `导出Markdown` | 已确认：`convert_to = 1`，下载 MIME `application/zip` | 已验证 | 是 |
| `导出LateX` | 已确认：`convert_to = 2`，下载 MIME `application/zip` | 已验证 | 是 |
| `导出Word` | 已确认：`convert_to = 3`，下载 MIME `application/vnd.openxmlformats-officedocument.wordprocessingml.document` | 已验证 | 是 |
| `导出HTML` | 仅页面可见 | 未验证 | 否 |
| `导出PDF(HTML)` | 页面可见，但当前抓包更像跳入编辑器流 | 未验证 | 否 |
| `导出到MD编辑器` | 页面可见，当前未观察到网络请求 | 未验证 | 否 |

### 7.3 导出参数矩阵

| 字段 | 真实请求证据 | 当前状态 | 进入 MCP |
| --- | --- | --- | --- |
| `parse_id` | 已确认在 `CreateConvertParseTask` 中发送 | 已验证 | MCP 内部使用 |
| `convert_to = 1` | 已确认 | 已验证 | 是，对应 Markdown |
| `convert_to = 2` | 已确认 | 已验证 | 是，对应 LateX |
| `convert_to = 3` | 已确认 | 已验证 | 是，对应 Word |
| `filename` | 已确认 | 已验证 | MCP 内部使用，可由输出文件名派生 |
| `formula_mode = "normal"` | 已确认默认值，适用于 Markdown/LateX/Word | 默认值已验证 | 是，当前可作为 Markdown 导出默认值 |
| `formula_mode = "dollar"` | 已确认非默认值，适用于 Markdown | 已验证 | 是，但当前只应在 Markdown 导出中开放 |
| `merge_cross_page_forms = false` | 已确认默认值，适用于 Markdown/LateX/Word | 默认值已验证 | 是 |
| `merge_cross_page_forms = true` | 已确认非默认值，适用于 Markdown/LateX/Word | 已验证 | 是 |
| `formula_level = 0` | 已确认默认值，适用于 Markdown/LateX/Word | 默认值已验证 | 先内部固定 |
| `formula_level != 0` | 当前仅在 Word 弹窗中观察到 `行内公式变为普通文本 / 全部公式变为普通文本`，未抓到真实请求 | 未验证 | 否 |
| `图片来源 本地图片` | 已确认：默认 Markdown 导出走 convert 链路，zip 内含 `images/` 目录，Markdown 改写为相对路径图片引用 | 默认语义已验证 | 先内部固定默认（Markdown） |
| `图片来源 在线图床` | 已确认：点击导出后只请求 `GetObjectParseResult`，浏览器直接下载 `.md`，其中保留 `cdn.noedgeai.com` 远程图片 URL | 语义已验证，但不是当前 HTTP convert 链路 | 否，若要支持需单独实现 browser-backed flow |
| `清除注释信息` | 仅在 `在线图床` 变体中观察到 | 未验证 | 否 |
| `代码缩进兼容性增强` | 仅在 `在线图床` 变体中观察到 | 未验证 | 否 |

### 7.4 下载产物矩阵

| 项目 | 真实证据 | 结论 |
| --- | --- | --- |
| 下载链路 | `CreateConvertParseTask -> GetConvertTaskStatus -> GET convert URL` | 已验证 |
| Markdown 导出 MIME | `application/zip` | 已验证 |
| LateX 导出 MIME | `application/zip` | 已验证 |
| Word 导出 MIME | `application/vnd.openxmlformats-officedocument.wordprocessingml.document` | 已验证 |
| Markdown 导出 `content-length` | `317`（本次测试样本） | 已验证 |
| LateX 导出 `content-length` | `931`（本次测试样本） | 已验证 |
| Word 导出 `content-length` | `12494`（本次测试样本） | 已验证 |
| 是否为裸 `.md` 文件 | 否 | 当前 Markdown 网页导出应按 zip 包处理 |
