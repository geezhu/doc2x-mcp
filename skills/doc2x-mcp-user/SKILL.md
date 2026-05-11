---
name: doc2x-mcp-user
description: >
  Use the Doc2X subscription MCP in
  /home/oliviero/AgenticProjects/textbook/doc2x to authenticate through the
  managed browser flow, parse local PDFs, fetch Markdown results, and export
  verified result formats. Use when a user wants to operate the Doc2X MCP
  rather than maintain it.
---

# Doc2X MCP User

Use this skill when the task is to operate the existing Doc2X MCP as an end user.

## What This Skill Covers

- import an already logged-in Doc2X browser session
- authenticate through a managed Doc2X browser profile in one step
- parse one local PDF with `doc2x_parse_pdf`
- fetch parse status with `doc2x_get_parse_status`
- fetch Markdown text with `doc2x_get_parse_markdown`
- export verified result formats with `doc2x_export_parse_result`

Do not use this skill for:

- reverse engineering new Doc2X webpage behavior
- widening MCP schemas
- deciding whether a new parameter or export format is formally supported

Those are maintenance tasks, not user-operation tasks.

## Tool Catalog

## Common Response Field Meanings

These meanings apply across multiple Doc2X MCP tools.

- `ok`
  - whether the tool call completed as a successful business result
- `taskId`
  - Doc2X task identifier for the current workflow
  - for parse flows, usually the parse task id
- `parseId`
  - parse-result identifier
  - often equal to `taskId` for parse flows
- `objectId`
  - Doc2X space object identifier for the uploaded document/result object
- `sourceId`
  - upload task output id for the source file before parse starts
- `exportTaskId`
  - convert/export task identifier created by `CreateConvertParseTask`
- `parseVersion`
  - verified parse version variant used for the parse
  - `0` maps to webpage `doc2x-v2-2410`
  - `3` maps to webpage `doc2x-v3-2509-beta`
- `status`
  - normalized task state returned by this MCP
  - possible values:
    - `unknown`
    - `none`
    - `pending`
    - `success`
    - `failed`
- `rawStatus`
  - original Doc2X numeric task status before MCP normalization
- `progress`
  - numeric progress reported by Doc2X, usually `0` to `100`
- `timedOut`
  - whether the MCP stopped waiting before the task reached a terminal state
- `reason`
  - failure or timeout explanation when `ok = false` or the task does not succeed
- `resultMeta`
  - structured enrichment collected after parse success
- `raw`
  - raw upstream responses and intermediate snapshots kept for debugging
- `outputPath`
  - local path written by the tool
- `wroteFile`
  - whether the tool actually wrote a local file
- `warnings`
  - non-fatal issues or caveats detected by the MCP

### Session and login tools

#### `doc2x_auth_browser`

Recommended default authentication path.

Use when the user wants the MCP to manage a dedicated Chrome/Chromium profile and automatically import the resulting Doc2X session.

Parameters:

- `timeoutMs?`
  - optional positive integer milliseconds
  - default `300000`
- `executablePath?`
  - optional Chrome/Chromium executable path
- `profileDir?`
  - optional managed browser profile directory
- `debugPort?`
  - optional Chrome DevTools port
- `notes?`
  - optional session notes persisted with the imported session

Response format:

- `ok`
  - whether authentication completed as a successful business result
- `authenticated`
  - whether the imported browser session passed real Doc2X API probing
- `openedBrowser`
  - whether this invocation had to open a visible browser window
- `reusedManagedProfile`
  - whether the tool reused an existing managed profile/browser state instead of requiring a fresh visible login
- `timedOut`
  - whether the tool stopped waiting before authentication succeeded
- `debugBaseUrl`
  - DevTools endpoint used for the managed browser
- `profileDir`
  - managed browser profile directory
- `pageUrl?`
  - Doc2X page URL captured from the authenticated browser page
- `captured?`
  - same session-capture summary shape used by `doc2x_import_browser_session`
- `persistedSession?`
  - final persisted `.doc2x/session.json` summary after successful auth
- `reason?`
  - timeout or failure explanation
- `raw?`
  - debugging snapshots, including probe details

Recommended interpretation:

- `ok = true` and `authenticated = true`
  - browser auth succeeded and the MCP session is ready for parse/export calls
- `ok = false` and `timedOut = true`
  - the managed browser is still the continuation anchor
  - finish the login in that browser, then call `doc2x_auth_browser` again
- `openedBrowser = false` and `reusedManagedProfile = true`
  - the tool silently reused an existing managed profile/browser state

#### `doc2x_session_get`

Use to inspect current persisted session state.

Parameters:

