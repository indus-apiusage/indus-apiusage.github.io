import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDashboardPayload,
  buildDashboardPayloadFromDays,
  mergeDailyUsageSnapshots,
} from "../src/lib/aggregate.mjs";

test("buildDashboardPayload groups usage by configured token owner", () => {
  const payload = buildDashboardPayload({
    config: {
      baseUrl: "https://www.foropencode.com",
      scope: "self",
      timeZone: "Asia/Shanghai",
      lookbackDays: 2,
      people: [
        {
          personId: "alice",
          displayName: "Alice",
          tokenNames: ["alice-key"],
        },
      ],
    },
    status: {
      quota_per_unit: 500000,
      quota_display_type: "USD",
      usd_exchange_rate: 7.3,
      display_in_currency: true,
    },
    account: {
      quota: 750000,
      used_quota: 500000,
      request_count: 12,
      username: "alice",
      display_name: "Alice",
      group: "default",
    },
    groups: {
      gpt_plus: {
        desc: "gpt_plus专用分组",
        ratio: 0.1,
      },
    },
    dayResults: [
      {
        date: "2026-07-01",
        logs: [
          {
            id: 1,
            type: 2,
            token_name: "alice-key",
            model_name: "gpt-4.1",
            quota: 250000,
            prompt_tokens: 1000,
            completion_tokens: 200,
            other: JSON.stringify({ cache_tokens: 50 }),
          },
          {
            id: 2,
            type: 2,
            token_name: "unknown-key",
            model_name: "gpt-4.1-mini",
            quota: 500000,
            prompt_tokens: 2000,
            completion_tokens: 400,
            other: JSON.stringify({ cache_creation_tokens: 25 }),
          },
        ],
      },
    ],
  });

  assert.equal(payload.summary.totalRequests, 2);
  assert.equal(payload.summary.totalPrimaryCost, 1.5);
  assert.equal(payload.currency.primaryCode, "CNY");
  assert.equal(payload.currency.primarySymbol, "¥");
  assert.equal(payload.currency.secondaryCode, null);
  assert.equal(payload.account.displayName, "Alice");
  assert.equal(payload.account.remainingPrimaryBalance, 1.5);
  assert.equal(payload.account.usedPrimaryCost, 1);
  assert.equal(payload.account.utilizationRate, 0.4);
  assert.equal(payload.status.gptPlus.key, "gpt_plus");
  assert.equal(payload.status.gptPlus.ratio, 0.1);
  assert.equal(payload.status.gptPlus.description, "gpt_plus专用分组");
  assert.equal(payload.people.length, 2);
  assert.equal(payload.people[0].displayName, "unknown-key");
  assert.equal(payload.people[1].displayName, "Alice");
  assert.equal(payload.days[0].people[0].requests, 1);
  assert.equal(payload.days[0].people[1].requests, 1);
  assert.equal(payload.days[0].models[0].name, "gpt-4.1-mini");
});

test("buildDashboardPayload trims leading empty days before the first request", () => {
  const payload = buildDashboardPayload({
    config: {
      baseUrl: "https://www.foropencode.com",
      scope: "self",
      timeZone: "Asia/Shanghai",
      lookbackDays: 3,
      people: [],
    },
    status: {
      quota_per_unit: 500000,
      quota_display_type: "USD",
      usd_exchange_rate: 7.3,
      display_in_currency: true,
    },
    dayResults: [
      {
        date: "2026-06-02",
        logs: [],
      },
      {
        date: "2026-06-03",
        logs: [],
      },
      {
        date: "2026-06-04",
        logs: [
          {
            id: 1,
            type: 2,
            token_name: "cjh",
            model_name: "gpt-4.1",
            quota: 500000,
            prompt_tokens: 100,
            completion_tokens: 20,
            other: "{}",
          },
        ],
      },
    ],
  });

  assert.equal(payload.days.length, 1);
  assert.equal(payload.days[0].date, "2026-06-04");
  assert.deepEqual(payload.source.dateRange, {
    start: "2026-06-04",
    end: "2026-06-04",
  });
});

test("buildDashboardPayloadFromDays rebuilds totals from cached daily snapshots", () => {
  const config = {
    baseUrl: "https://www.foropencode.com",
    scope: "self",
    timeZone: "Asia/Shanghai",
    lookbackDays: 2,
    people: [],
  };
  const status = { quota_per_unit: 500000 };
  const original = buildDashboardPayload({
    config,
    status,
    dayResults: [
      {
        date: "2026-07-01",
        logs: [
          {
            id: 1,
            type: 2,
            token_name: "cjh",
            model_name: "gpt-5",
            quota: 500000,
            prompt_tokens: 100,
            completion_tokens: 20,
            other: "{}",
          },
        ],
      },
    ],
  });

  const rebuilt = buildDashboardPayloadFromDays({
    days: original.days,
    config,
    status,
  });

  assert.equal(rebuilt.summary.totalRequests, 1);
  assert.equal(rebuilt.summary.totalPrimaryCost, 1);
  assert.deepEqual(rebuilt.days, original.days);
});

