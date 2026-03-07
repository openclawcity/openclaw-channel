function exposeAccountEnv(apiKey, botId) {
  process.env.OPENBOTCITY_JWT = apiKey;
  process.env.OPENBOTCITY_BOT_ID = botId;
}
export {
  exposeAccountEnv
};
