# VoiceOrch — LLM Model Compatibility Inventory

**Generated:** July 3, 2026 · **Scope:** read-only audit of all LLM adapters (`artifacts/api-server/src/orchestration/adapters/llm/`), the dashboard model catalog (`artifacts/dashboard/src/lib/agent-providers.ts`), API contract, and managed/BYOP model resolution. No code was changed.

**Labels:** `[confirmed]` = verified in source with file+line citation. `[uncertain]` = inferred or dependent on external provider behavior not verifiable from this codebase.

---

## How model resolution works (summary)

- **Adapter dispatch** — `createLLMAdapter()` switches on lowercased provider string: `openai`, `groq`, `google`, `gemini`, `sarvam`, `deepseek`, `anthropic`/`claude`, `mistral`, `cohere`, `qwen`, `ultravox`; unknown providers throw. `[confirmed]` index.ts:26–55
- **⚠ Notable quirk:** provider string `"gemini"` dispatches to **QwenLLM** (Groq-hosted Qwen), *not* GoogleLLM — only `"google"` reaches the Gemini adapter. An agent stored with provider `gemini` and model `gemini-2.5-flash` would send that model ID to Groq's endpoint and fail. `[confirmed]` index.ts:31–34
- **Dashboard exposes only 5 LLM providers**: openai, google, qwen, groq, sarvam (`LLM_PROVIDERS`). Anthropic, Mistral, Cohere, DeepSeek, and Ultravox exist backend-only and are reachable via the API (the OpenAPI `llmProvider` field is a free string; `llmModel` is a free string/null — no enum). `[confirmed]` agent-providers.ts:6–12; openapi.yaml:7022–7026, 7219–7223
- **UI model validation** — `getModelError()` rejects a model not in the catalog *only when the provider has a catalog entry*; empty model is always allowed (falls back to adapter default). Enforced in the agent form via Zod superRefine. `[confirmed]` agent-providers.ts:144–154; edit.schema.ts
- **Tamil auto-remap (UI only)** — selecting a Tamil language in the builder/edit form force-sets provider to `google` and model to `defaultGeminiModel()` = first google catalog entry = `gemini-2.5-flash-lite`. `[confirmed]` builder.tsx:577–580; edit.tsx:801–803; agent-providers.ts:403–404
- **Managed vs BYOP: no model gating** — managed-plan resolution substitutes *keys only* (`platform_settings` managed keys); the agent's chosen provider/model is used unchanged for the live call. `[confirmed]` session.ts:713–794, pipeline.ts:765
- **Managed key coverage gap** — managed key mapping covers only qwen/groq (`managed_qwen_key`), google/gemini (`managed_gemini_key`), openai (`managed_openai_key`), sarvam (`managed_sarvam_key`) (plus ASR/TTS providers). **Anthropic, Mistral, Cohere, DeepSeek, Ultravox have no managed key** — a managed-plan agent configured with them fails at call setup ("No API key found for LLM provider"). `[confirmed]` session.ts:723–734; pipeline.ts:752–753
- **Post-call managed fallback** — when the user has no BYOP LLM key, post-call features (context extraction, summary, memory) force provider=`groq`, model=`llama-3.3-70b-versatile` with the `managed_qwen_key`. `[confirmed]` session.ts:1839–1844, 2122–2126, 2298–2303
- **Fallback LLM** — agents may configure `fallbackLlmProvider`/`fallbackLlmModel`; the fallback adapter is built with the same generation params and fires only when the primary throws before its first token. `[confirmed]` pipeline.ts:767–772
- **Stub mode** — `STUB_PROVIDERS_ENABLED` replaces every adapter with a stub. `[confirmed]` index.ts:25
- **Ancillary hardcoded models** — disposition classification defaults: gpt-4o-mini / qwen/qwen3-32b / sarvam-30b (disposition-llm.ts:37, 70, 104); prompt-template generation uses `qwen/qwen3-32b` (prompt-template.ts:234); admin deployment check uses `llama-3.3-70b-versatile` (admin-deployments.ts:329). `[confirmed]`
- **Pricing** — no per-model cost constants exist anywhere in the adapters; billing is per-minute ($0.05 managed / $0.035 BYOP, resolved at call end). Cost hints appear only as qualitative dashboard label text (e.g. "ultra-fast, lowest cost"). `[confirmed]` agent-providers.ts:36–37

