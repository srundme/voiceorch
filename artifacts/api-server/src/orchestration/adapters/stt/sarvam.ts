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

const BATCH_URL = "https://api.sarvam.ai/speech-to-text";
const WS_BASE   = "wss://api.sarvam.ai/speech-to-text/ws";

/** Only saaras:v3 supports the `mode` parameter. */
const MODE_CAPABLE = new Set(["saaras:v3"]);

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
  data?: { transcript?: string; signal_type?: string; message?: string };
}

export class SarvamSTT implements STTAdapter {
  private readonly key: string;
  private readonly model: string;
  private readonly langCode: string;
  private readonly mode: string;
  private readonly cfg: STTConfig;

  constructor(
    apiKey: string,
    model: string | null,
    extraConfig: string | null,
    cfg: STTConfig,
  ) {
    this.key = apiKey;
    this.cfg = cfg;

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

  async transcribe(audioBuffer: Buffer, sampleRate = 16000): Promise<string> {
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
    return (json.transcript ?? "").trim();
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
    const langCode = this.langCode;
    const model    = this.model;
    const mode     = this.mode;
    const key      = this.key;

    const params = new URLSearchParams({
      model:              model,
      language_code:      langCode,
      sample_rate:        "16000",
      input_audio_codec:  "pcm_s16le",
      high_vad_sensitivity: "true",  // 0.5 s silence boundary — snappy for voice agents
      vad_signals:        "true",    // emit speech_start / speech_end events
      flush_signal:       "true",    // allow manual buffer flush via flush() call
    });

    if (MODE_CAPABLE.has(model)) {
      params.set("mode", mode);
    }

    const wsUrl = `${WS_BASE}?${params.toString()}`;

    let ws: WebSocket;
    let wsReady = false;
    let intentionallyClosed = false;
    let reconnectAttempts = 0;
    const MAX_RECONNECT = 10;

    const audioQueue: Buffer[] = [];
    let speechEndAt = 0; // timestamp of last END_SPEECH event for latency tracking
    // Closure variable for the onSpeechStart callback. Declared here (before openSocket)
    // so the WS message handler — an async callback inside openSocket — can reference it
    // safely. Exposed on sttObj via Object.defineProperty getter/setter below.
    let _onSpeechStart: (() => void) | null = null;

    // ── Adaptive transcript coalescing ───────────────────────────────────────
    // The hold window self-calibrates to this caller's mid-sentence pause rhythm:
    //   fast speaker → 120 ms · medium → 220 ms · slow / older caller → 350 ms
    // Seeded at COALESCE_DEFAULT_MS until at least 2 real pauses are observed;
    // converges within 2–3 turns of natural speech.
    const COALESCE_MIN_MS        = 120;
    const COALESCE_DEFAULT_MS    = 220;
    const COALESCE_MAX_MS        = 500;  // raised from 350 — covers ~400ms thinking pauses
    const COALESCE_INCOMPLETE_MS = 1200; // extra hold for obviously-incomplete fragments
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
     * Returns true when the transcript looks like a mid-sentence fragment that the
     * caller is still formulating. Triggers COALESCE_INCOMPLETE_MS hold instead of
     * the adaptive window so the caller can finish their thought.
     *
     * Patterns detected (Tamil-aware + generic):
     *   • Single word                          — always incomplete
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
      // Single word → almost certainly a fragment
      if (words.length === 1) return true;
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

    let coalesceBuf = "";
    let coalesceMeta: SttFinalMetadata | undefined;
    let coalesceTimer: ReturnType<typeof setTimeout> | null = null;

    const emitCoalesced = () => {
      coalesceTimer = null;
      if (!coalesceBuf) return;
      const text     = coalesceBuf;
      const segments = coalesceMergedSegments;
      const meta: SttFinalMetadata = {
        ...coalesceMeta,
        mergedSegments: segments,
        pauseCount:     Math.max(0, segments - 1),
      };
      coalesceBuf            = "";
      coalesceMeta           = undefined;
      coalesceMergedSegments = 0;
      transcriptArrivedAt    = 0;
      logger.info(
        { text: text.slice(0, 120), segments, holdMs: adaptiveHoldMs(), pauseHistory: pauseHistory.slice() },
        "Sarvam STT: emitting adaptive-coalesced transcript",
      );
      onTranscript(text, true, undefined, meta);
    };

    // ── WebSocket health monitoring ───────────────────────────────────────────
    // Sarvam sends speech_start / speech_end / transcript on every event.
    // If >3 s pass with no message while we are inside an active speech segment,
    // the connection has silently died. Fire onConnectionDead so webcall.ts can
    // fall back to batch STT immediately rather than waiting for the last-resort
    // 8 s fallback timer.
    let lastMsgAt       = Date.now();
    let inSpeechSegment = false;
    const HEARTBEAT_MS  = 300;
    const WS_DEAD_MS    = 3_000;

    const sendChunk = (chunk: Buffer) => {
      if (!wsReady || ws.readyState !== WebSocket.OPEN) return;
      ws.send(
        JSON.stringify({
          audio: {
            data:        chunk.toString("base64"),
            encoding:    "audio/wav",   // enum must be "audio/wav"; actual codec is set via URL param
            sample_rate: 16000,
          },
        }),
      );
    };

    const openSocket = () => {
      wsReady = false;

      ws = new WebSocket(wsUrl, {
        headers: { "api-subscription-key": key },
      });

      ws.on("open", () => {
        wsReady = true;
        reconnectAttempts = 0;
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
        if (msg.type === "speech_start" || (msg.type === "events" && msg.data?.signal_type === "START_SPEECH")) {
          inSpeechSegment = true;
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
          inSpeechSegment = false;
          speechEndAt = Date.now();
          logger.debug({ langCode }, "Sarvam STT: speech end");
          return;
        }

        // Final transcript — official type: "transcript"; legacy: "data"
        if (msg.type === "transcript" || msg.type === "data") {
          inSpeechSegment = false; // segment complete
          const text = (msg.data?.transcript ?? "").trim();
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
          // (Re-)arm the emit timer. For obviously-incomplete fragments (single word,
          // trailing Tamil possessive/case suffix, all-caps abbreviation, English
          // connective) use COALESCE_INCOMPLETE_MS so the caller can finish their
          // thought before we dispatch to the LLM. Otherwise use the adaptive window.
          if (coalesceTimer) clearTimeout(coalesceTimer);
          const holdMs = looksIncomplete(coalesceBuf) ? COALESCE_INCOMPLETE_MS : adaptiveHoldMs();
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
        } else {
          sendChunk(chunk);
        }
      },
      flush(): void {
        // Emit any held coalesced transcript immediately (don't wait for the timer).
        if (coalesceTimer) { clearTimeout(coalesceTimer); emitCoalesced(); }
        // Ask Sarvam to immediately finalize its internal audio buffer.
        if (!wsReady || ws.readyState !== WebSocket.OPEN) return;
        const emptyData = Buffer.alloc(0);
        ws.send(
          JSON.stringify({
            audio: {
              data:        emptyData.toString("base64"),
              encoding:    "audio/wav",
              sample_rate: 16000,
            },
            flush: true,
          }),
        );
        logger.debug({ langCode }, "Sarvam STT: flush signal sent");
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

    // Expose _onSpeechStart via getter/setter so the WS handler (which closes over
    // _onSpeechStart, declared before openSocket) stays in sync with what the caller assigns.
    Object.defineProperty(sttObj, "onSpeechStart", {
      get(): (() => void) | null { return _onSpeechStart; },
      set(cb: (() => void) | null): void { _onSpeechStart = cb; },
      configurable: true,
      enumerable: true,
    });

    // Start the heartbeat AFTER sttObj is created so the interval can reference it.
    const heartbeatInterval = setInterval(() => {
      if (!inSpeechSegment || intentionallyClosed) return;
      if (ws.readyState !== WebSocket.OPEN) return;
      const silenceMs = Date.now() - lastMsgAt;
      if (silenceMs > WS_DEAD_MS) {
        logger.warn({ langCode, silenceMs }, "Sarvam STT: WS silent during speech — connection dead, firing onConnectionDead");
        sttObj.onConnectionDead?.();
      }
    }, HEARTBEAT_MS);

    return sttObj;
  }
}
