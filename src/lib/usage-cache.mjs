export const USAGE_CACHE_VERSION = 2;

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

export function createUsageCache(identity, accountIds = ["account-1"]) {
  return {
    version: USAGE_CACHE_VERSION,
    identity,
    accounts: Object.fromEntries(
      accountIds.map((accountId) => [
        accountId,
        {
          identity,
          days: {},
        },
      ]),
    ),
  };
}

export function normalizeUsageCache(value, identity, accountIds = ["account-1"]) {
  const normalizedAccountIds = [...new Set(accountIds.map((accountId) => String(accountId).trim()).filter(Boolean))];
  const resolvedAccountIds = normalizedAccountIds.length > 0 ? normalizedAccountIds : ["account-1"];

  if (value?.version === USAGE_CACHE_VERSION && sameIdentity(value.identity, identity) && value.accounts) {
    return {
      version: USAGE_CACHE_VERSION,
      identity,
      accounts: Object.fromEntries(
        resolvedAccountIds.map((accountId) => {
          const accountCache = value.accounts[accountId];
          return [
            accountId,
            {
              identity: accountCache?.identity && sameIdentity(accountCache.identity, identity)
                ? accountCache.identity
                : identity,
              days: Object.fromEntries(
                Object.entries(accountCache?.days || {}).filter(([, logs]) => Array.isArray(logs)),
              ),
            },
          ];
        }),
      ),
    };
  }

  // Migrate the former single-account cache into the first configured account.
  if (
    value?.version === 1 &&
    sameIdentity(value.identity, identity) &&
    value.days &&
    typeof value.days === "object"
  ) {
    const migrated = createUsageCache(identity, resolvedAccountIds);
    migrated.accounts[resolvedAccountIds[0]].days = Object.fromEntries(
      Object.entries(value.days).filter(([, logs]) => Array.isArray(logs)),
    );
    return migrated;
  }

  return createUsageCache(identity, resolvedAccountIds);
}

export function getAccountUsageCache(cache, accountId, identity) {
  const normalizedId = String(accountId || "account-1");
  if (!cache.accounts) {
    cache.accounts = {};
  }

  if (!cache.accounts[normalizedId] || !sameIdentity(cache.accounts[normalizedId].identity, identity)) {
    cache.accounts[normalizedId] = {
      identity,
      days: {},
    };
  }

  return cache.accounts[normalizedId];
}

export function selectDatesToRefresh({ dates, cache, refreshDays, refreshAll = false }) {
  const trailingCount = Math.max(1, Number(refreshDays) || 1);
  const trailingDates = new Set(dates.slice(-trailingCount));

  return dates.filter(
    (date) => refreshAll || trailingDates.has(date) || !Array.isArray(cache.days?.[date]),
  );
}

export function pruneUsageCache(cache, dates, accountId) {
  if (accountId !== undefined && accountId !== null) {
    const accountCache = cache.accounts?.[String(accountId)];
    if (accountCache) {
      accountCache.days = Object.fromEntries(
        dates
          .filter((date) => Array.isArray(accountCache.days?.[date]))
          .map((date) => [date, accountCache.days[date]]),
      );
    }
    return cache;
  }

  return {
    ...cache,
    accounts: Object.fromEntries(
      Object.entries(cache.accounts || {}).map(([id, accountCache]) => [
        id,
        {
          ...accountCache,
          days: Object.fromEntries(
            dates
              .filter((date) => Array.isArray(accountCache.days?.[date]))
              .map((date) => [date, accountCache.days[date]]),
          ),
        },
      ]),
    ),
  };
}
