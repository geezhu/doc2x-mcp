import type { StoredCookie } from "./types.js";

const DEFAULT_PATH = "/";

function parseBooleanAttribute(_name: string, _value: string | undefined): boolean {
  return true;
}

function normalizeDomain(domain: string): string {
  return domain.trim().replace(/^\./, "").toLowerCase();
}

function getDefaultPath(pathname: string): string {
  if (!pathname || !pathname.startsWith("/")) {
    return DEFAULT_PATH;
  }

  const lastSlash = pathname.lastIndexOf("/");
  if (lastSlash <= 0) {
    return DEFAULT_PATH;
  }

  return pathname.slice(0, lastSlash) || DEFAULT_PATH;
}

function toKey(cookie: StoredCookie): string {
  return `${cookie.domain}|${cookie.path}|${cookie.name}`;
}

function domainMatches(hostname: string, cookieDomain: string): boolean {
  const normalizedHost = hostname.toLowerCase();
  const normalizedCookieDomain = normalizeDomain(cookieDomain);
  return (
    normalizedHost === normalizedCookieDomain ||
    normalizedHost.endsWith(`.${normalizedCookieDomain}`)
  );
}

function pathMatches(pathname: string, cookiePath: string): boolean {
  if (cookiePath === DEFAULT_PATH) {
    return true;
  }

  return pathname.startsWith(cookiePath);
}

function isExpired(cookie: StoredCookie): boolean {
  if (!cookie.expiresAt) {
    return false;
  }

  const expiresMs = Date.parse(cookie.expiresAt);
  if (Number.isNaN(expiresMs)) {
    return false;
  }

  return expiresMs <= Date.now();
}

export function parseSetCookie(setCookieHeader: string, url: URL): StoredCookie | null {
  const parts = setCookieHeader.split(";").map((part) => part.trim());
  const first = parts.shift();
  if (!first) {
    return null;
  }

  const separatorIndex = first.indexOf("=");
  if (separatorIndex <= 0) {
    return null;
  }

  const name = first.slice(0, separatorIndex).trim();
  const value = first.slice(separatorIndex + 1);
  const cookie: StoredCookie = {
    name,
    value,
    domain: url.hostname,
    path: getDefaultPath(url.pathname),
    secure: false,
    httpOnly: false
  };

  for (const attribute of parts) {
    const attributeParts = attribute.split("=");
    const rawKey = attributeParts.shift() ?? "";
    const valueParts = attributeParts;
    const key = rawKey.trim().toLowerCase();
    const joinedValue = valueParts.join("=").trim() || undefined;

    switch (key) {
      case "domain":
        if (joinedValue) {
          cookie.domain = normalizeDomain(joinedValue);
        }
        break;
      case "path":
        if (joinedValue) {
          cookie.path = joinedValue;
        }
        break;
      case "secure":
        cookie.secure = parseBooleanAttribute(key, joinedValue);
        break;
      case "httponly":
        cookie.httpOnly = parseBooleanAttribute(key, joinedValue);
        break;
      case "samesite":
        cookie.sameSite = joinedValue;
        break;
      case "expires":
        if (joinedValue && !Number.isNaN(Date.parse(joinedValue))) {
          cookie.expiresAt = new Date(joinedValue).toISOString();
        }
        break;
      case "max-age":
        if (joinedValue) {
          const seconds = Number.parseInt(joinedValue, 10);
          if (!Number.isNaN(seconds)) {
            cookie.expiresAt = new Date(Date.now() + seconds * 1000).toISOString();
          }
        }
        break;
      default:
        break;
    }
  }

  return cookie;
}

export function parseCookieHeader(cookieHeader: string, url: URL): StoredCookie[] {
  const cookies: StoredCookie[] = [];

  for (const part of cookieHeader.split(";").map((item) => item.trim()).filter(Boolean)) {
    const separatorIndex = part.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    cookies.push({
      name: part.slice(0, separatorIndex).trim(),
      value: part.slice(separatorIndex + 1),
      domain: url.hostname,
      path: DEFAULT_PATH,
      secure: url.protocol === "https:",
      httpOnly: false
    });
  }

  return cookies;
}

export class CookieJar {
  private readonly cookies = new Map<string, StoredCookie>();

  constructor(initialCookies: StoredCookie[] = []) {
    this.replace(initialCookies);
  }

  replace(cookies: StoredCookie[]): void {
    this.cookies.clear();
    for (const cookie of cookies) {
      if (!isExpired(cookie)) {
        this.cookies.set(toKey(cookie), cookie);
      }
    }
  }

  importCookieHeader(cookieHeader: string, url: URL): number {
    const cookies = parseCookieHeader(cookieHeader, url);
    for (const cookie of cookies) {
      this.cookies.set(toKey(cookie), cookie);
    }
    return cookies.length;
  }

  ingestSetCookieHeaders(setCookieHeaders: string[], url: URL): number {
    let ingested = 0;
    for (const header of setCookieHeaders) {
      const cookie = parseSetCookie(header, url);
      if (!cookie) {
        continue;
      }

      if (isExpired(cookie)) {
        this.cookies.delete(toKey(cookie));
        continue;
      }

      this.cookies.set(toKey(cookie), cookie);
      ingested += 1;
    }

    return ingested;
  }

  getCookieHeader(url: URL): string | undefined {
    this.purgeExpired();

    const applicableCookies = [...this.cookies.values()].filter((cookie) => {
      if (!domainMatches(url.hostname, cookie.domain)) {
        return false;
      }

      if (!pathMatches(url.pathname || DEFAULT_PATH, cookie.path || DEFAULT_PATH)) {
        return false;
      }

      if (cookie.secure && url.protocol !== "https:") {
        return false;
      }

      return true;
    });

    if (applicableCookies.length === 0) {
      return undefined;
    }

    return applicableCookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
  }

  toJSON(): StoredCookie[] {
    this.purgeExpired();
    return [...this.cookies.values()];
  }

  summary(): { count: number; domains: string[] } {
    this.purgeExpired();
    const domains = [...new Set([...this.cookies.values()].map((cookie) => cookie.domain))].sort();
    return {
      count: this.cookies.size,
      domains
    };
  }

  private purgeExpired(): void {
    for (const [key, cookie] of this.cookies.entries()) {
      if (isExpired(cookie)) {
        this.cookies.delete(key);
      }
    }
  }
}
