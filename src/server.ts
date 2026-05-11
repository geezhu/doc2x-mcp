import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";

import {
  Doc2xClient,
  Doc2xHttpError,
  summarizeResponse,
  type PayOperation,
  type SpaceOperation,
  type TaskOperation,
  type UserGatewayOperation,
  type UtilGatewayOperation
} from "./doc2x/client.js";
import { authenticateViaManagedBrowser } from "./doc2x/browserAuth.js";
import {
  OBSERVED_CAPABILITIES,
  OBSERVED_ROUTES,
  PAY_GATEWAY_METHODS,
  REST_ENDPOINTS,
  SPACE_GATEWAY_METHODS,
  TASK_GATEWAY_METHODS,
  USER_GATEWAY_METHODS,
  UTIL_GATEWAY_METHODS,
  V2C_ENDPOINTS
} from "./doc2x/endpoints.js";
import { importBrowserSession } from "./doc2x/browserSession.js";
import { getBrowserFallbackPlan } from "./doc2x/browserFallback.js";
import {
  DOC2X_EXPORT_FORMAT,
  DOC2X_PARSE_VERSION,
  exportParseResultViaHttp,
  getParseMarkdownViaHttp,
  getParseStatusViaHttp,
  parsePdfViaHttp
} from "./doc2x/parseWorkflow.js";
import { safeJsonStringify } from "./utils/json.js";

const stringMapSchema = z.record(z.string(), z.string());
const payloadSchema = z.record(z.string(), z.any());

const taskOperationValues = Object.keys(TASK_GATEWAY_METHODS) as [TaskOperation, ...TaskOperation[]];
const spaceOperationValues = Object.keys(SPACE_GATEWAY_METHODS) as [SpaceOperation, ...SpaceOperation[]];
const payOperationValues = Object.keys(PAY_GATEWAY_METHODS) as [PayOperation, ...PayOperation[]];
const userGatewayOperationValues = Object.keys(USER_GATEWAY_METHODS) as [
  UserGatewayOperation,
  ...UserGatewayOperation[]
];
const utilGatewayOperationValues = Object.keys(UTIL_GATEWAY_METHODS) as [
  UtilGatewayOperation,
  ...UtilGatewayOperation[]
];

function textResult(title: string, value: unknown, isError = false) {
  return {
    isError,
    content: [
      {
        type: "text" as const,
        text: `${title}\n\n${safeJsonStringify(value)}`
      }
    ]
  };
}

function formatError(error: unknown): Record<string, unknown> {
  if (error instanceof Doc2xHttpError) {
    return {
      name: error.name,
      message: error.message,
      response: error.response
    };
  }

  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack
    };
  }

  return {
    message: "Unknown error",
    detail: error
  };
}

async function withToolErrorHandling<T>(
  title: string,
  task: () => Promise<T>
): Promise<ReturnType<typeof textResult>> {
  try {
    const value = await task();
    return textResult(title, value);
  } catch (error) {
    return textResult(`${title} failed`, formatError(error), true);
  }
}

