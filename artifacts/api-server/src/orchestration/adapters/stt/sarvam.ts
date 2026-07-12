/**
 * Sarvam AI — Speech-to-Text
 *
 * Batch:     POST https://api.sarvam.ai/speech-to-text
 * Streaming: wss://api.sarvam.ai/speech-to-text/ws
 *
 * Official docs:
 *   https://docs.sarvam.ai/api-reference-docs/speech-to-text/apis/streaming
 *
 * ── WebSocket connection parameters (query string) ───────────────────────────
 *   model               "saaras:v3" (recommended) | "saarika:v2.5" (legacy)
 *   language_code       BCP-47, e.g. "ta-IN", "hi-IN", "en-IN"
 *   mode                "transcribe" | "codemix" | "verbatim" | "translit"
 *                       (saaras:v3 only; codemix handles Tamil+English mixing)
 *   sample_rate         16000 (default) | 8000
 *   input_audio_codec   "pcm_s16le" | "wav"
 *   high_vad_sensitivity true → 0.5 s silence boundary (snappier for voice agents)
 *   vad_signals         true → emits START_SPEECH / END_SPEECH events
 *
 * ── Auth ─────────────────────────────────────────────────────────────────────
 *   Header: api-subscription-key: <key>
 *
 * ── Audio message (JSON text, sent as each PCM chunk arrives) ────────────────
 *   { audio: { data: "<base64 raw PCM>", encoding: "audio/wav", sample_rate: 16000 } }
 *   NOTE: encoding enum MUST be "audio/wav" — "pcm_s16le" is rejected by Sarvam's
 *   Pydantic model even though the URL param `input_audio_codec=pcm_s16le` sets
 *   the actual codec. Confirmed via live WebSocket probe (June 2026).
 *
 * ── Server → client messages (JSON text) ─────────────────────────────────────
 *   { type: "events", data: { signal_type: "START_SPEECH" | "END_SPEECH" } }
 *   { type: "data",   data: { transcript: string } }
 *
 * ── Close codes ──────────────────────────────────────────────────────────────
 *   1000 Normal closure (intentional)
 *   1001 Going away        — reconnect
 *   1006 Abnormal (no close frame) — reconnect with backoff
 *   1011 Server error      — reconnect with backoff
 *   4xxx Auth / quota      — do NOT retry; fix first
 */

import { WebSocket } from "ws";
import { pcmToWav } from "../../audio.js";
import type { STTAdapter, SttFinalMetadata } from "./base.js";
import type { STTConfig, StreamSTT } from "../../types.js";
import { logger } from "../../../lib/logger.js";

function envInt(name: string, def: number): number {
  const v = process.env[name];
  if (!v) return def;
  const n = parseInt(v, 10);
  return isNaN(n) ? def : n;
}

const BATCH_URL = "https://api.sarvam.ai/speech-to-text";
const WS_BASE   = "wss://api.sarvam.ai/speech-to-text/ws";

/** Only saaras:v3 supports the `mode` parameter. */
const MODE_CAPABLE = new Set(["saaras:v3"]);

/**
 * Strip leaked diarization/speaker labels (e.g. "Speaker 1:", "speaker:") from a
 * transcript line. Some Sarvam responses prefix utterances with a speaker tag that
 * would otherwise leak verbatim into the LLM context (call 548). Removes the label
 * at the start of the string or immediately after any newline, then trims.
 */
function stripDiarizationLabels(text: string): string {
  return text.replace(/(^|\n)\s*speaker\s*\d*\s*:\s*/gi, "$1").trim();
}

/** BCP-47 codes accepted by Sarvam (note: Odia uses od-IN, not or-IN). */
const VALID_LANG = new Set([
  "bn-IN", "en-IN", "gu-IN", "hi-IN", "kn-IN",
  "ml-IN", "mr-IN", "od-IN", "pa-IN", "ta-IN", "te-IN",
]);

/** ISO-639-1 bare codes → Sarvam BCP-47. */
const LANG_MAP: Record<string, string> = {
  bn: "bn-IN", en: "en-IN", gu: "gu-IN", hi: "hi-IN",
  kn: "kn-IN", ml: "ml-IN", mr: "mr-IN",
  or: "od-IN", od: "od-IN",             // Odia: BCP-47 is or-IN but Sarvam uses od-IN
  pa: "pa-IN", ta: "ta-IN", te: "te-IN",
};

function normaliseLang(code: string | null | undefined): string {
  if (!code) return "en-IN";
  const t = code.trim();
  if (VALID_LANG.has(t)) return t;
  const bare = t.split("-")[0]?.toLowerCase() ?? "";
  const mapped = LANG_MAP[bare];
  if (mapped) return mapped;
  logger.warn({ rawLang: code }, "Sarvam STT: unrecognised language — falling back to en-IN");
  return "en-IN";
}

