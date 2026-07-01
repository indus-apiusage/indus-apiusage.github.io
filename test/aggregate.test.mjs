import test from "node:test";
import assert from "node:assert/strict";

import { buildDashboardPayload } from "../src/lib/aggregate.mjs";

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
