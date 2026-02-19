# OpenClaw Channel Plugin: Installation & Registration Process

**Researched:** 2026-02-19
**Domain:** OpenClaw Plugin System (Channel Plugins)
**Confidence:** HIGH (verified across official docs, DeepWiki source analysis, and community references)

---

## Executive Summary

OpenClaw discovers channel plugins through a well-defined pipeline: **discovery -> validation -> registration -> initialization**. There are two distinct paths for getting a channel plugin recognized: (1) the `openclaw plugins install` CLI command for npm-published packages, and (2) manual placement in the extensions discovery directories. Both paths converge on the same requirement: a valid `openclaw.plugin.json` manifest, a `package.json` with `openclaw.extensions` field, and channel configuration in `~/.openclaw/openclaw.json`.

**Primary finding:** Your existing project (`@openclawcity/openclawcity`) already has the correct manifest structure. The exact install-and-register process is documented below.

---

## The Exact Process (Step by Step)

### Method 1: Install from npm (Production Path)

```bash
# Step 1: Publish to npm (if not already published)
npm publish

# Step 2: Install via OpenClaw CLI
openclaw plugins install @openclawcity/openclawcity

# This does:
#   - Runs `npm pack` on the package
#   - Extracts into ~/.openclaw/extensions/openclawcity/
#   - Runs `npm install --ignore-scripts` for dependencies (security: no lifecycle scripts)
#   - Auto-enables the plugin in config

# Step 3: Add channel configuration to ~/.openclaw/openclaw.json
# (see "Channel Configuration" section below)

# Step 4: Restart the Gateway
openclaw gateway restart
```

**Key detail:** Scoped npm packages are normalized to the unscoped ID for `plugins.entries.*`. So `@openclawcity/openclawcity` becomes entry ID `openclawcity`.

### Method 2: Install from Local Path (Development Path)

```bash
# Option A: Copy (one-time install)
openclaw plugins install ./path/to/openclaw-channel

# Option B: Symlink (live dev mode — changes reflect immediately)
openclaw plugins install -l ./path/to/openclaw-channel

# Option C: From tarball
openclaw plugins install ./openclaw-channel.tgz

# Option D: From zip
openclaw plugins install ./openclaw-channel.zip
```

### Method 3: Direct Placement (Manual/Advanced)

Place the plugin directory directly in one of the discovery locations (see "Plugin Discovery Order" below). No CLI command needed, but you must manually add configuration.

---

## Plugin Discovery Order

OpenClaw scans for plugins in this exact order. **First match wins** if multiple plugins share the same ID.

```
1. Config paths (plugins.load.paths in openclaw.json)
   |-- File or directory specified in config

2. Workspace extensions
   |-- <workspace>/.openclaw/extensions/*.ts
   |-- <workspace>/.openclaw/extensions/*/index.ts

3. Global extensions  <-- where `openclaw plugins install` puts them
   |-- ~/.openclaw/extensions/*.ts
   |-- ~/.openclaw/extensions/*/index.ts

4. Bundled extensions (shipped with OpenClaw itself)
   |-- <openclaw-install-dir>/extensions/*
```

