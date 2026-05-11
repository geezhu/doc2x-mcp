import { spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { summarizeResponse, Doc2xClient } from "./client.js";
import { importBrowserSession, type ImportedBrowserSession } from "./browserSession.js";
import { DOC2X_WEB_ORIGIN } from "./endpoints.js";
import { SessionStore } from "./session.js";
import type { SessionSummary } from "./types.js";

const DEFAULT_TIMEOUT_MS = 300_000;
const DEFAULT_PAGE_URL = `${DOC2X_WEB_ORIGIN}/parse`;
const SILENT_REUSE_TIMEOUT_MS = 10_000;
const POLL_INTERVAL_MS = 2_000;
const DEVTOOLS_STARTUP_TIMEOUT_MS = 10_000;
const LOCK_RETRY_INTERVAL_MS = 250;
const LOCK_TIMEOUT_MS = 15_000;
const AUTH_ROOT_DIR = path.join(os.homedir(), ".doc2x-mcp");
const DEFAULT_MANAGED_PROFILE_DIR = path.join(AUTH_ROOT_DIR, "managed-browser-profile");
const ACTIVE_BROWSER_STATE_FILE = ".doc2x-managed-browser.json";
const STALE_PROFILE_LOCK_FILES = [
  "SingletonLock",
  "SingletonSocket",
  "SingletonCookie",
  "DevToolsActivePort"
];

interface ActiveManagedBrowserState {
  debugPort: number;
  debugBaseUrl: string;
  browserPid?: number;
  executablePath?: string;
  launchedAt: string;
  pageUrl: string;
  visible: boolean;
}

interface BrowserLaunchResult {
  debugPort: number;
  debugBaseUrl: string;
  browserPid?: number;
  visible: boolean;
  pageUrl: string;
}

interface ProbeResult {
  imported: ImportedBrowserSession;
  probe: Record<string, unknown>;
}

export interface Doc2xBrowserAuthResult {
  ok: boolean;
  authenticated: boolean;
  openedBrowser: boolean;
  reusedManagedProfile: boolean;
  timedOut: boolean;
  debugBaseUrl: string;
  profileDir: string;
  pageUrl?: string;
  captured?: {
    hasBearerToken: boolean;
    hasRefreshToken: boolean;
    defaultHeaders: Record<string, string>;
    cookieCount: number;
    cookieDomains: string[];
  };
  persistedSession?: SessionSummary;
  reason?: string;
  raw?: Record<string, unknown>;
}

function resolveManagedProfileDir(profileDir?: string): string {
  if (!profileDir) {
    return DEFAULT_MANAGED_PROFILE_DIR;
  }

  if (profileDir === "~") {
    return os.homedir();
  }

  if (profileDir.startsWith("~/") || profileDir.startsWith("~\\")) {
    return path.join(os.homedir(), profileDir.slice(2));
  }

  return path.resolve(profileDir);
}

function getAuthStatePath(profileDir: string): string {
  return path.join(profileDir, ACTIVE_BROWSER_STATE_FILE);
}

function getAuthLockPath(profileDir: string): string {
  return `${profileDir}.lock`;
}

function normalizeDebugBaseUrl(debugPort: number): string {
  return `http://127.0.0.1:${debugPort}`;
}

async function canConnectToDevtools(debugBaseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(new URL("/json/version", debugBaseUrl));
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForDevtools(debugBaseUrl: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await canConnectToDevtools(debugBaseUrl)) {
      return true;
    }
    await sleep(250);
  }
  return false;
}

async function readActiveBrowserState(profileDir: string): Promise<ActiveManagedBrowserState | undefined> {
  try {
    const raw = await readFile(getAuthStatePath(profileDir), "utf8");
    return JSON.parse(raw) as ActiveManagedBrowserState;
  } catch {
    return undefined;
  }
}

async function writeActiveBrowserState(profileDir: string, state: ActiveManagedBrowserState): Promise<void> {
  await mkdir(profileDir, { recursive: true });
  await writeFile(getAuthStatePath(profileDir), JSON.stringify(state, null, 2), "utf8");
}

async function clearActiveBrowserState(profileDir: string): Promise<void> {
  await rm(getAuthStatePath(profileDir), { force: true });
}

async function clearStaleProfileLocks(profileDir: string): Promise<void> {
  await Promise.all(
    STALE_PROFILE_LOCK_FILES.map((name) => rm(path.join(profileDir, name), { force: true }))
  );
}

