---
name: Krutrim Cloud LLM integration
description: Real model catalogue, API key format, streaming quirks for cloud.olakrutrim.com
---

## Working API endpoint
`https://cloud.olakrutrim.com/v1/chat/completions`
Auth: `Authorization: Bearer <key>`
Key format: 40-char alphanumeric (NOT a JWT, NOT a session cookie)

## Live model catalogue (GET /v1/models — verified 2026-07-09)
- `gpt-oss-20b` — Krutrim proprietary 20B, tool-capable; **colloquial Tamil quality is poor** — do NOT use for Tamil voice agents; use gemma-4-E4B-it instead
- `gpt-oss-120b` — Krutrim proprietary 120B, tool-capable
- `gemma-4-E4B-it` — Gemma 4 4B MoE
- `gemma-4-31b-it` — Gemma 4 31B
- `gemma-4-26B-A4B-it` — Gemma 4 26B MoE, 262k ctx
- `Qwen3.5-9B` — thinking model, needs maxTokens ≥ 500
- `Qwen3.6-27B` — thinking model, needs maxTokens ≥ 500
- `Qwen3.6-35B-A3B` — MoE thinking model, needs maxTokens ≥ 500

**Old model names that DON'T exist:** Qwen3-30B-A3B, Qwen3-32B, Llama-3.3-70B-Instruct, Krutrim-1/2, chitrapathak, Mistral-7B-v0.2

## Streaming quirk (gpt-oss-20b)
- Thinking tokens come in `delta.reasoning` / `delta.reasoning_content` — our adapter ignores these (reads only `delta.content`)
- Actual content comes in `delta.content` at the end of the stream
- This is correct behavior — no adapter change needed
- 250 max_tokens default is fine (34 tokens used for "hi" response)

## "Session Expired" 401 cause
The OLD key (40-char, prefix `tLHMUF2o`) was being rejected by Krutrim with "Session Expired". New key (prefix `mXm8L1gF`) works. Key from KMS → Model tab; generate fresh if you see this error.
