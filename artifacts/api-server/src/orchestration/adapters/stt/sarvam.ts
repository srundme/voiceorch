import { WebSocket } from "ws";
import { pcmToWav } from "../../audio.js";
import type { STTAdapter } from "./base.js";
import type { STTConfig, StreamSTT } from "../../types.js";
import { logger } from "../../../lib/logger.js";

/**
 * Sarvam AI — Speech-to-Text (batch + WebSocket streaming)
 * Batch:     POST https://api.sarvam.ai/speech-to-text
 * Streaming: wss://api.sarvam.ai/speech-to-text/ws
 *
 * Valid streaming models (confirmed via live API): saarika:v2.5, saaras:v3
 * Batch models: saarika:v2.5, saarika:v1, saarika:flash, saaras:v3
 * NOTE: saaras:v2.5 is REJECTED by the streaming WS (close 4000).
 * NOTE: mode param (codemix/transcribe/etc.) is saaras:v3-only.
 * NOTE: Audio per-chunk must be WAV-wrapped (pcmToWav) in AudioContent envelope:
 *       { audio: { data: base64wav, encoding: "audio/wav", sample_rate: 16000 } }
 *       The API enum only accepts "audio/wav" — raw PCM strings cause validation errors.
 */

const VALID_SARVAM_STT_MODELS = new Set([
  "saarika:v2.5", "saarika:v2", "saarika:v1", "saarika:flash",
  "saaras:v3", "saaras:v3-realtime",
]);
const DEFAULT_SARVAM_STT_MODEL = "saarika:v2.5";

/** Only these models support Sarvam's real-time WebSocket API (confirmed live). */
const STREAMING_MODELS = new Set(["saarika:v2.5", "saaras:v3", "saaras:v3-realtime"]);

/** All language codes Sarvam accepts (BCP 47 with -IN suffix). */
const VALID_SARVAM_LANG = new Set([
  "unknown",
  "hi-IN", "bn-IN", "kn-IN", "ml-IN", "mr-IN", "od-IN",
  "pa-IN", "ta-IN", "te-IN", "en-IN", "gu-IN", "as-IN",
  "ur-IN", "ne-IN", "kok-IN", "ks-IN", "sd-IN", "sa-IN",
  "sat-IN", "mni-IN", "brx-IN", "mai-IN", "doi-IN",
]);

/** Map bare ISO-639-1 codes → Sarvam BCP-47 equivalents. */
const LANG_REMAP: Record<string, string> = {
  en: "en-IN", hi: "hi-IN", bn: "bn-IN", kn: "kn-IN",
  ml: "ml-IN", mr: "mr-IN", pa: "pa-IN", ta: "ta-IN",
  te: "te-IN", gu: "gu-IN", ur: "ur-IN",
  // Odia: standard BCP-47 is "or-IN" but Sarvam uses "od-IN"
  or: "od-IN",
};

function normaliseSarvamLang(code: string | null): string {
  if (!code) return "en-IN";
  if (VALID_SARVAM_LANG.has(code)) return code;
  const lc = code.toLowerCase();
  // Try exact lowercase match in remap (e.g. "hi" → "hi-IN")
  const remapped = LANG_REMAP[lc];
  if (remapped) return remapped;
  // Try the base language part of a BCP-47 tag (e.g. "or-IN" → base "or" → "od-IN")
  const baseCode = lc.split("-")[0];
  if (baseCode && baseCode !== lc) {
    const baseRemapped = LANG_REMAP[baseCode];
    if (baseRemapped) return baseRemapped;
  }
  // Try appending -IN (e.g. "hi" → "hi-IN")
  const withIN = `${code}-IN`;
  if (VALID_SARVAM_LANG.has(withIN)) return withIN;
  logger.warn({ rawLang: code }, "Sarvam language unrecognised — falling back to en-IN");
  return "en-IN";
}

interface SarvamStreamMsg {
  type?: string;
  // transcript may be top-level (raw WS) or nested under data (SDK wrapper)
  transcript?: string;
  data?: {
    transcript?: string;
    message?: string;
    // VAD event formats — raw WS uses "event", SDK uses "signal_type"
    event?: string;
    signal_type?: string;
  };
}

