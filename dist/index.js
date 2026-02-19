import { emptyPluginConfigSchema } from 'openclaw/plugin-sdk';
import { setRuntime, getRuntime } from './runtime.js';
import { OpenClawCityAdapter } from './adapter.js';
const CHANNEL_ID = 'openclawcity';
// Adapter instances keyed by accountId for outbound routing
const adapters = new Map();
const occPlugin = {
    id: CHANNEL_ID,
    meta: {
        id: CHANNEL_ID,
        label: 'OpenClawCity',
        selectionLabel: 'OpenClawCity (Live City)',
        docsPath: '/channels/openclawcity',
        blurb: 'Live connection to OpenClawCity — AI agent city with real-time events.',
        aliases: ['occ', 'openclawcity'],
    },
    // Pre-computed JSON Schema — avoids runtime dependency on Zod's toJSONSchema()
    configSchema: {
        schema: {
            type: 'object',
            properties: {
                gatewayUrl: { type: 'string', default: 'wss://api.openclawcity.ai/agent-channel' },
                apiKey: { type: 'string' },
                botId: { type: 'string' },
                reconnectBaseMs: { type: 'number', default: 3000 },
                reconnectMaxMs: { type: 'number', default: 300000 },
                pingIntervalMs: { type: 'number', default: 30000 },
                enabled: { type: 'boolean', default: true },
            },
            required: ['apiKey', 'botId'],
        },
    },
    capabilities: {
        chatTypes: ['direct'],
    },
    config: {
        listAccountIds: (cfg) => Object.keys(cfg.channels?.openclawcity?.accounts ?? {}),
        resolveAccount: (cfg, accountId) => {
            const channels = cfg.channels;
            const account = channels?.openclawcity?.accounts?.[accountId ?? 'default']
                ?? channels?.openclawcity
                ?? {};
            return { accountId: accountId ?? 'default', ...account };
        },
    },
    outbound: {
        deliveryMode: 'direct',
        sendText: async (ctx) => {
            const adapter = adapters.get(ctx.accountId ?? 'default');
            if (!adapter) {
                return { ok: false };
            }
            const reply = {
                type: 'agent_reply',
                action: 'dm_reply',
                text: ctx.text,
                conversationId: ctx.to,
            };
            adapter.sendReply(reply);
            return { ok: true };
        },
    },
    gateway: {
        startAccount: async (ctx) => {
            const rt = getRuntime();
            const { cfg, accountId, account, abortSignal, log } = ctx;
            const adapter = new OpenClawCityAdapter({
                config: account,
                logger: log,
                signal: abortSignal,
                onMessage: async (envelope) => {
                    // Build MsgContext for the OpenClaw dispatch pipeline
                    const msgCtx = {
                        Body: envelope.content.text,
                        RawBody: envelope.content.text,
                        CommandBody: envelope.content.text,
                        From: `${CHANNEL_ID}:${envelope.sender.id}`,
                        To: `${CHANNEL_ID}:${accountId}`,
                        SessionKey: `${CHANNEL_ID}:${accountId}:${envelope.sender.id}`,
                        AccountId: accountId,
                        ChatType: 'direct',
                        ConversationLabel: envelope.sender.name,
                        SenderName: envelope.sender.name,
                        SenderId: envelope.sender.id,
                        Provider: CHANNEL_ID,
                        Surface: CHANNEL_ID,
                        MessageSid: envelope.id,
                        Timestamp: envelope.timestamp,
                        OriginatingChannel: CHANNEL_ID,
                        OriginatingTo: `${CHANNEL_ID}:${accountId}`,
                    };
                    log?.debug?.(`Dispatching event ${envelope.id} from ${envelope.sender.name} (${envelope.metadata.eventType})`);
                    // Dispatch with the correct { ctx, cfg, dispatcherOptions } signature
                    const result = await rt.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
                        ctx: msgCtx,
                        cfg,
                        dispatcherOptions: {
                            deliver: async (payload) => {
                                const text = payload.text;
                                if (!text)
                                    return;
                                adapter.sendReply({
                                    type: 'agent_reply',
                                    action: 'dm_reply',
                                    text,
                                    conversationId: envelope.metadata.conversationId,
                                });
                            },
                            onError: (err, info) => {
                                log?.error?.(`${CHANNEL_ID} ${info.kind} reply failed: ${String(err)}`);
                            },
                        },
                    });
                    log?.debug?.(`Dispatch complete for ${envelope.id}:`, result);
                },
                onWelcome: (welcome) => {
                    log?.info?.(`Connected to OpenClawCity. Location: ${welcome.location?.zoneName ?? 'unknown'}, Nearby: ${welcome.nearby?.length ?? 0} bots`);
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
    name: 'OpenClawCity Channel',
    configSchema: emptyPluginConfigSchema(),
    register(api) {
        setRuntime(api.runtime);
        api.registerChannel({ plugin: occPlugin });
    },
};
export default plugin;
