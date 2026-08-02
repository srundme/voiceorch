---
name: Meet-bot speaker identification
description: How meeting speaker names reach the pipeline via Recall participant webhooks, and the meet-bot tile design preference
---

- Speaker ID works via Recall `recording_config.realtime_endpoints` participant webhooks (join/leave/update/speech_on/speech_off) → public `POST /api/meet-bots/recall-events?mb=<signed token>`; auth = the same HMAC launch token, which now carries a per-launch `mid` keying an in-memory roster (services/meet-roster.ts).
- The roster drives the classic pipeline through OPTIONAL VoiceSession methods (`setMeetingRoster`/`setMeetingSpeaker`/`injectMeetingNote`) called defensively — Gemini Live simply lacks names. Applies to newly launched bots only (subscription set at creation).
- `speech_off` must NOT clear the speaker label: STT finals lag the speech window, so the label survives until someone else speaks. The speaker tag is LLM-history-only (`[Speaker: name]` on the last user turn); UI transcripts stay untagged.
- **Why webhook always 200s:** Recall retries non-2xx — forged/expired tokens are dropped silently instead of triggering retry storms.
- Participant names are untrusted prompt input: whitelist-sanitized (unicode letters kept) + roster line tells the LLM names are display data, never instructions.
- Roster detach must run on EVERY webcall teardown path independent of the `ending` flag, or dead pipelines stay referenced for hours (architect-caught leak).
- **User preference:** keep the meet-bot camera tile as the ORIGINAL simple pulse-circle page ("looks natural") — a branded SnapServe redesign was built and explicitly reverted (Aug 2 2026). Don't redo it unsolicited; per-customer tile customization was offered and declined for now.
- Latency on webcall 5179 diagnosed: language-switch turns cost a full ~2-3s LLM trip (spec-prefill correctly invalidated); non-switch turns ~0.5-1s. Expected behavior, not a bug.