async function getReusableActiveBrowserState(profileDir: string): Promise<ActiveManagedBrowserState | undefined> {
  const state = await readActiveBrowserState(profileDir);
  if (!state) {
    return undefined;
  }

  if (await canConnectToDevtools(state.debugBaseUrl)) {
    return state;
  }

  await clearActiveBrowserState(profileDir);
  return undefined;
}

async function acquireProfileLock(profileDir: string): Promise<() => Promise<void>> {
  const lockPath = getAuthLockPath(profileDir);
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      await mkdir(lockPath, { recursive: false });
      return async () => {
        await rm(lockPath, { recursive: true, force: true });
      };
    } catch (error) {
      const candidate = error as NodeJS.ErrnoException;
      if (candidate.code !== "EEXIST") {
        throw error;
      }
      await sleep(LOCK_RETRY_INTERVAL_MS);
    }
  }

  throw new Error(`Timed out while waiting for the managed browser lock: ${lockPath}`);
}

function getAvailablePort(preferredPort?: number): number {
  if (preferredPort) {
    return preferredPort;
  }

  return 40_000 + Math.floor(Math.random() * 10_000);
}

function isExecutableCandidateValid(candidate: string): boolean {
  const result = spawnSync(candidate, ["--version"], {
    stdio: "ignore"
  });
  return !result.error && result.status === 0;
}

function detectBrowserExecutable(explicitPath?: string): string {
  if (explicitPath) {
    if (isExecutableCandidateValid(explicitPath)) {
      return explicitPath;
    }
    throw new Error(`Browser executable is not usable: ${explicitPath}`);
  }

  const candidates =
    process.platform === "darwin"
      ? [
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          "/Applications/Chromium.app/Contents/MacOS/Chromium",
          "google-chrome",
          "chromium"
        ]
      : process.platform === "win32"
        ? [
            "chrome.exe",
            "chromium.exe",
            "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
            "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
          ]
        : [
            "google-chrome",
            "google-chrome-stable",
            "chromium",
            "chromium-browser"
          ];

  for (const candidate of candidates) {
    if (isExecutableCandidateValid(candidate)) {
      return candidate;
    }
  }

  throw new Error("No usable Chrome/Chromium executable was found. Pass executablePath explicitly.");
}

function launchBrowser(options: {
  executablePath: string;
  profileDir: string;
  debugPort: number;
  pageUrl: string;
  visible: boolean;
}): BrowserLaunchResult {
  const args = [
    `--user-data-dir=${options.profileDir}`,
    `--remote-debugging-port=${options.debugPort}`,
    "--no-first-run",
    "--no-default-browser-check",
    options.pageUrl
  ];

  if (!options.visible) {
    args.unshift("--disable-gpu");
    args.unshift("--headless=new");
  } else {
    args.unshift("--new-window");
  }

  const child = spawn(options.executablePath, args, {
    detached: options.visible,
    stdio: "ignore"
  });

  if (options.visible) {
    child.unref();
  }

  return {
    debugPort: options.debugPort,
    debugBaseUrl: normalizeDebugBaseUrl(options.debugPort),
    browserPid: child.pid,
    visible: options.visible,
    pageUrl: options.pageUrl
  };
}

function killBrowser(launch: BrowserLaunchResult | undefined): void {
  if (!launch?.browserPid) {
    return;
  }

  try {
    process.kill(launch.browserPid, "SIGTERM");
  } catch {
    // Ignore already-exited processes.
  }
}

async function buildCapturedSummary(imported: ImportedBrowserSession) {
  return {
    hasBearerToken: Boolean(imported.bearerToken),
    hasRefreshToken: Boolean(imported.refreshToken),
    defaultHeaders: imported.defaultHeaders,
    cookieCount: imported.cookies.length,
    cookieDomains: [...new Set(imported.cookies.map((cookie) => cookie.domain))].sort()
  };
}

async function probeImportedSession(imported: ImportedBrowserSession): Promise<Record<string, unknown>> {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "doc2x-auth-probe-"));
  const tempSessionPath = path.join(tempRoot, "session.json");
  const probeClient = new Doc2xClient(new SessionStore(tempSessionPath));

  try {
    await probeClient.setSession({
      bearerToken: imported.bearerToken,
      refreshToken: imported.refreshToken,
      cookies: imported.cookies,
      defaultHeaders: imported.defaultHeaders,
      clearExisting: true,
      notes: "temporary browser-auth probe"
    });

    const bundle = await probeClient.getAccountBundle();
    return Object.fromEntries(
      Object.entries(bundle).map(([key, value]) => [key, summarizeResponse(value)])
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function tryImportAndProbe(debugBaseUrl: string): Promise<ProbeResult | undefined> {
  try {
    const imported = await importBrowserSession({
      debugBaseUrl,
      preferPageUrl: DEFAULT_PAGE_URL
    });
    const probe = await probeImportedSession(imported);
    return {
      imported,
      probe
    };
  } catch {
    return undefined;
  }
}

async function waitForAuthenticatedSession(debugBaseUrl: string, timeoutMs: number): Promise<ProbeResult | undefined> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const imported = await tryImportAndProbe(debugBaseUrl);
    if (imported) {
      return imported;
    }
    await sleep(POLL_INTERVAL_MS);
  }
  return undefined;
}

