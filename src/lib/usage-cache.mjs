export const USAGE_CACHE_VERSION = 1;

function sameIdentity(left, right) {
  return (
    left?.baseUrl === right?.baseUrl &&
    left?.scope === right?.scope &&
    left?.timeZone === right?.timeZone
  );
}

export function buildUsageCacheIdentity(config) {
  return {
    baseUrl: String(config.baseUrl || "").replace(/\/+$/, ""),
    scope: String(config.scope || "self"),
    timeZone: String(config.timeZone || "Asia/Shanghai"),
  };
}

export function createUsageCache(identity) {
  return {
    version: USAGE_CACHE_VERSION,
    identity,
    days: {},
  };
}

export function normalizeUsageCache(value, identity) {
  if (
    !value ||
    value.version !== USAGE_CACHE_VERSION ||
    !sameIdentity(value.identity, identity) ||
    !value.days ||
    typeof value.days !== "object"
  ) {
    return createUsageCache(identity);
  }

  return {
    version: USAGE_CACHE_VERSION,
    identity,
    days: Object.fromEntries(
      Object.entries(value.days).filter(([, logs]) => Array.isArray(logs)),
    ),
  };
}

export function selectDatesToRefresh({ dates, cache, refreshDays, refreshAll = false }) {
  const trailingCount = Math.max(1, Number(refreshDays) || 1);
  const trailingDates = new Set(dates.slice(-trailingCount));

  return dates.filter(
    (date) => refreshAll || trailingDates.has(date) || !Array.isArray(cache.days?.[date]),
  );
}

export function pruneUsageCache(cache, dates) {
  return {
    ...cache,
    days: Object.fromEntries(
      dates.filter((date) => Array.isArray(cache.days?.[date])).map((date) => [date, cache.days[date]]),
    ),
  };
}
