# Research: OpenClaw Channel Plugin Architecture

## Source: GitHub Discussion #2240

**URL:** https://github.com/openclaw/openclaw/discussions/2240
**Status:** "Unanswered" (despite maintainer response)

### Maintainer Statement (thewilloftheshadow)

> "All channels are implemented as extensions with our plugin SDK."

The maintainer directed users to the official plugin documentation at `https://docs.clawd.bot/plugin` (now `https://docs.openclaw.ai/tools/plugin`).

### Original Question Context

A user asked about integrating REST interfaces and custom C# applications with existing chatbot systems, seeking proof-of-concept viability without building AI backends. The maintainer confirmed the plugin/extension architecture as the path forward.

---

## Channel Plugin Architecture (Comprehensive)

### Two Registration Patterns

Research reveals **two coexisting patterns** for channel plugins:

#### Pattern 1: Legacy `api.registerChannel()` (Register Function)

Used in older plugins and the Wemble guide. The plugin exports a default `register` function:

```typescript
export default function register(api: any) {
  api.logger.info("Plugin loaded!");
  api.registerChannel({ plugin: myChannel });
}
```

Where `myChannel` is an object with:
- `id`: Unique channel identifier
- `meta`: UI/CLI metadata (`label`, `selectionLabel`, `docsPath`, `blurb`, `aliases`, `preferOver`, `systemImage`)
- `capabilities`: Feature declarations (`chatTypes: ["direct"]`, media handling, threading, streaming)
- `config`: Account resolution (`listAccountIds(cfg)`, `resolveAccount(cfg, accountId)`)
- `outbound`: Message delivery (`deliveryMode: "direct"`, `sendText: async ({ text }) => { ... }`)

Optional adapters: `setup`, `security`, `status`, `gateway`, `mentions`, `threading`, `streaming`, `actions`, `commands`.

#### Pattern 2: Modern `PluginDefinition` Export (Recommended)

Used in DeepWiki docs and newer extensions. The plugin exports a `PluginDefinition` object:

```typescript
import type { PluginDefinition } from 'openclaw/plugin-sdk'
import { Type } from '@sinclair/typebox'

const plugin: PluginDefinition = {
  slot: 'channel',
  id: 'my-channel',
  schema: Type.Object({
    token: Type.String(),
    webhookUrl: Type.Optional(Type.String())
  }),
  metadata: {
    name: 'My Channel',
    description: 'Integration with My Messaging Platform'
  },
  init: async (config, deps) => {
    const { logger, configDir } = deps
    return {
      async start() { /* startup */ },
      async stop() { /* cleanup */ },
      async send(message) { /* send message */ }
    }
  }
}
export default plugin
```

### Key Differences Between Patterns

| Aspect | Register Function | PluginDefinition |
|--------|------------------|-----------------|
| Export | `default function register(api)` | `default PluginDefinition object` |
| Registration | `api.registerChannel({ plugin })` | Declarative `slot: 'channel'` |
| Schema | No built-in validation | TypeBox schema required |
| Init | Inline in register call | `init(config, deps)` function |
| Types | `any` or custom | `openclaw/plugin-sdk` types |

**Recommendation:** Use Pattern 2 (`PluginDefinition`) as it's the modern approach with better type safety and validation.

---

## Plugin SDK Details

### Import

```typescript
import type { PluginDefinition } from 'openclaw/plugin-sdk'
```

The SDK is exported at `openclaw/plugin-sdk` and provides TypeScript types, validation utilities, and helper functions. It's located at `dist/plugin-sdk/` in the OpenClaw package.

### PluginDefinition Interface

| Field | Type | Required | Purpose |
|-------|------|----------|---------|
| `slot` | `"channel" \| "tool" \| "provider" \| "memory"` | Yes | Plugin type |
| `id` | `string` | Yes | Unique identifier matching config key |
| `schema` | TypeBox schema | Yes | Configuration validation schema |
| `metadata` | `{ name, description, icon? }` | No | Display metadata |
| `init` | `async (config, deps) => Implementation` | Yes | Returns slot-specific implementation |

### Dependency Injection (deps)

| Property | Type | Purpose |
|----------|------|---------|
| `logger` | Logger (tslog) | Structured logging |
| `configDir` | string | Path to `~/.openclaw/` |
| `workspaceDir` | string | Agent workspace path |
| `rpc` | RPCClient | Gateway RPC client |

---

## Configuration

### File Location
`~/.openclaw/openclaw.json` under `channels.<id>`:

```json
{
  "channels": {
    "my-channel": {
      "token": "your-token",
      "accounts": {
        "default": { "enabled": true }
      }
    }
  }
}
```

### Auto-Enable Behavior
The Gateway **auto-enables** channel plugins when their configuration section exists. No explicit allowlist needed (unlike tool plugins which need `tools.allowlist`).

### Validation
- Config is validated against the plugin's TypeBox schema
- Unknown `channels.<id>` keys are errors unless a plugin manifest declares the channel id
- Only one plugin can own each channel id; duplicates cause diagnostic errors