/**
 * Set to true the first time a streaming WebSocket gets a 403 response.
 * All subsequent SarvamSTT instances will skip the WS attempt and go straight
 * to batch mode, saving ~1 second of failed-connection latency per call.
 * Reset on server restart.
 */
let streamingSubscriptionUnavailable = false;

export class SarvamSTT implements STTAdapter {
  private readonly key: string;
  private readonly model: string;
  private readonly langCode: string;
  private readonly endOfTurnTimeout: number;

  // Conditionally present — undefined for batch-only (saarika) models so the
  // pipeline's `if (stt.transcribeStream)` guard correctly bypasses streaming.
  transcribeStream?: STTAdapter["transcribeStream"];

  constructor(apiKey: string, model: string | null, cfg: STTConfig) {
    this.key = apiKey;
    const candidate = model ?? "";
    this.model = VALID_SARVAM_STT_MODELS.has(candidate) ? candidate : DEFAULT_SARVAM_STT_MODEL;
    this.langCode = normaliseSarvamLang(cfg.language);
    this.endOfTurnTimeout = cfg.endOfTurnTimeout;

    if (STREAMING_MODELS.has(this.model) && !streamingSubscriptionUnavailable) {
      this.transcribeStream = this.buildStreamingSession.bind(this);
    }
  }

  // ── Batch (REST) ────────────────────────────────────────────────────────────

