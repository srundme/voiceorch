---
name: Vision AI feature fully removed
description: The entire Vision agent feature (Sarvam Vision OCR, call_media, camera frames, vision agent kind) was removed in July 2026 — treat any older vision memories/code references as gone.
---

The Vision AI feature was fully removed at the user's request (July 25, 2026), pending a from-scratch rebuild.

Removed surface (do not assume any of this exists anymore):
- `analyze_document` / `analyze_image` tools, Sarvam Vision API service, `call_media` table + storage/upload routes, WhatsApp inbound-image intake, webcall `video_frame` streaming (both browser sender and server receiver), `agentKind`/`visionMode`/`visionEnabled`/`visionLiveEnabled` agent-config keys, dashboard VisionTab/agent-kind lib/vision creation flow, openapi enum entry (clients regenerated).
- DB migration `0069_remove_vision.sql` drops `call_media` and strips vision keys from `agents.agent_config` + vision tools from `agents.tools` (json cols — cast via jsonb).

**Why:** user wanted a clean slate before recreating vision with a new design.
**How to apply:** if asked to rebuild vision, start fresh — don't look for the old code paths; `WebcallShareLinksSection` in builder.tsx was intentionally kept (currently orphaned) and `requireCamera` on webcall links still works for permission gating only.
Pre-existing, unrelated: admin `signups.tsx` typecheck errors.
