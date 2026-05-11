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
- Parse status recovery by `taskId` or `objectId`
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
- `doc2x_create_task`
- `doc2x_space_operation`
- `doc2x_pay_operation`
- `doc2x_user_gateway_operation`
- `doc2x_util_operation`
- `doc2x_request`
- `doc2x_browser_fallback_plan`

## Session Strategy

The server is HTTP-first and works best when you import a real browser session:

1. Launch Chrome or Chromium with a DevTools remote debugging port.
2. Log into Doc2X in that browser profile.
3. Call `doc2x_import_browser_session`.
4. Use the structured tools or `doc2x_request`.

Manual fallback:

1. Log into Doc2X in a browser if needed.
2. Copy the cookie header or capture the relevant bearer token.
3. Call `doc2x_session_set`.
4. Use the structured tools or `doc2x_request`.

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

`doc2x_parse_pdf` follows the request sequence recovered from the live web bundles:

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

Confirmed live behaviors from the first successful end-to-end run:

- Current gateway responses use `code: "success"` plus snake_case payload keys such as `output_id`, `form_data`, `object_parse_list`, and `object_id`
- The first `CreateParseTask` immediately after upload can transiently return `404 not_found`; the MCP retries this step automatically before failing
- A real parse result was validated with a one-page local PDF and returned Markdown content from `GetObjectParseResult`

## Known Gaps

- Captcha-gated flows may need an interactive browser session.
- This phase intentionally excludes translate, image parse, PPT / drawing-board, online-save integrations, and batch orchestration.
- PPT generator and drawing-board editing appear to rely on browser-local state.
- Third-party online-save flows may require OAuth/browser handoff.
- The parse workflow currently defaults to `parseVersion: 3` (`doc2x-v3-2509-beta`) based on live UI, bundle analysis, and a successful end-to-end MCP run; the exact request payload was still inferred rather than copied from a browser network log.

## Development

```bash
npm install
npm run dev
npm run build
npm run verify:mcp
```

Online verification, including a real account bundle probe and one local PDF parse run:

```bash
npm run verify:mcp -- --online --pdf /abs/path/to/file.pdf
```