- none

Response format:

- `hasBearerToken`
  - whether a bearer token is currently stored
- `hasRefreshToken`
  - whether a refresh token is currently stored
- `defaultHeaders`
  - default headers persisted with the session
- `cookieCount`
  - number of stored cookies
- `cookieDomains`
  - distinct cookie domains currently stored
- `updatedAt`
  - last local session update time
- `notes`
  - optional persisted session notes

#### `doc2x_import_browser_session`

Advanced / maintenance path.

Use when the user is already logged into Doc2X in some separate Chrome or Chromium instance and wants to import that session directly.

Parameters:

- `debugBaseUrl?`
  - Chrome DevTools base URL
  - usually omit and use the default
- `preferPageUrl?`
  - optional preferred Doc2X page URL
- `persist?`
  - default `true`
- `clearExisting?`
  - default `true`
- `notes?`

Response format:

- `debugBaseUrl`
  - DevTools base URL used for import
- `pageTargetId`
  - Chrome DevTools target id used during capture
- `pageUrl`
  - Doc2X page URL used as the capture source
- `captured`
  - `hasBearerToken`
  - `hasRefreshToken`
  - `defaultHeaders`
  - `cookieCount`
  - `cookieDomains`
- `localStorageKeys`
  - localStorage keys observed on the page
- `sessionStorageKeys`
  - sessionStorage keys observed on the page
- `userInfo?`
  - parsed user-related storage state when available
- `subscriptionInfo?`
  - parsed subscription-related storage state when available
- `persistedSession?`
  - final persisted session summary if `persist = true`

#### `doc2x_session_set`

Manual fallback when managed-browser auth and browser-session import are unavailable.

Parameters:

- `cookieHeader?`
- `bearerToken?`
- `refreshToken?`
- `defaultHeaders?`
- `clearExisting?`
- `notes?`

Response format:

- same summary shape as `doc2x_session_get`

#### `doc2x_session_clear`

Use to remove the locally persisted Doc2X session.

Parameters:

- none

Response format:

- `cleared`
  - `true` after local session removal

### Main user workflow tools

#### `doc2x_parse_pdf`

Parse one local PDF through the Doc2X subscription flow.

Parameters:

- `filePath`
  - absolute local PDF path
- `timeoutMs?`
  - positive integer milliseconds
- `parseVersion?`
  - verified values only:
    - `0`
    - `3`

Response format:

- `ok`
  - whether the parse flow completed successfully
- `filePath?`
  - input PDF path used by the tool
- `fileName?`
  - basename derived from `filePath`
- `sourceId?`
  - upload-stage output id returned by `CreateUploadTask`
- `taskId?`
  - parse task id returned by `CreateParseTask`
- `parseId?`
  - parse identifier used to fetch parse details/results
- `objectId?`
  - object identifier for the parsed document in Doc2X space storage
- `parseVersion?`
  - verified parse version variant used for this task
- `status`
  - `unknown`
  - `none`
  - `pending`
  - `success`
  - `failed`
- `rawStatus?`
  - original Doc2X numeric task status
- `progress?`
  - upstream task progress value
- `timedOut`
  - whether the MCP stopped waiting before terminal completion
- `reason?`
  - explanation for failure or timeout
- `resultMeta?`
  - structured parse enrichment block
  - typically includes:
    - `spaceObject`
      - file/object metadata
    - `parseDetail`
      - parse task metadata
    - `parseResult`
      - full parse result object
    - `parseListEntry`
      - latest parse list item chosen by the MCP
- `raw`
  - raw request/response snapshots used to build the normalized result

#### `doc2x_get_parse_status`

Recover or inspect a parse task.

Parameters:

- `taskId?`
- `objectId?`

Provide at least one of them.

Response format:

- same core task/result shape as `doc2x_parse_pdf`
- typically includes:
  - `ok`
  - `taskId?`
    - task id used to query status
  - `parseId?`
    - resolved parse id
  - `objectId?`
    - resolved object id
  - `status`
    - normalized current task state
  - `rawStatus?`
    - upstream numeric state
  - `progress?`
    - upstream progress
  - `timedOut`
    - always meaningful for status snapshots and recovery responses
  - `reason?`
    - explanation when the task is not successful
  - `resultMeta?`
    - same enrichment family used by `doc2x_parse_pdf`
  - `raw`
    - raw snapshots used to derive the status result

#### `doc2x_get_parse_markdown`

Fetch merged Markdown and page-level Markdown for a finished parse.

Parameters:

- `taskId?`
- `objectId?`
- `outputPath?`
  - optional absolute local `.md` path

Provide `taskId` or `objectId`.

