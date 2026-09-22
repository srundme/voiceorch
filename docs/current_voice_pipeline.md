# Current voice pipeline (V1) — audit for Call Quality Engine V2

**Status:** read-only audit (historical). Classic cascade (`OrchestrationPipeline`) is the live path.  
**Scope:** classic cascade on VoBiz PSTN. Gemini Live is a separate stack.  
**Date:** 2026-09-19 (Silero advisory later folded into classic; abandoned `VOICE_ENGINE` dual-stack removed).

Trust this file over comments in `noise-gate.ts` / Builder copy when they disagree with `NoiseCanceller.process`.

---

## CURRENT AUDIO PATH

```
VoBiz PSTN (G.711 on the wire, transcoded by VoBiz)
  → WSS media event (audio/x-l16; rate=8000, little-endian s16le)
  → handleVobizWebSocket  (telephony/vobiz.ts)
  → OrchestrationPipeline.onRawPcm8kIn  (pipeline.ts)
  → processRawPcm8kIn  (audioPool.ts → audioWorker.ts)
       NoiseCanceller.process = identity (pass-through)
       upsample8to16 for 16 kHz copy
       hasSpeechEnergy / frameRms (advisory only)
  → handleProcessedAudio  (pipeline.ts)
       EVERY frame → streamSTT.sendAudio (8 kHz for telephony Sarvam)
  → Sarvam Saaras realtime WS  (adapters/stt/sarvam-realtime.ts)
       events: transcript.partial | transcript.final | vad.speech_start | vad.speech_end
  → handleStreamingTranscript / processTurn  (pipeline.ts)
  → LLM adapter  (unchanged in V2)
  → TTS (Sarvam Bulbul or Cartesia)
  → playJob  20 ms paced frames
  → onAudioOut → sendAudioToVobiz playAudio
  → VoBiz → caller
```

Barge-in (when it fires): `triggerBargeIn` → `onBargeIn` → `{ event: "clearAudio", streamId }`.

---

## 1. VoBiz inbound PCM entry

| Item | Value |
|---|---|
| File | `artifacts/api-server/src/orchestration/telephony/vobiz.ts` |
| Function | `handleVobizWebSocket` |
| Event | inbound WebSocket JSON `{ event: "media", media: { payload, track? } }` |
| Answer XML | `getVobizAnswerXML` → `<Stream bidirectional="true" keepCallAlive="true" maxRetries="0" contentType="audio/x-l16;rate=8000">` |
| Session | `createSession({ telephonyProvider: "vobiz", rawPcmOutput: true, onAudioOut, onBargeIn: sendBargeIn })` |
| Handoff to pipeline | `session.pipeline.onRawPcm8kIn(pcm8k)` — **no** `noiseCancel` argument (pipeline applies the agent toggle) |

Pre-session media is buffered (`pendingInput`, cap 5 s of 8 kHz s16le) then flushed after `createSession`.

Duplicate media sockets: `vobiz-duplicate-stream.ts` + `mediaEpoch`. Stale sockets drop `playAudio` / inbound.

---

## 2–5. Audio format

| Property | Inbound (caller → SnapServe) | Outbound (SnapServe → caller) |
|---|---|---|
| Encoding | LINEAR16 PCM, little-endian (comment in `sendAudioToVobiz`: VoBiz is LE despite RFC 2586 BE for `audio/x-l16`) | Same |
| Sample rate | 8000 Hz | 8000 Hz |
| Channels | mono | mono |
| Inbound frame size | **Not fixed.** Whatever VoBiz puts in one `media` message. | **Fixed 20 ms** paced send |
| Outbound frame bytes | — | 320 B s16le @ 8 kHz (`PCM_CHUNK` in `playJob`) |
| Twilio/Plivo contrast | mulaw → `onAudioIn` → `decodeMulaw` | mulaw unless `rawPcmOutput` |

Webcall (not V2 PSTN): `onRawPcm8kIn(pcm8k, noiseCancel?, nativePcm16k?)` can queue true 16 kHz for STT.

---

## 6. Where audio is sent to Saaras

| Item | Value |
|---|---|
| File | `pipeline.ts` `handleProcessedAudio` |
| Call | `this.streamSTT.sendAudio(sttFrame)` |
| Rate | telephony + Sarvam: **8000 Hz native** (`this.sttSampleRate = 8000` when `isTelephonySarvam`) |
| Adapter | `adapters/stt/sarvam-realtime.ts` `sendChunk` → JSON `{ event: "audio_input", audio: base64 }` |
| Gating | **None.** Comment invariant (calls 772→1320): never gate/flush this feed during agent speech. |
| Init | `initStreamingSTT` → `this.stt.transcribeStream(...)` + `wireStreamSttCallbacks` |

