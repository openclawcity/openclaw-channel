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

      // Report initial status so the gateway knows we're starting up
      ctx.setStatus({ accountId, running: true, connected: false, lastStartAt: Date.now() });

      const adapter = new OpenClawCityAdapter({
        config: account,
        logger: log,
        signal: abortSignal,
        onMessage: async (envelope) => {
          log?.info?.(`[OCC] Event received: ${envelope.id} from=${envelope.sender.name} type=${envelope.metadata.eventType}`);

          // Step 1: Resolve agent route
          log?.info?.(`[OCC] Step 1: resolveAgentRoute...`);
          let route;
          try {
            route = await rt.channel.routing.resolveAgentRoute({
              cfg,
              channel: CHANNEL_ID,
              accountId,
              chatType: 'direct',
              peerId: envelope.sender.id,
              senderId: envelope.sender.id,
            });
            log?.info?.(`[OCC] Step 1 OK: agent=${route.agentId}, session=${route.sessionKey}`);
          } catch (err) {
            log?.error?.(`[OCC] Step 1 FAILED (resolveAgentRoute): ${String(err)}`);
            throw err;
          }

          // Step 2: Build raw MsgContext
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
          log?.info?.(`[OCC] Step 2 OK: MsgContext built, SessionKey=${rawCtx.SessionKey}`);

          // Step 3: Finalize inbound context
          log?.info?.(`[OCC] Step 3: finalizeInboundContext...`);
          let msgCtx: MsgContext;
          try {
            msgCtx = rt.channel.reply.finalizeInboundContext(rawCtx);
            log?.info?.(`[OCC] Step 3 OK: CommandAuthorized=${msgCtx.CommandAuthorized}`);
          } catch (err) {
            log?.error?.(`[OCC] Step 3 FAILED (finalizeInboundContext): ${String(err)}`);
            throw err;
          }

          // Step 4: Record inbound session
          log?.info?.(`[OCC] Step 4: recordInboundSession...`);
          try {
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
                log?.error?.(`[OCC] Step 4 onRecordError: ${String(err)}`);
              },
            });
            log?.info?.(`[OCC] Step 4 OK: session recorded`);
          } catch (err) {
            log?.error?.(`[OCC] Step 4 FAILED (recordInboundSession): ${String(err)}`);
            throw err;
          }

          // Step 5: Dispatch — triggers the immediate agent turn
          log?.info?.(`[OCC] Step 5: dispatchReplyWithBufferedBlockDispatcher...`);
          try {
            const result = await rt.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
              ctx: msgCtx,
              cfg,
              dispatcherOptions: {
                deliver: async (payload: ReplyPayload) => {
                  const text = payload.text;
                  log?.info?.(`[OCC] Deliver callback: text=${text ? text.slice(0, 80) + '...' : '(empty)'}`);
                  if (!text) return;

                  adapter.sendReply({
                    type: 'agent_reply',
                    action: 'dm_reply',
                    text,
                    conversationId: envelope.metadata.conversationId as string | undefined,
                  });
                  log?.info?.(`[OCC] Reply sent via WebSocket`);
                },
                onError: (err, info) => {
                  log?.error?.(`[OCC] Step 5 onError (${info.kind}): ${String(err)}`);
                },
              },
            });
            log?.info?.(`[OCC] Step 5 OK: dispatch complete`, result);
          } catch (err) {
            log?.error?.(`[OCC] Step 5 FAILED (dispatch): ${String(err)}`);
            throw err;
          }
        },
        onWelcome: (welcome) => {
          const nearby = welcome.nearby_bots ?? welcome.nearby ?? [];
          log?.info?.(`Connected to OpenClawCity. Location: ${welcome.location?.zoneName ?? 'unknown'}, Nearby: ${nearby.length} bots`);
          ctx.setStatus({
            accountId,
            running: true,
            connected: true,
            lastConnectedAt: Date.now(),
            lastError: null,
          });
        },
        onError: (error) => {
          log?.error?.(`Server error: ${error.reason}`);
          ctx.setStatus({
            ...ctx.getStatus(),
            lastError: `${error.reason}: ${error.message ?? ''}`,
          });
        },
        onStateChange: (state) => {
          log?.debug?.(`Connection state: ${state}`);
          if (state === 'DISCONNECTED') {
            ctx.setStatus({
              ...ctx.getStatus(),
              connected: false,
              lastDisconnect: { at: Date.now() },
            });
          } else if (state === 'CONNECTED') {
            ctx.setStatus({
              ...ctx.getStatus(),
              connected: true,
              lastConnectedAt: Date.now(),
            });
          }
        },
      });

      // Stop any existing adapter for this account to prevent duplicate
      // connections — the server closes old connections with code 4000
      // "replaced_by_new_connection" which would trigger a reconnect storm
      const existing = adapters.get(accountId);
      if (existing) {
        existing.stop();
      }
      adapters.set(accountId, adapter);
      await adapter.connect();

      return {
        stop: () => {
          adapter.stop();
          adapters.delete(accountId);
          ctx.setStatus({
            accountId,
            running: false,
            connected: false,
            lastStopAt: Date.now(),
          });
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
