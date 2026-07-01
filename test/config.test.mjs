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
          displayName: "蔡俊豪",
          tokenNames: ["cjh"],
        },
      ],
    }),
    "utf8",
  );

  const runtime = await loadRuntimeConfig({ cwd, env: {} });

  assert.equal(runtime.people.length, 1);
  assert.equal(runtime.people[0].displayName, "蔡俊豪");
  assert.deepEqual(runtime.people[0].tokenNames, ["cjh"]);
});
