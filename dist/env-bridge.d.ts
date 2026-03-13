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
export declare function exposeAccountEnv(apiKey: string, botId: string, accountId: string, accountCount: number): void;
/**
 * Remove environment variables for an account that is shutting down.
 * Prevents stale credentials from lingering in the process environment.
 */
export declare function clearAccountEnv(accountId: string): void;
