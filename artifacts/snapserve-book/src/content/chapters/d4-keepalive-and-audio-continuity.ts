import type { Chapter } from "../types";

export const keepaliveAndAudioContinuity: Chapter = {
  slug: "keepalive-and-audio-continuity",
  moduleId: "d4",
  number: "20.2",
  title: "Keepalive & Audio Continuity",
  summary:
    "How the outbound channel is never allowed to go silent: early ambient during setup, the keepalive watchdog / gap-filler, carrier DTX ambient continuity, and the echo/barge-in interaction at the telephony layer.",
  estMinutes: 20,
  fileRef: "artifacts/api-server/src/orchestration/telephony/early-ambient.ts",
  prerequisites: ["vobiz-stream-complete", "barge-in-and-echo"],
  status: "published",
  blocks: [
    {
      kind: "prose",
      heading: "What & Why",
      paragraphs: [
        "The last chapter ended on a threat: VoBiz drops the call (hangup **4010**) after about 2 seconds of receiving no audio. This chapter is the defence. There are three overlapping systems that guarantee a real audio frame is always going out — during setup, between sentences, and during a mid-sentence stall.",
        "The first is **early ambient keepalive** (`early-ambient.ts`), which runs before the pipeline even exists. The second is the **keepalive watchdog / gap-filler** inside the pipeline's `ambientInterval`. The third — really a side effect of the first two — is **ambient continuity**: because we always send *comfort noise* rather than pure silence, the caller never hears a jarring dead line, and carrier silence-suppression (DTX) never gets a chance to collapse the channel.",
        "We will read the real code for all three, then look at how echo and barge-in interact with this constant stream of outbound audio at the telephony layer.",
      ],
    },
    {
      kind: "concept",
      title: "Comfort noise, dead air, and carrier DTX",
      body: [
        "**Dead air** is literal silence — PCM zeros. It is bad for two reasons: the caller thinks the call dropped, and the carrier's idle timer starts counting toward 4010.",
        "**Comfort noise** is a quiet, natural-sounding background (office ambience, faint hum). It occupies the same 20 ms frame slots as dead air but *sounds alive*. Callers stay on the line; the bridge stays warm.",
        "**DTX** (Discontinuous Transmission) is a carrier trick: when it detects true silence it stops sending packets to save bandwidth, and the far end synthesises its own comfort noise. That is fine for humans, but for a real-time AI bridge it can introduce gaps and confuse the media pipeline. By always emitting real low-level audio, we keep the channel continuously active and side-step DTX entirely.",
      ],
    },
    {
      kind: "analogy",
      title: "A radio DJ never lets the air go silent",
      body: [
        "On live radio, 'dead air' — a few seconds of total silence — is the cardinal sin. Listeners assume the station went off the air and change the channel.",
        "A good DJ always has *something* playing: a bed of music under the talk, a station ident, a jingle. Our keepalive is that bed of sound. Whether the agent is thinking, the DB is loading, or the caller just paused, there is always a quiet something on the line — so neither the caller nor the carrier ever thinks the call died.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/telephony/early-ambient.ts",
      language: "typescript",
      intro:
        "early-ambient.ts exists for one window: the seconds between the WebSocket opening and the pipeline being ready. It ticks every 20 ms with instant comfort noise, then upgrades to the agent's configured track.",
      code: `const INTERVAL_MS = 20;
const PCM_SILENCE = Buffer.alloc((8000 * INTERVAL_MS) / 1000 * 2, 0); // 160 samples x 2 bytes
const MULAW_SILENCE = Buffer.alloc((8000 * INTERVAL_MS) / 1000, 0xff); // mu-law silence

export function startEarlyAmbientKeepalive(opts: {
  agentId: number;
  format: EarlyAmbientFormat;
  send: (chunk: Buffer) => void;
}): EarlyAmbientKeepalive {
  let stopped = false;
  // Instant comfort noise - no DB. Replaced when agent ambient resolves.
  let stream: AmbientChunker | null = new AmbientNoiseStream("office-ambience");
  let useSilence = false;`,
      lines: [
        {
          lines: "1-3",
          label: "the 20 ms frame budget",
          explanation:
            "8 kHz means 160 samples per 20 ms frame. L16 (`PCM_SILENCE`) is 2 bytes/sample = 320 bytes; μ-law (`MULAW_SILENCE`) is 1 byte/sample = 160 bytes, and μ-law silence is `0xff`, not `0x00`. These are the fall-back frames used only when there is genuinely nothing else to send.",
        },
        {
          lines: "5-9",
          label: "the send callback",
          explanation:
            "The caller passes in a `send` function and a `format`. The VoBiz handler passes `format: \"pcm16\"` and a send that wraps `sendAudioToVobiz`; the Plivo handler passes `format: \"mulaw\"`. This module never touches the socket directly.",
        },
        {
          lines: "11-13",
          label: "instant comfort noise, no DB wait",
          explanation:
            "It starts a built-in `office-ambience` stream **synchronously** — no database read. That means the very first frame is real comfort noise, not silence, even before we know which ambient track the agent configured.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/telephony/early-ambient.ts",
      language: "typescript",
      intro:
        "The tick function and the timer. The first frame fires immediately, then every 20 ms, and a background task upgrades the stream to the agent's real ambient track when the DB read completes.",
      code: `  const tick = (): void => {
    if (stopped) return;
    let chunk: Buffer;
    if (useSilence || !stream) {
      chunk = opts.format === "pcm16" ? PCM_SILENCE : MULAW_SILENCE;
    } else {
      chunk = opts.format === "pcm16" ? stream.nextPcmChunk() : stream.nextMulawChunk();
    }
    try {
      opts.send(chunk);
    } catch {
      /* WS may already be closing */
    }
  };

  const timer = setInterval(tick, INTERVAL_MS);
  tick(); // first frame immediately - don't wait 20ms`,
      lines: [
        {
          lines: "4-7",
          label: "comfort noise vs silence",
          explanation:
            "If the agent has ambient turned OFF (`useSilence`), we still send a frame every 20 ms — just silence — purely to keep the bridge alive against 4010. Otherwise we pull a real ambient chunk in the correct encoding for this call.",
        },
        {
          lines: "9-13",
          label: "swallow send errors",
          explanation:
            "The socket can close between ticks. Wrapping `send` in try/catch means a closing WS never throws an unhandled error out of a timer callback.",
        },
        {
          lines: "16-17",
          label: "fire immediately, then every 20 ms",
          explanation:
            "`setInterval` waits 20 ms before its first call — a whole frame of dead air at the most sensitive moment (call just answered). Calling `tick()` once manually right after fixes that: frame zero goes out instantly.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "tip",
      title: "stop() must be idempotent and leak-free",
      body: [
        "`stop()` sets `stopped = true` and clears the interval. The VoBiz/Plivo handlers call it from several places: the first real audio frame, the safety-net right after session-ready, `onCallEnd`, and the error path. It can therefore be called many times.",
        "The guard `if (stopped) return;` at the top makes repeat calls harmless, and clearing the timer means the 20 ms ticker never leaks past the keepalive window. A leaked interval would keep two senders on the socket — the exact recipe for the chopped 'helicopter' artifact.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/telephony/early-ambient.ts",
      language: "typescript",
      intro:
        "The upgrade path: a single light DB read resolves the agent's ambient config and swaps the built-in comfort noise for the configured track (built-in, cached upload, or DB-loaded upload).",
      code: `  void resolveAndUpgrade(opts.agentId)
    .then((resolved) => {
      if (stopped) return;
      if (!resolved) return; // keep comfort noise
      if (!resolved.enabled || !resolved.track) {
        useSilence = true;
        stream = null;
        return;
      }
      stream = resolved.stream;
      useSilence = false;
    })
    .catch((err) => {
      logger.warn({ agentId: opts.agentId, err }, "early-ambient: agent track resolve failed - keeping comfort noise");
    });`,
      lines: [
        {
          lines: "1-4",
          label: "fire-and-forget upgrade",
          explanation:
            "`void` means we do not await this — the ticker is already running on comfort noise. When the DB read finishes we quietly upgrade. If `stopped` by then (fast session setup), we do nothing.",
        },
        {
          lines: "5-8",
          label: "agent ambient OFF → silence",
          explanation:
            "If the agent explicitly disabled ambient, we switch to silent keepalive frames. We still keep ticking — silence keeps VoBiz's bridge alive — but the caller hears nothing extra.",
        },
        {
          lines: "13-15",
          label: "failure keeps comfort noise",
          explanation:
            "If the DB read throws, we do NOT stop or go silent — we keep the built-in comfort noise running. A telephony keepalive must degrade gracefully; a DB blip should never turn into dead air and a 4010 drop.",
        },
      ],
    },
    {
      kind: "prose",
      heading: "Handing off to the pipeline watchdog",
      paragraphs: [
        "Once `createSession` returns, early-ambient is stopped and the pipeline takes over continuity with its own `ambientInterval`. This is the second system: a **watchdog** that runs for the entire life of the call, not just setup.",
        "The subtle problem it solves: during a turn, the TTS pump is paused between sentences while the LLM produces the next chunk, AND the audio drain queue can momentarily empty during a streaming stall. When both happen at once, agent voice and ambient both go dead — and 2 seconds of that is a 4010 drop. The watchdog watches the clock and fills any gap.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/pipeline.ts",
      language: "typescript",
      intro:
        "The watchdog constants. The key tuning value is KEEPALIVE_FILL_GAP_MS = 500 — small enough to beat the 2 s drop, large enough not to interleave silence into healthy bursty TTS.",
      code: `      const KEEPALIVE_FRAME_MS      = 20;
      const VOBIZ_SILENCE_SAMPLES   = (8000 * KEEPALIVE_FRAME_MS) / 1000; // 160 @ 8 kHz
      const vobizSilenceFrame       = Buffer.alloc(VOBIZ_SILENCE_SAMPLES * 2, 0); // PCM16-LE zeros
      const KEEPALIVE_FILL_GAP_MS   = 500; // watchdog: only fill a GENUINE mid-sentence stall
      // 500 ms, not 60 ms: at 60 ms the pump fired on ordinary streaming jitter / burst
      // delivery ... so it interleaved silence/ambient frames INTO live speech and produced
      // a chopping "helicopter" artifact on the carrier. A real TTS underrun that risks
      // VoBiz's ~2 s inactivity drop (hangup 4010) lasts far longer than jitter, so 500 ms
      // only kicks in for a true stall while staying comfortably below the 2 s drop.`,
      lines: [
        {
          lines: "3",
          label: "the pure-silence fallback frame",
          explanation:
            "A pre-allocated 320-byte L16-zero frame. Used only when there is no ambient stream and the provider is VoBiz — the bare-minimum 'keep the bridge alive' packet.",
        },
        {
          lines: "4-9",
          label: "why 500 ms, not 60 ms",
          explanation:
            "Streaming TTS does NOT deliver a frame every 20 ms — chunks arrive in bursts and the drain empties them. A 60 ms threshold fired on that normal jitter and interleaved silence INTO real speech, chopping it ('helicopter'). 500 ms is longer than any jitter burst but well under the 2 s drop, so it only triggers on a genuine underrun.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/pipeline.ts",
      language: "typescript",
      intro:
        "The interval body. It measures the gap since the last REAL TTS frame and fills only when the channel is genuinely idle — while respecting sender exclusivity on the voicemail path.",
      code: `      this.ambientInterval = setInterval(() => {
        if (this.amdVmManualPumpActive) {
          return;
        }
        const gapMs = Date.now() - this.lastTtsFrameAt;
        if (!this.closed && (!this.isSendingTtsAudio || gapMs >= KEEPALIVE_FILL_GAP_MS)) {
          if (this.ambientStream) {
            const chunk = this.config.rawPcmOutput
              ? this.ambientStream.nextPcmChunk()
              : this.ambientStream.nextMulawChunk();
            this.config.onAudioOut(chunk);
          } else if (this.config.telephonyProvider === "vobiz") {
            // No ambient stream - send PCM zeros to keep the VoBiz audio
            // bridge alive during listening (prevents 4010 hangup on pauses).
            this.config.onAudioOut(vobizSilenceFrame);
          }
        }
      }, KEEPALIVE_FRAME_MS);`,
      lines: [
        {
          lines: "2-4",
          label: "sender exclusivity",
          explanation:
            "During AMD confirmation and voicemail delivery, a dedicated loop pumps its own 20 ms frames. If the watchdog ALSO sent, two senders on the same cadence would double the frame rate and chop the audio. `amdVmManualPumpActive` makes the watchdog stand down; normal calls never set it.",
        },
        {
          lines: "5-6",
          label: "the two-clause fire condition",
          explanation:
            "Fill a frame when either (a) `!isSendingTtsAudio` — we're between sentences or listening, OR (b) a sentence is nominally in progress but no real frame has gone out for 500 ms — the TTS first-byte wait or a mid-stream stall. During healthy streaming a real frame lands every ~20 ms, `gapMs` stays small, and this skips (no double-send).",
        },
        {
          lines: "7-10",
          label: "ambient continuity",
          explanation:
            "If the agent has ambient configured, the fill frame is real comfort noise in the correct encoding (`rawPcmOutput` → PCM for web/VoBiz, else μ-law). This is what keeps the line sounding alive during every pause — ambient continuity.",
        },
        {
          lines: "11-15",
          label: "the bare VoBiz keepalive",
          explanation:
            "No ambient stream and provider is VoBiz? Send zero frames anyway. It sounds like silence but it is real packets — enough to keep the bridge alive and dodge the 4010 idle drop on a long caller pause.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/pipeline.ts",
      language: "typescript",
      intro:
        "The watchdog only knows the channel is 'live' because playSentence stamps `lastTtsFrameAt` on every real frame. And `armTailEchoGrace` re-stamps it the instant playback ends, so entering Listening never looks like a dead channel.",
      code: `  private armTailEchoGrace(): void {
    this.bargeInHoldUntil = Date.now() + this.bargeInEchoGraceMs;
    // Keep the VoBiz/ambient audio bridge warm the instant we enter Listening -
    // a multi-hundred-ms dead zone after TTS can look like End Of XML (4010)
    // and surface in the UI as "Caller hung up" even though the phone stayed up.
    this.lastTtsFrameAt = Date.now();
  }`,
      lines: [
        {
          lines: "2",
          label: "arm the tail-echo grace",
          explanation:
            "When a sentence finishes, the agent's own trailing audio can echo back through the carrier. `bargeInHoldUntil` suppresses barge-in for a short grace window so that returning echo can't trigger a fake interruption or a spurious new turn that clips the final words.",
        },
        {
          lines: "6",
          label: "re-stamp lastTtsFrameAt",
          explanation:
            "This is the continuity hand-off. Playback just ended, so no more real frames are coming — but if `lastTtsFrameAt` stayed old, the watchdog's 500 ms clause wouldn't fire for up to 500 ms and the caller could hit dead air. Re-stamping to `now` means the watchdog resumes ambient fill immediately as we enter Listening.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "insight",
      title: "Echo and barge-in live on the same wire as keepalive",
      body: [
        "Because we are always sending outbound audio (TTS, ambient, or keepalive), the carrier always routes a little of it back to us as sidetone/echo, arriving on the inbound `media` track that also carries the caller's voice.",
        "That is why barge-in at the telephony layer needs echo protection: `bargeInHoldUntil` (a short grace after playback starts/ends) and a self-calibrating echo floor stop the agent's own returning voice from triggering a false 'the caller interrupted!' event. When a real interruption IS detected, the VoBiz handler's `sendBargeIn` fires `clearAudio` to flush VoBiz's playback buffer — the telephony-layer half of barge-in.",
      ],
    },
    {
      kind: "connections",
      title: "How it connects",
      intro:
        "Three continuity systems, one goal: never let the outbound channel go silent. Click to explore.",
      nodes: [
        { id: "vobiz", label: "handleVobizWebSocket", sublabel: "starts early ambient", chapterSlug: "vobiz-stream-complete" },
        { id: "early", label: "early-ambient.ts", sublabel: "THIS FILE — setup window", current: true },
        { id: "watchdog", label: "ambientInterval", sublabel: "pipeline.ts — whole-call watchdog", current: true },
        { id: "playsentence", label: "playJob / drain", sublabel: "stamps lastTtsFrameAt", chapterSlug: "session-and-pipeline" },
        { id: "bargein", label: "barge-in & echo", sublabel: "shares the inbound track", chapterSlug: "barge-in-and-echo" },
      ],
      edges: [
        { from: "vobiz", to: "early", label: "startEarlyAmbientKeepalive" },
        { from: "early", to: "watchdog", label: "stop() → hand off" },
        { from: "playsentence", to: "watchdog", label: "lastTtsFrameAt" },
        { from: "watchdog", to: "bargein", label: "outbound echo returns" },
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          prompt: "Why does `startEarlyAmbientKeepalive` call `tick()` once immediately after creating the `setInterval`?",
          choices: [
            "To test that the socket is open.",
            "Because `setInterval` waits a full 20 ms before its first call, which would be a frame of dead air at the most sensitive moment — the call just answered.",
            "To load the agent's ambient track faster.",
            "To measure round-trip latency.",
          ],
          correctIndex: 1,
          explanation:
            "setInterval delays its first invocation by the interval. Calling tick() manually sends frame zero instantly, so the caller hears comfort noise from the very first millisecond and the bridge is immediately warm.",
        },
        {
          prompt: "The keepalive watchdog uses `KEEPALIVE_FILL_GAP_MS = 500`. Why not 60 ms?",
          choices: [
            "60 ms is too fast for the CPU.",
            "Streaming TTS arrives in bursts, not one frame per 20 ms; a 60 ms threshold fired on normal jitter and interleaved silence into live speech, causing a chopped 'helicopter' artifact. 500 ms only triggers on a genuine underrun while staying under the 2 s drop.",
            "VoBiz requires exactly 500 ms frames.",
            "60 ms would exceed the 2 s drop limit.",
          ],
          correctIndex: 1,
          explanation:
            "TTS is bursty and the drain empties chunks. 60 ms mistook normal jitter for a stall and injected silence mid-speech. 500 ms is longer than any jitter burst yet well below the ~2 s 4010 drop.",
        },
        {
          prompt: "What does `armTailEchoGrace` re-stamping `lastTtsFrameAt = Date.now()` accomplish?",
          choices: [
            "It restarts the whole call.",
            "It makes the watchdog immediately resume ambient fill as the agent enters Listening, so the post-TTS moment never looks like a dead channel (which can surface as a false 'Caller hung up').",
            "It disables barge-in permanently.",
            "It bills the caller for the pause.",
          ],
          correctIndex: 1,
          explanation:
            "Playback just ended, so no more real frames are coming. Re-stamping the timestamp to now keeps the watchdog's gap small so it fills ambient right away, preventing a dead zone that could read as End Of XML (4010).",
        },
      ],
    },
    {
      kind: "keyTakeaways",
      items: [
        "Three systems keep the outbound channel alive: early-ambient (setup window), the pipeline `ambientInterval` watchdog (whole call), and always sending comfort noise instead of dead air.",
        "8 kHz = 160 samples per 20 ms frame: 320 bytes L16, 160 bytes μ-law (μ-law silence is 0xff).",
        "early-ambient starts built-in comfort noise synchronously (no DB), fires the first frame immediately, then upgrades to the agent's configured track — degrading to comfort noise if the DB read fails.",
        "The watchdog fills a gap only when the channel is genuinely idle (`!isSendingTtsAudio` OR 500 ms since the last real frame), and stands down when the AMD/voicemail manual pump owns the channel.",
        "`lastTtsFrameAt` is the watchdog's heartbeat; `armTailEchoGrace` re-stamps it entering Listening so no dead zone forms.",
        "Because we always send outbound audio, echo returns on the inbound track — so telephony-layer barge-in needs echo-grace windows before it fires `clearAudio` to flush the carrier buffer.",
      ],
    },
  ],
};
