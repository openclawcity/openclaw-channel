# DeepWiki Custom Plugins Research
> Source: https://deepwiki.com/openclaw/openclaw/10.3-creating-custom-plugins
> Fetched: 2026-02-18

---

## 1. Plugin System Architecture Overview

OpenClaw uses a **slot-based plugin architecture** with four plugin types:

| Slot | Subsystem | Purpose | Examples |
|------|-----------|---------|----------|
| `channel` | Message routing | Integrate messaging platforms | Matrix, MS Teams, Zalo |
| `tool` | Agent tools | Add agent capabilities | Lobster workflows, voice-call |
| `provider` | Model inference | Add AI model backends | Google Antigravity, Copilot Proxy |
| `memory` | Context search | Add memory backends | memory-core (SQLite), memory-lancedb |

---

## 2. PluginDefinition Interface

Every plugin entry point exports a default object conforming to `PluginDefinition`:

```typescript
import type { PluginDefinition } from "openclaw/plugin-sdk";

export default {
  slot: "channel" | "tool" | "provider" | "memory",
  id: "unique-identifier",
  schema: Type,              // TypeBox schema for config validation
  metadata: {
    name: "Display Name",
    icon: "icon-class",
    description: "Plugin description"
  },
  init: async (config: any, deps: DependencyContext) => {
    // Return slot-specific implementation
    return implementation;
  }
} satisfies PluginDefinition;
```

### Definition Fields

| Field | Type | Required | Purpose |
|-------|------|----------|---------|
| `slot` | `"channel"` \| `"tool"` \| `"provider"` \| `"memory"` | Yes | Determines which subsystem loads the plugin |
| `id` | `string` | Yes | Unique identifier (matches config key) |
| `schema` | TypeBox schema | Yes | Configuration validation schema |
| `metadata` | `object` | No | Display metadata (name, icon, description) |
| `init` | `async function` | Yes | Returns slot-specific implementation |

### init Function Signature

```typescript
init: async (config: ValidatedConfig, deps: DependencyContext) => SlotImplementation
```

- **config**: Validated configuration object (matches the TypeBox schema)
- **deps**: Dependency injection context (see below)

---

## 3. Dependency Injection Context (DependencyContext)

The `deps` object passed to `init()`:

| Property | Type | Purpose |
|----------|------|---------|
| `logger` | `Logger` (tslog) | Structured logging |
| `configDir` | `string` | Path to `~/.openclaw/` |
| `workspaceDir` | `string` | Agent workspace path |
| `rpc` | `RPCClient` | Gateway RPC client for internal communication |

---

## 4. Channel Plugin Implementation

### What init() Returns for Channel Plugins

For `slot: "channel"`, the `init()` function returns an object with at minimum:

```typescript
return {
  async send(message) {
    // Send a message to the external platform
    await client.sendMessage(message);
  },
  async monitor(handler) {
    // Listen for incoming messages and call handler
    client.on("message", handler);
  }
};
```

**Key methods:**
- **`send(message)`**: Sends outbound messages from OpenClaw to the external platform
- **`monitor(handler)`**: Sets up inbound message listening; calls `handler` when messages arrive

### Channel-Specific Package Metadata

Channel plugins declare additional metadata in `openclaw.channel`:

```json
{
  "openclaw": {
    "channel": {
      "id": "matrix",
      "label": "Matrix",
      "docsPath": "/channels/matrix",
      "order": 70,
      "quickstartAllowFrom": true
    }
  }
}
```

| Field | Purpose |
|-------|---------|
| `id` | Channel identifier (matches plugin id) |
| `label` | Human-readable display name |
| `docsPath` | Path to channel documentation |
| `order` | Sort order in UI/listings |
| `quickstartAllowFrom` | Whether channel appears in quickstart options |

---

## 5. Plugin Lifecycle

### Phase 1: Discovery

The plugin loader scans for directories containing `package.json` with an `openclaw.extensions` field.

**Discovery locations (in order):**
1. **Workspace packages**: `extensions/*/package.json` in monorepo
2. **NPM registry**: `node_modules/@openclaw/*/package.json` for published packages

Workspace configuration in `pnpm-workspace.yaml`:
```yaml
packages:
  - "extensions/*"
```

### Phase 2: Validation

1. Load entry point module (from `openclaw.extensions` array)
2. Extract TypeBox schema from plugin definition
3. Validate against config section (if present)
4. Log warnings for missing schemas

### Phase 3: Registration

- Register capability metadata in the Plugin Registry
- Map plugin `id` to its definition

### Phase 4: Initialization

When configuration exists for a plugin's `id`, the Gateway calls `init(config, deps)`:
- Config is validated against the TypeBox schema first
- Dependencies are injected via the `deps` parameter
- The returned implementation is registered with the appropriate subsystem

### Phase 5: Active

Plugin is integrated into its subsystem (message routing for channels, tool registry for tools, etc.)

### Lifecycle Diagram

```
Discovery (scan extensions/) --> Validation (TypeBox schema) --> Registration (Plugin Registry) --> Initialization (init function) --> Active (subsystem integration)
```

---

## 6. Plugin Discovery Mechanism

### How OpenClaw Finds Plugins

1. **Local workspace**: Scans `extensions/*/package.json` for `openclaw.extensions` field
2. **npm installed**: Scans `node_modules/@openclaw/*/package.json` for the same field
3. **Entry point resolution**: Paths in `openclaw.extensions` are relative to the package directory

### The `openclaw.extensions` Field

```json
{
  "openclaw": {
    "extensions": ["./index.ts"]
  }
}
```