Saaras also emits provider VAD (`onSpeechStart` / `onSpeechEnd`) on the same socket.

---

## 7. Where TTS audio enters VoBiz

| Item | Value |
|---|---|
| Pipeline | `playJob` / `startSentenceSynthesis` → `this.config.onAudioOut(outChunk)` |
| Session wrap | `session.ts` `ownedAudioOut` (mediaEpoch / meeting mute) |
| Transport | `vobiz.ts` `sendAudioToVobiz` → `{ event: "playAudio", media: { contentType: "audio/x-l16", sampleRate: 8000, payload } }` |
| Backpressure | close WS if `ws.bufferedAmount > 64 KiB` |
| Receipts | `{ event: "playedStream", name }` → `PlaybackCheckpoints.acknowledge` |

---

## 8. Agent playback buffering

| Layer | File / function | Behaviour |
|---|---|---|
| TTS jitter / prebuffer | `pipeline.ts` `playJob` | `TTS_PREBUFFER_*` wait, then 20 ms paced drain; `TTS_WIRE_LEAD_FRAMES` send-ahead |
| PCM queue | `TtsSentenceJob.pcmQueue` | synthesis fills; drain loop consumes |
| Carrier buffer | VoBiz | `clearAudio` discards it |
| Early ambient | `telephony/early-ambient.ts` | comfort noise until first real `onAudioOut` (VoBiz ~2 s silence drop) |
| Recording | `RecordingBuffer` @ 8000 Hz | caller chunks recorded **before** NC (which is identity anyway) |

---

## 9. Every place TTS can be interrupted

All converge on `OrchestrationPipeline.triggerBargeIn` then `bargeInCallback` = `sendBargeIn`.

| Trigger string | Function | File | What it requires |
|---|---|---|---|
| `vad_speech_start` | `maybeBargeFromRealtimeVadStart` | `pipeline.ts` | Agent speaking + **usable STT partial** (≥ `SELF_ECHO_MIN_WORDS` **4**) + `shouldInterruptFromCallerTranscript`; **not** bare VAD |
| `stt_partial` | `schedulePartialBargeIn` | `pipeline.ts` | Partial while playing; same 4-word floor unless hard interrupt |
| `word_count` | `handleStreamingTranscript` | `pipeline.ts` | STT **final** while `isPlaying` + `shouldInterruptFromCallerTranscript` |
| `queued_final` | `handleStreamingTranscript` | `pipeline.ts` | Final while `isProcessing` that looks like interrupt |
| (system TTS) | `cancelSystemPlaybackForCallerSpeech` | `pipeline.ts` | Energy or ≥4-char partial during check-in |

`InterruptionManager.invalidateCurrentTurn()` then abort TTS AbortControllers + `llm.cancelInFlight`. Sequence id invalidation stops `playJob` drain.

**Explicitly disabled / empty:**

- `tryEnergyBargeIn` — empty body (“Bolna has no inbound RMS barge path”).
- Bare Sarvam `vad.speech_start` **must not** cut TTS (comment: PSTN echo barge).
- `armBargeRecovery` — empty `return`.

`bargeInEchoGraceMs` is forced to **0** in the constructor; remaining “echo grace” is `playbackTooFreshForPartialBarge` / `bargeInHoldUntil` / `armTailEchoGrace`.

---

## 10. Every place a user turn can be committed

**Authoritative commit for live Sarvam:** `handleStreamingTranscript` → `processTurn(transcript, 0)`.

| Path | Function | When |
|---|---|---|
| STT final | `initStreamingSTT` callback `isFinal` → `handleStreamingTranscript` | Primary |
| Speech-end prefill | `handleSttSpeechEnd` | LLM **prefill only**; TTS still waits for final |
| Queue drain | `drainPendingTranscripts` after `processTurn` finally | Orphans from greeting / in-flight |
| Batch fallback | `flushAndProcess` / `stt.transcribe` | Stream down; `scheduleSilenceFlush` currently `setTimeout(..., 0)` |
| Force finalize | `safetyNet` / lost-turn recovery | Stall / dead socket |

`semanticTurnDetection` is **hardcoded false** in `session.ts`. `evaluateSemanticTurn` is a **no-op** (`return;`). Smart Turn is **not** on the live path.

---

## 11. Silence timers (non-exhaustive but all owners)

