import { DateTime } from "luxon";

import {
  pickTop,
  safeJsonParse,
  slugify,
  sortByDateAsc,
  sortByDateDesc,
  sumBy,
  toNumber,
  unique,
} from "./utils.mjs";

function buildCurrencyStatus(status) {
  const quotaPerUnit = toNumber(status.quota_per_unit, 500000);
  const quotaDisplayType = "CNY";
  const usdExchangeRate = toNumber(status.usd_exchange_rate, 1);
  const customCurrencyExchangeRate = toNumber(status.custom_currency_exchange_rate, 1);
  const customCurrencySymbol = status.custom_currency_symbol || "¤";
  const cnyFromQuota = (quota) => toNumber(quota) / quotaPerUnit;

  return {
    displayInCurrency: Boolean(status.display_in_currency),
    quotaPerUnit,
    quotaDisplayType,
    usdExchangeRate,
    customCurrencySymbol,
    customCurrencyExchangeRate,
    primaryCode: "CNY",
    primarySymbol: "¥",
    secondaryCode: null,
    secondarySymbol: null,
    quotaToUsd(quota) {
      return cnyFromQuota(quota) / Math.max(usdExchangeRate, 1);
    },
    quotaToPrimary(quota) {
      return cnyFromQuota(quota);
    },
    quotaToSecondary(quota) {
      return 0;
    },
  };
}

function buildAccountSnapshot(account, currency) {
  const remainingRawQuota = toNumber(account?.quota);
  const usedRawQuota = toNumber(account?.used_quota);
  const totalRawQuota = remainingRawQuota + usedRawQuota;

  return {
    username: String(account?.username || ""),
    displayName: String(account?.display_name || account?.username || ""),
    group: String(account?.group || ""),
    requestCount: toNumber(account?.request_count),
    remainingRawQuota,
    remainingPrimaryBalance: Number(currency.quotaToPrimary(remainingRawQuota).toFixed(6)),
    usedRawQuota,
    usedPrimaryCost: Number(currency.quotaToPrimary(usedRawQuota).toFixed(6)),
    totalRawQuota,
    totalPrimaryQuota: Number(currency.quotaToPrimary(totalRawQuota).toFixed(6)),
    utilizationRate: totalRawQuota > 0 ? Number((usedRawQuota / totalRawQuota).toFixed(6)) : 0,
  };
}

function buildGptPlusSnapshot(groups) {
  const group = groups?.gpt_plus ?? {};
  const ratio = toNumber(group?.ratio, Number.NaN);

  return {
    key: "gpt_plus",
    ratio: Number.isFinite(ratio) ? ratio : null,
    description: String(group?.desc || ""),
  };
}

function createMapper(peopleConfig) {
  const lookup = new Map();

  for (const person of peopleConfig) {
    for (const tokenName of person.tokenNames) {
      lookup.set(tokenName, person);
    }
  }

  return (tokenName) => {
    const normalizedTokenName = tokenName || "Unassigned";
    const matched = lookup.get(normalizedTokenName);

    if (matched) {
      return {
        personId: matched.personId,
        displayName: matched.displayName,
        tokenName: normalizedTokenName,
      };
    }

    return {
      personId: slugify(normalizedTokenName),
      displayName: normalizedTokenName,
      tokenName: normalizedTokenName,
    };
  };
}

function createMetricAccumulator() {
  return {
    requests: 0,
    rawQuota: 0,
    primaryCost: 0,
    secondaryCost: 0,
    promptTokens: 0,
    completionTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };
}

function mergeMetrics(target, patch) {
  target.requests += toNumber(patch.requests);
  target.rawQuota += toNumber(patch.rawQuota);
  target.primaryCost += toNumber(patch.primaryCost);
  target.secondaryCost += toNumber(patch.secondaryCost);
  target.promptTokens += toNumber(patch.promptTokens);
  target.completionTokens += toNumber(patch.completionTokens);
  target.cacheReadTokens += toNumber(patch.cacheReadTokens);
  target.cacheWriteTokens += toNumber(patch.cacheWriteTokens);
  return target;
}