---

## Plugin Manifest

### package.json

```json
{
  "name": "@openclaw/my-channel",
  "version": "1.0.0",
  "main": "./index.ts",
  "type": "module",
  "openclaw": {
    "extensions": ["./index.ts"],
    "channel": {
      "id": "my-channel",
      "label": "My Channel",
      "docsPath": "/channels/my-channel",
      "order": 100
    }
  },
  "devDependencies": {
    "openclaw": "workspace:*"
  }
}
```

### openclaw.plugin.json (Optional)

```json
{
  "id": "my-plugin",
  "name": "My OpenClaw Plugin",
  "version": "1.0.0",
  "description": "A custom channel plugin",
  "author": "Your Name",
  "license": "MIT"
}
```

---

## Reference Implementation: DingTalk Channel Plugin

**Repo:** https://github.com/soimy/openclaw-channel-dingtalk

### File Structure
```
src/
  channel.ts       # Main plugin implementation (535 lines)
  runtime.ts       # Runtime management (14 lines)
  types.ts         # Type definitions (30+ interfaces)
  utils.ts         # Utility functions (110 lines)
  index.ts         # Plugin registration (29 lines)
```

### Key Patterns
- Uses WebSocket streaming ("Stream mode") - no webhook/IP exposure needed
- Defines comprehensive TypeScript interfaces for config, messages, and cards
- Supports two output modes: markdown and interactive AI cards
- Multi-account configuration via `DingTalkChannelConfig`
- Inbound: WebSocket events -> normalized message format
- Outbound: Text/markdown or interactive card streaming

### Config Schema (DingTalk)

| Option | Type | Required | Purpose |
|--------|------|----------|---------|
| `clientId` | string | Yes | AppKey credential |
| `clientSecret` | string | Yes | AppSecret credential |
| `messageType` | string | No | "markdown" or "card" |
| `cardTemplateId` | string | No | AI card template ID |
| `dmPolicy` | string | No | DM access control |
| `groupPolicy` | string | No | Group access control |

---

## Built-in Channel Extensions

| Extension | Platform | Package Location |
|-----------|----------|-----------------|
| msteams | Microsoft Teams | `extensions/msteams` |
| matrix | Matrix protocol | `extensions/matrix` |
| nostr | Nostr | `extensions/nostr` |
| zalo | Zalo | `extensions/zalo` |
| voice-call | Twilio Voice | `extensions/voice-call` |
| telegram | Telegram | `extensions/telegram` |
| discord | Discord | `extensions/discord` |

---

## Plugin Lifecycle

1. **Discovery**: Loader scans `extensions/` for `package.json` with `openclaw.extensions` field
2. **Validation**: Manifest schema validated, config checked against TypeBox schema
3. **Loading**: Plugin module imported, SDK provided
4. **Initialization**: `init(config, deps)` called, integration slots registered
5. **Runtime**: Plugin active and integrated with Gateway
6. **Shutdown**: Cleanup hooks called on Gateway shutdown

---

## Constraints & Caveats

1. **TypeBox schema required** - Missing schemas produce warnings during plugin loading
2. **Never put `openclaw` in `dependencies`** - Use `devDependencies` or `peerDependencies` only (breaks npm installs outside monorepo)
3. **One plugin per channel id** - Duplicates cause diagnostic errors
4. **Plugin commands process before built-in commands** and before the AI agent
5. **Config under `channels.<id>`** not `plugins.entries` - the latter causes validation errors (Issue #2073)
6. **Error handling critical** - Unhandled errors can crash the Gateway
7. **Built-in channels are NOT plugins** in the legacy codebase - only `extensions/` directory plugins properly export plugin interfaces
8. **Auto-enable only works** when extensions directory is bundled in the distribution

---

## Additional API Methods Available

Beyond `registerChannel`, plugins can use:
- `registerGatewayRpcMethod` - Expose custom API endpoints
- `registerCliCommand` - Add custom CLI commands
- `registerAgentTool` - Extend agent capabilities
- `registerTool` - Register tools
- `registerProvider` - Register AI model providers

---

## Sources

- [GitHub Discussion #2240](https://github.com/openclaw/openclaw/discussions/2240)
- [OpenClaw Plugin Docs](https://docs.openclaw.ai/tools/plugin)
- [Wemble Building Guide](https://wemble.com/2026/01/31/building-an-openclaw-plugin.html)
- [DeepWiki Extensions & Plugins](https://deepwiki.com/openclaw/openclaw/10-extensions-and-plugins)
- [DeepWiki Creating Custom Plugins](https://deepwiki.com/openclaw/openclaw/10.3-creating-custom-plugins)
- [DingTalk Channel Plugin](https://github.com/soimy/openclaw-channel-dingtalk)
- [Issue #2073 - Plugin Auto-Enable](https://github.com/openclaw/openclaw/issues/2073)
