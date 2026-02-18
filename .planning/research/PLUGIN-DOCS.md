# OpenClaw Plugin System - Complete Research

> Source: https://docs.openclaw.ai/tools/plugin (and related docs pages)

---

## Table of Contents

1. [Plugin System Overview](#1-plugin-system-overview)
2. [Five-Step Channel Registration Process](#2-five-step-channel-registration-process)
3. [api.registerChannel() Interface](#3-apiregisterchannel-interface)
4. [Channel Plugin Object Structure](#4-channel-plugin-object-structure)
5. [Meta Object](#5-meta-object)
6. [Capabilities Object](#6-capabilities-object)
7. [Config Adapter](#7-config-adapter)
8. [Outbound Adapter](#8-outbound-adapter)
9. [Optional Adapters](#9-optional-adapters)
10. [Package.json "openclaw" Field](#10-packagejson-openclaw-field)
11. [Plugin Manifest File](#11-plugin-manifest-file)
12. [Plugin Configuration](#12-plugin-configuration)
13. [Inbound Message Flow](#13-inbound-message-flow)
14. [Outbound Reply Flow](#14-outbound-reply-flow)
15. [Session Key Mapping](#15-session-key-mapping)
16. [Streaming & Chunking](#16-streaming--chunking)
17. [Gateway Architecture](#17-gateway-architecture)
18. [Agent Loop & Message Processing](#18-agent-loop--message-processing)
19. [Plugin Hooks](#19-plugin-hooks)
20. [Additional Plugin Registration APIs](#20-additional-plugin-registration-apis)
21. [CLI Commands](#21-cli-commands)
22. [Channel Configuration Reference](#22-channel-configuration-reference)

---

## 1. Plugin System Overview

Plugins are "small code modules that extend OpenClaw with extra features." They operate **in-process** with the Gateway and are loaded at runtime via `jiti` (TypeScript runtime compilation).

### Plugin Discovery Order
1. Config paths (user-specified)
2. Workspace extensions
3. Global extensions
4. Bundled extensions

### Plugin Capabilities
Plugins can register:
- Messaging channels
- Gateway RPC methods
- HTTP handlers
- Agent tools
- CLI commands
- Background services
- Skills
- Auto-reply commands (slash commands without AI invocation)
- Model provider authentication flows

### Safety Note
> "Plugins run in-process with the Gateway, so treat them as trusted code."

Installation uses `npm install --ignore-scripts` to avoid lifecycle script execution risks.

### Plugin Slots
Exclusive plugin slots where only one plugin of a kind (e.g., memory) can be active simultaneously.

---

## 2. Five-Step Channel Registration Process

As documented:

> 1. **Pick an id + config shape** - Choose a unique channel identifier and design the config structure
> 2. **Define the channel metadata** - Set up the `meta` object with label, docs path, blurb, etc.
> 3. **Implement the required adapters** - `config` and `outbound` adapters are mandatory
> 4. **Add optional adapters as needed** - setup, security, status, gateway, mentions, threading, streaming, actions, commands
> 5. **Register the channel** - Call `api.registerChannel({ plugin: myChannel })`

---

## 3. api.registerChannel() Interface

### Method Signature

```ts
export default function (api) {
  api.registerChannel({ plugin: myChannel });
}
```

The `api` object is injected by the plugin loader. The `registerChannel` method accepts an object with a `plugin` property containing the full channel implementation.

### Two Export Patterns

**Function export (preferred for channels):**
```ts
export default function (api) {
  api.registerChannel({ plugin: myChannel });
}
```

**Object export:**
```ts
export default {
  id: "my-plugin",
  name: "My Plugin",
  configSchema: { ... },
  register(api) {
    api.registerChannel({ plugin: myChannel });
  }
}
```

---

## 4. Channel Plugin Object Structure

The complete minimal channel plugin object:

```ts
const myChannel = {
  // Required: unique channel identifier
  id: "acmechat",

  // Required: channel metadata
  meta: {
    id: "acmechat",
    label: "AcmeChat",
    selectionLabel: "AcmeChat (API)",
    docsPath: "/channels/acmechat",
    blurb: "demo channel plugin.",
    aliases: ["acme"],
  },

  // Required: channel capabilities
  capabilities: { chatTypes: ["direct"] },

  // Required: config resolution
  config: {
    listAccountIds: (cfg) => Object.keys(cfg.channels?.acmechat?.accounts ?? {}),
    resolveAccount: (cfg, accountId) =>
      cfg.channels?.acmechat?.accounts?.[accountId ?? "default"] ?? {
        accountId,
      },
  },

  // Required: outbound delivery
  outbound: {
    deliveryMode: "direct",
    sendText: async () => ({ ok: true }),
  },

  // Optional adapters
  // setup: { ... },
  // security: { ... },
  // status: { ... },
  // gateway: { ... },
  // mentions: { ... },
  // threading: { ... },
  // streaming: { ... },
  // actions: { ... },
  // commands: { ... },
};
```

---

## 5. Meta Object

```ts
meta: {
  id: string;              // Must match the top-level `id`
  label: string;           // Display name shown in UI (e.g., "AcmeChat")
  selectionLabel: string;  // Longer label for channel selection (e.g., "AcmeChat (API)")
  docsPath: string;        // Path to channel documentation (e.g., "/channels/acmechat")
  blurb: string;           // Short description of the channel
  aliases: string[];       // Alternative names for CLI matching (e.g., ["acme"])
}
```

---

## 6. Capabilities Object

```ts
capabilities: {
  chatTypes: ("direct" | "group")[];  // Supported chat types
}
```

Known `chatTypes` values:
- `"direct"` - Direct messages / DMs
- `"group"` - Group chats

Additional capability flags observed in existing channels:
```ts
capabilities: {
  chatTypes: ["direct", "group"],
  // Channel-specific capability flags (e.g., for Discord):
  inlineButtons: "off" | "dm" | "group" | "all" | "allowlist",
}
```

---

## 7. Config Adapter

The config adapter maps OpenClaw's configuration file to the channel's account structure:

```ts
config: {
  // Returns an array of account IDs from the config
  listAccountIds: (cfg: OpenClawConfig) => string[];

  // Resolves a specific account's configuration
  resolveAccount: (cfg: OpenClawConfig, accountId: string) => AccountConfig;
}
```

### Config Location

Channel config lives under `channels.<id>`:

```json5
{
  channels: {
    acmechat: {
      enabled: true,
      accounts: {
        default: {
          token: "TOKEN",
          enabled: true
        }
      }
    }
  }
}
```

Plugin entries use: `plugins.entries.<id>.config` for plugin-specific configuration.

### Standard Config Fields (cross-channel patterns)

All channels support these common configuration fields:
- `enabled: boolean` - Activate/deactivate the channel
- `dmPolicy: "pairing" | "allowlist" | "open" | "disabled"` - DM access control
- `allowFrom: string[]` - Allowlist of sender IDs
- `groupPolicy: "allowlist" | "open" | "disabled"` - Group access control
- `groups: Record<string, GroupConfig>` - Per-group configuration
- `historyLimit: number` - Message history context window
- `textChunkLimit: number` - Message length threshold (default varies by channel)
- `chunkMode: "length" | "newline"` - Text splitting approach
- `mediaMaxMb: number` - Attachment size limit
- `replyToMode: "off" | "first" | "all"` - Reply threading behavior

---

## 8. Outbound Adapter

### Required Properties

```ts
outbound: {
  // Delivery mode - how messages are routed back
  deliveryMode: "direct";  // or other modes

  // Send a text message - REQUIRED
  sendText: async (payload: SendTextPayload) => Promise<{ ok: boolean }>;
}
```

### sendText Payload

```ts
sendText: async ({ text, ...context }) => {
  // deliver `text` to your channel
  return { ok: true };
}
```

### Additional Outbound Methods (observed in existing channels)

Based on Telegram, Discord, Slack implementations, these additional methods exist:
- `sendImage` - Send image media
- `sendAudio` - Send audio/voice
- `sendVideo` - Send video
- `sendDocument` / `sendFile` - Send file attachments
- `sendSticker` - Send stickers (Telegram, Discord)
- `editMessage` - Edit a previously sent message
- `deleteMessage` - Delete a message
- `sendReaction` - React to a message with an emoji

### Outbound Response Format

All outbound methods return: `{ ok: true }` on success.

---

## 9. Optional Adapters

The following optional adapters can be added to the channel plugin object:

| Adapter | Purpose |
|---------|---------|
| `setup` | Channel initialization, connection setup, polling/webhook startup |
| `security` | DM/group access control, pairing, allowlist enforcement |
| `status` | Health/connection status reporting |
| `gateway` | Gateway RPC method registration for the channel |
| `mentions` | @-mention detection and handling in group chats |
| `threading` | Thread/topic isolation and reply threading |
| `streaming` | Live response streaming (e.g., Telegram's partial mode) |
| `actions` | Channel-specific actions (reactions, stickers, message editing) |
| `commands` | Native slash command registration with the platform |

### Setup Adapter (key for channel initialization)

The `setup` adapter is critical - it handles:
- Establishing connection to the external platform (bot token auth, websocket, polling)
- Starting message listeners / webhooks
- Calling back into OpenClaw when messages arrive

### Gateway Adapter

Registers RPC methods accessible via the Gateway protocol:
```ts
gateway: {
  methods: {
    "channel.action": async ({ params, respond }) => {
      // handle RPC call
      respond(true, { result: "ok" });
    }
  }
}
```

---

## 10. Package.json "openclaw" Field

### For Channel Plugins

```json
{
  "name": "@openclaw/nextcloud-talk",
  "openclaw": {
    "extensions": ["./index.ts"],
    "channel": {
      "id": "nextcloud-talk",
      "label": "Nextcloud Talk",
      "selectionLabel": "Nextcloud Talk (self-hosted)",
      "docsPath": "/channels/nextcloud-talk",
      "docsLabel": "nextcloud-talk",
      "blurb": "Self-hosted chat via Nextcloud Talk webhook bots.",
      "order": 65,
      "aliases": ["nc-talk", "nc"]
    },
    "install": {
      "npmSpec": "@openclaw/nextcloud-talk",
      "localPath": "extensions/nextcloud-talk",
      "defaultChoice": "npm"
    }
  }
}
```

### Fields

- `extensions: string[]` - Entry point files (TypeScript). Multiple extensions create plugin IDs as `name/<fileBase>`
- `channel.id: string` - Unique channel identifier
- `channel.label: string` - Display name
- `channel.selectionLabel: string` - Extended label for selection UI
- `channel.docsPath: string` - Documentation URL path
- `channel.docsLabel: string` - Documentation link text
- `channel.blurb: string` - Short description
- `channel.order: number` - Sort order in channel list
- `channel.aliases: string[]` - Alternative CLI names
- `install.npmSpec: string` - npm package specifier for installation
- `install.localPath: string` - Local development path
- `install.defaultChoice: "npm" | "local"` - Default installation method

### For Multi-Extension Packages

```json
{
  "name": "my-pack",
  "openclaw": {
    "extensions": ["./src/safety.ts", "./src/tools.ts"]
  }
}
```

---

## 11. Plugin Manifest File

File: `openclaw.plugin.json` (must be present in plugin package)

```json
{
  "id": "my-plugin",
  "configSchema": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "apiKey": { "type": "string" },
      "region": { "type": "string" }
    }
  },
  "uiHints": {
    "apiKey": { "label": "API Key", "sensitive": true },
    "region": { "label": "Region", "placeholder": "us-east-1" }
  }
}
```

### Fields

- `id: string` - Plugin identifier
- `configSchema: JSONSchema` - JSON Schema for validating plugin config
- `uiHints: Record<string, UIHint>` - UI rendering hints for config fields
  - `label: string` - Display label
  - `sensitive: boolean` - Mark as secret/password field
  - `placeholder: string` - Input placeholder text

---

## 12. Plugin Configuration

### Master Configuration

```json5
{
  plugins: {
    enabled: true,                              // Master toggle
    allow: ["voice-call"],                      // Allowlist
    deny: ["untrusted-plugin"],                 // Denylist
    load: { paths: ["~/Projects/oss/ext"] },    // Additional load paths
    entries: {
      "voice-call": {
        enabled: true,
        config: { provider: "twilio" }          // Per-plugin config
      }
    },
    slots: {
      memory: "memory-core"                     // Exclusive slot assignments
    }
  }
}
```

### Environment Variables

- `OPENCLAW_PLUGIN_CATALOG_PATHS` - Additional catalog search paths
- `OPENCLAW_MPM_CATALOG_PATHS` - MPM catalog paths

### Validation Rules

- Unknown plugin IDs in `entries`, `allow`, `deny` are **errors**
- Config validation uses JSON Schema from plugin manifest
- Plugin code execution doesn't occur during validation
- Duplicate command registration produces diagnostic errors

---

## 13. Inbound Message Flow

### High-Level Pipeline

```
Inbound message (platform webhook/poll)
  → Channel setup adapter receives message
  → Message normalized into shared channel envelope
  → Session key resolved (channel:account:chatType:chatId)
  → Queue mode check (collect/steer/followup)
  → Agent run triggered
  → Model inference (streaming + tools)
  → Reply assembly
  → Outbound delivery via channel's sendText/sendImage etc.
```

### Message Normalization

Inbound messages normalize into a shared channel envelope with:
- Reply metadata
- Media placeholders (e.g., `<media:sticker>`, `[[audio_as_voice]]`)
- Sender info (from.id, from.name)
- Chat info (chat.id, chat.type)
- Thread/topic metadata

### Session Key Resolution

Session keys follow patterns:
- **DM**: `"agent:<agentId>:<channel>:dm:<senderId>"` (with `per-channel-peer` scope)
- **Group**: `"agent:<agentId>:<channel>:group:<groupId>"`
- **Channel/Room**: `"agent:<agentId>:<channel>:channel:<channelId>"`
- **Forum Topics**: append `:topic:<threadId>`

### Queue Modes

When an agent run is already active for a session:
1. **Steer mode** - Messages inject immediately after each tool call; remaining tool calls are skipped
2. **Followup/Collect modes** - Messages queue until the current turn completes, then a new agent turn starts

### History Context

When channels supply conversation history, they use:
```
[Chat messages since your last reply - for context]
...previous messages...
[Current message - respond to this]
...current message...
```

For group contexts, sender labels prefix the current message body.

---

## 14. Outbound Reply Flow

### Routing Rule

> "Routing is deterministic: [Channel] inbound replies back to [Channel] (the model does not pick channels)."

The agent's response always routes back through the same channel that received the inbound message.

### Delivery Pipeline

```
Agent response text
  → Block streaming / chunking (if enabled)
  → Text formatting (platform-specific, e.g., HTML for Telegram)
  → Channel's outbound.sendText() called
  → Platform API delivers message
```

### Text Chunking

Large responses are split according to:
- `textChunkLimit` - Maximum characters per message (varies by channel)
- `chunkMode` - `"newline"` prefers paragraph boundaries; `"length"` splits by character count
- Break preference hierarchy: `paragraph` > `newline` > `sentence` > `whitespace` > hard break
- Code fence safety: Never splits inside Markdown code blocks

---

## 15. Session Key Mapping

### DM Scope Options

```
dmScope: "main"                     # All DMs share primary session
dmScope: "per-peer"                 # Isolate by sender ID across channels
dmScope: "per-channel-peer"         # Isolate by channel + sender (recommended)
dmScope: "per-account-channel-peer" # Isolate by account + channel + sender
```

### Session Storage

- Session state: `~/.openclaw/agents/<agentId>/sessions/sessions.json`
- Transcripts: `~/.openclaw/agents/<agentId>/sessions/<SessionId>.jsonl`

### Identity Links

Map the same person across multiple channels:
```json5
{
  identityLinks: [
    { telegram: "123456", discord: "user#1234" }
  ]
}
```

---

## 16. Streaming & Chunking

### Two Streaming Mechanisms

1. **Block streaming (all channels)** - Delivers completed text blocks as they become available
2. **Token-ish streaming (Telegram only)** - Updates a temporary preview message with partial text during generation

> "There is **no true token-delta streaming** to channel messages today."

### Block Streaming Pipeline

```
Model output → text_delta/events → EmbeddedBlockChunker → channel send
```

### Configuration

```json5
{
  agents: {
    defaults: {
      blockStreamingDefault: "on" | "off",
      blockStreamingBreak: "text_end" | "message_end",
      blockStreamingChunk: { minChars: number, maxChars: number, breakPreference?: string },
      blockStreamingCoalesce: { minChars?: number, maxChars?: number, idleMs?: number },
      humanDelay: "off" | "natural" | { minMs, maxMs }
    }
  }
}
```

### Telegram-Specific Streaming

```json5
{
  channels: {
    telegram: {
      streamMode: "partial" | "block" | "off",
      draftChunk: { minChars: 200, maxChars: 800, breakPreference: "paragraph" }
    }
  }
}
```

---

## 17. Gateway Architecture

### Core Architecture

> "A single long-lived Gateway owns all messaging surfaces (WhatsApp via Baileys, Telegram via grammY, Slack, Discord, Signal, iMessage, WebChat)."

### Connection Types

1. **Control-plane clients** (macOS app, CLI, web UI) connect via WebSocket at `127.0.0.1:18789`
2. **Nodes** (iOS/Android/headless devices) use WebSocket with `role: node`
3. **Canvas** served at `/__openclaw__/canvas/`

### Wire Protocol

WebSocket with JSON payloads:
- Request: `{type:"req", id, method, params}`
- Response: `{type:"res", id, ok, payload|error}`
- Event: `{type:"event", event, payload, seq?, stateVersion?}`

### Channel Ownership

Channels are owned by the Gateway process. Message sequencing uses per-chat/per-thread ordering within `agents.defaults.maxConcurrent` concurrency limits.

---

## 18. Agent Loop & Message Processing

### Processing Stages

1. **Entry & Validation** - Message arrives via Gateway RPC, parameter validation, session resolution
2. **Session & Context Prep** - Acquire session write lock, load skills, resolve workspace, inject system prompt
3. **Model Inference** - Resolve model, call `runEmbeddedPiAgent`, manage lifecycle events
4. **Execution & Streaming** - Emit lifecycle events, stream assistant deltas, emit tool events
5. **Reply Assembly** - Combine text, tool summaries, error messages, filter suppressions

### Lifecycle Events

- `start` - Agent run begins
- `end` - Agent run completes
- `error` - Agent run failed

### Interception Hooks

- `before_model_resolve` - Override provider/model
- `before_prompt_build` - Inject context before submission
- `before_tool_call` / `after_tool_call` - Intercept tool parameters and results
- `tool_result_persist` - Transform results before transcript storage

---

## 19. Plugin Hooks

```ts
import { registerPluginHooksFromDir } from "openclaw/plugin-sdk";

export default function register(api) {
  registerPluginHooksFromDir(api, "./hooks");
}
```

Hook directories follow standard structure with `HOOK.md` + `handler.ts`. Plugin-managed hooks appear in `openclaw hooks list` with `plugin:<id>` prefix.

---

## 20. Additional Plugin Registration APIs

### Gateway RPC Method

```ts
api.registerGatewayMethod("myplugin.status", ({ respond }) => {
  respond(true, { ok: true });
});
```

### CLI Command

```ts
api.registerCli(
  ({ program }) => {
    program.command("mycmd").action(() => {
      console.log("Hello");
    });
  },
  { commands: ["mycmd"] }
);
```

### Background Service

```ts
api.registerService({
  id: "my-service",
  start: () => api.logger.info("ready"),
  stop: () => api.logger.info("bye"),
});
```

### Model Provider

```ts
api.registerProvider({
  id: "acme",
  label: "AcmeAI",
  auth: [{
    id: "oauth",
    label: "OAuth",
    kind: "oauth",
    run: async (ctx) => ({
      profiles: [{
        profileId: "acme:default",
        credential: {
          type: "oauth", provider: "acme",
          access: "...", refresh: "...",
          expires: Date.now() + 3600 * 1000,
        },
      }],
      defaultModel: "acme/opus-1",
    }),
  }],
});
```

### Auto-Reply Commands

```ts
api.registerCommand({
  name: "mystatus",
  description: "Show plugin status",
  handler: (ctx) => ({
    text: `Plugin is running! Channel: ${ctx.channel}`,
  }),
});
```

Command context properties: `senderId`, `channel`, `isAuthorizedSender`, `args`, `commandBody`, `config`

### TTS Runtime Helper

```ts
const result = await api.runtime.tts.textToSpeechTelephony({
  text: "Hello from OpenClaw",
  cfg: api.config,
});
```

---

## 21. CLI Commands

```bash
openclaw plugins list           # List loaded plugins
openclaw plugins info <id>      # Plugin details
openclaw plugins install <path> # Install from path
openclaw plugins install -l ./extensions/voice-call  # Install local
openclaw plugins install @openclaw/voice-call        # Install from npm
openclaw plugins update <id>    # Update specific plugin
openclaw plugins update --all   # Update all plugins
openclaw plugins enable <id>    # Enable plugin
openclaw plugins disable <id>   # Disable plugin
openclaw plugins doctor         # Diagnose plugin issues
```

---

## 22. Channel Configuration Reference

### Universal DM Policies

| Policy | Behavior |
|--------|----------|
| `pairing` | Unknown senders receive one-time approval codes (expires 1hr); owner must authorize |
| `allowlist` | Only senders in `allowFrom` or paired store can message |
| `open` | Permit all inbound DMs (requires `allowFrom: ["*"]`) |
| `disabled` | Ignore all inbound DMs |

### Universal Group Policies

| Policy | Behavior |
|--------|----------|
| `allowlist` | Default; only matching configured allowlist |
| `open` | Bypass group filtering (mention-gating still enforces) |
| `disabled` | Block all group/room messages |

### Group Chat Mention Gating

> "Group messages default to **require mention** (metadata mention or regex patterns)."

Mention sources:
- Metadata mentions (native platform @-mentions)
- Text patterns: `agents.list[].groupChat.mentionPatterns` regex
- Enforcement only when detection is possible

### Chat Commands Configuration

```json5
{
  commands: {
    native: "auto" | true | false,  // Register native platform commands
    text: true,                      // Parse /commands in messages
    bash: false,                     // Allow ! shell commands (requires elevated)
    config: false,                   // Enable /config command
    debug: false,                    // Enable /debug command
    restart: false,                  // Allow /restart
    allowFrom: {},                   // Per-provider authorization
    useAccessGroups: true            // Apply access-group policies
  }
}
```

### Channel-Specific Override Fields

All channels support:
- `blockStreaming` - Enable chunked response delivery
- `blockStreamingCoalesce` - Output buffering parameters
- `ackReaction` - Custom acknowledgment emoji
- `responsePrefix` - Message prefix template
- `configWrites` - Gate configuration mutations
- `allowBots` - Include bot messages
- `dmHistoryLimit` / `historyLimit` - Message retention windows
- `mediaMaxMb` - File upload ceiling

### Multi-Account Support

```json5
{
  channels: {
    "<provider>": {
      accounts: {
        default: { /* default account config */ },
        secondary: { /* override settings */ }
      }
    }
  }
}
```

Routing: Use `bindings[].match.accountId` to direct accounts to different agents.

---

## Key Takeaways for Channel Implementation

### Minimum Viable Channel Plugin

A channel plugin needs at minimum:

1. **`id`** - Unique string identifier
2. **`meta`** - Object with `id`, `label`, `selectionLabel`, `docsPath`, `blurb`, `aliases`
3. **`capabilities`** - Object with `chatTypes` array
4. **`config.listAccountIds(cfg)`** - Returns array of account IDs from config
5. **`config.resolveAccount(cfg, accountId)`** - Returns account config object
6. **`outbound.deliveryMode`** - String, typically `"direct"`
7. **`outbound.sendText(payload)`** - Async function returning `{ ok: true }`

### Typical Additional Requirements

For a production channel, you'll also need:
- **`setup` adapter** - To start bot/polling/webhook and handle inbound messages
- **`security` adapter** - For DM pairing and access control
- **`gateway` adapter** - For RPC method registration
- **`actions` adapter** - For reactions, message editing, etc.

### Important Architecture Notes

- Channels run in-process with the Gateway (no separate process)
- Each channel is responsible for its own connection to the external platform
- The Gateway manages session state, agent runs, and message queuing
- Outbound routing is deterministic (same channel as inbound)
- There is no true token-delta streaming to channels (block streaming only)
- Channel config lives under `channels.<id>` in `openclaw.json`
- Channels start automatically when their config section exists (unless `enabled: false`)