  async transcribe(audioBuffer: Buffer, sampleRate = 16000): Promise<string> {
    const wav = pcmToWav(audioBuffer, sampleRate);

    const formData = new FormData();
    const wavAb = new ArrayBuffer(wav.byteLength);
    new Uint8Array(wavAb).set(wav);
    formData.append("file", new Blob([wavAb], { type: "audio/wav" }), "audio.wav");
    // saaras:v3-realtime is a UI alias; actual API model name is saaras:v3
    // saarika:v2.5 is valid for both batch and streaming — no remapping needed
    const batchModel = this.model === "saaras:v3-realtime" ? "saaras:v3" : this.model;
    formData.append("model", batchModel);
    formData.append("language_code", this.langCode);

    const resp = await fetch("https://api.sarvam.ai/speech-to-text", {
      method: "POST",
      headers: { "api-subscription-key": this.key },
      body: formData,
    });

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`Sarvam STT error ${resp.status}: ${err}`);
    }

    const json = (await resp.json()) as { transcript?: string };
    return json.transcript?.trim() ?? "";
  }

  // ── Streaming (WebSocket) ───────────────────────────────────────────────────

  private buildStreamingSession(
    onTranscript: (text: string, isFinal: boolean) => void,
    onClose?: () => void,
  ): StreamSTT {
    // saaras:v3-realtime is our UI alias; actual API model name is saaras:v3
    const apiModel = this.model === "saaras:v3-realtime" ? "saaras:v3" : this.model;
    // mode param is saaras:v3-only — do NOT send for saaras:v2.5 or it causes a 400
    const isV3 = apiModel === "saaras:v3";

    const params = new URLSearchParams({
      language_code: this.langCode,
      model: apiModel,
      input_audio_codec: "pcm_s16le",
      sample_rate: "16000",
      // high_vad_sensitivity: 0.5s silence threshold vs default 1s — snappier turns
      high_vad_sensitivity: "true",
      // Request speech_start / speech_end VAD events so we emit on END_SPEECH
      // rather than relying solely on the local 200ms silence timer
      vad_signals: "true",
      // Enable flush — lets us force-flush on WS close without a reconnect penalty
      flush_signal: "true",
      // Pass key as query param too — some reverse-proxy setups strip custom
      // headers during the WebSocket upgrade handshake, causing 403.
      "api-subscription-key": this.key,
    });
    // codemix handles Tamil+English mixed speech — v3-only param
    if (isV3) params.set("mode", "codemix");

    const wsUrl = `wss://api.sarvam.ai/speech-to-text/ws?${params.toString()}`;

    // Log a sanitized URL without the API key
    const safeParams = new URLSearchParams({
      language_code: this.langCode,
      model: apiModel,
      input_audio_codec: "pcm_s16le",
      sample_rate: "16000",
      high_vad_sensitivity: "true",
      vad_signals: "true",
      ...(isV3 ? { mode: "codemix" } : {}),
    });
    logger.info(
      { langCode: this.langCode, model: apiModel, wsUrl: `wss://api.sarvam.ai/speech-to-text/ws?${safeParams.toString()}` },
      "Sarvam streaming STT: opening WebSocket"
    );

    let wsReady = false;
    let closing = false;
    const audioQueue: Buffer[] = [];

    // ── Hybrid emit (Option D) ────────────────────────────────────────────
    // Emit the transcript on whichever arrives first:
    //   1. speech_end VAD event from Sarvam's server, OR
    //   2. LOCAL_SILENCE_MS (600 ms) after the last partial with no new partial
    //
    // A hard SAFETY_MS timer (= endOfTurnTimeout, default 5 000 ms) is armed
    // once per utterance in case no partials arrive at all (very short word,
    // Sarvam server delay, etc.).
    //
    // hasEmitted ensures exactly one emit per utterance — whichever path wins
    // first, all subsequent calls to emitFinal() for that utterance are no-ops.
    //
    // State is reset either by the speech_start VAD event (primary) or by a
    // 600 ms grace window after the last emit (fallback for missed speech_start).
    // How long after the last partial to emit if speech_end doesn't arrive.
    // 200 ms is aggressive but safe — Sarvam sends speech_end within ~100–400 ms
    // after real speech ends, so this only fires if the VAD event is genuinely late.
    const LOCAL_SILENCE_MS = 200;
    const SAFETY_MS = this.endOfTurnTimeout;
    // After emitting a final, ignore new partials for this window (treats them as
    // a continuation rather than a brand-new utterance). Reduced from 1500 → 600 ms
    // so back-to-back short phrases are processed faster.
    const INTER_UTTERANCE_GRACE_MS = 600;

    let latestTranscript = "";
    let hasEmitted = false;
    let lastEmitAt = 0;
    let localSilenceTimer: ReturnType<typeof setTimeout> | null = null;
    let safetyTimer: ReturnType<typeof setTimeout> | null = null;

    function clearTimers(): void {
      if (localSilenceTimer) { clearTimeout(localSilenceTimer); localSilenceTimer = null; }
      if (safetyTimer)       { clearTimeout(safetyTimer);       safetyTimer = null; }
    }

    function emitFinal(trigger: string): void {
      if (hasEmitted) return;   // first path wins; all subsequent calls are no-ops
      hasEmitted = true;
      lastEmitAt = Date.now();
      clearTimers();
      if (!latestTranscript) return;
      const text = latestTranscript;
      latestTranscript = "";
      logger.info({ trigger, text: text.slice(0, 80) }, "Sarvam streaming STT → final");
      onTranscript(text, true);
    }

    /** Called on speech_start VAD event — canonical utterance boundary reset. */
    function onSpeechStart(): void {
      hasEmitted = false;
      latestTranscript = "";
      clearTimers();
      // Arm safety timer — fires only if neither partials nor speech_end arrive
      safetyTimer = setTimeout(() => emitFinal("safety"), SAFETY_MS);
    }

    /** Wrap each PCM chunk in a WAV container and send as AudioContent.
     *  Sarvam's streaming WS requires AudioContent envelope where:
     *  - audio.data = base64-encoded WAV (not raw PCM)
     *  - audio.encoding = "audio/wav" (enum — only value accepted)
     *  - audio.sample_rate = 16000
     *  Sending raw PCM or using field "audio_chunk" causes validation errors. */
    function sendAudioFrame(chunk: Buffer): void {
      const wav = pcmToWav(chunk, 16000);
      ws.send(JSON.stringify({
        audio: {
          data: wav.toString("base64"),
          encoding: "audio/wav",
          sample_rate: 16000,
        },
      }));
    }

    const ws = new WebSocket(wsUrl, {
      headers: { "api-subscription-key": this.key },
    });

    ws.on("open", () => {
      wsReady = true;
      for (const chunk of audioQueue.splice(0)) sendAudioFrame(chunk);
      logger.info(
        { model: apiModel, lang: this.langCode },
        "Sarvam streaming STT WebSocket opened",
      );
    });

    ws.on("message", (raw: Buffer) => {
      let msg: SarvamStreamMsg;
      try {
        msg = JSON.parse(raw.toString()) as SarvamStreamMsg;
      } catch {
        return;
      }

      // Debug log — shows raw type/shape from Sarvam so we can verify the format
      logger.debug({ msgType: msg.type, keys: Object.keys(msg) }, "Sarvam STT raw WS message");

      // ── Error ────────────────────────────────────────────────────────────────
      if (msg.type === "error") {
        logger.warn({ err: msg.data?.message }, "Sarvam streaming STT error event");
        return;
      }

      // ── Transcript ───────────────────────────────────────────────────────────
      // Raw WS docs say type="transcript"; SDK wraps it as type="data".
      // Both may carry the text in data.transcript OR top-level transcript.
      const isTranscriptMsg = msg.type === "transcript" || msg.type === "data";
      if (isTranscriptMsg) {
        const transcript = (msg.data?.transcript ?? msg.transcript ?? "").trim();
        if (transcript) {
          // Grace-window fallback: if speech_start was missed but enough time
          // has passed since the last emit, treat this as a new utterance.
          if (hasEmitted && Date.now() - lastEmitAt > INTER_UTTERANCE_GRACE_MS) {
            hasEmitted = false;
            latestTranscript = "";
            clearTimers();
          }

          latestTranscript = transcript;
          logger.info({ text: transcript.slice(0, 80) }, "Sarvam streaming STT → transcript");

          // Lazy-arm safety timer in case speech_start event was not received.
          if (!safetyTimer && !hasEmitted) {
            safetyTimer = setTimeout(() => emitFinal("safety"), SAFETY_MS);
          }

          // Reset local silence timer — emit LOCAL_SILENCE_MS after the last partial.
          if (localSilenceTimer) clearTimeout(localSilenceTimer);
          localSilenceTimer = setTimeout(() => emitFinal("local_silence"), LOCAL_SILENCE_MS);
        }
        return;
      }

      // ── VAD Events ───────────────────────────────────────────────────────────
      // Raw WS: type="speech_start" / type="speech_end" (no data wrapper needed)
      // SDK (vad_signals=true): type="events", data.signal_type="START_SPEECH"/"END_SPEECH"
      // Legacy raw: type="events", data.event="speech_start"/"speech_end"
      const isSpeechStart =
        msg.type === "speech_start" ||
        (msg.type === "events" && (
          msg.data?.event === "speech_start" ||
          msg.data?.signal_type === "START_SPEECH"
        ));
      const isSpeechEnd =
        msg.type === "speech_end" ||
        (msg.type === "events" && (
          msg.data?.event === "speech_end" ||
          msg.data?.signal_type === "END_SPEECH"
        ));

      if (isSpeechStart) {
        onSpeechStart();
      } else if (isSpeechEnd) {
        emitFinal("speech_end");
      }
    });

    ws.on("error", (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("403")) {
        streamingSubscriptionUnavailable = true;
        logger.warn(
          "Sarvam streaming STT got 403 — streaming subscription unavailable; " +
          "switching all future calls to batch mode for this server session"
        );
      } else {
        logger.error({ err }, "Sarvam streaming STT WebSocket error");
      }
    });

    ws.on("close", () => {
      logger.info("Sarvam streaming STT WebSocket closed");
      clearTimers();
      onClose?.();
    });

    return {
      sendAudio(chunk: Buffer): void {
        if (ws.readyState === WebSocket.OPEN) {
          sendAudioFrame(chunk);
        } else if (!wsReady && !closing) {
          audioQueue.push(chunk);
        }
      },
      close(): void {
        if (ws.readyState < WebSocket.CLOSING) {
          closing = true;
          // Send flush signal so Sarvam finalises any buffered partial transcript
          try { ws.send(JSON.stringify({ type: "flush" })); } catch { /* best-effort */ }
          ws.close();
        }
      },
    };
  }
}
