import type { Chapter } from "../types";

export const sttPipelinePath: Chapter = {
  slug: "d1-stt-pipeline-path",
  moduleId: "d1",
  number: "17.1",
  title: "How Caller Audio Reaches the STT",
  summary:
    "The journey of one 20 ms audio frame: noise gate + attenuation, echo guards, and the callback that hands words to endpointing.",
  estMinutes: 20,
  fileRef: "artifacts/api-server/src/orchestration/pipeline.ts",
  prerequisites: ["stt-adapters"],
  status: "published",
  blocks: [
    {
      kind: "prose",
      heading: "What & Why",
      paragraphs: [
        "Before any STT (speech-to-text) vendor can transcribe a word, the raw phone audio has to travel through the **pipeline** — the big orchestration class in `pipeline.ts` that runs one live call. This chapter follows a single 20-millisecond chunk of caller audio from the moment it lands to the moment its transcript is handed off for endpointing.",
        "There are three things happening on that journey that decide whether the agent hears the caller correctly: a **noise gate** that quietens background sound, a set of **echo guards** that stop the agent from hearing its own voice, and the **streaming STT callback** — the function the adapter calls back with every interim and final transcript.",
        "We skip the thousands of lines of unrelated pipeline logic (LLM turns, tools, playback) and quote only the parts that touch STT input and output. The pipeline file is over 9,000 lines; treat this as a guided tour of the STT-relevant slices.",
      ],
    },
    {
      kind: "concept",
      title: "A 20 ms frame is the unit of work",
      body: [
        "Telephony audio arrives as a steady stream of tiny chunks. The pipeline works in **20 ms frames** at 8 kHz — that is 160 samples, or 320 bytes of 16-bit PCM (raw uncompressed audio numbers). Everything — the noise gate, the energy check, the barge-in detector — reasons frame by frame.",
        "PCM means Pulse-Code Modulation: plain integers describing the sound wave. **8 kHz** is telephone quality; **16 kHz** is the wider band most STT vendors prefer, so the pipeline keeps both a `pcm8k` and a `pcm16k` copy of each frame.",
        "Two providers want different rates. Sarvam is fed native 8 kHz phone audio (no fake upsampled samples); everyone else gets the 16 kHz version. That single choice — `sttSampleRate` — is the last decision before audio leaves the pipeline.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/audio.ts",
      language: "typescript",
      intro:
        "First stop: the adaptive noise gate in the NoiseCanceller. These constants define how it behaves. Read the comments — they are a lesson learned from a real bug.",
      code: `const GATE_RATIO          = 4.0;   // suppress frames below 4× estimated noise floor
const NOISE_ALPHA         = 0.98;  // slow-tracking IIR for noise-frame noise floor updates
const CALIB_ALPHA         = 0.7;   // fast-tracking IIR used during calibration phase
const CALIB_FRAMES        = 25;    // ~500 ms @ 20 ms/frame before gating begins
const NOISE_FRAME_BYTES   = 320;   // 20 ms @ 8 kHz → 160 samples → 320 bytes
// Below-threshold frames are ATTENUATED, not replaced with pure digital silence.
// Hard-zeroing erased short/soft utterances ("yes", "okay") entirely before they
// reached any STT provider — the provider-independent one-word-reply loss (call
// 2039). Attenuated frames keep enough residual signal for STT VADs to latch
// onto quiet speech onsets while still suppressing background noise.
const GATE_ATTENUATION    = 0.15;  // scale gated frames to 15% instead of zeroing
// After a speech frame, keep the gate open for this many subsequent frames
// (hangover) so brief pauses inside/around short utterances aren't clipped.
const GATE_HANGOVER_FRAMES = 5;    // 5 × 20 ms = 100 ms hangover`,
      lines: [
        {
          lines: "1",
          label: "GATE_RATIO = 4.0",
          explanation:
            "A frame is treated as noise if its energy is below `4× the estimated noise floor`. Raise this and it filters harder (good in noisy rooms); lower it and quiet speech gets through more easily. This is exactly the lever Mic Sensitivity turns.",
        },
        {
          lines: "4",
          label: "CALIB_FRAMES = 25",
          explanation:
            "For the first ~500 ms of the call the gate does nothing but **listen** — it measures the room's background level (the noise floor) before it starts filtering. Gate too early and it would guess wrong.",
        },
        {
          lines: "6-11",
          label: "attenuate, never hard-zero",
          explanation:
            "The single most important comment in this file. An earlier version replaced noise frames with pure silence. That erased short answers like `yes` before any vendor saw them — a bug that hit **every** provider. The fix: scale quiet frames to 15% instead of zero, keeping a whisper of signal so the vendor's own detector can still catch a soft word.",
        },
        {
          lines: "12-14",
          label: "GATE_HANGOVER_FRAMES = 5",
          explanation:
            "Once a real speech frame is seen, the gate stays open for another 100 ms. This stops the tail of a word or a tiny breath-pause mid-sentence from being chopped off.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/audio.ts",
      language: "typescript",
      intro:
        "The gate's decision loop, frame by frame. This is the code the constants above drive.",
      code: `      if (energy < this.noiseFloor * this.gateRatio) {
        if (this.hangoverFrames > 0) {
          // Hangover: a speech frame occurred recently — keep the gate open so
          // brief dips inside/around a short utterance aren't clipped. The
          // noise floor is NOT updated here (the frame may carry a speech tail).
          this.hangoverFrames--;
          out.set(frame, offset);
        } else {
          // Noise frame: update noise floor estimate and attenuate. Never
          // hard-zero — pure digital silence erased short/soft utterances
          // entirely before they reached any STT provider (call 2039).
          this.noiseFloor = NOISE_ALPHA * this.noiseFloor + (1 - NOISE_ALPHA) * energy;
          for (let i = offset; i < end; i++) {
            out[i] = Math.round(filtered[i]! * GATE_ATTENUATION);
          }
        }
      } else {
        // Speech frame: pass through and hold the gate open; do NOT pull the
        // noise floor down — preserve the calibrated background estimate
        // across speech bursts.
        this.hangoverFrames = GATE_HANGOVER_FRAMES;
        out.set(frame, offset);
      }`,
      lines: [
        {
          lines: "1",
          label: "the gate test",
          explanation:
            "If this frame's energy is under `noiseFloor × gateRatio`, it is a candidate for suppression. Otherwise it is speech and passes straight through.",
        },
        {
          lines: "2-7",
          label: "hangover keeps the door open",
          explanation:
            "Even a quiet frame passes unchanged if we recently heard speech — that is the 100 ms hangover protecting word tails and micro-pauses.",
        },
        {
          lines: "12-15",
          label: "attenuate to 15%",
          explanation:
            "A true noise frame: nudge the noise-floor estimate slowly (`NOISE_ALPHA = 0.98`) and multiply every sample by `GATE_ATTENUATION` (0.15). The frame is quietened, not deleted.",
        },
        {
          lines: "18-22",
          label: "speech re-arms hangover",
          explanation:
            "A loud-enough frame passes untouched and resets the hangover counter to 5. Note the noise floor is **not** pulled down during speech, so a loud burst can't fool the gate into thinking the room got louder.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "gotcha",
      title: "The one-word-reply killer",
      body: [
        "If a caller says just `yes` or `okay` and the agent seems to ignore it, the noise gate is the first suspect. Historically hard-zeroing quiet frames deleted these replies before any STT vendor saw them.",
        "That is why the code attenuates to 15% instead of silencing. If you ever tune the gate more aggressively (higher `GATE_RATIO`, or Mic Sensitivity = low), you risk bringing this bug back for very soft speakers. The troubleshooting chapter maps this symptom to its exact fix.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/mic-sensitivity.ts",
      language: "typescript",
      intro:
        "Mic Sensitivity is a single per-agent dashboard lever that scales the gate ratio and the speech-detection floor together. Here are the three presets.",
      code: `const THRESHOLDS: Record<MicSensitivity, MicSensitivityThresholds> = {
  low: {
    gateRatio: 5.0,
    vadThreshold: 110,
    bargeInEnergyThreshold: 1800,
    webcallAecThreshold: 600,
  },
  // Matches the original hardcoded constants exactly.
  normal: {
    gateRatio: 4.0,
    vadThreshold: 100,
    bargeInEnergyThreshold: 1200,
    webcallAecThreshold: 400,
  },
  // ~0.6-0.65x the normal floors — catches quieter caller speech at the cost
  // of letting more background noise through.
  high: {
    gateRatio: 2.5,
    vadThreshold: 60,
    bargeInEnergyThreshold: 800,
    webcallAecThreshold: 250,
  },
};`,
      lines: [
        {
          lines: "2-7",
          label: "low = aggressive filtering",
          explanation:
            "`low` raises `gateRatio` to 5.0 and `vadThreshold` to 110 — best when the caller is in a noisy room with other people talking. It filters hardest, so the quietest replies are most at risk.",
        },
        {
          lines: "9-14",
          label: "normal reproduces the old constants",
          explanation:
            "`normal` is exactly the hardcoded values from before this lever existed, so agents that never set Mic Sensitivity behave identically. `gateRatio: 4.0` matches `GATE_RATIO` in audio.ts.",
        },
        {
          lines: "17-21",
          label: "high = catch soft speech",
          explanation:
            "`high` drops the floors to ~0.6× normal — best in a quiet 1:1 call where even a whispered `yes` must be caught. The trade-off is more background noise leaking through.",
        },
      ],
    },
    {
      kind: "prose",
      heading: "The echo problem",
      paragraphs: [
        "On a real phone line there is no acoustic echo cancellation. The agent's own text-to-speech (TTS) voice gets echoed back down the line and arrives looking exactly like caller audio. If the STT transcribes it, the agent hears itself, thinks the caller interrupted, and derails.",
        "The pipeline learned (across many bug reports referenced in the comments) that you must **not** solve this by blocking the audio feed. Blocking the input during agent speech starved the vendor's detector and made barge-in impossible. Instead, echo is filtered on the **transcript** side — after the words come back, discard any that match the agent's own recent speech.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/pipeline.ts",
      language: "typescript",
      intro:
        "The invariant that governs the whole STT feed. This block sits right before audio is sent to the streaming socket.",
      code: `      // ── INVARIANT — DO NOT GATE OR FLUSH THIS FEED (calls 772→1320) ─────────
      // Every caller frame reaches the streaming-STT socket unconditionally. The
      // local energy VAD above is advisory-only (barge-in / silence watchdog /
      // safety net) — it must never gate this send and never call
      // streamSTT.flush(). Gating the feed during agent playback once starved
      // Sarvam's server VAD (no partials during talk-over → barge-in impossible):
      // the calls-772→1320 regression. The STT provider owns end-of-speech;
      // client code never finalizes turns.
      //
      // Send native 8kHz telephony audio directly when the adapter is configured
      // for it (Sarvam) instead of the linear-interpolation upsample to 16k —
      // avoids manufacturing samples on already-lossy phone audio (see sttSampleRate).
      this.streamSTT.sendAudio(this.sttSampleRate === 8000 ? pcm8k : effectivePcm16k);
      return;`,
      lines: [
        {
          lines: "1-8",
          label: "the DO-NOT-GATE invariant",
          explanation:
            "This comment is a warning to future engineers. Every caller frame goes to the socket, always. The local energy detector is only used to *advise* barge-in and keep watchdogs alive — it must never stop the feed and must never call `flush()`. The provider decides when a turn ends.",
        },
        {
          lines: "13",
          label: "sendAudio — the handoff",
          explanation:
            "The actual send. Sarvam (`sttSampleRate === 8000`) gets the raw 8 kHz frame; every other provider gets the 16 kHz version. This is the exact line where audio leaves the pipeline and enters the adapter's `sendAudio()`.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/pipeline.ts",
      language: "typescript",
      intro:
        "The content-based self-echo guard. When a final transcript comes back, this decides whether it is really the agent's own voice.",
      code: `  private isSelfEcho(transcript: string): boolean {
    if (this.recentAgentSpeech.length === 0) return false;
    const norm = this.normalizeForRepeat(transcript);
    if (!norm) return false;
    const tokens = norm.split(" ").filter(Boolean);
    if (tokens.length === 0) return false;
    // Genuine short replies ("yes", "okay okay", "yes madam", …) must never be
    // discarded as echo of the agent saying "okay?" / "right?" at turn end —
    // that bug ate "yes I have two minutes" style answers and looked like the
    // caller hung up when the call actually stalled listening.
    if (tokens.length === 1 && AFFIRMATIONS.has(tokens[0]!)) return false;
    if (isAffirmationOnlyUtterance(tokens)) return false;
    if (Date.now() < this.expectingShortReplyUntil && tokens.length <= 8) {
      if (tokens.length <= 4) return false;
    }`,
      lines: [
        {
          lines: "1-6",
          label: "tokenise the transcript",
          explanation:
            "`normalizeForRepeat` lowercases and strips punctuation so a fair word-by-word comparison against the agent's recent speech is possible. No recent agent speech → it can't be an echo.",
        },
        {
          lines: "7-12",
          label: "protect genuine short replies",
          explanation:
            "A hard-won carve-out: single affirmations like `yes` are **never** treated as echo, even if the agent just said `okay?`. An earlier version ate these answers and made stalled calls look like hang-ups.",
        },
        {
          lines: "13-15",
          label: "the just-asked-a-question window",
          explanation:
            "If the agent just asked a question (`expectingShortReplyUntil`), short replies (≤4 tokens) are accepted outright. Callers answer fast, and suppressing their answer as echo is far worse than the rare true echo slipping through.",
        },
      ],
    },
    {
      kind: "prose",
      heading: "The STT callback: where words enter",
      paragraphs: [
        "The adapter, once created, is handed two callbacks: one for every transcript (`onTranscript`) and one for when the socket closes. This is the *return* path — words flowing back into the pipeline. Interim transcripts drive barge-in and keep timers alive; only final transcripts get handed to endpointing.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/pipeline.ts",
      language: "typescript",
      intro:
        "The tail of the streaming-STT callback: the branch that fires when a FINAL transcript arrives.",
      code: `          if (!text.trim()) return;
          this.lastCallerActivityAt = Date.now();
          this.streamSTTReconnectAttempts = 0; // reset backoff on successful transcript
          this.resetHangupTimer();
          // NB: safetyNet.onFinal() and language auto-detection are DEFERRED to
          // handleStreamingTranscript so a transcript discarded by the echo guards
          // does NOT clear the stall backstop or drive language switching.
          this._pendingSttLang = lang ?? null;
          this._pendingSttMeta = lang
            ? { ...(metadata ?? {}), detectedLang: lang }
            : (metadata ?? null);
          void this.handleStreamingTranscript(text, Date.now());`,
      lines: [
        {
          lines: "1-4",
          label: "a real transcript resets the clocks",
          explanation:
            "A non-empty final transcript proves the caller spoke and the socket works: reset the reconnect backoff and the silence-hangup timer, and record the moment of activity.",
        },
        {
          lines: "5-7",
          label: "defer the side-effects",
          explanation:
            "Deliberately, the stall-safety-net and language auto-detection are NOT run here. They wait until `handleStreamingTranscript`, because the echo guards there might still throw this transcript away — and a discarded echo must not drive language switching.",
        },
        {
          lines: "8-11",
          label: "carry the detected language",
          explanation:
            "The vendor may report which language it heard (`lang`). It is stashed as pending and folded into the metadata so it lands in the call log next to the latency numbers.",
        },
        {
          lines: "12",
          label: "handoff to endpointing",
          explanation:
            "The final word into `handleStreamingTranscript` — the method that runs the echo guards, then hands the accepted transcript to the endpointing / turn-taking logic. That is where a caller's words finally become an agent turn.",
        },
      ],
    },
    {
      kind: "connections",
      title: "How it connects",
      intro: "One frame's path from phone line to agent turn.",
      nodes: [
        { id: "gate", label: "NoiseCanceller", sublabel: "audio.ts — noise gate", current: true },
        { id: "pipeline", label: "handleProcessedAudio", sublabel: "pipeline.ts — THIS FILE", current: true },
        { id: "echo", label: "isSelfEcho", sublabel: "transcript-side echo guard", current: true },
        { id: "adapter", label: "streamSTT.sendAudio()", sublabel: "the vendor adapter", chapterSlug: "d1-sarvam-stt-complete" },
        { id: "callback", label: "onTranscript", sublabel: "words come back" },
        { id: "endpointing", label: "handleStreamingTranscript", sublabel: "turn-taking" },
      ],
      edges: [
        { from: "gate", to: "pipeline", label: "cleaned 8k/16k PCM" },
        { from: "pipeline", to: "adapter", label: "sendAudio()" },
        { from: "adapter", to: "callback", label: "interim + final" },
        { from: "callback", to: "echo", label: "final transcript" },
        { from: "echo", to: "endpointing", label: "accepted words" },
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          prompt:
            "Why does the noise gate attenuate quiet frames to 15% instead of replacing them with silence?",
          choices: [
            "To save bandwidth on the WebSocket.",
            "Hard-zeroing erased short, soft replies like 'yes' before any STT provider saw them; keeping 15% residual signal lets the vendor's detector still catch a soft word.",
            "Because WAV files cannot contain silence.",
            "To make the call sound quieter to the caller.",
          ],
          correctIndex: 1,
          explanation:
            "The comment in audio.ts is explicit: hard-zeroing caused the provider-independent one-word-reply loss (call 2039). Attenuation preserves a whisper of signal so soft speech onsets survive.",
        },
        {
          prompt:
            "How does the pipeline stop the agent from transcribing its own echoed TTS?",
          choices: [
            "It blocks the audio feed to the STT during agent playback.",
            "It mutes the caller's microphone.",
            "It lets every frame reach the STT, then discards transcripts on the RETURN side that match the agent's own recent speech (isSelfEcho).",
            "It disables the STT vendor's VAD.",
          ],
          correctIndex: 2,
          explanation:
            "Gating the input feed once made barge-in impossible (calls 772→1320). The DO-NOT-GATE invariant sends every frame; echo is filtered on the transcript side by isSelfEcho plus the tail-echo time window.",
        },
        {
          prompt: "What does Mic Sensitivity = 'low' change?",
          choices: [
            "It lowers the STT confidence threshold.",
            "It raises gateRatio to 5.0 and vadThreshold to 110 — filtering harder for noisy rooms, at the risk of dropping very soft replies.",
            "It switches the STT provider to Sarvam.",
            "It disables the noise gate entirely.",
          ],
          correctIndex: 1,
          explanation:
            "'low' means least sensitive / most aggressive filtering. It scales the gate ratio and the speech-detection floor up together, best when nearby background talkers must be rejected.",
        },
      ],
    },
    {
      kind: "keyTakeaways",
      items: [
        "Audio moves in 20 ms frames; the pipeline keeps both an 8 kHz (`pcm8k`) and 16 kHz (`pcm16k`) copy of each.",
        "The adaptive noise gate calibrates for ~500 ms, then attenuates quiet frames to 15% (never zero) with a 100 ms hangover to protect short/soft words.",
        "Mic Sensitivity (low/normal/high) is one dashboard lever that scales `gateRatio` and `vadThreshold` together.",
        "The STT feed is NEVER gated or flushed by client code — the provider owns end-of-speech (the calls-772→1320 invariant).",
        "Echo is filtered on the transcript side: `isSelfEcho` discards words that match the agent's recent speech, but never single affirmations like 'yes'.",
        "Final transcripts flow into `handleStreamingTranscript`, which runs the echo guards and then hands accepted words to endpointing.",
      ],
    },
  ],
};
