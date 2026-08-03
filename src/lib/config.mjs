import fs from "node:fs/promises";
import path from "node:path";

import { DateTime } from "luxon";

import { slugify } from "./utils.mjs";

const DEFAULT_BASE_URL = "https://www.foropencode.com";
const DEFAULT_SCOPE = "self";
const DEFAULT_TIMEZONE = "Asia/Shanghai";
const DEFAULT_LOOKBACK_DAYS = 30;
const DEFAULT_REFRESH_DAYS = 2;
const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_OUTPUT_FILE = "docs/data/latest.json";
const DEFAULT_CACHE_FILE = "work/usage-log-cache.json";
const DEFAULT_SESSION_CACHE_FILE = "work/auth-session-cache.json";

async function readOptionalJson(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

async function loadPeopleFileConfig(cwd) {
  const localConfigPath = path.join(cwd, "config", "people.json");
  const repoConfigPath = path.join(cwd, "config", "people.repo.json");

  return (await readOptionalJson(localConfigPath)) ?? (await readOptionalJson(repoConfigPath)) ?? {};
}

function resolveTimezone(envValue, fileValue) {
  const candidate = envValue || fileValue || DEFAULT_TIMEZONE;
  return DateTime.now().setZone(candidate).isValid ? candidate : DEFAULT_TIMEZONE;
}

function resolveLookbackDays(envValue, fileValue) {
  const candidate = Number(envValue ?? fileValue ?? DEFAULT_LOOKBACK_DAYS);
  return Number.isFinite(candidate) && candidate > 0 ? Math.floor(candidate) : DEFAULT_LOOKBACK_DAYS;
}

function resolvePageSize(envValue, fileValue) {
  const candidate = Number(envValue ?? fileValue ?? DEFAULT_PAGE_SIZE);
  return Number.isFinite(candidate) && candidate > 0 ? Math.floor(candidate) : DEFAULT_PAGE_SIZE;
}

function resolveRefreshDays(envValue, fileValue, lookbackDays) {
  const candidate = Number(envValue ?? fileValue ?? DEFAULT_REFRESH_DAYS);
  const resolved = Number.isFinite(candidate) && candidate > 0 ? Math.floor(candidate) : DEFAULT_REFRESH_DAYS;
  return Math.min(resolved, lookbackDays);
}

function resolveScope(envValue, fileValue) {
  const candidate = String(envValue || fileValue || DEFAULT_SCOPE).toLowerCase();
  return candidate === "admin" ? "admin" : "self";
}

function resolveBoolean(envValue, fileValue, fallback = false) {
  const candidate = envValue ?? fileValue;
  if (candidate === undefined || candidate === null || candidate === "") {
    return fallback;
  }
  if (typeof candidate === "boolean") {
    return candidate;
  }
  return /^(1|true|yes|on)$/i.test(String(candidate).trim());
}

function resolveDate(value, timeZone) {
  if (!value) {
    return null;
  }

  const date = DateTime.fromISO(value, { zone: timeZone });
  return date.isValid ? date.toISODate() : null;
}

function resolvePersonId(entry, tokenNames, index) {
  const explicitPersonId = slugify(entry.personId);
  if (explicitPersonId !== "unknown") {
    return explicitPersonId;
  }

  const displayNamePersonId = slugify(entry.displayName);
  if (displayNamePersonId !== "unknown") {
    return displayNamePersonId;
  }

  const tokenDerivedPersonId = slugify(tokenNames.join("-"));
  if (tokenDerivedPersonId !== "unknown") {
    return tokenDerivedPersonId;
  }

  return `person-${index + 1}`;
}

function normalizePeople(config) {
  const people = Array.isArray(config?.people) ? config.people : [];
  return people
    .filter((entry) => entry && entry.displayName && Array.isArray(entry.tokenNames))
    .map((entry, index) => {
      const tokenNames = entry.tokenNames.map((tokenName) => String(tokenName).trim()).filter(Boolean);
      return {
        personId: resolvePersonId(entry, tokenNames, index),
        displayName: String(entry.displayName).trim(),
        tokenNames,
      };
    })
    .filter((entry) => entry.tokenNames.length > 0);
}

function parseAccountsJson(raw) {
  if (!raw) {
    return null;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`FOROPENCODE_ACCOUNTS_JSON is not valid JSON: ${error.message}`);
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("FOROPENCODE_ACCOUNTS_JSON must be a non-empty JSON array.");
  }

  return parsed;
}

