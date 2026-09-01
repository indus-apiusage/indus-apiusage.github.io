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
  await fs.mkdir(path.join(repoDir, "src"), { recursive: true });
  await fs.copyFile(
    path.join(rootDir, "scripts", "sync-and-push.sh"),
    path.join(repoDir, "scripts", "sync-and-push.sh"),
  );
  await fs.writeFile(path.join(repoDir, "docs", "data", "latest.json"), "{}\n");
  await fs.writeFile(path.join(repoDir, "docs", "data", "widget.json"), "{}\n");
  await fs.writeFile(path.join(repoDir, "src", "app.txt"), "original source\n");

  await git(["init", "--bare", remoteDir]);
  await git(["init", "--initial-branch=main"], { cwd: repoDir });
  await git(["config", "user.name", "Test User"], { cwd: repoDir });
  await git(["config", "user.email", "test@example.invalid"], { cwd: repoDir });
  await git(["add", "."], { cwd: repoDir });
  await git(["commit", "-m", "initial"], { cwd: repoDir });
  await git(["remote", "add", "origin", remoteDir], { cwd: repoDir });
  await git(["push", "-u", "origin", "main"], { cwd: repoDir });

  return { tempDir, repoDir, remoteDir };
}

test("sync-and-push loads the App SYNC_ENV_FILE before invoking npm", async () => {
  const { tempDir, repoDir } = await createRecoveryRepository();
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
      cwd: repoDir,
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
  const { tempDir, repoDir, remoteDir } = await createRecoveryRepository();

  try {
    await fs.writeFile(path.join(repoDir, "docs", "data", "latest.json"), '{"updated":true}\n');
    await fs.writeFile(path.join(repoDir, "docs", "data", "widget.json"), '{"updated":true}\n');

    await execFileAsync("bash", ["scripts/sync-and-push.sh", "--recover-pending-data"], {
      cwd: repoDir,
    });

    const { stdout } = await git(["status", "--porcelain"], { cwd: repoDir });
    assert.match(stdout, /docs\/data\/latest\.json/);
    assert.match(stdout, /docs\/data\/widget\.json/);

    const remoteLog = await git(["--git-dir", remoteDir, "log", "--oneline", "main"]);
    assert.match(remoteLog.stdout, /chore: refresh usage dashboard data/);
    const remoteData = await git(["--git-dir", remoteDir, "show", "main:docs/data/latest.json"]);
    assert.equal(remoteData.stdout, '{"updated":true}\n');
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("sync-and-push preserves non-dashboard changes while recovering generated data", async () => {
  const { tempDir, repoDir, remoteDir } = await createRecoveryRepository();

  try {
    await fs.writeFile(path.join(repoDir, "docs", "data", "latest.json"), '{"updated":true}\n');
    await fs.writeFile(path.join(repoDir, "src", "app.txt"), "local source edit\n");

    await execFileAsync("bash", ["scripts/sync-and-push.sh", "--recover-pending-data"], {
      cwd: repoDir,
    });

    const { stdout } = await git(["status", "--porcelain"], { cwd: repoDir });
    assert.match(stdout, /docs\/data\/latest\.json/);
    assert.match(stdout, /src\/app\.txt/);
    assert.equal(await fs.readFile(path.join(repoDir, "src", "app.txt"), "utf8"), "local source edit\n");

    const remoteData = await git(["--git-dir", remoteDir, "show", "main:docs/data/latest.json"]);
    assert.equal(remoteData.stdout, '{"updated":true}\n');
    const remoteSource = await git(["--git-dir", remoteDir, "show", "main:src/app.txt"]);
    assert.equal(remoteSource.stdout, "original source\n");
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("sync-and-push runs the crawler with a dirty source tree and publishes data only", async () => {
  const { tempDir, repoDir, remoteDir } = await createRecoveryRepository();
  const binDir = path.join(tempDir, "bin");

  try {
    await fs.mkdir(binDir, { recursive: true });
    await fs.writeFile(path.join(repoDir, "src", "app.txt"), "unfinished local edit\n");
    await fs.writeFile(
      path.join(binDir, "npm"),
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        "printf '{\"synced\":true}\\n' > docs/data/latest.json",
        "printf '{\"widget\":true}\\n' > docs/data/widget.json",
        "",
      ].join("\n"),
      { encoding: "utf8", mode: 0o755 },
    );

    await execFileAsync("bash", ["scripts/sync-and-push.sh"], {
      cwd: repoDir,
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`,
      },
    });

    const localSource = await fs.readFile(path.join(repoDir, "src", "app.txt"), "utf8");
    assert.equal(localSource, "unfinished local edit\n");
    const localHead = await git(["log", "-1", "--format=%s"], { cwd: repoDir });
    assert.equal(localHead.stdout.trim(), "initial");

    const remoteData = await git(["--git-dir", remoteDir, "show", "main:docs/data/latest.json"]);
    assert.equal(remoteData.stdout, '{"synced":true}\n');
    const remoteSource = await git(["--git-dir", remoteDir, "show", "main:src/app.txt"]);
    assert.equal(remoteSource.stdout, "original source\n");
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
