# Wemble Guide: Building an OpenClaw Channel Plugin

**Source:** https://wemble.com/2026/01/31/building-an-openclaw-plugin.html
**Fetched:** 2026-02-18

---

## Overview

The Wemble guide walks through building an OpenClaw channel plugin in 7 steps. It covers project setup, manifest creation, entry point definition, channel object structure, full implementation, testing, and installation/configuration.

---

## The 7 Steps

### Step 1: Project Setup

Initialize a Node.js project with TypeScript, Vitest, and @types/node. Key config:

**package.json:**
```json
{
  "type": "module",
  "main": "./dist/index.js",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "test": "vitest run"
  }
}
```

**tsconfig.json:**
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true
  },
  "include": ["src/**/*"]
}
```

### Step 2: Plugin Manifest

Create `openclaw.plugin.json` at the project root:

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

Also add `openclaw.extensions` to package.json to declare entry points:

```json
{
  "openclaw": {
    "extensions": ["./src/index.ts"]
  }
}
```

### Step 3: Entry Point

The entry point is a single default-exported `register` function that receives the Plugin API object:

```typescript
export default function register(api: any) {
  api.logger.info("Hello from my plugin!");
  api.registerChannel({ plugin: myChannel });
}
```

### Step 4: Channel Definition

The channel object is the core data structure. It contains:

```typescript
const myChannel = {
  id: "my-channel",

  meta: {
    id: "my-channel",
    label: "My Channel",
    selectionLabel: "My Channel (custom)",
    docsPath: "/channels/my-channel",
    blurb: "A custom channel plugin for OpenClaw.",
    aliases: ["mine"],
  },

  capabilities: {
    chatTypes: ["direct"],
  },

  config: {
    listAccountIds: (cfg: any) =>
      Object.keys(cfg.channels?.["my-channel"]?.accounts ?? {}),
    resolveAccount: (cfg: any, accountId?: string) =>
      cfg.channels?.["my-channel"]?.accounts?.[accountId ?? "default"] ?? {
        accountId,
      },
  },

  outbound: {
    deliveryMode: "direct" as const,
    sendText: async ({ text }: { text: string }) => {
      console.log(`Agent says: ${text}`);
      return { ok: true };
    },
  },
};
```

### Step 5: Complete Implementation

Combines all pieces into a single working `src/index.ts`:

```typescript
const myChannel = {
  id: "my-channel",

  meta: {
    id: "my-channel",
    label: "My Channel",
    selectionLabel: "My Channel (custom)",
    docsPath: "/channels/my-channel",
    blurb: "A custom channel plugin.",
    aliases: ["mine"],
  },

  capabilities: {
    chatTypes: ["direct"],
  },

  config: {
    listAccountIds: (cfg: any) =>
      Object.keys(cfg.channels?.["my-channel"]?.accounts ?? {}),
    resolveAccount: (cfg: any, accountId?: string) =>
      cfg.channels?.["my-channel"]?.accounts?.[accountId ?? "default"] ?? {
        accountId,
      },
  },

  outbound: {
    deliveryMode: "direct" as const,
    sendText: async ({ text }: { text: string }) => {
      console.log(`[my-channel] Agent says: ${text}`);
      return { ok: true };
    },
  },
};

export default function register(api: any) {
  api.logger.info("My plugin loaded!");
  api.registerChannel({ plugin: myChannel });
}
```

### Step 6: Testing

Write Vitest tests using a mocked API object:

```typescript
import { describe, it, expect, vi } from "vitest";
import register from "./index.js";