**For npm-installed plugins:** `openclaw plugins install` copies into `~/.openclaw/extensions/<id>/` (location #3).

---

## Required Files

### File 1: `openclaw.plugin.json` (REQUIRED)

Every plugin MUST have this in its root. Missing or invalid manifests block config validation.

**Your current file:**
```json
{
  "id": "openclawcity",
  "channels": ["openclawcity"],
  "configSchema": {
    "type": "object",
    "additionalProperties": true,
    "properties": {}
  }
}
```

**Required fields:**
| Field | Type | Required | Purpose |
|-------|------|----------|---------|
| `id` | string | YES | Canonical plugin identifier |
| `configSchema` | object | YES | JSON Schema for plugin config validation (empty schema OK for zero-config) |

**Optional fields:**
| Field | Type | Purpose |
|-------|------|---------|
| `channels` | string[] | Array of channel IDs this plugin registers |
| `kind` | string | Plugin category (e.g., "memory") for exclusive slots |
| `providers` | string[] | Provider IDs registered by plugin |
| `skills` | string[] | Relative paths to skill directories |
| `name` | string | Display name |
| `description` | string | Brief summary |
| `version` | string | Informational version |
| `uiHints` | object | UI rendering config (labels, placeholders, sensitivity flags) |

**Example with uiHints:**
```json
{
  "id": "openclawcity",
  "channels": ["openclawcity"],
  "configSchema": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "apiKey": { "type": "string" },
      "botId": { "type": "string" }
    }
  },
  "uiHints": {
    "apiKey": { "label": "API Key", "sensitive": true },
    "botId": { "label": "Bot ID", "placeholder": "your-bot-id" }
  }
}
```

### File 2: `package.json` with `openclaw` field (REQUIRED)

The `openclaw.extensions` field is what the plugin loader scans for.

**Your current file (already correct):**
```json
{
  "name": "@openclawcity/openclawcity",
  "openclaw": {
    "extensions": ["./dist/index.js"],
    "channel": {
      "id": "openclawcity",
      "label": "OpenClawCity",
      "selectionLabel": "OpenClawCity (Live City)",
      "docsPath": "/channels/openclawcity",
      "docsLabel": "openclawcity",
      "blurb": "Live connection to OpenClawCity...",
      "order": 50,
      "aliases": ["occ", "openclawcity"]
    },
    "install": {
      "npmSpec": "@openclawcity/openclawcity",
      "localPath": ".",
      "defaultChoice": "npm"
    }
  }
}
```

**Critical fields:**
| Field | Purpose |
|-------|---------|
| `openclaw.extensions` | Array of entry point files. Must resolve inside plugin root (security check). |
| `openclaw.channel` | Channel metadata: id, label, docsPath, order, aliases |
| `openclaw.channel.id` | MUST match the config key in `channels.<id>` in openclaw.json |
| `openclaw.install` | Onboarding hints (npmSpec, localPath, defaultChoice) |

**Security rules enforced:**
- Every `openclaw.extensions` entry must stay inside the plugin directory after symlink resolution
- Entries that escape the plugin root are rejected
- Plugin root must not be world-writable
- Path ownership is checked for non-bundled plugins

### File 3: Entry Point (`dist/index.js` or `index.ts`)

Must export a default plugin object with a `register` function:

```typescript
import type { OpenClawPluginApi } from 'openclaw/plugin-sdk';

const plugin = {
  id: 'openclawcity',
  name: 'OpenClawCity Channel',
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi): void {
    api.registerChannel({ plugin: channelDefinition });
  },
};

export default plugin;
```

The `register` function receives the Plugin API and calls `api.registerChannel()` with the channel definition object.

---

## Channel Configuration in `~/.openclaw/openclaw.json`

After installation, the user adds channel config. This is what makes the gateway actually START the channel.

### Minimal Configuration

```json5
{
  channels: {
    openclawcity: {
      apiKey: "user-api-key",
      botId: "user-bot-id",
      enabled: true
    }
  }
}
```

### Multi-Account Configuration

```json5
{
  channels: {
    openclawcity: {
      accounts: {
        default: {
          apiKey: "key-1",
          botId: "bot-1",
          enabled: true
        },
        secondary: {
          apiKey: "key-2",
          botId: "bot-2",
          enabled: true
        }
      }
    }
  }
}
```

### Plugin-Level Configuration (Optional)

If the plugin needs plugin-level (not channel-level) config:

```json5
{
  plugins: {
    enabled: true,
    entries: {
      openclawcity: {
        enabled: true,
        config: {
          // Plugin-specific config validated against openclaw.plugin.json configSchema
        }
      }
    }
  }
}
```

---

## Auto-Enable Behavior

**Bundled plugins** (in `<openclaw>/extensions/`): Automatically enabled when their configuration section exists in `openclaw.json`. Must be explicitly enabled via `plugins.entries.<id>.enabled` or `openclaw plugins enable <id>` otherwise.

**Installed plugins** (via `openclaw plugins install`): Enabled by default. Can be disabled via `openclaw plugins disable <id>`.

**Key insight:** For channel plugins, the presence of `channels.openclawcity` in the config is what triggers the gateway to start the channel. The plugin must be both loaded (discovered) AND configured (channel config present).

---

## Plugin Allow/Deny Lists

For security, users can control which plugins load:

```json5
{
  plugins: {
    enabled: true,
    allow: ["openclawcity"],     // Allowlist
    deny: ["untrusted-plugin"],  // Denylist (deny wins over allow)
    load: {
      paths: ["~/dev/openclaw-channel"]  // Additional discovery paths
    }
  }
}
```

---

## Verification: `openclaw doctor` and `openclaw plugins`

### Check Plugin Is Recognized

```bash
# List all loaded plugins
openclaw plugins list

# Get details about a specific plugin
openclaw plugins info openclawcity

# Run health checks (validates manifests, config schemas, etc.)
openclaw plugins doctor

# Run full system health check with auto-fix
openclaw doctor --fix
```

### What `openclaw doctor --fix` Validates for Plugins

- JSON Schema in `openclaw.plugin.json` is valid
- Plugin config in `openclaw.json` matches declared schema
- Unknown plugin IDs in `entries`, `allow`, `deny`, or `slots` are flagged as errors
- Broken manifests are reported
- Disabled plugins retain config but generate warnings
- Migrates deprecated config keys
- Fixes file permissions on `.openclaw` directory
- Creates missing required directories

---

## The Channel Plugin Contract

A channel plugin must provide these adapters via `api.registerChannel({ plugin })`:

### Required

| Adapter | Purpose |
|---------|---------|
| `id` | Channel identifier string |
| `meta` | Display metadata (id, label, selectionLabel, docsPath, blurb, aliases) |
| `capabilities` | Declares supported chat types (direct, group), media, threads |
| `config.listAccountIds(cfg)` | Returns array of account IDs from openclaw.json |
| `config.resolveAccount(cfg, accountId)` | Retrieves account config for a given ID |
| `outbound.deliveryMode` | "direct" or other delivery strategy |
| `outbound.sendText(ctx)` | Core message sending implementation |

### Optional

| Adapter | Purpose |
|---------|---------|
| `gateway.startAccount(ctx)` | Account lifecycle: connect, listen, return `{ stop }` |
| `setup` | Onboarding wizard |
| `security` | DM policy enforcement |
| `status` | Health/diagnostics |
| `mentions` | @-mention handling |
| `threading` | Thread/reply support |
| `streaming` | Streaming message support |
| `actions` | Message action buttons |
| `commands` | Slash commands |

---

## Plugin SDK Import

The Plugin SDK is importable from `openclaw/plugin-sdk`:

```typescript
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
```

**TypeScript note:** The SDK is exported as `dist/plugin-sdk/` and resolved via jiti aliasing at runtime. Never place `openclaw` in `dependencies` — use `devDependencies` only. The runtime resolves `openclaw/plugin-sdk` via jiti aliasing, not node_modules.

---

## Reference: How WhatsApp (Built-in Channel) Works

WhatsApp is a bundled channel plugin at `<openclaw>/extensions/whatsapp/`. It demonstrates the canonical pattern:

1. **Setup:** `openclaw channels login` shows QR code, user scans with WhatsApp
2. **Credentials:** Stored in `~/.openclaw/credentials/whatsapp/<accountId>/creds.json`
3. **Config in openclaw.json:**
   ```json5
   {
     channels: {
       whatsapp: {
         dmPolicy: "pairing",
         allowFrom: ["+1234567890"],
         groupPolicy: "disabled",
         textChunkLimit: 4000,
         chunkMode: "newline",
         sendReadReceipts: true,
         mediaMaxMb: 50,
         accounts: {
           default: { enabled: true }
         }
       }
     }
   }
   ```
4. **Auto-enable:** Presence of `channels.whatsapp` config auto-enables the bundled plugin

---

## Reference: Bundled Channel Extensions (37 total)

As of 2026-02, the OpenClaw `extensions/` directory contains these channel plugins:

| Channel | Library/Protocol | Extension Dir |
|---------|-----------------|---------------|
| WhatsApp | Baileys (Web protocol) | `extensions/whatsapp` |
| Telegram | Telegram Bot API | `extensions/telegram` (bundled in core) |
| Discord | Discord.js | `extensions/discord` (bundled in core) |
| MS Teams | Bot Framework + Graph API | `extensions/msteams` |
| Matrix | matrix-bot-sdk, E2EE | `extensions/matrix` |
| Slack | Slack API | `extensions/slack` |
| Signal | Signal protocol | `extensions/signal` |
| Nostr | nostr-tools | `extensions/nostr` |
| LINE | LINE Messaging API | `extensions/line` |
| IRC | IRC protocol | `extensions/irc` |
| Zalo | Zalo API | `extensions/zalo` |
| Google Chat | Google Chat API | `extensions/googlechat` |
| Mattermost | Mattermost API | `extensions/mattermost` |
| Twitch | Twitch IRC/API | `extensions/twitch` |
| iMessage | AppleScript/direct | `extensions/imessage` |
| BlueBubbles | iMessage relay | `extensions/bluebubbles` |
| Nextcloud Talk | Nextcloud API | `extensions/nextcloud-talk` |
| Tlon | http-api (Urbit) | `extensions/tlon` |
| Feishu (Lark) | Feishu API | `extensions/feishu` |

Plus non-channel extensions: voice-call, talk-voice, memory-core, memory-lancedb, lobster, llm-task, phone-control, diagnostics-otel, device-pair, copilot-proxy, open-prose, thread-ownership, shared, and auth plugins.

---

## CLI Command Reference

```bash
# Plugin management
openclaw plugins list                              # View all loaded plugins
openclaw plugins info <id>                         # Plugin details
openclaw plugins install <npm-spec>                # Install from npm registry
openclaw plugins install <path>                    # Install from local dir/file
openclaw plugins install -l <path>                 # Symlink (dev mode)
openclaw plugins install <tarball.tgz>             # Install from tarball
openclaw plugins install @scope/pkg --pin          # Pin exact version
openclaw plugins update <id>                       # Update single plugin
openclaw plugins update --all                      # Update all plugins
openclaw plugins enable <id>                       # Enable a plugin
openclaw plugins disable <id>                      # Disable a plugin
openclaw plugins doctor                            # Plugin-specific health check

# System
openclaw doctor                                    # Full health check
openclaw doctor --fix                              # Health check + auto-repair
openclaw gateway restart                           # Restart (required after plugin changes)
```

---

## Assessment of Current Project

Your project at `/Users/vincentsider/Projects/OpenClawCity/openclaw-channel/` already has:

| Requirement | Status | Notes |
|-------------|--------|-------|
| `openclaw.plugin.json` | PRESENT | Has id, channels, configSchema |
| `package.json` with `openclaw.extensions` | PRESENT | Points to `./dist/index.js` |
| `package.json` with `openclaw.channel` | PRESENT | Full channel metadata |
| `package.json` with `openclaw.install` | PRESENT | npm install hints |
| Entry point exports default plugin | PRESENT | `src/index.ts` with `register()` calling `api.registerChannel()` |
| Channel contract (meta, config, outbound, gateway) | PRESENT | Full implementation |
| `openclaw.plugin.json` in `files` array | **MISSING** | `files` array only lists `dist/` and `package.json` |

**Critical issue:** Your `package.json` `files` field does NOT include `openclaw.plugin.json`:
```json
"files": [
  "dist/",
  "package.json"
]
```

This means when published to npm and installed via `openclaw plugins install`, the `openclaw.plugin.json` file will NOT be included in the package. Since "Every plugin must include a `openclaw.plugin.json` file in its root" and "missing or invalid manifests block config validation," this would cause the plugin to fail validation after npm install.

**Fix:** Add `"openclaw.plugin.json"` to the `files` array.

---

## Sources

### Primary (HIGH confidence)
- [Official OpenClaw Plugin Documentation](https://docs.openclaw.ai/tools/plugin) -- complete CLI reference, discovery order, manifest format, channel plugin contract, configuration
- [Official Plugin Manifest Documentation](https://docs.openclaw.ai/plugins/manifest) -- manifest schema, required/optional fields, validation rules
- [Official Doctor Documentation](https://docs.openclaw.ai/gateway/doctor) -- doctor --fix behavior and validation
- [Official WhatsApp Channel Docs](https://docs.openclaw.ai/channels/whatsapp) -- reference built-in channel configuration
- [Official Community Plugins Page](https://docs.openclaw.ai/plugins/community) -- npm install patterns
- [OpenClaw GitHub extensions/](https://github.com/openclaw/openclaw/tree/main/extensions) -- bundled extension directory listing

### Secondary (MEDIUM confidence)
- [DeepWiki: Extensions and Plugins](https://deepwiki.com/openclaw/openclaw/10-extensions-and-plugins) -- source-code-derived architecture analysis, plugin lifecycle
- [DeepWiki: Creating Custom Plugins](https://deepwiki.com/openclaw/openclaw/10.3-creating-custom-plugins) -- Plugin SDK API, TypeBox schemas, dev workflow
- [Wemble: Building a Channel Plugin](https://wemble.com/2026/01/31/building-an-openclaw-plugin.html) -- step-by-step community guide

### Tertiary (LOW confidence)
- [Jose Javi Asilis on X](https://x.com/javiasilis/status/2018063356087660544) -- `openclaw doctor --fix` migration behavior anecdote
- [GitHub Issue #2073](https://github.com/openclaw/openclaw/issues/2073) -- plugin-auto-enable validation error edge case
- [GitHub Issue #6792](https://github.com/openclaw/openclaw/issues/6792) -- configPatch in plugin manifest feature request
