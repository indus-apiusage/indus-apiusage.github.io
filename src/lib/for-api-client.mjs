import { toNumber } from "./utils.mjs";

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

export class ForApiClient {
  constructor({ baseUrl, auth }) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.auth = auth;
    this.cookies = parseCookieString(auth.cookie);
    this.hasLoggedIn = false;
    this.userId = String(auth.userId || "").trim();
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

  async requestJson(path, { method = "GET", body, authRequired = true, retried = false } = {}) {
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

    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      redirect: "manual",
    });

    this.rememberCookies(response);

    if (response.status >= 300 && response.status < 400) {
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
        });
      }

      throw new Error(`Unexpected redirect while requesting ${path}. A valid session cookie is probably required.`);
    }

    const text = await response.text();
    let json;

    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(`Expected JSON from ${path}, received: ${text.slice(0, 200)}`);
    }

    if (response.status === 401) {
      const message = json?.message || response.statusText;
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
        });
      }

      if (/New-Api-User header not provided/i.test(message)) {
        throw new Error(
          `Authentication failed for ${path}: ${message}. Set FOROPENCODE_USER_ID to the browser's localStorage uid or the request header value new-api-user.`,
        );
      }

      throw new Error(`Authentication failed for ${path}: ${message}`);
    }

    if (!response.ok) {
      throw new Error(`Request to ${path} failed: ${json?.message || response.statusText}`);
    }

    return json;
  }

  async fetchStatus() {
    return this.requestJson("/api/status", { authRequired: false });
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
