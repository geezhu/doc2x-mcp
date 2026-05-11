import {
  DOC2X_V2C_ORIGIN,
  DOC2X_WEB_ORIGIN
} from "./endpoints.js";
import type { StoredCookie } from "./types.js";

const DEFAULT_DEBUG_BASE_URL = "http://127.0.0.1:9222";
const DEFAULT_PAGE_MATCH = "doc2x.noedgeai.com";

interface ChromeTarget {
  id: string;
  title: string;
  type: string;
  url: string;
  webSocketDebuggerUrl?: string;
}

interface ChromeCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite?: string;
  expires?: number;
}

interface DevtoolsEvaluationResult {
  result: {
    type: string;
    value?: BrowserStorageSnapshot;
  };
}

interface DevtoolsCookieResult {
  cookies: ChromeCookie[];
}

interface BrowserStorageSnapshot {
  href: string;
  ls: Record<string, string>;
  ss: Record<string, string>;
}

export interface ImportedBrowserSession {
  debugBaseUrl: string;
  pageTargetId: string;
  pageUrl: string;
  bearerToken?: string;
  refreshToken?: string;
  defaultHeaders: Record<string, string>;
  cookies: StoredCookie[];
  localStorageKeys: string[];
  sessionStorageKeys: string[];
  userInfo?: Record<string, unknown>;
  subscriptionInfo?: Record<string, unknown>;
}

function normalizeDebugBaseUrl(debugBaseUrl?: string): string {
  const resolvedUrl = new URL(debugBaseUrl ?? DEFAULT_DEBUG_BASE_URL);
  resolvedUrl.pathname = "";
  resolvedUrl.search = "";
  resolvedUrl.hash = "";
  return resolvedUrl.toString().replace(/\/$/, "");
}

