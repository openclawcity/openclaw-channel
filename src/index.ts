import type {
  OpenClawPluginApi,
  PluginRuntime,
  OpenClawConfig,
  ChannelGatewayContext,
  ChannelOutboundContext,
  MsgContext,
  ReplyPayload,
  ReplyDispatchKind,
} from 'openclaw/plugin-sdk';
import { setRuntime, getRuntime } from './runtime.js';
import { OpenClawCityAdapter } from './adapter.js';
import { exposeAccountEnv, clearAccountEnv } from './env-bridge.js';
import type { AgentReply, OpenClawCityAccountConfig } from './types.js';
import { shouldInjectCityContext, type ContextInjectionRecord } from './context-dedup.js';
import { loadRefreshedToken, saveRefreshedToken } from './token-cache.js';

const CHANNEL_ID = 'openclawcity';
const DEFAULT_API_BASE = 'https://api.openbotcity.com';
const HEARTBEAT_CACHE_MS = 5 * 60 * 1000; // 5 minutes
// Suppress re-prepending the (cached, identical) city-context snapshot for the
// same conversation within this window — kills the bulky repeat on event bursts
// without losing information. See context-dedup.ts.
const CONTEXT_REINJECT_WINDOW_MS = 60 * 1000; // 60 seconds

/** Derive REST API base from WebSocket gateway URL.
 *  e.g. 'wss://api.openbotcity.com/agent-channel' → 'https://api.openbotcity.com' */
function deriveApiBase(gatewayUrl?: string): string {
  if (!gatewayUrl) return DEFAULT_API_BASE;
  try {
    const url = new URL(gatewayUrl);
    const protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
    return `${protocol}//${url.host}`;
  } catch {
    return DEFAULT_API_BASE;
  }
}

// ── Reply text sanitization ──
// The SDK's sanitizeUserFacingText strips <final>, [Tool Call:...], and
// <minimax:tool_call> but does NOT strip <PLHD> placeholder tags that some
// LLM providers emit for tool calls. If the SDK's tool-call parser fails to
// recognise a call, the raw markup leaks into payload.text and reaches
// deliver(). This regex catches that leak.
const TOOL_CALL_MARKUP_RE = /<PLHD\d*>[\s\S]*?<PLHD\d*>/g;

export function sanitizeReplyText(text: string): string | null {
  let cleaned = text.replace(TOOL_CALL_MARKUP_RE, '');
  cleaned = cleaned.trim();
  return cleaned || null;
}

// Adapter instances keyed by accountId for outbound routing
const adapters = new Map<string, OpenClawCityAdapter>();

// Heartbeat cache — one per account
const heartbeatCache = new Map<string, { data: string; fetchedAt: number }>();

// City-context injection bookkeeping — keyed per (account, peer) so repeated
// events in one conversation don't re-prepend the identical snapshot.
const contextInjectionState = new Map<string, ContextInjectionRecord>();

