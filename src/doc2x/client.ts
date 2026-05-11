import { readFile } from "node:fs/promises";
import path from "node:path";

import { CookieJar } from "./cookies.js";
import {
  DOC2X_V2C_ORIGIN,
  DOC2X_WEB_ORIGIN,
  PAY_GATEWAY_METHODS,
  REST_ENDPOINTS,
  SPACE_GATEWAY_METHODS,
  TASK_GATEWAY_METHODS,
  USER_GATEWAY_METHODS,
  UTIL_GATEWAY_METHODS
} from "./endpoints.js";
import { SessionStore } from "./session.js";
import type {
  RequestOptions,
  ResponseSnapshot,
  SessionSummary,
  StoredCookie
} from "./types.js";

type DefaultHeaderInput = Record<string, string> | undefined;

function headersToObject(headers: Headers): Record<string, string> {
  return Object.fromEntries(headers.entries());
}

function getSetCookieHeaders(headers: Headers): string[] {
  const candidate = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof candidate.getSetCookie === "function") {
    return candidate.getSetCookie();
  }
  return [];
}

function isJsonContentType(contentType: string | null): boolean {
  return Boolean(contentType && contentType.includes("application/json"));
}

function ensureLeadingSlash(pathname: string): string {
  return pathname.startsWith("/") ? pathname : `/${pathname}`;
}

function getRequestOrigin(url: URL): string {
  return url.origin === DOC2X_V2C_ORIGIN ? DOC2X_WEB_ORIGIN : url.origin;
}

function getRequestReferer(url: URL): string {
  const origin = getRequestOrigin(url);
  return `${origin}/`;
}

async function createRequestBody(options: RequestOptions): Promise<{
  body: BodyInit | undefined;
  headers: Record<string, string>;
}> {
  const headers = { ...(options.headers ?? {}) };

  if (options.filePath) {
    const resolvedPath = path.resolve(options.filePath);
    const fileBuffer = await readFile(resolvedPath);
    const fileName = path.basename(resolvedPath);
    const contentType = options.fileContentType ?? "application/octet-stream";

    if (options.fileFieldName) {
      const form = new FormData();
      for (const [key, value] of Object.entries(options.formFields ?? {})) {
        form.set(key, value);
      }

      const file = new File([fileBuffer], fileName, { type: contentType });
      form.set(options.fileFieldName, file);
      return { body: form, headers };
    }

    if (!headers["Content-Type"] && !headers["content-type"]) {
      headers["Content-Type"] = contentType;
    }

    return {
      body: new Blob([fileBuffer], { type: contentType }),
      headers
    };
  }

  if (options.bodyText !== undefined) {
    if (!headers["Content-Type"] && !headers["content-type"]) {
      headers["Content-Type"] = "text/plain; charset=utf-8";
    }
    return { body: options.bodyText, headers };
  }

  if (options.payload !== undefined) {
    if (!headers["Content-Type"] && !headers["content-type"]) {
      headers["Content-Type"] = "application/json";
    }
    return { body: JSON.stringify(options.payload), headers };
  }

  return { body: undefined, headers };
}

async function parseResponseBody(response: Response, responseType: RequestOptions["responseType"]): Promise<unknown> {
  const contentType = response.headers.get("content-type");
  const selectedType = responseType ?? "auto";

  if (selectedType === "json" || (selectedType === "auto" && isJsonContentType(contentType))) {
    const rawText = await response.text();
    if (!rawText) {
      return null;
    }

    try {
      return JSON.parse(rawText) as unknown;
    } catch {
      return rawText;
    }
  }

  if (selectedType === "base64") {
    const arrayBuffer = await response.arrayBuffer();
    return {
      base64: Buffer.from(arrayBuffer).toString("base64"),
      byteLength: arrayBuffer.byteLength,
      contentType
    };
  }

  return response.text();
}

export class Doc2xHttpError extends Error {
  constructor(message: string, readonly response: ResponseSnapshot) {
    super(message);
    this.name = "Doc2xHttpError";
  }
}

export class Doc2xClient {
  private readonly sessionStore: SessionStore;
  private readonly cookieJar = new CookieJar();
  private initialized = false;

  constructor(sessionStore = new SessionStore()) {
    this.sessionStore = sessionStore;
  }

  async init(): Promise<void> {
    if (this.initialized) {
      return;
    }

    const session = await this.sessionStore.load();
    this.cookieJar.replace(session.cookies);
    this.initialized = true;
  }

