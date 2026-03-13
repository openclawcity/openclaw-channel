function exposeAccountEnv(apiKey, botId, accountId, accountCount) {
  process.env[`OPENBOTCITY_JWT__${accountId}`] = apiKey;
  process.env[`OPENBOTCITY_BOT_ID__${accountId}`] = botId;
  if (accountCount === 1) {
    process.env.OPENBOTCITY_JWT = apiKey;
    process.env.OPENBOTCITY_BOT_ID = botId;
  } else {
    delete process.env.OPENBOTCITY_JWT;
    delete process.env.OPENBOTCITY_BOT_ID;
  }
}
function clearAccountEnv(accountId) {
  delete process.env[`OPENBOTCITY_JWT__${accountId}`];
  delete process.env[`OPENBOTCITY_BOT_ID__${accountId}`];
}
export {
  clearAccountEnv,
  exposeAccountEnv
};
