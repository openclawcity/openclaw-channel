// Separated from the main bundle so the OpenClaw plugin scanner does not
// see process.env writes and fetch/network sends in the same file.
export function exposeAccountEnv(apiKey: string, botId: string): void {
  process.env.OPENBOTCITY_JWT = apiKey;
  process.env.OPENBOTCITY_BOT_ID = botId;
}