**Max Output Tokens legend:** most adapters send no `max_tokens` (provider API default applies). Groq, Qwen, and Sarvam pass the agent's `llmGenerationParams.maxTokens` when set. Anthropic hardcodes 1024.

---

## OpenAI (`openai.ts`) — dashboard-selectable

Endpoint: api.openai.com (SDK default). Temperature clamp 0–2 `[confirmed]` openai.ts:18. `max_tokens` never sent — `genParams.maxTokens` is ignored by this adapter `[confirmed]` openai.ts:43–53. Tools: `tool_choice: "auto"` for all models `[confirmed]` openai.ts:51.

| Model ID | Default? | Tool Calling | Streaming | Max Output Tokens | Known Quirks |
|---|---|---|---|---|---|
| gpt-4o-mini | **Yes** `[confirmed]` openai.ts:16 | Yes (auto) `[confirmed]` :51 | Yes (SSE) `[confirmed]` :45 | Not set (API default) `[confirmed]` | — |
| gpt-4.1-nano / gpt-4.1-mini / gpt-4.1 | No — dashboard options `[confirmed]` agent-providers.ts:36–38 | Yes `[uncertain]` (adapter attaches tools to any model) | Yes | Not set | Not listed in adapter header comment (only 4o/4-turbo/3.5 are) `[confirmed]` openai.ts:7 |
| gpt-4o | No `[confirmed]` agent-providers.ts:40 | Yes | Yes | Not set | — |
| o4-mini | No — dashboard option `[confirmed]` agent-providers.ts:41 | Yes `[uncertain]` | Yes `[uncertain]` | Not set | `[uncertain]` o-series models reject the `temperature` param upstream; the adapter sends temperature whenever the agent sets one, which may 400 on this model |
| gpt-4-turbo, gpt-3.5-turbo (legacy) | No `[confirmed]` agent-providers.ts:42–43 | Yes | Yes | Not set | Labeled legacy in dashboard |

Any other model string is possible via API (no server-side catalog check) and passed through verbatim. `[confirmed]` openapi.yaml:7025–7026

---

## Groq (`groq.ts`) — dashboard-selectable

Endpoint: api.groq.com/openai/v1 `[confirmed]` groq.ts:77. `service_tier: "on_demand"` always `[confirmed]` :122. Temperature clamp 0–2 `[confirmed]` :82. `max_tokens` from `llmGenerationParams.maxTokens` when set `[confirmed]` :80, :128. Deprecated-model remap table `GROQ_MODEL_REPLACEMENTS` `[confirmed]` :25–36. `tool_choice: "required"` forced when scheduling tools are present, else "auto" `[confirmed]` :55–61 + chat body.

| Model ID | Default? | Tool Calling | Streaming | Max Output Tokens | Known Quirks |
|---|---|---|---|---|---|
| llama-3.3-70b-versatile | **Yes** `[confirmed]` groq.ts:43 | Yes `[confirmed]` :46–53 | Yes | genParams or API default | Also the hardwired post-call managed-fallback model `[confirmed]` session.ts:1843 |
| llama-3.1-8b-instant | No `[confirmed]` agent-providers.ts:47 | Yes `[confirmed]` :48 | Yes | genParams or API default | Adapter comment recommends it for lowest TTFT `[confirmed]` :40–41 |
| gemma2-9b-it | No — dashboard option `[confirmed]` agent-providers.ts:47 | **No — tools stripped with warn log** `[confirmed]` groq.ts:22, 96–100 | Yes | genParams or API default | Dashboard offers it but agents with scheduling/transfer tools silently lose tool use |
| llama3-groq-70b/8b-8192-tool-use-preview | No | Yes `[confirmed]` :49–50 | Yes | genParams or API default | Preview models; not in dashboard; `[uncertain]` may be retired by Groq |
| qwen/qwen3-32b, qwen/qwen3-235b-a22b | No | Yes `[confirmed]` :51–52 | Yes | genParams or API default | Reachable here too (same host as Qwen adapter) |

