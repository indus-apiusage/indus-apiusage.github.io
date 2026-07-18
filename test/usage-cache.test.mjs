import test from "node:test";
import assert from "node:assert/strict";

import {
  buildUsageCacheIdentity,
  createUsageCache,
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
  const cache = createUsageCache(identity);
  cache.days = Object.fromEntries(dates.map((date) => [date, []]));

  assert.deepEqual(
    selectDatesToRefresh({ dates, cache, refreshDays: 2 }),
    ["2026-07-03", "2026-07-04"],
  );
  assert.deepEqual(
    selectDatesToRefresh({ dates, cache, refreshDays: 2, refreshAll: true }),
    dates,
  );
});

test("usage cache refreshes missing days and resets when the source changes", () => {
  const cache = createUsageCache(identity);
  cache.days = {
    "2026-07-01": [],
    "2026-07-03": [],
    "2026-07-04": [],
  };

  assert.deepEqual(
    selectDatesToRefresh({ dates, cache, refreshDays: 1 }),
    ["2026-07-02", "2026-07-04"],
  );

  const mismatched = normalizeUsageCache(cache, {
    ...identity,
    scope: "admin",
  });
  assert.deepEqual(mismatched.days, {});
});

test("usage cache drops days outside the active dashboard window", () => {
  const cache = createUsageCache(identity);
  cache.days = {
    "2026-06-30": [],
    "2026-07-01": [],
    "2026-07-02": [],
  };

  assert.deepEqual(Object.keys(pruneUsageCache(cache, dates.slice(0, 2)).days), ["2026-07-01", "2026-07-02"]);
});
