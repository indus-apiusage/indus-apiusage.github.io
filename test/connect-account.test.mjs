import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("connect-account loads only the App reconnect environment", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "foropencode-connect-env-"));
  const binDir = path.join(tempDir, "bin");
  const environmentFile = path.join(tempDir, "app-sync.env");
  const captureFile = path.join(tempDir, "capture.json");
  const accountsJson = JSON.stringify([
    {
      id: "account-2",
      auth: {
        username: "fixture-user",
        password: "fixture-password",
        preferPasswordLogin: true,
        allowPasswordLogin: true,
      },
    },
  ]);

  await fs.mkdir(binDir, { recursive: true });
  await fs.writeFile(
    environmentFile,
    `export FOROPENCODE_ACCOUNTS_JSON='${accountsJson}'\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  await fs.writeFile(
    path.join(binDir, "node"),
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "if [ -z \"${FOROPENCODE_ACCOUNTS_JSON:-}\" ]; then exit 71; fi",
      "printf '%s\\n%s' \"$FOROPENCODE_ACCOUNTS_JSON\" \"$*\" > \"$CONNECT_ENV_TEST_CAPTURE\"",
      "",
    ].join("\n"),
    { encoding: "utf8", mode: 0o755 },
  );

  try {
    await execFileAsync(
      "bash",
      [path.join(rootDir, "scripts", "connect-account.sh"), "--account-id", "account-2"],
      {
        cwd: rootDir,
        env: {
          ...process.env,
          PATH: `${binDir}:${process.env.PATH}`,
          SYNC_ENV_FILE: environmentFile,
          CONNECT_ENV_TEST_CAPTURE: captureFile,
        },
      },
    );

    const [capturedAccounts, capturedArgs] = (await fs.readFile(captureFile, "utf8")).split("\n", 2);
    assert.equal(capturedAccounts, accountsJson);
    assert.match(capturedArgs, /connect-account\.mjs --account-id account-2$/);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
