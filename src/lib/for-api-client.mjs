import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { toNumber } from "./utils.mjs";

const execFileAsync = promisify(execFile);
const SESSION_CACHE_VERSION = 3;
const DEFAULT_ACCESS_TOKEN_REFRESH_SKEW_SECONDS = 90;
const SESSION_LOCK_WAIT_MS = 5 * 60 * 1000;
const SESSION_LOCK_STALE_MS = 10 * 60 * 1000;
const AUTOMATIC_PASSWORD_RECOVERY_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const AUTH_REFRESH_PATH = "/api/user/auth/refresh";
const REFRESH_COOKIE_NAME = "new_api_refresh";

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  }

  const workerCount = Math.min(Math.max(1, limit), items.length);
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  return results;
}

function parseCookieString(cookieString) {
  const cookies = new Map();

  for (const part of String(cookieString || "").split(";")) {
    const [name, ...valueParts] = part.trim().split("=");
    if (!name || valueParts.length === 0) {
      continue;
    }

    cookies.set(name, valueParts.join("="));
  }

  return cookies;
}

function normalizeAuthorization(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return "";
  }

  return /^Bearer\s+/i.test(trimmed) ? trimmed : `Bearer ${trimmed}`;
}

function parseAccessTokenPayload(authorization) {
  const token = String(authorization || "").replace(/^Bearer\s+/i, "").trim();
  const [, payload] = token.split(".");

  if (!payload) {
    return {};
  }

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeEpochSeconds(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return 0;
  }

  // The New API response uses epoch seconds. Accept milliseconds defensively
  // so a deployment-specific response cannot disable proactive refreshes.
  return numeric > 10_000_000_000 ? Math.floor(numeric / 1000) : Math.floor(numeric);
}

function extractSetCookies(headers) {
  if (typeof headers.getSetCookie === "function") {
    return headers.getSetCookie();
  }

  const single = headers.get("set-cookie");
  return single ? [single] : [];
}

function parseCookieJar(cookieText) {
  const cookies = new Map();

  for (const line of String(cookieText || "").split(/\r?\n/)) {
    const trimmed = line.trim();

    // curl writes HttpOnly cookies as "#HttpOnly_<domain>" in Netscape jars.
    // Treat that prefix as a cookie record, otherwise the refresh cookie is
    // discarded and the next token expiry forces an unnecessary password login.
    if (!trimmed || (trimmed.startsWith("#") && !trimmed.startsWith("#HttpOnly_"))) {
      continue;
    }

    const parts = line.split("\t");
    if (parts.length < 7) {
      continue;
    }

    const name = parts[5];
    const value = parts[6];
    if (!name) {
      continue;
    }

    cookies.set(name, value);
  }

  return cookies;
}

function buildCurlArgs({
  url,
  method,
  bodyFile,
  headers,
  cookieFile,
  proxyUrl,
  forceHttp11 = false,
}) {
  const args = [
    "--silent",
    "--show-error",
    "--compressed",
    "--max-time",
    "45",
    "--connect-timeout",
    "15",
    "--retry",
    "3",
    "--retry-delay",
    "2",
    "--retry-all-errors",
    "--retry-connrefused",
    "--ipv4",
    "--request",
    method,
    "--cookie",
    cookieFile,
    "--cookie-jar",
    cookieFile,
    "--write-out",
    "\n__CURL_STATUS__:%{http_code}",
  ];

  if (forceHttp11) {
    args.push("--http1.1");
  }

  if (proxyUrl) {
    args.push("--proxy", proxyUrl);
  }

  for (const [name, value] of Object.entries(headers)) {
    args.push("--header", `${name}: ${value}`);
  }

  if (bodyFile) {
    // Keep credentials out of curl's process arguments. The request body is
    // written to a 600-permission temporary file by requestTextViaCurl.
    args.push("--data-binary", `@${bodyFile}`);
  }

  args.push(url);

  return args;
}

export class ForApiClient {
  constructor({ baseUrl, auth, accountId = "", sessionCacheFile = "" }) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.auth = auth;
    this.accountId = String(accountId || "").trim();
    this.sessionCacheFile = sessionCacheFile ? path.resolve(sessionCacheFile) : "";
    this.usernameFingerprint = this.buildUsernameFingerprint(auth.username);
    this.cookies = parseCookieString(auth.cookie);
    this.authorization = normalizeAuthorization(auth.authorization);
    this.preferPasswordLogin =
      Boolean(auth.preferPasswordLogin) && Boolean(auth.username) && Boolean(auth.password);
    // An explicit reconnect can create a session from scratch. Automatic
    // recovery is narrower: it can only replace a known revoked refresh session.
    this.allowPasswordLogin = Boolean(auth.allowPasswordLogin);
    this.allowPasswordRecovery =
      Boolean(auth.allowPasswordRecovery) && this.preferPasswordLogin;
    const hasSuppliedSessionCredentials = this.cookies.size > 0 || Boolean(this.authorization);

    // The App can deliberately prefer password authentication while retaining
    // an old browser session in Keychain. Ignore that old session and use the
    // persisted password session instead of creating a fresh login each cycle.
    if (this.preferPasswordLogin) {
      this.cookies.clear();
      this.authorization = "";
    }

