# VoiceOrch Webcall — Architecture & Speech Capture Problem Brief

**File in question:** `artifacts/api-server/src/orchestration/telephony/webcall.ts` (~3,625 lines)
**Symptom:** Caller must speak **twice** before their speech is captured. First utterance is silently dropped every time the agent finishes speaking.

---

## 1. What webcall.ts Does (Full Picture)

`webcall.ts` is the server-side WebSocket handler for **browser-based voice calls** (not telephony/SIP). It handles the full real-time voice pipeline:

```
Browser mic → WebSocket → [webcall.ts] → STT → LLM → TTS → WebSocket → Browser speaker
```

A single exported function `handleWebcall(ws, callId, ...)` sets up everything and runs for the lifetime of the call.

---

## 2. Audio Flow — Step by Step

### 2a. Browser → Server

The browser captures mic audio via `ScriptProcessorNode(2048)` at 16 kHz and sends raw PCM16 frames over a WebSocket.

- **Frame size:** 2048 samples × 2 bytes = 4096 bytes ≈ **128ms per frame** (NOT 40ms — that's the telephony pipeline)
- The server receives these as `ws.on("message")` events

### 2b. Server receives each audio frame — decision tree

Every incoming audio frame runs through this logic (in order):

```
ws.on("message", data => {

  1. recording.addCallerChunk(data)          // always record, unconditionally

  2. genderDetector.addSpeechChunk()          // only when agent NOT speaking

  3. rms = rmsEnergy(data)                   // compute frame loudness

  4. if (speaking) → BARGE-IN PATH           // agent is currently talking
       └─ see Section 3

  5. bargeInFrames = 0  (reset)              // agent not speaking

  6. if (inEndGrace) → return                // ← THE PROBLEM (see Section 5)

  7. if (streamSTT) → STREAMING STT PATH    // Sarvam WS
       └─ streamSTT.sendAudio(chunk)
       └─ accumulate audioChunks if rms > threshold
       └─ arm fallback timer on silence

  8. else → BATCH STT PATH                   // local VAD + REST fallback
       └─ accumulate audioChunks on rms > threshold
       └─ flush after silence timer

})
```

---

## 3. Barge-in Path (agent is speaking)

While `speaking === true`, frames take the barge-in branch:

| Condition | Action |
|-----------|--------|
| `!bargeInEnabled` | return (agent owns turn, no interrupt allowed) |
| `Date.now() < echoGraceUntil` (start grace) | ignore frame completely — browser AEC hasn't adapted yet |
| `rms > BARGE_IN_RMS (800)` AND outside start grace | count barge-in frames, send to streamSTT |
| `bargeInFrames >= BARGE_IN_MIN_FRAMES (3)` AND `durationMs >= 150ms` | fire barge-in: stop agent, send `{ type: "interrupted" }` to browser |

**Key constants:**
- `BARGE_IN_RMS = 800` — energy threshold while agent is speaking (higher than normal 400 because browser AEC suppresses mic signal ~6–12 dB during TTS playback)
- `BARGE_IN_MIN_FRAMES = 3` — consecutive loud frames needed
- `BARGE_IN_ECHO_GRACE_MS = 700` — how long after TTS starts to suppress barge-in (stored as `echoGraceUntil`)

---

## 4. Echo Grace System (Two Separate Mechanisms)

This is where most bugs live. There are **two completely separate echo suppression systems** that are easily confused:

### Mechanism A: `echoGraceUntil` (timestamp-based)

- **What it is:** A future timestamp. Any transcript arriving before this time is discarded in the `onFinal`/`onPartial` STT callbacks.
- **Set when:** At the START of each TTS sentence and extended at the TAIL:
  ```
  // At sentence start:
  echoGraceUntil = Date.now() + sentenceDurationMs + echoGraceMs
  
  // At tail (after last chunk):
  echoGraceUntil = max(echoGraceUntil, Date.now() + AUDIO_TAIL_SILENCE_MS + WEB_TAIL_ECHO_MARGIN_MS)
                 = max(echoGraceUntil, Date.now() + 300 + 100)
                 = max(echoGraceUntil, Date.now() + 400ms)
  ```
- **Effect:** STT transcripts produced during this window are thrown away in the callback — the audio was still sent to Sarvam, but the resulting text is discarded.

### Mechanism B: `inEndGrace` (duration-based, blocks AUDIO)

- **What it is:** A 600ms window after the last TTS audio chunk was physically sent to the browser (`lastChunkSentAt`).
- **Computed as:** `Date.now() - lastChunkSentAt < BARGE_IN_END_GRACE_MS (600ms)`
- **Effect (current, broken):** The entire audio frame handler `return`s — **zero audio reaches Sarvam's WebSocket** during this window.
- **Intent:** Prevent the trailing echo of the agent's last word (still playing in the browser speaker) from reaching Sarvam and producing a false transcript.

### Timeline of both mechanisms after last TTS chunk:

```
t=0ms    Last TTS chunk sent → lastChunkSentAt = now
         echoGraceUntil = now + 400ms

t=0–400ms   Both active:
            - inEndGrace: audio blocked (return early, nothing reaches Sarvam)
            - echoGraceUntil: transcripts suppressed in onFinal callback

t=400–600ms Only inEndGrace active:
            - echoGraceUntil has EXPIRED (transcripts would be allowed through)
            - BUT audio is still blocked (inEndGrace still running)
            ← This 200ms window is where a "speak twice" trap lives

t=600ms+    Both expired:
            - Audio flows to Sarvam
            - Transcripts are processed normally
```

---

## 5. The Core Problem: "Speak Twice"

### What actually happens

```
Agent finishes speaking
│
├─ t=0ms: lastChunkSentAt = now, echoGraceUntil = now+400ms
│
├─ Caller starts speaking at t=50ms (natural, immediate response)
│   └─ Frame arrives at server
│       └─ speaking=false → hits inEndGrace check
│           └─ inEndGrace=true → return  ← AUDIO DROPPED, Sarvam gets nothing
│
├─ t=50–600ms: ALL caller audio frames are silently dropped
│
├─ t=600ms: inEndGrace expires
│
├─ Caller has heard silence, thinks agent didn't hear them
│   → Caller speaks AGAIN
│
└─ t=700ms+: Audio reaches Sarvam → transcript fires → turn processes
```

### Why this has been hard to fix

The problem has appeared repeatedly because there are **two competing concerns** that keep getting traded off:

**Concern A — False echo transcripts:**
If the agent says "சரி" and Sarvam hears the speaker echo and transcribes "சரி" back, the agent responds to its own voice. This was a real bug in early testing.

**Concern B — Dropped first utterance:**
If we block audio for 600ms after each turn, callers who respond immediately lose their first words every single time.

Every attempted fix has solved one and broken the other. The current code tries to fix this by forwarding audio to streamSTT during inEndGrace (added June 24) but the interaction with the Sarvam WebSocket state machine and the echoGraceUntil filter is not verified to actually work.

---

## 6. Sarvam Streaming STT — How It Works

Sarvam uses a **WebSocket streaming protocol**:

```typescript
// Protocol: send audio chunks as binary, receive transcript events as JSON
streamSTT = sarvamAdapter.transcribeStream(
  onFinal: (text, isFinal) => { ... },   // called when Sarvam sends a final transcript
  onClose: () => { streamSTT = null; }   // called when WS closes
)
```

**Key facts about Sarvam streaming:**
- Model: `saarika:v2.5` or `saaras:v3` (valid streaming models; others 404)
- Audio format: WAV-wrapped PCM at 8 kHz, sent as `AudioContent { data, encoding: "audio/wav", sample_rate: 8000 }`
- Sarvam produces transcript events continuously; final transcripts have `is_final: true`
- **Sarvam does NOT buffer audio internally across gaps** — if you stop sending frames, it closes the speech segment. When you resume, it's a new segment.
- The server's `onFinal` callback receives each finalized segment

**onFinal handler flow:**
```
Sarvam fires onFinal(text)
  │
  ├─ if (speaking)                          → barge-in path (section 3)
  ├─ if (within echoGraceUntil)             → discard (echo suppression A)
  ├─ if (within BARGE_IN_END_GRACE_MS       → discard (leftover echo guard)
  │   AND speech_start was > 1.5s ago)
  ├─ if (processing)                        → queue in streamingTranscriptPending
  └─ else                                   → void process() → LLM → TTS
```

---

## 7. Short Utterance Problem (Related Bug)

There's a second related "speak twice" scenario:

When the **agent is still speaking** and the caller says something short (e.g., "ஆமாங்க", "சரி" — 1 word), the word-count gate rejects it as too short to barge-in:

```typescript
if (!semanticOverride && wc < wordsForInterruption) {
  pendingShortUtterance = text;  // saved for replay
  return;
}
```

`pendingShortUtterance` is supposed to be replayed as a user turn once the agent finishes. If the replay mechanism fires incorrectly or `pendingShortUtterance` gets cleared before replay, the utterance is lost and the caller must repeat.

---

## 8. State Machine (Key Variables)

| Variable | Type | Meaning |
|----------|------|---------|
| `speaking` | boolean | Agent is currently playing TTS audio |
| `speakingEndedAt` | number | Timestamp when agent last stopped speaking |
| `speakingStartedAt` | number | Timestamp when agent last started speaking |
| `echoGraceUntil` | number | Future timestamp; discard STT transcripts until then |
| `lastChunkSentAt` | number | Timestamp of last TTS PCM chunk sent to browser |
| `interrupted` | boolean | Barge-in fired this turn; agent stopped mid-sentence |
| `processing` | boolean | LLM + TTS pipeline is currently running |
| `audioChunks` | Buffer[] | Accumulated caller audio for batch STT fallback |
| `streamSTT` | StreamSTT\|null | Active Sarvam WebSocket; null if closed/dead |
| `streamingTranscriptPending` | string | Queued transcript waiting for current turn to finish |
| `pendingShortUtterance` | string\|null | Short transcript saved during agent speech for replay |
| `lastUserSpeechStartAt` | number | When Sarvam last fired a speech_start event |
| `bargeInFrames` | number | Consecutive loud frames counted during barge-in attempt |
| `inEndGrace` (computed) | boolean | `Date.now() - lastChunkSentAt < 600ms` |

---

## 9. TTS Playback Loop (How `speaking` + `lastChunkSentAt` Get Set)

Each LLM response is split into sentences. Per sentence:

```
for each sentence in LLM response:
  1. tts.synthesize(sentence) → PCM audio buffer
  2. speaking = true
  3. echoGraceUntil = Date.now() + sentenceDurationMs + echoGraceMs
  4. for (j = 0; j < audio.length; j += 1280):
       sendSpeechAudio(chunk)     ← sets lastChunkSentAt = Date.now() each chunk
       await sleep(40ms)

after last sentence:
  5. echoGraceUntil = max(echoGraceUntil, Date.now() + 400ms)
  6. send AUDIO_TAIL_SILENCE_MS (300ms) of silence frames
     └─ sendAudio(silence)       ← sets lastChunkSentAt one final time
  7. await sleep(300ms)
  8. speaking = false
  9. speakingEndedAt = Date.now()
```

So `lastChunkSentAt` is the timestamp of the **last silence frame**, not the last real speech chunk.

---

## 10. Current State of Fix Attempts (June 2026)

| Date | Change | Outcome |
|------|--------|---------|
| ~Jun 10 | Added `inEndGrace` guard — hard `return` for 600ms | Fixed false echo transcripts; introduced "speak twice" |
| Jun 17 | Raised `BARGE_IN_END_GRACE_MS` 600→1200ms | Made "speak twice" worse |
| Jun 17 | Raised `WEB_TAIL_ECHO_MARGIN_MS` 100→800ms | Same |
| Jun 23 | Reverted both to original values (600ms, 100ms) | Partial improvement |
| Jun 23 | `streamSTT.sendAudio(chunk)` was found missing from `if (streamSTT)` block | Fixed zero-transcript bug; "speak twice" persisted |
| Jun 24 | Modified `inEndGrace` branch to forward audio to streamSTT but still `return` | Current state — not yet verified to work |

---

## 11. What Needs to Be Solved

The correct fix must satisfy **all four constraints simultaneously:**

1. **No dropped first words** — Audio from the caller reaches Sarvam immediately when they start speaking, even within 600ms of agent finishing.

2. **No false echo transcripts** — Sarvam must not produce a transcript from the agent's own TTS audio echoing back through the browser mic.

3. **No false barge-in** — The agent must not be interrupted by its own echo while mid-sentence.

4. **Sarvam WebSocket continuity** — Sarvam's streaming session should not be reset or re-opened between turns; it must stay open continuously and receive an unbroken stream of audio frames.

### Why it's hard

- The browser does AEC (Acoustic Echo Cancellation) — but it takes 500–800ms to adapt after TTS starts. During that adaptation window, the agent's voice leaks through the mic.
- Sarvam's streaming session accumulates context within a segment. Sending silence frames vs. stopping the send has different effects on how Sarvam segments speech.
- There is no "speech_start" event from Sarvam's streaming API — the server infers it from energy (RMS) on the raw PCM frames.
- Tamil short words ("சரி", "ஆமாங்க") are 1-word utterances that fall below the barge-in word gate, creating a second path for dropped utterances.

---

## 12. Key Files

| File | Purpose |
|------|---------|
| `artifacts/api-server/src/orchestration/telephony/webcall.ts` | Main file — entire webcall handler |
| `artifacts/api-server/src/orchestration/adapters/stt/sarvam.ts` | Sarvam STT WebSocket adapter |
| `artifacts/api-server/src/orchestration/endpointing.ts` | TurnSafetyNet — stall detection, force-finalize |
| `artifacts/api-server/src/orchestration/transcriptQuality.ts` | `isSemanticInterrupt`, garble detection |
| `artifacts/api-server/src/orchestration/audio.ts` | `rmsEnergy`, `downsample16to8` |

---

## 13. Relevant Constants (all in webcall.ts top-of-file)

```typescript
const VAD_SILENCE_MS           = 150;   // silence before batch STT flush
const SPEECH_RMS_THRESHOLD     = 400;   // normal speaking threshold
const BARGE_IN_RMS             = 800;   // threshold while agent speaking (higher: AEC suppresses mic)
const BARGE_IN_MIN_FRAMES      = 3;     // consecutive loud frames for barge-in
const WEBCALL_FRAME_MS         = 128;   // one browser frame = 128ms (2048 samples @ 16kHz)
const BARGE_IN_ECHO_GRACE_MS   = 700;   // suppress barge-in N ms after TTS starts
const BARGE_IN_END_GRACE_MS    = 600;   // suppress new-turn N ms after last TTS chunk
const ECHO_DISCARD_OVERLAP_MS  = 1500;  // speech starting within this of agent ending = genuine overlap
const AUDIO_TAIL_SILENCE_MS    = 300;   // silence drain after last TTS chunk
const WEB_TAIL_ECHO_MARGIN_MS  = 100;   // extra margin past tail drain
const TTS_TAIL_SILENCE_MS      = 150;   // silence appended to every TTS buffer
const MIN_PCM_BYTES            = 3200;  // ~100ms minimum speech before processing
```

---

*Document generated June 24, 2026 — do not make code changes based on this doc without reviewing current HEAD of webcall.ts first.*