This is the **required** field that marks a package as an OpenClaw plugin. Without it, the package is invisible to the plugin loader.

### Runtime Resolution

The Plugin SDK (`openclaw/plugin-sdk`) is resolved through **jiti aliasing** for dynamic plugin loading. This is configured in the root `package.json`:

```json
{
  "exports": {
    "./plugin-sdk": "./dist/plugin-sdk/index.d.ts"
  }
}
```

---

## 7. Channel-Gateway Communication

### RPC Client

Channels communicate with the Gateway via the `rpc` property in the dependency context (`deps.rpc`). This is a Gateway RPC client for internal communication.

### Auto-Enable Behavior

Channel plugins auto-enable based on configuration:
- When `channels.<id>.*` exists in config, the channel is auto-enabled
- No explicit opt-in required (unlike tool plugins which need `tools.allowlist`)

### Configuration Location

Plugin configuration lives in `~/.openclaw/openclaw.json`:

```json5
{
  "channels": {
    "my-channel": {
      "apiKey": "your-api-key",
      "webhookUrl": "https://your-webhook.com"
    }
  }
}
```

---

## 8. TypeBox Schema Requirement

All plugins embed a TypeBox schema for configuration validation:

```typescript
import { Type } from "@sinclair/typebox";

const schema = Type.Object({
  token: Type.String({ description: "Authentication token" }),
  endpoint: Type.Optional(Type.String()),
  retries: Type.Number({ default: 3 })
});
```

- Missing schemas produce warnings during plugin loading
- Schema is used both for validation and for UI generation

---

## 9. Package Structure

### Directory Layout

```
extensions/my-channel/
  package.json
  index.ts
  README.md
  CHANGELOG.md
```

### Complete package.json Example

```json
{
  "name": "@openclaw/my-channel",
  "version": "1.0.0",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "openclaw": {
    "extensions": ["./index.ts"],
    "channel": {
      "id": "my-channel",
      "label": "My Channel",
      "order": 80
    }
  },
  "dependencies": {
    "axios": "^1.0.0"
  },
  "devDependencies": {
    "openclaw": "workspace:*",
    "typescript": "^5.0.0"
  }
}
```

### Dependency Rules (Critical)

- **Runtime dependencies**: Go in `dependencies` (e.g., HTTP clients, TypeBox)
- **SDK types**: Import from `openclaw/plugin-sdk` via `devDependencies` or `peerDependencies`
- **NEVER** place `openclaw` in `dependencies`
- **NEVER** use `workspace:*` in production dependencies (breaks npm installations outside monorepo)

---

## 10. Complete Channel Plugin Example

```typescript
import { Type } from "@sinclair/typebox";
import type { PluginDefinition } from "openclaw/plugin-sdk";

const schema = Type.Object({
  apiKey: Type.String({ description: "API key" }),
  webhookUrl: Type.String({ description: "Webhook URL" })
});

export default {
  slot: "channel",
  id: "my-channel",
  schema,
  metadata: {
    name: "My Channel",
    description: "Integration with My Messaging Platform"
  },
  init: async (config, deps) => {
    deps.logger.info("Initializing my-channel plugin");

    const client = createClient(config.apiKey);

    return {
      async send(message) {
        await client.sendMessage(message);
      },
      async monitor(handler) {
        client.on("message", handler);
      }
    };
  }
} satisfies PluginDefinition;
```

---

## 11. Bundled Channel Plugins (Reference)

| Plugin | Platform | Notable Features |
|--------|----------|-----------------|
| `msteams` | Microsoft Teams | Bot Framework, adaptive cards, file uploads |
| `matrix` | Matrix | E2EE, DM resolution, group allowlists |
| `nostr` | Nostr | Profile management, relay handling |
| `line` | LINE | Rich replies, quick replies, HTTP registry |
| `tlon` | Tlon/Urbit | DMs, group mentions, thread replies |

Published to npm:
- `@openclaw/bluebubbles`
- `@openclaw/discord`
- `@openclaw/matrix`
- `@openclaw/msteams`
- `@openclaw/voice-call`
- `@openclaw/zalo`

---

## 12. Testing Approach

### Local Testing

The plugin loader logs initialization status:
- "Loading plugin from extensions/my-plugin"
- "Validated plugin config for my-plugin"
- "Plugin my-plugin initialized"

### Unit Testing (Vitest)

```typescript
import { describe, it, expect, vi } from "vitest";

describe("my-plugin", () => {
  it("initializes with valid config", async () => {
    const deps = {
      logger: { info: vi.fn() },
      configDir: "/tmp",
      workspaceDir: "/tmp/workspace",
      rpc: {} as any
    };

    const plugin = await init({ apiKey: "test" }, deps);
    expect(plugin).toBeDefined();
  });
});
```

---

## 13. Key Takeaways for Building a Channel Plugin

1. **Entry point**: Default export conforming to `PluginDefinition` with `slot: "channel"`
2. **Discovery**: Requires `openclaw.extensions` in `package.json` pointing to entry file
3. **Config validation**: TypeBox schema is mandatory for config validation
4. **init returns**: Object with `send()` and `monitor()` methods (at minimum)
5. **Communication**: Via `deps.rpc` (Gateway RPC client) and the returned implementation methods
6. **Auto-enable**: Channels auto-enable when `channels.<id>` config section exists
7. **SDK import**: `import type { PluginDefinition } from "openclaw/plugin-sdk"` (types only)
8. **Dependencies**: Never put `openclaw` in production dependencies
9. **Location**: Place in `extensions/` directory for monorepo development
10. **Testing**: Use Vitest with mocked dependency context
