---
name: Sarvam LLM Chat Completions API quirks
description: External-API behavior for Sarvam's OpenAI-compatible chat endpoint — thinking mode, usage chunk, streaming framing
---

# Sarvam LLM (Chat Completions) API quirks

Endpoint: `POST https://api.sarvam.ai/v1/chat/completions`, auth header
`api-subscription-key` (also accepts `Authorization: Bearer`). OpenAI-compatible
wire format. Current models: `sarvam-30b` (64K ctx, lower latency — best for
voice) and `sarvam-105b` (128K ctx, higher quality). `sarvam-m` (24B) is
deprecated/removed.

## Hybrid Thinking mode is ON by default
- Default `reasoning_effort` is `"low"` — thinking is enabled unless you turn it off.
- When on, the model streams `delta.reasoning_content` (thinking) BEFORE
  `delta.content` (reply). Reasoning tokens are billed as completion tokens and
  add latency before the first spoken word.
- **Trap:** with thinking on, a low `max_tokens` can be fully consumed by
  reasoning → `finish_reason:"length"` with empty `content`.
- **For voice, disable it:** send `reasoning_effort: null` in the JSON body
  (documented way; `null` is accepted, low 422 risk). String values
  `low|medium|high` keep it on. Omitting the field leaves it ON.
- **Why:** VoiceOrch is latency-sensitive; thinking chains hurt TTFT and cost.
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

## Other
- Strict user/assistant alternation starting with a user turn — merge consecutive
  same-role turns and drop leading assistant turns before sending.
- Tool calling supported on both models (OpenAI format: name + stringified JSON args).
- `temperature` defaults to 0.2 when reasoning disabled, 0.5 when enabled (range 0–2).
