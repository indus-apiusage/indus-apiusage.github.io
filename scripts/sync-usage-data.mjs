import fs from "node:fs/promises";
import path from "node:path";

import { buildDashboardPayload, buildDateRange, buildDayWindow, createPlaceholderPayload } from "../src/lib/aggregate.mjs";
import { loadRuntimeConfig } from "../src/lib/config.mjs";
import { ForApiClient } from "../src/lib/for-api-client.mjs";
import { ensureDir, toNumber } from "../src/lib/utils.mjs";

function hasFlag(flag) {
  return process.argv.includes(flag);
}

async function writeJson(filePath, data) {
  await ensureDir(path.dirname(filePath), fs);
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function dedupeLogs(logs) {
  const seen = new Set();
  const result = [];

  for (const log of logs) {
    const key = [
      log.id ?? "",
      log.created_at ?? "",
      log.token_name ?? "",
      log.request_id ?? "",
      log.model_name ?? "",
      log.quota ?? "",
    ].join("|");

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(log);
  }

  return result;
}

async function main() {
  const runtime = await loadRuntimeConfig();
  const outputPath = path.resolve(runtime.cwd, runtime.outputFile);
  const client = new ForApiClient({
    baseUrl: runtime.baseUrl,
    auth: runtime.auth,
  });

  const statusResponse = await client.fetchStatus();
  const status = statusResponse?.data ?? {};
  const selfResponse = await client.fetchSelf();
  const account = selfResponse?.data ?? {};
  const groupsResponse = await client.fetchSelfGroups();
  const groups = groupsResponse?.data ?? {};

  if (hasFlag("--placeholder")) {
    const placeholder = createPlaceholderPayload({
      baseUrl: runtime.baseUrl,
      scope: runtime.scope,
      timeZone: runtime.timeZone,
      status,
      account,
      groups,
    });

    await writeJson(outputPath, placeholder);
    console.log(`Wrote placeholder dashboard data to ${outputPath}`);
    return;
  }

  const dates = buildDateRange(runtime);
  const dayResults = [];

  for (const date of dates) {
    const window = buildDayWindow(date, runtime.timeZone);
    const logs = await client.fetchAllUsageLogsForWindow({
      scope: runtime.scope,
      pageSize: runtime.pageSize,
      startTimestamp: window.startTimestamp,
      endTimestamp: window.endTimestamp,
      type: 2,
    });

    dayResults.push({
      date,
      logs: dedupeLogs(logs).filter((log) => toNumber(log.type) === 2),
    });

    console.log(`Fetched ${logs.length} consume logs for ${date}`);
  }

  const payload = buildDashboardPayload({
    dayResults,
    config: runtime,
    status,
    account,
    groups,
  });

  await writeJson(outputPath, payload);

  console.log(
    `Synced ${payload.summary.totalRequests} requests across ${payload.summary.totalDays} day(s) to ${outputPath}`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