interface SarvamMsg {
  type: string;
  data?: { transcript?: string; signal_type?: string; message?: string; language_code?: string };
}

export class SarvamSTT implements STTAdapter {
  private readonly key: string;
  private readonly model: string;
  private readonly langCode: string;
  private readonly mode: string;
  private readonly cfg: STTConfig;
  /** Native sample rate to actually stream to Sarvam — 8000 for telephony, 16000 for webcall. */
  private readonly sampleRate: 8000 | 16000;

  constructor(
    apiKey: string,
    model: string | null,
    extraConfig: string | null,
    cfg: STTConfig,
  ) {
    this.key = apiKey;
    this.cfg = cfg;
    this.sampleRate = cfg.nativeSampleRate === 8000 ? 8000 : 16000;

    const extra = extraConfig
      ? (JSON.parse(extraConfig) as { mode?: string })
      : {};

    // Model: saaras:v3 is recommended; saarika:v2.5 / saaras:v2.5 are legacy.
    const requested = (model ?? "").trim();
    this.model = ["saaras:v3", "saarika:v2.5", "saaras:v2.5"].includes(requested)
      ? requested
      : "saaras:v3";

    this.langCode = normaliseLang(cfg.language);

    // Default mode: codemix handles Tamil+English code-switching naturally.
    // Only saaras:v3 supports mode; legacy models ignore it.
    this.mode = MODE_CAPABLE.has(this.model) ? (extra.mode ?? "codemix") : "transcribe";
  }

  // ── Batch REST ──────────────────────────────────────────────────────────────

  async transcribe(audioBuffer: Buffer, sampleRate = this.sampleRate): Promise<string> {
    const wav = pcmToWav(audioBuffer, sampleRate);

    const formData = new FormData();
    // Copy into a plain ArrayBuffer to avoid SharedArrayBuffer incompatibility with Blob.
    const wavBuf = wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength) as ArrayBuffer;
    formData.append("file", new Blob([wavBuf], { type: "audio/wav" }), "audio.wav");
    formData.append("model", this.model === "saaras:v3" ? "saaras:v3" : "saarika:v2.5");
    formData.append("language_code", this.langCode);

