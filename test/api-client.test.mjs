import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ForApiClient } from "../src/lib/for-api-client.mjs";

function mockJsonResponse(status, body) {
  return {
    status,
    headers: {
      getSetCookie: () => [],
      get: () => null,
    },
    text: async () => JSON.stringify(body),
  };
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

test("ForApiClient cools down after an authentication session limit", async () => {
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
        auth,
        accountId: "account-1",
        sessionCacheFile,
      });
      await assert.rejects(
        () => secondClient.ensureAuthenticated(),
        /Password login is temporarily paused/,
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
        },
        accountId: "account-1",
        sessionCacheFile,
      });
      await assert.rejects(() => client.ensureAuthenticated(), /AUTH_SESSION_LIMIT/);

      const cache = JSON.parse(await fs.readFile(sessionCacheFile, "utf8"));
      assert.equal(cache.accounts["account-1"].loginBlockedReason, "AUTH_SESSION_LIMIT");
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
    "for arg in \"$@\"; do",
    "  if [ \"$previous\" = \"--data-binary\" ]; then body_arg=\"$arg\"; fi",
    "  previous=\"$arg\"",
    "done",
    "printf '%s\\n' \"$@\" > \"$FOROPENCODE_CURL_TEST_CAPTURE\"",
    "body_file=\"$(echo \"$body_arg\" | cut -c2-)\"",
    "if [ -z \"$body_file\" ] || [ ! -f \"$body_file\" ]; then exit 10; fi",
    "if ! grep -q '\"password\":\"password\"' \"$body_file\"; then exit 11; fi",
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
      },
      accountId: "account-1",
      sessionCacheFile: path.join(cwd, "auth-session-cache.json"),
    });
    await client.ensureAuthenticated();

    const curlArgs = await fs.readFile(captureFile, "utf8");
    assert.match(curlArgs, /--data-binary\n@/);
    assert.doesNotMatch(curlArgs, /password/);
    assert.equal(client.authorization, "Bearer curl-access-token");
  } finally {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await fs.rm(cwd, { recursive: true, force: true });
  }
});

test("ForApiClient shares password reauthentication across concurrent expired requests", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "foropencode-auth-retry-"));
  const sessionCacheFile = path.join(cwd, "auth-session-cache.json");
  const originalFetch = globalThis.fetch;
  let loginCalls = 0;
  let loginToken = "old-access-token";

  globalThis.fetch = async (url, options = {}) => {
    if (String(url).includes("/api/user/login")) {
      loginCalls += 1;
      return mockJsonResponse(200, {
        success: true,
        data: { access_token: loginToken, id: 1143 },
      });
    }

    const authorization = options.headers?.Authorization;
    if (authorization === "Bearer old-access-token") {
      if (String(url).includes("/groups")) {
        await new Promise((resolve) => setTimeout(resolve, 35));
      }
      return mockJsonResponse(401, { message: "Unauthorized" });
    }

    return mockJsonResponse(200, { success: true, data: {} });
  };

  try {
    await withNoProxy(async () => {
      const auth = {
        username: "JunhaoCai",
        password: "password",
        preferPasswordLogin: true,
      };
      const client = new ForApiClient({
        baseUrl: "http://example.test",
        auth,
        accountId: "account-1",
        sessionCacheFile,
      });
      await client.ensureAuthenticated();

      loginToken = "new-access-token";
      await Promise.all([client.fetchSelf(), client.fetchSelfGroups()]);

      assert.equal(loginCalls, 2);
      assert.equal(client.authorization, "Bearer new-access-token");
    });
  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(cwd, { recursive: true, force: true });
  }
});
