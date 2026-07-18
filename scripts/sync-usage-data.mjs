import fs from "node:fs/promises";
import path from "node:path";

import {
  buildDashboardPayloadFromDays,
  buildDailyUsageSnapshot,
  buildDateRange,
  buildDayWindow,
  createPlaceholderPayload,
} from "../src/lib/aggregate.mjs";
import { loadRuntimeConfig } from "../src/lib/config.mjs";
import { ForApiClient } from "../src/lib/for-api-client.mjs";
import {
  buildUsageCacheIdentity,
  normalizeUsageCache,
  pruneUsageCache,
  selectDatesToRefresh,
} from "../src/lib/usage-cache.mjs";
import { ensureDir, toNumber } from "../src/lib/utils.mjs";

function hasFlag(flag) {
  return process.argv.includes(flag);
}

async function writeJson(filePath, data) {
  await ensureDir(path.dirname(filePath), fs);
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

async function readJsonOrNull(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }

    console.warn(`Ignoring unreadable usage cache at ${filePath}: ${error.message}`);
    return null;
  }
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

function getExistingDayMap(payload, identity) {
  const source = payload?.source;
  const sourceBaseUrl = String(source?.baseUrl || "").replace(/\/+$/, "");
  const isCompatible =
    sourceBaseUrl === identity.baseUrl &&
    source?.scope === identity.scope &&
    source?.timezone === identity.timeZone;

  if (!isCompatible || !Array.isArray(payload?.days)) {
    return new Map();
  }

  return new Map(
    payload.days
      .filter((day) => day && typeof day.date === "string")
      .map((day) => [day.date, day]),
  );
}

function getFirstDashboardDate(dayMap) {
  return [...dayMap.keys()].sort()[0] ?? null;
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
  const cachePath = path.resolve(runtime.cwd, runtime.cacheFile);
  const cacheIdentity = buildUsageCacheIdentity(runtime);
  const cache = normalizeUsageCache(await readJsonOrNull(cachePath), cacheIdentity);
  const existingDayMap = getExistingDayMap(await readJsonOrNull(outputPath), cacheIdentity);
  const firstDashboardDate = getFirstDashboardDate(existingDayMap);
  const refreshAll = hasFlag("--refresh-all");
  const trailingDates = new Set(dates.slice(-runtime.refreshDays));
  const datesToRefresh = new Set(
    selectDatesToRefresh({
      dates,
      cache,
      refreshDays: runtime.refreshDays,
      refreshAll,
    }).filter(
      (date) =>
        refreshAll ||
        trailingDates.has(date) ||
        (!existingDayMap.has(date) && (!firstDashboardDate || date >= firstDashboardDate)),
    ),
  );
  const days = [];
  let reusedDashboardDays = 0;
  let rehydratedCacheDays = 0;

  for (const date of dates) {
    let logs = cache.days[date];

    if (datesToRefresh.has(date)) {
      const window = buildDayWindow(date, runtime.timeZone);
      logs = await client.fetchAllUsageLogsForWindow({
        scope: runtime.scope,
        pageSize: runtime.pageSize,
        startTimestamp: window.startTimestamp,
        endTimestamp: window.endTimestamp,
        type: 2,
      });
      console.log(`Fetched ${logs.length} consume logs for ${date}`);
    }

    if (datesToRefresh.has(date)) {
      const normalizedLogs = dedupeLogs(logs).filter((log) => toNumber(log.type) === 2);
      cache.days[date] = normalizedLogs;

      // Checkpoint each refreshed day so a network interruption can resume from here.
      await writeJson(cachePath, pruneUsageCache(cache, dates));
      days.push(buildDailyUsageSnapshot({ date, logs: normalizedLogs, config: runtime, status }));
      continue;
    }

    if (Array.isArray(logs)) {
      rehydratedCacheDays += 1;
      days.push(buildDailyUsageSnapshot({ date, logs, config: runtime, status }));
      continue;
    }

    reusedDashboardDays += 1;
    days.push(
      existingDayMap.get(date) ??
        buildDailyUsageSnapshot({ date, logs: [], config: runtime, status }),
    );
  }

  await writeJson(cachePath, pruneUsageCache(cache, dates));
  console.log(
    `Usage cache: refreshed ${datesToRefresh.size} day(s), reused ${reusedDashboardDays} dashboard day(s), rehydrated ${rehydratedCacheDays} cached day(s).`,
  );

  const payload = buildDashboardPayloadFromDays({
    days,
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
