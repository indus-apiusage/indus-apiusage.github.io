import path from "node:path";

import { loadRuntimeConfig } from "../src/lib/config.mjs";
import { ForApiClient } from "../src/lib/for-api-client.mjs";

function accountIdFromArgs(args) {
  const index = args.indexOf("--account-id");
  const accountId = index === -1 ? "" : String(args[index + 1] || "").trim();

  if (!accountId) {
    throw new Error("Missing --account-id for the password reconnect.");
  }

  return accountId;
}

async function main() {
  const accountId = accountIdFromArgs(process.argv.slice(2));
  const runtime = await loadRuntimeConfig();
  const account = runtime.accounts.find((candidate) => candidate.id === accountId);

  if (!account) {
    throw new Error(`Account ${accountId} is not available in the current sync environment.`);
  }
  if (!account.auth.allowPasswordLogin) {
    throw new Error("Password reconnect was not explicitly approved for this account.");
  }

  const client = new ForApiClient({
    baseUrl: account.baseUrl,
    auth: account.auth,
    accountId: account.id,
    sessionCacheFile: path.resolve(runtime.cwd, runtime.sessionCacheFile),
  });

  // This deliberately creates one password session for the selected account
  // only. It takes the same cache lock as refreshes before replacing a stale
  // local session, so reconnect cannot race a loop that is winding down.
  await client.reconnectWithPassword();
  await client.fetchSelf();

  if (!client.hasRefreshCookie()) {
    throw new Error("Password login did not return a refresh session; automatic sync remains disabled.");
  }

  console.log(`Password session established for ${account.label || account.id}.`);
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exitCode = 1;
});
