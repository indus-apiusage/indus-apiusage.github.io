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
