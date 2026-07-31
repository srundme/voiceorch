import type { Chapter } from "../types";

export const sarvamSttComplete: Chapter = {
  slug: "d1-sarvam-stt-complete",
  moduleId: "d1",
  number: "17.2",
  title: "The Sarvam STT Adapter, Top to Bottom",
  summary:
    "The Indic-language specialist walked through completely: language maps, Sarvam modes, adaptive coalescing, the one-word fast-path, and the zombie-socket heartbeat.",
  estMinutes: 28,
  fileRef: "artifacts/api-server/src/orchestration/adapters/stt/sarvam.ts",
  prerequisites: ["d1-stt-pipeline-path", "stt-adapters"],
  status: "published",
  blocks: [
    {
      kind: "prose",
      heading: "What & Why",
      paragraphs: [
        "Sarvam is our specialist for Indian languages — Tamil, Hindi, Telugu, Kannada, Malayalam and up to eighteen more. It is also our most complex adapter, because Indian phone calls are hard: callers code-switch (Tanglish, Hinglish), pause mid-thought, and answer with a single word. This file is packed with logic that exists only because a real call went wrong.",
        "We will walk it top to bottom. Skipping only the plain imports, every important block is quoted from the real file so that, chained together, you have effectively read the whole adapter.",
        "Two big ideas dominate: **language + mode resolution** (which model, which script) and **adaptive transcript coalescing** (deciding when the caller has actually finished versus is just pausing to think).",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/stt/sarvam.ts",
      language: "typescript",
      intro:
        "The file opens with a protocol cheat-sheet discovered by live probing. This is the audio-message trap and the close-code playbook.",
      code: ` * ── Audio message (JSON text, sent as each PCM chunk arrives) ────────────────
 *   { audio: { data: "<base64 raw PCM>", encoding: "audio/wav", sample_rate: 16000 } }
 *   NOTE: encoding enum MUST be "audio/wav" — "pcm_s16le" is rejected by Sarvam's
 *   Pydantic model even though the URL param \`input_audio_codec=pcm_s16le\` sets
 *   the actual codec. Confirmed via live WebSocket probe (June 2026).
 *
 * ── Close codes ──────────────────────────────────────────────────────────────
 *   1000 Normal closure (intentional)
 *   1001 Going away        — reconnect
 *   1006 Abnormal (no close frame) — reconnect with backoff
 *   1011 Server error      — reconnect with backoff
 *   4xxx Auth / quota      — do NOT retry; fix first`,
      lines: [
        {
          lines: "1-2",
          label: "audio is base64 JSON, not binary",
          explanation:
            "Unlike Deepgram (raw binary), Sarvam wants each PCM chunk wrapped in a JSON message with the bytes base64-encoded. Different vendor, different dialect — hidden behind the same `sendAudio()` interface.",
        },
        {
          lines: "3-5",
          label: "the encoding-enum trap",
          explanation:
            "The `encoding` field must literally say `audio/wav`, even though the audio is raw PCM. Sending the technically-correct `pcm_s16le` gets rejected by Sarvam's server-side validation. Discovered by probing the live socket and written down so nobody rediscovers it the hard way.",
        },
        {
          lines: "7-12",
          label: "close-code recovery policy",
          explanation:
            "1001/1006/1011 are transient — reconnect with backoff. 4xxx means auth or quota: retrying just burns money, so those must NOT retry. This table drives the `ws.on(\"close\")` handler later in the file.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/stt/sarvam.ts",
      language: "typescript",
      intro:
        "Two language sets: the 11 languages every model supports, and the extra 12 that only saaras:v3 handles.",
      code: `const CORE_LANG = new Set([
  "bn-IN", "en-IN", "gu-IN", "hi-IN", "kn-IN",
  "ml-IN", "mr-IN", "od-IN", "pa-IN", "ta-IN", "te-IN",
]);

const SAARAS_EXTRA_LANG = new Set([
  "as-IN", "brx-IN", "doi-IN", "kok-IN", "ks-IN", "mai-IN",
  "mni-IN", "ne-IN", "sa-IN", "sat-IN", "sd-IN", "ur-IN",
]);

const LANG_MAP: Record<string, string> = {
  bn: "bn-IN", en: "en-IN", gu: "gu-IN", hi: "hi-IN",
  kn: "kn-IN", ml: "ml-IN", mr: "mr-IN",
  or: "od-IN", od: "od-IN",             // Odia: BCP-47 is or-IN but Sarvam uses od-IN
  pa: "pa-IN", ta: "ta-IN", te: "te-IN",
  as: "as-IN", brx: "brx-IN", doi: "doi-IN", kok: "kok-IN", ks: "ks-IN",
  mai: "mai-IN", mni: "mni-IN", ne: "ne-IN", sa: "sa-IN", sat: "sat-IN",
  sd: "sd-IN", ur: "ur-IN",
};`,
      lines: [
        {
          lines: "1-4",
          label: "CORE_LANG — the 11-language set",
          explanation:
            "These BCP-47 codes are accepted by every Sarvam STT model, including the legacy `saarika:v2.5`. Note `od-IN` for Odia — Sarvam uses `od`, not the standard `or`.",
        },
        {
          lines: "6-9",
          label: "SAARAS_EXTRA_LANG — the +12",
          explanation:
            "Languages only `saaras:v3` supports (Urdu, Nepali, Assamese, Sanskrit…). Previously these silently fell back to English even on v3; now they are explicitly allowed when the model is a saaras model.",
        },
        {
          lines: "11-19",
          label: "LANG_MAP — bare code to BCP-47",
          explanation:
            "If someone passes `ta` instead of `ta-IN`, this map upgrades it. The `or`/`od` double entry handles the Odia mismatch. This is how sloppy language config still resolves to a valid Sarvam locale.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/stt/sarvam.ts",
      language: "typescript",
      intro:
        "normaliseLang ties the two sets together and always returns something valid.",
      code: `function normaliseLang(code: string | null | undefined, model: string): string {
  if (!code) return "en-IN";
  const isValid = (c: string) =>
    CORE_LANG.has(c) || (model.startsWith("saaras") && SAARAS_EXTRA_LANG.has(c));
  const t = code.trim();
  if (isValid(t)) return t;
  const bare = t.split("-")[0]?.toLowerCase() ?? "";
  const mapped = LANG_MAP[bare];
  if (mapped && isValid(mapped)) return mapped;
  logger.warn({ rawLang: code, model }, "Sarvam STT: unsupported language for this model — falling back to en-IN");
  return "en-IN";
}`,
      lines: [
        {
          lines: "2",
          label: "no code → en-IN",
          explanation:
            "A missing language defaults to Indian English. Sarvam always needs a language hint.",
        },
        {
          lines: "3-4",
          label: "model-aware validity",
          explanation:
            "A language is valid if it is in the core set, OR it is a saaras-extra AND we are running a saaras model. This is why choosing `saarika:v2.5` silently loses Urdu support.",
        },
        {
          lines: "6-9",
          label: "try the full code, then the bare code",
          explanation:
            "First check the code as-is; if not valid, strip to the bare form and look it up in `LANG_MAP`. Only accept the mapping if it is valid for this model.",
        },
        {
          lines: "10-11",
          label: "the silent-fallback warning",
          explanation:
            "If nothing works it logs a warning and returns `en-IN`. If your Tamil agent is transcribing in English, this warning line is the smoking gun — check the troubleshooting chapter.",
        },
      ],
    },
    {
      kind: "concept",
      title: "Sarvam 'modes' decide the output script",
      body: [
        "`saaras:v3` supports a `mode` parameter that controls how mixed-language speech is written down. The two that matter here: `transcribe` writes clean native script (Tamil words in Tamil letters), and `codemix` keeps English words in English letters even inside an Indic sentence.",
        "The rule is simple: English defaults to `codemix` (so `business` stays as `business`, not mangled into Tamil letters), and every Indic language defaults to `transcribe` (so you get clean native script, not English-in-Indic-script garble). An explicit agent setting always wins.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/stt/sarvam-mode.ts",
      language: "typescript",
      intro:
        "The whole mode-resolution function. Small, but it fixes a real Tanglish bug.",
      code: `export function resolveSarvamSttMode(
  languageCode: string | null | undefined,
  explicitMode?: string | null,
): SarvamSttMode {
  if (explicitMode && VALID_MODES.has(explicitMode)) {
    return explicitMode as SarvamSttMode;
  }
  const lang = (languageCode ?? "en-IN").toLowerCase();
  return lang.startsWith("en") ? "codemix" : "transcribe";
}`,
      lines: [
        {
          lines: "5-7",
          label: "explicit mode wins",
          explanation:
            "If the agent config names a valid mode, use it verbatim — no guessing.",
        },
        {
          lines: "8-9",
          label: "the en → codemix, else → transcribe rule",
          explanation:
            "English calls get `codemix` (English words stay in Latin script even when Hindi/Tamil sneaks in). Any Indic language gets `transcribe` for clean native-script output. This uniform rule replaced an older one that only matched 8 of 22 languages and let the rest fall through to codemix.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/stt/sarvam.ts",
      language: "typescript",
      intro:
        "The constructor picks the model, resolves language and mode, and reads the coalescing tunables from agent config.",
      code: `    const requested = (model ?? "").trim();
    this.model = ["saaras:v3", "saarika:v2.5"].includes(requested)
      ? requested
      : "saaras:v3";

    this.langCode = normaliseLang(cfg.language, this.model);
    this.explicitMode = extra.mode ?? null;

    this.mode = MODE_CAPABLE.has(this.model)
      ? resolveSarvamSttMode(this.langCode, this.explicitMode)
      : "transcribe";

    this.highVadSensitivity = typeof extra.highVadSensitivity === "boolean"
      ? extra.highVadSensitivity
      : true;`,
      lines: [
        {
          lines: "1-4",
          label: "only two valid streaming models",
          explanation:
            "The streaming endpoint accepts only `saaras:v3` or `saarika:v2.5`. Anything else (including the never-valid `saaras:v2.5`) is normalised to `saaras:v3`, so a stale stored value can't 400 the socket into a reconnect loop.",
        },
        {
          lines: "6-11",
          label: "language, then mode",
          explanation:
            "Language is normalised first; mode is resolved only if the model supports it (`MODE_CAPABLE`), otherwise it is forced to `transcribe`.",
        },
        {
          lines: "13-15",
          label: "highVadSensitivity defaults true",
          explanation:
            "High VAD (voice-activity-detection) sensitivity means Sarvam declares end-of-speech faster (~64 ms of silence vs ~1 s). We default it on for snappier turns.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/stt/sarvam.ts",
      language: "typescript",
      intro:
        "buildWsUrl assembles the query string. Language is mutable so a live language switch can reconnect with a new hint.",
      code: `    const buildWsUrl = (): string => {
      const params = new URLSearchParams({
        model:              model,
        language_code:      langCode,
        sample_rate:        String(sampleRate),
        input_audio_codec:  "pcm_s16le",
        high_vad_sensitivity: this.highVadSensitivity ? "true" : "false",
        vad_signals:        "true",    // emit speech_start / speech_end events
        flush_signal:       "true",    // allow manual buffer flush via flush() call
      });
      if (MODE_CAPABLE.has(model)) {
        params.set("mode", mode);
      }
      return \`\${WS_BASE}?\${params.toString()}\`;
    };`,
      lines: [
        {
          lines: "5-6",
          label: "codec in the URL, enum in the message",
          explanation:
            "Here is the counterpart to the earlier trap: the *actual* codec is set via `input_audio_codec=pcm_s16le` in the URL, while each audio message still claims `encoding: audio/wav`. Both are required.",
        },
        {
          lines: "7",
          label: "vad_signals: true",
          explanation:
            "Turns on the `speech_start` / `speech_end` events the adapter relies on to decide when the caller paused versus stopped.",
        },
        {
          lines: "8",
          label: "flush_signal: true",
          explanation:
            "Lets the adapter's `flush()` method ask Sarvam to finalise its buffer immediately — used for teardown, never during a live turn.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/stt/sarvam.ts",
      language: "typescript",
      intro:
        "sendChunk is where each PCM buffer becomes the base64-JSON audio message.",
      code: `    const sendChunk = (chunk: Buffer) => {
      if (!wsReady || ws.readyState !== WebSocket.OPEN) return;
      const now = Date.now();
      if (now - lastAudioSentAt > WS_DEAD_MS) lastMsgAt = now;
      ws.send(
        JSON.stringify({
          audio: {
            data:        chunk.toString("base64"),
            encoding:    "audio/wav",   // enum must be "audio/wav"; actual codec is set via URL param
            sample_rate: sampleRate,
          },
        }),
      );
      lastAudioSentAt = now; // proves we are ACTIVELY streaming — gates the zombie detector
    };`,
      lines: [
        {
          lines: "4",
          label: "reset the silence clock after a gap",
          explanation:
            "If we haven't sent audio for a while (e.g. AMD confirmation or agent playback), grant Sarvam a fresh dead-socket window so the very next chunk doesn't trip a false zombie detection.",
        },
        {
          lines: "7-11",
          label: "the audio message shape",
          explanation:
            "Base64 the raw bytes, tag `encoding: audio/wav` (the trap), and include the sample rate. This exact JSON is what Sarvam expects on every chunk.",
        },
        {
          lines: "14",
          label: "lastAudioSentAt gates the zombie check",
          explanation:
            "Recording when we last sent audio lets the heartbeat distinguish 'socket is dead' from 'we simply have nothing to send right now'.",
        },
      ],
    },
    {
      kind: "concept",
      title: "Adaptive coalescing — the heart of the adapter",
      body: [
        "Sarvam finalises quickly. But callers pause mid-sentence to think. If we emit the moment Sarvam finalises, we cut people off. If we wait too long, the agent feels slow.",
        "The fix is a self-calibrating **hold window**. When a transcript segment arrives, the adapter buffers it and starts a timer. If the caller resumes before the timer fires, the segment is merged (coalesced) with the next one. The hold length adapts to *this caller's* pause rhythm: fast talkers get ~120 ms, slow talkers ~500 ms.",
        "Two exceptions override the adaptive window: a fragment that **looks incomplete** waits longer, and a known one-word reply (`yes`, `சரி`, `हाँ`) is dispatched almost instantly.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/stt/sarvam.ts",
      language: "typescript",
      intro:
        "The adaptive hold. pauseHistory records recent mid-sentence pauses; adaptiveHoldMs picks a window from them.",
      code: `    const COALESCE_MIN_MS        = 120;
    const COALESCE_DEFAULT_MS    = 220;
    const COALESCE_MAX_MS        = 500;  // raised from 350 — covers ~400ms thinking pauses
    const COALESCE_INCOMPLETE_MS = this.incompleteHoldMs;
    const SPEECH_END_FLUSH_MS    = this.speechEndFlushMs;

    function adaptiveHoldMs(): number {
      if (pauseHistory.length < 2) return COALESCE_DEFAULT_MS;
      const avg = pauseHistory.reduce((a, b) => a + b, 0) / pauseHistory.length;
      if (avg < 150) return COALESCE_MIN_MS;
      if (avg < 400) return COALESCE_DEFAULT_MS;
      return COALESCE_MAX_MS;
    }`,
      lines: [
        {
          lines: "1-3",
          label: "the three window sizes",
          explanation:
            "Fast speakers → 120 ms, medium → 220 ms, slow/older callers → 500 ms. The max was raised from 350 to cover longer thinking pauses.",
        },
        {
          lines: "4-5",
          label: "the UI-tunable holds",
          explanation:
            "`COALESCE_INCOMPLETE_MS` (default 220) is how long an incomplete fragment waits; `SPEECH_END_FLUSH_MS` (default 30) is how fast to flush once Sarvam says the caller stopped. Both come from the agent's Latency Tuning UI.",
        },
        {
          lines: "7-13",
          label: "seed, then converge",
          explanation:
            "Until 2 real pauses are observed it uses the 220 ms default; then it averages the recent pauses and snaps to the nearest band. It converges within 2-3 turns of natural speech.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/stt/sarvam.ts",
      language: "typescript",
      intro:
        "The one-word fast-path. This set of complete single words bypasses the incomplete-hold so 'yes' dispatches in ~30 ms.",
      code: `    const COMPLETE_SINGLE_WORDS = new Set([
      // English — affirmatives / negatives / acknowledgements / greetings
      "yes", "no", "ok", "okay", "sure", "fine", "right", "correct", "wrong",
      "good", "great", "perfect", "excellent", "absolutely", "definitely",
      "yeah", "yep", "yup", "nope", "nah", "alright",
      // Tamil — affirmatives / negatives / acknowledgements / greetings
      "ஆம்", "இல்ல", "இல்லை", "சரி", "ஓகே", "ஹலோ", "ஹலொ",
      "நன்றி", "சரிங்க", "ஆமாம்", "இல்லங்க", "ஓகேங்க", "சரிங்கள",
      // Hindi — affirmatives / negatives / acknowledgements / greetings
      "हाँ", "हां", "नहीं", "ना", "ठीक", "ओके", "हेलो", "हाँजी", "हांजी",
      // Telugu, Kannada, Malayalam common acks
      "అవును", "కాదు", "సరే", "ఓకే", "హలో",
      "ಹೌದು", "ಇಲ್ಲ", "ಸರಿ", "ಓಕೆ", "ಹಲೋ",
      "അതെ", "ഇല്ല", "ശരി", "ഓകെ", "ഹലോ",
    ]);`,
      lines: [
        {
          lines: "1-14",
          label: "complete replies in five languages",
          explanation:
            "These words are complete answers on their own. Without this set, a lone `yes` would sit in the incomplete-hold waiting for 'more words' that never come, adding 800+ ms of latency. Listing them lets `yes` / `ஆம்` / `हाँ` fire on the fast ~30 ms path.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "insight",
      title: "The 'yes' problem is a latency problem, not an accuracy one",
      body: [
        "Sarvam hears `yes` perfectly. The old bug was that the coalescing logic assumed one word meant the caller was mid-thought, so it held the transcript waiting for more. This whitelist tells the adapter which single words are genuinely complete.",
        "This is why the troubleshooting chapter maps 'agent slow to react to yes/no' to the coalescing tunables, not to the STT model.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/stt/sarvam.ts",
      language: "typescript",
      intro:
        "looksIncomplete is the opposite check: a fragment that grammatically needs more words. Here is the single-word branch and a Tamil-suffix example.",
      code: `    function looksIncomplete(text: string): boolean {
      const t = text.trim();
      const words = t.split(/\\s+/);
      if (words.length === 0) return false;
      if (words.length === 1) {
        const w = words[0].toLowerCase().replace(/[।,!?.]+$/, "");
        return DANGLING_SINGLE_CONNECTORS.has(w) || DANGLING_SINGLE_CONNECTORS.has(words[0]);
      }
      const last = words[words.length - 1];
      // Tamil possessive / genitive suffixes → more to come
      if (/[ஓோ]ட$|உடைய$|களோட$/.test(last)) return true;
      // Tamil dative, locative, instrumental markers
      if (/க்கு$|கிட்ட$|கிட்டே$|னால$|னாலே$|ஐ$/.test(last)) return true;`,
      lines: [
        {
          lines: "5-8",
          label: "single word: only dangling connectors are incomplete",
          explanation:
            "A lone word is incomplete ONLY if it is a connector like `and` / `but` / `ஆனா`. Every other single word (names, numbers, yes/no) is treated as complete and emits immediately — the mirror image of the fast-path set.",
        },
        {
          lines: "10-13",
          label: "Tamil grammar awareness",
          explanation:
            "If a Tamil word ends in a possessive (`-ஓட`), or a case marker (`-க்கு` dative, `-கிட்ட` locative), the sentence's predicate is still coming — hold longer. This grammar knowledge is why the adapter doesn't cut Tamil speakers off mid-sentence.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/stt/sarvam.ts",
      language: "typescript",
      intro:
        "The transcript handler ties it together: buffer the text, then pick a hold based on completeness and whether speech has ended.",
      code: `        if (msg.type === "transcript" || msg.type === "data") {
          inSpeechSegment = false;
          const text = stripDiarizationLabels(msg.data?.transcript ?? "");
          const reportedLang = msg.data?.language_code;
          if (reportedLang && reportedLang !== langCode) {
            coalesceLang = reportedLang;
          }
          if (!text) return;
          coalesceBuf = coalesceBuf ? coalesceBuf + " " + text : text;
          coalesceMergedSegments++;
          transcriptArrivedAt = Date.now();
          if (coalesceTimer) clearTimeout(coalesceTimer);
          const incomplete = looksIncomplete(coalesceBuf);
          const holdMs = speechEndReceived
            ? SPEECH_END_FLUSH_MS
            : (incomplete ? COALESCE_INCOMPLETE_MS : SPEECH_END_FLUSH_MS);
          coalesceTimer = setTimeout(emitCoalesced, holdMs);
          emitPartial();
          return;
        }`,
      lines: [
        {
          lines: "3",
          label: "strip diarization labels",
          explanation:
            "Sarvam sometimes prefixes lines with `Speaker 1:`. `stripDiarizationLabels` removes them so the LLM never sees a speaker tag leak into context.",
        },
        {
          lines: "4-7",
          label: "only forward a DIFFERENT language",
          explanation:
            "Sarvam echoes the init language on every response even when it isn't real detection. Forwarding that echo would suppress the pipeline's script-based language detection, so the adapter only sets `coalesceLang` when the reported code truly differs.",
        },
        {
          lines: "9-11",
          label: "append and count segments",
          explanation:
            "The new text is appended to the running buffer; `coalesceMergedSegments` counts how many Sarvam segments were folded into one turn.",
        },
        {
          lines: "13-17",
          label: "the hold decision",
          explanation:
            "If Sarvam already said speech ended → flush fast (30 ms). Otherwise, hold long (220 ms) if the fragment looks incomplete, else flush fast. This is the exact junction where 'yes' goes fast and 'எனக்கு வந்து…' waits.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/stt/sarvam.ts",
      language: "typescript",
      intro:
        "The close handler enforces the close-code playbook from the top of the file, including the immediate reopen on a live language switch.",
      code: `      ws.on("close", (code, reason) => {
        wsReady = false;
        if (intentionallyClosed) {
          onClose?.();
          return;
        }
        if (switchingLanguage) {
          switchingLanguage = false;
          logger.info({ langCode, model }, "Sarvam STT: reopening WebSocket after language switch");
          openSocket();
          return;
        }
        if (code >= 4000 && code < 5000) {
          logger.error({ code, reason: reason.toString() }, "Sarvam STT: auth/quota close — not retrying");
          onClose?.();
          return;
        }
        const delay = Math.min(500 * 2 ** reconnectAttempts, 8000);
        reconnectAttempts++;
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(() => { reconnectTimer = null; openSocket(); }, delay);
      });`,
      lines: [
        {
          lines: "6-11",
          label: "language switch → immediate reopen",
          explanation:
            "`setLanguage()` closes the socket on purpose and sets `switchingLanguage`. Here we reopen instantly with the new language hint — no backoff, no error count. Audio buffered meanwhile is flushed on reconnect.",
        },
        {
          lines: "13-16",
          label: "4xxx → give up",
          explanation:
            "Auth/quota codes are fatal. Retrying wastes time and money, so surface `onClose()` and stop. This is the close-code table turned into code.",
        },
        {
          lines: "18-21",
          label: "everything else → exponential backoff",
          explanation:
            "Transient closes reconnect with 500 ms, 1 s, 2 s… capped at 8 s, up to `MAX_RECONNECT` (10) attempts.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/stt/sarvam.ts",
      language: "typescript",
      intro:
        "Finally, the heartbeat: an idle keep-alive AND a zombie-socket detector, both on one timer.",
      code: `    const heartbeatInterval = setInterval(() => {
      if (intentionallyClosed) return;
      const nowMs = Date.now();
      if (
        wsReady && ws.readyState === WebSocket.OPEN && !inSpeechSegment &&
        nowMs - lastAudioSentAt > KEEPALIVE_IDLE_MS &&
        nowMs - lastKeepAliveAt > KEEPALIVE_IDLE_MS
      ) {
        lastKeepAliveAt = nowMs;
        ws.send(JSON.stringify({ audio: { data: KEEPALIVE_FRAME.toString("base64"), encoding: "audio/wav", sample_rate: sampleRate } }));
      }
      if (deadFired) return;
      if (!inSpeechSegment) return;
      if (ws.readyState !== WebSocket.OPEN) return;
      if (Date.now() - lastAudioSentAt > WS_DEAD_MS) return;
      const silenceMs = Date.now() - lastMsgAt;
      if (silenceMs > WS_DEAD_MS) {
        deadFired = true;
        try { ws.terminate(); } catch { try { ws.close(); } catch { /* noop */ } }
      }
    }, HEARTBEAT_MS);`,
      lines: [
        {
          lines: "4-10",
          label: "idle keep-alive",
          explanation:
            "Sarvam closes an idle socket after ~60 s. During a long agent monologue no caller audio flows, so after 15 s of silence (and only outside a speech segment) a 200 ms near-silent PCM frame is shipped to keep the pipe open.",
        },
        {
          lines: "12-15",
          label: "zombie-detector guards",
          explanation:
            "A socket can be OPEN but silently dead. We only suspect this while actively streaming inside a speech segment (`inSpeechSegment` and recently-sent audio) — otherwise a legitimate quiet period would trip a false alarm.",
        },
        {
          lines: "16-19",
          label: "terminate → 1006 → reconnect",
          explanation:
            "If no inbound message arrived for 3 s while we were feeding audio, the socket is a zombie. `terminate()` produces close code 1006, which the close handler treats as transient and reconnects with backoff. `deadFired` latches so we act once per episode.",
        },
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          prompt: "Your Tamil agent keeps transcribing in English. Which Sarvam concept is the likely cause?",
          choices: [
            "The KeepAlive frame is too small.",
            "normaliseLang couldn't validate the language for the chosen model and fell back to en-IN — e.g. a saaras-only language on saarika:v2.5.",
            "The zombie detector fired.",
            "COALESCE_MAX_MS is too high.",
          ],
          correctIndex: 1,
          explanation:
            "normaliseLang logs a warning and returns en-IN whenever the language isn't valid for the model. A saaras:v3-only language selected with saarika:v2.5 is a classic trigger.",
        },
        {
          prompt: "Why does the COMPLETE_SINGLE_WORDS set exist?",
          choices: [
            "To improve transcription accuracy of short words.",
            "To bypass the incomplete-hold so genuine one-word replies (yes / ஆம் / हाँ) dispatch in ~30 ms instead of waiting 800+ ms for more words.",
            "To translate the words to English.",
            "To detect the caller's language.",
          ],
          correctIndex: 1,
          explanation:
            "It is a latency fix: without it, the coalescer treats one word as mid-thought and holds it. The set marks which single words are complete answers so they fire on the fast path.",
        },
        {
          prompt: "A Sarvam socket is OPEN but no transcripts arrive while the caller is clearly speaking. What does the heartbeat do?",
          choices: [
            "Nothing — it only sends keep-alives.",
            "After 3 s of inbound silence WHILE actively streaming in a speech segment, it terminates the socket (code 1006) to force a backoff reconnect.",
            "It switches to Deepgram.",
            "It lowers the VAD sensitivity.",
          ],
          correctIndex: 1,
          explanation:
            "The zombie detector fires only while streaming inside a speech segment. terminate() yields close 1006, which the close handler reconnects with backoff — self-healing a dead-but-open socket.",
        },
      ],
    },
    {
      kind: "keyTakeaways",
      items: [
        "Sarvam sends audio as base64 JSON with `encoding: audio/wav` (the enum trap) while the real codec rides in the URL as `input_audio_codec=pcm_s16le`.",
        "Only `saaras:v3` and `saarika:v2.5` are valid streaming models; saaras:v3 covers 23 languages and supports `mode`.",
        "`transcribe` mode gives clean native script; `codemix` keeps English in Latin script — the default is `codemix` for English, `transcribe` for Indic languages.",
        "Adaptive coalescing self-calibrates a 120-500 ms hold window to the caller's pause rhythm, merging mid-sentence segments.",
        "COMPLETE_SINGLE_WORDS fast-paths one-word replies (~30 ms); looksIncomplete holds grammatical fragments (Tamil suffixes, dangling connectors) longer.",
        "Close-code policy: 4xxx never retries; other codes reconnect with exponential backoff; a live language switch reopens immediately. A heartbeat keeps idle sockets alive and terminates zombies.",
      ],
    },
  ],
};