function deriveLogMetrics(log, currency) {
  const other = safeJsonParse(log.other, {});
  const rawQuota = toNumber(log.quota);
  const cacheWriteTokens =
    toNumber(other?.cache_creation_tokens) +
    toNumber(other?.cache_creation_tokens_5m) +
    toNumber(other?.cache_creation_tokens_1h);

  return {
    requests: 1,
    rawQuota,
    primaryCost: currency.quotaToPrimary(rawQuota),
    secondaryCost: currency.quotaToSecondary(rawQuota),
    promptTokens: toNumber(log.prompt_tokens),
    completionTokens: toNumber(log.completion_tokens),
    cacheReadTokens: toNumber(other?.cache_tokens),
    cacheWriteTokens,
  };
}

function finalizeModelMap(modelMap) {
  return pickTop(
    [...modelMap.values()].map((entry) => ({
      name: entry.name,
      requests: entry.metrics.requests,
      rawQuota: entry.metrics.rawQuota,
      primaryCost: Number(entry.metrics.primaryCost.toFixed(6)),
      secondaryCost: Number(entry.metrics.secondaryCost.toFixed(6)),
      promptTokens: entry.metrics.promptTokens,
      completionTokens: entry.metrics.completionTokens,
    })),
    5,
    (entry) => entry.primaryCost,
  );
}

function trimLeadingEmptyDays(days) {
  const firstActiveIndex = days.findIndex((day) => toNumber(day.requests) > 0);
  return firstActiveIndex === -1 ? days : days.slice(firstActiveIndex);
}

export function buildDateRange(config) {
  const zone = config.timeZone;

  if (config.startDate && config.endDate) {
    let current = DateTime.fromISO(config.startDate, { zone });
    const end = DateTime.fromISO(config.endDate, { zone });
    const dates = [];

    while (current <= end) {
      dates.push(current.toISODate());
      current = current.plus({ days: 1 });
    }

    return dates;
  }

  const end = DateTime.now().setZone(zone).startOf("day");
  const start = end.minus({ days: config.lookbackDays - 1 });
  const dates = [];
  let current = start;

  while (current <= end) {
    dates.push(current.toISODate());
    current = current.plus({ days: 1 });
  }

  return dates;
}

export function buildDayWindow(date, timeZone) {
  const start = DateTime.fromISO(date, { zone: timeZone }).startOf("day");
  const end = start.endOf("day");

  return {
    startTimestamp: Math.floor(start.toSeconds()),
    endTimestamp: Math.floor(end.toSeconds()),
  };
}

export function createPlaceholderPayload({ baseUrl, scope, timeZone, status, account, groups }) {
  const currency = buildCurrencyStatus(status ?? {});

  return {
    generatedAt: new Date().toISOString(),
    source: {
      baseUrl,
      scope,
      timezone: timeZone,
      dateRange: null,
      lookbackDays: 0,
    },
    status: {
      systemName: status?.system_name || "For API",
      serverAddress: status?.server_address || baseUrl,
      quotaPerUnit: currency.quotaPerUnit,
      quotaDisplayType: currency.quotaDisplayType,
      usdExchangeRate: currency.usdExchangeRate,
      customCurrencySymbol: currency.customCurrencySymbol,
      customCurrencyExchangeRate: currency.customCurrencyExchangeRate,
      version: status?.version || "unknown",
      gptPlus: buildGptPlusSnapshot(groups),
    },
    currency: {
      displayInCurrency: currency.displayInCurrency,
      primaryCode: currency.primaryCode,
      primarySymbol: currency.primarySymbol,
      secondaryCode: currency.secondaryCode,
      secondarySymbol: currency.secondarySymbol,
      quotaPerUnit: currency.quotaPerUnit,
      usdExchangeRate: currency.usdExchangeRate,
      customCurrencySymbol: currency.customCurrencySymbol,
      customCurrencyExchangeRate: currency.customCurrencyExchangeRate,
    },
    account: buildAccountSnapshot(account, currency),
    summary: {
      totalDays: 0,
      totalRequests: 0,
      totalRawQuota: 0,
      totalPrimaryCost: 0,
      totalSecondaryCost: 0,
      activePeople: 0,
      activeTokens: 0,
      latestDate: null,
    },
    days: [],
    people: [],
    dailyPersonRows: [],
    warnings: [
      "No usage data has been generated yet. Run the sync script with credentials to populate this dashboard.",
    ],
  };
}