  async getSessionSummary(): Promise<SessionSummary> {
    await this.init();
    const currentState = this.sessionStore.getState();
    const cookieSummary = this.cookieJar.summary();
    return {
      hasBearerToken: Boolean(currentState.bearerToken),
      hasRefreshToken: Boolean(currentState.refreshToken),
      defaultHeaders: currentState.defaultHeaders,
      cookieCount: cookieSummary.count,
      cookieDomains: cookieSummary.domains,
      updatedAt: currentState.updatedAt,
      notes: currentState.notes
    };
  }

  async setSession(input: {
    bearerToken?: string;
    refreshToken?: string;
    cookieHeader?: string;
    cookies?: StoredCookie[];
    defaultHeaders?: DefaultHeaderInput;
    clearExisting?: boolean;
    notes?: string;
  }): Promise<SessionSummary> {
    await this.init();

    const currentState = this.sessionStore.getState();
    const nextHeaders = input.clearExisting
      ? { ...(input.defaultHeaders ?? {}) }
      : { ...currentState.defaultHeaders, ...(input.defaultHeaders ?? {}) };

    const nextBearerToken =
      input.bearerToken !== undefined
        ? input.bearerToken
        : input.clearExisting
          ? undefined
          : currentState.bearerToken;

    const nextRefreshToken =
      input.refreshToken !== undefined
        ? input.refreshToken
        : input.clearExisting
          ? undefined
          : currentState.refreshToken;

    const nextCookies = input.clearExisting ? [] : this.cookieJar.toJSON();
    if (input.cookies) {
      nextCookies.push(...input.cookies);
    }

    this.cookieJar.replace(nextCookies);

    if (input.cookieHeader) {
      this.cookieJar.importCookieHeader(input.cookieHeader, new URL(DOC2X_WEB_ORIGIN));
    }

    await this.sessionStore.overwrite({
      bearerToken: nextBearerToken,
      refreshToken: nextRefreshToken,
      defaultHeaders: nextHeaders,
      cookies: this.cookieJar.toJSON(),
      notes: input.notes ?? currentState.notes
    });

    return this.getSessionSummary();
  }

  async clearSession(): Promise<void> {
    await this.init();
    this.cookieJar.replace([]);
    await this.sessionStore.clear();
  }

  async request(options: RequestOptions): Promise<ResponseSnapshot> {
    await this.init();

    const target = options.target ?? "web";
    const url = this.resolveUrl(target, options.path, options.absoluteUrl);
    const session = this.sessionStore.getState();
    const method = (options.method ?? (options.payload !== undefined || options.bodyText !== undefined || options.filePath ? "POST" : "GET")).toUpperCase();
    const { body, headers } = await createRequestBody(options);

    const requestHeaders = new Headers({
      Accept: "application/json, text/plain, */*",
      "User-Agent": "doc2x-subscription-mcp/0.1.0",
      Origin: getRequestOrigin(url),
      Referer: getRequestReferer(url),
      ...session.defaultHeaders,
      ...headers
    });

    if (session.bearerToken && !requestHeaders.has("Authorization")) {
      requestHeaders.set("Authorization", `Bearer ${session.bearerToken}`);
    }

    const cookieHeader = this.cookieJar.getCookieHeader(url);
    if (cookieHeader) {
      requestHeaders.set("Cookie", cookieHeader);
    }

    const response = await fetch(url, {
      method,
      headers: requestHeaders,
      body
    });

    const setCookieHeaders = getSetCookieHeaders(response.headers);
    if (setCookieHeaders.length > 0) {
      this.cookieJar.ingestSetCookieHeaders(setCookieHeaders, url);
      await this.sessionStore.overwrite({
        bearerToken: session.bearerToken,
        refreshToken: session.refreshToken,
        defaultHeaders: session.defaultHeaders,
        cookies: this.cookieJar.toJSON(),
        notes: session.notes
      });
    }

    const snapshot: ResponseSnapshot = {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      url: response.url,
      headers: headersToObject(response.headers),
      body: await parseResponseBody(response, options.responseType)
    };

    if (!response.ok) {
      throw new Doc2xHttpError(`Doc2X request failed with ${response.status} ${response.statusText}`, snapshot);
    }

    return snapshot;
  }

  async loginWithPassword(payload: Record<string, unknown>): Promise<ResponseSnapshot> {
    return this.request({
      method: REST_ENDPOINTS.loginWithPassword.method,
      path: REST_ENDPOINTS.loginWithPassword.path,
      target: REST_ENDPOINTS.loginWithPassword.target,
      payload
    });
  }

  async loginWithCode(payload: Record<string, unknown>): Promise<ResponseSnapshot> {
    return this.request({
      method: REST_ENDPOINTS.loginWithCode.method,
      path: REST_ENDPOINTS.loginWithCode.path,
      target: REST_ENDPOINTS.loginWithCode.target,
      payload
    });
  }

