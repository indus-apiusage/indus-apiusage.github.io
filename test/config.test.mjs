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
  assert.equal(runtime.auth.userId, "1143");
  assert.equal(runtime.refreshDays, 2);
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
