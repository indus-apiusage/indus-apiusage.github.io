import fs from "node:fs/promises";
import path from "node:path";

import { DateTime } from "luxon";

import { slugify } from "./utils.mjs";

const DEFAULT_BASE_URL = "https://www.foropencode.com";
const DEFAULT_SCOPE = "self";
const DEFAULT_TIMEZONE = "Asia/Shanghai";
const DEFAULT_LOOKBACK_DAYS = 30;
const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_OUTPUT_FILE = "docs/data/latest.json";

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

function resolveScope(envValue, fileValue) {
  const candidate = String(envValue || fileValue || DEFAULT_SCOPE).toLowerCase();
  return candidate === "admin" ? "admin" : "self";
}

function resolveDate(value, timeZone) {
  if (!value) {
    return null;
  }

  const date = DateTime.fromISO(value, { zone: timeZone });
  return date.isValid ? date.toISODate() : null;
}

function normalizePeople(config) {
  const people = Array.isArray(config?.people) ? config.people : [];
  return people
    .filter((entry) => entry && entry.displayName && Array.isArray(entry.tokenNames))
    .map((entry) => ({
      personId: slugify(entry.personId || entry.displayName),
      displayName: String(entry.displayName).trim(),
      tokenNames: entry.tokenNames.map((tokenName) => String(tokenName).trim()).filter(Boolean),
    }))
    .filter((entry) => entry.tokenNames.length > 0);
}

export async function loadRuntimeConfig({ cwd = process.cwd(), env = process.env } = {}) {
  const fileConfig = await loadPeopleFileConfig(cwd);

  const timeZone = resolveTimezone(env.USAGE_TIMEZONE, fileConfig.timezone);
  const lookbackDays = resolveLookbackDays(env.USAGE_LOOKBACK_DAYS, fileConfig.lookbackDays);
  const startDate = resolveDate(env.USAGE_START_DATE, timeZone);
  const endDate = resolveDate(env.USAGE_END_DATE, timeZone);

  return {
    cwd,
    baseUrl: env.FOROPENCODE_BASE_URL || fileConfig.baseUrl || DEFAULT_BASE_URL,
    scope: resolveScope(env.FOROPENCODE_SCOPE, fileConfig.scope),
    timeZone,
    lookbackDays,
    startDate,
    endDate,
    pageSize: resolvePageSize(env.USAGE_PAGE_SIZE, fileConfig.pageSize),
    outputFile: env.OUTPUT_FILE || fileConfig.outputFile || DEFAULT_OUTPUT_FILE,
    auth: {
      cookie: env.FOROPENCODE_COOKIE || "",
      userId: env.FOROPENCODE_USER_ID || env.FOROPENCODE_NEW_API_USER || "",
      username: env.FOROPENCODE_USERNAME || "",
      password: env.FOROPENCODE_PASSWORD || "",
      turnstileToken: env.FOROPENCODE_TURNSTILE_TOKEN || "",
    },
    people: normalizePeople(fileConfig),
  };
}