| Timer | File | Function / class | Role |
|---|---|---|---|
| Sarvam `silence_duration_ms` | `sarvam-realtime.ts` + `endpointing-settings.ts` | `setSilenceDurationMs` / `resolveSarvamEndpointingMs` | **Provider VAD** end-of-speech (150–2000 ms, UI min 400) |
| Adaptive endpoint profiles | `endpointing.ts` | `computeEndpointMs` | email/digit/filler/fast 150–900 ms — used by `scheduleSilenceFlush` (batch; live path flush is 0 ms) |
| Name-collection override | `pipeline.ts` `processTurn` | `setSilenceDurationMs(600\|300)` | Extra wait while collecting a name |
| Stall / force-finalize | `endpointing.ts` `TurnSafetyNet` | `onPartial` / `onFinal` / `beginListening` | “can’t hear you” |
| Silence hangup | `endpointing.ts` `SilenceWatchdog` | `resetHangupTimer` | Post-bot idle → check-in → hangup |
| VAD flush backstop | `pipeline.ts` | `armVadFlushBackstop` | Lost utterance if no transcript after speech_start |
| Semantic EOU timers | `pipeline.ts` | `_eouTimer` / `_eouFinalTimer` | Dead while `semanticTurnDetection=false` |
| Eager partial | `pipeline.ts` | `scheduleEagerLlm` | Off unless `EAGER_STABLE_PARTIAL=1` |
| Playback 20 ms tick | `pipeline.ts` `playJob` | `setTimeout(delay)` | Wire pacing, not turn-taking |

---

## 12. RMS / energy gates

| Site | Function | Live effect |
|---|---|---|
| `audioWorker.ts` | `frameRms`, `hasSpeechEnergy` | Metadata `rawRms` / `hasSpeech` |
| `NoiseCanceller.process` | `audio.ts` | **Identity.** Toggle still calls it. |
| `tryEnergyBargeIn` | `pipeline.ts` | **No-op** |
| `isIdleCancellingMicEnergy` | `mic-sensitivity.ts` | Cancels idle watchdog; does not barge |
| AMD / voicemail | `hasSpeechEnergy` in `onRawPcm8kIn` | Machine vs human; skips STT |
| `echoBarRms` / `updateEchoFloor` | `pipeline.ts` | Adaptive echo floor still computed; energy barge does not use it |
| Mic sensitivity | `resolveMicSensitivity` | Always `"low"`; barge bar 1800 is unused while energy barge is empty |

---

## 13. Smart Turn

| File | Role today |
|---|---|
| `smart-turn.ts` | Pipecat Smart Turn v3.2 ONNX (16 kHz log-mel) |
| `smart-turn-mel.ts` | Feature extraction |
| `pipeline.ts` | **Imports** `predictSmartTurn` / `warmSmartTurn` — **no call sites** in the file except the import |
| `evaluateSemanticTurn` | Empty `return` |

**V2:** already off the critical path. Do not re-enable in V2.

---

## 14. Semantic endpoint checks

| File | Role today |
|---|---|
| `semantic-turn-gate.ts` | State machine (open / evaluating / hold / awaiting_final) |
| `session.ts` | `semanticTurnDetection: false` |
| `transcriptQuality.ts` | `isHardInterruptTranscript`, booking-time answers, accidental-interrupt phrases — **still used for barge** |
| `self-echo.ts` | `isSelfEcho` / `isCarrierSelfEcho` — **transcript overlap**, not AEC |

---

## 15. Barge-in conditions (live PSTN)

Must all be true for a typical talk-over:

1. `bargeInEnabled` (default true)
2. `isPlaying || isSendingTtsAudio`
3. Not `bargeInRequested`
4. Transcript that is not `isCarrierSelfEcho`
5. Not `isSameUtteranceStillArriving` (duplicate of last user turn)
6. `shouldInterruptFromCallerTranscript` **or** hard interrupt (stop / slot time)
7. For VAD-start / partial path: **≥ 4 English-style words** (`SELF_ECHO_MIN_WORDS`) unless hard interrupt
8. Not `playbackTooFreshForPartialBarge` unless hard interrupt
9. Greeting/system: Bolna-style mute (`greetingFirstClipActive` / `systemPlaybackActive`) — stop phrases may still cut

**Tamil one-word answers (`ஆம்`, `சரி`) fail (6)+(7).** That is the missed-yes bug.

---

## 16. STT-final handlers

| Callback | File | Downstream |
|---|---|---|
| `transcribeStream` `isFinal=true` | `pipeline.ts` `initStreamingSTT` | `handleStreamingTranscript` |
| `flush()` fabricated final | `sarvam-realtime.ts` | Same `onTranscript(..., true)` — **not** used on live Sarvam barge (would clear `lastPartial`) |
| Batch `stt.transcribe` | `pipeline.ts` recovery / `flushAndProcess` | `processTurn` |

