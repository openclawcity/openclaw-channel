# DingTalk Channel Reference Implementation Analysis

> Source: [soimy/openclaw-channel-dingtalk](https://github.com/soimy/openclaw-channel-dingtalk) (506 stars)
> Version: 2.6.5 | Language: TypeScript | License: MIT

## 1. Repository Structure

```
openclaw-channel-dingtalk/
├── index.ts                    # Entry point - plugin registration
├── package.json                # NPM package with "openclaw" field
├── openclaw.plugin.json        # Plugin manifest (minimal)
├── clawbot.plugin.json         # ClawdBot manifest (identical to above)
├── tsconfig.json
├── src/
│   ├── channel.ts              # Main channel plugin definition (~1800 lines)
│   ├── config-schema.ts        # Zod validation schema
│   ├── connection-manager.ts   # WebSocket reconnection logic (~320 lines)
│   ├── media-utils.ts          # Media upload/detection utilities
│   ├── onboarding.ts           # Interactive setup wizard adapter
│   ├── peer-id-registry.ts     # Case-sensitive ID preservation
│   ├── runtime.ts              # Global runtime singleton (14 lines)
│   ├── types.ts                # All TypeScript interfaces/types (~350 lines)
│   └── utils.ts                # Masking, cleanup, retry utilities
├── docs/
│   ├── NPM_PUBLISH.md
│   └── plans/
└── README.md
```

## 2. Plugin Entry Point (`index.ts`)

The entry point is extremely clean - just a default export of a plugin object:

```typescript
import type { OpenClawPluginApi } from 'openclaw/plugin-sdk';
import { emptyPluginConfigSchema } from 'openclaw/plugin-sdk';
import { dingtalkPlugin } from './src/channel';
import { setDingTalkRuntime } from './src/runtime';

const plugin = {
  id: 'dingtalk',
  name: 'DingTalk Channel',
  description: 'DingTalk (钉钉) messaging channel via Stream mode',
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi): void {
    setDingTalkRuntime(api.runtime);
    api.registerChannel({ plugin: dingtalkPlugin });
  },
};

export default plugin;
```

### Key Pattern: `register()` Function
- Receives `OpenClawPluginApi` which provides `api.runtime` and `api.registerChannel()`
- Stores runtime globally via `setDingTalkRuntime()` for module-wide access
- Calls `api.registerChannel({ plugin: dingtalkPlugin })` with the full channel definition
- Uses `emptyPluginConfigSchema()` at plugin level (config is on the channel definition)

## 3. Runtime Singleton (`runtime.ts`)

Dead simple - 14 lines to store/retrieve the `PluginRuntime` reference:

```typescript
import type { PluginRuntime } from 'openclaw/plugin-sdk';

let runtime: PluginRuntime | null = null;

export function setDingTalkRuntime(next: PluginRuntime): void {
  runtime = next;
}

export function getDingTalkRuntime(): PluginRuntime {
  if (!runtime) throw new Error('DingTalk runtime not initialized');
  return runtime;
}
```

## 4. The `"openclaw"` Field in package.json

This is the critical plugin manifest structure:

```json
{
  "openclaw": {
    "extensions": ["./index.ts"],
    "channels": ["dingtalk"],
    "installDependencies": true,
    "channel": {
      "id": "dingtalk",
      "label": "DingTalk",
      "selectionLabel": "DingTalk (钉钉)",
      "docsPath": "/channels/dingtalk",
      "docsLabel": "dingtalk",
      "blurb": "钉钉企业内部机器人，使用 Stream 模式，无需公网 IP。",
      "order": 70,
      "aliases": ["dd", "ding"]
    },
    "install": {
      "npmSpec": "@soimy/dingtalk",
      "localPath": ".",
      "defaultChoice": "npm"
    }
  }
}
```

### Key Fields:
- **`extensions`**: Array of entry point files (TypeScript, not compiled JS)
- **`channels`**: Array of channel IDs this plugin provides
- **`installDependencies`**: Whether to auto-install npm deps
- **`channel`**: Metadata for the UI/CLI (label, blurb, aliases, display order)
- **`install`**: How to install - npm package name, local path, default method
- **`peerDependencies`**: `"openclaw": ">=2026.2.13"` - the host framework

### `openclaw.plugin.json` (Minimal Manifest):
```json
{
  "id": "dingtalk",
  "channels": ["dingtalk"],
  "configSchema": {
    "type": "object",
    "additionalProperties": true,
    "properties": {}
  }
}
```

## 5. Channel Plugin Definition (the `dingtalkPlugin` object)

The main export from `channel.ts` is a `DingTalkChannelPlugin` object with these sections:

```typescript
export const dingtalkPlugin: DingTalkChannelPlugin = {
  id: 'dingtalk',
  meta: { id, label, selectionLabel, docsPath, blurb, aliases },
  configSchema: buildChannelConfigSchema(DingTalkConfigSchema),  // Zod schema
  onboarding: dingtalkOnboardingAdapter,                         // Setup wizard
  capabilities: {
    chatTypes: ['direct', 'group'],
    reactions: false,
    threads: false,
    media: true,
    nativeCommands: false,
    blockStreaming: false,
  },
  reload: { configPrefixes: ['channels.dingtalk'] },
  config: { listAccountIds, resolveAccount, defaultAccountId, isConfigured, describeAccount },
  security: { resolveDmPolicy },
  groups: { resolveRequireMention, resolveGroupIntroHint },
  messaging: { normalizeTarget, targetResolver },
  outbound: { deliveryMode, resolveTarget, sendText, sendMedia },
  gateway: { startAccount },
  status: { defaultRuntime, collectStatusIssues, buildChannelSummary, probeAccount, buildAccountSnapshot },
};
```

### Section Breakdown:

#### `config` - Account Management
- `listAccountIds(cfg)`: Returns account IDs from config (supports multi-account)
- `resolveAccount(cfg, accountId?)`: Resolves full config for an account
- `defaultAccountId()`: Returns `'default'`
- `isConfigured(account)`: Checks `clientId && clientSecret` presence
- `describeAccount(account)`: Returns display metadata

#### `outbound` - Sending Messages
- `deliveryMode: 'direct'` (not 'queued' or 'batch')
- `resolveTarget({ to })`: Validates target, strips prefixes, resolves case-sensitive IDs
- `sendText({ cfg, to, text, accountId, log })`: Sends text/markdown with auto mode selection
- `sendMedia({ cfg, to, mediaPath, ... })`: Uploads and sends media files

#### `gateway` - WebSocket Connection Lifecycle
- `startAccount(ctx)`: The critical startup function (see Section 6 below)
- Returns `{ stop: () => void }` for graceful shutdown

#### `status` - Health Monitoring
- `probeAccount({ account, timeoutMs })`: Tests API connectivity
- `buildAccountSnapshot(...)`: Aggregates runtime state for dashboard
- `collectStatusIssues(accounts)`: Reports config problems

## 6. WebSocket Connection Management

### `gateway.startAccount()` Flow:

1. **Validate config** - Checks `clientId` and `clientSecret`
2. **Cleanup** - `cleanupOrphanedTempFiles()` from crashed processes
3. **Create DWClient** - `dingtalk-stream` library client
4. **Disable built-in auto-reconnect** - `(client as any).config.autoReconnect = false`
5. **Register message callback** - `client.registerCallbackListener(TOPIC_ROBOT, handler)`
6. **Setup abort signal** - Listens for framework shutdown
7. **Create ConnectionManager** - Custom reconnection wrapper
8. **Connect with retry** - `connectionManager.connect()`
9. **Return stop handler** - `{ stop: () => { connectionManager.stop(); } }`

### ConnectionManager Class (`connection-manager.ts`)

Full lifecycle manager with:

```typescript
class ConnectionManager {
  // State tracking
  private state: ConnectionState;  // DISCONNECTED | CONNECTING | CONNECTED | DISCONNECTING | FAILED
  private attemptCount: number;
  private stopped: boolean;

  // Reconnection
  private reconnectTimer?: NodeJS.Timeout;
  private healthCheckInterval?: NodeJS.Timeout;

  // Core methods
  public async connect(): Promise<void>;       // Initial connection with retry loop
  public stop(): void;                         // Graceful shutdown
  public isConnected(): boolean;
  public isStopped(): boolean;
  public getState(): ConnectionState;
}
```

#### Reconnection Logic:

**Exponential Backoff with Jitter:**
```typescript
calculateNextDelay(attempt: number): number {
  const exponentialDelay = initialDelay * Math.pow(2, attempt);  // 1s, 2s, 4s, 8s...
  const cappedDelay = Math.min(exponentialDelay, maxDelay);       // Cap at 60s
  const jitterAmount = cappedDelay * jitter;                      // ±30%
  const randomJitter = (Math.random() * 2 - 1) * jitterAmount;
  return Math.max(100, cappedDelay + randomJitter);               // Min 100ms
}
```

**Default Config:**
- `maxAttempts: 10`
- `initialDelay: 1000ms`
- `maxDelay: 60000ms` (1 minute)
- `jitter: 0.3` (±30%)

**Runtime Reconnection:**
- Health check interval every 5 seconds polls `client.connected`
- WebSocket `close` and `error` events trigger reconnection
- `handleRuntimeDisconnection()` resets attempt counter and schedules reconnect
- If reconnection cycle fails completely, it schedules another cycle (never gives up at runtime)

**Race Condition Handling:**
- `stopped` flag checked after async `connect()` completes
- If stopped during connection, disconnects the just-connected client
- Sleep can be cancelled via `cancelSleep()` for immediate shutdown
- Cleanup of event listeners from previous socket instances via `monitoredSocket` tracking

## 7. Message Normalization Pattern

### Inbound Flow:

```
DingTalk Stream → registerCallbackListener → handleDingTalkMessage() → rt.channel.reply.dispatchReplyWithBufferedBlockDispatcher()
```

1. **Acknowledge immediately**: `client.socketCallBackResponse(messageId, { success: true })`
2. **Parse**: `JSON.parse(res.data) as DingTalkInboundMessage`
3. **Deduplicate**: Bot-scoped key `${robotKey}:${msgId}`, 60s TTL, max 1000 entries
4. **Extract content**: `extractMessageContent(data)` normalizes text/richText/picture/audio/video/file
5. **Authorization**: Check `dmPolicy` / `groupPolicy` + `allowFrom` lists
6. **Route**: `rt.channel.routing.resolveAgentRoute(...)` determines which agent handles
7. **Download media**: If media present, download to agent workspace
8. **Format envelope**: `rt.channel.reply.formatInboundEnvelope(...)` creates standardized body
9. **Build context**: `rt.channel.reply.finalizeInboundContext(...)` with all metadata fields
10. **Record session**: `rt.channel.session.recordInboundSession(...)`
11. **Dispatch**: `rt.channel.reply.dispatchReplyWithBufferedBlockDispatcher(...)` sends to AI

### Outbound Flow:

- **Text**: Auto-detect markdown, send via session webhook or proactive API
- **Media**: Upload to DingTalk media server first, then send with `media_id`
- **AI Cards**: Create card instance, stream updates, finalize on completion

### Inbound Context Fields (the normalized message object):
```typescript
{
  Body, RawBody, CommandBody, From, To, SessionKey,
  AccountId, ChatType, ConversationLabel, GroupSubject,
  SenderName, SenderId, Provider: 'dingtalk', Surface: 'dingtalk',
  MessageSid, Timestamp, MediaPath, MediaType, MediaUrl,
  GroupMembers, GroupSystemPrompt, GroupChannel,
  CommandAuthorized, OriginatingChannel, OriginatingTo,
}
```

## 8. TypeScript Types Used

### From `openclaw/plugin-sdk` (the framework):
```typescript
import type {
  OpenClawConfig,
  OpenClawPluginApi,
  PluginRuntime,
  ChannelLogSink as SDKChannelLogSink,
  ChannelAccountSnapshot as SDKChannelAccountSnapshot,
  ChannelGatewayContext as SDKChannelGatewayContext,
  ChannelPlugin as SDKChannelPlugin,
  ChannelOnboardingAdapter,
  WizardPrompter,
} from 'openclaw/plugin-sdk';

import { emptyPluginConfigSchema, buildChannelConfigSchema } from 'openclaw/plugin-sdk';
```

### Key SDK type aliases used:
```typescript
type Logger = SDKChannelLogSink;                              // { info?, warn?, error?, debug? }
type ChannelAccountSnapshot = SDKChannelAccountSnapshot;
type GatewayStartContext = SDKChannelGatewayContext<ResolvedAccount>;
type DingTalkChannelPlugin = SDKChannelPlugin<ResolvedAccount & { configured: boolean }>;
```

### Plugin-specific types (over 30 interfaces in `types.ts`):
- `DingTalkConfig` - channel configuration (extends OpenClawConfig)
- `DingTalkInboundMessage` - raw incoming message from DingTalk stream
- `MessageContent` - normalized { text, mediaPath?, mediaType?, messageType }
- `SendMessageOptions` - outbound message options
- `HandleDingTalkMessageParams` - handler function params
- `ProactiveMessagePayload` - DingTalk proactive API format
- `ResolvedAccount` - { accountId, config, enabled }
- `GatewayStopResult` - { stop: () => void }
- `ConnectionManagerConfig` - { maxAttempts, initialDelay, maxDelay, jitter, onStateChange? }
- `ConnectionState` enum - DISCONNECTED | CONNECTING | CONNECTED | DISCONNECTING | FAILED
- `AICardInstance` - streaming card state tracking
- `AICardStreamingRequest` - card streaming API payload

## 9. Config Schema (`config-schema.ts`)

Uses **Zod v4** for validation:

```typescript
import { z } from 'zod';

export const DingTalkConfigSchema: z.ZodTypeAny = z.object({
  name: z.string().optional(),
  enabled: z.boolean().optional().default(true),
  clientId: z.string().optional(),
  clientSecret: z.string().optional(),
  robotCode: z.string().optional(),
  // ... more fields
  dmPolicy: z.enum(['open', 'pairing', 'allowlist']).optional().default('open'),
  groupPolicy: z.enum(['open', 'allowlist']).optional().default('open'),
  allowFrom: z.array(z.string()).optional(),
  accounts: z.record(z.string(), z.lazy(() => DingTalkConfigSchema)).optional(),  // Multi-account!
  maxConnectionAttempts: z.number().int().min(1).optional().default(10),
  initialReconnectDelay: z.number().int().min(100).optional().default(1000),
  maxReconnectDelay: z.number().int().min(1000).optional().default(60000),
  reconnectJitter: z.number().min(0).max(1).optional().default(0.3),
});
```

Key: Schema is passed to `buildChannelConfigSchema()` from the SDK.

## 10. Patterns Worth Adopting

### Architecture Patterns:
1. **Module singleton for runtime**: Simple get/set pattern avoids prop-drilling
2. **Separate ConnectionManager class**: Clean separation of connection lifecycle from business logic
3. **Plugin object (not class)**: The channel definition is a plain object literal, not a class
4. **Config at channel level, not plugin level**: Plugin uses `emptyPluginConfigSchema()`, real config is on channel
5. **Multi-account support**: All functions accept `accountId` parameter, config resolves per-account

### Robustness Patterns:
1. **Message deduplication**: In-memory Map with TTL, hard cap at 1000, lazy cleanup every 10 messages
2. **Peer ID registry**: Preserves case-sensitive DingTalk conversationIds that framework may lowercase
3. **Token caching**: Access tokens cached by clientId with 60s buffer before expiry
4. **Retry with backoff**: Generic `retryWithBackoff<T>()` utility for API calls
5. **Abort signal integration**: Framework can signal shutdown, connection manager responds immediately
6. **Race condition guards**: `stopped` flag checked after async operations complete

### Code Organization:
1. **Types in separate file**: All interfaces/types in `types.ts`
2. **Utilities in separate file**: Generic helpers in `utils.ts`
3. **Media handling separate**: `media-utils.ts` for upload/detection
4. **Config schema separate**: `config-schema.ts` with Zod
5. **Onboarding separate**: `onboarding.ts` for setup wizard

### Dependencies:
- `dingtalk-stream` - DingTalk's official WebSocket SDK
- `axios` - HTTP client for API calls
- `form-data` - Multipart form uploads
- `zod` (v4) - Config schema validation
- Peer dep: `openclaw >= 2026.2.13`

## 11. Key Differences from Our Implementation

For our channel plugin, we should note:
- **TypeScript is used directly** (no build step mentioned, `"main": "index.ts"`)
- **Default export** pattern for the plugin object
- **`api.registerChannel({ plugin })` is the core registration call**
- **Framework provides most infrastructure**: routing, sessions, reply dispatching, envelope formatting
- **Channel plugins focus on**: connection management, message normalization, send/receive, and config

## 12. File Size Reference

| File | Lines | Purpose |
|------|-------|---------|
| `channel.ts` | ~1800 | Main channel definition + all handlers |
| `types.ts` | ~350 | All TypeScript interfaces |
| `connection-manager.ts` | ~320 | WebSocket reconnection |
| `config-schema.ts` | ~85 | Zod validation schema |
| `media-utils.ts` | ~130 | Media upload/detection |
| `utils.ts` | ~110 | Masking, cleanup, retry |
| `onboarding.ts` | ~200+ | Setup wizard adapter |
| `peer-id-registry.ts` | ~30 | Case-sensitive ID map |
| `runtime.ts` | ~14 | Runtime singleton |
| `index.ts` | ~16 | Entry point |
