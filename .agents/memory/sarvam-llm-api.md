---
name: Sarvam LLM Chat Completions API quirks
description: External-API behavior for Sarvam's OpenAI-compatible chat endpoint — thinking mode, usage chunk, streaming framing
---

# Sarvam LLM (Chat Completions) API quirks

Endpoint: `POST https://api.sarvam.ai/v1/chat/completions`. Auth: send both
`api-subscription-key` and `Authorization: Bearer <key>` (docs list both).
OpenAI-compatible wire format.

**/v1 serves only** `sarvam-105b` (reasoning / agentic) and
`sarvam-105b-conversations` (voice / dialogue). Open-source hosts (`gemma4`,
`glm5.2`) use `POST /v2/chat/completions`.

## Hybrid Thinking mode is ON by default
- Default `reasoning_effort` is **`"medium"`** (API reference 2026-08) — thinking
  is enabled unless you turn it off. Older docs said `"low"`; treat medium as current.
- When on, the model streams `delta.reasoning_content` (thinking) BEFORE
  `delta.content` (reply). Reasoning tokens are billed as completion tokens and
  add latency before the first spoken word.
- **Trap:** with thinking on, a low `max_tokens` can be fully consumed by
  reasoning → `finish_reason:"length"` with empty `content`.
- **For voice (no tools), disable it:** send `reasoning_effort: null` in the JSON
  body (documented way; `null` is accepted). String values `low|medium|high` keep
  it on. **Omitting the field leaves it ON at medium.**
- **For voice WITH tools:** bump to at least `"low"` — with effort null, Sarvam
  ignores tools and stays conversational.
- Never forward `reasoning_content` to TTS even if it appears — only speak `delta.content`.

## Usage is in the final streaming chunk
- The final SSE event has `choices: []` and carries
  `usage: { prompt_tokens, completion_tokens, total_tokens }`, then `data: [DONE]`.
- Read `parsed.usage` BEFORE indexing `parsed.choices[0]?.delta` (which is undefined on that chunk).
- Usage arrives by default — do NOT add `stream_options:{include_usage:true}`
  (not in Sarvam docs; risks a 422 from an unrecognized param).

## SSE framing must be parsed with a buffered reader
- Events can split across TCP reads. A naive `decoder.decode(value).split("\n")`
  per `reader.read()` can drop reply tokens, partial tool-call args, or the final
  usage chunk when a `data:` line straddles a chunk boundary.
- **How to apply:** accumulate decoded text into a buffer, dispatch only complete
  `\n`-terminated lines, keep the remainder for the next read, and flush the
  trailing line after the stream ends. (qwen/openai adapters avoid this by using
  the OpenAI SDK async iterator; the Sarvam adapter uses raw fetch so it must
  buffer itself.)

## Generation params — send only-when-defined
- Documented body fields: `temperature` (0–2, default **0.2**), `top_p` (0–1,
  default 1), `max_tokens` (default **2048**), `presence_penalty`/
  `frequency_penalty` (−2..2, default 0), `seed` (int), `stop` (string or ≤4
  strings), `wiki_grounding` (bool RAG), `reasoning_effort` (low|medium|high|
  null — default **medium**), `messages`, `tools`, `tool_choice`,
  `response_format`.
- **Rule:** omit any param the agent hasn't explicitly set so Sarvam applies its
  own default. In particular, build `temperature` from the RAW DB value, NOT a
  coerced `?? 0.5` fallback, or you silently override Sarvam's 0.2 default.
- **Why:** the orchestration `AgentConfig.temperature` is `?? 0.5`-coerced for
  legacy callers; reusing it for the request body changes model behavior for
  every agent that never picked a temperature.
- `reasoning_effort` is the one field always sent on native /v1 models (defaults
  to `null` for voice); see the Hybrid Thinking section above.
- The adapter carries these via a nested `llmGenerationParams` on AgentConfig and
  is the ONLY adapter that consumes them; other providers ignore the 5th
  `createLLMAdapter` arg.

## Tool calling REQUIRES reasoning — confirmed behavior table
| reasoning_effort | Tool calls fired? | Confirmation loop? | Notes |
|---|---|---|---|
| null | ❌ never | n/a | Defaults to conversational text, ignores tools entirely |
| low | ✅ sometimes | ✅ still confirms | Engages with tools but summarises + asks "is that ok?" before calling |
| medium | ✅ more reliable | ⚠️ partially | Better instruction-following; still not 100% — open problem |