async function fetchHeartbeatContext(
  apiBase: string,
  jwt: string,
  accountId: string,
  log?: { info?: (...args: unknown[]) => void; error?: (...args: unknown[]) => void },
): Promise<string | null> {
  const cached = heartbeatCache.get(accountId);
  const now = Date.now();

  if (cached && (now - cached.fetchedAt) < HEARTBEAT_CACHE_MS) {
    log?.info?.(`[OCC] Heartbeat cache hit (age=${Math.round((now - cached.fetchedAt) / 1000)}s)`);
    return cached.data;
  }

  try {
    log?.info?.(`[OCC] Fetching heartbeat context from ${apiBase}/world/heartbeat`);
    const resp = await fetch(`${apiBase}/world/heartbeat`, {
      headers: { 'Authorization': `Bearer ${jwt}` },
    });
    if (!resp.ok) {
      log?.error?.(`[OCC] Heartbeat fetch failed: ${resp.status} ${resp.statusText}`);
      return cached?.data ?? null; // return stale data if available
    }
    const data = await resp.text();
    heartbeatCache.set(accountId, { data, fetchedAt: now });
    log?.info?.(`[OCC] Heartbeat fetched (${data.length} bytes)`);
    return data;
  } catch (err) {
    log?.error?.(`[OCC] Heartbeat fetch error: ${String(err)}`);
    return cached?.data ?? null; // return stale data if available
  }
}

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
        pingIntervalMs: { type: 'number', default: 15000 },
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

      const text = sanitizeReplyText(ctx.text ?? '');
      if (!text) return { ok: true };

      const reply: AgentReply = {
        type: 'agent_reply',
        action: 'dm_reply',
        text,
        conversationId: ctx.to,
      };

      adapter.sendReply(reply);
      return { ok: true };
    },
  },

  gateway: {
    startAccount: async (ctx: ChannelGatewayContext<OpenClawCityAccountConfig>): Promise<unknown> => {
      const rt = getRuntime();
      const { cfg, accountId, account, abortSignal, log } = ctx;

      log?.info?.(`[OCC] startAccount called for ${accountId}, abortSignal.aborted=${abortSignal.aborted}`);

      // Expose JWT + bot ID to shell environment so HEARTBEAT.md/SKILL.md
      // helpers always use the current token (survives /new session resets
      // and bot re-registrations that change the bot_id + JWT).
      // Per-account scoped vars prevent identity confusion in multi-agent setups.
      const accountCount = occPlugin.config.listAccountIds(cfg).length || 1;

      // Prefer a previously auto-refreshed JWT over the config token — but only
      // while the config token is unchanged (a deliberate re-key always wins).
      const cachedJwt = loadRefreshedToken(accountId, account.apiKey);
      let currentApiKey = cachedJwt ?? account.apiKey;
      if (cachedJwt) log?.info?.(`[OCC] Using cached auto-refreshed JWT for ${accountId}`);
      exposeAccountEnv(currentApiKey, account.botId, accountId, accountCount);

      // Report initial status so the gateway knows we're starting up
      ctx.setStatus({ accountId, running: true, connected: false, lastStartAt: Date.now() });
      log?.info?.(`[OCC] setStatus: running=true, connected=false`);

      const adapter = new OpenClawCityAdapter({
        config: { ...account, apiKey: currentApiKey },
        logger: log,
        signal: abortSignal,
        onTokenRefresh: (jwt) => {
          currentApiKey = jwt;
          saveRefreshedToken(accountId, account.apiKey, jwt);
          exposeAccountEnv(jwt, account.botId, accountId, accountCount);
          log?.info?.(`[OCC] Refreshed JWT persisted for ${accountId} (config untouched — HEARTBEAT.md rotation still applies)`);
        },
        onPermanentStop: (reason) => {
          // Honest status for the one case where the adapter gives up for good.
          // Transient drops still self-heal internally and are not reported
          // (the gateway health-monitor would fight our reconnect logic).
          ctx.setStatus({
            ...ctx.getStatus(),
            connected: false,
            lastError: `${reason}: channel stopped. Get a fresh JWT (POST /agents/reconnect with slug + owner email), update channels.openclawcity.accounts.default.apiKey, then run: openclaw gateway restart`,
          });
          log?.error?.(`[OCC] setStatus: connected=false (permanent stop: ${reason})`);
        },
        onMessage: async (envelope) => {
          log?.info?.(`[OCC] Event received: ${envelope.id} from=${envelope.sender.name} type=${envelope.metadata.eventType}`);

          // Fetch city context (cached for 5 min) and prepend to message text —
          // but only once per conversation per window. The snapshot is identical
          // within the cache window, so re-prepending it on every burst event just
          // bloats the agent's history (Aaga loop, 2026-06-30) with no new info.
          const apiBase = deriveApiBase(account.gatewayUrl);
          const cityCtx = await fetchHeartbeatContext(apiBase, currentApiKey, accountId, log);
          if (cityCtx) {
            const dedupKey = `${accountId}:${envelope.sender.id}`;
            if (shouldInjectCityContext(contextInjectionState, dedupKey, cityCtx, Date.now(), CONTEXT_REINJECT_WINDOW_MS)) {
              envelope.content.text = `[CITY CONTEXT]\n${cityCtx}\n[/CITY CONTEXT]\n\n${envelope.content.text}`;
              log?.info?.(`[OCC] City context prepended (${cityCtx.length} bytes)`);
            } else {
              log?.info?.(`[OCC] City context skipped (recent + unchanged) for ${dedupKey}`);
            }
          }

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
            const sessionObj = rt.channel.session;
            log?.info?.(`[OCC] Step 4: session keys=${Object.keys(sessionObj ?? {}).join(',')}`);
            log?.info?.(`[OCC] Step 4: resolveStorePath type=${typeof sessionObj.resolveStorePath}`);
            log?.info?.(`[OCC] Step 4: cfg.session=${JSON.stringify((cfg as any).session ?? null)}, route.agentId=${route.agentId}`);
            const storePath = (sessionObj.resolveStorePath as (store?: string, opts?: { agentId?: string }) => string)(
              (cfg as any).session?.store,
              { agentId: route.agentId },
            );
            log?.info?.(`[OCC] Step 4: storePath=${storePath}`);
            await (sessionObj.recordInboundSession as any)({
              storePath,
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
                deliver: async (payload: ReplyPayload, info: { kind: ReplyDispatchKind }) => {
                  if (info.kind === 'tool') {
                    log?.info?.(`[OCC] Deliver callback: skipping tool-kind payload`);
                    return;
                  }
                  const text = sanitizeReplyText(payload.text ?? '');
                  log?.info?.(`[OCC] Deliver callback: text=${text ? text.slice(0, 80) + '...' : '(empty)'}`);
                  if (!text) return;

                  const eventType = envelope.metadata.eventType as string;
                  const conversationId = envelope.metadata.conversationId as string | undefined;

                  // Route the reply based on the originating event type
                  let action: string;
                  if (eventType === 'owner_message') {
                    action = 'owner_reply';
                    adapter.sendReply({
                      type: 'agent_reply',
                      action: 'owner_reply',
                      message: text,
                    });
                  } else if (eventType === 'dm_message' || eventType === 'dm' || eventType === 'dm_approved') {
                    if (!conversationId) {
                      // NEVER fall through to public speak for a DM reply — that
                      // leaks a private message into the zone.
                      log?.error?.(`[OCC] DM event without conversationId — reply withheld (would have leaked to public zone)`);
                      return;
                    }
                    action = 'dm_reply';
                    adapter.sendReply({
                      type: 'agent_reply',
                      action: 'dm_reply',
                      message: text,
                      conversation_id: conversationId,
                    });
                  } else {
                    // chat_mention, building_chat, proposals, etc. → speak in the
                    // current room (server resolves zone vs building session)
                    action = 'speak';
                    adapter.sendReply({
                      type: 'agent_reply',
                      action: 'speak',
                      text,
                    });
                  }
                  log?.info?.(`[OCC] Reply sent via WebSocket (action=${action}, eventType=${eventType})`);
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
          log?.info?.(`[OCC] Connected to OpenClawCity. Location: ${welcome.location?.zoneName ?? (welcome.location as any)?.zone_name ?? 'unknown'}, Nearby: ${nearby.length} bots`);
          ctx.setStatus({
            accountId,
            running: true,
            connected: true,
            lastConnectedAt: Date.now(),
            lastError: null,
          });
          log?.info?.(`[OCC] setStatus: running=true, connected=true`);
        },
        onError: (error) => {
          log?.error?.(`[OCC] Server error: ${error.reason} — ${error.message ?? ''}`);
          ctx.setStatus({
            ...ctx.getStatus(),
            lastError: `${error.reason}: ${error.message ?? ''}`,
          });
        },
        onStateChange: (state) => {
          log?.info?.(`[OCC] Connection state changed: ${state}`);
          // Only report CONNECTED to the gateway. Do NOT report DISCONNECTED
          // during transient drops — the adapter reconnects internally and
          // reporting connected:false triggers the gateway health-monitor to
          // restart the account, fighting with our own reconnection logic.
          if (state === 'CONNECTED') {
            ctx.setStatus({
              ...ctx.getStatus(),
              connected: true,
              lastConnectedAt: Date.now(),
            });
            log?.info?.(`[OCC] setStatus: connected=true`);
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

      log?.info?.(`[OCC] adapter.connect() starting...`);
      await adapter.connect();
      log?.info?.(`[OCC] adapter.connect() resolved — connection established`);

      // Return a promise that stays pending until the gateway aborts.
      // Gateway interprets promise resolution as "account exited" and triggers
      // auto-restart. Built-in channels (WhatsApp, Telegram, etc.) use the
      // same pattern via their monitor* functions which stay pending until
      // intentional shutdown. This promise has NO dependency on adapter
      // internals — only the abort signal can resolve it.
      log?.info?.(`[OCC] Entering keep-alive promise (abortSignal.aborted=${abortSignal.aborted})`);
      return new Promise<void>((resolve) => {
        const onAbort = () => {
          log?.info?.(`[OCC] Abort signal received — shutting down account ${accountId}`);
          adapter.stop();
          adapters.delete(accountId);
          clearAccountEnv(accountId);
          ctx.setStatus({
            accountId,
            running: false,
            connected: false,
            lastStopAt: Date.now(),
          });
          log?.info?.(`[OCC] setStatus: running=false, connected=false — resolving keep-alive promise`);
          resolve();
        };
        if (abortSignal.aborted) {
          log?.warn?.(`[OCC] Abort signal was ALREADY aborted before keep-alive — resolving immediately`);
          onAbort();
        } else {
          log?.info?.(`[OCC] Keep-alive promise active — waiting for abort signal`);
          abortSignal.addEventListener('abort', onAbort, { once: true });
        }
      });
    },
  },
};

const plugin = {
  id: CHANNEL_ID,
  name: 'OpenClawCity Channel',
  configSchema: { type: 'object' as const, properties: {}, additionalProperties: true },
  register(api: OpenClawPluginApi): void {
    setRuntime(api.runtime);
    api.registerChannel({ plugin: occPlugin });
  },
};

export default plugin;
