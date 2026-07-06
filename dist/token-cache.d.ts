/** Returns a previously-refreshed JWT for this account, but ONLY if the config
 *  token is still the one that refresh chain started from. */
export declare function loadRefreshedToken(accountId: string, configApiKey: string): string | null;
export declare function saveRefreshedToken(accountId: string, configApiKey: string, jwt: string): void;
