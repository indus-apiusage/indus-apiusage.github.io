import fs from "node:fs/promises";

import { loadRuntimeConfig } from "../src/lib/config.mjs";
import { ForApiClient } from "../src/lib/for-api-client.mjs";
import { toNumber } from "../src/lib/utils.mjs";

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function readJsonInput() {
  if (process.stdin.isTTY) {
    return {};
  }

  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }

  const text = Buffer.concat(chunks).toString("utf8").trim();
  return text ? JSON.parse(text) : {};
}

function redact(message) {
  return String(message || "Operation failed")
    .replace(/Bearer\s+[^\s]+/gi, "Bearer [redacted]")
    .replace(/sk-[A-Za-z0-9._~-]+/g, "sk-[redacted]")
    .replace(/session=[^;\s]+/gi, "session=[redacted]")
    .replace(/cookie=[^;\s]+/gi, "cookie=[redacted]");
}

function writeResult(result) {
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

function getAccount(runtime, accountID) {
  const account = runtime.accounts.find((entry) => entry.id === accountID);
  if (!account) {
    throw new Error(`Account ${accountID || "(missing)"} was not found in the App credentials.`);
  }
  return account;
}

function normalizeKeyValue(value) {
  const key = String(value || "").trim();
  if (!key) {
    return "";
  }
  return key.startsWith("sk-") ? key : `sk-${key}`;
}

function quotaInDisplayUnits(rawQuota, quotaPerUnit) {
  if (!Number.isFinite(rawQuota) || !Number.isFinite(quotaPerUnit) || quotaPerUnit <= 0) {
    return null;
  }
  return Number((rawQuota / quotaPerUnit).toFixed(6));
}

function normalizeRemoteKey(item, revealedKey, quotaPerUnit) {
  const remoteID = Number(item?.id);
  const unlimitedQuota = Boolean(item?.unlimited_quota);
  const remainingRawQuota = toNumber(item?.remain_quota, 0);
  const usedRawQuota = toNumber(item?.used_quota, 0);

  return {
    remoteID: Number.isInteger(remoteID) ? remoteID : null,
    name: String(item?.name || "未命名密钥"),
    value: normalizeKeyValue(revealedKey),
    quotaLimit: unlimitedQuota ? null : quotaInDisplayUnits(remainingRawQuota, quotaPerUnit),
    unlimitedQuota,
    usedQuota: quotaInDisplayUnits(usedRawQuota, quotaPerUnit),
    expiredTime: toNumber(item?.expired_time, -1),
    modelLimitsEnabled: Boolean(item?.model_limits_enabled),
    modelLimits: String(item?.model_limits || ""),
    allowIPs: String(item?.allow_ips || ""),
    group: String(item?.group || ""),
    crossGroupRetry: Boolean(item?.cross_group_retry),
  };
}

async function createClient(runtime, accountID) {
  const account = getAccount(runtime, accountID);
  const client = new ForApiClient({
    baseUrl: account.baseUrl,
    auth: account.auth,
  });
  await client.ensureAuthenticated();
  return { account, client };
}

async function listAPIKeys(runtime, accountID) {
  const { client } = await createClient(runtime, accountID);
  const [statusResponse, items] = await Promise.all([
    client.fetchStatus(),
    client.fetchAllAPIKeys({ pageSize: 100 }),
  ]);
  const status = statusResponse?.data ?? {};
  const quotaPerUnit = toNumber(status.quota_per_unit, 500000);
  const ids = items.map((item) => item?.id).filter((id) => id !== undefined && id !== null);
  const revealedKeys = await client.revealAPIKeys(ids);
  const missingCount = ids.filter((id) => !revealedKeys[String(id)]).length;

  if (missingCount > 0) {
    throw new Error(
      `The website did not return ${missingCount} API key value(s). Check the account permission and try again.`,
    );
  }

  return {
    success: true,
    accountID,
    quotaPerUnit,
    quotaDisplayType: String(status.quota_display_type || "CNY"),
    keys: items.map((item) => normalizeRemoteKey(item, revealedKeys[String(item.id)], quotaPerUnit)),
  };
}

async function updateAPIKey(runtime, accountID) {
  const input = await readJsonInput();
  const { client } = await createClient(runtime, accountID);
  const id = Number(input.remoteID ?? input.id);

  if (!Number.isInteger(id)) {
    throw new Error("A numeric remote API key id is required.");
  }

  const statusResponse = await client.fetchStatus();
  const status = statusResponse?.data ?? {};
  const quotaPerUnit = toNumber(status.quota_per_unit, 500000);
  const unlimitedQuota = Boolean(input.unlimitedQuota);
  const quotaLimit = Number(input.quotaLimit ?? 0);

  if (!unlimitedQuota && (!Number.isFinite(quotaLimit) || quotaLimit < 0)) {
    throw new Error("API key quota must be a non-negative number or unlimited.");
  }

  const payload = {
    id,
    name: String(input.name || "未命名密钥").trim() || "未命名密钥",
    remain_quota: unlimitedQuota ? 0 : Math.round(quotaLimit * quotaPerUnit),
    expired_time: Number.isFinite(Number(input.expiredTime)) ? Math.trunc(Number(input.expiredTime)) : -1,
    unlimited_quota: unlimitedQuota,
    model_limits_enabled: Boolean(input.modelLimitsEnabled || input.modelLimits),
    model_limits: String(input.modelLimits || ""),
    allow_ips: String(input.allowIPs || ""),
    group: String(input.group || ""),
    cross_group_retry: Boolean(input.crossGroupRetry),
  };
  const response = await client.updateAPIKey(payload);

  if (!response?.success) {
    throw new Error(response?.message || "The website rejected the API key update.");
  }

  return {
    success: true,
    accountID,
    remoteID: id,
    quotaLimit: unlimitedQuota ? null : Number(quotaLimit.toFixed(6)),
    unlimitedQuota,
  };
}

async function main() {
  const command = process.argv[2] || "help";
  if (command === "help" || command === "--help") {
    writeResult({
      success: true,
      usage: "node scripts/manage-api-keys.mjs <list|update> --account-id account-1",
    });
    return;
  }

  const accountID = option("--account-id");
  if (!accountID) {
    throw new Error("--account-id is required.");
  }

  const runtime = await loadRuntimeConfig();
  const result = command === "list"
    ? await listAPIKeys(runtime, accountID)
    : command === "update"
      ? await updateAPIKey(runtime, accountID)
      : (() => { throw new Error(`Unknown API key command: ${command}`); })();

  writeResult(result);
}

try {
  await main();
} catch (error) {
  process.stderr.write(`${redact(error?.message || error)}\n`);
  process.exitCode = 1;
}