Response format:

- `ok`
- `ok`
  - whether Markdown extraction succeeded
- `taskId?`
  - source task id
- `parseId?`
  - resolved parse id used for Markdown extraction
- `objectId?`
  - resolved object id used for Markdown extraction
- `status`
  - normalized upstream status
- `rawStatus?`
  - original Doc2X numeric status
- `progress?`
  - upstream progress
- `timedOut`
  - whether the upstream task timed out before success
- `reason?`
  - explanation when Markdown is unavailable
- `markdown?`
  - merged Markdown text for the whole document
- `pages?`
  - page-level Markdown breakdown
  - array of:
    - `pageIndex`
      - zero-based page index from Doc2X parse result
    - `markdown`
      - Markdown extracted for that page
- `pageCount?`
  - number of page entries returned by the helper
- `outputPath?`
  - written local `.md` path if requested
- `wroteFile`
  - whether a local Markdown file was written
- `warnings`
  - non-fatal parse/format anomalies
- `raw`
  - raw parse snapshots used for extraction

#### `doc2x_export_parse_result`

Run the verified browser-parity export flow and download the final artifact.

Parameters:

- `taskId?`
- `objectId?`
- `exportFormat?`
  - verified values:
    - `markdown`
    - `latex`
    - `word`
- `formulaMode?`
  - currently formal only for `exportFormat = "markdown"`
  - verified values:
    - `normal`
    - `dollar`
- `mergeCrossPageForms?`
  - boolean
  - browser-verified `true` path exists for:
    - `markdown`
    - `latex`
    - `word`
- `outputPath`
  - absolute local output path
  - use:
    - `.zip` for `markdown`
    - `.zip` for `latex`
    - `.docx` for `word`

Provide `taskId` or `objectId`.

Response format:

- `ok`
- `ok`
  - whether export completed successfully
- `taskId?`
  - originating parse task id
- `parseId?`
  - parse id exported
- `objectId?`
  - originating object id
- `exportTaskId?`
  - convert task id returned by `CreateConvertParseTask`
- `exportFormat`
  - selected export format
- `status`
  - normalized export task state
- `rawStatus?`
  - original Doc2X numeric export task status
- `progress?`
  - upstream export progress
- `timedOut`
  - whether export polling timed out
- `reason?`
  - explanation when export fails
- `outputPath`
  - local artifact path requested by the caller
- `wroteFile`
  - whether the artifact was written locally
- `downloadUrl?`
  - final convert download URL returned by Doc2X
- `contentType?`
  - downloaded artifact MIME type
- `byteLength?`
  - downloaded artifact size in bytes
- `warnings`
  - non-fatal export caveats
- `raw`
  - raw convert-task and download snapshots

Verified export boundary:

- `markdown`
  - default browser payload:
    - `formula_mode = "normal"`
    - `merge_cross_page_forms = false`
    - `formula_level = 0`
  - additionally verified Markdown override:
    - `formula_mode = "dollar"`
    - `merge_cross_page_forms = true`
- `latex`
  - default browser payload:
    - `formula_mode = "normal"`
    - `merge_cross_page_forms = false`
    - `formula_level = 0`
  - additionally verified LateX override:
    - `merge_cross_page_forms = true`
- `word`
  - default browser payload:
    - `formula_mode = "normal"`
    - `merge_cross_page_forms = false`
    - `formula_level = 0`
  - additionally verified Word override:
    - `merge_cross_page_forms = true`

Do not promise:

- non-default `formula_level`
- Word-only `退化公式级别` variants such as `行内公式变为普通文本` or `全部公式变为普通文本`
- image-source variants such as `在线图床`
- the extra `在线图床`-only toggles

### Account and inspection tools

#### `doc2x_get_account_bundle`

Fetch profile, quota, subscription, and product list.

Parameters:

- none

Response format:

- object with:
  - `profile`
    - summarized profile HTTP response
  - `quota`
    - summarized quota HTTP response
  - `subscription`
    - summarized subscription HTTP response
  - `products`
    - summarized product-list HTTP response

Each entry is a summarized HTTP response object, not a flattened business object.

#### `doc2x_surface_catalog`

Inspect observed Doc2X routes, endpoint families, and capability surface.

Parameters:

- `includeRestEndpoints?`
- `includeGatewayEndpoints?`
- `includeV2cEndpoints?`

Response format:

- `routes`
  - observed webpage route list
- `capabilities`
  - observed feature/capability list
- `restEndpoints?`
  - known REST endpoint map when requested
- `gatewayEndpoints?`
  - known gateway endpoint families when requested
