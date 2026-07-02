---
name: Advanced Settings end-to-end audit
description: Full field-name/default-value map for Agent Builder Advanced Settings (Pipeline Latency, Response Timing, Interruption Control, Auto-Redial, Call Limits) and known cross-setting interactions.
---

Full audit is written up in `docs/advanced-call-settings-report.md` (durable
reference doc, not memory — read that file for the complete per-control
breakdown and the "do these conflict" analysis).

## Key durable facts worth remembering here

- **STT Endpointing Silence (`asrEndpointingSilenceMs`) default raised 100ms → 300ms** (July 2026) after a user reported the STT cutting them off mid-sentence. Changed in 4 places that must stay in sync: `orchestration/session.ts` (runtime fallback — this is the one that actually matters for agents with no explicit value stored), `dashboard/pages/agents/{edit,builder}.tsx` (form defaults + the "changed from default" sentinel check used when building the save payload), and `admin/pages/admin-agent-edit.tsx` (same pattern). All 4 must be updated together or the UI/runtime defaults silently diverge again.
  - **Why 300ms:** it's the single primary latency lever for this symptom (endpointing silence, not Response Timing or Post-Transcript Buffer, which are separate additive delays — see the report's §6.2). Response Timing's four delays are capped at 300ms combined by the pipeline itself, so raising those has limited effect vs. raising endpointing silence directly.
- **Silence Timeout / Max Call Duration do NOT trigger Auto-Redial.** Verified in code: both route through `onCallEnd()`/`endSession()` which sets `naturalEndTriggered = true`; Auto-Redial's `wasUnexpectedDrop` check requires `naturalEndTriggered === false`. Safe to combine aggressively-tuned Call Limits with Auto-Redial enabled.
- **Allow Barge-in is a master switch** — when off, Min Words/Min Voice Duration/Back-off Silence/Energy Threshold are all inert. Don't assume a barge-in tuning change did anything without checking this toggle first.
- **Response Timing (`startSpeakingPlan`) defaults unified to `waitSeconds=0, onPunctuationSeconds=0.1, onNoPunctuationSeconds=1.5, onNumberSeconds=0.5`** (July 2026), matching values the admin panel already used. Pipeline logic is `if/else if/else` on the transcript's last char (punctuation OR digit OR neither — never additive) plus `waitSeconds`, then hard-capped at 300ms — so the 1.5/0.5 values are intentionally above the cap (they just saturate it); only `onPunctuationSeconds` actually matters at its literal value. Same 4-file sync rule as endpointing silence applies, incl. the `session.ts` runtime fallback (was `?? null` — i.e. NO delay at all for agents with no saved plan — now defaults to the object above).
- **Post-Transcript Buffer (`incrementalDelay`) and LLM Max Output Tokens were deliberately left at their existing defaults (0 / auto)** when doing this pass — Post-Transcript Buffer applies unconditionally to every turn (unlike Response Timing's per-turn conditional delay) so raising it stacks latency on already-clear turns too; a token cap risks silently truncating legitimate longer replies. Don't add these to a "best defaults" pass without discussing the tradeoff with the user first.