Current code: auto-bump `null`→`low` when `hasTools` (both `sarvam-105b` and
`sarvam-105b-conversations`), inject [TOOL GUIDANCE] numbered rules.
Gemini/OpenAI unaffected (no thinking mode, tool_choice:auto works fine).
**TODO: explore `tool_choice:"required"` or a post-response forced-call pattern for cases where medium still confirms.**

## `<|message|>` and other special tokens leak into delta.content when reasoning is on
- When `reasoning_effort` is `"low"/"medium"/"high"`, Sarvam leaks internal thinking
  delimiter tokens (`<|message|>`, `<|thinking|>`, `<|endofthinking|>`, etc.) into
  `delta.content`. These must be stripped before forwarding to TTS.
- **Fix in sarvam.ts:** `token.replace(/<\|(?:message|thinking|endofthinking|endofmessage|im_start|im_end)\|>/g, "")` applied to every content token.

## Tool call streaming is UNRELIABLE — THREE shapes, must handle all
Sarvam's `stream:true` tool calling is inconsistent. The SAME agent/model emits a
tool call one of three ways across calls:
1. **Structured (primary):** `delta.tool_calls[0]={index,id,function:{name,arguments:""}}`
   first, then argument fragment chunks, `finish_reason:"tool_calls"`, usage chunk, `[DONE]`.
2. **Serialized JSON text:** the WHOLE tool call arrives as a plain-text JSON
   blob inside `delta.content`, e.g. `{ "name":"transfer_to_human", "arguments":{...} }`
   (optionally inside a ```json fence). NO `delta.tool_calls` at all.
3. **Bracket / key-value text:** the tool arrives as a bracket envelope in
   `delta.content`, e.g. `[transfer_to_human]\nreason: <text>` (the bracketed
   token is the tool name; following `key: value` / `key = value` lines are args;
   a bare `[tool]\n<free text>` puts the residual under `reason`). NO
   `delta.tool_calls`. Confirmed in prod: this fell through to TTS and the call
   ended in silence because the bracket form was never parsed (only JSON was).
- **Why this matters:** if you only route on `delta.tool_calls` (or only sniff JSON),
  shapes #2/#3 fall through to the text path — the caller HEARS the envelope or the
  transfer never dispatches.
- **How to apply (in sarvam.ts):**
  - Structured path: accumulate `delta.tool_calls` into `Map<index,{id,name,args}>`; ignore
    any content once a tool delta has been seen.
  - Text fallback (tools-enabled turns only): buffer-and-sniff. If the FIRST
    non-whitespace `delta.content` begins with `{`, `` ` `` (fence), **or `[`**,
    WITHHOLD all content from onToken/TTS and accumulate it; at end-of-stream resolve via
    the unified `parseToolEnvelope(raw, validNames)` (tries JSON then bracket) → `onToolCall`
    on success, else `onDone(buffer)` so genuine text is never dropped.
  - **Validate the parsed name against the tools offered this turn** (`validNames =
    new Set(options.tools.map(t=>t.name))`) so ordinary text that merely starts with
    `{`/`[` (e.g. `[laughs]`) is NOT misfired as a tool — it streams as text instead.
  - Replies NOT starting with `{`/fence/`[` stream normally (TTFT preserved). Fire exactly
    one terminal callback.
- **Defense-in-depth (pipeline.ts):** a `makeToolEnvelopeGuard(validToolNames)` sits after
  the bracket filter in BOTH onToken chains (main turn + continueWithToolResult). If ANY
  adapter still leaks an envelope to onToken, the guard withholds it from TTS and logs a
  "Tool Envelope Suppressed" row — a tool call is never spoken aloud regardless of adapter.
- **Execution-log markers** (Call Logs visibility): adapter fires `onToolDetected{format}` +
  `onToolParsed{name,format,args}`; pipeline logs Tool Detected → Tool Parsed → onToolCall
  Invoked → Tool Executed; session.ts onCallTransfer logs Transfer Started → Transfer
  Completed/Failed. `ExecStatus` has no "warning" — use `status:"info"` + `warningFlags:[...]`.

## Other
- Strict user/assistant alternation starting with a user turn — merge consecutive
  same-role turns and drop leading assistant turns before sending.
- `temperature` defaults to 0.2 (API); older notes said 0.5 when reasoning enabled.