- `v2cEndpoints?`
  - known `v2c` endpoint map when requested

### Advanced and debug tools

These are not the default user path. Use them only when the user explicitly needs raw inspection or an uncovered flow.

#### `doc2x_request`

Raw HTTP request tool.

Common parameters:

- `target?`
  - `web`
  - `v2c`
  - `absolute`
- `path?`
- `absoluteUrl?`
- `method?`
  - `GET`
  - `POST`
  - `PUT`
  - `PATCH`
  - `DELETE`
- `payload?`
- `bodyText?`
- `headers?`
- `responseType?`
  - `auto`
  - `json`
  - `text`
  - `base64`

Upload-related parameters:

- `filePath?`
- `fileFieldName?`
- `fileContentType?`
- `formFields?`

Session behavior parameters:

- `includeSessionAuth?`
- `includeSessionCookies?`
- `allowRefresh?`
- `originOverride?`
- `refererOverride?`

Response format:

- summarized raw HTTP snapshot, typically including:
  - `ok`
    - request success indicator
  - `status`
    - HTTP status code
  - `headers`
    - response headers
  - `body`
    - parsed or raw response body
  - request metadata
    - request target/path/method related fields

#### `doc2x_browser_fallback_plan`

Use when the user asks whether a flow is better handled by HTTP, browser, or mixed mode.

Parameters:

- `flow`

Response format:

- `flow`
- `flow`
  - flow name passed in by the caller
- `recommendedMode`
  - `http`
  - `browser`
  - `mixed`
- explanatory fields describing why
  - reason and tradeoff summary for the recommendation

#### Gateway raw-operation tools

Use only for advanced inspection or uncovered behavior:

- `doc2x_create_task`
  - parameters:
    - `operation`
    - `payload`
- `doc2x_space_operation`
  - parameters:
    - `operation`
    - `payload`
- `doc2x_pay_operation`
  - parameters:
    - `operation`
    - `payload`
- `doc2x_user_gateway_operation`
  - parameters:
    - `operation`
    - `payload`
- `doc2x_util_operation`
  - parameters:
    - `operation`
    - `payload`

## Default User Flow

### 1. Check or import session

First inspect the current session:

- `doc2x_session_get`

If there is no usable bearer token or the user says they are logged into Doc2X in Chrome, import the browser session:

- `doc2x_import_browser_session`

Only fall back to manual session injection if browser import is not available:

- `doc2x_session_set`

### 2. Parse a local PDF

Primary tool:

- `doc2x_parse_pdf`

Minimum input:

- `filePath`

Verified optional input:

- `parseVersion`
  - `0`
  - `3`

Use defaults unless the user explicitly asks for the older verified PDF model path.

Interpretation:

- `parseVersion = 3`
  - webpage-equivalent `doc2x-v3-2509-beta`
- `parseVersion = 0`
  - webpage-equivalent `doc2x-v2-2410`

### 3. Recover or inspect status

If the parse request timed out or the user wants to inspect a finished task:

- `doc2x_get_parse_status`

Preferred input:

- `taskId`

Fallback input:

- `objectId`

### 4. Get Markdown text

Use:

- `doc2x_get_parse_markdown`

Inputs:

- `taskId` or `objectId`
- optional `outputPath`

Behavior:

- returns merged Markdown
- returns page-level `pages`
- optionally writes a local `.md` file

### 5. Export final artifacts

Use:

- `doc2x_export_parse_result`

Inputs:

- `taskId` or `objectId`
- `exportFormat`
- `outputPath`

Currently verified export formats:

- `markdown`
  - write to `.zip`
- `latex`
  - write to `.zip`
- `word`
  - write to `.docx`

Do not request unverified formats through this skill:

- `html`
- `pdf(html)`
- `导出到MD编辑器`

## Output Rules

When using this MCP for a user:

1. Prefer high-level tools over raw gateway calls.
2. Return the important IDs:
   - `taskId`
   - `parseId`
   - `objectId`
3. Mention what local file was written when an export or Markdown file is produced.
4. If a requested option is not formally verified, say so and do not pretend it is supported.

## Verified Boundaries

Formally supported parse inputs:

- `parseVersion = 0`
- `parseVersion = 3`

Formally supported export formats:

- `markdown`
- `latex`
- `word`

Not formally supported yet:

- `parseModel`
- `pageRange`
- non-default export option variants
- `html`
- `pdf(html)`
- `导出到MD编辑器`

## When To Read More

If you need exact evidence or capability boundaries, read:

- `references/verified-usage.md`

If the user asks for maintenance, browser verification, or new format support, stop using this skill alone and switch to the maintenance workflow instead.