describe("MyPlugin", () => {
  it("registers a channel", () => {
    const api = {
      logger: { info: vi.fn() },
      registerChannel: vi.fn(),
    };

    register(api);

    expect(api.registerChannel).toHaveBeenCalledTimes(1);
    expect(api.registerChannel).toHaveBeenCalledWith(
      expect.objectContaining({
        plugin: expect.objectContaining({ id: "my-channel" }),
      })
    );
  });
});
```

### Step 7: Install & Configure

**Installation (development - link mode):**
```bash
openclaw plugins install -l ./path/to/my-openclaw-plugin
```

**Installation (production - copy mode):**
```bash
openclaw plugins install ./path/to/my-openclaw-plugin
```

**Gateway configuration:**
```json
{
  "channels": {
    "my-channel": {
      "accounts": {
        "default": {
          "enabled": true
        }
      }
    }
  }
}
```

After adding configuration, restart the gateway and verify logs.

---

## Minimal Viable Channel Plugin Structure

A working plugin requires only 3 files:

1. **`openclaw.plugin.json`** - Plugin metadata (id, name, version)
2. **`src/index.ts`** - Default-exported `register(api)` function
3. **`package.json`** - With `"type": "module"` and `openclaw.extensions` array

The core channel object requires these properties:
- `id` (string) - Unique channel identifier
- `meta` (object) - UI/CLI display information
- `capabilities` (object) - Supported chat types
- `config` (object) - Account resolution functions
- `outbound` (object) - Message delivery functions

---

## Config Schema Definition

Config is defined via two required functions on the channel's `config` property:

```typescript
config: {
  listAccountIds: (cfg: any) =>
    Object.keys(cfg.channels?.["my-channel"]?.accounts ?? {}),
  resolveAccount: (cfg: any, accountId?: string) =>
    cfg.channels?.["my-channel"]?.accounts?.[accountId ?? "default"] ?? {
      accountId,
    },
}
```

- **`listAccountIds(cfg)`**: Receives the full gateway config, returns an array of account ID strings found under `cfg.channels["<channel-id>"].accounts`
- **`resolveAccount(cfg, accountId?)`**: Receives gateway config + optional account ID, returns the account config object. Defaults to `"default"` account if no ID is provided.

The pattern is: gateway config JSON has a `channels.<channel-id>.accounts` map, and these functions know how to navigate it.

---

## Plugin Lifecycle

The guide describes the **startup** lifecycle:

1. Gateway discovers the plugin via `openclaw.plugin.json`
2. Gateway calls the default-exported `register(api)` function
3. Plugin calls `api.registerChannel({ plugin: channelObject })` to register
4. Plugin is now active - when an agent sends messages through this channel, `outbound.sendText()` is invoked

**No explicit disconnect/cleanup handlers are documented in this guide.** The guide does not cover shutdown or teardown lifecycle hooks.

### API Object

The `api` parameter passed to `register()` provides at minimum:
- `api.logger` - Logger with `.info()` (and likely other log levels)
- `api.registerChannel()` - Registers a channel plugin

---

## Gotchas & Best Practices

1. **No compilation needed in dev**: "OpenClaw loads TypeScript files directly at runtime via jiti, so you don't even need to compile during development." Use `openclaw.extensions` pointing to `.ts` files directly.

2. **Plugin runs inside gateway process**: The plugin shares the gateway's Node.js process. Be mindful of blocking operations.

3. **Communication protocol is flexible**: The channel communication protocol (HTTP, WebSocket, etc.) is entirely up to the developer. The guide's minimal example just logs to console.

4. **Use `-l` flag for development**: Link mode (`-l`) avoids copying and lets you iterate quickly.

5. **Always specify capabilities**: The `capabilities` object with `chatTypes` is required. The guide uses `["direct"]` for direct messaging.

6. **`deliveryMode: "direct" as const`**: The TypeScript `as const` assertion is used on `deliveryMode` to ensure correct literal type narrowing.

7. **Config defaults pattern**: Always provide a fallback for missing config, e.g., `?? { accountId }` in `resolveAccount`.

---

## Dependencies

| Package | Purpose |
|---------|---------|
| `typescript` | TypeScript compiler |
| `vitest` | Test runner |
| `@types/node` | Node.js type definitions |
| `jiti` | Runtime TS loader (auto-included by OpenClaw) |
| Node.js 22+ | Minimum runtime version |

---

## Key TypeScript Types/Interfaces

The guide uses loose typing (`any`) throughout. Inferred shapes:

```typescript
// Plugin API (passed to register)
interface PluginAPI {
  logger: { info: (msg: string) => void };
  registerChannel: (opts: { plugin: ChannelPlugin }) => void;
}

// Channel Plugin
interface ChannelPlugin {
  id: string;
  meta: {
    id: string;
    label: string;
    selectionLabel: string;
    docsPath: string;
    blurb: string;
    aliases: string[];
  };
  capabilities: {
    chatTypes: string[];  // e.g. ["direct"]
  };
  config: {
    listAccountIds: (cfg: any) => string[];
    resolveAccount: (cfg: any, accountId?: string) => any;
  };
  outbound: {
    deliveryMode: "direct";
    sendText: (params: { text: string }) => Promise<{ ok: boolean }>;
  };
}
```

---

## Summary for Implementation

To build a Discord channel plugin, we need to:
1. Follow the same file structure (plugin.json, package.json, src/index.ts)
2. Replace `my-channel` with `discord` as the channel ID
3. Implement `outbound.sendText` to actually deliver messages via Discord API
4. Add Discord-specific config (bot token, guild IDs, etc.) in the accounts structure
5. Consider adding inbound message handling (not covered in this guide - need to check OpenClaw source for patterns)
6. The guide only covers outbound; inbound/bidirectional channels likely need additional API surface from OpenClaw