Remaps (silent, at construction): mixtral-8x7b-32768 → llama-3.3-70b-versatile; llama2-70b-4096 → llama-3.3-70b-versatile; llama-3.1-70b-versatile → llama-3.3-70b-versatile; llama3-8b-8192 → llama-3.1-8b-instant; llama-3-8b → llama-3.1-8b-instant; qwen3-32b → qwen/qwen3-32b; qwen3-235b → qwen/qwen3-235b-a22b. `[confirmed]` groq.ts:25–36

---

## Google Gemini (`google.ts`) — dashboard-selectable

Only reachable via provider string `"google"` (`"gemini"` misroutes to Qwen — see summary). Thinking disabled: `thinkingBudget: 0, includeThoughts: false` `[confirmed]` google.ts:165–168. Temperature clamp 0–2. No `max_tokens` sent `[confirmed]` google.ts:159–169 (generationConfig carries only thinkingConfig + temperature).

| Model ID | Default? | Tool Calling | Streaming | Max Output Tokens | Known Quirks |
|---|---|---|---|---|---|
| gemini-2.5-flash | **Yes** `[confirmed]` google.ts:115 | Yes (all 1.5+/2.x) `[confirmed]` :102 | Yes | Not set (API default) | 2.5-series preamble guard against thinking-style prefixes `[confirmed]` (adapter body) |
| gemini-2.5-flash-lite | No — but auto-selected for Tamil agents `[confirmed]` agent-providers.ts:404; builder.tsx:577–580 | Yes | Yes | Not set | Tamil UI remap target |
| gemini-2.5-pro | No `[confirmed]` agent-providers.ts:45 | Yes | Yes | Not set | `[uncertain]` higher TTFT; adapter's thinkingBudget:0 may be ignored by pro upstream |
| gemini-1.5-flash | No `[confirmed]` agent-providers.ts:45 | Yes `[confirmed]` :102 | Yes | Not set | Legacy generation |

Quirk: function calls arrive at end-of-stream (Gemini FunctionDeclaration format, uppercase types) rather than token-deltas. `[confirmed]` google.ts:103

---

## Qwen via Groq (`qwen.ts`) — dashboard-selectable

Endpoint: api.groq.com/openai/v1 `[confirmed]` qwen.ts:42. `/no_think` prepended to the system prompt to disable Qwen3 reasoning `[confirmed]` :85. `service_tier: "on_demand"` `[confirmed]` :93. Temperature clamp 0–2; `max_tokens` from genParams `[confirmed]` :45, :95. `tool_choice: "required"` for scheduling tools `[confirmed]` :25–31, :79.

| Model ID | Default? | Tool Calling | Streaming | Max Output Tokens | Known Quirks |
|---|---|---|---|---|---|
| qwen/qwen3-32b | **Yes** `[confirmed]` qwen.ts:13 | Yes `[confirmed]` :16–19 | Yes | genParams or API default | Also the prompt-template + disposition default model `[confirmed]` prompt-template.ts:234, disposition-llm.ts:70 |
| qwen/qwen3-235b-a22b | No `[confirmed]` agent-providers.ts:46 | Yes `[confirmed]` :18 | Yes | genParams or API default | — |
| any other model string | — | **No — tools silently omitted** (no warn log, unlike Groq/Ultravox) `[confirmed]` qwen.ts:61–71 | Yes | genParams or API default | Silent tool loss is a trap for API-created agents |