    const resp = await fetch(BATCH_URL, {
      method: "POST",
      headers: { "api-subscription-key": this.key },
      body: formData,
    });

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`Sarvam STT batch error ${resp.status}: ${err}`);
    }

    const json = (await resp.json()) as { transcript?: string };
    return stripDiarizationLabels(json.transcript ?? "");
  }

  // ── Streaming WebSocket ─────────────────────────────────────────────────────

  transcribeStream(
    onTranscript: (
      text: string,
      isFinal: boolean,
      detectedLanguage?: string,
      metadata?: SttFinalMetadata,
    ) => void,
    onClose?: () => void,
  ): StreamSTT {
    // Capture class fields as locals so closures (plain object methods, nested
    // functions) can reference them without relying on `this` binding.
    // langCode is MUTABLE: setLanguage() live-switches it mid-call (explicit
    // caller language request) and reconnects the socket with the new hint.
    let   langCode   = this.langCode;
    const model      = this.model;
    const mode       = this.mode;
    const key        = this.key;
    const sampleRate = this.sampleRate;

    // Built per-connection (inside openSocket) so a reconnect after a live
    // language switch picks up the current langCode.
    const buildWsUrl = (): string => {
      const params = new URLSearchParams({
        model:              model,
        language_code:      langCode,
        sample_rate:        String(sampleRate),
        input_audio_codec:  "pcm_s16le",
        high_vad_sensitivity: "true",  // 0.5 s silence boundary — snappy for voice agents
        vad_signals:        "true",    // emit speech_start / speech_end events
        flush_signal:       "true",    // allow manual buffer flush via flush() call
      });
      if (MODE_CAPABLE.has(model)) {
        params.set("mode", mode);
      }
      return `${WS_BASE}?${params.toString()}`;
    };

    let ws: WebSocket;
    let wsReady = false;
    let intentionallyClosed = false;
    let switchingLanguage = false; // set by setLanguage(); close handler reopens immediately, no backoff
    let reconnectAttempts = 0;
    const MAX_RECONNECT = 10;

    const audioQueue: Buffer[] = [];
    const MAX_QUEUE_BYTES = 64_000; // ~2 s @ 16 kHz s16le — drop oldest chunks beyond this
    let queueTrimLogged   = false;  // throttle: log queue trim at most once per reconnect episode
    let speechEndAt       = 0;     // timestamp of last END_SPEECH event for latency tracking
    let speechEndReceived = false; // true once speech_end fires; reset on speech_start

    // Closure variables for the onSpeechStart / onSpeechEnd callbacks. Declared here
    // (before openSocket) so the WS message handler — an async callback inside openSocket —
    // can reference them safely. Exposed on sttObj via Object.defineProperty getter/setter below.
    let _onSpeechStart: (() => void) | null = null;
    let _onSpeechEnd:   (() => void) | null = null;

    // ── Adaptive transcript coalescing ───────────────────────────────────────
    // The hold window self-calibrates to this caller's mid-sentence pause rhythm:
    //   fast speaker → 120 ms · medium → 220 ms · slow / older caller → 350 ms
    // Seeded at COALESCE_DEFAULT_MS until at least 2 real pauses are observed;
    // converges within 2–3 turns of natural speech.
    const COALESCE_MIN_MS        = 120;
    const COALESCE_DEFAULT_MS    = 220;
    const COALESCE_MAX_MS        = 500;  // raised from 350 — covers ~400ms thinking pauses
    // Extra hold for obviously-incomplete fragments. Lowered from 1200 → 800 ms
    // (800 ms is enough for a caller to continue a mid-sentence pause; 1200 ms
    // added dead air on multilingual calls where Sarvam's speech_end fires late).
    // Override per-deployment with env SARVAM_COALESCE_INCOMPLETE_MS.
    const COALESCE_INCOMPLETE_MS = envInt("SARVAM_COALESCE_INCOMPLETE_MS", 800);
    const PAUSE_HISTORY_MAX      = 5;
    const pauseHistory: number[] = [];
    let transcriptArrivedAt    = 0;   // wall-clock ms when last transcript buffered
    let coalesceMergedSegments = 0;   // # of Sarvam segments folded into current buf

    function adaptiveHoldMs(): number {
      if (pauseHistory.length < 2) return COALESCE_DEFAULT_MS;
      const avg = pauseHistory.reduce((a, b) => a + b, 0) / pauseHistory.length;
      if (avg < 150) return COALESCE_MIN_MS;
      if (avg < 400) return COALESCE_DEFAULT_MS;
      return COALESCE_MAX_MS;
    }

    /**
     * Common single-word utterances that are COMPLETE responses — acknowledgements,
     * affirmatives, negatives, greetings — in English, Tamil, and Hindi. These bypass
     * the COALESCE_INCOMPLETE_MS hold so "yes" / "ஆம்" / "हाँ" dispatches in ~30 ms
     * (the normal speech_end fast-path) instead of waiting 800+ ms for "more words".
     */
    const COMPLETE_SINGLE_WORDS = new Set([
      // English — affirmatives / negatives / acknowledgements / greetings
      "yes", "no", "ok", "okay", "sure", "fine", "right", "correct", "wrong",
      "good", "great", "perfect", "excellent", "absolutely", "definitely",
      "yeah", "yep", "yup", "nope", "nah", "alright",
      "hello", "hi", "hey", "bye", "goodbye", "thanks", "thank", "thankyou",
      "done", "stop", "cancel", "confirm", "proceed", "continue", "next",
      "back", "send", "wait", "hold", "go", "start", "begin", "end",
      "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
      "first", "second", "third", "morning", "evening", "afternoon", "now", "later",
      "help", "please", "understood", "noted", "agree", "disagree",
      // Tamil — affirmatives / negatives / acknowledgements / greetings
      "ஆம்", "இல்ல", "இல்லை", "சரி", "ஓகே", "ஹலோ", "ஹலொ",
      "நன்றி", "சரிங்க", "ஆமாம்", "இல்லங்க", "ஓகேங்க", "சரிங்கள",
      "புரிஞ்சது", "தெரியும்", "தெரியல", "வேண்டாம்", "வேணும்",
      "கொஞ்சம்", "நல்லது", "ஆகும்", "ஆகாது",
      // Hindi — affirmatives / negatives / acknowledgements / greetings
      "हाँ", "हां", "नहीं", "ना", "ठीक", "ओके", "हेलो", "हाँजी", "हांजी",
      "जी", "जी।", "जी,", "धन्यवाद", "शुक्रिया", "बताओ", "आगे",
      "समझा", "समझी", "पता", "नहीं।", "बिल्कुल", "ज़रूर", "ज़रूरी",
      // Telugu, Kannada, Malayalam common acks
      "అవును", "కాదు", "సరే", "ఓకే", "హలో",
      "ಹೌದು", "ಇಲ್ಲ", "ಸರಿ", "ಓಕೆ", "ಹಲೋ",
      "അതെ", "ഇല്ല", "ശരി", "ഓകെ", "ഹലോ",
    ]);

    /**
     * Returns true when the transcript looks like a mid-sentence fragment that the
     * caller is still formulating. Triggers COALESCE_INCOMPLETE_MS hold instead of
     * the adaptive window so the caller can finish their thought.
     *
     * Patterns detected (Tamil-aware + generic):
     *   • Single word (not in COMPLETE_SINGLE_WORDS) — likely a fragment
     *   • Ends with Tamil possessive suffix    — உங்களோட, என்னோட, அதோட, …
     *   • Ends with Tamil case markers         — -ஐ, -க்கு, -கிட்ட, -ல, -னால, …
     *   • Ends with common connective words    — "and", "or", "but", "also", "with"
     *   • Ends with relative/attribute marker  — -ன, -ற (verb participial forms)
     *   • All-caps abbreviation (e.g. "DTDC") — likely partial proper noun phrase
     */
    function looksIncomplete(text: string): boolean {
      const t = text.trim();
      const words = t.split(/\s+/);
      if (words.length === 0) return false;
      // Single word — check bypass list first: common complete responses (yes/no/ok/hello
      // etc.) are NOT fragments and should dispatch immediately via the normal fast-path.
      // Unknown single words still get the COALESCE_INCOMPLETE_MS hold.
      if (words.length === 1) {
        const w = words[0].toLowerCase().replace(/[।,!?.]+$/, ""); // strip trailing punctuation
        if (COMPLETE_SINGLE_WORDS.has(w) || COMPLETE_SINGLE_WORDS.has(words[0])) return false;
        return true;
      }
      const last = words[words.length - 1];
      // Tamil possessive / genitive suffixes → more to come
      if (/[ஓோ]ட$|உடைய$|களோட$/.test(last)) return true;
      // Tamil dative, locative, instrumental markers
      if (/க்கு$|கிட்ட$|கிட்டே$|னால$|னாலே$|ஐ$/.test(last)) return true;
      // Tamil conjunctive participial (connector) forms — ALWAYS signal more is coming:
      //   -ந்து  : வந்து (having come), போந்து, கொண்டு (with)
      //   -ட்டு  : போட்டு (having placed), விட்டு (having let), ஆட்டு…
      //   -ணி/-ல்லி/-ண்ணி : சொல்லி (having said), பண்ணி (having done)
      //   -ய்    : போய் (having gone), வாய்
      //   -ட்டு also covers viṭṭu (விட்டு) and poṭṭu (போட்டு) naturally
      if (/ந்து$|ட்டு$|ண்ணி$|ல்லி$|ணி$|னி$/.test(last)) return true;
      if (/ய்$/.test(last) && last.length > 2) return true; // போய், வாய் — skip 2-char words like "ஒய்"
      // Tamil relative-participial / adverbial forms
      if (/ன்ற$|கிற$|வந்த$|போன$/.test(last)) return true;
      // 2-word utterance where the FIRST word ends with a case marker AND the second
      // word is NOT a complete verb form → predicate is missing.
      // "எனக்கு வந்து" → incomplete ✓
      // "நாளைக்கு வருவேன்" → complete (second=verb) — should NOT fire
      if (words.length === 2) {
        const first = words[0];
        const second = words[1];
        // Tamil finite verb endings that make a 2-word sentence self-contained:
        //   -வேன்/-ேன் (1ps past/future), -லாம் (hortative), -ல்ல/-ல்லை (negative),
        //   -ஆம்/-ஆகும் (equative), -ார்/-ார்கள் (3p), -கும்/-கிறது (neuter/future)
        const secondIsFiniteVerb = /ேன்$|வேன்$|ோம்$|லாம்$|ல்ல$|ல்லை$|ஆம்$|ார்$|ார்கள்$|கும்$|கிறது$|றேன்$|கிறேன்$/.test(second);
        if (!secondIsFiniteVerb && /க்கு$|கிட்ட$|கிட்டே$|ஐ$|னால$|ஆல$/.test(first)) return true;
      }
      // Also check if FIRST word (not just last) is a connector/incomplete form.
      // e.g. "போய் சொல்லு" — "போய்" is conjunctive and signals more context.
      const first = words[0];
      if (/ந்து$|ட்டு$|ண்ணி$|ல்லி$/.test(first)) return true;
      if (/ய்$/.test(first) && first.length > 2) return true;
      // Hindi/Hinglish possessives & case markers
      if (/\bका$|\bकी$|\bके$|\bको$|\bसे$|\bमें$|\bने$|\bपर$/u.test(last)) return true;
      // Generic English connectives that signal more is coming
      if (/^(and|or|but|also|with|for|of|to|the|a|an|in|on|at)$/i.test(last)) return true;
      // English transitive / mental-state verbs that virtually always need a
      // following object or complement. A bare utterance ending in one of these
      // (no terminal punctuation, no object yet) means the caller is still
      // mid-thought — e.g. "I want" → "I want to know the pricing…". Confirmed
      // from call-1659: "I want" was flushed as a complete turn and produced a
      // garbled follow-on ("I want a No good. worth pricing"). Skip this check
      // when the text already ends with terminal punctuation — STT smart_format
      // already judged it complete.
      if (!/[.?!]$/.test(t)) {
        const NEEDS_OBJECT_VERBS = new Set([
          "want", "need", "like", "love", "hate", "have", "get", "know",
          "think", "mean", "see", "hear", "feel", "believe", "wish", "hope",
          "prefer", "use", "try", "check", "understand", "remember", "ask",
          "tell", "show", "give", "take", "make", "do", "call", "book",
          "send", "discuss", "explain", "mention", "consider", "suggest",
          "recommend",
        ]);
        if (NEEDS_OBJECT_VERBS.has(last.toLowerCase())) return true;
      }
      // All-caps token ≥ 2 chars (e.g. "DTDC", "KYC") — check both first and last word
      if (/^[A-Z]{2,}$/.test(last) || /^[A-Z]{2,}$/.test(first)) return true;
      // Tamil interrogative words — ALWAYS require a predicate; can never end a sentence.
      // எந்த (which), என்ன (what), எப்ப/எப்போ (when), எங்க/எங்கே (where),
      // யாரு/யார் (who), எவ்வளவு (how much), எப்படி (how), ஏன் (why),
      // எது (which one), எதுக்கு (for what), எதாவது (anything/which)
      if (/^(எந்த|என்ன|எப்ப|எப்போ|எங்க|எங்கே|யாரு|யார்|எவ்வளவு|எப்படி|ஏன்|எது|எதுக்கு|எதாவது|எத்தனை|எத்தன|எவன்|எவள்|எவங்க)$/.test(last)) return true;
      // Hindi interrogatives: क्या, कब, कहाँ, कैसे, कौन, कितना, क्यों
      if (/^(क्या|कब|कहाँ|कैसे|कौन|कितना|क्यों|किसका|किसकी|किसके)$/.test(last)) return true;
      return false;
    }

    let coalesceBuf  = "";
    let coalesceMeta: SttFinalMetadata | undefined;
    let coalesceLang: string | undefined;
    let coalesceTimer: ReturnType<typeof setTimeout> | null = null;

    const emitCoalesced = () => {
      coalesceTimer = null;
      if (!coalesceBuf) return;
      const text     = coalesceBuf;
      const lang     = coalesceLang;
      const segments = coalesceMergedSegments;
      const meta: SttFinalMetadata = {
        ...coalesceMeta,
        mergedSegments: segments,
        pauseCount:     Math.max(0, segments - 1),
      };
      coalesceBuf            = "";
      coalesceMeta           = undefined;
      coalesceLang           = undefined;
      coalesceMergedSegments = 0;
      transcriptArrivedAt    = 0;

      logger.info(
        { text: text.slice(0, 120), segments, holdMs: adaptiveHoldMs(), pauseHistory: pauseHistory.slice(), detectedLang: lang },
        "Sarvam STT: emitting adaptive-coalesced transcript",
      );
      onTranscript(text, true, lang, meta);
    };

    // ── WebSocket health monitoring ───────────────────────────────────────────
    // Sarvam sends speech_start / speech_end / transcript on every event. A socket
    // can go ZOMBIE — readyState OPEN but no traffic — without ever emitting "close".
    // If >3 s pass with no inbound message WHILE we are actively streaming caller
    // audio inside a speech segment, treat it as dead and terminate the socket so the
    // ws.on("close") handler reconnects. The lastAudioSentAt guard prevents false
    // positives during agent playback (caller frames are gated → silence is expected,
    // not death). deadFired latches so we act once per episode, not on every tick.
    let lastMsgAt        = Date.now();
    let lastAudioSentAt  = 0;
    let inSpeechSegment  = false;
    let deadFired        = false;
    const HEARTBEAT_MS   = 300;
    const WS_DEAD_MS     = 3_000;

    const sendChunk = (chunk: Buffer) => {
      if (!wsReady || ws.readyState !== WebSocket.OPEN) return;
      const now = Date.now();
      // Resuming after a send gap (caller frames were gated during agent playback):
      // grant Sarvam a fresh WS_DEAD_MS window before the zombie check can fire. Without
      // this, a stale lastMsgAt from before the gap would trip a false positive on the
      // very first chunk after playback and terminate a perfectly healthy socket.
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
    };

    const openSocket = () => {
      wsReady = false;

      ws = new WebSocket(buildWsUrl(), {
        headers: { "api-subscription-key": key },
      });

      ws.on("open", () => {
        wsReady = true;
        reconnectAttempts = 0;
        deadFired         = false; // fresh socket — re-arm the zombie detector
        lastMsgAt         = Date.now(); // start silence window from now, not dead socket's last frame
        queueTrimLogged   = false; // re-arm queue-trim log for this reconnect episode
        // Reset VAD state: a stale speechEndReceived=true would send post-reconnect
        // transcripts down the 30ms fast-flush path before any fresh speech_end fires.
        inSpeechSegment   = false;
        speechEndReceived = false;
        logger.info(
          { langCode, model, mode },
          "Sarvam streaming STT: WebSocket opened",
        );
        // Flush any audio that arrived before the socket was ready.
        for (const chunk of audioQueue.splice(0)) sendChunk(chunk);
      });

      ws.on("message", (raw: Buffer | string) => {
        let msg: SarvamMsg;
        try {
          msg = JSON.parse(raw.toString()) as SarvamMsg;
        } catch {
          return; // ignore non-JSON frames
        }

        // VAD signals — official type values: "speech_start" / "speech_end"
        // (legacy guessed values "events" + signal_type also handled for safety)
        lastMsgAt = Date.now();
        deadFired = false; // any inbound frame proves the socket is alive — re-arm the detector
        if (msg.type === "speech_start" || (msg.type === "events" && msg.data?.signal_type === "START_SPEECH")) {
          inSpeechSegment    = true;
          speechEndReceived  = false; // caller is speaking again; clear the speech_end flag
          _onSpeechStart?.();
          logger.debug({ langCode }, "Sarvam STT: speech start");
          // If we are holding a transcript and the user resumed speaking, cancel
          // the emit timer, record the pause length for adaptive calibration, and
          // wait for the next transcript to append before emitting.
          if (coalesceTimer && coalesceBuf) {
            clearTimeout(coalesceTimer);
            coalesceTimer = null;
            if (transcriptArrivedAt > 0) {
              const pauseMs = Date.now() - transcriptArrivedAt;
              if (pauseMs > 40 && pauseMs < 1200) { // filter: ignore sub-40ms noise & >1.2s stale gaps
                pauseHistory.push(pauseMs);
                if (pauseHistory.length > PAUSE_HISTORY_MAX) pauseHistory.shift();
              }
              transcriptArrivedAt = 0;
            }
            logger.debug(
              { langCode, pauseHistory: pauseHistory.slice(), nextHoldMs: adaptiveHoldMs() },
              "Sarvam STT: coalesce hold cancelled — speech resumed, pause recorded",
            );
          }
          return;
        }
        if (msg.type === "speech_end" || (msg.type === "events" && msg.data?.signal_type === "END_SPEECH")) {
          inSpeechSegment   = false;
          speechEndReceived = true;
          speechEndAt       = Date.now();
          logger.debug({ langCode }, "Sarvam STT: speech end");
          // Fast-path when transcript is ALREADY buffered (multi-segment coalescing):
          // caller has stopped talking — shorten any running timer.
          // • Complete-looking buffer → 30 ms (dispatch immediately).
          // • Incomplete-looking buffer → adaptiveHoldMs (120–500 ms).
          //   NEVER leave a 1200 ms COALESCE_INCOMPLETE_MS timer running after
          //   speech_end — the caller is done; waiting 1200 ms is just dead air.
          if (coalesceBuf && coalesceTimer) {
            clearTimeout(coalesceTimer);
            const newHold = looksIncomplete(coalesceBuf) ? adaptiveHoldMs() : 30;
            coalesceTimer = setTimeout(emitCoalesced, newHold);
            logger.debug(
              { langCode, buf: coalesceBuf.slice(0, 60), newHold },
              "Sarvam STT: speech_end fast-flush (pre-buffered) — coalesce shortened",
            );
          }
          _onSpeechEnd?.();
          return;
        }

        // Final transcript — official type: "transcript"; legacy: "data"
        if (msg.type === "transcript" || msg.type === "data") {
          inSpeechSegment = false; // segment complete
          const text = stripDiarizationLabels(msg.data?.transcript ?? "");
          // Capture the language Sarvam identified for this segment (saaras:v3 LID).
          // Last seen language_code wins across coalesced segments; reset in emitCoalesced().
          coalesceLang = msg.data?.language_code ?? coalesceLang;
          if (!text) return;
          const meta: SttFinalMetadata = {
            endDetectToFinalMs: speechEndAt > 0 ? Date.now() - speechEndAt : undefined,
          };
          logger.info(
            { text: text.slice(0, 80), model, mode, endDetectToFinalMs: meta.endDetectToFinalMs },
            "Sarvam STT: final transcript (buffering for adaptive coalesce)",
          );
          speechEndAt = 0;
          // Append to coalesce buffer (may already have a prior partial).
          coalesceBuf            = coalesceBuf ? coalesceBuf + " " + text : text;
          coalesceMeta           = meta;         // keep latest latency measurement
          coalesceMergedSegments++;
          transcriptArrivedAt    = Date.now();   // start of the hold window
          // (Re-)arm the emit timer.
          // Timer selection after each transcript segment:
          // • speech_end already received + complete → 30 ms (fast-path, normal Sarvam flow).
          // • speech_end already received + incomplete → adaptiveHoldMs (120–500 ms).
          //   The caller has stopped talking — NEVER use the 1200 ms incomplete hold
          //   after speech_end; that would just be dead air while we wait for speech
          //   that isn't coming.
          // • speech_end NOT yet received + incomplete → COALESCE_INCOMPLETE_MS (1200 ms)
          //   so the caller can finish their thought before we dispatch to the LLM.
          // • speech_end NOT yet received + complete → adaptive window.
          if (coalesceTimer) clearTimeout(coalesceTimer);
          const incomplete = looksIncomplete(coalesceBuf);
          const holdMs = speechEndReceived
            ? (!incomplete ? 30 : adaptiveHoldMs())
            : (incomplete ? COALESCE_INCOMPLETE_MS : adaptiveHoldMs());
          if (speechEndReceived && !incomplete) {
            logger.debug(
              { langCode, buf: coalesceBuf.slice(0, 60) },
              "Sarvam STT: post-speech_end fast-flush — coalesce set to 30 ms",
            );
          }
          coalesceTimer = setTimeout(emitCoalesced, holdMs);
          return;
        }

        if (msg.type === "error") {
          logger.error({ msg: msg.data?.message, langCode }, "Sarvam STT: server error");
        }
      });

      ws.on("close", (code, reason) => {
        wsReady = false;

        if (intentionallyClosed) {
          onClose?.();
          return;
        }

        // Live language switch: we closed the socket ourselves — reopen
        // immediately with the new langCode. Not an error; no backoff and no
        // reconnectAttempts++ (audio buffered in audioQueue meanwhile).
        if (switchingLanguage) {
          switchingLanguage = false;
          logger.info({ langCode, model }, "Sarvam STT: reopening WebSocket after language switch");
          openSocket();
          return;
        }

        // Auth / quota errors: do not retry.
        if (code >= 4000 && code < 5000) {
          logger.error(
            { code, reason: reason.toString() },
            "Sarvam STT: auth/quota close — not retrying",
          );
          onClose?.();
          return;
        }

        if (reconnectAttempts >= MAX_RECONNECT) {
          logger.error({ code, reconnectAttempts }, "Sarvam STT: max reconnects reached");
          onClose?.();
          return;
        }

        // Exponential backoff: 500ms, 1s, 2s, 4s … capped at 8s.
        const delay = Math.min(500 * 2 ** reconnectAttempts, 8000);
        reconnectAttempts++;
        logger.warn(
          { code, delay, reconnectAttempts },
          "Sarvam STT: WebSocket closed — reconnecting",
        );
        setTimeout(openSocket, delay);
      });

      ws.on("error", (err) => {
        logger.error({ err }, "Sarvam STT: WebSocket error");
      });
    };

    openSocket();

    const sttObj: import("../../types.js").StreamSTT = {
      onConnectionDead: null,

      sendAudio(chunk: Buffer): void {
        if (!wsReady || ws.readyState !== WebSocket.OPEN) {
          audioQueue.push(chunk);
          // Cap the queue at ~2 s of audio — drop oldest chunks so that on reconnect
          // we don't flood Sarvam with stale audio and produce phantom transcripts.
          let total = audioQueue.reduce((a, b) => a + b.length, 0);
          if (total > MAX_QUEUE_BYTES) {
            let dropped = 0;
            while (total > MAX_QUEUE_BYTES && audioQueue.length > 1) {
              const len = audioQueue.shift()!.length;
              dropped  += len;
              total    -= len;
            }
            if (!queueTrimLogged) {
              queueTrimLogged = true;
              logger.debug({ droppedBytes: dropped }, "Sarvam STT: audio queue trimmed — dropped stale chunks during reconnect backoff");
            }
          }
        } else {
          sendChunk(chunk);
        }
      },
      flush(): void {
        // Emit any held coalesced transcript immediately (don't wait for the timer).
        // emitCoalesced() is a no-op on an empty buffer, so always call it — this
        // handles the edge case where coalesceBuf is non-empty but coalesceTimer is null.
        if (coalesceTimer) clearTimeout(coalesceTimer);
        emitCoalesced();
        // Ask Sarvam to immediately finalize its internal audio buffer.
        if (!wsReady || ws.readyState !== WebSocket.OPEN) return;
        const emptyData = Buffer.alloc(0);
        ws.send(
          JSON.stringify({
            audio: {
              data:        emptyData.toString("base64"),
              encoding:    "audio/wav",
              sample_rate: sampleRate,
            },
            flush: true,
          }),
        );
        logger.debug({ langCode }, "Sarvam STT: flush signal sent");
      },
      setLanguage(lang: string): void {
        const next = normaliseLang(lang);
        if (next === langCode) return;           // already on it — no-op (loop guard)
        if (intentionallyClosed) return;         // stream already torn down
        const prev = langCode;
        langCode = next;
        logger.info(
          { from: prev, to: next, model },
          "Sarvam STT: live language switch — reconnecting stream with new language hint",
        );
        // Drain any transcript held in the OLD language before switching.
        if (coalesceTimer) { clearTimeout(coalesceTimer); emitCoalesced(); }
        if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
          switchingLanguage = true;              // close handler reopens immediately with new langCode
          try { ws.close(1000); } catch {
            switchingLanguage = false;
            try { ws.terminate(); } catch { /* noop */ }
            openSocket();
          }
        }
        // else: socket is between reconnects — the pending reconnect timer's
        // openSocket() will pick up the new langCode via buildWsUrl().
      },
      close(): void {
        // Drain the coalesce buffer before closing so no transcript is lost.
        if (coalesceTimer) { clearTimeout(coalesceTimer); emitCoalesced(); }
        intentionallyClosed = true;
        clearInterval(heartbeatInterval);
        if (
          ws.readyState === WebSocket.OPEN ||
          ws.readyState === WebSocket.CONNECTING
        ) {
          ws.close(1000);
        }
      },
    };

    // Expose _onSpeechStart / _onSpeechEnd via getter/setter so the WS handler (which
    // closes over these variables, declared before openSocket) stays in sync with whatever
    // callback the caller assigns after sttObj is returned.
    Object.defineProperty(sttObj, "onSpeechStart", {
      get(): (() => void) | null { return _onSpeechStart; },
      set(cb: (() => void) | null): void { _onSpeechStart = cb; },
      configurable: true,
      enumerable: true,
    });
    Object.defineProperty(sttObj, "onSpeechEnd", {
      get(): (() => void) | null { return _onSpeechEnd; },
      set(cb: (() => void) | null): void { _onSpeechEnd = cb; },
      configurable: true,
      enumerable: true,
    });

    // Start the heartbeat AFTER sttObj is created so the interval can reference it.
    const heartbeatInterval = setInterval(() => {
      if (intentionallyClosed || deadFired) return;       // torn down, or already handled this episode
      if (!inSpeechSegment) return;                        // only meaningful mid-utterance
      if (ws.readyState !== WebSocket.OPEN) return;        // CONNECTING/CLOSING handled elsewhere
      // Suppress false positives: during agent playback the pipeline gates caller frames,
      // so we are NOT sending audio and Sarvam is legitimately silent. Only suspect death
      // when we have recently been actively streaming audio to the socket.
      if (Date.now() - lastAudioSentAt > WS_DEAD_MS) return;
      const silenceMs = Date.now() - lastMsgAt;
      if (silenceMs > WS_DEAD_MS) {
        deadFired = true; // fire-once latch: reset by any inbound message or a fresh socket
        logger.warn(
          { langCode, silenceMs },
          "Sarvam STT: WS silent while streaming audio — terminating zombie socket to force reconnect",
        );
        try { sttObj.onConnectionDead?.(); } catch { /* optional external consumer hook */ }
        // Self-heal: terminate the dead socket so ws.on("close") runs the existing
        // exponential-backoff reconnect (terminate → 1006, which is not an auth code).
        try { ws.terminate(); } catch { try { ws.close(); } catch { /* noop */ } }
      }
    }, HEARTBEAT_MS);

    return sttObj;
  }
}
