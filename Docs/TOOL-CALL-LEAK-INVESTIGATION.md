# Investigation: Raw Tool-Call Markup Leaking as DM Reply Text

**Date:** 2026-03-06
**Symptom:** Bot sent raw markup as a DM message:
```
<PLHD>[{"name":"read","parameters":{"path":"/home/vincent/.openclaw/workspace/HEARTBEAT.md"}}]<PLHD>
```

---

## 1. Root Cause

**The root cause is a gap in the SDK's text sanitization pipeline, likely exposed (not caused) by the city context prepend added in commit `100cf3e` (v1.0.12).**

### What changed in v1.0.12

Commit `100cf3e` added `fetchHeartbeatContext()` which prepends a `[CITY CONTEXT]...[/CITY CONTEXT]` block to every inbound message before dispatching it to the LLM (`src/index.ts:165-167`):

```ts
envelope.content.text = `[CITY CONTEXT]\n${cityCtx}\n[/CITY CONTEXT]\n\n${envelope.content.text}`;
```

This injects potentially large, structured text (heartbeat markdown) into the `Body`, `RawBody`, and `CommandBody` fields of the `MsgContext` that the SDK sends to the LLM.

### Why this triggers the leak

The prepended city context:
1. Increases the prompt size, which can push the LLM toward longer, more complex responses
2. Introduces bracket-heavy structured markup (`[CITY CONTEXT]`, `[/CITY CONTEXT]`) that the LLM may mirror in its output format
3. May cause the LLM to generate tool calls in a non-standard format that the SDK's parser cannot recognize

When the SDK's tool-call parser fails to recognize a tool call, the raw markup (including `<PLHD>` placeholder tags) passes through as plain text content, which then flows to `deliver()` unchecked.

### The SDK version factor

- **Local `node_modules`:** OpenClaw `2026.2.15`
- **Pi (production):** OpenClaw `2026.2.17+`

The SDK version on the Pi may have different tool-call parsing behavior. This was NOT verified because the Pi's SDK source wasn't available locally, but a version mismatch could contribute to or independently cause the parsing failure.

No SDK version bump occurred in commit `100cf3e` — only the plugin version went from `1.0.11` to `1.0.12`.

---

## 2. Leak Point

The leak path is:

```
LLM response (contains <PLHD>...<PLHD> tool-call markup)
  -> SDK streaming parser (fails to parse as tool_use block)
  -> extractAssistantText$1() strips [Tool Call:...] and <minimax:tool_call> formats
  -> stripBlockTags() strips <thinking> and <final> tags
  -> BUT: no function strips <PLHD>...</PLHD> tags
  -> sanitizeUserFacingText() strips <final> tags only (FINAL_TAG_RE = /<\s*\/?\s*final\s*>/gi)
  -> normalizeReplyPayload() in the dispatcher's enqueue() — no PLHD filtering
  -> deliver() callback at src/index.ts:260 receives raw PLHD markup as payload.text
  -> adapter.sendReply() sends it to the city as a dm_reply/speak/owner_reply
```

**Key findings in the SDK (`2026.2.15`):**

| Sanitization function | What it strips | Strips PLHD? |
|---|---|---|
| `stripFinalTagsFromText()` | `<final>`, `</final>` | No |
| `stripDowngradedToolCallText()` | `[Tool Call: ...]`, `[Tool Result: ...]` | No |
| `stripMinimaxToolCallXml()` | `<minimax:tool_call>`, `<invoke>` | No |
| `sanitizeUserFacingText()` | Error messages, `<final>` tags, duplicates | No |

**The `<PLHD>` tag format is not handled by any sanitization function in the SDK.** The PLHD pattern does not appear anywhere in the SDK source (`node_modules/openclaw/dist/`). It originates from the LLM provider layer — likely a placeholder format used by a specific model provider to represent tool calls inline in text content.

### The deliver callback has no filtering

`src/index.ts:260-295` — the `deliver` callback blindly forwards `payload.text` to the city:

```ts
deliver: async (payload: ReplyPayload) => {
  const text = payload.text;
  if (!text) return;
  // ... directly sends text via adapter.sendReply()
}
```

It does not:
- Check the `info.kind` parameter (the callback signature doesn't even accept it)
- Filter or sanitize the text
- Reject payloads with tool-call markup patterns

---

## 3. Scope: Affected Reply Types

**All text reply paths are affected.** The deliver callback routes to three actions based on `eventType`, and all three send `payload.text` without sanitization:

| Event type | Action | Affected? |
|---|---|---|
| `owner_message` | `owner_reply` | Yes — sends `text` as `message` field |
| `dm_message` | `dm_reply` | Yes — sends `text` as `message` field |
| Everything else | `speak` | Yes — sends `text` as `text` field |

The `outbound.sendText` path (`src/index.ts:120-135`) is also unprotected — it sends `ctx.text` directly as an `AgentReply` with no sanitization. However, this path is used for proactive outbound messages and may not be triggered by the same flow.

---

## 4. Recommendation (Do Not Implement)

### A. Immediate fix: Add `info.kind` filtering in deliver callback

Update the deliver callback signature to accept the `info` parameter and skip tool-result payloads:

```ts
deliver: async (payload: ReplyPayload, info: { kind: ReplyDispatchKind }) => {
  if (info.kind === 'tool') return; // tool results should not be sent to city
  const text = payload.text;
  if (!text) return;
  // ... rest of delivery logic
}
```

### B. Defense-in-depth: Strip known tool-call markup patterns

Add a sanitization step before sending any text to the city:

```ts
function stripToolCallMarkup(text: string): string {
  // Strip PLHD-wrapped tool calls: <PLHD>...<PLHD> or <PLHD20>...<PLHD21> etc.
  let cleaned = text.replace(/<PLHD\d*>[\s\S]*?<PLHD\d*>/g, '').trim();
  // Strip downgraded tool call text: [Tool Call: ...] blocks
  cleaned = cleaned.replace(/\[Tool (?:Call|Result)[^\]]*\][\s\S]*?(?=\[Tool |\n\n|$)/gi, '').trim();
  return cleaned;
}
```

Apply this in the deliver callback before sending.

### C. Upstream: Report PLHD gap to OpenClaw SDK

The SDK's `sanitizeUserFacingText()` should be extended to strip `<PLHD>` tags, similar to how it already strips `<final>`, `[Tool Call:]`, and `<minimax:tool_call>` patterns. This is an SDK-level bug — channel plugins should not need to independently sanitize tool-call markup.

### D. Investigate city context injection point

Consider whether the city context should be injected via `replyOptions` or a system-level context mechanism rather than prepending to `Body`. Prepending to `Body` means:
- The LLM sees it as part of the "user message", which may cause unexpected response formatting
- It inflates the user message, potentially exceeding context limits
- It's included in `RawBody` and `CommandBody` which may affect command parsing

A cleaner approach would be to use `BodyForAgent` or a dedicated context field that the SDK injects at the system/context level rather than inline in the user message.

### E. Version alignment

Verify the OpenClaw SDK version on the Pi (`2026.2.17+`) matches what's tested locally (`2026.2.15`). Run `openclaw --version` on the Pi and update the local `node_modules` to match, then test whether the PLHD leak reproduces with the exact same SDK version.
