import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { toNumber } from "./utils.mjs";

const execFileAsync = promisify(execFile);

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
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

    if (!trimmed || trimmed.startsWith("#")) {
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

export class ForApiClient {
  constructor({ baseUrl, auth }) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.auth = auth;
    this.cookies = parseCookieString(auth.cookie);
    this.hasLoggedIn = false;
    this.userId = String(auth.userId || "").trim();
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

    await fs.writeFile(cookieFile, this.buildCookieJarText(), "utf8");

    const args = [
      "--silent",
      "--show-error",
      "--compressed",
      "--max-time",
      "45",
      "--connect-timeout",
      "15",
      "--request",
      method,
      "--cookie",
      cookieFile,
      "--cookie-jar",
      cookieFile,
      "--write-out",
      "\n__CURL_STATUS__:%{http_code}",
    ];

    if (this.proxyUrl) {
      args.push("--proxy", this.proxyUrl);
    }

    for (const [name, value] of Object.entries(headers)) {
      args.push("--header", `${name}: ${value}`);
    }

    if (body) {
      args.push("--data-binary", JSON.stringify(body));
    }

    args.push(url);

    try {
      const { stdout } = await execFileAsync("curl", args, {
        maxBuffer: 10 * 1024 * 1024,
      });

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
      throw new Error(`Network request to ${new URL(url).pathname} failed: ${detail}`, { cause: error });
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
      const [pair] = cookie.split(";");
      const [name, ...valueParts] = pair.split("=");

      if (!name || valueParts.length === 0) {
        continue;
      }

      this.cookies.set(name.trim(), valueParts.join("=").trim());
    }
  }

  async requestJson(path, { method = "GET", body, authRequired = true, retried = false, attempt = 1, maxAttempts = 3 } = {}) {
    if (authRequired) {
      await this.ensureAuthenticated();
    }

    const headers = {
      Accept: "application/json",
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
        });
      }

      const detail = error?.cause?.message || error?.cause?.code || error?.message || "unknown network error";
      throw new Error(`Network request to ${path} failed: ${detail}`, { cause: error });
    }

    if (status >= 300 && status < 400) {
      const canRetryWithCredentials =
        authRequired &&
        !retried &&
        Boolean(this.auth.username) &&
        Boolean(this.auth.password);

      if (canRetryWithCredentials) {
        this.cookies.clear();
        this.hasLoggedIn = false;
        await this.login();
        return this.requestJson(path, {
          method,
          body,
          authRequired,
          retried: true,
          attempt,
          maxAttempts,
        });
      }

      throw new Error(`Unexpected redirect while requesting ${path}. A valid session cookie is probably required.`);
    }
    let json;

    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(`Expected JSON from ${path}, received: ${text.slice(0, 200)}`);
    }

    if (status === 401) {
      const message = json?.message || "Unauthorized";
      const canRetryWithCredentials =
        authRequired &&
        !retried &&
        Boolean(this.auth.username) &&
        Boolean(this.auth.password);

      if (canRetryWithCredentials) {
        this.cookies.clear();
        this.hasLoggedIn = false;
        await this.login();
        return this.requestJson(path, {
          method,
          body,
          authRequired,
          retried: true,
          attempt,
          maxAttempts,
        });
      }

      if (/New-Api-User header not provided/i.test(message)) {
        throw new Error(
          `Authentication failed for ${path}: ${message}. Set FOROPENCODE_USER_ID to the browser's localStorage uid or the request header value new-api-user.`,
        );
      }

      throw new Error(`Authentication failed for ${path}: ${message}`);
    }

    if (status < 200 || status >= 300) {
      throw new Error(`Request to ${path} failed: ${json?.message || `HTTP ${status}`}`);
    }

    return json;
  }

  async fetchStatus() {
    return this.requestJson("/api/status", { authRequired: false });
  }

  async fetchSelf() {
    return this.requestJson("/api/user/self");
  }

  async login() {
    if (this.cookies.size > 0 || this.hasLoggedIn) {
      return;
    }

    if (!this.auth.username || !this.auth.password) {
      throw new Error(
        "Missing authentication. Set FOROPENCODE_COOKIE or FOROPENCODE_USERNAME/FOROPENCODE_PASSWORD.",
      );
    }

    const path = `/api/user/login?turnstile=${encodeURIComponent(this.auth.turnstileToken || "")}`;
    const response = await this.requestJson(path, {
      method: "POST",
      body: {
        username: this.auth.username,
        password: this.auth.password,
      },
      authRequired: false,
    });

    if (!response?.success) {
      throw new Error(response?.message || "Login failed.");
    }

    const userId =
      response?.data?.id ??
      response?.data?.user?.id ??
      response?.user?.id ??
      response?.id;

    if (userId !== undefined && userId !== null && userId !== "") {
      this.userId = String(userId).trim();
    }

    this.hasLoggedIn = true;
  }

  async ensureAuthenticated() {
    if (this.cookies.size > 0) {
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
    const items = [];
    let page = 1;
    let total = Infinity;

    while (items.length < total) {
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

      const pageItems = Array.isArray(response?.data?.items) ? response.data.items : [];
      const pageTotal = toNumber(response?.data?.total, pageItems.length);

      total = pageTotal;
      items.push(...pageItems);

      if (pageItems.length === 0 || items.length >= total) {
        break;
      }

      page += 1;
    }

    return items;
  }
}