Partials never commit TTS. Finals do, after echo/quality/duplicate guards.

---

## Conflicting endpoint / barge owners (V1)

These can each decide “user finished” or “interrupt” without a single state machine:

1. Saaras `vad.speech_end` → `handleSttSpeechEnd` (prefill)
2. Saaras `transcript.final` → `processTurn` (commit)
3. Saaras `vad.speech_start` + partial → barge inspect
4. STT final + word policy → barge
5. `TurnSafetyNet` force-finalize
6. `SilenceWatchdog` idle
7. Lost-turn VAD backstop
8. `isCarrierSelfEcho` discards a final (false “no speech”)
9. 4-word barge floor drops `yes` / `ஆம்`
10. `InterruptionManager` WAIT vs SEND vs BLOCK (echo VAD used to fake Playback Completed; still gates emit)

There is **no** `commit_user_turn()` / `interrupt_agent()` singleton.

---

## Dead / misleading code (do not treat as live V1 behaviour)

| Piece | Reality |
|---|---|
| `SileroVAD` | Warmed at process start (`index.ts` `warmSileroVAD`). **Never constructed in `pipeline.ts`.** |
| `NoiseCanceller` | Pass-through. Builder “Speech-band Noise Filter” does not denoise. |
| `tryEnergyBargeIn` | Empty |
| `evaluateSemanticTurn` / Smart Turn | Off |
| `armBargeRecovery` | Empty |
| `noise-gate.ts` comments | Still describe bandpass; `process()` does not filter |

---

## Far-end TTS reference for AEC3

**Capture point exists:** every byte sent to the caller goes through `onAudioOut` → `sendAudioToVobiz`. That is the exact far-end **send** signal (20 ms, 8 kHz s16le).

**Do not claim AEC works from that alone.**

| Risk | Detail |
|---|---|
| Delay | Unknown: Node send → VoBiz jitter buffer → PSTN → acoustic/sidetone → inbound `media`. Tens to hundreds of ms, not clocked. |
| What caller hears ≠ what we sent | `clearAudio`, underrun zeros, early-ambient, WS drop |
| Clock | Two WebSocket directions; no RTP timestamps on this API |
| Rate | AEC3 wants 8/16/32/48 kHz with **aligned 10 ms frames**; inbound chunks are **variable length** |
| Double-talk | Shop + bot; AEC3 can fail to converge |

**Verdict:** far-end tap is possible at `onAudioOut`. AEC3 is **not** proven. V2 must log `far_end_reference_available`, delay estimate, and ERL/ERLE if the library exposes them. If delay cannot be estimated on VoBiz WS, **stop AEC and document** — do not ship transcript-echo as “AEC”.

---

## How TTS cancellation works today

1. `triggerBargeIn`
2. `interruptionMgr.invalidateCurrentTurn()` — drain sees invalid sequence → stop sending
3. `bargeInCallback()` = `clearAudio` **first**
4. Abort in-flight TTS + LLM
5. `handleStreamingTranscript` must still accept the interrupting final (`bargeInActive` skips queue-behind-greeting)

---

## Concurrency

| Component | Today |
|---|---|
| Media WS | One thread; `onRawPcm8kIn` posts to **audio worker pool** (sticky by callId, FIFO). NC is cheap (identity). |
| STT send | Same event loop after worker result |
| TTS | Sarvam WS serialized (`synthesisScheduling: serial`); Cartesia continuations |
| DeepFilterNet / AEC3 | AEC3 + Quail run in the **audio worker pool** (sticky per callId). Do not run neural denoise in the WS callback. |
| Host | Railway CPU; `AUDIO_POOL_MAX = 8`. |

---

## Silero on classic (current)

- `silero-vad.ts` + `silero-stream.ts` + `hysteresis-vad.ts` under `orchestration/`.
- Live use: **advisory** `caller_speaking` / soft-duck fusion only — never gates STT, never owns commit/barge.
- A parallel `VOICE_ENGINE` / TurnController dual-stack was prototyped offline and **removed** (never owned production turns).

---

## Success criteria still relevant

Customer interrupt; `yes` / `ஆம்` / `சரி` not lost; bot does not barge itself on echo; fewer false barges from fans; natural ends; no talk-over; conversational latency; Saaras not worse; realtime under load.

**Limitation:** a second human is still speech. Isolation is a later program.
