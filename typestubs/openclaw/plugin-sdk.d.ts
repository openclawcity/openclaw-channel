// Type stubs for openclaw/plugin-sdk
// These are replaced by the real SDK at runtime (resolved via jiti aliasing)

export interface OpenClawConfig {
  channels?: Record<string, unknown>;
  plugins?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface RuntimeEnv {
  [key: string]: unknown;
}

export type ReplyDispatchKind = 'tool' | 'block' | 'final';

export interface ReplyPayload {
  text?: string;
  mediaUrls?: string[];
  mediaUrl?: string;
  replyToId?: string;
  [key: string]: unknown;
}

export interface ReplyDispatcherWithTypingOptions {
  deliver: (payload: ReplyPayload, info: { kind: ReplyDispatchKind }) => Promise<void>;
  onError?: (err: unknown, info: { kind: ReplyDispatchKind }) => void;
  onReplyStart?: () => Promise<void> | void;
  onIdle?: () => void;
  onCleanup?: () => void;
  responsePrefix?: string;
  [key: string]: unknown;
}

export interface DispatchInboundResult {
  [key: string]: unknown;
}

export interface MsgContext {
  Body?: string;
  BodyForAgent?: string;
  RawBody?: string;
  CommandBody?: string;
  BodyForCommands?: string;
  From?: string;
  To?: string;
  SessionKey?: string;
  AccountId?: string;
  MessageSid?: string;
  ChatType?: string;
  ConversationLabel?: string;
  SenderName?: string;
  SenderId?: string;
  Timestamp?: number;
  Provider?: string;
  Surface?: string;
  WasMentioned?: boolean;
  CommandAuthorized?: boolean;
  OriginatingChannel?: string;
  OriginatingTo?: string;
  [key: string]: unknown;
}

export interface PluginRuntime {
  version: string;
  config: {
    loadConfig: (...args: unknown[]) => unknown;
    writeConfigFile: (...args: unknown[]) => unknown;
  };
  channel: {
    reply: {
      dispatchReplyWithBufferedBlockDispatcher: (params: {
        ctx: MsgContext;
        cfg: OpenClawConfig;
        dispatcherOptions: ReplyDispatcherWithTypingOptions;
        replyOptions?: Record<string, unknown>;
      }) => Promise<DispatchInboundResult>;
      finalizeInboundContext: (...args: unknown[]) => unknown;
      formatInboundEnvelope: (...args: unknown[]) => unknown;
      resolveEnvelopeFormatOptions: (...args: unknown[]) => unknown;
    };
    routing: {
      resolveAgentRoute: (...args: unknown[]) => unknown;
    };
    session: {
      recordInboundSession: (...args: unknown[]) => unknown;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface OpenClawPluginApi {
  runtime: PluginRuntime;
  logger: {
    info?: (...args: unknown[]) => void;
    warn?: (...args: unknown[]) => void;
    error?: (...args: unknown[]) => void;
    debug?: (...args: unknown[]) => void;
  };
  registerChannel: (opts: { plugin: unknown }) => void;
  registerGatewayMethod?: (method: string, handler: unknown) => void;
  registerCli?: (handler: unknown, opts?: unknown) => void;
  registerService?: (service: unknown) => void;
}

export type ChannelPlugin<T = unknown> = Record<string, unknown>;

export type ChannelLogSink = {
  info?: (...args: unknown[]) => void;
  warn?: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
  debug?: (...args: unknown[]) => void;
};

export type ChannelAccountSnapshot = Record<string, unknown>;

export type ChannelGatewayContext<T = unknown> = {
  cfg: OpenClawConfig;
  accountId: string;
  account: T;
  runtime: RuntimeEnv;
  abortSignal: AbortSignal;
  log?: ChannelLogSink;
  getStatus: () => ChannelAccountSnapshot;
  setStatus: (next: ChannelAccountSnapshot) => void;
};

export type ChannelOutboundContext = {
  cfg: OpenClawConfig;
  to: string;
  text: string;
  mediaUrl?: string;
  replyToId?: string | null;
  threadId?: string | number | null;
  accountId?: string | null;
  silent?: boolean;
  [key: string]: unknown;
};

export type ChannelOnboardingAdapter = unknown;
export type WizardPrompter = unknown;

export function emptyPluginConfigSchema(): Record<string, unknown>;
export function buildChannelConfigSchema(schema: import('zod').ZodTypeAny): unknown;
