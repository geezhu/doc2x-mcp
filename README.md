# Doc2X Subscription MCP

An MCP server scaffold for driving the Doc2X web subscription surface through the same web endpoints used by `https://doc2x.noedgeai.com/`.

## Status

This project is designed around observed public route and bundle metadata from the Doc2X web app, plus verified logged-in browser traffic:

- REST-style endpoints such as `/user/*`, `/pay/*`, `/product/list`, `/term/user/*`
- Gateway endpoints such as `/gateway.v1.TaskService/CreateParseTask`
- Verified web-session API traffic against `https://v2c.doc2x.noedgeai.com`
- Mixed account, task, parse/translate result, billing, and history flows
- Browser-only or captcha-gated flows are modeled with fallback hooks

The first version is HTTP-first:

- Reuses imported cookies / bearer tokens
- Can authenticate through a managed browser profile in one step
- Can import a live session directly from a Chrome DevTools endpoint
- Persists session state locally under `.doc2x/session.json`
- Exposes both high-level tools and raw endpoint calls for uncovered flows
- Automatically refreshes the web token once with `refreshToken` and persists the refreshed session

## Current Coverage

- End-to-end HTTP `PDF parse-only` workflow for one local file:
  - `CreateUploadTask`
  - multipart upload to the returned object-storage URL
  - `CreateParseTask`
  - `GetTaskStatus` polling
  - `GetObjectParse`, `GetObjectParseList`, `GetObjectParseResult`, and `GetSpaceObject` enrichment
- Browser-verified `parseVersion` exposure on `doc2x_parse_pdf` for both verified PDF parser variants
- One-step managed browser auth with silent reuse, visible-browser fallback, session probe, and local session persistence
- Parse status recovery by `taskId` or `objectId`
- Markdown result consumption by `taskId` or `objectId`, including optional local `.md` export
- Browser-verified web export flow for the currently confirmed formats:
  - `CreateConvertParseTask`
  - `GetConvertTaskStatus`
  - download from the returned convert URL to a local absolute path
- Session import / update / clear
- Password login, SMS-code login, SMS-code request
- Profile, quota, subscription, and product list lookup
- TaskService gateway calls for parse / translate / upload / image-related tasks
- SpaceService gateway calls for parse / translate result inspection
- Pay / Invoice / Refund gateway calls
- User gateway calls (OAuth, phone binding, unregister, WeChat unbind)
- Utility gateway calls (changelog, announcements, transfer records)
- Raw HTTP requests to:
  - `https://doc2x.noedgeai.com`
  - `https://v2c.doc2x.noedgeai.com`
  - arbitrary absolute URLs
- Browser fallback planning for captcha / login / PPT / online-save flows

## Tools

- `doc2x_surface_catalog`
- `doc2x_auth_browser`
- `doc2x_session_get`
- `doc2x_session_set`
- `doc2x_import_browser_session`
- `doc2x_session_clear`
- `doc2x_login_password`
- `doc2x_login_code`
- `doc2x_send_sms_code`
- `doc2x_get_account_bundle`
- `doc2x_parse_pdf`
- `doc2x_get_parse_status`
- `doc2x_get_parse_markdown`
- `doc2x_export_parse_result`
- `doc2x_create_task`
- `doc2x_space_operation`
- `doc2x_pay_operation`
- `doc2x_user_gateway_operation`
- `doc2x_util_operation`
- `doc2x_request`
- `doc2x_browser_fallback_plan`

## Session Strategy

The server is HTTP-first and now has a recommended one-step browser-auth path.

Recommended path:

1. Call `doc2x_auth_browser`.
2. The tool first tries silent reuse of the managed browser profile.
3. If silent reuse does not produce a valid authenticated session, it opens a visible Chrome/Chromium window for manual Doc2X login.
4. The tool automatically imports `cookie + bearer token + refresh token + default headers`.
5. The tool probes the real Doc2X account APIs and only persists the session if probing succeeds.

Key verified behavior:

- A managed browser profile is kept as a long-lived authentication anchor.
- Successful browser auth rewrites `.doc2x/session.json` with `clearExisting = true`.
- If login is not completed before timeout, the tool returns `timedOut = true` and the same tool can be called again to continue.
- If a running managed browser is already available and `debugPort` is known, `doc2x_auth_browser` can attach to that endpoint directly without opening a new window.

