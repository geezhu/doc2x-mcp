import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type { SessionState, SessionSummary } from "./types.js";

const SESSION_VERSION = 1;

function defaultSessionState(): SessionState {
  return {
    version: SESSION_VERSION,
    updatedAt: new Date(0).toISOString(),
    defaultHeaders: {},
    cookies: []
  };
}

export class SessionStore {
  readonly sessionPath: string;
  private state: SessionState = defaultSessionState();
  private loaded = false;

  constructor(sessionPath = path.resolve(process.cwd(), ".doc2x", "session.json")) {
    this.sessionPath = sessionPath;
  }

  async load(): Promise<SessionState> {
    if (this.loaded) {
      return this.state;
    }

    try {
      const raw = await readFile(this.sessionPath, "utf8");
      const parsed = JSON.parse(raw) as Partial<SessionState>;
      this.state = {
        version: SESSION_VERSION,
        updatedAt: parsed.updatedAt ?? new Date(0).toISOString(),
        bearerToken: parsed.bearerToken,
        defaultHeaders: parsed.defaultHeaders ?? {},
        cookies: parsed.cookies ?? [],
        notes: parsed.notes
      };
    } catch {
      this.state = defaultSessionState();
    }

    this.loaded = true;
    return this.state;
  }

  getState(): SessionState {
    return this.state;
  }

  getSummary(): SessionSummary {
    return {
      hasBearerToken: Boolean(this.state.bearerToken),
      defaultHeaders: this.state.defaultHeaders,
      cookieCount: this.state.cookies.length,
      cookieDomains: [...new Set(this.state.cookies.map((cookie) => cookie.domain))].sort(),
      updatedAt: this.state.updatedAt,
      notes: this.state.notes
    };
  }

  async overwrite(nextState: Omit<SessionState, "version" | "updatedAt">): Promise<SessionState> {
    const mergedState: SessionState = {
      version: SESSION_VERSION,
      updatedAt: new Date().toISOString(),
      bearerToken: nextState.bearerToken,
      defaultHeaders: nextState.defaultHeaders,
      cookies: nextState.cookies,
      notes: nextState.notes
    };

    this.state = mergedState;
    this.loaded = true;
    await this.persist();
    return this.state;
  }

  async clear(): Promise<void> {
    this.state = defaultSessionState();
    this.loaded = true;
    await rm(this.sessionPath, { force: true });
  }

  private async persist(): Promise<void> {
    await mkdir(path.dirname(this.sessionPath), { recursive: true });
    await writeFile(this.sessionPath, JSON.stringify(this.state, null, 2), "utf8");
  }
}
