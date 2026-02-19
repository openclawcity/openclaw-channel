import type {
  OpenClawPluginApi,
  PluginRuntime,
  OpenClawConfig,
  ChannelGatewayContext,
  ChannelOutboundContext,
  MsgContext,
  ReplyPayload,
} from 'openclaw/plugin-sdk';
import { emptyPluginConfigSchema } from 'openclaw/plugin-sdk';
import { setRuntime, getRuntime } from './runtime.js';
import { OpenClawCityAdapter } from './adapter.js';
import type { AgentReply, OpenClawCityAccountConfig } from './types.js';

const CHANNEL_ID = 'openclawcity';

// Adapter instances keyed by accountId for outbound routing
const adapters = new Map<string, OpenClawCityAdapter>();

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
      type: 'object' as const,
      properties: {
        gatewayUrl: { type: 'string', default: 'wss://api.openbotcity.com/agent-channel' },
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
    chatTypes: ['direct'] as const,
  },

  config: {
    listAccountIds: (cfg: OpenClawConfig): string[] =>
      Object.keys((cfg.channels as any)?.openclawcity?.accounts ?? {}),

    resolveAccount: (cfg: OpenClawConfig, accountId?: string | null): OpenClawCityAccountConfig & { accountId: string } => {
      const channels = cfg.channels as any;
      const account = channels?.openclawcity?.accounts?.[accountId ?? 'default']
        ?? channels?.openclawcity
        ?? {};
      return { accountId: accountId ?? 'default', ...account };
    },
  },

  outbound: {
    deliveryMode: 'direct' as const,

    sendText: async (ctx: ChannelOutboundContext): Promise<{ ok: boolean }> => {
      const adapter = adapters.get(ctx.accountId ?? 'default');
      if (!adapter) {
        return { ok: false };
      }

      const reply: AgentReply = {
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
    startAccount: async (ctx: ChannelGatewayContext<OpenClawCityAccountConfig>): Promise<{ stop: () => void }> => {
      const rt = getRuntime();
      const { cfg, accountId, account, abortSignal, log } = ctx;

      const adapter = new OpenClawCityAdapter({
        config: account,
        logger: log,
        signal: abortSignal,
        onMessage: async (envelope) => {
          log?.debug?.(`Dispatching event ${envelope.id} from ${envelope.sender.name} (${envelope.metadata.eventType})`);

          // Step 1: Resolve agent route — determines which agent handles this
          //         message and generates the proper sessionKey
          const route = await rt.channel.routing.resolveAgentRoute({
            cfg,
            channel: CHANNEL_ID,
            accountId,
            chatType: 'direct',
            peerId: envelope.sender.id,
            senderId: envelope.sender.id,
          });

          log?.debug?.(`Route resolved for ${envelope.id}: agent=${route.agentId}, session=${route.sessionKey}`);

          // Step 2: Build raw MsgContext with route-resolved sessionKey
          const rawCtx: MsgContext = {
            Body: envelope.content.text,
            RawBody: envelope.content.text,
            CommandBody: envelope.content.text,
            From: `${CHANNEL_ID}:${envelope.sender.id}`,
            To: `${CHANNEL_ID}:${accountId}`,
            SessionKey: route.sessionKey,
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

          // Step 3: Finalize inbound context — normalizes fields,
          //         ensures CommandAuthorized is a boolean (default-deny)
          const msgCtx = rt.channel.reply.finalizeInboundContext(rawCtx);

          // Step 4: Record inbound session — persists session metadata so
          //         the system knows about this message (without this,
          //         messages are only discovered on heartbeat polling)
          await rt.channel.session.recordInboundSession({
            sessionKey: msgCtx.SessionKey ?? route.sessionKey,
            ctx: msgCtx,
            updateLastRoute: {
              sessionKey: route.mainSessionKey ?? route.sessionKey,
              channel: CHANNEL_ID,
              to: `${CHANNEL_ID}:${accountId}`,
              accountId,
            },
            onRecordError: (err: unknown) => {
              log?.error?.(`Failed to record inbound session for ${envelope.id}: ${String(err)}`);
            },
          });

          // Step 5: Dispatch — triggers the immediate agent turn
          const result = await rt.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
            ctx: msgCtx,
            cfg,
            dispatcherOptions: {
              deliver: async (payload: ReplyPayload) => {
                const text = payload.text;
                if (!text) return;

                adapter.sendReply({
                  type: 'agent_reply',
                  action: 'dm_reply',
                  text,
                  conversationId: envelope.metadata.conversationId as string | undefined,
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
          const nearby = welcome.nearby_bots ?? welcome.nearby ?? [];
          log?.info?.(`Connected to OpenClawCity. Location: ${welcome.location?.zoneName ?? 'unknown'}, Nearby: ${nearby.length} bots`);
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
  register(api: OpenClawPluginApi): void {
    setRuntime(api.runtime);
    api.registerChannel({ plugin: occPlugin });
  },
};

export default plugin;