Advanced / maintenance paths:

1. If the user already has some separate logged-in Chrome or Chromium instance, call `doc2x_import_browser_session`.
2. If no browser import is possible, copy the cookie header or capture the relevant bearer token and call `doc2x_session_set`.

Session data is persisted to `.doc2x/session.json`.

The verified web app pattern is:

- Requests go to `https://v2c.doc2x.noedgeai.com`
- Auth is sent as `Authorization: Bearer <token>`
- Browser-originated requests keep `Origin` and `Referer` set to `https://doc2x.noedgeai.com/`
- Verified default API headers on `v2c` traffic are:
  - `x-doc2x-api-version: 2025-06-04`
  - `x-doc2x-error-format: v2`

## Phase 1 Parse Workflow

The current implementation deliberately freezes scope to the first executable slice of the web subscription product:

- Pure HTTP at runtime
- Session bootstrap by importing an already logged-in browser session
- Single local PDF input only
- Default web parse configuration
- Structured result with normalized `task/object/result metadata`, plus `raw` snapshots for debugging

`doc2x_parse_pdf` follows the request sequence recovered from live logged-in browser traffic:

1. `GET /v2/user/profile`
2. `POST /gateway.v1.TaskService/CreateUploadTask` with `{ "filename": "<name>.pdf" }`
3. `POST <returned upload url>` with the returned `form_data` plus multipart `file`
4. `POST /gateway.v1.TaskService/CreateParseTask` with the uploaded source id and parse version
5. `POST /gateway.v1.TaskService/GetTaskStatus` until success, failure, or timeout
6. On success, enrich with:
   - `GetObjectParse`
   - `GetObjectParseList`
   - `GetObjectParseResult`
   - `GetSpaceObject`
   - `GetSpaceObjectList` as the same fallback the web frontend uses when it needs the newest object

`doc2x_get_parse_status` is the minimal recovery tool for tasks that timed out in the blocking flow.

`doc2x_get_parse_markdown` consumes the completed parse result and returns:

- merged Markdown text
- `pages: { pageIndex, markdown }[]`
- `pageCount`
- `warnings`
- optional `outputPath` / `wroteFile`

The merged Markdown preserves explicit page boundaries with markers such as `<!-- page: 1 -->`, keeps empty pages, and surfaces parse-result anomalies through warnings instead of silently dropping them.

The parse tool now formally exposes the only parse request parameter that is currently browser-verified:

- `parseVersion`
  - currently `0` and `3` are accepted as formal input values
  - verified `doc2x-v3-2509-beta` behavior:
    - `{"source_id":"...","parse_version":3}`
  - verified `doc2x-v2-2410` behavior:
    - `{"source_id":"..."}`
    - and the resulting `GetObjectParseList.parse_param.parse_version` is `0`
  - other parse-dialog options are not yet exposed until they are captured and re-validated from real browser traffic

## Verified Export Workflow

`doc2x_export_parse_result` is the browser-parity export tool for completed parse results.

Current verified scope:

- accepts `taskId` or `objectId`
- resolves `parseId` internally
- runs:
  - `CreateConvertParseTask`
  - `GetConvertTaskStatus`
  - `GET <convert url>`
- writes the downloaded artifact to a local absolute `outputPath`
- returns structured metadata including:
  - `taskId`
  - `objectId`
  - `parseId`
  - `exportTaskId`
  - `downloadUrl`
  - `outputPath`
  - `wroteFile`
  - `contentType`
  - `byteLength`
  - `warnings`

Current formally supported export formats:

- `markdown`
  - verified browser payload:
    - `{"parse_id":"...","formula_mode":"normal","convert_to":1,"filename":"doc2x-test","merge_cross_page_forms":false,"formula_level":0}`
  - additionally browser-verified Markdown override payload:
    - `{"parse_id":"...","formula_mode":"dollar","convert_to":1,"filename":"doc2x-test","merge_cross_page_forms":true,"formula_level":0}`
  - formal MCP inputs now include:
    - `formulaMode = "normal" | "dollar"` for `exportFormat = "markdown"`
    - `mergeCrossPageForms = true | false`
  - verified downloaded artifact type:
    - `application/zip`
  - because the confirmed browser download is a zip package, `outputPath` currently must end in `.zip`