export function createServer(client = new Doc2xClient()): McpServer {
  const server = new McpServer({
    name: "doc2x-subscription-mcp",
    version: "0.1.0"
  });

  server.registerTool(
    "doc2x_surface_catalog",
    {
      description:
        "Return the observed Doc2X web routes, endpoint families, and capability surface recovered from the public site bundles.",
      inputSchema: {
        includeRestEndpoints: z.boolean().optional(),
        includeGatewayEndpoints: z.boolean().optional(),
        includeV2cEndpoints: z.boolean().optional()
      }
    },
    async ({
      includeGatewayEndpoints = true,
      includeRestEndpoints = true,
      includeV2cEndpoints = true
    }) =>
      withToolErrorHandling("Doc2X surface catalog", async () => ({
        routes: OBSERVED_ROUTES,
        capabilities: OBSERVED_CAPABILITIES,
        restEndpoints: includeRestEndpoints ? REST_ENDPOINTS : undefined,
        gatewayEndpoints: includeGatewayEndpoints
          ? {
              task: TASK_GATEWAY_METHODS,
              space: SPACE_GATEWAY_METHODS,
              pay: PAY_GATEWAY_METHODS,
              user: USER_GATEWAY_METHODS,
              util: UTIL_GATEWAY_METHODS
            }
          : undefined,
        v2cEndpoints: includeV2cEndpoints ? V2C_ENDPOINTS : undefined
      }))
  );

  server.registerTool(
    "doc2x_auth_browser",
    {
      description:
        "Authenticate Doc2X through a managed Chrome/Chromium profile in one step: silently reuse an existing managed profile when possible, otherwise open a browser for manual login and automatically import the resulting session.",
      inputSchema: {
        timeoutMs: z.number().int().positive().optional(),
        executablePath: z.string().optional(),
        profileDir: z.string().optional(),
        debugPort: z.number().int().positive().optional(),
        notes: z.string().optional()
      }
    },
    async ({ timeoutMs, executablePath, profileDir, debugPort, notes }) =>
      withToolErrorHandling("Doc2X browser auth", async () => {
        return authenticateViaManagedBrowser(client, {
          timeoutMs,
          executablePath,
          profileDir,
          debugPort,
          notes
        });
      })
  );

  server.registerTool(
    "doc2x_session_get",
    {
      description: "Show the currently persisted Doc2X session summary, including cookie count and default headers."
    },
    async () =>
      withToolErrorHandling("Doc2X session summary", async () => {
        return client.getSessionSummary();
      })
  );

  server.registerTool(
    "doc2x_session_set",
    {
      description:
        "Import or update a Doc2X session using cookie header text, bearer token, and extra default headers.",
      inputSchema: {
        cookieHeader: z.string().optional(),
        bearerToken: z.string().optional(),
        refreshToken: z.string().optional(),
        defaultHeaders: stringMapSchema.optional(),
        clearExisting: z.boolean().optional(),
        notes: z.string().optional()
      }
    },
    async ({ cookieHeader, bearerToken, refreshToken, defaultHeaders, clearExisting, notes }) =>
      withToolErrorHandling("Doc2X session updated", async () => {
        return client.setSession({
          cookieHeader,
          bearerToken,
          refreshToken,
          defaultHeaders,
          clearExisting,
          notes
        });
      })
  );

  server.registerTool(
    "doc2x_import_browser_session",
    {
      description:
        "Import the current Doc2X login session from a Chrome/Chromium instance exposed over the DevTools remote debugging protocol.",
      inputSchema: {
        debugBaseUrl: z.string().optional(),
        preferPageUrl: z.string().optional(),
        persist: z.boolean().optional(),
        clearExisting: z.boolean().optional(),
        notes: z.string().optional()
      }
    },
    async ({ debugBaseUrl, preferPageUrl, persist = true, clearExisting = true, notes }) =>
      withToolErrorHandling("Doc2X browser session import", async () => {
        const imported = await importBrowserSession({
          debugBaseUrl,
          preferPageUrl
        });

        const sessionSummary = persist
          ? await client.setSession({
              bearerToken: imported.bearerToken,
              refreshToken: imported.refreshToken,
              cookies: imported.cookies,
              defaultHeaders: imported.defaultHeaders,
              clearExisting,
              notes
            })
          : undefined;

        return {
          debugBaseUrl: imported.debugBaseUrl,
          pageTargetId: imported.pageTargetId,
          pageUrl: imported.pageUrl,
          captured: {
            hasBearerToken: Boolean(imported.bearerToken),
            hasRefreshToken: Boolean(imported.refreshToken),
            defaultHeaders: imported.defaultHeaders,
            cookieCount: imported.cookies.length,
            cookieDomains: [...new Set(imported.cookies.map((cookie) => cookie.domain))].sort()
          },
          localStorageKeys: imported.localStorageKeys,
          sessionStorageKeys: imported.sessionStorageKeys,
          userInfo: imported.userInfo,
          subscriptionInfo: imported.subscriptionInfo,
          persistedSession: sessionSummary
        };
      })
  );

  server.registerTool(
    "doc2x_session_clear",
    {
      description: "Remove the persisted Doc2X session from local storage."
    },
    async () =>
      withToolErrorHandling("Doc2X session cleared", async () => {
        await client.clearSession();
        return { cleared: true };
      })
  );

  server.registerTool(
    "doc2x_login_password",
    {
      description:
        "Attempt Doc2X password login through the observed web endpoint. This may still fail if the account is captcha-gated.",
      inputSchema: {
        phone: z.string(),
        password: z.string(),
        inviteCode: z.string().optional()
      }
    },
    async ({ phone, password, inviteCode }) =>
      withToolErrorHandling("Doc2X password login", async () => {
        const response = await client.loginWithPassword({
          phone,
          password,
          inviteCode
        });
        return summarizeResponse(response);
      })
  );

  server.registerTool(
    "doc2x_login_code",
    {
      description:
        "Attempt Doc2X SMS-code login through the observed web endpoint. This may still need captcha or verification headers.",
      inputSchema: {
        phone: z.string(),
        code: z.string(),
        inviteCode: z.string().optional()
      }
    },
    async ({ phone, code, inviteCode }) =>
      withToolErrorHandling("Doc2X code login", async () => {
        const response = await client.loginWithCode({
          phone,
          code,
          inviteCode
        });
        return summarizeResponse(response);
      })
  );

  server.registerTool(
    "doc2x_send_sms_code",
    {
      description:
        "Request an SMS code from Doc2X. Real success may still depend on captcha or server-side verification.",
      inputSchema: {
        phone: z.string(),
        purpose: z.string().optional()
      }
    },
    async ({ phone, purpose }) =>
      withToolErrorHandling("Doc2X send SMS code", async () => {
        const response = await client.sendSmsCode({
          phone,
          purpose
        });
        return summarizeResponse(response);
      })
  );

  server.registerTool(
    "doc2x_get_account_bundle",
    {
      description:
        "Fetch profile, quota, subscription, and product list in one call using the web subscription session."
    },
    async () =>
      withToolErrorHandling("Doc2X account bundle", async () => {
        const bundle = await client.getAccountBundle();
        return Object.fromEntries(
          Object.entries(bundle).map(([key, value]) => [key, summarizeResponse(value)])
        );
      })
  );

  server.registerTool(
    "doc2x_parse_pdf",
    {
      description:
        "Parse a single local PDF through the Doc2X web subscription flow using pure HTTP, waiting until the task finishes or times out.",
      inputSchema: {
        filePath: z.string(),
        timeoutMs: z.number().int().positive().optional(),
        parseVersion: z
          .union([
            z.literal(DOC2X_PARSE_VERSION.doc2xV2_2410),
            z.literal(DOC2X_PARSE_VERSION.doc2xV3_2509)
          ])
          .optional()
      }
    },
    async ({ filePath, timeoutMs, parseVersion }) =>
      withToolErrorHandling("Doc2X parse PDF", async () => {
        return parsePdfViaHttp(client, {
          filePath,
          timeoutMs,
          parseVersion
        });
      })
  );

  server.registerTool(
    "doc2x_get_parse_status",
    {
      description:
        "Fetch a parse task snapshot by taskId or objectId. If the parse is complete, also enrich the response with object and parse result metadata.",
      inputSchema: {
        taskId: z.string().optional(),
        objectId: z.string().optional()
      }
    },
    async ({ taskId, objectId }) =>
      withToolErrorHandling("Doc2X parse status", async () => {
        return getParseStatusViaHttp(client, {
          taskId,
          objectId
        });
      })
  );

  server.registerTool(
    "doc2x_get_parse_markdown",
    {
      description:
        "Fetch the Markdown result for a completed parse task or object. Supports taskId or objectId, returns merged Markdown plus page-level text, and can optionally write a local .md file.",
      inputSchema: {
        taskId: z.string().optional(),
        objectId: z.string().optional(),
        outputPath: z.string().optional()
      }
    },
    async ({ taskId, objectId, outputPath }) =>
      withToolErrorHandling("Doc2X parse markdown", async () => {
        return getParseMarkdownViaHttp(client, {
          taskId,
          objectId,
          outputPath
        });
      })
  );

  server.registerTool(
    "doc2x_export_parse_result",
    {
      description:
        "Run the verified web export flow for a completed parse task or object, poll the convert task, and download the final artifact to a local absolute output path.",
      inputSchema: {
        taskId: z.string().optional(),
        objectId: z.string().optional(),
        exportFormat: z
          .enum([
            DOC2X_EXPORT_FORMAT.markdown,
            DOC2X_EXPORT_FORMAT.latex,
            DOC2X_EXPORT_FORMAT.word
          ])
          .optional(),
        outputPath: z.string()
      }
    },
    async ({ taskId, objectId, exportFormat, outputPath }) =>
      withToolErrorHandling("Doc2X export parse result", async () => {
        return exportParseResultViaHttp(client, {
          taskId,
          objectId,
          exportFormat,
          outputPath
        });
      })
  );

  server.registerTool(
    "doc2x_create_task",
    {
      description:
        "Call an observed TaskService creation or validation endpoint, such as parse, translate, upload, or image-edit task creation.",
      inputSchema: {
        operation: z.enum(taskOperationValues),
        payload: payloadSchema
      }
    },
    async ({ operation, payload }) =>
      withToolErrorHandling(`Doc2X task operation ${operation}`, async () => {
        const response = await client.taskOperation(operation, payload);
        return summarizeResponse(response);
      })
  );

  server.registerTool(
    "doc2x_space_operation",
    {
      description:
        "Call an observed SpaceService endpoint to list parse/translate objects, inspect results, or update space objects.",
      inputSchema: {
        operation: z.enum(spaceOperationValues),
        payload: payloadSchema
      }
    },
    async ({ operation, payload }) =>
      withToolErrorHandling(`Doc2X space operation ${operation}`, async () => {
        const response = await client.spaceOperation(operation, payload);
        return summarizeResponse(response);
      })
  );

  server.registerTool(
    "doc2x_pay_operation",
    {
      description:
        "Call observed billing, refund, points-transform, or invoice endpoints from the Doc2X payment surface.",
      inputSchema: {
        operation: z.enum(payOperationValues),
        payload: payloadSchema
      }
    },
    async ({ operation, payload }) =>
      withToolErrorHandling(`Doc2X pay operation ${operation}`, async () => {
        const response = await client.payOperation(operation, payload);
        return summarizeResponse(response);
      })
  );

  server.registerTool(
    "doc2x_user_gateway_operation",
    {
      description:
        "Call observed gateway user operations such as OAuth login, phone binding change checks, WeChat unbind, or unregister actions.",
      inputSchema: {
        operation: z.enum(userGatewayOperationValues),
        payload: payloadSchema
      }
    },
    async ({ operation, payload }) =>
      withToolErrorHandling(`Doc2X user gateway operation ${operation}`, async () => {
        const response = await client.userGatewayOperation(operation, payload);
        return summarizeResponse(response);
      })
  );

  server.registerTool(
    "doc2x_util_operation",
    {
      description:
        "Call observed utility endpoints such as changelogs, announcements, or transfer-record related methods.",
      inputSchema: {
        operation: z.enum(utilGatewayOperationValues),
        payload: payloadSchema
      }
    },
    async ({ operation, payload }) =>
      withToolErrorHandling(`Doc2X util operation ${operation}`, async () => {
        const response = await client.utilGatewayOperation(operation, payload);
        return summarizeResponse(response);
      })
  );

  server.registerTool(
    "doc2x_request",
    {
      description:
        "Make a raw Doc2X HTTP request. Use this for uncovered REST, gateway, v2c, or upload flows once you know the real payload shape.",
      inputSchema: {
        target: z.enum(["web", "v2c", "absolute"]).optional(),
        path: z.string().optional(),
        absoluteUrl: z.string().optional(),
        method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).optional(),
        payload: payloadSchema.optional(),
        bodyText: z.string().optional(),
        headers: stringMapSchema.optional(),
        responseType: z.enum(["auto", "json", "text", "base64"]).optional(),
        filePath: z.string().optional(),
        fileFieldName: z.string().optional(),
        fileContentType: z.string().optional(),
        formFields: stringMapSchema.optional(),
        includeSessionAuth: z.boolean().optional(),
        includeSessionCookies: z.boolean().optional(),
        allowRefresh: z.boolean().optional(),
        originOverride: z.string().nullable().optional(),
        refererOverride: z.string().nullable().optional()
      }
    },
    async (input) =>
      withToolErrorHandling("Doc2X raw request", async () => {
        const response = await client.request(input);
        return summarizeResponse(response);
      })
  );

  server.registerTool(
    "doc2x_browser_fallback_plan",
    {
      description:
        "Explain whether a Doc2X flow is better handled by HTTP only, browser only, or a mixed approach.",
      inputSchema: {
        flow: z.string()
      }
    },
    async ({ flow }) =>
      withToolErrorHandling("Doc2X browser fallback plan", async () => {
        return getBrowserFallbackPlan(flow);
      })
  );

  return server;
}
