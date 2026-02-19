// Type stubs for openclaw/plugin-sdk
// These are replaced by the real SDK at runtime (resolved via jiti aliasing)

export interface PluginRuntime {
  channel?: {
    reply?: {
      dispatchReplyWithBufferedBlockDispatcher?: (ctx: Record<string, unknown>) => Promise<void>;
      formatInboundEnvelope?: (...args: unknown[]) => unknown;
      finalizeInboundContext?: (...args: unknown[]) => unknown;
    };
    routing?: {
      resolveAgentRoute?: (...args: unknown[]) => unknown;
    };
    session?: {
      recordInboundSession?: (...args: unknown[]) => unknown;
    };
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

export interface OpenClawConfig {
  channels?: Record<string, unknown>;
  plugins?: Record<string, unknown>;
  [key: string]: unknown;
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
  accountId: string;
  config: T;
  signal?: AbortSignal;
  log?: ChannelLogSink;
};
export type ChannelOnboardingAdapter = unknown;
export type WizardPrompter = unknown;

export function emptyPluginConfigSchema(): Record<string, unknown>;
export function buildChannelConfigSchema(schema: import('zod').ZodTypeAny): unknown;
