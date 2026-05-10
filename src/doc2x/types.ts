export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export interface JsonObject {
  [key: string]: JsonValue;
}

export interface StoredCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite?: string;
  expiresAt?: string;
}

export interface SessionState {
  version: 1;
  updatedAt: string;
  bearerToken?: string;
  defaultHeaders: Record<string, string>;
  cookies: StoredCookie[];
  notes?: string;
}

export interface SessionSummary {
  hasBearerToken: boolean;
  defaultHeaders: Record<string, string>;
  cookieCount: number;
  cookieDomains: string[];
  updatedAt: string;
  notes?: string;
}

export interface RequestOptions {
  method?: string;
  path?: string;
  absoluteUrl?: string;
  target?: "web" | "v2c" | "absolute";
  payload?: Record<string, unknown>;
  bodyText?: string;
  headers?: Record<string, string>;
  responseType?: "auto" | "json" | "text" | "base64";
  filePath?: string;
  fileFieldName?: string;
  fileContentType?: string;
  formFields?: Record<string, string>;
}

export interface ResponseSnapshot {
  ok: boolean;
  status: number;
  statusText: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

export interface BrowserFallbackPlan {
  flow: string;
  recommendedMode: "http" | "browser" | "mixed";
  reason: string;
  suggestedInputs: string[];
  notes: string[];
}
