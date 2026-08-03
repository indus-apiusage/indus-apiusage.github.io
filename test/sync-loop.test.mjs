import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function waitFor(check, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;

  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) { return value; }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }

  throw lastError || new Error("Timed out waiting for a background process.");
}

function processIsRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") { return false; }
    throw error;
  }
}

test("sync loop terminates nested crawler processes when it receives SIGTERM", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "foropencode-sync-loop-"));
  const scriptsDir = path.join(tempDir, "scripts");
  const binDir = path.join(tempDir, "bin");
  const nestedPIDFile = path.join(tempDir, "nested.pid");
  let loop;
  let nestedPID = 0;

  try {
    await fs.mkdir(scriptsDir, { recursive: true });
    await fs.mkdir(binDir, { recursive: true });
    await fs.copyFile(
      path.join(rootDir, "scripts", "run-local-sync-loop.sh"),
      path.join(scriptsDir, "run-local-sync-loop.sh"),
    );
    await fs.writeFile(
      path.join(scriptsDir, "run-local-sync.sh"),
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        "bash -c 'echo \"$$\" > \"$NESTED_PID_FILE\"; exec sleep 60' &",
        "wait $!",
        "",
      ].join("\n"),
      { encoding: "utf8", mode: 0o755 },
    );
    await fs.writeFile(
      path.join(binDir, "git"),
      [
        "#!/usr/bin/env bash",
        "for arg in \"$@\"; do",
        "  case \"$arg\" in",
        "    rev-parse) printf 'main\\n'; exit 0 ;;",
        "    rev-list) printf '0\\n'; exit 0 ;;",
        "    status|fetch|pull) exit 0 ;;",
        "  esac",
        "done",
        "exit 0",
        "",
      ].join("\n"),
      { encoding: "utf8", mode: 0o755 },
    );

    loop = spawn("bash", [path.join(scriptsDir, "run-local-sync-loop.sh")], {
      cwd: tempDir,
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`,
        NESTED_PID_FILE: nestedPIDFile,
        SYNC_INTERVAL_SECONDS: "60",
      },
      stdio: "ignore",
    });

    const nestedText = await waitFor(() => fs.readFile(nestedPIDFile, "utf8"));
    nestedPID = Number.parseInt(nestedText, 10);
    assert.ok(Number.isSafeInteger(nestedPID) && nestedPID > 0);
    assert.equal(processIsRunning(nestedPID), true);

    loop.kill("SIGTERM");
    const exitCode = await new Promise((resolve) => loop.once("exit", resolve));
    assert.equal(exitCode, 0);

    await waitFor(() => !processIsRunning(nestedPID));
  } finally {
    if (loop?.exitCode === null) { loop.kill("SIGTERM"); }
    if (nestedPID > 0 && processIsRunning(nestedPID)) { process.kill(nestedPID, "SIGTERM"); }
    await execFileAsync("pkill", ["-TERM", "-P", String(nestedPID)]).catch(() => {});
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
