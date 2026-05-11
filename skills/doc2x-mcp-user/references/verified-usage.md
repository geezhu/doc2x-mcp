# Verified Usage Boundary

## Quick Tool Index

Primary user tools:

- `doc2x_auth_browser`
- `doc2x_session_get`
- `doc2x_import_browser_session`
- `doc2x_parse_pdf`
- `doc2x_get_parse_status`
- `doc2x_get_parse_markdown`
- `doc2x_export_parse_result`

Useful supporting tools:

- `doc2x_get_account_bundle`
- `doc2x_surface_catalog`

Advanced/raw tools:

- `doc2x_request`
- `doc2x_create_task`
- `doc2x_space_operation`
- `doc2x_pay_operation`
- `doc2x_user_gateway_operation`
- `doc2x_util_operation`

## Common Field Meanings

- `taskId`
  - current Doc2X task id
- `parseId`
  - parse result id
- `objectId`
  - Doc2X object id for the parsed document/result
- `sourceId`
  - upload-stage source id before parse begins
- `exportTaskId`
  - convert/export task id
- `rawStatus`
  - original Doc2X numeric status
- `timedOut`
  - MCP stopped waiting before a terminal result
- `authenticated`
  - managed-browser auth successfully imported a session and passed a real API probe
- `openedBrowser`
  - the auth tool launched a visible browser during this invocation
- `reusedManagedProfile`
  - the auth tool reused an existing managed browser profile or running managed browser state
- `resultMeta`
  - structured enrichment assembled by the MCP after parse completion
- `raw`
  - raw upstream payload snapshots kept for debugging and auditing

### Session summary tools

`doc2x_auth_browser` returns:

- `ok`
- `authenticated`
- `openedBrowser`
- `reusedManagedProfile`
- `timedOut`
- `debugBaseUrl`
- `profileDir`
- `pageUrl?`
- `captured?`
- `persistedSession?`
- `reason?`
- `raw`

`doc2x_session_get` and `doc2x_session_set` return:

- `hasBearerToken`
- `hasRefreshToken`
- `defaultHeaders`
- `cookieCount`
- `cookieDomains`
- `updatedAt`
- `notes`

### Parse task tools

`doc2x_parse_pdf` and `doc2x_get_parse_status` return a normalized task/result object with:

- `ok`
- `taskId?`
- `parseId?`
- `objectId?`
- `parseVersion?`
- `status`
- `rawStatus?`
- `progress?`
- `timedOut`
- `reason?`
- `resultMeta?`
- `raw`

### Markdown tool

`doc2x_get_parse_markdown` adds:

- `markdown?`
- `pages?`
- `pageCount?`
- `outputPath?`
- `wroteFile`
- `warnings`

### Export tool

`doc2x_export_parse_result` adds:

- `exportTaskId?`
- `exportFormat`
- `outputPath`
- `wroteFile`
- `downloadUrl?`
- `contentType?`
- `byteLength?`
- `warnings`
- `raw`
  - includes the emitted `createConvertPayload`, which is useful when checking advanced export settings

## Parse

Recommended authentication flow:

1. Call `doc2x_auth_browser`
2. Wait for `ok = true` and `authenticated = true`
3. Use parse / markdown / export tools

Use `doc2x_import_browser_session` only when the user already has some separate logged-in Chrome/Chromium instance that should be imported directly.

Use `doc2x_parse_pdf` for one local PDF.

Verified `parseVersion` values:

- `3`
  - real webpage request sends `parse_version = 3`
- `0`
  - real webpage `doc2x-v2-2410` selection
  - real webpage request omits `parse_version`
  - resulting parse metadata lands as `parse_param.parse_version = 0`

Do not treat `parseModel` as a supported user input.

## Markdown

Use `doc2x_get_parse_markdown` when the user wants:

- merged Markdown text
- page-level Markdown
- optional `.md` file output

## Export

Use `doc2x_export_parse_result` for final browser-parity exports.

Verified formats:

- `markdown`
  - `convert_to = 1`
  - downloaded artifact is zip
  - verified advanced settings:
    - `formulaMode = "dollar"`
    - `mergeCrossPageForms = true`
- `latex`
  - `convert_to = 2`
  - downloaded artifact is zip
  - verified advanced settings:
    - `mergeCrossPageForms = true`
- `word`
  - `convert_to = 3`
  - downloaded artifact is docx
  - verified advanced settings:
    - `mergeCrossPageForms = true`

Do not promise:

- `html`
- `pdf(html)`
- `导出到MD编辑器`
- non-default `formula_level`
- Word-only `退化公式级别` variants such as `行内公式变为普通文本` / `全部公式变为普通文本`
- image-source variants such as `在线图床`
- the extra `在线图床`-only toggles

unless they have been separately re-verified and added to the MCP schema.
