import { emptyPluginConfigSchema, buildChannelConfigSchema } from 'openclaw/plugin-sdk';
import { setRuntime, getRuntime } from './runtime.js';
import { OpenBotCityConfigSchema } from './config-schema.js';
import { OpenBotCityAdapter } from './adapter.js';
const CHANNEL_ID = 'openbotcity';
// Adapter instances keyed by accountId for outbound routing
const adapters = new Map();
const obcPlugin = {
    id: CHANNEL_ID,
    meta: {
        id: CHANNEL_ID,
        label: 'OpenBotCity',
        selectionLabel: 'OpenBotCity (Live City)',
        docsPath: '/channels/openbotcity',
        blurb: 'Live connection to OpenBotCity — AI agent city with real-time events.',
        aliases: ['obc', 'openbotcity'],
    },
    configSchema: buildChannelConfigSchema(OpenBotCityConfigSchema),
    capabilities: {
        chatTypes: ['direct'],
    },
    config: {
        listAccountIds: (cfg) => Object.keys(cfg.channels?.openbotcity?.accounts ?? {}),
        resolveAccount: (cfg, accountId) => {
            const account = cfg.channels?.openbotcity?.accounts?.[accountId ?? 'default']
                ?? cfg.channels?.openbotcity
                ?? {};
            return { accountId: accountId ?? 'default', ...account };
        },
    },
    outbound: {
        deliveryMode: 'direct',
        sendText: async (payload) => {
            const adapter = adapters.get(payload.accountId ?? 'default');
            if (!adapter) {
                return { ok: false };
            }
            const reply = {
                type: 'agent_reply',
                action: 'dm_reply',
                text: payload.text,
                conversationId: payload.to,
            };
            adapter.sendReply(reply);
            return { ok: true };
        },
    },
    gateway: {
        startAccount: async (ctx) => {
            const rt = getRuntime();
            const { accountId, config, signal, log } = ctx;
            const adapter = new OpenBotCityAdapter({
                config,
                logger: log,
                signal,
                onMessage: async (envelope) => {
                    // Dispatch the normalized message to the OpenClaw agent via runtime
                    try {
                        await rt.channel?.reply?.dispatchReplyWithBufferedBlockDispatcher?.({
                            Body: envelope.content.text,
                            From: `${CHANNEL_ID}:${envelope.sender.id}`,
                            To: `${CHANNEL_ID}:${accountId}`,
                            Provider: CHANNEL_ID,
                            Surface: CHANNEL_ID,
                            SenderId: envelope.sender.id,
                            SenderName: envelope.sender.name,
                            ChatType: 'dm',
                            AccountId: accountId,
                            MessageSid: envelope.id,
                            Timestamp: envelope.timestamp,
                        });
                    }
                    catch (err) {
                        log?.error?.('Failed to dispatch message to gateway:', err);
                    }
                },
                onWelcome: (welcome) => {
                    log?.info?.(`Connected to OpenBotCity. Location: ${welcome.location?.zoneName ?? 'unknown'}, Nearby: ${welcome.nearby?.length ?? 0} bots`);
                },
                onError: (error) => {
                    log?.error?.(`Server error: ${error.reason}`);
                },
                onStateChange: (state) => {
                    log?.debug?.(`Connection state: ${state}`);
                },
            });
            adapters.set(accountId, adapter);
            await adapter.connect();
            return {
                stop: () => {
                    adapter.stop();
                    adapters.delete(accountId);
                },
            };
        },
    },
};
const plugin = {
    id: CHANNEL_ID,
    name: 'OpenBotCity Channel',
    configSchema: emptyPluginConfigSchema(),
    register(api) {
        setRuntime(api.runtime);
        api.registerChannel({ plugin: obcPlugin });
    },
};
export default plugin;
