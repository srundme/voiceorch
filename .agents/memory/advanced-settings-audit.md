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
