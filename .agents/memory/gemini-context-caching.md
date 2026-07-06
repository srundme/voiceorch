---
name: Gemini explicit context caching
description: How Gemini CachedContent caching is wired for voice turns, why the cached prefix is scoped the way it is, and the free-tier limitation
---

# Gemini explicit context caching (CachedContent)

The Google LLM adapter (`orchestration/adapters/llm/google.ts`) can register the
large static system-prompt prefix as a Gemini `CachedContent` once per call so it
is not reprocessed every turn (`usage.cachedTokens>0` from turn 2, lower TTFT).

## Design (why the prefix is scoped this way)
- Cached prefix = exactly `langGuard + agent.systemPrompt + langGuard`, captured in
  `pipeline.ts` as `cacheBaseForTurn` BEFORE any per-turn volatile append.
- **`{caller_salutation}` must be resolved INSIDE the cached prefix** — resolve the
  salutation on the base BEFORE capturing `cacheBaseForTurn`, and make
  `buildCacheBase()` (the greeting-time warm) apply the same substitution.
  **Why:** `cacheEligible()` requires `systemPrompt.startsWith(cacheBase)`. If the
  base is captured with the raw `{caller_salutation}` placeholder but the later
  per-turn substitution resolves it, the prefix mutates and `startsWith` fails on
  EVERY turn for salutation-using agents → `cachedTokens` stays 0 and the whole
  latency win silently evaporates. The later full-prompt substitution is idempotent
  on the already-resolved base, so the tail (KB slice, gender directive) still
  resolves. Salutation value changes once (neutral→detected gender) → base changes
  once → one re-warm; expected.
- Everything that varies per turn stays in the **volatile tail** (prepended to the
  current user message on the cached path, NOT frozen into the cache): per-turn KB
  slice, gender salutation directive, tool guides, `[TOOL CALLING]`, and the
  per-turn `[CURRENT DATE & TIME]`.
- `buildLangGuard()` + `buildCacheBase()` in `pipeline.ts` are the SINGLE source of
  truth shared by the greeting-time warm (`greet()` → `warmContextCache`) and the
  per-turn prompt assembly. They MUST produce byte-identical output or the
  `startsWith(cacheBase)` eligibility check fails and the cache silently never
  reuses.

## Fallback is total and safe
`cacheEligible()` returns false (→ unchanged uncached path) for: any cache-create
error, a tool-result turn, a staged-prompt turn (prompt is replaced so it no longer
starts with the base), a base shorter than `GEMINI_CACHE_MIN_CHARS`, a non-gemini
model, or after caching latches off. So Tamil quality, tool calls, salutation,
language injection, and preamble stripping are unaffected on both paths.

## Free-tier gotcha (cannot validate cached path in dev)
`cachedContent.create` returns HTTP 429 `limit=0` on a **free-tier** `GEMINI_API_KEY`.
The dev key IS free-tier, so the cached GENERATION path cannot be exercised in dev —
only the fallback runs there. This is expected, logged once as
`evt: "gemini_context_cache_disabled"`, after which caching latches off for that
call. A paid key logs `evt: "gemini_context_cache_created"` and `cachedTokens>0`.
Do NOT treat the free-tier 429 as a bug.

**Why:** confirmed empirically — cache create on the dev key immediately 429s with
limit=0. Any future "caching doesn't work in dev" observation is this, not a
regression.

## Env knobs
`GEMINI_CACHE_ENABLED` (default on), `GEMINI_CACHE_MIN_CHARS` (4096),
`GEMINI_CACHE_TTL_SECONDS` (900), `GEMINI_CACHE_MAX_WARMS` (3, then latches off).
Separately, `KB_INJECT_MAX_CHARS` (default 0 = unchanged; `session.ts`) can cap the
baked KB block that goes into the cached prefix without touching live per-turn KB
retrieval.
