import test from "node:test";
import assert from "node:assert/strict";

import {
  buildUsageCacheIdentity,
  createUsageCache,
  getAccountUsageCache,
  normalizeUsageCache,
  pruneUsageCache,
  selectDatesToRefresh,
} from "../src/lib/usage-cache.mjs";

const dates = ["2026-07-01", "2026-07-02", "2026-07-03", "2026-07-04"];
const identity = buildUsageCacheIdentity({
  baseUrl: "https://www.foropencode.com/",
  scope: "self",
  timeZone: "Asia/Shanghai",
});

test("usage cache only refreshes trailing days after the initial backfill", () => {
  const cache = createUsageCache(identity, ["account-1"]);
  cache.accounts["account-1"].days = Object.fromEntries(dates.map((date) => [date, []]));

  assert.deepEqual(
    selectDatesToRefresh({ dates, cache: cache.accounts["account-1"], refreshDays: 2 }),
    ["2026-07-03", "2026-07-04"],
  );
  assert.deepEqual(
    selectDatesToRefresh({ dates, cache: cache.accounts["account-1"], refreshDays: 2, refreshAll: true }),
    dates,
  );
});

test("usage cache refreshes missing days and resets when the source changes", () => {
  const cache = createUsageCache(identity);
  cache.accounts["account-1"].days = {
    "2026-07-01": [],
    "2026-07-03": [],
    "2026-07-04": [],
  };

  assert.deepEqual(
    selectDatesToRefresh({ dates, cache: cache.accounts["account-1"], refreshDays: 1 }),
    ["2026-07-02", "2026-07-04"],
  );

  const mismatched = normalizeUsageCache(cache, {
    ...identity,
    scope: "admin",
  }, ["account-1"]);
  assert.deepEqual(mismatched.accounts["account-1"].days, {});
});

test("usage cache drops days outside the active dashboard window", () => {
  const cache = createUsageCache(identity);
  cache.accounts["account-1"].days = {
    "2026-06-30": [],
    "2026-07-01": [],
    "2026-07-02": [],
  };

  pruneUsageCache(cache, dates.slice(0, 2), "account-1");
  assert.deepEqual(Object.keys(cache.accounts["account-1"].days), ["2026-07-01", "2026-07-02"]);
});

test("usage cache keeps a new account isolated from the existing account", () => {
  const cache = createUsageCache(identity, ["account-1", "account-2"]);
  const secondAccount = getAccountUsageCache(cache, "account-2", identity);
  secondAccount.days["2026-07-04"] = [];

  assert.deepEqual(Object.keys(cache.accounts["account-1"].days), []);
  assert.deepEqual(Object.keys(cache.accounts["account-2"].days), ["2026-07-04"]);
});