test("excludes token 111 from new and stale daily totals", () => {
  const config = {
    baseUrl: "https://www.foropencode.com",
    scope: "self",
    timeZone: "Asia/Shanghai",
    lookbackDays: 1,
    people: [],
  };
  const status = { quota_per_unit: 500000 };

  const fresh = buildDashboardPayload({
    config,
    status,
    dayResults: [
      {
        date: "2026-07-01",
        logs: [
          {
            id: 1,
            type: 2,
            token_name: "visible-key",
            model_name: "gpt-5",
            quota: 500000,
            prompt_tokens: 100,
            completion_tokens: 20,
            other: "{}",
          },
          {
            id: 2,
            type: 2,
            token_name: "111",
            model_name: "gpt-5-mini",
            quota: 1000000,
            prompt_tokens: 200,
            completion_tokens: 40,
            other: "{}",
          },
        ],
      },
    ],
  });

  assert.equal(fresh.summary.totalRequests, 1);
  assert.equal(fresh.summary.totalPrimaryCost, 1);
  assert.equal(fresh.people.some((person) => person.displayName === "111"), false);

  const stale = buildDashboardPayloadFromDays({
    config,
    status,
    days: [
      {
        date: "2026-07-01",
        requests: 2,
        rawQuota: 1500000,
        primaryCost: 3,
        secondaryCost: 0,
        promptTokens: 300,
        completionTokens: 60,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        models: [
          { name: "gpt-5", requests: 1, rawQuota: 500000, primaryCost: 1 },
          { name: "gpt-5-mini", requests: 1, rawQuota: 1000000, primaryCost: 2 },
        ],
        people: [
          {
            personId: "visible-key",
            displayName: "visible-key",
            tokenNames: ["visible-key"],
            requests: 1,
            rawQuota: 500000,
            primaryCost: 1,
            secondaryCost: 0,
            promptTokens: 100,
            completionTokens: 20,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            models: [{ name: "gpt-5", requests: 1, rawQuota: 500000, primaryCost: 1 }],
          },
          {
            personId: "111",
            displayName: "111",
            tokenNames: ["111"],
            requests: 1,
            rawQuota: 1000000,
            primaryCost: 2,
            secondaryCost: 0,
            promptTokens: 200,
            completionTokens: 40,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            models: [{ name: "gpt-5-mini", requests: 1, rawQuota: 1000000, primaryCost: 2 }],
          },
        ],
      },
    ],
  });

  assert.equal(stale.summary.totalRequests, 1);
  assert.equal(stale.summary.totalPrimaryCost, 1);
  assert.deepEqual(stale.days[0].models.map((model) => model.name), ["gpt-5"]);
  assert.equal(stale.people.some((person) => person.displayName === "111"), false);
});

test("mergeDailyUsageSnapshots combines requests and members from multiple accounts", () => {
  const config = {
    baseUrl: "https://www.foropencode.com",
    scope: "self",
    timeZone: "Asia/Shanghai",
    people: [],
  };
  const status = { quota_per_unit: 500000 };
  const first = buildDashboardPayload({
    config,
    status,
    dayResults: [
      {
        date: "2026-07-01",
        logs: [
          {
            id: 1,
            type: 2,
            token_name: "account-one-key",
            model_name: "gpt-5",
            quota: 500000,
            prompt_tokens: 10,
            completion_tokens: 2,
            other: "{}",
          },
        ],
      },
    ],
  });
  const second = buildDashboardPayload({
    config,
    status,
    dayResults: [
      {
        date: "2026-07-01",
        logs: [
          {
            id: 2,
            type: 2,
            token_name: "account-two-key",
            model_name: "gpt-5-mini",
            quota: 1000000,
            prompt_tokens: 20,
            completion_tokens: 4,
            other: "{}",
          },
        ],
      },
    ],
  });

  const merged = mergeDailyUsageSnapshots({
    date: "2026-07-01",
    snapshots: [first.days[0], second.days[0]],
  });

  assert.equal(merged.requests, 2);
  assert.equal(merged.primaryCost, 3);
  assert.equal(merged.promptTokens, 30);
  assert.equal(merged.people.length, 2);
  assert.equal(merged.models.length, 2);
});
