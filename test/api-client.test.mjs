import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ForApiClient } from "../src/lib/for-api-client.mjs";

function mockJsonResponse(status, body, { setCookies = [] } = {}) {
  return {
    status,
    headers: {
      getSetCookie: () => setCookies,
      get: (name) => (String(name).toLowerCase() === "set-cookie" ? setCookies[0] ?? null : null),
    },
    text: async () => JSON.stringify(body),
  };
}

function makeAccessToken({ sid, expiresAt, userId = 1143 }) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode({
    sid,
    sub: String(userId),
    iat: Math.floor(Date.now() / 1000),
    exp: expiresAt,
  })}.signature`;
}

async function withNoProxy(worker) {
  const originalProxy = {
    FOROPENCODE_PROXY: process.env.FOROPENCODE_PROXY,
    HTTPS_PROXY: process.env.HTTPS_PROXY,
    HTTP_PROXY: process.env.HTTP_PROXY,
    ALL_PROXY: process.env.ALL_PROXY,
  };

  process.env.FOROPENCODE_PROXY = "";
  process.env.HTTPS_PROXY = "";
  process.env.HTTP_PROXY = "";
  process.env.ALL_PROXY = "";

  try {
    return await worker();
  } finally {
    for (const [key, value] of Object.entries(originalProxy)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test("ForApiClient reads, reveals, and updates API keys through New API endpoints", async () => {
  const requests = [];
  const client = new ForApiClient({
    baseUrl: "http://example.test",
    auth: { cookie: "session=test" },
  });

  client.requestJson = async (path, options = {}) => {
    requests.push({ path, options });

    if (path === "/api/token/?p=1&size=100") {
      return {
        success: true,
        data: {
          total: 1,
          items: [{ id: 7, name: "zdy", remain_quota: 1250000 }],
        },
      };
    }

    if (path === "/api/token/batch/keys") {
      return { success: true, data: { keys: { "7": "mock-key" } } };
    }

    if (path === "/api/token/") {
      return { success: true, data: {} };
    }

    throw new Error(`Unexpected request: ${path}`);
  };

  const keys = await client.fetchAllAPIKeys();
  assert.equal(keys.length, 1);
  assert.equal(keys[0].id, 7);

  const revealed = await client.revealAPIKeys([7]);
  assert.equal(revealed["7"], "mock-key");

  await client.updateAPIKey({ id: 7, remain_quota: 1875000, unlimited_quota: false });
  assert.deepEqual(requests.at(-1), {
    path: "/api/token/",
    options: {
      method: "PUT",
      body: { id: 7, remain_quota: 1875000, unlimited_quota: false },
    },
  });
});

test("ForApiClient prefers an existing cookie over password login", async () => {
  const client = new ForApiClient({
    baseUrl: "http://example.test",
    auth: {
      cookie: "session=browser-session",
      username: "JunhaoCai",
      password: "password",
    },
  });

  let loginCalled = false;
  client.login = async () => {
    loginCalled = true;
  };

  await client.ensureAuthenticated();
  assert.equal(loginCalled, false);
});

test("ForApiClient does not replace an expired session with a password login", async () => {
  const client = new ForApiClient({
    baseUrl: "http://example.test",
    auth: {
      cookie: "session=expired-session",
      authorization: "Bearer expired-token",
      userId: "1143",
      username: "JunhaoCai",
      password: "password",
    },
  });

  const originalFetch = globalThis.fetch;
  const originalProxy = {
    FOROPENCODE_PROXY: process.env.FOROPENCODE_PROXY,
    HTTPS_PROXY: process.env.HTTPS_PROXY,
    HTTP_PROXY: process.env.HTTP_PROXY,
    ALL_PROXY: process.env.ALL_PROXY,
  };
  let loginCalls = 0;

  process.env.FOROPENCODE_PROXY = "";
  process.env.HTTPS_PROXY = "";
  process.env.HTTP_PROXY = "";
  process.env.ALL_PROXY = "";
  globalThis.fetch = async (url) => {
    if (String(url).includes("/api/user/login")) {
      loginCalls += 1;
    }

    return {
      status: 401,
      headers: {
        getSetCookie: () => [],
        get: () => null,
      },
      text: async () => JSON.stringify({ message: "Unauthorized" }),
    };
  };

  try {
    await assert.rejects(
      () => client.requestJson("/api/user/self"),
      /password login was not attempted/,
    );
    assert.equal(loginCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(originalProxy)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test("ForApiClient only opens a password session after an explicit reconnect approval", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "foropencode-auth-explicit-reconnect-"));
  const sessionCacheFile = path.join(cwd, "auth-session-cache.json");
  const originalFetch = globalThis.fetch;
  let loginCalls = 0;

  globalThis.fetch = async (url) => {
    if (String(url).includes("/api/user/login")) {
      loginCalls += 1;
      return mockJsonResponse(200, {
        success: true,
        data: { access_token: "explicit-access-token", id: 1143 },
      });
    }

    return mockJsonResponse(200, { success: true, data: {} });
  };

  try {
    await withNoProxy(async () => {
      const automaticAuth = {
        username: "JunhaoCai",
        password: "password",
        preferPasswordLogin: true,
      };
      const automaticClient = new ForApiClient({
        baseUrl: "http://example.test",
        auth: automaticAuth,
        accountId: "account-1",
        sessionCacheFile,
      });

      await assert.rejects(
        () => automaticClient.ensureAuthenticated(),
        /requires a manual reconnect/,
      );
      assert.equal(loginCalls, 0);

      const blockedCache = JSON.parse(await fs.readFile(sessionCacheFile, "utf8"));
      assert.equal(blockedCache.accounts["account-1"].requiresManualReconnect, true);
      assert.equal(blockedCache.accounts["account-1"].reconnectReason, "PASSWORD_LOGIN_NOT_APPROVED");

      const reconnectClient = new ForApiClient({
        baseUrl: "http://example.test",
        auth: { ...automaticAuth, allowPasswordLogin: true },
        accountId: "account-1",
        sessionCacheFile,
      });
      await reconnectClient.ensureAuthenticated();
      assert.equal(loginCalls, 1);

      const backgroundClient = new ForApiClient({
        baseUrl: "http://example.test",
        auth: automaticAuth,
        accountId: "account-1",
        sessionCacheFile,
      });
      await backgroundClient.ensureAuthenticated();
      assert.equal(loginCalls, 1);
    });
  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(cwd, { recursive: true, force: true });
  }
});

test("ForApiClient reuses a password session across client instances", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "foropencode-auth-cache-"));
  const sessionCacheFile = path.join(cwd, "auth-session-cache.json");
  const originalFetch = globalThis.fetch;
  let loginCalls = 0;

  globalThis.fetch = async (url) => {
    if (String(url).includes("/api/user/login")) {
      loginCalls += 1;
      return mockJsonResponse(200, {
        success: true,
        data: { access_token: "cached-access-token", id: 1143 },
      });
    }

    return mockJsonResponse(200, { success: true, data: {} });
  };

  try {
    await withNoProxy(async () => {
      const auth = {
        username: "JunhaoCai",
        password: "password",
        preferPasswordLogin: true,
        allowPasswordLogin: true,
      };
      const firstClient = new ForApiClient({
        baseUrl: "http://example.test",
        auth,
        accountId: "account-1",
        sessionCacheFile,
      });
      await firstClient.ensureAuthenticated();

      const secondClient = new ForApiClient({
        baseUrl: "http://example.test",
        auth: { ...auth, allowPasswordLogin: false },
        accountId: "account-1",
        sessionCacheFile,
      });
      await secondClient.ensureAuthenticated();
      await secondClient.fetchSelf();

      assert.equal(loginCalls, 1);
      assert.equal(secondClient.authorization, "Bearer cached-access-token");
      const cache = JSON.parse(await fs.readFile(sessionCacheFile, "utf8"));
      assert.equal(cache.accounts["account-1"].authorization, "Bearer cached-access-token");
    });
  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(cwd, { recursive: true, force: true });
  }
});

test("ForApiClient serializes concurrent password logins per account", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "foropencode-auth-lock-"));
  const sessionCacheFile = path.join(cwd, "auth-session-cache.json");
  const originalFetch = globalThis.fetch;
  let loginCalls = 0;

  globalThis.fetch = async (url) => {
    if (String(url).includes("/api/user/login")) {
      loginCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 25));
      return mockJsonResponse(200, {
        success: true,
        data: { access_token: "locked-access-token", id: 1143 },
      });
    }

    return mockJsonResponse(200, { success: true, data: {} });
  };

  try {
    await withNoProxy(async () => {
      const auth = {
        username: "JunhaoCai",
        password: "password",
        preferPasswordLogin: true,
        allowPasswordLogin: true,
      };
      const clients = [1, 2].map(() => new ForApiClient({
        baseUrl: "http://example.test",
        auth,
        accountId: "account-1",
        sessionCacheFile,
      }));
      await Promise.all(clients.map((client) => client.ensureAuthenticated()));
      assert.equal(loginCalls, 1);
    });
  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(cwd, { recursive: true, force: true });
  }
});

test("ForApiClient requires a manual reconnect after an authentication session limit", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "foropencode-auth-cooldown-"));
  const sessionCacheFile = path.join(cwd, "auth-session-cache.json");
  const originalFetch = globalThis.fetch;
  let loginCalls = 0;

  globalThis.fetch = async () => {
    loginCalls += 1;
    return mockJsonResponse(409, { code: "AUTH_SESSION_LIMIT", message: "Conflict" });
  };

  try {
    await withNoProxy(async () => {
      const auth = {
        username: "JunhaoCai",
        password: "password",
        preferPasswordLogin: true,
        allowPasswordLogin: true,
      };
      const firstClient = new ForApiClient({
        baseUrl: "http://example.test",
        auth,
        accountId: "account-1",
        sessionCacheFile,
      });
      await assert.rejects(
        () => firstClient.ensureAuthenticated(),
        /AUTH_SESSION_LIMIT/,
      );

      const secondClient = new ForApiClient({
        baseUrl: "http://example.test",
        auth: { ...auth, allowPasswordLogin: false },
        accountId: "account-1",
        sessionCacheFile,
      });
      await assert.rejects(
        () => secondClient.ensureAuthenticated(),
        /requires a manual reconnect/,
      );
      assert.equal(loginCalls, 1);
    });
  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(cwd, { recursive: true, force: true });
  }
});

test("ForApiClient recognizes a JSON session-limit login response", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "foropencode-auth-json-limit-"));
  const sessionCacheFile = path.join(cwd, "auth-session-cache.json");
  const originalFetch = globalThis.fetch;
  let loginCalls = 0;

  globalThis.fetch = async () => {
    loginCalls += 1;
    return mockJsonResponse(200, {
      success: false,
      code: "AUTH_SESSION_LIMIT",
      message: "Conflict",
    });
  };

  try {
    await withNoProxy(async () => {
      const client = new ForApiClient({
        baseUrl: "http://example.test",
        auth: {
          username: "JunhaoCai",
          password: "password",
          preferPasswordLogin: true,
          allowPasswordLogin: true,
        },
        accountId: "account-1",
        sessionCacheFile,
      });
      await assert.rejects(() => client.ensureAuthenticated(), /AUTH_SESSION_LIMIT/);

      const cache = JSON.parse(await fs.readFile(sessionCacheFile, "utf8"));
      assert.equal(cache.accounts["account-1"].requiresManualReconnect, true);
      assert.equal(cache.accounts["account-1"].reconnectReason, "AUTH_SESSION_LIMIT");
      assert.equal(loginCalls, 1);
    });
  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(cwd, { recursive: true, force: true });
  }
});

test("ForApiClient keeps password bodies out of curl process arguments", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "foropencode-curl-body-"));
  const binDir = path.join(cwd, "bin");
  const captureFile = path.join(cwd, "curl-args.txt");
  const curlPath = path.join(binDir, "curl");
  const originalEnv = {
    FOROPENCODE_PROXY: process.env.FOROPENCODE_PROXY,
    HTTPS_PROXY: process.env.HTTPS_PROXY,
    HTTP_PROXY: process.env.HTTP_PROXY,
    ALL_PROXY: process.env.ALL_PROXY,
    PATH: process.env.PATH,
    FOROPENCODE_CURL_TEST_CAPTURE: process.env.FOROPENCODE_CURL_TEST_CAPTURE,
  };

  await fs.mkdir(binDir, { recursive: true });
  const curlScript = [
    "#!/bin/sh",
    "previous=\"\"",
    "body_arg=\"\"",
    "cookie_jar=\"\"",
    "for arg in \"$@\"; do",
    "  if [ \"$previous\" = \"--data-binary\" ]; then body_arg=\"$arg\"; fi",
    "  if [ \"$previous\" = \"--cookie-jar\" ]; then cookie_jar=\"$arg\"; fi",
    "  previous=\"$arg\"",
    "done",
    "printf '%s\\n' \"$@\" > \"$FOROPENCODE_CURL_TEST_CAPTURE\"",
    "body_file=\"$(echo \"$body_arg\" | cut -c2-)\"",
    "if [ -z \"$body_file\" ] || [ ! -f \"$body_file\" ]; then exit 10; fi",
    "if ! grep -q '\"password\":\"password\"' \"$body_file\"; then exit 11; fi",
    "if [ -z \"$cookie_jar\" ]; then exit 12; fi",
    "printf '# Netscape HTTP Cookie File\\n#HttpOnly_example.test\\tFALSE\\t/api/user/auth\\tFALSE\\t0\\tnew_api_refresh\\tcurl-refresh-token\\n' > \"$cookie_jar\"",
    "printf '{\"success\":true,\"data\":{\"access_token\":\"curl-access-token\",\"id\":1143}}\\n'",
    "printf '\\n__CURL_STATUS__:200'",
  ].join("\n");
  await fs.writeFile(curlPath, curlScript, { encoding: "utf8", mode: 0o700 });

  process.env.FOROPENCODE_PROXY = "http://proxy.test";
  delete process.env.HTTPS_PROXY;
  delete process.env.HTTP_PROXY;
  delete process.env.ALL_PROXY;
  process.env.PATH = binDir + ":" + (originalEnv.PATH || "");
  process.env.FOROPENCODE_CURL_TEST_CAPTURE = captureFile;

  try {
    const client = new ForApiClient({
      baseUrl: "http://example.test",
      auth: {
        username: "JunhaoCai",
        password: "password",
        preferPasswordLogin: true,
        allowPasswordLogin: true,
      },
      accountId: "account-1",
      sessionCacheFile: path.join(cwd, "auth-session-cache.json"),
    });
    await client.ensureAuthenticated();

    const curlArgs = await fs.readFile(captureFile, "utf8");
    assert.match(curlArgs, /--data-binary\n@/);
    assert.doesNotMatch(curlArgs, /password/);
    assert.equal(client.authorization, "Bearer curl-access-token");
    assert.match(client.cookieHeader, /new_api_refresh=curl-refresh-token/);
    const cache = JSON.parse(await fs.readFile(path.join(cwd, "auth-session-cache.json"), "utf8"));
    assert.match(cache.accounts["account-1"].cookie, /new_api_refresh=curl-refresh-token/);
  } finally {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await fs.rm(cwd, { recursive: true, force: true });
  }
});

test("ForApiClient rotates expiring password sessions without another password login", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "foropencode-auth-refresh-"));
  const sessionCacheFile = path.join(cwd, "auth-session-cache.json");
  const originalFetch = globalThis.fetch;
  const now = Math.floor(Date.now() / 1000);
  const expiringToken = makeAccessToken({ sid: "session-one", expiresAt: now + 30 });
  const refreshedToken = makeAccessToken({ sid: "session-one", expiresAt: now + 900 });
  let loginCalls = 0;
  let refreshCalls = 0;
  const protectedRequests = [];

  globalThis.fetch = async (url, options = {}) => {
    const pathName = new URL(String(url)).pathname;
    if (pathName === "/api/user/login") {
      loginCalls += 1;
      return mockJsonResponse(200, {
        success: true,
        data: {
          access_token: expiringToken,
          access_expires_at: now + 30,
          user: { id: 1143 },
          session: { sid: "session-one" },
        },
      }, {
        setCookies: ["new_api_refresh=refresh-one; Path=/api/user/auth; HttpOnly; Max-Age=3600"],
      });
    }

    if (pathName === "/api/user/auth/refresh") {
      refreshCalls += 1;
      assert.match(String(options.headers?.Cookie || ""), /new_api_refresh=refresh-one/);
      assert.equal(options.headers?.Origin, "http://example.test");
      assert.equal(options.headers?.["X-Auth-Session"], "session-one");
      await new Promise((resolve) => setTimeout(resolve, 25));
      return mockJsonResponse(200, {
        success: true,
        data: {
          access_token: refreshedToken,
          access_expires_at: now + 900,
          user: { id: 1143 },
          session: { sid: "session-one" },
        },
      }, {
        setCookies: ["new_api_refresh=refresh-two; Path=/api/user/auth; HttpOnly; Max-Age=3600"],
      });
    }

    protectedRequests.push({ pathName, authorization: options.headers?.Authorization });
    return mockJsonResponse(200, { success: true, data: {} });
  };

  try {
    await withNoProxy(async () => {
      const auth = {
        username: "JunhaoCai",
        password: "password",
        preferPasswordLogin: true,
        allowPasswordLogin: true,
      };
      const firstClient = new ForApiClient({
        baseUrl: "http://example.test",
        auth,
        accountId: "account-1",
        sessionCacheFile,
      });
      await firstClient.ensureAuthenticated();

      const secondClient = new ForApiClient({
        baseUrl: "http://example.test",
        auth,
        accountId: "account-1",
        sessionCacheFile,
      });
      const thirdClient = new ForApiClient({
        baseUrl: "http://example.test",
        auth,
        accountId: "account-1",
        sessionCacheFile,
      });
      await Promise.all([secondClient.fetchSelf(), thirdClient.fetchSelfGroups()]);

      assert.equal(loginCalls, 1);
      assert.equal(refreshCalls, 1);
      assert.equal(secondClient.authorization, `Bearer ${refreshedToken}`);
      assert.equal(thirdClient.authorization, `Bearer ${refreshedToken}`);
      assert.ok(protectedRequests.every((request) => request.authorization === `Bearer ${refreshedToken}`));

      const cache = JSON.parse(await fs.readFile(sessionCacheFile, "utf8"));
      assert.equal(cache.accounts["account-1"].authorization, `Bearer ${refreshedToken}`);
      assert.match(cache.accounts["account-1"].cookie, /new_api_refresh=refresh-two/);
      assert.equal(cache.accounts["account-1"].sessionId, "session-one");
      assert.equal(cache.accounts["account-1"].accessTokenExpiresAt, now + 900);
    });
  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(cwd, { recursive: true, force: true });
  }
});

test("ForApiClient stops concurrent refreshes after a session is revoked", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "foropencode-auth-refresh-revoked-"));
  const sessionCacheFile = path.join(cwd, "auth-session-cache.json");
  const originalFetch = globalThis.fetch;
  const now = Math.floor(Date.now() / 1000);
  const expiringToken = makeAccessToken({ sid: "revoked-session", expiresAt: now + 30 });
  let loginCalls = 0;
  let refreshCalls = 0;

  globalThis.fetch = async (url) => {
    const pathName = new URL(String(url)).pathname;
    if (pathName === "/api/user/login") {
      loginCalls += 1;
      return mockJsonResponse(200, {
        success: true,
        data: {
          access_token: expiringToken,
          access_expires_at: now + 30,
          user: { id: 1143 },
          session: { sid: "revoked-session" },
        },
      }, {
        setCookies: ["new_api_refresh=revoked-refresh; Path=/api/user/auth; HttpOnly; Max-Age=3600"],
      });
    }

    if (pathName === "/api/user/auth/refresh") {
      refreshCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 25));
      return mockJsonResponse(401, {
        success: false,
        code: "AUTH_SESSION_REVOKED",
        message: "Unauthorized",
      });
    }

    throw new Error(`Unexpected protected request after a revoked refresh session: ${pathName}`);
  };

  try {
    await withNoProxy(async () => {
      const auth = {
        username: "JunhaoCai",
        password: "password",
        preferPasswordLogin: true,
        allowPasswordLogin: true,
      };
      const firstClient = new ForApiClient({
        baseUrl: "http://example.test",
        auth,
        accountId: "account-1",
        sessionCacheFile,
      });
      await firstClient.ensureAuthenticated();

      const secondClient = new ForApiClient({
        baseUrl: "http://example.test",
        auth,
        accountId: "account-1",
        sessionCacheFile,
      });
      const thirdClient = new ForApiClient({
        baseUrl: "http://example.test",
        auth,
        accountId: "account-1",
        sessionCacheFile,
      });
      const outcomes = await Promise.allSettled([
        secondClient.fetchSelf(),
        thirdClient.fetchSelfGroups(),
      ]);

      assert.ok(outcomes.every((outcome) => outcome.status === "rejected"));
      assert.ok(outcomes.every((outcome) =>
        /Automatic password re-login is disabled/.test(String(outcome.reason?.message || "")),
      ));

      assert.equal(loginCalls, 1);
      assert.equal(refreshCalls, 1);
      const cache = JSON.parse(await fs.readFile(sessionCacheFile, "utf8"));
      assert.equal(cache.accounts["account-1"].requiresManualReconnect, true);
      assert.equal(cache.accounts["account-1"].reconnectReason, "AUTH_SESSION_REVOKED");
    });
  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(cwd, { recursive: true, force: true });
  }
});

test("ForApiClient quarantines legacy password caches that lack a refresh cookie", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "foropencode-auth-legacy-cache-"));
  const sessionCacheFile = path.join(cwd, "auth-session-cache.json");
  const originalFetch = globalThis.fetch;
  const now = Math.floor(Date.now() / 1000);
  const expiringToken = makeAccessToken({ sid: "legacy-session", expiresAt: now - 1 });
  let loginCalls = 0;

  globalThis.fetch = async (url) => {
    const pathName = new URL(String(url)).pathname;
    if (pathName === "/api/user/login") {
      loginCalls += 1;
      // Simulate a cache written by the pre-refresh-cookie client.
      return mockJsonResponse(200, {
        success: true,
        data: {
          access_token: expiringToken,
          access_expires_at: now - 1,
          user: { id: 1143 },
          session: { sid: "legacy-session" },
        },
      });
    }

    throw new Error(`Unexpected request from a legacy cache: ${pathName}`);
  };

  try {
    await withNoProxy(async () => {
      const auth = {
        username: "JunhaoCai",
        password: "password",
        preferPasswordLogin: true,
        allowPasswordLogin: true,
        allowPasswordRecovery: true,
      };
      const firstClient = new ForApiClient({
        baseUrl: "http://example.test",
        auth,
        accountId: "account-1",
        sessionCacheFile,
      });
      await firstClient.ensureAuthenticated();

      const secondClient = new ForApiClient({
        baseUrl: "http://example.test",
        auth,
        accountId: "account-1",
        sessionCacheFile,
      });
      await assert.rejects(
        () => secondClient.fetchSelf(),
        /requires a manual reconnect/,
      );

      assert.equal(loginCalls, 1);
      const cache = JSON.parse(await fs.readFile(sessionCacheFile, "utf8"));
      assert.equal(cache.accounts["account-1"].requiresManualReconnect, true);
      assert.equal(cache.accounts["account-1"].reconnectReason, "AUTH_REFRESH_COOKIE_MISSING");
    });
  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(cwd, { recursive: true, force: true });
  }
});

test("ForApiClient performs one locked automatic recovery after a revoked refresh session", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "foropencode-auth-auto-recovery-"));
  const sessionCacheFile = path.join(cwd, "auth-session-cache.json");
  const originalFetch = globalThis.fetch;
  const now = Math.floor(Date.now() / 1000);
  const initialToken = makeAccessToken({ sid: "revoked-session", expiresAt: now + 30 });
  const recoveredToken = makeAccessToken({ sid: "replacement-session", expiresAt: now + 900 });
  let loginCalls = 0;
  let refreshCalls = 0;
  const protectedRequests = [];

  globalThis.fetch = async (url, options = {}) => {
    const pathName = new URL(String(url)).pathname;
    if (pathName === "/api/user/login") {
      loginCalls += 1;
      const isRecovery = loginCalls === 2;
      return mockJsonResponse(200, {
        success: true,
        data: {
          access_token: isRecovery ? recoveredToken : initialToken,
          access_expires_at: isRecovery ? now + 900 : now + 30,
          user: { id: 1143 },
          session: { sid: isRecovery ? "replacement-session" : "revoked-session" },
        },
      }, {
        setCookies: [
          `new_api_refresh=${isRecovery ? "replacement-refresh" : "revoked-refresh"}; Path=/api/user/auth; HttpOnly`,
        ],
      });
    }

    if (pathName === "/api/user/auth/refresh") {
      refreshCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 25));
      return mockJsonResponse(401, {
        success: false,
        code: "AUTH_SESSION_REVOKED",
        message: "Unauthorized",
      });
    }

    protectedRequests.push(options.headers?.Authorization);
    return mockJsonResponse(200, { success: true, data: {} });
  };

  try {
    await withNoProxy(async () => {
      const initialAuth = {
        username: "JunhaoCai",
        password: "password",
        preferPasswordLogin: true,
        allowPasswordLogin: true,
        allowPasswordRecovery: true,
      };
      const firstClient = new ForApiClient({
        baseUrl: "http://example.test",
        auth: initialAuth,
        accountId: "account-1",
        sessionCacheFile,
      });
      await firstClient.ensureAuthenticated();

      const backgroundAuth = { ...initialAuth, allowPasswordLogin: false };
      const secondClient = new ForApiClient({
        baseUrl: "http://example.test",
        auth: backgroundAuth,
        accountId: "account-1",
        sessionCacheFile,
      });
      const thirdClient = new ForApiClient({
        baseUrl: "http://example.test",
        auth: backgroundAuth,
        accountId: "account-1",
        sessionCacheFile,
      });

      await Promise.all([secondClient.fetchSelf(), thirdClient.fetchSelfGroups()]);

      assert.equal(loginCalls, 2);
      assert.equal(refreshCalls, 1);
      assert.deepEqual(protectedRequests, [
        `Bearer ${recoveredToken}`,
        `Bearer ${recoveredToken}`,
      ]);

      const cache = JSON.parse(await fs.readFile(sessionCacheFile, "utf8"));
      assert.equal(cache.accounts["account-1"].authorization, `Bearer ${recoveredToken}`);
      assert.equal(cache.accounts["account-1"].requiresManualReconnect, undefined);
      assert.ok(cache.accounts["account-1"].lastAutomaticRecoveryAt);
    });
  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(cwd, { recursive: true, force: true });
  }
});

test("ForApiClient blocks automatic recovery immediately after AUTH_SESSION_LIMIT", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "foropencode-auth-auto-limit-"));
  const sessionCacheFile = path.join(cwd, "auth-session-cache.json");
  const originalFetch = globalThis.fetch;
  const now = Math.floor(Date.now() / 1000);
  const initialToken = makeAccessToken({ sid: "limited-session", expiresAt: now + 30 });
  let loginCalls = 0;
  let refreshCalls = 0;

  globalThis.fetch = async (url) => {
    const pathName = new URL(String(url)).pathname;
    if (pathName === "/api/user/login") {
      loginCalls += 1;
      if (loginCalls === 1) {
        return mockJsonResponse(200, {
          success: true,
          data: {
            access_token: initialToken,
            access_expires_at: now + 30,
            user: { id: 1143 },
            session: { sid: "limited-session" },
          },
        }, {
          setCookies: ["new_api_refresh=limited-refresh; Path=/api/user/auth; HttpOnly"],
        });
      }
      return mockJsonResponse(409, { code: "AUTH_SESSION_LIMIT", message: "Conflict" });
    }

    if (pathName === "/api/user/auth/refresh") {
      refreshCalls += 1;
      return mockJsonResponse(401, {
        success: false,
        code: "AUTH_SESSION_REVOKED",
        message: "Unauthorized",
      });
    }

    throw new Error(`Unexpected request after an automatic recovery limit: ${pathName}`);
  };

  try {
    await withNoProxy(async () => {
      const initialAuth = {
        username: "JunhaoCai",
        password: "password",
        preferPasswordLogin: true,
        allowPasswordLogin: true,
        allowPasswordRecovery: true,
      };
      const firstClient = new ForApiClient({
        baseUrl: "http://example.test",
        auth: initialAuth,
        accountId: "account-1",
        sessionCacheFile,
      });
      await firstClient.ensureAuthenticated();

      const backgroundAuth = { ...initialAuth, allowPasswordLogin: false };
      const secondClient = new ForApiClient({
        baseUrl: "http://example.test",
        auth: backgroundAuth,
        accountId: "account-1",
        sessionCacheFile,
      });
      const thirdClient = new ForApiClient({
        baseUrl: "http://example.test",
        auth: backgroundAuth,
        accountId: "account-1",
        sessionCacheFile,
      });
      const outcomes = await Promise.allSettled([
        secondClient.fetchSelf(),
        thirdClient.fetchSelfGroups(),
      ]);

      assert.ok(outcomes.every((outcome) => outcome.status === "rejected"));
      assert.ok(outcomes.every((outcome) => /AUTH_SESSION_LIMIT/.test(String(outcome.reason))));
      assert.equal(loginCalls, 2);
      assert.equal(refreshCalls, 1);

      const cache = JSON.parse(await fs.readFile(sessionCacheFile, "utf8"));
      assert.equal(cache.accounts["account-1"].requiresManualReconnect, true);
      assert.equal(cache.accounts["account-1"].reconnectReason, "AUTH_SESSION_LIMIT");
    });
  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(cwd, { recursive: true, force: true });
  }
});

test("ForApiClient does not repeat automatic recovery during its cooldown", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "foropencode-auth-auto-cooldown-"));
  const sessionCacheFile = path.join(cwd, "auth-session-cache.json");
  const originalFetch = globalThis.fetch;
  const now = Math.floor(Date.now() / 1000);
  const initialToken = makeAccessToken({ sid: "cooldown-session", expiresAt: now + 30 });
  const recoveredToken = makeAccessToken({ sid: "cooldown-replacement", expiresAt: now + 30 });
  let loginCalls = 0;
  let refreshCalls = 0;

  globalThis.fetch = async (url) => {
    const pathName = new URL(String(url)).pathname;
    if (pathName === "/api/user/login") {
      loginCalls += 1;
      const isRecovery = loginCalls === 2;
      return mockJsonResponse(200, {
        success: true,
        data: {
          access_token: isRecovery ? recoveredToken : initialToken,
          access_expires_at: now + 30,
          user: { id: 1143 },
          session: { sid: isRecovery ? "cooldown-replacement" : "cooldown-session" },
        },
      }, {
        setCookies: [
          `new_api_refresh=${isRecovery ? "cooldown-replacement-refresh" : "cooldown-refresh"}; Path=/api/user/auth; HttpOnly`,
        ],
      });
    }

    if (pathName === "/api/user/auth/refresh") {
      refreshCalls += 1;
      return mockJsonResponse(401, {
        success: false,
        code: "AUTH_SESSION_REVOKED",
        message: "Unauthorized",
      });
    }

    return mockJsonResponse(200, { success: true, data: {} });
  };

  try {
    await withNoProxy(async () => {
      const initialAuth = {
        username: "JunhaoCai",
        password: "password",
        preferPasswordLogin: true,
        allowPasswordLogin: true,
        allowPasswordRecovery: true,
      };
      const firstClient = new ForApiClient({
        baseUrl: "http://example.test",
        auth: initialAuth,
        accountId: "account-1",
        sessionCacheFile,
      });
      await firstClient.ensureAuthenticated();

      const backgroundAuth = { ...initialAuth, allowPasswordLogin: false };
      const secondClient = new ForApiClient({
        baseUrl: "http://example.test",
        auth: backgroundAuth,
        accountId: "account-1",
        sessionCacheFile,
      });
      await secondClient.fetchSelf();

      const thirdClient = new ForApiClient({
        baseUrl: "http://example.test",
        auth: backgroundAuth,
        accountId: "account-1",
        sessionCacheFile,
      });
      await assert.rejects(
        () => thirdClient.fetchSelf(),
        /Automatic password recovery was already attempted recently/,
      );

      assert.equal(loginCalls, 2);
      assert.equal(refreshCalls, 2);
      const cache = JSON.parse(await fs.readFile(sessionCacheFile, "utf8"));
      assert.equal(cache.accounts["account-1"].requiresManualReconnect, true);
      assert.equal(cache.accounts["account-1"].reconnectReason, "AUTH_AUTO_RECOVERY_COOLDOWN");
    });
  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(cwd, { recursive: true, force: true });
  }
});

test("ForApiClient reconnectWithPassword replaces a cached session under the shared lock", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "foropencode-auth-manual-reconnect-"));
  const sessionCacheFile = path.join(cwd, "auth-session-cache.json");
  const originalFetch = globalThis.fetch;
  let loginCalls = 0;

  globalThis.fetch = async (url) => {
    const pathName = new URL(String(url)).pathname;
    if (pathName !== "/api/user/login") {
      throw new Error(`Unexpected request during manual reconnect: ${pathName}`);
    }

    loginCalls += 1;
    return mockJsonResponse(200, {
      success: true,
      data: { access_token: `reconnect-token-${loginCalls}`, id: 1143 },
    }, {
      setCookies: [`new_api_refresh=reconnect-refresh-${loginCalls}; Path=/api/user/auth; HttpOnly`],
    });
  };

  try {
    await withNoProxy(async () => {
      const auth = {
        username: "JunhaoCai",
        password: "password",
        preferPasswordLogin: true,
        allowPasswordLogin: true,
      };
      const firstClient = new ForApiClient({
        baseUrl: "http://example.test",
        auth,
        accountId: "account-1",
        sessionCacheFile,
      });
      await firstClient.ensureAuthenticated();

      const reconnectClient = new ForApiClient({
        baseUrl: "http://example.test",
        auth,
        accountId: "account-1",
        sessionCacheFile,
      });
      await reconnectClient.reconnectWithPassword();

      assert.equal(loginCalls, 2);
      assert.equal(reconnectClient.authorization, "Bearer reconnect-token-2");
      const cache = JSON.parse(await fs.readFile(sessionCacheFile, "utf8"));
      assert.equal(cache.accounts["account-1"].authorization, "Bearer reconnect-token-2");
      assert.match(cache.accounts["account-1"].cookie, /new_api_refresh=reconnect-refresh-2/);
    });
  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(cwd, { recursive: true, force: true });
  }
});