function getTimedOutResult(input: {
  openedBrowser: boolean;
  reusedManagedProfile: boolean;
  debugBaseUrl: string;
  profileDir: string;
  reason: string;
  raw: Record<string, unknown>;
}): Doc2xBrowserAuthResult {
  return {
    ok: false,
    authenticated: false,
    openedBrowser: input.openedBrowser,
    reusedManagedProfile: input.reusedManagedProfile,
    timedOut: true,
    debugBaseUrl: input.debugBaseUrl,
    profileDir: input.profileDir,
    reason: input.reason,
    raw: input.raw
  };
}

export async function authenticateViaManagedBrowser(
  client: Doc2xClient,
  input?: {
    timeoutMs?: number;
    executablePath?: string;
    profileDir?: string;
    debugPort?: number;
    notes?: string;
  }
): Promise<Doc2xBrowserAuthResult> {
  const timeoutMs = input?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const profileDir = resolveManagedProfileDir(input?.profileDir);
  const raw: Record<string, unknown> = {
    timeoutMs,
    profileDir
  };
  const releaseLock = await acquireProfileLock(profileDir);
  let headlessLaunch: BrowserLaunchResult | undefined;
  let visibleLaunch: BrowserLaunchResult | undefined;

  try {
    await mkdir(profileDir, { recursive: true });

    if (input?.debugPort) {
      const explicitDebugBaseUrl = normalizeDebugBaseUrl(input.debugPort);
      raw.explicitDebugBaseUrl = explicitDebugBaseUrl;
      if (await canConnectToDevtools(explicitDebugBaseUrl)) {
        const imported = await waitForAuthenticatedSession(explicitDebugBaseUrl, timeoutMs);
        if (imported) {
          await writeActiveBrowserState(profileDir, {
            debugPort: input.debugPort,
            debugBaseUrl: explicitDebugBaseUrl,
            executablePath: input.executablePath,
            launchedAt: new Date().toISOString(),
            pageUrl: imported.imported.pageUrl,
            visible: true
          });
          const sessionSummary = await client.setSession({
            bearerToken: imported.imported.bearerToken,
            refreshToken: imported.imported.refreshToken,
            cookies: imported.imported.cookies,
            defaultHeaders: imported.imported.defaultHeaders,
            clearExisting: true,
            notes: input?.notes
          });

          return {
            ok: true,
            authenticated: true,
            openedBrowser: false,
            reusedManagedProfile: true,
            timedOut: false,
            debugBaseUrl: explicitDebugBaseUrl,
            profileDir,
            pageUrl: imported.imported.pageUrl,
            captured: await buildCapturedSummary(imported.imported),
            persistedSession: sessionSummary,
            raw: {
              ...raw,
              probe: imported.probe
            }
          };
        }

        return getTimedOutResult({
          openedBrowser: false,
          reusedManagedProfile: true,
          debugBaseUrl: explicitDebugBaseUrl,
          profileDir,
          reason: `Browser auth did not reach an authenticated session within ${timeoutMs}ms`,
          raw
        });
      }
    }

    const activeState = await getReusableActiveBrowserState(profileDir);
    raw.activeState = activeState;

    if (activeState) {
      const imported = await waitForAuthenticatedSession(activeState.debugBaseUrl, timeoutMs);
      if (imported) {
        const sessionSummary = await client.setSession({
          bearerToken: imported.imported.bearerToken,
          refreshToken: imported.imported.refreshToken,
          cookies: imported.imported.cookies,
          defaultHeaders: imported.imported.defaultHeaders,
          clearExisting: true,
          notes: input?.notes
        });

        return {
          ok: true,
          authenticated: true,
          openedBrowser: false,
          reusedManagedProfile: true,
          timedOut: false,
          debugBaseUrl: activeState.debugBaseUrl,
          profileDir,
          pageUrl: imported.imported.pageUrl,
          captured: await buildCapturedSummary(imported.imported),
          persistedSession: sessionSummary,
          raw: {
            ...raw,
            probe: imported.probe
          }
        };
      }

      return getTimedOutResult({
        openedBrowser: false,
        reusedManagedProfile: true,
        debugBaseUrl: activeState.debugBaseUrl,
        profileDir,
        reason: `Browser auth did not reach an authenticated session within ${timeoutMs}ms`,
        raw
      });
    }

    await clearStaleProfileLocks(profileDir);

    const executablePath = detectBrowserExecutable(input?.executablePath);
    raw.executablePath = executablePath;

    const silentReusePort = getAvailablePort(input?.debugPort);
    headlessLaunch = launchBrowser({
      executablePath,
      profileDir,
      debugPort: silentReusePort,
      pageUrl: DEFAULT_PAGE_URL,
      visible: false
    });
    raw.headlessLaunch = headlessLaunch;

    if (await waitForDevtools(headlessLaunch.debugBaseUrl, DEVTOOLS_STARTUP_TIMEOUT_MS)) {
      const imported = await waitForAuthenticatedSession(
        headlessLaunch.debugBaseUrl,
        Math.min(timeoutMs, SILENT_REUSE_TIMEOUT_MS)
      );
      if (imported) {
        const sessionSummary = await client.setSession({
          bearerToken: imported.imported.bearerToken,
          refreshToken: imported.imported.refreshToken,
          cookies: imported.imported.cookies,
          defaultHeaders: imported.imported.defaultHeaders,
          clearExisting: true,
          notes: input?.notes
        });

        return {
          ok: true,
          authenticated: true,
          openedBrowser: false,
          reusedManagedProfile: true,
          timedOut: false,
          debugBaseUrl: headlessLaunch.debugBaseUrl,
          profileDir,
          pageUrl: imported.imported.pageUrl,
          captured: await buildCapturedSummary(imported.imported),
          persistedSession: sessionSummary,
          raw: {
            ...raw,
            probe: imported.probe
          }
        };
      }
    }

    killBrowser(headlessLaunch);
    headlessLaunch = undefined;

    const visiblePort = getAvailablePort(input?.debugPort);
    visibleLaunch = launchBrowser({
      executablePath,
      profileDir,
      debugPort: visiblePort,
      pageUrl: DEFAULT_PAGE_URL,
      visible: true
    });
    raw.visibleLaunch = visibleLaunch;

    await writeActiveBrowserState(profileDir, {
      debugPort: visibleLaunch.debugPort,
      debugBaseUrl: visibleLaunch.debugBaseUrl,
      browserPid: visibleLaunch.browserPid,
      executablePath,
      launchedAt: new Date().toISOString(),
      pageUrl: visibleLaunch.pageUrl,
      visible: true
    });

    if (!(await waitForDevtools(visibleLaunch.debugBaseUrl, DEVTOOLS_STARTUP_TIMEOUT_MS))) {
      return {
        ok: false,
        authenticated: false,
        openedBrowser: true,
        reusedManagedProfile: false,
        timedOut: false,
        debugBaseUrl: visibleLaunch.debugBaseUrl,
        profileDir,
        reason: "Managed browser started but the DevTools endpoint never became reachable",
        raw
      };
    }

    const imported = await waitForAuthenticatedSession(visibleLaunch.debugBaseUrl, timeoutMs);
    if (!imported) {
      return getTimedOutResult({
        openedBrowser: true,
        reusedManagedProfile: false,
        debugBaseUrl: visibleLaunch.debugBaseUrl,
        profileDir,
        reason: `Browser auth did not reach an authenticated session within ${timeoutMs}ms`,
        raw
      });
    }

    const sessionSummary = await client.setSession({
      bearerToken: imported.imported.bearerToken,
      refreshToken: imported.imported.refreshToken,
      cookies: imported.imported.cookies,
      defaultHeaders: imported.imported.defaultHeaders,
      clearExisting: true,
      notes: input?.notes
    });

    return {
      ok: true,
      authenticated: true,
      openedBrowser: true,
      reusedManagedProfile: false,
      timedOut: false,
      debugBaseUrl: visibleLaunch.debugBaseUrl,
      profileDir,
      pageUrl: imported.imported.pageUrl,
      captured: await buildCapturedSummary(imported.imported),
      persistedSession: sessionSummary,
      raw: {
        ...raw,
        probe: imported.probe
      }
    };
  } finally {
    killBrowser(headlessLaunch);
    await releaseLock();
  }
}