  async sendSmsCode(payload: Record<string, unknown>): Promise<ResponseSnapshot> {
    return this.request({
      method: REST_ENDPOINTS.sendSmsCode.method,
      path: REST_ENDPOINTS.sendSmsCode.path,
      target: REST_ENDPOINTS.sendSmsCode.target,
      payload
    });
  }

  async logout(): Promise<ResponseSnapshot> {
    return this.request({
      method: REST_ENDPOINTS.logout.method,
      path: REST_ENDPOINTS.logout.path,
      target: REST_ENDPOINTS.logout.target
    });
  }

  async getAccountBundle(): Promise<Record<string, ResponseSnapshot>> {
    const [profile, quota, subscription, productList] = await Promise.all([
      this.request({
        method: REST_ENDPOINTS.profile.method,
        path: REST_ENDPOINTS.profile.path,
        target: REST_ENDPOINTS.profile.target
      }),
      this.request({
        method: REST_ENDPOINTS.quota.method,
        path: REST_ENDPOINTS.quota.path,
        target: REST_ENDPOINTS.quota.target
      }),
      this.request({
        method: REST_ENDPOINTS.subscription.method,
        path: REST_ENDPOINTS.subscription.path,
        target: REST_ENDPOINTS.subscription.target
      }),
      this.request({
        method: REST_ENDPOINTS.productList.method,
        path: REST_ENDPOINTS.productList.path,
        target: REST_ENDPOINTS.productList.target
      })
    ]);

    return {
      profile,
      quota,
      subscription,
      productList
    };
  }

  async taskOperation(
    operation: keyof typeof TASK_GATEWAY_METHODS,
    payload: Record<string, unknown>
  ): Promise<ResponseSnapshot> {
    return this.request({
      method: "POST",
      path: TASK_GATEWAY_METHODS[operation],
      target: "v2c",
      payload
    });
  }

  async spaceOperation(
    operation: keyof typeof SPACE_GATEWAY_METHODS,
    payload: Record<string, unknown>
  ): Promise<ResponseSnapshot> {
    return this.request({
      method: "POST",
      path: SPACE_GATEWAY_METHODS[operation],
      target: "v2c",
      payload
    });
  }

  async payOperation(
    operation: keyof typeof PAY_GATEWAY_METHODS,
    payload: Record<string, unknown>
  ): Promise<ResponseSnapshot> {
    return this.request({
      method: "POST",
      path: PAY_GATEWAY_METHODS[operation],
      target: "v2c",
      payload
    });
  }

  async userGatewayOperation(
    operation: keyof typeof USER_GATEWAY_METHODS,
    payload: Record<string, unknown>
  ): Promise<ResponseSnapshot> {
    return this.request({
      method: "POST",
      path: USER_GATEWAY_METHODS[operation],
      target: "v2c",
      payload
    });
  }

  async utilGatewayOperation(
    operation: keyof typeof UTIL_GATEWAY_METHODS,
    payload: Record<string, unknown>
  ): Promise<ResponseSnapshot> {
    return this.request({
      method: "POST",
      path: UTIL_GATEWAY_METHODS[operation],
      target: "v2c",
      payload
    });
  }

  private resolveUrl(
    target: RequestOptions["target"],
    pathInput?: string,
    absoluteUrl?: string
  ): URL {
    if (target === "absolute") {
      if (!absoluteUrl) {
        throw new Error("absoluteUrl is required when target=absolute");
      }
      return new URL(absoluteUrl);
    }

    const baseOrigin = target === "v2c" ? DOC2X_V2C_ORIGIN : DOC2X_WEB_ORIGIN;
    if (!pathInput) {
      throw new Error("path is required for web or v2c targets");
    }

    return new URL(ensureLeadingSlash(pathInput), baseOrigin);
  }
}

export type TaskOperation = keyof typeof TASK_GATEWAY_METHODS;
export type SpaceOperation = keyof typeof SPACE_GATEWAY_METHODS;
export type PayOperation = keyof typeof PAY_GATEWAY_METHODS;
export type UserGatewayOperation = keyof typeof USER_GATEWAY_METHODS;
export type UtilGatewayOperation = keyof typeof UTIL_GATEWAY_METHODS;

export function summarizeResponse(snapshot: ResponseSnapshot): Record<string, unknown> {
  return {
    ok: snapshot.ok,
    status: snapshot.status,
    statusText: snapshot.statusText,
    url: snapshot.url,
    headers: snapshot.headers,
    body: snapshot.body
  };
}

export function summarizeCookies(cookies: StoredCookie[]): Record<string, unknown>[] {
  return cookies.map((cookie) => ({
    name: cookie.name,
    domain: cookie.domain,
    path: cookie.path,
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    sameSite: cookie.sameSite,
    expiresAt: cookie.expiresAt
  }));
}
