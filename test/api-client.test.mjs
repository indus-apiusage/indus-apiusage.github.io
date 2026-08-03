import test from "node:test";
import assert from "node:assert/strict";

import { ForApiClient } from "../src/lib/for-api-client.mjs";

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
