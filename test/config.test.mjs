import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { loadRuntimeConfig } from "../src/lib/config.mjs";

test("loadRuntimeConfig reads FOROPENCODE_USER_ID for New-Api-User auth", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "foropencode-config-"));

  const runtime = await loadRuntimeConfig({
    cwd,
    env: {
      FOROPENCODE_COOKIE: "session=example",
      FOROPENCODE_USER_ID: "1143",
    },
  });

  assert.equal(runtime.auth.cookie, "session=example");
  assert.equal(runtime.auth.authorization, "");
  assert.equal(runtime.auth.userId, "1143");
  assert.equal(runtime.refreshDays, 2);
});

test("loadRuntimeConfig supports a full authorization header or a raw access token", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "foropencode-config-auth-"));

  const fullHeader = await loadRuntimeConfig({
    cwd,
    env: {
      FOROPENCODE_AUTHORIZATION: "Bearer example-token",
    },
  });
  const rawToken = await loadRuntimeConfig({
    cwd,
    env: {
      FOROPENCODE_ACCESS_TOKEN: "example-token",
    },
  });

  assert.equal(fullHeader.auth.authorization, "Bearer example-token");
  assert.equal(rawToken.auth.authorization, "Bearer example-token");
});

test("loadRuntimeConfig supports two account credentials without putting them in repo config", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "foropencode-config-accounts-"));

  const runtime = await loadRuntimeConfig({
    cwd,
    env: {
      FOROPENCODE_AUTHORIZATION: "Bearer account-one",
      FOROPENCODE_USER_ID: "1479",
      FOROPENCODE_ACCOUNT_2_AUTHORIZATION: "Bearer account-two",
      FOROPENCODE_ACCOUNT_2_USER_ID: "1143",
      FOROPENCODE_ACCOUNT_2_LABEL: "备用账号",
    },
  });

  assert.deepEqual(
    runtime.accounts.map((account) => ({ id: account.id, label: account.label, userId: account.auth.userId })),
    [
      { id: "account-1", label: "账号 1", userId: "1479" },
      { id: "account-2", label: "备用账号", userId: "1143" },
    ],
  );
  assert.equal(runtime.accounts[1].auth.authorization, "Bearer account-two");
});

test("loadRuntimeConfig enables password session reuse without exposing a cache in the repo", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "foropencode-config-password-"));

  const runtime = await loadRuntimeConfig({
    cwd,
    env: {
      FOROPENCODE_USERNAME: "JunhaoCai",
      FOROPENCODE_PASSWORD: "password",
      FOROPENCODE_PREFER_PASSWORD_LOGIN: "true",
    },
  });

  assert.equal(runtime.accounts[0].auth.username, "JunhaoCai");
  assert.equal(runtime.accounts[0].auth.preferPasswordLogin, true);
  assert.equal(runtime.sessionCacheFile, "work/auth-session-cache.json");
});

test("loadRuntimeConfig limits the refresh window to the configured lookback", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "foropencode-config-refresh-"));

  const runtime = await loadRuntimeConfig({
    cwd,
    env: {
      USAGE_LOOKBACK_DAYS: "4",
      USAGE_REFRESH_DAYS: "10",
    },
  });

  assert.equal(runtime.lookbackDays, 4);
  assert.equal(runtime.refreshDays, 4);
});

test("loadRuntimeConfig falls back to committed repo mapping config", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "foropencode-config-repo-"));
  const configDir = path.join(cwd, "config");

  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(
    path.join(configDir, "people.repo.json"),
    JSON.stringify({
      timezone: "Asia/Shanghai",
      people: [
        {
          displayName: "Alice",
          tokenNames: ["cjh"],
        },
      ],
    }),
    "utf8",
  );

  const runtime = await loadRuntimeConfig({ cwd, env: {} });

  assert.equal(runtime.people.length, 1);
  assert.equal(runtime.people[0].displayName, "Alice");
  assert.deepEqual(runtime.people[0].tokenNames, ["cjh"]);
  assert.equal(runtime.people[0].personId, "alice");
});

test("loadRuntimeConfig keeps distinct token mappings when displayName cannot produce a slug", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "foropencode-config-fallback-"));
  const configDir = path.join(cwd, "config");

  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(
    path.join(configDir, "people.json"),
    JSON.stringify({
      people: [
        {
          displayName: "???",
          tokenNames: ["cjh"],
        },
        {
          displayName: "***",
          tokenNames: ["cjy"],
        },
      ],
    }),
    "utf8",
  );

  const runtime = await loadRuntimeConfig({ cwd, env: {} });

  assert.equal(runtime.people.length, 2);
  assert.deepEqual(
    runtime.people.map((person) => person.personId),
    ["cjh", "cjy"],
  );
});
