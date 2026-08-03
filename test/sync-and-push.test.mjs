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

test("sync-and-push loads the App SYNC_ENV_FILE before invoking npm", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "foropencode-sync-env-"));
  const binDir = path.join(tempDir, "bin");
  const environmentFile = path.join(tempDir, "app-sync.env");
  const captureFile = path.join(tempDir, "captured-accounts.json");
  const accountsJson = JSON.stringify([
    {
      id: "account-1",
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
    [
      `export FOROPENCODE_ACCOUNTS_JSON='${accountsJson}'`,
      "export FOROPENCODE_SYNC_ENV_TEST_MARKER='loaded-from-app-env'",
      "",
    ].join("\n"),
    { encoding: "utf8", mode: 0o600 },
  );
  await fs.writeFile(
    path.join(binDir, "git"),
    [
      "#!/usr/bin/env bash",
      "case \"${1:-}\" in",
      "  rev-parse) printf 'main\\n' ;;",
      "  rev-list) printf '0\\n' ;;",
      "  *) exit 0 ;;",
      "esac",
      "",
    ].join("\n"),
    { encoding: "utf8", mode: 0o755 },
  );
  await fs.writeFile(
    path.join(binDir, "npm"),
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "if [ \"${FOROPENCODE_SYNC_ENV_TEST_MARKER:-}\" != 'loaded-from-app-env' ]; then exit 61; fi",
      "if [ -z \"${FOROPENCODE_ACCOUNTS_JSON:-}\" ]; then exit 62; fi",
      "printf '%s' \"$FOROPENCODE_ACCOUNTS_JSON\" > \"$SYNC_ENV_TEST_CAPTURE\"",
      "",
    ].join("\n"),
    { encoding: "utf8", mode: 0o755 },
  );

  try {
    await execFileAsync("bash", [path.join(rootDir, "scripts", "sync-and-push.sh")], {
      cwd: rootDir,
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`,
        SYNC_ENV_FILE: environmentFile,
        SYNC_ENV_TEST_CAPTURE: captureFile,
      },
    });

    assert.equal(await fs.readFile(captureFile, "utf8"), accountsJson);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
