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

async function git(args, options = {}) {
  return execFileAsync("git", args, options);
}

async function createRecoveryRepository() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "foropencode-sync-recovery-"));
  const repoDir = path.join(tempDir, "repository");
  const remoteDir = path.join(tempDir, "remote.git");

  await fs.mkdir(path.join(repoDir, "scripts"), { recursive: true });
  await fs.mkdir(path.join(repoDir, "docs", "data"), { recursive: true });
  await fs.copyFile(
    path.join(rootDir, "scripts", "sync-and-push.sh"),
    path.join(repoDir, "scripts", "sync-and-push.sh"),
  );
  await fs.writeFile(path.join(repoDir, "docs", "data", "latest.json"), "{}\n");
  await fs.writeFile(path.join(repoDir, "docs", "data", "widget.json"), "{}\n");

  await git(["init", "--bare", remoteDir]);
  await git(["init", "--initial-branch=main"], { cwd: repoDir });
  await git(["config", "user.name", "Test User"], { cwd: repoDir });
  await git(["config", "user.email", "test@example.invalid"], { cwd: repoDir });
  await git(["add", "."], { cwd: repoDir });
  await git(["commit", "-m", "initial"], { cwd: repoDir });
  await git(["remote", "add", "origin", remoteDir], { cwd: repoDir });
  await git(["push", "-u", "origin", "main"], { cwd: repoDir });

  return { tempDir, repoDir };
}

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

test("sync-and-push recovers only generated dashboard data after an interrupted cycle", async () => {
  const { tempDir, repoDir } = await createRecoveryRepository();

  try {
    await fs.writeFile(path.join(repoDir, "docs", "data", "latest.json"), '{"updated":true}\n');
    await fs.writeFile(path.join(repoDir, "docs", "data", "widget.json"), '{"updated":true}\n');

    await execFileAsync("bash", ["scripts/sync-and-push.sh", "--recover-pending-data"], {
      cwd: repoDir,
    });

    const { stdout } = await git(["status", "--porcelain"], { cwd: repoDir });
    assert.equal(stdout, "");

    const remoteLog = await git(["--git-dir", path.join(tempDir, "remote.git"), "log", "--oneline", "main"]);
    assert.match(remoteLog.stdout, /chore: refresh usage dashboard data/);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("sync-and-push refuses recovery when non-dashboard changes are present", async () => {
  const { tempDir, repoDir } = await createRecoveryRepository();

  try {
    await fs.writeFile(path.join(repoDir, "docs", "data", "latest.json"), '{"updated":true}\n');
    await fs.writeFile(path.join(repoDir, "README.md"), "do not auto-commit this\n");

    await assert.rejects(
      execFileAsync("bash", ["scripts/sync-and-push.sh", "--recover-pending-data"], { cwd: repoDir }),
      (error) => {
        assert.equal(error.code, 1);
        assert.match(error.stderr, /non-dashboard changes/);
        return true;
      },
    );

    const { stdout } = await git(["status", "--porcelain"], { cwd: repoDir });
    assert.match(stdout, /docs\/data\/latest\.json/);
    assert.match(stdout, /README\.md/);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
