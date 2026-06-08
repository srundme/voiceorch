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
 * Streaming is enabled automatically when model is saaras:v3 or saaras:v3-realtime.
 * Audio is sent as raw PCM16-LE binary frames (input_audio_codec=pcm_s16le, 16 kHz).
 * Response envelope: { type: "data"|"error"|"events", data: { transcript, ... } }
 */

const VALID_SARVAM_STT_MODELS = new Set([
  "saarika:v2.5", "saarika:v2", "saarika:v1", "saarika:flash",
  "saaras:v3", "saaras:v3-realtime",
]);
const DEFAULT_SARVAM_STT_MODEL = "saaras:v3";

/** Only these models support Sarvam's real-time WebSocket API. */
const STREAMING_MODELS = new Set(["saaras:v3", "saaras:v3-realtime"]);

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
};

function normaliseSarvamLang(code: string | null): string {
  if (!code) return "en-IN";
  if (VALID_SARVAM_LANG.has(code)) return code;
  const remapped = LANG_REMAP[code.toLowerCase()];
  if (remapped) return remapped;
  const withIN = `${code}-IN`;
  if (VALID_SARVAM_LANG.has(withIN)) return withIN;
  logger.warn({ rawLang: code }, "Sarvam language unrecognised — falling back to en-IN");
  return "en-IN";
}

interface SarvamStreamMsg {
  type?: string;
  data?: { transcript?: string; message?: string; event?: string };
}

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

    if (STREAMING_MODELS.has(this.model)) {
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
    formData.append("model", this.model);
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
    // saaras:v3-realtime is our UI label; the actual API model name is saaras:v3
    const apiModel = "saaras:v3";

    const params = new URLSearchParams({
      language_code: this.langCode,
      model: apiModel,
      input_audio_codec: "pcm_s16le",
      sample_rate: "16000",
    });

    const wsUrl = `wss://api.sarvam.ai/speech-to-text/ws?${params.toString()}`;

    logger.info(
      { langCode: this.langCode, model: apiModel, wsUrl },
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

    const ws = new WebSocket(wsUrl, {
      headers: { "api-subscription-key": this.key },
    });

    ws.on("open", () => {
      wsReady = true;
      for (const chunk of audioQueue.splice(0)) ws.send(chunk);
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

      if (msg.type === "error") {
        logger.warn({ err: msg.data?.message }, "Sarvam streaming STT error event");
        return;
      }

      if (msg.type === "data") {
        const transcript = msg.data?.transcript?.trim();
        if (transcript) {
          // Grace-window fallback: if speech_start was missed but enough time
          // has passed since the last emit, treat this as a new utterance.
          if (hasEmitted && Date.now() - lastEmitAt > INTER_UTTERANCE_GRACE_MS) {
            hasEmitted = false;
            latestTranscript = "";
            clearTimers();
          }

          latestTranscript = transcript;
          logger.info({ text: transcript.slice(0, 80) }, "Sarvam streaming STT → partial");

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

      if (msg.type === "events") {
        const event = msg.data?.event;
        if (event === "speech_start") {
          // Canonical utterance boundary — reset all state for the new segment.
          onSpeechStart();
        } else if (event === "speech_end") {
          // Sarvam VAD confirms end of utterance — emit immediately.
          emitFinal("speech_end");
        }
      }
    });

    ws.on("error", (err: unknown) => {
      logger.error({ err }, "Sarvam streaming STT WebSocket error");
    });

    ws.on("close", () => {
      logger.info("Sarvam streaming STT WebSocket closed");
      clearTimers();
      onClose?.();
    });

    return {
      sendAudio(chunk: Buffer): void {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(chunk);
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