function normalizeAccount(entry, index, defaults) {
  const source = entry && typeof entry === "object" ? entry : {};
  const sourceAuth = source.auth && typeof source.auth === "object" ? source.auth : source;
  const id = String(source.id || source.accountId || `account-${index + 1}`).trim();

  return {
    id: id || `account-${index + 1}`,
    label: String(source.label || source.displayName || `账号 ${index + 1}`).trim(),
    baseUrl: String(source.baseUrl || defaults.baseUrl).replace(/\/+$/, ""),
    scope: resolveScope(source.scope, defaults.scope),
    auth: {
      cookie: String(sourceAuth.cookie || ""),
      authorization: String(sourceAuth.authorization || sourceAuth.accessToken || ""),
      userId: String(sourceAuth.userId || sourceAuth.newApiUser || ""),
      username: String(sourceAuth.username || ""),
      password: String(sourceAuth.password || ""),
      turnstileToken: String(sourceAuth.turnstileToken || ""),
      preferPasswordLogin: resolveBoolean(
        sourceAuth.preferPasswordLogin,
        defaults.preferPasswordLogin,
      ),
    },
  };
}

function buildRuntimeAccounts(env, defaults) {
  const fromJson = parseAccountsJson(env.FOROPENCODE_ACCOUNTS_JSON);
  if (fromJson) {
    const seenIds = new Set();
    return fromJson.map((entry, index) => {
      const account = normalizeAccount(entry, index, defaults);
      if (seenIds.has(account.id)) {
        throw new Error(`Duplicate account id in FOROPENCODE_ACCOUNTS_JSON: ${account.id}`);
      }
      seenIds.add(account.id);
      return account;
    });
  }

  const legacyAuth = {
    cookie: env.FOROPENCODE_COOKIE || "",
    authorization:
      env.FOROPENCODE_AUTHORIZATION ||
      (env.FOROPENCODE_ACCESS_TOKEN ? `Bearer ${env.FOROPENCODE_ACCESS_TOKEN}` : ""),
    userId: env.FOROPENCODE_USER_ID || env.FOROPENCODE_NEW_API_USER || "",
    username: env.FOROPENCODE_USERNAME || "",
    password: env.FOROPENCODE_PASSWORD || "",
    turnstileToken: env.FOROPENCODE_TURNSTILE_TOKEN || "",
    preferPasswordLogin: resolveBoolean(
      env.FOROPENCODE_PREFER_PASSWORD_LOGIN,
      defaults.preferPasswordLogin,
    ),
  };

  const accounts = [
    normalizeAccount(
      {
        id: env.FOROPENCODE_ACCOUNT_1_ID || "account-1",
        label: env.FOROPENCODE_ACCOUNT_1_LABEL || "账号 1",
        baseUrl: env.FOROPENCODE_ACCOUNT_1_BASE_URL || defaults.baseUrl,
        scope: env.FOROPENCODE_ACCOUNT_1_SCOPE || defaults.scope,
        auth: {
          cookie: env.FOROPENCODE_ACCOUNT_1_COOKIE || legacyAuth.cookie,
          authorization: env.FOROPENCODE_ACCOUNT_1_AUTHORIZATION || legacyAuth.authorization,
          userId: env.FOROPENCODE_ACCOUNT_1_USER_ID || legacyAuth.userId,
          username: env.FOROPENCODE_ACCOUNT_1_USERNAME || legacyAuth.username,
          password: env.FOROPENCODE_ACCOUNT_1_PASSWORD || legacyAuth.password,
          turnstileToken: env.FOROPENCODE_ACCOUNT_1_TURNSTILE_TOKEN || legacyAuth.turnstileToken,
          preferPasswordLogin: resolveBoolean(
            env.FOROPENCODE_ACCOUNT_1_PREFER_PASSWORD_LOGIN,
            legacyAuth.preferPasswordLogin,
          ),
        },
      },
      0,
      defaults,
    ),
  ];

  const hasSecondAccount = [
    env.FOROPENCODE_ACCOUNT_2_COOKIE,
    env.FOROPENCODE_ACCOUNT_2_AUTHORIZATION,
    env.FOROPENCODE_ACCOUNT_2_ACCESS_TOKEN,
    env.FOROPENCODE_ACCOUNT_2_USER_ID,
    env.FOROPENCODE_ACCOUNT_2_USERNAME,
    env.FOROPENCODE_ACCOUNT_2_PASSWORD,
  ].some(Boolean);

  if (hasSecondAccount) {
    accounts.push(
      normalizeAccount(
        {
          id: env.FOROPENCODE_ACCOUNT_2_ID || "account-2",
          label: env.FOROPENCODE_ACCOUNT_2_LABEL || "账号 2",
          baseUrl: env.FOROPENCODE_ACCOUNT_2_BASE_URL || defaults.baseUrl,
          scope: env.FOROPENCODE_ACCOUNT_2_SCOPE || defaults.scope,
          auth: {
            cookie: env.FOROPENCODE_ACCOUNT_2_COOKIE || "",
            authorization:
              env.FOROPENCODE_ACCOUNT_2_AUTHORIZATION ||
              (env.FOROPENCODE_ACCOUNT_2_ACCESS_TOKEN
                ? `Bearer ${env.FOROPENCODE_ACCOUNT_2_ACCESS_TOKEN}`
                : ""),
            userId: env.FOROPENCODE_ACCOUNT_2_USER_ID || "",
            username: env.FOROPENCODE_ACCOUNT_2_USERNAME || "",
            password: env.FOROPENCODE_ACCOUNT_2_PASSWORD || "",
            turnstileToken: env.FOROPENCODE_ACCOUNT_2_TURNSTILE_TOKEN || "",
            preferPasswordLogin: resolveBoolean(
              env.FOROPENCODE_ACCOUNT_2_PREFER_PASSWORD_LOGIN,
              legacyAuth.preferPasswordLogin,
            ),
          },
        },
        1,
        defaults,
      ),
    );
  }

  return accounts;
}