- `latex`
  - verified browser payload:
    - `{"parse_id":"...","formula_mode":"normal","convert_to":2,"filename":"doc2x-test","merge_cross_page_forms":false,"formula_level":0}`
  - verified non-default browser payload:
    - `{"parse_id":"...","formula_mode":"normal","convert_to":2,"filename":"doc2x-cross-table-test","merge_cross_page_forms":true,"formula_level":0}`
  - verified downloaded artifact type:
    - `application/zip`
  - the verified artifact is a zip package, so `outputPath` must end in `.zip`
- `word`
  - verified browser payload:
    - `{"parse_id":"...","formula_mode":"normal","convert_to":3,"filename":"doc2x-test","merge_cross_page_forms":false,"formula_level":0}`
  - verified non-default browser payload:
    - `{"parse_id":"...","formula_mode":"normal","convert_to":3,"filename":"doc2x-cross-table-test","merge_cross_page_forms":true,"formula_level":0}`
  - verified downloaded artifact type:
    - `application/vnd.openxmlformats-officedocument.wordprocessingml.document`
  - the verified artifact is a `.docx` file, so `outputPath` must end in `.docx`

This is intentionally narrower than the full web dialog. The currently exposed advanced export knobs are:

- `formulaMode`
  - only formal for `markdown`
  - currently verified values:
    - `"normal"`
    - `"dollar"`
- `mergeCrossPageForms`
  - browser-verified as `true` for `markdown / latex / word`
  - default `false` is also verified for `markdown / latex / word`

The following still remain outside the formal MCP schema until they are individually captured and validated from real browser requests:

- `HTML`
- `PDF(HTML)`
- non-default `formula_level`
- browser-only image-source flows such as `在线图床`
- the extra `在线图床`-only toggles currently visible in the web dialog
- Word-only `退化公式级别` UI variants such as `行内公式变为普通文本` and `全部公式变为普通文本`

Confirmed live behaviors from the first successful end-to-end run:

- Current gateway responses use `code: "success"` plus snake_case payload keys such as `output_id`, `form_data`, `object_parse_list`, and `object_id`
- The first `CreateParseTask` immediately after upload can transiently return `404 not_found`; the MCP retries this step automatically before failing
- A real parse result was validated with a one-page local PDF and returned Markdown content from `GetObjectParseResult`
- The Markdown result consumer was validated against the same fresh parse task and wrote a local `.md` file whose content exactly matched the returned `markdown` field
- A real browser-parity export run was validated against the same parse result and downloaded a zip artifact through `CreateConvertParseTask -> GetConvertTaskStatus -> convert URL`
- Additional browser-verified export runs confirmed:
  - `LateX -> convert_to = 2 -> application/zip`
  - `Word -> convert_to = 3 -> application/vnd.openxmlformats-officedocument.wordprocessingml.document`
- A real raster-image verification confirmed the image-source split:
  - default `本地图片` Markdown export localizes images into a zip `images/` directory and rewrites Markdown to relative image paths
  - `在线图床` does not use the convert HTTP chain; the browser directly downloads a `.md` file built from `GetObjectParseResult`, preserving `cdn.noedgeai.com` image URLs

## Known Gaps

- Captcha-gated flows may need an interactive browser session.
- This phase intentionally excludes translate, image parse, PPT / drawing-board, online-save integrations, and batch orchestration.
- PPT generator and drawing-board editing appear to rely on browser-local state.
- Third-party online-save flows may require OAuth/browser handoff.
- Only browser-verified parse/export parameters are formal MCP inputs. The rest of the visible web dialog remains intentionally unimplemented until captured with real browser evidence.

## Development

```bash
npm install
npm run dev
npm run build
npm run verify:mcp
```

Online verification, including managed-browser auth reuse, a real account bundle probe, and one local PDF parse run:

```bash
npm run verify:mcp -- --online --pdf /abs/path/to/file.pdf
```

Optional verifier argument when the managed browser profile lives somewhere non-default:

```bash
npm run verify:mcp -- --online --pdf /abs/path/to/file.pdf --browser-profile /abs/path/to/profile
```