    // A browser Cookie or Bearer token is an explicit session choice. Never
    // replace it with a password login after the session expires: New API may
    // reject that extra login when the account has reached its session limit.
    this.hasInitialSessionCredentials =
      !this.preferPasswordLogin && hasSuppliedSessionCredentials;
    this.hasLoggedIn = false;
    this.userId = String(auth.userId || "").trim();
    this.loginPromise = null;
    this.refreshPromise = null;
    this.passwordLoginAttempted = false;
    this.sessionFromCache = false;
    this.sessionVersion = 0;
    this.sessionId = "";
    this.accessTokenExpiresAt = 0;
  }

  get proxyUrl() {
    return (
      process.env.FOROPENCODE_PROXY ||
      process.env.HTTPS_PROXY ||
      process.env.HTTP_PROXY ||
      process.env.ALL_PROXY ||
      ""
    ).trim();
  }

  isTransientFetchError(error) {
    const code = String(error?.cause?.code || error?.code || "");
    const message = String(error?.cause?.message || error?.message || "").toLowerCase();

    return (
      code === "UND_ERR_CONNECT_TIMEOUT" ||
      code === "6" ||
      code === "7" ||
      code === "28" ||
      code === "35" ||
      code === "52" ||
      code === "56" ||
      code === "ECONNRESET" ||
      code === "ETIMEDOUT" ||
      code === "EAI_AGAIN" ||
      code === "ENOTFOUND" ||
      message.includes("connect timeout") ||
      message.includes("connection timed out") ||
      message.includes("headers timeout") ||
      message.includes("body timeout") ||
      message.includes("socket error") ||
      message.includes("fetch failed") ||
      message.includes("resolving timed out") ||
      message.includes("failed to connect") ||
      message.includes("couldn't connect") ||
      message.includes("could not resolve host") ||
      message.includes("empty reply from server") ||
      message.includes("proxy connect aborted")
    );
  }

  buildCookieJarText() {
    const hostname = new URL(this.baseUrl).hostname;
    const lines = ["# Netscape HTTP Cookie File"];

    for (const [name, value] of this.cookies.entries()) {
      lines.push(`${hostname}\tTRUE\t/\tFALSE\t0\t${name}\t${value}`);
    }

    return `${lines.join("\n")}\n`;
  }

  async requestTextViaCurl(url, { method, body, headers }) {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "foropencode-curl-"));
    const cookieFile = path.join(tempDir, "cookies.txt");
    const bodyFile = body ? path.join(tempDir, "request-body.json") : "";

    await fs.writeFile(cookieFile, this.buildCookieJarText(), "utf8");
    if (bodyFile) {
      await fs.writeFile(bodyFile, JSON.stringify(body), { encoding: "utf8", mode: 0o600 });
      await fs.chmod(bodyFile, 0o600);
    }
    const variants = [
      { proxyUrl: this.proxyUrl, forceHttp11: false, label: this.proxyUrl ? "proxy" : "direct" },
    ];

    if (this.proxyUrl) {
      variants.push(
        { proxyUrl: this.proxyUrl, forceHttp11: true, label: "proxy-http1.1" },
        { proxyUrl: "", forceHttp11: false, label: "direct-fallback" },
      );
    }

    let lastError;
    const attemptErrors = [];

    try {
      for (const variant of variants) {
        try {
          const { stdout } = await execFileAsync(
            "curl",
            buildCurlArgs({
              url,
              method,
              bodyFile,
              headers,
              cookieFile,
              proxyUrl: variant.proxyUrl,
              forceHttp11: variant.forceHttp11,
            }),
            {
              maxBuffer: 10 * 1024 * 1024,
            },
          );

          const marker = "\n__CURL_STATUS__:";
          const markerIndex = stdout.lastIndexOf(marker);

          if (markerIndex === -1) {
            throw new Error("Curl response did not include an HTTP status marker.");
          }

          const bodyText = stdout.slice(0, markerIndex);
          const status = Number(stdout.slice(markerIndex + marker.length).trim());
          const updatedCookies = parseCookieJar(await fs.readFile(cookieFile, "utf8"));
          this.cookies = updatedCookies;

          return {
            status,
            text: bodyText,
          };
        } catch (error) {
          const detail = error?.stderr?.trim() || error?.message || "curl request failed";
          const hint =
            variant.proxyUrl && variant.proxyUrl === this.proxyUrl
              ? ` (proxy: ${variant.proxyUrl}, mode: ${variant.label})`
              : ` (mode: ${variant.label})`;
          lastError = new Error(
            `Network request to ${new URL(url).pathname} failed${hint}: ${detail}`,
            { cause: error },
          );
          attemptErrors.push(`${variant.label}: ${detail}`);

          if (!this.isTransientFetchError(error)) {
            break;
          }
        }
      }

      if (!lastError) {
        throw new Error(`Network request to ${new URL(url).pathname} failed.`);
      }

      if (attemptErrors.length > 1) {
        throw new Error(
          `Network request to ${new URL(url).pathname} failed after ${attemptErrors.length} attempts: ${attemptErrors.join(" | ")}`,
          { cause: lastError },
        );
      }

      throw lastError;
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }

  get cookieHeader() {
    return [...this.cookies.entries()]
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }

  rememberCookies(response) {
    for (const cookie of extractSetCookies(response.headers)) {
      const [pair, ...attributes] = cookie.split(";");
      const [name, ...valueParts] = pair.split("=");

      if (!name || valueParts.length === 0) {
        continue;
      }

      const normalizedName = name.trim();
      const maxAge = attributes
        .map((attribute) => attribute.trim())
        .find((attribute) => /^max-age=/i.test(attribute));
      if (maxAge && Number(maxAge.split("=")[1]) <= 0) {
        this.cookies.delete(normalizedName);
        continue;
      }

      this.cookies.set(normalizedName, valueParts.join("=").trim());
    }
  }

  hasPasswordCredentials() {
    return Boolean(this.auth.username) && Boolean(this.auth.password);
  }

  buildUsernameFingerprint(username) {
    const normalized = String(username || "").trim();
    if (!normalized) {
      return "";
    }

    return createHash("sha256")
      .update(`${this.baseUrl}\n${normalized}`)
      .digest("hex");
  }

  get accessTokenRefreshSkewSeconds() {
    const candidate = Number(process.env.FOROPENCODE_ACCESS_TOKEN_REFRESH_SKEW_SECONDS);
    return Number.isFinite(candidate) && candidate >= 15
      ? Math.min(Math.floor(candidate), 10 * 60)
      : DEFAULT_ACCESS_TOKEN_REFRESH_SKEW_SECONDS;
  }

  accessTokenExpiryFor(authorization, explicitExpiresAt = 0) {
    const explicit = normalizeEpochSeconds(explicitExpiresAt);
    if (explicit) {
      return explicit;
    }

    return normalizeEpochSeconds(parseAccessTokenPayload(authorization).exp);
  }

  sessionIdFor(authorization, explicitSessionId = "") {
    const supplied = String(explicitSessionId || "").trim();
    if (supplied) {
      return supplied;
    }

    return String(parseAccessTokenPayload(authorization).sid || "").trim();
  }

  hasRefreshCookie() {
    return this.cookies.has(REFRESH_COOKIE_NAME);
  }

  hasRefreshablePasswordSession() {
    return this.preferPasswordLogin && this.hasRefreshCookie();
  }

  accessTokenNeedsRefresh() {
    if (!this.authorization) {
      return true;
    }

    const expiresAt = this.accessTokenExpiresAt || this.accessTokenExpiryFor(this.authorization);
    if (!expiresAt) {
      return false;
    }

    return Date.now() >= (expiresAt - this.accessTokenRefreshSkewSeconds) * 1000;
  }

  accessTokenIsExpired() {
    const expiresAt = this.accessTokenExpiresAt || this.accessTokenExpiryFor(this.authorization);
    return Boolean(expiresAt) && Date.now() >= expiresAt * 1000;
  }

  cachedSessionHasFreshAccessToken(entry) {
    if (!this.isUsableCachedSession(entry)) {
      return false;
    }

    const expiresAt = this.accessTokenExpiryFor(
      entry.authorization,
      entry.accessTokenExpiresAt,
    );
    return Boolean(expiresAt) && Date.now() < (expiresAt - this.accessTokenRefreshSkewSeconds) * 1000;
  }

  applyAuthenticationResponse(response) {
    const data = response?.data && typeof response.data === "object" ? response.data : response;
    const accessToken =
      data?.access_token ??
      data?.accessToken ??
      data?.token ??
      response?.access_token ??
      response?.accessToken ??
      response?.token;

    if (!accessToken) {
      throw new Error("Authentication response did not contain an access token.");
    }

    this.authorization = normalizeAuthorization(String(accessToken));

    const userId =
      data?.id ??
      data?.user?.id ??
      response?.user?.id ??
      response?.id;
    if (userId !== undefined && userId !== null && userId !== "") {
      this.userId = String(userId).trim();
    }

    this.sessionId = this.sessionIdFor(
      this.authorization,
      data?.session?.sid ?? data?.session?.session_id ?? data?.sessionId,
    );
    this.accessTokenExpiresAt = this.accessTokenExpiryFor(
      this.authorization,
      data?.access_expires_at ?? data?.accessExpiresAt,
    );
  }

  emptySessionCache() {
    return {
      version: SESSION_CACHE_VERSION,
      accounts: {},
    };
  }

  async readSessionCache() {
    if (!this.sessionCacheFile || !this.accountId) {
      return this.emptySessionCache();
    }

    try {
      const parsed = JSON.parse(await fs.readFile(this.sessionCacheFile, "utf8"));
      if (!parsed || typeof parsed !== "object") {
        return this.emptySessionCache();
      }

      return {
        version: SESSION_CACHE_VERSION,
        accounts: parsed.accounts && typeof parsed.accounts === "object"
          ? parsed.accounts
          : {},
      };
    } catch (error) {
      if (error?.code === "ENOENT") {
        return this.emptySessionCache();
      }

      // A damaged local cache must not prevent a fresh password login.
      return this.emptySessionCache();
    }
  }

  async writeSessionCache(cache) {
    if (!this.sessionCacheFile || !this.accountId) {
      return;
    }

    await fs.mkdir(path.dirname(this.sessionCacheFile), { recursive: true });
    const temporaryFile = `${this.sessionCacheFile}.${process.pid}.tmp`;
    const serialized = `${JSON.stringify({
      version: SESSION_CACHE_VERSION,
      accounts: cache.accounts && typeof cache.accounts === "object" ? cache.accounts : {},
    }, null, 2)}\n`;
    try {
      await fs.writeFile(
        temporaryFile,
        serialized,
        { encoding: "utf8", mode: 0o600 },
      );
      await fs.chmod(temporaryFile, 0o600);
      await fs.rename(temporaryFile, this.sessionCacheFile);
    } finally {
      await fs.rm(temporaryFile, { force: true });
    }
    await fs.chmod(this.sessionCacheFile, 0o600);
  }

  async withSessionCacheLock(worker) {
    if (!this.sessionCacheFile || !this.accountId) {
      return worker();
    }

    const lockFile = `${this.sessionCacheFile}.lock`;
    await fs.mkdir(path.dirname(this.sessionCacheFile), { recursive: true });
    const deadline = Date.now() + SESSION_LOCK_WAIT_MS;
    let handle;

    while (!handle) {
      try {
        handle = await fs.open(lockFile, "wx", 0o600);
        await handle.writeFile(`${process.pid}\n`, "utf8");
        await handle.close();
      } catch (error) {
        await handle?.close().catch(() => {});
        handle = undefined;

        if (error?.code !== "EEXIST") {
          throw error;
        }

        try {
          const stat = await fs.stat(lockFile);
          if (Date.now() - stat.mtimeMs > SESSION_LOCK_STALE_MS) {
            await fs.rm(lockFile, { force: true });
            continue;
          }
        } catch (statError) {
          if (statError?.code !== "ENOENT") {
            throw statError;
          }
        }

        if (Date.now() >= deadline) {
          throw new Error("Timed out waiting for the local authentication session lock.");
        }
        await sleep(100);
      }
    }

    try {
      return await worker();
    } finally {
      await fs.rm(lockFile, { force: true });
    }
  }

  isUsableCachedSession(entry) {
    if (!entry || typeof entry !== "object") {
      return false;
    }
    if (String(entry.baseUrl || "").replace(/\/+$/, "") !== this.baseUrl) {
      return false;
    }
    if (this.userId && entry.userId && String(entry.userId) !== this.userId) {
      return false;
    }
    if (this.usernameFingerprint && entry.usernameFingerprint !== this.usernameFingerprint) {
      return false;
    }

    return Boolean(String(entry.cookie || "").trim() || String(entry.authorization || "").trim());
  }

  applyCachedSession(entry) {
    this.cookies = parseCookieString(entry.cookie);
    this.authorization = normalizeAuthorization(entry.authorization);
    if (!this.userId && entry.userId) {
      this.userId = String(entry.userId).trim();
    }
    this.sessionId = this.sessionIdFor(this.authorization, entry.sessionId);
    this.accessTokenExpiresAt = this.accessTokenExpiryFor(
      this.authorization,
      entry.accessTokenExpiresAt,
    );
    this.sessionFromCache = true;
    this.hasLoggedIn = false;
    this.passwordLoginAttempted = false;
    this.sessionVersion += 1;
  }

  async restoreCachedSession() {
    if (this.hasInitialSessionCredentials || !this.hasPasswordCredentials()) {
      return false;
    }

    const cache = await this.readSessionCache();
    const entry = cache.accounts[this.accountId];
    if (!this.isUsableCachedSession(entry)) {
      return false;
    }

    this.applyCachedSession(entry);
    return true;
  }

  async isAutomaticRecoveryCooldownReady() {
    if (!this.allowPasswordRecovery || !this.sessionCacheFile || !this.accountId) {
      return false;
    }

    const cache = await this.readSessionCache();
    const entry = cache.accounts[this.accountId];
    return entry?.reconnectReason === "AUTH_AUTO_RECOVERY_COOLDOWN" &&
      this.isAutomaticPasswordRecoveryAllowed(entry);
  }

  sessionEntry() {
    return {
      baseUrl: this.baseUrl,
      userId: this.userId,
      usernameFingerprint: this.usernameFingerprint,
      cookie: this.cookieHeader,
      authorization: this.authorization,
      sessionId: this.sessionId || undefined,
      accessTokenExpiresAt: this.accessTokenExpiresAt || undefined,
      savedAt: new Date().toISOString(),
    };
  }

  async invalidateCachedSession() {
    if (!this.sessionCacheFile || !this.accountId) {
      return;
    }

    const currentCookie = this.cookieHeader;
    const currentAuthorization = this.authorization;
    await this.withSessionCacheLock(async () => {
      const cache = await this.readSessionCache();
      const entry = cache.accounts[this.accountId];
      const isCurrent = entry &&
        ((currentCookie && entry.cookie === currentCookie) ||
          (currentAuthorization && entry.authorization === currentAuthorization));
      if (isCurrent) {
        delete cache.accounts[this.accountId];
        await this.writeSessionCache(cache);
      }
    });
    this.sessionFromCache = false;
  }

  isSessionLimitError(error) {
    return /AUTH_SESSION_LIMIT/i.test(String(error?.message || error));
  }

  isRefreshSessionInvalidError(error) {
    return /AUTH_(?:UNAUTHORIZED|SESSION_REVOKED|SESSION_MISMATCH|REFRESH_RACE|TOKEN_EXPIRED)/i
      .test(String(error?.message || error));
  }

  passwordSessionRecoveryError(reason = "") {
    let detail = "Automatic password re-login is disabled for this recovery path to prevent AUTH_SESSION_LIMIT.";
    if (reason === "AUTH_SESSION_LIMIT") {
      detail = "The website reported AUTH_SESSION_LIMIT, so automatic password re-login is blocked to avoid creating more sessions.";
    } else if (reason === "AUTH_AUTO_RECOVERY_COOLDOWN") {
      detail = "Automatic password recovery was already attempted recently, so another password login is blocked to prevent a session loop.";
    } else if (reason === "AUTH_REFRESH_COOKIE_MISSING") {
      detail = "The cached password session has no refresh Cookie, so automatic recovery is disabled because the server has not confirmed that the old session was revoked.";
    } else if (reason === "AUTH_AUTO_RECOVERY_FAILED") {
      detail = "The last automatic password recovery failed for a reason other than AUTH_SESSION_LIMIT; automatic retries are paused until you reconnect explicitly.";
    } else if (reason === "AUTH_SESSION_REVOKED") {
      detail = "The server rejected the cached refresh session, but automatic password recovery is not enabled for this account.";
    } else if (reason === "PASSWORD_LOGIN_NOT_APPROVED") {
      detail = "Background password login is not approved for this account; use the App's reconnect action to approve one login.";
    }

    return new Error(
      `This account requires a manual reconnect. ${detail} End unwanted website sessions first, then use the App's reconnect action.`,
    );
  }

  manualReconnectEntry(reason, previousEntry = {}) {
    return {
      baseUrl: this.baseUrl,
      userId: this.userId,
      usernameFingerprint: this.usernameFingerprint,
      cookie: "",
      authorization: "",
      lastPasswordLoginAt: previousEntry.lastPasswordLoginAt,
      lastAutomaticRecoveryAt: previousEntry.lastAutomaticRecoveryAt,
      requiresManualReconnect: true,
      reconnectReason: reason,
      reconnectRequiredAt: new Date().toISOString(),
    };
  }

  clearPasswordSession() {
    this.cookies.clear();
    this.authorization = "";
    this.sessionId = "";
    this.accessTokenExpiresAt = 0;
    this.sessionFromCache = false;
  }

  isAutomaticPasswordRecoveryAllowed(entry) {
    const isTemporaryCooldown = entry?.reconnectReason === "AUTH_AUTO_RECOVERY_COOLDOWN";
    if (!this.allowPasswordRecovery || (entry?.requiresManualReconnect && !isTemporaryCooldown)) {
      return false;
    }

    // A server-revoked refresh session is the one case where a replacement
    // login is useful. Do not penalize a recent manual reconnect: it may have
    // been invalidated immediately by the server. The cooldown applies to
    // automated replacements only, so a broken endpoint can never create a
    // password-login loop.
    const lastAttempt = entry?.lastAutomaticRecoveryAt;
    const timestamp = Date.parse(String(lastAttempt || ""));
    return !Number.isFinite(timestamp) || Date.now() - timestamp >= AUTOMATIC_PASSWORD_RECOVERY_COOLDOWN_MS;
  }

  async persistSession(cache, { passwordLogin = false, automaticRecovery = false } = {}) {
    if (!this.sessionCacheFile || !this.accountId) {
      return;
    }

    const previousEntry = cache.accounts[this.accountId] || {};
    const entry = {
      ...this.sessionEntry(),
    };
    const now = new Date().toISOString();

    if (previousEntry.lastPasswordLoginAt) {
      entry.lastPasswordLoginAt = previousEntry.lastPasswordLoginAt;
    }
    if (previousEntry.lastAutomaticRecoveryAt) {
      entry.lastAutomaticRecoveryAt = previousEntry.lastAutomaticRecoveryAt;
    }
    if (passwordLogin) {
      entry.lastPasswordLoginAt = now;
    }
    if (automaticRecovery) {
      entry.lastAutomaticRecoveryAt = now;
    }

    cache.accounts[this.accountId] = entry;
    await this.writeSessionCache(cache);
  }

  async markPasswordSessionForManualReconnect(reason) {
    if (!this.sessionCacheFile || !this.accountId) {
      return reason;
    }

    return this.withSessionCacheLock(async () => {
      const cache = await this.readSessionCache();
      const entry = cache.accounts[this.accountId];
      if (entry?.requiresManualReconnect) {
        return entry.reconnectReason || reason;
      }

      cache.accounts[this.accountId] = this.manualReconnectEntry(reason, entry);
      await this.writeSessionCache(cache);
      return reason;
    });
  }

  async refreshPasswordSession({ force = false } = {}) {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    if (!this.hasRefreshablePasswordSession()) {
      return false;
    }

    if (!force && !this.accessTokenNeedsRefresh()) {
      return false;
    }

    this.refreshPromise = this.performPasswordSessionRefresh({ force });
    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  async performPasswordSessionRefresh({ force }) {
    return this.withSessionCacheLock(async () => {
      const cache = await this.readSessionCache();
      const cachedEntry = cache.accounts[this.accountId];

      // Another local process may have rotated the one-time refresh cookie
      // while this process waited on the shared cache lock. Reuse its fresh
      // result instead of sending the old cookie again.
      if (this.cachedSessionHasFreshAccessToken(cachedEntry)) {
        this.applyCachedSession(cachedEntry);
        return true;
      }

      // A concurrent local request may have already found that this server
      // session is no longer valid. Do not send its old rotating refresh
      // cookie again after the shared lock becomes available.
      if (cachedEntry?.requiresManualReconnect || cachedEntry?.loginBlockedReason === "AUTH_SESSION_LIMIT") {
        if (
          cachedEntry.reconnectReason === "AUTH_AUTO_RECOVERY_COOLDOWN" &&
          this.isAutomaticPasswordRecoveryAllowed(cachedEntry)
        ) {
          await this.performPasswordLoginWithCache(cache, { automaticRecovery: true });
          return true;
        }
        this.clearPasswordSession();
        throw this.passwordSessionRecoveryError(cachedEntry?.reconnectReason);
      }

      if (
        this.isUsableCachedSession(cachedEntry) &&
        (cachedEntry.cookie !== this.cookieHeader || cachedEntry.authorization !== this.authorization)
      ) {
        this.applyCachedSession(cachedEntry);
      }

      if (!this.hasRefreshablePasswordSession()) {
        return false;
      }

      if (!force && !this.accessTokenNeedsRefresh()) {
        return false;
      }

      const refreshHeaders = {
        Origin: this.baseUrl,
      };
      if (this.sessionId) {
        refreshHeaders["X-Auth-Session"] = this.sessionId;
      }

      try {
        const response = await this.requestJson(AUTH_REFRESH_PATH, {
          method: "POST",
          authRequired: false,
          maxAttempts: 1,
          extraHeaders: refreshHeaders,
        });

        if (!response?.success) {
          const detail = [response?.code, response?.message]
            .filter((value) => value !== undefined && value !== null && String(value).trim())
            .map(String)
            .join(": ") || "Session refresh failed.";
          throw new Error(detail);
        }

        this.applyAuthenticationResponse(response);
        this.hasLoggedIn = false;
        this.sessionFromCache = false;
        this.sessionVersion += 1;
        await this.persistSession(cache);
        return true;
      } catch (error) {
        if (this.isSessionLimitError(error)) {
          cache.accounts[this.accountId] = this.manualReconnectEntry("AUTH_SESSION_LIMIT", cachedEntry);
          await this.writeSessionCache(cache);
          this.clearPasswordSession();
          throw this.passwordSessionRecoveryError("AUTH_SESSION_LIMIT");
        }

        if (!this.isRefreshSessionInvalidError(error)) {
          throw error;
        }

        if (this.isAutomaticPasswordRecoveryAllowed(cachedEntry)) {
          try {
            await this.performPasswordLoginWithCache(cache, { automaticRecovery: true });
            return true;
          } catch (recoveryError) {
            if (!this.isSessionLimitError(recoveryError)) {
              cache.accounts[this.accountId] = this.manualReconnectEntry(
                "AUTH_AUTO_RECOVERY_FAILED",
                cachedEntry,
              );
              await this.writeSessionCache(cache);
            }
            this.clearPasswordSession();
            throw recoveryError;
          }
        }

        const reason = this.allowPasswordRecovery
          ? "AUTH_AUTO_RECOVERY_COOLDOWN"
          : "AUTH_SESSION_REVOKED";
        cache.accounts[this.accountId] = this.manualReconnectEntry(reason, cachedEntry);
        await this.writeSessionCache(cache);
        this.clearPasswordSession();
        throw this.passwordSessionRecoveryError(reason);
      }
    });
  }

  async recoverExpiredPasswordSessionWithoutRefreshCookie() {
    return this.withSessionCacheLock(async () => {
      const cache = await this.readSessionCache();
      const cachedEntry = cache.accounts[this.accountId];

      // There is no server-side evidence that the prior session was revoked
      // when a cache only contains an expired access token. Quarantine this
      // legacy state instead of logging in again; doing so could add a second
      // active session. Automatic recovery is reserved for an explicit failed
      // refresh above.
      cache.accounts[this.accountId] = this.manualReconnectEntry(
        "AUTH_REFRESH_COOKIE_MISSING",
        cachedEntry,
      );
      await this.writeSessionCache(cache);
      this.clearPasswordSession();
      throw this.passwordSessionRecoveryError("AUTH_REFRESH_COOKIE_MISSING");
    });
  }

  authenticationError(path, message) {
    if (this.hasInitialSessionCredentials) {
      return new Error(
        `Authentication failed for ${path}: ${message}. The supplied Cookie or Bearer session was rejected; password login was not attempted. Update the session credentials and New-Api-User value.`,
      );
    }

    return new Error(`Authentication failed for ${path}: ${message}`);
  }

  async requestJson(path, {
    method = "GET",
    body,
    authRequired = true,
    retried = false,
    attempt = 1,
    maxAttempts = 3,
    extraHeaders = {},
  } = {}) {
    if (authRequired) {
      await this.ensureAuthenticated();
    }

    const sessionVersionAtRequest = this.sessionVersion;

    const headers = {
      Accept: "application/json",
      ...extraHeaders,
    };

    if (body) {
      headers["Content-Type"] = "application/json";
    }

    if (this.cookies.size > 0) {
      headers.Cookie = this.cookieHeader;
    }

    if (this.userId) {
      headers["New-Api-User"] = this.userId;
    }

    if (this.authorization) {
      headers.Authorization = this.authorization;
    }

    let status;
    let text;

    try {
      if (this.proxyUrl) {
        const curlResponse = await this.requestTextViaCurl(`${this.baseUrl}${path}`, {
          method,
          body,
          headers,
        });
        status = curlResponse.status;
        text = curlResponse.text;
      } else {
        const response = await fetch(`${this.baseUrl}${path}`, {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
          redirect: "manual",
        });

        this.rememberCookies(response);
        status = response.status;
        text = await response.text();
      }
    } catch (error) {
      if (this.isTransientFetchError(error) && attempt < maxAttempts) {
        await sleep(attempt * 1500);
        return this.requestJson(path, {
          method,
          body,
          authRequired,
          retried,
          attempt: attempt + 1,
          maxAttempts,
          extraHeaders,
        });
      }

      const detail = error?.cause?.message || error?.cause?.code || error?.message || "unknown network error";
      throw new Error(`Network request to ${path} failed: ${detail}`, { cause: error });
    }

    if (status >= 300 && status < 400) {
      const sessionWasRefreshed =
        authRequired &&
        !retried &&
        !this.hasInitialSessionCredentials &&
        this.hasPasswordCredentials() &&
        this.sessionVersion !== sessionVersionAtRequest;

      if (sessionWasRefreshed) {
        return this.requestJson(path, {
          method,
          body,
          authRequired,
          retried: true,
          attempt,
          maxAttempts,
          extraHeaders,
        });
      }

      const canRetryWithRefresh =
        authRequired &&
        !retried &&
        !this.hasInitialSessionCredentials &&
        this.hasPasswordCredentials();

      if (canRetryWithRefresh && await this.refreshPasswordSession({ force: true })) {
        return this.requestJson(path, {
          method,
          body,
          authRequired,
          retried: true,
          attempt,
          maxAttempts,
          extraHeaders,
        });
      }

      throw this.authenticationError(
        path,
        "Unexpected redirect. A valid session cookie is probably required",
      );
    }
    let json;

    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(`Expected JSON from ${path}, received: ${text.slice(0, 200)}`);
    }

    if (status === 401) {
      const message = [json?.code, json?.message]
        .filter((value) => value !== undefined && value !== null && String(value).trim())
        .map(String)
        .join(": ") || "Unauthorized";
      const sessionWasRefreshed =
        authRequired &&
        !retried &&
        !this.hasInitialSessionCredentials &&
        this.hasPasswordCredentials() &&
        this.sessionVersion !== sessionVersionAtRequest;

      if (sessionWasRefreshed) {
        return this.requestJson(path, {
          method,
          body,
          authRequired,
          retried: true,
          attempt,
          maxAttempts,
          extraHeaders,
        });
      }

      const canRetryWithRefresh =
        authRequired &&
        !retried &&
        !this.hasInitialSessionCredentials &&
        this.hasPasswordCredentials();

      if (canRetryWithRefresh && await this.refreshPasswordSession({ force: true })) {
        return this.requestJson(path, {
          method,
          body,
          authRequired,
          retried: true,
          attempt,
          maxAttempts,
          extraHeaders,
        });
      }

      if (/New-Api-User header not provided/i.test(message)) {
        if (this.hasInitialSessionCredentials) {
          throw this.authenticationError(path, message);
        }

        throw new Error(
          `Authentication failed for ${path}: ${message}. Set FOROPENCODE_USER_ID to the browser's localStorage uid or the request header value new-api-user.`,
        );
      }

      throw this.authenticationError(path, message);
    }

    if (status < 200 || status >= 300) {
      const errorDetail = [json?.code, json?.message]
        .filter((value) => value !== undefined && value !== null && String(value).trim())
        .map(String)
        .join(": ") || `HTTP ${status}`;
      throw new Error(`Request to ${path} failed: ${errorDetail}`);
    }

    return json;
  }

  async fetchStatus() {
    return this.requestJson("/api/status", { authRequired: false });
  }

  async fetchSelf() {
    return this.requestJson("/api/user/self");
  }

  async fetchSelfGroups() {
    return this.requestJson("/api/user/self/groups");
  }

  async fetchAPIKeysPage({ page = 1, pageSize = 100 } = {}) {
    const query = new URLSearchParams({
      p: String(page),
      size: String(pageSize),
    });

    return this.requestJson(`/api/token/?${query.toString()}`);
  }

  async fetchAllAPIKeys({ pageSize = 100 } = {}) {
    const firstResponse = await this.fetchAPIKeysPage({ page: 1, pageSize });

    if (!firstResponse?.success) {
      throw new Error(firstResponse?.message || "API key request failed on page 1.");
    }

    const firstPageItems = Array.isArray(firstResponse?.data?.items)
      ? firstResponse.data.items
      : [];
    const total = toNumber(firstResponse?.data?.total, firstPageItems.length);
    const pageCount = Math.ceil(total / pageSize);

    if (firstPageItems.length === 0 || pageCount <= 1) {
      return firstPageItems;
    }

    const remainingPages = Array.from({ length: pageCount - 1 }, (_, index) => index + 2);
    const remainingItems = await mapWithConcurrency(remainingPages, 3, async (page) => {
      const response = await this.fetchAPIKeysPage({ page, pageSize });

      if (!response?.success) {
        throw new Error(response?.message || `API key request failed on page ${page}.`);
      }

      return Array.isArray(response?.data?.items) ? response.data.items : [];
    });

    return [...firstPageItems, ...remainingItems.flat()].slice(0, total);
  }

  async revealAPIKey(id) {
    return this.requestJson(`/api/token/${encodeURIComponent(id)}/key`, { method: "POST" });
  }

  async revealAPIKeys(ids) {
    const normalizedIds = [...new Set(
      ids
        .map((id) => Number(id))
        .filter((id) => Number.isInteger(id)),
    )];
    if (normalizedIds.length === 0) {
      return {};
    }

    const response = await this.requestJson("/api/token/batch/keys", {
      method: "POST",
      body: { ids: normalizedIds },
    });

    if (!response?.success) {
      throw new Error(response?.message || "API key reveal request failed.");
    }

    return response?.data?.keys && typeof response.data.keys === "object"
      ? response.data.keys
      : {};
  }

  async updateAPIKey(payload) {
    return this.requestJson("/api/token/", {
      method: "PUT",
      body: payload,
    });
  }

  async login({ automaticRecovery = false } = {}) {
    if (this.loginPromise) {
      return this.loginPromise;
    }

    const hasSessionCredentials = this.cookies.size > 0 || Boolean(this.authorization);
    if (this.hasLoggedIn || hasSessionCredentials) {
      return;
    }

    this.loginPromise = this.performLogin({ automaticRecovery });
    try {
      await this.loginPromise;
    } finally {
      this.loginPromise = null;
    }
  }

  async reconnectWithPassword() {
    if (!this.hasPasswordCredentials()) {
      throw new Error(
        "Missing authentication. Set FOROPENCODE_USERNAME and FOROPENCODE_PASSWORD before reconnecting.",
      );
    }
    if (!this.allowPasswordLogin) {
      throw new Error("Password reconnect was not explicitly approved for this account.");
    }

    this.passwordLoginAttempted = true;
    return this.withSessionCacheLock(async () => {
      const cache = await this.readSessionCache();
      // Clear under the same cross-process lock used by refreshes. Swift does
      // not touch this cache directly, so reconnect cannot race a token
      // rotation from a loop that is still winding down.
      delete cache.accounts[this.accountId];
      this.clearPasswordSession();
      await this.performPasswordLoginWithCache(cache, { forcePasswordLogin: true });
    });
  }

  async performLogin({ automaticRecovery = false } = {}) {
    if (this.hasInitialSessionCredentials) {
      throw this.authenticationError(
        "/api/user/login",
        "The existing session credentials were rejected",
      );
    }

    if (!this.hasPasswordCredentials()) {
      throw new Error(
        "Missing authentication. Set FOROPENCODE_AUTHORIZATION, FOROPENCODE_ACCESS_TOKEN, FOROPENCODE_COOKIE, or FOROPENCODE_USERNAME/FOROPENCODE_PASSWORD.",
      );
    }

    if (!this.allowPasswordLogin && !automaticRecovery) {
      await this.markPasswordSessionForManualReconnect("PASSWORD_LOGIN_NOT_APPROVED");
      throw this.passwordSessionRecoveryError();
    }

    this.passwordLoginAttempted = true;
    return this.withSessionCacheLock(async () => {
      const cache = await this.readSessionCache();
      await this.performPasswordLoginWithCache(cache, { automaticRecovery });
    });
  }

  async performPasswordLoginWithCache(
    cache,
    { automaticRecovery = false, forcePasswordLogin = false } = {},
  ) {
    const cachedEntry = cache.accounts[this.accountId];
    const cooldownRecoveryAllowed = automaticRecovery &&
      cachedEntry?.reconnectReason === "AUTH_AUTO_RECOVERY_COOLDOWN" &&
      this.isAutomaticPasswordRecoveryAllowed(cachedEntry);

    if (!automaticRecovery && !forcePasswordLogin && this.isUsableCachedSession(cachedEntry)) {
      this.applyCachedSession(cachedEntry);
      return;
    }

    if (cachedEntry?.requiresManualReconnect || cachedEntry?.loginBlockedReason === "AUTH_SESSION_LIMIT") {
      if ((this.allowPasswordLogin && !automaticRecovery) || cooldownRecoveryAllowed) {
        delete cache.accounts[this.accountId];
        await this.writeSessionCache(cache);
      } else {
        throw this.passwordSessionRecoveryError(cachedEntry?.reconnectReason);
      }
    }

    if (automaticRecovery && !cooldownRecoveryAllowed && !this.isAutomaticPasswordRecoveryAllowed(cachedEntry)) {
      cache.accounts[this.accountId] = this.manualReconnectEntry(
        "AUTH_AUTO_RECOVERY_COOLDOWN",
        cachedEntry,
      );
      await this.writeSessionCache(cache);
      throw this.passwordSessionRecoveryError("AUTH_AUTO_RECOVERY_COOLDOWN");
    }

    this.clearPasswordSession();
    const loginPath = `/api/user/login?turnstile=${encodeURIComponent(this.auth.turnstileToken || "")}`;

    try {
      const response = await this.requestJson(loginPath, {
        method: "POST",
        body: {
          username: this.auth.username,
          password: this.auth.password,
        },
        authRequired: false,
      });

      if (!response?.success) {
        const detail = [response?.code, response?.message]
          .filter((value) => value !== undefined && value !== null && String(value).trim())
          .map(String)
          .join(": ") || "Login failed.";
        throw new Error(detail);
      }

      this.applyAuthenticationResponse(response);
      this.hasLoggedIn = true;
      this.sessionFromCache = false;
      this.sessionVersion += 1;
      await this.persistSession(cache, {
        passwordLogin: true,
        automaticRecovery,
      });
      this.passwordLoginAttempted = false;
    } catch (error) {
      if (this.isSessionLimitError(error)) {
        cache.accounts[this.accountId] = this.manualReconnectEntry("AUTH_SESSION_LIMIT", cachedEntry);
        await this.writeSessionCache(cache);
        this.clearPasswordSession();
        throw this.passwordSessionRecoveryError("AUTH_SESSION_LIMIT");
      }
      if (automaticRecovery) {
        cache.accounts[this.accountId] = this.manualReconnectEntry(
          "AUTH_AUTO_RECOVERY_FAILED",
          cachedEntry,
        );
        await this.writeSessionCache(cache);
      }
      throw error;
    }
  }

  async ensureAuthenticated() {
    // Prefer an explicitly supplied session unless the App requested password
    // mode. Password mode restores a local session, then rotates its refresh
    // cookie before the short-lived access token expires.
    if (this.cookies.size > 0 || this.authorization) {
      if (this.hasRefreshablePasswordSession() && this.accessTokenNeedsRefresh()) {
        await this.refreshPasswordSession();
      } else if (this.preferPasswordLogin && this.accessTokenIsExpired()) {
        // Legacy password caches can be recovered once only when automatic
        // recovery was explicitly enabled for the App-managed account.
        await this.recoverExpiredPasswordSessionWithoutRefreshCookie();
      }
      return;
    }

    if (await this.restoreCachedSession()) {
      await this.ensureAuthenticated();
      return;
    }

    if (this.hasPasswordCredentials()) {
      if (await this.isAutomaticRecoveryCooldownReady()) {
        await this.login({ automaticRecovery: true });
        return;
      }
      if (!this.allowPasswordLogin) {
        const reason = await this.markPasswordSessionForManualReconnect("PASSWORD_LOGIN_NOT_APPROVED");
        throw this.passwordSessionRecoveryError(reason);
      }
      await this.login();
      return;
    }

    await this.login();
  }

  async fetchUsageLogsPage({ scope, page, pageSize, startTimestamp, endTimestamp, type = 2 }) {
    const basePath = scope === "admin" ? "/api/log" : "/api/log/self";
    const query = new URLSearchParams({
      p: String(page),
      page_size: String(pageSize),
      type: String(type),
    });

    if (typeof startTimestamp === "number") {
      query.set("start_timestamp", String(Math.floor(startTimestamp)));
    }

    if (typeof endTimestamp === "number") {
      query.set("end_timestamp", String(Math.floor(endTimestamp)));
    }

    return this.requestJson(`${basePath}?${query.toString()}`);
  }

  async fetchAllUsageLogsForWindow({ scope, pageSize, startTimestamp, endTimestamp, type = 2 }) {
    const firstResponse = await this.fetchUsageLogsPage({
      scope,
      page: 1,
      pageSize,
      startTimestamp,
      endTimestamp,
      type,
    });

    if (!firstResponse?.success) {
      throw new Error(firstResponse?.message || "Usage log request failed on page 1.");
    }

    const firstPageItems = Array.isArray(firstResponse?.data?.items)
      ? firstResponse.data.items
      : [];
    const total = toNumber(firstResponse?.data?.total, firstPageItems.length);
    const pageCount = Math.ceil(total / pageSize);

    if (firstPageItems.length === 0 || pageCount <= 1) {
      return firstPageItems;
    }

    const remainingPages = Array.from({ length: pageCount - 1 }, (_, index) => index + 2);
    const remainingItems = await mapWithConcurrency(remainingPages, 4, async (page) => {
      const response = await this.fetchUsageLogsPage({
        scope,
        page,
        pageSize,
        startTimestamp,
        endTimestamp,
        type,
      });

      if (!response?.success) {
        throw new Error(response?.message || `Usage log request failed on page ${page}.`);
      }

      return Array.isArray(response?.data?.items) ? response.data.items : [];
    });

    return [...firstPageItems, ...remainingItems.flat()].slice(0, total);
  }
}