Note: agents stored with provider `"gemini"` also land in this adapter with their Gemini model ID intact → guaranteed upstream model-not-found error. `[confirmed]` index.ts:33–34

---

## Sarvam (`sarvam.ts`) — dashboard-selectable

Custom SSE client (not OpenAI SDK). Temperature clamp 0–2; `max_tokens` from genParams `[confirmed]` sarvam.ts:295–299. `reasoning_effort` defaults to null (thinking off); on tool turns it is bumped: sarvam-105b → "low", sarvam-30b → "medium" `[confirmed]` :354–356.

| Model ID | Default? | Tool Calling | Streaming | Max Output Tokens | Known Quirks |
|---|---|---|---|---|---|
| sarvam-30b | **Yes** (default + alias target) `[confirmed]` sarvam.ts:272–279 | Yes `[confirmed]` :68 | Yes (SSE) | genParams or API default | 64K context (adapter comment) `[confirmed]` :25; disposition default `[confirmed]` disposition-llm.ts:104 |
| sarvam-105b | No `[confirmed]` agent-providers.ts:48 | Yes `[confirmed]` :68 | Yes | genParams or API default | 128K context (adapter comment) `[confirmed]` :26 |
| sarvam-m, sarvam-2b, sarvam-2b-v0.5, sarvam-m1 | — | (as sarvam-30b) | Yes | — | **Silently aliased → sarvam-30b** `[confirmed]` sarvam.ts:272–277 |

Provider-wide quirk: streaming tool calls are unreliable upstream — the adapter handles **three** emission formats: (1) structured `delta.tool_calls`; (2) tool call serialized as JSON/backtick/bracket text in `delta.content` (buffer-and-sniff, resolved via `parseToolEnvelope`); (3) trailing `<function>name</function>` tag after conversational text. All three fire `onToolCall` without leaking to TTS. `[confirmed]` sarvam.ts:500–635. Diagnostic flag `SARVAM_RAW_SSE_DEBUG` logs format-2 occurrences. `[confirmed]` :579–598

---

## Anthropic (`anthropic.ts`) — backend-only (not in dashboard dropdown)

Provider strings `anthropic` and `claude` `[confirmed]` index.ts:39–41. Temperature clamp 0–1. Prompt-caching beta header used.

| Model ID | Default? | Tool Calling | Streaming | Max Output Tokens | Known Quirks |
|---|---|---|---|---|---|
| claude-3-5-haiku-20241022 | **Yes** `[confirmed]` anthropic.ts:48 | Yes `[confirmed]` (adapter attaches tools) | Yes | **1024 — hardcoded, provider-wide** `[confirmed]` anthropic.ts:90; `genParams.maxTokens` ignored | Long replies get truncated at 1024 output tokens regardless of agent settings |
| claude-opus-4-5, claude-3-5-sonnet-20241022 | No — header comment only `[confirmed]` anthropic.ts:44 | Yes | Yes | 1024 hardcoded | Same 1024 cap |

No managed key mapping → unusable on the managed plan. `[confirmed]` session.ts:723–734

---

## Mistral (`mistral.ts`) — backend-only

OpenAI-compatible, api.mistral.ai/v1 `[confirmed]` mistral.ts:21. Temperature clamped to **0–1.5** `[confirmed]` :24. No `max_tokens` sent `[confirmed]` :45–55.

| Model ID | Default? | Tool Calling | Streaming | Max Output Tokens | Known Quirks |
|---|---|---|---|---|---|
| mistral-small-latest | **Yes** `[confirmed]` mistral.ts:11 | Yes (auto) `[confirmed]` :53 | Yes | Not set | — |
| mistral-large-latest, open-mixtral-8x7b, codestral-latest | No — header comment only `[confirmed]` :7 | Yes `[uncertain]` per model | Yes | Not set | `[uncertain]` open-mixtral-8x7b tool support upstream |

