---
name: Mic Sensitivity default must feed bargeInEnergyThreshold
description: A per-agent sensitivity tier whose thresholds are only wired into gate/VAD paths silently leaves barge-in unaffected if the barge-in field has its own hardcoded fallback.
---

When adding a tiered sensitivity/quality setting (e.g. Low/Normal/High) that is meant to scale several independent thresholds (noise gate ratio, VAD threshold, barge-in energy threshold, AEC threshold), audit EVERY consumer of each threshold for a pre-existing hardcoded `?? <constant>` fallback that bypasses the new tier resolution.

**Why:** In VoiceOrch's Mic Sensitivity feature, `bargeInEnergyThreshold` already existed as an independently-configurable field defaulting to `?? 1200` in `session.ts`. Wiring the new sensitivity thresholds into the noise-gate/VAD paths worked correctly, but the barge-in default still resolved via the old hardcoded `1200` fallback — so choosing "Low" or "High" sensitivity silently had zero effect on barge-in behavior while looking fully wired (types, UI, pipeline all compiled and appeared connected).

**How to apply:** After threading a new default-resolution function through a pipeline, grep every existing field that the new tiers are supposed to influence for its OLD hardcoded default, and make sure the new tier's resolved value is used as the fallback for any field the user did NOT explicitly override — explicit user overrides should still win.
