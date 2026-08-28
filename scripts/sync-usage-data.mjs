import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  buildDashboardPayloadFromDays,
  buildDailyUsageSnapshot,
  buildDateRange,
  buildDayWindow,
  createPlaceholderPayload,
  mergeDailyUsageSnapshots,
} from "../src/lib/aggregate.mjs";
import { loadRuntimeConfig } from "../src/lib/config.mjs";
import { ForApiClient } from "../src/lib/for-api-client.mjs";
import {
  buildUsageCacheIdentity,
  getAccountUsageCache,
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

function buildWidgetPayload(payload) {
  const latestDay = [...(payload.days || [])].sort((left, right) =>
    String(right?.date || "").localeCompare(String(left?.date || "")),
  )[0];
  const accounts = Array.isArray(payload.accounts) ? payload.accounts : [];
  const monthPrefix = latestDay?.date ? String(latestDay.date).slice(0, 7) : "";
  const monthDays = monthPrefix
    ? (payload.days || []).filter((day) => String(day?.date || "").startsWith(monthPrefix))
    : [];

  return {
    schemaVersion: 1,
    generatedAt: payload.generatedAt || null,
    latestDate: latestDay?.date || payload.summary?.latestDate || null,
    todayUsage: Number(latestDay?.primaryCost || 0),
    todayRequests: Number(latestDay?.requests || 0),
    monthUsage: monthDays.reduce((sum, day) => sum + Number(day?.primaryCost || 0), 0),
    monthRequests: monthDays.reduce((sum, day) => sum + Number(day?.requests || 0), 0),
    totalBalance: accounts.reduce((sum, account) => sum + Number(account?.remainingPrimaryBalance || 0), 0),
    gptPlusRatio: Number(payload.status?.gptPlus?.ratio || accounts[0]?.gptPlus?.ratio || 0) || null,
    accountCount: accounts.length,
    syncState: "已同步",
    accounts: accounts.map((account) => ({
      label: account?.label || account?.displayName || account?.username || "账号",
      balance: Number(account?.remainingPrimaryBalance || 0),
      usage: Number(account?.usedPrimaryCost || 0),
      requests: Number(account?.requestCount || 0),
      utilization: Number(account?.utilizationRate || 0),
      gptPlusRatio: Number(account?.gptPlus?.ratio || 0) || null,
    })),
  };
}

async function writeMacWidgetSnapshot(payload, publicOutputPath) {
  const widgetPayload = buildWidgetPayload(payload);
  const data = `${JSON.stringify(widgetPayload, null, 2)}\n`;

  // Keep the public file aggregate-only so the native widget needs no App Group.
  await writeJson(publicOutputPath, widgetPayload);

  if (process.platform !== "darwin") {
    return;
  }

  const paths = [
    path.join(os.homedir(), "Library", "Application Support", "IndusUsageConsole", "widget.json"),
    path.join(
      os.homedir(),
      "Library",
      "Containers",
      "com.indus-apiusage.console.widget",
      "Data",
      "Library",
      "Application Support",
      "IndusUsageConsole",
      "widget.json",
    ),
  ];
  let wroteSnapshot = false;
  for (const filePath of paths) {
    try {
      await ensureDir(path.dirname(filePath), fs);
      await fs.writeFile(filePath, data, "utf8");
      wroteSnapshot = true;
    } catch {
      // Keep trying so an unsigned local build can use Application Support.
    }
  }
  if (!wroteSnapshot) {
    console.warn("Unable to write the macOS widget snapshot to any local store.");
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

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  }

  const workerCount = Math.min(Math.max(1, limit), items.length);
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  return results;
}

async function loadAccountSnapshot(account, runtime) {
  const client = new ForApiClient({
    baseUrl: account.baseUrl,
    auth: account.auth,
    accountId: account.id,
    sessionCacheFile: path.resolve(runtime.cwd, runtime.sessionCacheFile),
  });
  // Complete password authentication before parallel requests share the client.
  await client.ensureAuthenticated();
  const [statusResponse, selfResponse, groupsResponse] = await Promise.all([
    client.fetchStatus(),
    client.fetchSelf(),
    client.fetchSelfGroups(),
  ]);

  return {
    account,
    status: statusResponse?.data ?? {},
    accountData: selfResponse?.data ?? {},
    groups: groupsResponse?.data ?? {},
    client,
  };
}

async function main() {
  const runtime = await loadRuntimeConfig();
  const outputPath = path.resolve(runtime.cwd, runtime.outputFile);
  const publicWidgetPath = path.resolve(runtime.cwd, "docs/data/widget.json");
  const accountSnapshots = await Promise.all(
    runtime.accounts.map((account) => loadAccountSnapshot(account, runtime)),
  );
  const primarySnapshot = accountSnapshots[0] ?? {
    account: {
      id: "account-1",
      label: "账号 1",
      baseUrl: runtime.baseUrl,
      scope: runtime.scope,
      auth: runtime.auth,
    },
    status: {},
    accountData: {},
    groups: {},
  };
  const status = primarySnapshot.status;
  const account = primarySnapshot.accountData;
  const groups = primarySnapshot.groups;

  if (hasFlag("--placeholder")) {
    const placeholder = createPlaceholderPayload({
      baseUrl: runtime.baseUrl,
      scope: runtime.scope,
      timeZone: runtime.timeZone,
      status,
      account,
      groups,
      accounts: accountSnapshots.map((snapshot) => ({
        id: snapshot.account.id,
        label: snapshot.account.label,
        status: snapshot.status,
        account: snapshot.accountData,
        groups: snapshot.groups,
      })),
    });

    await writeJson(outputPath, placeholder);
    await writeMacWidgetSnapshot(placeholder, publicWidgetPath);
    console.log(`Wrote placeholder dashboard data to ${outputPath}`);
    return;
  }

  const dates = buildDateRange(runtime);
  const cachePath = path.resolve(runtime.cwd, runtime.cacheFile);
  const cacheIdentity = buildUsageCacheIdentity(runtime);
  const cache = normalizeUsageCache(
    await readJsonOrNull(cachePath),
    cacheIdentity,
    accountSnapshots.map((snapshot) => snapshot.account.id),
  );
  const refreshAll = hasFlag("--refresh-all");
  let checkpointQueue = Promise.resolve();
  const accountDayResults = await Promise.all(
    accountSnapshots.map(async (snapshot) => {
      const accountIdentity = buildUsageCacheIdentity({
        baseUrl: snapshot.account.baseUrl,
        scope: snapshot.account.scope,
        timeZone: runtime.timeZone,
      });
      const accountCache = getAccountUsageCache(cache, snapshot.account.id, accountIdentity);
      const datesToRefresh = new Set(
        selectDatesToRefresh({
          dates,
          cache: accountCache,
          refreshDays: runtime.refreshDays,
          refreshAll,
        }),
      );

      await mapWithConcurrency([...datesToRefresh], 4, async (date) => {
        const window = buildDayWindow(date, runtime.timeZone);
        const logs = await snapshot.client.fetchAllUsageLogsForWindow({
          scope: snapshot.account.scope,
          pageSize: runtime.pageSize,
          startTimestamp: window.startTimestamp,
          endTimestamp: window.endTimestamp,
          type: 2,
        });
        const normalizedLogs = dedupeLogs(logs).filter((log) => toNumber(log.type) === 2);
        accountCache.days[date] = normalizedLogs;
        console.log(`[${snapshot.account.label}] Fetched ${normalizedLogs.length} consume logs for ${date}`);

        // Serialize checkpoints so concurrent account fetches cannot overwrite each other.
        checkpointQueue = checkpointQueue.then(() => writeJson(cachePath, pruneUsageCache(cache, dates)));
        await checkpointQueue;
      });

      const days = dates.map((date) =>
        buildDailyUsageSnapshot({
          date,
          logs: accountCache.days[date] || [],
          config: runtime,
          status: snapshot.status,
        }),
      );

      return {
        account: snapshot.account,
        status: snapshot.status,
        accountData: snapshot.accountData,
        groups: snapshot.groups,
        days,
        refreshedDays: datesToRefresh.size,
      };
    }),
  );

  await checkpointQueue;
  await writeJson(cachePath, pruneUsageCache(cache, dates));

  const days = dates.map((date, index) =>
    mergeDailyUsageSnapshots({
      date,
      snapshots: accountDayResults.map((result) => result.days[index]),
    }),
  );
  const refreshedDays = accountDayResults.reduce((sum, result) => sum + result.refreshedDays, 0);
  console.log(
    `Usage cache: refreshed ${refreshedDays} account-day window(s) across ${accountDayResults.length} account(s).`,
  );

  const payload = buildDashboardPayloadFromDays({
    days,
    config: runtime,
    status,
    account,
    groups,
    accounts: accountDayResults.map((result) => ({
      id: result.account.id,
      label: result.account.label,
      status: result.status,
      account: result.accountData,
      groups: result.groups,
    })),
  });

  await writeJson(outputPath, payload);
  await writeMacWidgetSnapshot(payload, publicWidgetPath);

  console.log(
    `Synced ${payload.summary.totalRequests} requests across ${payload.summary.totalDays} day(s) to ${outputPath}`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