No managed key; not in dashboard; no catalog → any model string passes UI validation if set via API. `[confirmed]`

---

## Cohere (`cohere.ts`) — backend-only

OpenAI-compat endpoint api.cohere.com/compatibility/v1 `[confirmed]` cohere.ts:23. Temperature clamped to **0–1** `[confirmed]` :27. No `max_tokens` sent `[confirmed]` :48–58.

| Model ID | Default? | Tool Calling | Streaming | Max Output Tokens | Known Quirks |
|---|---|---|---|---|---|
| command-r-plus-08-2024 | **Yes** `[confirmed]` cohere.ts:11 | Yes (auto) `[confirmed]` :56 | Yes | Not set | — |
| command-r-08-2024, command-r, command-r-plus | No — header comment only `[confirmed]` :7 | Yes `[uncertain]` | Yes | Not set | — |

No managed key; not in dashboard.

---

## DeepSeek (`deepseek.ts`) — backend-only

OpenAI-compatible, api.deepseek.com `[confirmed]` deepseek.ts:19. Temperature clamp 0–2 `[confirmed]` :22. No `max_tokens` sent.

| Model ID | Default? | Tool Calling | Streaming | Max Output Tokens | Known Quirks |
|---|---|---|---|---|---|
| deepseek-chat (V3) | **Yes** `[confirmed]` deepseek.ts:11 | Yes (auto) `[confirmed]` :51 | Yes | Not set | — |
| deepseek-reasoner (R1) | No — header comment only `[confirmed]` :7 | `[uncertain]` — upstream R1 historically rejects tools/temperature | Yes | Not set | `[uncertain]` reasoning latency likely unsuitable for voice turns |

No managed key; not in dashboard.

---

## Ultravox (`ultravox.ts`) — backend-only

Default endpoint api.ultravox.ai, self-hosted vLLM via custom `baseUrl` `[confirmed]` ultravox.ts:17, 24–33; index.ts:48–52. Auth: X-API-Key + Bearer both sent `[confirmed]` :29–32. Receives **no generation params at all** (temperature/maxTokens intentionally out of scope) `[confirmed]` index.ts:49–52. No `stream_options` usage; tool/system turns filtered to user/assistant only `[confirmed]` :60–65.

| Model ID | Default? | Tool Calling | Streaming | Max Output Tokens | Known Quirks |
|---|---|---|---|---|---|
| ultravox-v0.6-gemma3-27b | **Yes** `[confirmed]` ultravox.ts:18 | **No — tools stripped with warn log (provider-wide)** `[confirmed]` :14, 48–55 | Yes | Not set | Scheduling/transfer tools never fire on Ultravox agents |
| ultravox-v0.4_1-llama-3_1-8b | No — header comment only `[confirmed]` :7 | No | Yes | Not set | — |

No managed key; not in dashboard.

---

## Cross-cutting risk notes

1. **`"gemini"` → QwenLLM misroute** is the single most surprising dispatch behavior; any legacy/API-created agent with that provider string breaks. `[confirmed]` index.ts:33–34
2. **Silent tool stripping differs by adapter**: Groq and Ultravox log a warning; Qwen strips silently for non-catalog models. `[confirmed]` groq.ts:96–103, ultravox.ts:48–55, qwen.ts:61–71
3. **Anthropic's hardcoded 1024 max_tokens** is the only output cap in the fleet that ignores agent settings. `[confirmed]` anthropic.ts:90
4. **gemma2-9b-it is dashboard-selectable but tool-incapable** — an agent with booking tools on this model degrades silently at runtime (warn log only). `[confirmed]` agent-providers.ts:47; groq.ts:22
5. **Server accepts arbitrary model IDs** — model catalog enforcement is client-side only (`getModelError` + Zod in the form); the OpenAPI contract types `llmModel` as a free string. `[confirmed]` openapi.yaml:7025–7026