export async function loadRuntimeConfig({ cwd = process.cwd(), env = process.env } = {}) {
  const fileConfig = await loadPeopleFileConfig(cwd);

  const timeZone = resolveTimezone(env.USAGE_TIMEZONE, fileConfig.timezone);
  const lookbackDays = resolveLookbackDays(env.USAGE_LOOKBACK_DAYS, fileConfig.lookbackDays);
  const refreshDays = resolveRefreshDays(env.USAGE_REFRESH_DAYS, fileConfig.refreshDays, lookbackDays);
  const startDate = resolveDate(env.USAGE_START_DATE, timeZone);
  const endDate = resolveDate(env.USAGE_END_DATE, timeZone);

  const baseUrl = env.FOROPENCODE_BASE_URL || fileConfig.baseUrl || DEFAULT_BASE_URL;
  const scope = resolveScope(env.FOROPENCODE_SCOPE, fileConfig.scope);
  const preferPasswordLogin = resolveBoolean(
    env.FOROPENCODE_PREFER_PASSWORD_LOGIN,
    fileConfig.preferPasswordLogin,
  );
  const legacyAuth = {
    cookie: env.FOROPENCODE_COOKIE || "",
    authorization:
      env.FOROPENCODE_AUTHORIZATION ||
      (env.FOROPENCODE_ACCESS_TOKEN ? `Bearer ${env.FOROPENCODE_ACCESS_TOKEN}` : ""),
    userId: env.FOROPENCODE_USER_ID || env.FOROPENCODE_NEW_API_USER || "",
    username: env.FOROPENCODE_USERNAME || "",
    password: env.FOROPENCODE_PASSWORD || "",
    turnstileToken: env.FOROPENCODE_TURNSTILE_TOKEN || "",
    preferPasswordLogin,
  };
  const accounts = buildRuntimeAccounts(env, { baseUrl, scope, preferPasswordLogin });

  return {
    cwd,
    baseUrl,
    scope,
    timeZone,
    lookbackDays,
    refreshDays,
    startDate,
    endDate,
    pageSize: resolvePageSize(env.USAGE_PAGE_SIZE, fileConfig.pageSize),
    outputFile: env.OUTPUT_FILE || fileConfig.outputFile || DEFAULT_OUTPUT_FILE,
    cacheFile: env.USAGE_CACHE_FILE || fileConfig.cacheFile || DEFAULT_CACHE_FILE,
    sessionCacheFile:
      env.AUTH_SESSION_CACHE_FILE || fileConfig.sessionCacheFile || DEFAULT_SESSION_CACHE_FILE,
    auth: legacyAuth,
    accounts,
    people: normalizePeople(fileConfig),
  };
}