export function buildDashboardPayload({ dayResults, config, status, account, groups }) {
  const currency = buildCurrencyStatus(status ?? {});
  const mapPerson = createMapper(config.people);

  const peopleMap = new Map();
  const warnings = [];

  const days = trimLeadingEmptyDays(
    sortByDateAsc(
    dayResults.map(({ date, logs }) => {
      const personMap = new Map();
      const modelMap = new Map();
      const dayTotals = createMetricAccumulator();

      for (const log of logs.filter((entry) => toNumber(entry.type) === 2)) {
        const identity = mapPerson(log.token_name);
        const modelName = String(log.model_name || "Unknown Model");
        const metrics = deriveLogMetrics(log, currency);

        mergeMetrics(dayTotals, metrics);

        if (!personMap.has(identity.personId)) {
          personMap.set(identity.personId, {
            personId: identity.personId,
            displayName: identity.displayName,
            tokenNames: [],
            metrics: createMetricAccumulator(),
            modelMap: new Map(),
          });
        }

        const personEntry = personMap.get(identity.personId);
        personEntry.tokenNames.push(identity.tokenName);
        mergeMetrics(personEntry.metrics, metrics);

        if (!personEntry.modelMap.has(modelName)) {
          personEntry.modelMap.set(modelName, {
            name: modelName,
            metrics: createMetricAccumulator(),
          });
        }

        mergeMetrics(personEntry.modelMap.get(modelName).metrics, metrics);

        if (!modelMap.has(modelName)) {
          modelMap.set(modelName, {
            name: modelName,
            metrics: createMetricAccumulator(),
          });
        }

        mergeMetrics(modelMap.get(modelName).metrics, metrics);
      }

      const people = [...personMap.values()]
        .map((entry) => {
          const topModels = finalizeModelMap(entry.modelMap);
          return {
            personId: entry.personId,
            displayName: entry.displayName,
            tokenNames: unique(entry.tokenNames),
            requests: entry.metrics.requests,
            rawQuota: entry.metrics.rawQuota,
            primaryCost: Number(entry.metrics.primaryCost.toFixed(6)),
            secondaryCost: Number(entry.metrics.secondaryCost.toFixed(6)),
            promptTokens: entry.metrics.promptTokens,
            completionTokens: entry.metrics.completionTokens,
            cacheReadTokens: entry.metrics.cacheReadTokens,
            cacheWriteTokens: entry.metrics.cacheWriteTokens,
            models: topModels,
          };
        })
        .sort((left, right) => right.primaryCost - left.primaryCost || right.requests - left.requests);

      for (const entry of people) {
        if (!peopleMap.has(entry.personId)) {
          peopleMap.set(entry.personId, {
            personId: entry.personId,
            displayName: entry.displayName,
            tokenNames: new Set(),
            totals: createMetricAccumulator(),
            days: [],
          });
        }

        const person = peopleMap.get(entry.personId);
        entry.tokenNames.forEach((tokenName) => person.tokenNames.add(tokenName));
        mergeMetrics(person.totals, entry);
        person.days.push({
          date,
          requests: entry.requests,
          rawQuota: entry.rawQuota,
          primaryCost: entry.primaryCost,
          secondaryCost: entry.secondaryCost,
          promptTokens: entry.promptTokens,
          completionTokens: entry.completionTokens,
          cacheReadTokens: entry.cacheReadTokens,
          cacheWriteTokens: entry.cacheWriteTokens,
          models: entry.models,
        });
      }

      for (const entry of people) {
        for (const tokenName of entry.tokenNames) {
          const matched = config.people.find((person) => person.tokenNames.includes(tokenName));
          if (!matched) {
            warnings.push(`Token "${tokenName}" is not mapped in config/people.json and will be shown as-is.`);
          }
        }
      }

      return {
        date,
        requests: dayTotals.requests,
        rawQuota: dayTotals.rawQuota,
        primaryCost: Number(dayTotals.primaryCost.toFixed(6)),
        secondaryCost: Number(dayTotals.secondaryCost.toFixed(6)),
        promptTokens: dayTotals.promptTokens,
        completionTokens: dayTotals.completionTokens,
        cacheReadTokens: dayTotals.cacheReadTokens,
        cacheWriteTokens: dayTotals.cacheWriteTokens,
        people,
        models: finalizeModelMap(modelMap),
      };
    }),
    ),
  );

  const people = [...peopleMap.values()]
    .map((entry) => ({
      personId: entry.personId,
      displayName: entry.displayName,
      tokenNames: unique([...entry.tokenNames]),
      totals: {
        requests: entry.totals.requests,
        rawQuota: entry.totals.rawQuota,
        primaryCost: Number(entry.totals.primaryCost.toFixed(6)),
        secondaryCost: Number(entry.totals.secondaryCost.toFixed(6)),
        promptTokens: entry.totals.promptTokens,
        completionTokens: entry.totals.completionTokens,
        cacheReadTokens: entry.totals.cacheReadTokens,
        cacheWriteTokens: entry.totals.cacheWriteTokens,
      },
      days: sortByDateDesc(entry.days),
    }))
    .sort((left, right) => right.totals.primaryCost - left.totals.primaryCost);

  const dailyPersonRows = days.flatMap((day) =>
    day.people.map((person) => ({
      date: day.date,
      personId: person.personId,
      displayName: person.displayName,
      tokenNames: person.tokenNames,
      requests: person.requests,
      rawQuota: person.rawQuota,
      primaryCost: person.primaryCost,
      secondaryCost: person.secondaryCost,
      promptTokens: person.promptTokens,
      completionTokens: person.completionTokens,
      cacheReadTokens: person.cacheReadTokens,
      cacheWriteTokens: person.cacheWriteTokens,
      models: person.models,
    })),
  );

  return {
    generatedAt: new Date().toISOString(),
    source: {
      baseUrl: config.baseUrl,
      scope: config.scope,
      timezone: config.timeZone,
      lookbackDays: config.lookbackDays,
      dateRange: days.length > 0 ? { start: days[0].date, end: days.at(-1).date } : null,
    },
    status: {
      systemName: status?.system_name || "For API",
      serverAddress: status?.server_address || config.baseUrl,
      quotaPerUnit: currency.quotaPerUnit,
      quotaDisplayType: currency.quotaDisplayType,
      usdExchangeRate: currency.usdExchangeRate,
      customCurrencySymbol: currency.customCurrencySymbol,
      customCurrencyExchangeRate: currency.customCurrencyExchangeRate,
      version: status?.version || "unknown",
      gptPlus: buildGptPlusSnapshot(groups),
    },
    currency: {
      displayInCurrency: currency.displayInCurrency,
      primaryCode: currency.primaryCode,
      primarySymbol: currency.primarySymbol,
      secondaryCode: currency.secondaryCode,
      secondarySymbol: currency.secondarySymbol,
      quotaPerUnit: currency.quotaPerUnit,
      usdExchangeRate: currency.usdExchangeRate,
      customCurrencySymbol: currency.customCurrencySymbol,
      customCurrencyExchangeRate: currency.customCurrencyExchangeRate,
    },
    account: buildAccountSnapshot(account, currency),
    summary: {
      totalDays: days.length,
      totalRequests: sumBy(days, (day) => day.requests),
      totalRawQuota: sumBy(days, (day) => day.rawQuota),
      totalPrimaryCost: Number(sumBy(days, (day) => day.primaryCost).toFixed(6)),
      totalSecondaryCost: Number(sumBy(days, (day) => day.secondaryCost).toFixed(6)),
      activePeople: people.length,
      activeTokens: unique(people.flatMap((person) => person.tokenNames)).length,
      latestDate: days.at(-1)?.date ?? null,
    },
    days,
    people,
    dailyPersonRows,
    warnings: unique(warnings),
  };
}