function parseJsonRecord(rawValue: string | undefined): Record<string, unknown> | undefined {
  if (!rawValue) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(rawValue) as { state?: unknown };
    if (parsed && typeof parsed === "object" && parsed.state && typeof parsed.state === "object") {
      return parsed.state as Record<string, unknown>;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function getDefaultHeaders(rawHeaderValue: unknown): Record<string, string> {
  if (!rawHeaderValue) {
    return {};
  }

  if (typeof rawHeaderValue === "string") {
    try {
      return getDefaultHeaders(JSON.parse(rawHeaderValue) as unknown);
    } catch {
      return {};
    }
  }

  if (typeof rawHeaderValue !== "object") {
    return {};
  }

  return Object.fromEntries(
    Object.entries(rawHeaderValue as Record<string, unknown>).flatMap(([key, value]) =>
      typeof value === "string" && value.length > 0 ? [[key, value]] : []
    )
  );
}

function toStoredCookie(cookie: ChromeCookie): StoredCookie {
  return {
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path,
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    sameSite: cookie.sameSite,
    expiresAt:
      cookie.expires && cookie.expires > 0
        ? new Date(cookie.expires * 1000).toISOString()
        : undefined
  };
}

async function fetchChromeTargets(debugBaseUrl: string): Promise<ChromeTarget[]> {
  const response = await fetch(new URL("/json/list", debugBaseUrl));
  if (!response.ok) {
    throw new Error(`Failed to fetch Chrome targets: ${response.status} ${response.statusText}`);
  }

  return (await response.json()) as ChromeTarget[];
}

function pickDoc2xTarget(targets: ChromeTarget[], preferPageUrl?: string): ChromeTarget {
  const pageTargets = targets.filter((target) => target.type === "page" && target.webSocketDebuggerUrl);
  const exactMatch = preferPageUrl
    ? pageTargets.find((target) => target.url === preferPageUrl)
    : undefined;

  if (exactMatch) {
    return exactMatch;
  }

  const doc2xMatch = pageTargets.find((target) => target.url.includes(DEFAULT_PAGE_MATCH));
  if (doc2xMatch) {
    return doc2xMatch;
  }

  throw new Error("No Doc2X page target found on the Chrome DevTools endpoint");
}

async function queryPageState(webSocketDebuggerUrl: string): Promise<{
  storage: BrowserStorageSnapshot;
  cookies: ChromeCookie[];
}> {
  const socket = new WebSocket(webSocketDebuggerUrl);
  let nextId = 1;
  const pending = new Map<
    number,
    {
      resolve: (value: any) => void;
      reject: (error: unknown) => void;
    }
  >();

  const send = <TResult>(method: string, params: Record<string, unknown> = {}) =>
    new Promise<TResult>((resolve, reject) => {
      const id = nextId;
      nextId += 1;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });

  const opened = new Promise<void>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error("Timed out while connecting to the Chrome DevTools page target"));
    }, 5000);

    socket.addEventListener("open", () => {
      clearTimeout(timeoutId);
      resolve();
    });

    socket.addEventListener("error", () => {
      clearTimeout(timeoutId);
      reject(new Error("Failed to connect to the Chrome DevTools page target"));
    });
  });

  socket.addEventListener("message", (event) => {
    const payload = JSON.parse(String(event.data)) as {
      id?: number;
      result?: unknown;
      error?: unknown;
    };

    if (!payload.id) {
      return;
    }

    const entry = pending.get(payload.id);
    if (!entry) {
      return;
    }

    pending.delete(payload.id);
    if (payload.error) {
      entry.reject(payload.error);
      return;
    }

    entry.resolve(payload.result);
  });

  try {
    await opened;

    const runtime = await send<DevtoolsEvaluationResult>("Runtime.evaluate", {
      expression: `(() => {
        const ls = {};
        const ss = {};
        for (let i = 0; i < localStorage.length; i += 1) {
          const key = localStorage.key(i);
          if (key) {
            ls[key] = localStorage.getItem(key);
          }
        }
        for (let i = 0; i < sessionStorage.length; i += 1) {
          const key = sessionStorage.key(i);
          if (key) {
            ss[key] = sessionStorage.getItem(key);
          }
        }
        return { href: location.href, ls, ss };
      })()`,
      returnByValue: true
    });

    const cookies = await send<DevtoolsCookieResult>("Network.getCookies", {
      urls: [DOC2X_WEB_ORIGIN, `${DOC2X_WEB_ORIGIN}/parse`, DOC2X_V2C_ORIGIN]
    });

    const storage = runtime.result.value;
    if (!storage) {
      throw new Error("Chrome DevTools did not return localStorage data for the Doc2X page");
    }

    return {
      storage,
      cookies: cookies.cookies
    };
  } finally {
    socket.close();
  }
}

export async function importBrowserSession(options?: {
  debugBaseUrl?: string;
  preferPageUrl?: string;
}): Promise<ImportedBrowserSession> {
  const debugBaseUrl = normalizeDebugBaseUrl(options?.debugBaseUrl);
  const targets = await fetchChromeTargets(debugBaseUrl);
  const target = pickDoc2xTarget(targets, options?.preferPageUrl);
  const { storage, cookies } = await queryPageState(target.webSocketDebuggerUrl!);
  const userInfoState = parseJsonRecord(storage.ls.userInfoStorage);
  const subscriptionInfo =
    userInfoState?.subscriptionInfo && typeof userInfoState.subscriptionInfo === "object"
      ? (userInfoState.subscriptionInfo as Record<string, unknown>)
      : undefined;
  const userInfo =
    userInfoState?.userInfo && typeof userInfoState.userInfo === "object"
      ? (userInfoState.userInfo as Record<string, unknown>)
      : undefined;
  const doc2xHeader = userInfoState?.doc2xHeader;

  return {
    debugBaseUrl,
    pageTargetId: target.id,
    pageUrl: storage.href,
    bearerToken: typeof userInfoState?.token === "string" ? userInfoState.token : undefined,
    refreshToken:
      typeof userInfoState?.refreshToken === "string" ? userInfoState.refreshToken : undefined,
    defaultHeaders: getDefaultHeaders(doc2xHeader),
    cookies: cookies.map(toStoredCookie),
    localStorageKeys: Object.keys(storage.ls).sort(),
    sessionStorageKeys: Object.keys(storage.ss).sort(),
    userInfo,
    subscriptionInfo
  };
}
