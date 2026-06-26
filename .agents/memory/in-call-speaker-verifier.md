---
name: In-call speaker verifier (mid-call hand-off detection)
description: The opt-in, warning-only ephemeral speaker verifier that runs during a live call — distinct from the persistent voice_prints DB enrollment. Read before touching the audio feed, gender detector, or pipeline turn path.
---

## There are now TWO speaker-recognition surfaces sharing the same ECAPA endpoints
1. **Persistent** — `VoiceIntelSession` enrolls/identifies against the `voice_prints` DB table via `callerAudioTap` (see voice-intel-audio-tap.md, ecapa-tdnn-speaker.md). Cross-call identity.
2. **Ephemeral in-call** — `SpeakerVerifier` (`orchestration/speakerVerifier.ts`). Enrolls THIS call's reference into **Node memory only** (NOT persisted — DB "Layer 2" deferred), then verifies later windows to detect a mid-call speaker hand-off. Opt-in per agent via `agentConfig.voiceVerificationEnabled` (default false). **Warning-only**: emits a `voice_mismatch` execution-log warning via `onMismatch`; never interrupts/ends/fails the call.

Both hit gender-service `/voice-analysis/speaker/embed` + `/verify`.

## Non-obvious constraints (each cost a review cycle — keep them)
- **Echo-gate the verifier feed.** It is fed at the *gender-detector* feed points (`addSpeechChunk` in `pipeline.ts`, streaming + batch STT paths), NOT via `callerAudioTap`. But unlike the gender detector it is gated on `!this.isPlaying`. **Why:** the gender detector fires once early so echo is harmless; the verifier runs continuously, and agent TTS echo bleeding into the inbound stream pollutes the enrollment/verification voiceprint → false hand-off warnings. Feed it caller-only audio.
- **Fire-and-forget detection must defer ALL work off the turn path.** `runDetection()` runs on the live turn path. Do only O(1) guards + a reference swap synchronously, then `setImmediate(...)` for `Buffer.concat` + WAV/FormData build + fetch. **Why:** concat/serialize before the first `await` is still CPU on the live turn — violates the zero-latency requirement.
- **The "ignore first window after enrollment" check must run BEFORE mutating scoring state** (recentScores / consecutiveLow), or the fresh-reference baseline pollutes the rolling average and consecutive-low count.
- **Reference is fixed at enrollment, never adapted** toward later audio — otherwise an impostor could drift the reference onto themselves.

## Webcall needs no separate tap for this
Webcall is now a thin adapter over the shared `createSession`/pipeline core (see webcall-pipeline-split.md), so the verifier works on webcall automatically. This differs from the old `VoiceIntelSession`, which required a duplicated tap in `webcall.ts`.

## Tuning (env, all optional — sensible defaults in speakerVerifier.ts)
`SPEAKER_VERIFY_THRESHOLD` (0.5), `SPEAKER_VERIFY_ENROLL_SECONDS` (13), `SPEAKER_VERIFY_WINDOW_SECONDS` (24), `SPEAKER_VERIFY_MIN_CONSECUTIVE` (2), `SPEAKER_VERIFY_COOLDOWN_MS` (45000), `SPEAKER_VERIFY_ENERGY_GATE` (250). All warning-only, so a slightly-off value only changes sensitivity.
