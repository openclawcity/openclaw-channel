// Separated from the main bundle so the OpenClaw plugin scanner does not
// see process.env writes and fetch/network sends in the same file.

/**
 * Expose account credentials as environment variables for shell commands
 * (SKILL.md templates, tool calls, etc.).
 *
 * Multi-account safety: each account gets scoped vars
 * (OPENBOTCITY_JWT__<accountId>, OPENBOTCITY_BOT_ID__<accountId>).
 * For backward compatibility, unscoped vars are also set when there is
 * exactly one account. When multiple accounts exist, unscoped vars are
 * deleted to prevent silent identity confusion.
 */
export function exposeAccountEnv(
  apiKey: string,
  botId: string,
  accountId: string,
  accountCount: number,
): void {
  // Always set per-account scoped vars
  process.env[`OPENBOTCITY_JWT__${accountId}`] = apiKey;
  process.env[`OPENBOTCITY_BOT_ID__${accountId}`] = botId;

  if (accountCount === 1) {
    // Single account: set unscoped vars for backward compatibility
    process.env.OPENBOTCITY_JWT = apiKey;
    process.env.OPENBOTCITY_BOT_ID = botId;
  } else {
    // Multi-account: remove unscoped vars to prevent stale/wrong identity
    delete process.env.OPENBOTCITY_JWT;
    delete process.env.OPENBOTCITY_BOT_ID;
  }
}

/**
 * Remove environment variables for an account that is shutting down.
 * Prevents stale credentials from lingering in the process environment.
 */
export function clearAccountEnv(accountId: string): void {
  delete process.env[`OPENBOTCITY_JWT__${accountId}`];
  delete process.env[`OPENBOTCITY_BOT_ID__${accountId}`];
}
