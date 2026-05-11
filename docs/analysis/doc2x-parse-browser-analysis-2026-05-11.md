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
| `merge_cross_page_forms = false` | 已验证 | 已验证 | 已验证 | 未抓到 | 未抓到 | 未抓到 | 只验证默认值 |
| `formula_level = 0` | 已验证 | 已验证 | 已验证 | 未抓到 | 未抓到 | 未抓到 | 只验证默认值 |
| `图片来源 本地图片` | UI 可见 | UI 可见 | UI 可见 | UI 可见 | UI 可见 | UI 可见 | 仅 UI 可见，未验证请求映射 |

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

当前还没有单独切换并验证这些导出选项的“非默认值”：

- `merge_cross_page_forms = true`
- `formula_mode` 的其它取值
- `formula_level` 的其它取值
- `图片来源` 的其它取值

所以这些项虽然在网页中可见，但目前只适合作为“已观察到的 UI 表面”，还不该当成正式 MCP 输入参数。

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

6. `HTML / PDF(HTML) / 导出到MD编辑器` 仍未进入正式 HTTP 导出能力范围。

7. 因此后续 MCP 扩展最稳的顺序应为：
   - 让 `doc2x_parse_pdf` 正式开放已验证的 `parseVersion = 0 | 3`
   - 把 `doc2x_export_parse_result` 扩展到 `markdown / latex / word`
   - 再继续逐项补抓 HTML、PDF(HTML)、编辑器流和导出参数变体

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
| `formula_mode = "normal"` | 已确认默认值，适用于 Markdown/LateX/Word | 默认值已验证，改值未验证 | 先内部固定 |
| `merge_cross_page_forms = false` | 已确认默认值，适用于 Markdown/LateX/Word | 默认值已验证，改值未验证 | 先内部固定 |
| `formula_level = 0` | 已确认默认值，适用于 Markdown/LateX/Word | 默认值已验证，改值未验证 | 先内部固定 |
| `图片来源 本地图片` | 页面可见 | 未验证 | 否 |

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
