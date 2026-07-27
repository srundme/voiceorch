---
name: Mute call with live transcript = TTS rejection
description: How to diagnose calls where transcript flows but no audio plays; what the new onProviderIssue/notice plumbing surfaces
---

**Rule:** A call that runs (transcript flows, agent replies in text) but is completely silent means TTS synthesis is failing per-sentence. A missing TTS key throws at pipeline construction and the call never starts — so a *running* mute call proves a key WAS resolved and the provider is rejecting the actual requests (invalid key for that account, or a voice the key's workspace can't use).

**Why:** Greeting + per-sentence + tool-follow-up TTS catches are deliberately non-fatal (call must stay up). Before instrumentation they only wrote `logger.error` to server logs — invisible in the Live Test panel and the call's Logs tab, so account-specific TTS breakage looked like a mystery mute.

**How to apply:**
- The ONLY account-scoped TTS input is provider-key resolution (own `providers` row beats managed key unless `agentMode==="managed"`, which forces managed keys). The voice id goes straight from `agents.tts_voice` into the adapter — no per-account voice lookup at call time. Cloned voices are created under the PLATFORM managed key (see user-cloned-voices schema comment), so they work for any account on managed keys.
- So when TTS works on account A but is mute on account B with the same agent config: compare which cartesia/sarvam key each account resolves (own row vs managed), and check `agentMode`. A stale per-account provider key silently overrides the working managed key.
- Instrumentation now in place: every non-fatal TTS failure writes a `TTS / Provider Failed` exec-log row (call's Logs tab), and the webcall transport gets a one-shot `onProviderIssue` → `{"type":"notice"}` → amber banner in the Live Test panel naming the reason. Telephony transports omit the callback. Barge-in AbortErrors never reach these catches (filtered at `job.synthError`).
- Prod (Railway) needs a redeploy before the banner appears there; the exact rejection also shows in Railway logs as "TTS error" / "Greeting playback/TTS error".
