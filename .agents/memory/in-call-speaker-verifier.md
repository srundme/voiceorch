---
name: In-call speaker verifier (mid-call hand-off detection)
description: The opt-in, warning-only ephemeral speaker verifier that runs during a live call — distinct from the persistent voice_prints DB enrollment. Read before touching the audio feed, gender detector, or pipeline turn path.
---

## There are now TWO speaker-recognition surfaces sharing the same ECAPA endpoints
1. **Persistent** — `VoiceIntelSession` enrolls/identifies against the `voice_prints` DB table via `callerAudioTap` (see voice-intel-audio-tap.md, ecapa-tdnn-speaker.md). Cross-call identity.
2. **Ephemeral in-call** — `SpeakerVerifier` (`orchestration/speakerVerifier.ts`). Enrolls THIS call's reference into **Node memory only** (NOT persisted — DB "Layer 2" deferred), then verifies later windows to detect a mid-call speaker hand-off. Opt-in per agent via `agentConfig.voiceVerificationEnabled` (default false). On a sustained mismatch it (a) emits a `voice_mismatch` Compliance execution-log warning AND (b) makes the agent verbally ask who is now speaking. **Never interrupts/ends/fails the call.**

## On-mismatch: agent verbally asks who is speaking (in-language)
`onMismatch` does NOT speak directly (it fires off a fire-and-forget `setImmediate` background tick — speaking there would race the turn path). Instead it sets a one-shot `pendingSpeakerChallenge` boolean on the pipeline. That flag is consumed during normal per-turn system-prompt assembly (right after the `langGuard` block, before KB/gender injections): if set, reset it and append a one-off `[VOICE CHANGE CHECK]` directive to `systemPromptForTurn` telling the agent to politely ask who it's speaking with, in the caller's current language, then continue. **Why this design:** rides the existing LLM+playback turn → zero new audio path, zero added latency, naturally multilingual (the langGuard above it enforces the language; do NOT hardcode an English phrase). The flag is consumed on a LATER user turn (onMismatch is async). Garbled-transcript + guardrail early-returns happen BEFORE prompt assembly, so the flag correctly persists across them and only fires on a genuine LLM turn. Single-threaded JS = no race on the boolean.

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
