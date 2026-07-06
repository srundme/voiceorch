---
name: TTS speed control field (ttsSpeed)
description: Cartesia/ElevenLabs playback speed is controlled by agentConfig.ttsSpeed; docs had described this field before it was wired end-to-end.
---

`agentConfig.ttsSpeed` (default 1.0) now flows schema → `session.ts` → `createTTSAdapter()` → provider adapter, and is applied as `voice.__experimental_controls.speed` (Cartesia, clamp 0.5–2) or `voice_settings.speed` (ElevenLabs, clamp 0.7–1.2). UI range exposed to users is narrower (0.7–1.5) across dashboard (`edit.tsx`/`edit.schema.ts`/`builder.tsx`) and admin (`admin-agent-edit.tsx`).

**Why:** perceived "TTS is slow to read replies" was NOT a first-byte-latency problem (Cartesia TTFB was ~260ms) — it was normal playback duration at default speed, because no speed param was ever sent to the provider. The dashboard's own docs page already described a speed control as if it existed, but no code path ever set it — always verify a documented config field is actually wired before assuming a described feature works.

**How to apply:** if a user reports "TTS feels slow" but TTFT/latency logs look fine, check whether a speed/rate control is actually being sent to the provider API, not just assumed from docs or UI copy. Also: edits to `builder.tsx` and `edit.schema.ts` in the dashboard agent form must stay in sync since `AgentFormValues` is shared across create/edit — a partial rollout of a new field mismatches types silently until `pnpm run typecheck` is run at the workspace root (per-package `tsc` in only one package can pass while another fails).
