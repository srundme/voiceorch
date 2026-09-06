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
 *   mode                "transcribe" | "codemix" | "verbatim" | "translit" | "translate"
 *                       (saaras:v3 only; translate = speech-to-English)
 *   sample_rate         16000 (default) | 8000
 *   input_audio_codec   "pcm_s16le" | "wav"
 *   high_vad_sensitivity true → silence boundary = 2 VAD frames (~64ms @16kHz, ~128ms @8kHz);
 *                        default (false) is 18-of-24 frames ≈ 1s+. Fine-tune params
 *                        (negative_frames_count etc.) can override — see Sarvam Fine VAD Tuning docs.
 *   vad_signals         true → emits START_SPEECH / END_SPEECH events
 *   first_turn_min_speech_frames  consecutive speech frames needed to open the FIRST
 *                        segment of a connection. Server default 8 — and a VAD frame is
 *                        512 samples, i.e. 64ms at 8kHz, so the default silently demands
 *                        512ms of speech on telephony and swallows short first replies.
 *                        We send a sample-rate-compensated value.
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
import { resolveSarvamSttMode, type SarvamSttMode } from "./sarvam-mode.js";

export { resolveSarvamSttMode } from "./sarvam-mode.js";

function envInt(name: string, def: number): number {
  const v = process.env[name];
  if (!v) return def;
  const n = parseInt(v, 10);
  return isNaN(n) ? def : n;
}

const BATCH_URL = "https://api.sarvam.ai/speech-to-text";
const WS_BASE = "wss://api.sarvam.ai/speech-to-text/ws";

/** Sarvam's VAD frame size. Fixed in SAMPLES, so its duration varies with sample rate. */
const VAD_FRAME_SAMPLES = 512;

/** Wall-clock duration of one Sarvam VAD frame (fixed 512 samples) at a given rate. */
export function vadFrameMs(sampleRate: 8000 | 16000): number {
  return (VAD_FRAME_SAMPLES / sampleRate) * 1000;
}

/**
 * Convert a wall-clock window into Sarvam VAD frames at the rate we are actually
 * streaming.
 *
 * Every Sarvam VAD parameter is a FRAME COUNT, and a frame is a fixed 512 samples
 * — 32ms at 16kHz but 64ms at 8kHz. So any hardcoded frame count silently means
 * TWICE as long on telephony as it does on a webcall. That is not a hypothetical:
 * it is exactly how first-turn replies were being lost (see below). Express every
 * VAD setting in milliseconds and derive the frame count here, and the same
 * configured value means the same thing on both paths by construction.
 */
export function msToVadFrames(ms: number, sampleRate: 8000 | 16000): number {
  return Math.max(1, Math.round(ms / vadFrameMs(sampleRate)));
}

/**
 * Consecutive speech required before the FIRST speech segment of a connection
 * opens. Sarvam's server default is 8 frames and `high_vad_sensitivity` does not
 * touch it, so at 8kHz it demands 512ms of continuous speech: short first replies
 * ("Yes", "Okay", "ஆமா" — typically 200-400ms) never open a segment and are lost
 * with no transcript and no speech_start. "First turn" resets per connection, so
 * every reconnect and live language switch re-arms it.
 *
 * 256ms is Sarvam's intended window — the frame default read at 16kHz.
 */
export const DEFAULT_FIRST_TURN_MIN_SPEECH_MS = 256;

/**
 * Silence required to close a speech segment — the single biggest contributor to
 * turn latency, because Sarvam emits a transcript ONLY at end-of-speech.
 *
 * `high_vad_sensitivity` is a coarse two-position switch over this value, and at
 * 8kHz both positions are bad: ON is 2 frames (~128ms, which chopped callers
 * mid-utterance on PSTN — call 4940) and OFF is 18-of-24 frames (~1150-1550ms of
 * dead air on every single turn). Sending the underlying frame counts explicitly
 * gives the whole range in between, in real milliseconds, at any sample rate.
 *
 * Left null by default so behaviour is unchanged until an operator opts in.
 */
export const DEFAULT_END_OF_SPEECH_SILENCE_MS: number | null = null;

/**
 * Sarvam tolerates a stray non-silent blip inside the silence window rather than
 * demanding a strictly consecutive run — its own default is 18 silent frames out
 * of a 24-frame window. Mirror that ratio so a click or breath late in the pause
 * does not reset the countdown and stall the turn.
 */
const NEGATIVE_FRAMES_TOLERANCE_RATIO = 18 / 24;

/**
 * Frame counts for the end-of-speech silence boundary, derived from a wall-clock
 * target. Returns the `negative_frames_count` / `negative_frames_window` pair.
 */
export function endOfSpeechFrames(
  silenceMs: number,
  sampleRate: 8000 | 16000,
): { count: number; window: number } {
  const count = msToVadFrames(silenceMs, sampleRate);
  return { count, window: Math.ceil(count / NEGATIVE_FRAMES_TOLERANCE_RATIO) };
}

/**
 * Has an owed transcript failed to arrive? `transcriptOwedSince` is set ONLY by
 * speech_end, which is the single point where Sarvam has committed to returning
 * text and inbound silence therefore means something is wrong.
 *
 * It must never be armed by speech_start. Doing so put a hard ~3s ceiling on how
 * long a caller could speak before their socket was terminated mid-sentence and
 * their words destroyed (calls 5498/5499) — Sarvam sends nothing at all during an
 * utterance, so an open segment and a dead socket look identical.
 */
export function isTranscriptOverdue(args: {
  transcriptOwedSince: number;
  nowMs: number;
  deadMs: number;
}): boolean {
  const { transcriptOwedSince, nowMs, deadMs } = args;
  if (transcriptOwedSince <= 0) return false;
  return nowMs - transcriptOwedSince > deadMs;
}

/**
 * Has Sarvam's recognition engine stopped producing transcripts while its VAD
 * keeps signalling? See the stall-detection notes in createStream() for why the
 * signal is repeated speech_start rather than a plain no-transcript timeout.
 *
 * Both conditions are required. `minSegments` alone would fire on a fast stutter;
 * elapsed time alone would fire on any caller who talks longer than the threshold
 * without pausing, terminating a perfectly healthy socket mid-sentence.
 *
 * @param speechStartsSinceTranscript speech_start events with no transcript between them
 * @param awaitingTranscriptSince timestamp of the FIRST such speech_start, 0 when none pending
 */
export function isRecognitionStalled(args: {
  speechStartsSinceTranscript: number;
  awaitingTranscriptSince: number;
  nowMs: number;
  deadMs: number;
  minSegments: number;
}): boolean {
  const {
    speechStartsSinceTranscript,
    awaitingTranscriptSince,
    nowMs,
    deadMs,
    minSegments,
  } = args;
  if (awaitingTranscriptSince <= 0) return false;
  if (speechStartsSinceTranscript < minSegments) return false;
  return nowMs - awaitingTranscriptSince > deadMs;
}

/**
 * Resolve a millisecond setting: per-agent config wins, then a deploy-wide env
 * override, then the documented default. Out-of-range values are clamped rather
 * than trusted, so a bad config cannot disable VAD outright.
 *
 * `null` and `undefined` both mean "not configured" — agent config carries null
 * for an unset field, and it must still fall through to the env override.
 */
export function resolveMsSetting(
  configured: number | null | undefined,
  envVar: string,
  fallback: number,
  bounds: { min: number; max: number },
): number {
  return resolveOptionalMsSetting(configured, envVar, fallback, bounds) ?? fallback;
}

/**
 * As resolveMsSetting, but a null fallback means the setting stays absent so the
 * provider's own default applies — used where we deliberately do not want to
 * impose a value of our own.
 */
export function resolveOptionalMsSetting(
  configured: number | null | undefined,
  envVar: string,
  fallback: number | null,
  bounds: { min: number; max: number },
): number | null {
  const clamp = (n: number): number => Math.max(bounds.min, Math.min(bounds.max, Math.round(n)));
  if (typeof configured === "number" && Number.isFinite(configured)) return clamp(configured);
  const fromEnv = envInt(envVar, Number.NaN);
  if (Number.isFinite(fromEnv)) return clamp(fromEnv);
  return fallback === null ? null : clamp(fallback);
}

/** Only saaras:v3/v4 support the `mode` parameter. */
const MODE_CAPABLE = new Set(["saaras:v3", "saaras:v4"]);

/**
 * Strip leaked diarization/speaker labels (e.g. "Speaker 1:", "speaker:") from a
 * transcript line. Some Sarvam responses prefix utterances with a speaker tag that
 * would otherwise leak verbatim into the LLM context (call 548). Removes the label
 * at the start of the string or immediately after any newline, then trims.
 */
function stripDiarizationLabels(text: string): string {
  return text.replace(/(^|\n)\s*speaker\s*\d*\s*:\s*/gi, "$1").trim();
}

/** BCP-47 codes accepted by EVERY Sarvam STT model (saarika:v2.5's 11-language
 *  set: 10 Indian + English). Note: Odia uses od-IN, not or-IN. */
const CORE_LANG = new Set([
  "bn-IN",
  "en-IN",
  "gu-IN",
  "hi-IN",
  "kn-IN",
  "ml-IN",
  "mr-IN",
  "od-IN",
  "pa-IN",
  "ta-IN",
  "te-IN",
]);

/** Languages supported ONLY by saaras:v3 (the 23-language model — 22 Indian +
 *  English): Assamese, Bodo, Dogri, Konkani, Kashmiri, Maithili, Manipuri,
 *  Nepali, Sanskrit, Santali, Sindhi, Urdu. Previously these were rejected and
 *  silently fell back to en-IN even on saaras:v3. */
const SAARAS_EXTRA_LANG = new Set([
  "as-IN",
  "brx-IN",
  "doi-IN",
  "kok-IN",
  "ks-IN",
  "mai-IN",
  "mni-IN",
  "ne-IN",
  "sa-IN",
  "sat-IN",
  "sd-IN",
  "ur-IN",
]);

/** ISO-639 bare codes → Sarvam BCP-47. */
const LANG_MAP: Record<string, string> = {
  bn: "bn-IN",
  en: "en-IN",
  gu: "gu-IN",
  hi: "hi-IN",
  kn: "kn-IN",
  ml: "ml-IN",
  mr: "mr-IN",
  or: "od-IN",
  od: "od-IN", // Odia: BCP-47 is or-IN but Sarvam uses od-IN
  pa: "pa-IN",
  ta: "ta-IN",
  te: "te-IN",
  // saaras:v3-only languages
  as: "as-IN",
  brx: "brx-IN",
  doi: "doi-IN",
  kok: "kok-IN",
  ks: "ks-IN",
  mai: "mai-IN",
  mni: "mni-IN",
  ne: "ne-IN",
  sa: "sa-IN",
  sat: "sat-IN",
  sd: "sd-IN",
  ur: "ur-IN",
};

function normaliseLang(code: string | null | undefined, model: string): string {
  if (!code) return "en-IN";
  // saaras models cover the full 23-language set; saarika only the 11-language core.
  const isValid = (c: string) =>
    CORE_LANG.has(c) ||
    (model.startsWith("saaras") && SAARAS_EXTRA_LANG.has(c));
  const t = code.trim();
  if (isValid(t)) return t;
  const bare = t.split("-")[0]?.toLowerCase() ?? "";
  const mapped = LANG_MAP[bare];
  if (mapped && isValid(mapped)) return mapped;
  logger.warn(
    { rawLang: code, model },
    "Sarvam STT: unsupported language for this model — falling back to en-IN",
  );
  return "en-IN";
}

interface SarvamMsg {
  type: string;
  /** Sarvam attaches a request_id to responses — quoting it is the fastest path for support escalations. */
  request_id?: string;
  data?: {
    transcript?: string;
    signal_type?: string;
    message?: string;
    language_code?: string;
    request_id?: string;
  };
}

export class SarvamSTT implements STTAdapter {
  private readonly key: string;
  private readonly model: string;
  private readonly langCode: string;
  private readonly mode: SarvamSttMode;
  private readonly explicitMode: string | null;
  private readonly highVadSensitivity: boolean;
  /** Wall-clock VAD windows; converted to frames at connect time (see msToVadFrames). */
  private readonly firstTurnMinSpeechMs: number | null;
  private readonly endOfSpeechSilenceMs: number | null;
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
      ? (JSON.parse(extraConfig) as {
          mode?: string;
          highVadSensitivity?: boolean;
          firstTurnMinSpeechMs?: number | null;
          endOfSpeechSilenceMs?: number | null;
        })
      : {};

    // Model: saaras:v3 (recommended) or saarika:v2.5 (legacy) — the only models
    // the streaming WS endpoint accepts (v3/v2.5 live-verified).
    // saaras:v4 streaming is UNSTABLE: repeated "2s of speech, zero WS activity"
    // backstop fires and causes fully lost turns. Force v3 until Sarvam confirms
    // the fix. If a stored config has v4, silently downgrade.
    const requested = (model ?? "").trim();
    const ALLOWED_MODELS = ["saaras:v3", "saarika:v2.5"];
    this.model = ALLOWED_MODELS.includes(requested)
      ? requested
      : "saaras:v3";

    this.langCode = normaliseLang(cfg.language, this.model);
    this.explicitMode = extra.mode ?? null;

    // Mode: explicit agent config wins; else codemix (mixed Indian speech).
    this.mode = MODE_CAPABLE.has(this.model)
      ? resolveSarvamSttMode(this.langCode, this.explicitMode)
      : "transcribe";

    this.highVadSensitivity =
      typeof extra.highVadSensitivity === "boolean"
        ? extra.highVadSensitivity
        : true;

    // VAD windows are configured in milliseconds and converted to frames against
    // the live sample rate, so one value behaves identically on 8kHz telephony and
    // 16kHz webcall. Agent config wins; env is the deploy-wide override.
    this.firstTurnMinSpeechMs = resolveOptionalMsSetting(
      extra.firstTurnMinSpeechMs,
      "SARVAM_FIRST_TURN_MIN_SPEECH_MS",
      null,
      { min: 32, max: 2000 },
    );
    this.endOfSpeechSilenceMs = resolveOptionalMsSetting(
      extra.endOfSpeechSilenceMs,
      "SARVAM_END_OF_SPEECH_SILENCE_MS",
      DEFAULT_END_OF_SPEECH_SILENCE_MS,
      { min: 64, max: 2000 },
    );

    logger.info(
      {
        langCode: this.langCode,
        mode: this.mode,
        model: this.model,
        explicitMode: this.explicitMode,
        highVadSensitivity: this.highVadSensitivity,
        sampleRate: this.sampleRate,
        vadFrameMs: vadFrameMs(this.sampleRate),
        firstTurnMinSpeechMs: this.firstTurnMinSpeechMs,
        firstTurnMinSpeechFrames: this.firstTurnMinSpeechMs
          ? msToVadFrames(this.firstTurnMinSpeechMs, this.sampleRate)
          : null,
        endOfSpeechSilenceMs: this.endOfSpeechSilenceMs,
        endOfSpeechFrames: this.endOfSpeechSilenceMs
          ? endOfSpeechFrames(this.endOfSpeechSilenceMs, this.sampleRate)
          : null,
      },
      "Sarvam STT: mode resolved",
    );
  }

  // ── Batch REST ──────────────────────────────────────────────────────────────

  async transcribe(
    audioBuffer: Buffer,
    sampleRate = this.sampleRate,
  ): Promise<string> {
    const wav = pcmToWav(audioBuffer, sampleRate);

    const formData = new FormData();
    // Copy into a plain ArrayBuffer to avoid SharedArrayBuffer incompatibility with Blob.
    const wavBuf = wav.buffer.slice(
      wav.byteOffset,
      wav.byteOffset + wav.byteLength,
    ) as ArrayBuffer;
    formData.append(
      "file",
      new Blob([wavBuf], { type: "audio/wav" }),
      "audio.wav",
    );
    formData.append(
      "model",
      this.model.startsWith("saaras") ? this.model : "saarika:v2.5",
    );
    formData.append("language_code", this.langCode);
    if (MODE_CAPABLE.has(this.model)) {
      formData.append("mode", this.mode);
    }

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
    let langCode = this.langCode;
    let mode = this.mode;
    const explicitMode = this.explicitMode;
    const model = this.model;
    const key = this.key;
    const sampleRate = this.sampleRate;

    // Built per-connection (inside openSocket) so a reconnect after a live
    // language switch picks up the current langCode.
    const buildWsUrl = (): string => {
      const params = new URLSearchParams({
        model: model,
        language_code: langCode,
        sample_rate: String(sampleRate),
        input_audio_codec: "pcm_s16le",
        high_vad_sensitivity: this.highVadSensitivity ? "true" : "false",
        vad_signals: "true", // emit speech_start / speech_end events
        flush_signal: "true", // allow manual buffer flush via flush() call
      });
      if (this.firstTurnMinSpeechMs !== null) {
        params.set(
          "first_turn_min_speech_frames",
          String(msToVadFrames(this.firstTurnMinSpeechMs, sampleRate)),
        );
      }
      // Explicit end-of-speech boundary. Unset by default, which leaves Sarvam on
      // whichever preset high_vad_sensitivity selects; set it to escape that
      // two-position switch and choose a real silence window in milliseconds.
      if (this.endOfSpeechSilenceMs !== null) {
        const { count, window } = endOfSpeechFrames(this.endOfSpeechSilenceMs, sampleRate);
        params.set("negative_frames_count", String(count));
        params.set("negative_frames_window", String(window));
      }
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
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    const MAX_RECONNECT = 10;

    const audioQueue: Buffer[] = [];
    // Increased to 16s to cover the full reconnect backoff ceiling (500ms→8s).
    // Dropping the oldest 8s meant losing the START of the caller's speech after
    // a reconnect — the most important part. 16s covers the worst-case backoff.
    const MAX_QUEUE_BYTES = sampleRate * 2 * 16; // 16s of audio (512KB @16k, 256KB @8k)
    let queueTrimLogged = false; // throttle: log queue trim at most once per reconnect episode
    let speechEndAt = 0; // timestamp of last END_SPEECH event for latency tracking
    let lastRequestId: string | undefined; // latest request_id seen — attached to transcript/error logs for Sarvam support

    // Closure variables for the onSpeechStart / onSpeechEnd callbacks. Declared here
    // (before openSocket) so the WS message handler — an async callback inside openSocket —
    // can reference them safely. Exposed on sttObj via Object.defineProperty getter/setter below.
    let _onSpeechStart: (() => void) | null = null;
    let _onSpeechEnd: (() => void) | null = null;

    // ── Transcript commit ────────────────────────────────────────────────────
    // Saaras owns turn boundaries (vad_signals END_SPEECH + transcript).
    // Passthrough: emit finals immediately; END_SPEECH only fires onSpeechEnd.
    // A socket can go ZOMBIE — readyState OPEN but dead — without ever emitting
    // "close", so it has to be detected actively. The hard part is that on this
    // protocol INBOUND SILENCE IS NOT EVIDENCE OF ANYTHING: Sarvam emits nothing
    // between turns (no speech) and nothing during an utterance (transcripts come
    // only at end-of-speech), so a quiet socket is the normal case.
    //
    // We used to terminate after 3s of inbound silence inside an open speech
    // segment, which is exactly when Sarvam is legitimately quiet. That put a hard
    // ~3s ceiling on how long a caller could speak: calls 5498/5499 show every
    // utterance past ~3.1s being guillotined mid-sentence and the words destroyed,
    // while the longest survivor (3078ms) only made it because speech_end beat the
    // heartbeat tick. Roughly a fifth of turns, and the true cause of the
    // long-standing "STT randomly misses a turn" reports. Do not reinstate it.
    //
    // What replaces it, in order of how quickly each fires:
    //   (a) speech_end arrived but no transcript followed — Sarvam has committed to
    //       returning text, so here silence really is a fault.
    //   (b) repeated speech_start with no transcript — the engine restarted its VAD
    //       without recognising anything (call 5439).
    //   (c) WebSocket ping with no pong — protocol-level liveness, the only check
    //       that is independent of application traffic and so the only one that can
    //       catch a socket that dies while nothing is expected of it.
    // The lastAudioSentAt guard keeps all of them off during send gaps (AMD
    // confirmation, pre-greeting, carrier DTX). deadFired latches so we act once per
    // episode.
    let lastAudioSentAt = 0;
    let inSpeechSegment = false;
    let deadFired = false;
    const HEARTBEAT_MS = 300;
    const WS_DEAD_MS = 3_000;

    // Protocol-level liveness. This SELF-CALIBRATES: we only ever terminate on a
    // missing pong after seeing at least one pong on this socket, so if Sarvam's
    // server does not answer pings we simply never enforce it rather than killing
    // every connection. Deliberately slack compared with (a) and (b) — it is the
    // last-resort net for "died while we expected nothing", where being right
    // matters far more than being quick.
    const PING_INTERVAL_MS = 5_000;
    const PONG_DEAD_MS = 15_000;
    let lastPingAt = 0;
    let lastPongAt = 0;
    let pongSupported = false;

    // ── Recognition-engine stall detection (call 5439) ────────────────────────
    // The silence check above only proves the SOCKET is alive, and every inbound
    // frame — including VAD signals — refreshes it. Sarvam can keep emitting
    // speech_start while its recognition engine has stopped producing transcripts
    // entirely, which refreshes lastMsgAt forever and makes the zombie detector
    // blind to the exact failure it exists to catch. Call 5439 died that way: three
    // speech_start events over ~8s, no transcript, no termination, then the silence
    // reprompt ladder and a silence_timeout hangup.
    //
    // A plain "no transcript for N seconds" timer cannot be used instead: Sarvam
    // emits transcripts only at end-of-speech, so a caller talking continuously
    // looks identical to a stall and we would terminate a healthy socket mid-turn.
    //
    // The distinguishing signature is REPEATED speech_start with no transcript in
    // between. A healthy utterance — however long — is one speech_start, then
    // speech_end, then a transcript. Two speech_starts with nothing in between
    // means the engine restarted its VAD without ever recognising anything.
    let awaitingTranscriptSince = 0; // first speech_start of the current silent run
    let speechStartsSinceTranscript = 0;
    /** speech_end arrived and Sarvam owes us text — 0 when nothing is outstanding. */
    let transcriptOwedSince = 0;
    /** Consecutive flush() calls that found nothing to emit — see flush(). */
    let emptyFlushes = 0;
    /** speech_starts with no transcript that mean the engine, not the line, is stuck. */
    const VAD_STALL_MIN_SEGMENTS = 2;
    /** Empty flushes tolerated before forcing a reconnect. */
    const MAX_EMPTY_FLUSHES = 2;

    /**
     * Drop every "the engine may be stuck" signal and re-arm the detectors.
     *
     * Called when recognition demonstrably works (a transcript arrived) and when a
     * fresh socket opens. The second case is not optional: the counters that
     * justified terminating a socket would otherwise still be armed against its
     * replacement, and the heartbeat would kill each new socket on sight.
     */
    const clearStallState = (): void => {
      awaitingTranscriptSince = 0;
      speechStartsSinceTranscript = 0;
      transcriptOwedSince = 0;
      emptyFlushes = 0;
      deadFired = false;
    };

    /**
     * Terminate a socket we have judged unusable so ws.on("close") runs the normal
     * exponential-backoff reconnect (terminate produces 1006, not an auth code).
     * Latches via deadFired so one episode causes one termination.
     */
    const killZombie = (cause: string, detail: Record<string, unknown>): void => {
      deadFired = true;
      logger.warn(
        { langCode, cause, ...detail },
        "Sarvam STT: terminating zombie socket to force reconnect",
      );
      try {
        sttObj.onConnectionDead?.();
      } catch {
        /* optional external consumer hook */
      }
      try {
        ws.terminate();
      } catch {
        try {
          ws.close();
        } catch {
          /* noop */
        }
      }
    };

    const sendChunk = (chunk: Buffer) => {
      if (!wsReady || ws.readyState !== WebSocket.OPEN) return;
      const now = Date.now();
      ws.send(
        JSON.stringify({
          audio: {
            data: chunk.toString("base64"),
            encoding: "audio/wav", // enum must be "audio/wav"; actual codec is set via URL param
            sample_rate: sampleRate,
          },
        }),
      );
      lastAudioSentAt = now; // proves we are ACTIVELY streaming — gates the zombie detector
    };

    const openSocket = () => {
      if (intentionallyClosed) return;
      wsReady = false;

      ws = new WebSocket(buildWsUrl(), {
        headers: { "api-subscription-key": key },
      });

      ws.on("open", () => {
        wsReady = true;
        reconnectAttempts = 0;
        clearStallState(); // fresh socket — re-arm the zombie detectors from zero
        // Treat the new socket as freshly ponged so its liveness window starts now
        // rather than inheriting the dead socket's timestamps.
        lastPongAt = Date.now();
        lastPingAt = Date.now();
        queueTrimLogged = false; // re-arm queue-trim log for this reconnect episode
        // Reset VAD state so a stale in-speech flag does not survive across reconnects.
        inSpeechSegment = false;
        logger.info(
          { langCode, model, mode },
          "Sarvam streaming STT: WebSocket opened",
        );
        // Flush any audio that arrived before the socket was ready.
        for (const chunk of audioQueue.splice(0)) sendChunk(chunk);
      });

      // A pong is the one inbound frame that means "alive" without meaning anything
      // about recognition, so it is the only safe liveness signal on this protocol.
      // Seeing one also switches the liveness check on for good (see pongSupported).
      ws.on("pong", () => {
        lastPongAt = Date.now();
        pongSupported = true;
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
        //
        // Note there is deliberately no "any inbound frame proves we are healthy"
        // bookkeeping here. VAD signals are inbound frames, and treating them as
        // proof of life is what blinded the detector to a stalled engine in call
        // 5439. Only a transcript or a pong clears health state now.

        // Keep the latest request_id (Sarvam docs: support/debugging requests are
        // resolved fastest when the affected call's request_id can be quoted).
        const _reqId = msg.request_id ?? msg.data?.request_id;
        if (_reqId) lastRequestId = _reqId;
        if (
          msg.type === "speech_start" ||
          (msg.type === "events" && msg.data?.signal_type === "START_SPEECH")
        ) {
          inSpeechSegment = true;
          // Stall tracking: time the run from the FIRST un-transcribed speech_start,
          // not the latest. Restarting the clock on every speech_start is precisely
          // how a stalled engine kept the window open indefinitely (call 5439).
          speechStartsSinceTranscript++;
          if (awaitingTranscriptSince === 0) awaitingTranscriptSince = Date.now();
          _onSpeechStart?.();
          logger.debug({ langCode }, "Sarvam STT: speech start");
          return;
        }
        if (
          msg.type === "speech_end" ||
          (msg.type === "events" && msg.data?.signal_type === "END_SPEECH")
        ) {
          inSpeechSegment = false;
          speechEndAt = Date.now();
          // Sarvam owes us a transcript from here. This is the ONLY point at which
          // inbound silence is evidence of anything — see the heartbeat check.
          transcriptOwedSince = Date.now();
          logger.debug({ langCode }, "Sarvam STT: speech end");
          _onSpeechEnd?.();
          return;
        }

        // Final transcript — official type: "transcript"; legacy: "data"
        if (msg.type === "transcript" || msg.type === "data") {
          inSpeechSegment = false; // segment complete
          // Clear stall state on ANY transcript message, including an empty one:
          // the recognition engine answered, which is what the detector is watching
          // for. A repeatedly-empty transcript is a different failure (the turn is
          // lost but the engine is healthy) and is handled by the pipeline's
          // lost-turn recovery, not by terminating a working socket.
          clearStallState();
          const text = stripDiarizationLabels(msg.data?.transcript ?? "");
          // Capture the language Sarvam identified for this segment (saaras:v3 LID).
          //
          // IMPORTANT: only forward the reported code when it DIFFERS from the
          // init language (langCode). When Sarvam is initialised with
          // language_code=en-IN it echoes "en-IN" on every response regardless
          // of what the caller actually spoke — this is NOT real LID; it is just
          // the init-language echoed back. Forwarding that echo would suppress
          // detectScriptLanguage() in the pipeline: the pipeline short-circuits on
          // a non-null sttLang and never reads Unicode script blocks in the
          // transcript. Leaving detectedLang undefined on "same-as-init" responses
          // lets detectScriptLanguage() run and catch actual Indic-script characters
          // (Tamil, Hindi, etc.) in the transcript text.
          const reportedLang = msg.data?.language_code;
          // Instrumentation (do NOT change filtering yet): log every reported
          // language_code with the init language + resolved mode so wrong-language
          // calls can be diagnosed — if reportedLang never differs from langCode
          // the echo-back assumption below holds; if it differs on wrong-language
          // calls, the filter is discarding real detections.
          logger.info(
            {
              reportedLang,
              langCode,
              differs: !!reportedLang && reportedLang !== langCode,
              model,
              mode,
            },
            "Sarvam STT: language_code on transcript message",
          );
          const detectedLang =
            reportedLang && reportedLang !== langCode ? reportedLang : undefined;
          if (!text) return;
          const meta: SttFinalMetadata = {
            endDetectToFinalMs:
              speechEndAt > 0 ? Date.now() - speechEndAt : undefined,
            requestId: lastRequestId,
          };
          logger.info(
            {
              text: text.slice(0, 80),
              model,
              mode,
              endDetectToFinalMs: meta.endDetectToFinalMs,
              requestId: lastRequestId,
              detectedLang,
            },
            "Sarvam STT: final transcript",
          );
          speechEndAt = 0;
          // Saaras owns turn-taking — emit finals immediately (no SnapServe hold).
          onTranscript(text, true, detectedLang, meta);
          return;
        }

        if (msg.type === "error") {
          logger.error(
            {
              msg: msg.data?.message,
              requestId:
                msg.request_id ?? msg.data?.request_id ?? lastRequestId,
              langCode,
            },
            "Sarvam STT: server error",
          );
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
          logger.info(
            { langCode, model },
            "Sarvam STT: reopening WebSocket after language switch",
          );
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
          logger.error(
            { code, reconnectAttempts },
            "Sarvam STT: max reconnects reached",
          );
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
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          openSocket();
        }, delay);
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
              dropped += len;
              total -= len;
            }
            logger.warn(
              { droppedBytes: dropped, totalQueued: audioQueue.length, reconnectAttempts },
              "Sarvam STT: audio queue trimmed — dropped stale chunks during reconnect backoff",
            );
          }
        } else {
          sendChunk(chunk);
        }
      },
      // Sarvam's server VAD owns end-of-speech; client code must never finalize a
      // turn (the calls-772→1320 regression class). The one live call site is the
      // pipeline's lost-turn backstop (armVadFlushBackstop), which is safe only
      // because this drains local buffers rather than endpointing. Do not add call
      // sites that finalize turns.
      flush(): boolean {
        // No local transcript buffer in Saaras-passthrough mode — flush is a no-op
        // for held text. We still track empty flushes for stall/reconnect detection.
        const emitted = false;

        // Note: We deliberately do NOT send the JSON `flush: true` packet to Sarvam's
        // streaming endpoint here. Manual flushes corrupt Sarvam's internal context window
        // (causing subsequent audio to be missed or garbage transcripts to be generated).
        logger.debug(
          { langCode, emitted },
          "Sarvam STT: local buffers flushed (socket flush bypassed)",
        );

        // An empty flush means the caller's lost-turn backstop fired and there was
        // nothing held to recover — the engine produced nothing at all. One can be a
        // timing artefact; repeated ones mean recognition is stuck, so force the
        // socket to reconnect rather than flushing an empty buffer forever (the
        // pipeline logged four such flushes while call 5439 died).
        if (emitted) {
          emptyFlushes = 0;
        } else if (
          ++emptyFlushes >= MAX_EMPTY_FLUSHES &&
          !deadFired &&
          ws.readyState === WebSocket.OPEN
        ) {
          killZombie("empty_flushes", {
            emptyFlushes,
            reason: "repeated lost-turn flushes found nothing to emit",
          });
        }
        return emitted;
      },
      setLanguage(lang: string): void {
        const next = normaliseLang(lang, model);
        if (next === langCode) return; // already on it — no-op (loop guard)
        if (intentionallyClosed) return; // stream already torn down
        const prev = langCode;
        langCode = next;
        mode = resolveSarvamSttMode(langCode, explicitMode);
        logger.info(
          { from: prev, to: next, mode, model },
          "Sarvam STT: live language switch — reconnecting stream with new language hint",
        );
        if (
          ws &&
          (ws.readyState === WebSocket.OPEN ||
            ws.readyState === WebSocket.CONNECTING)
        ) {
          switchingLanguage = true; // close handler reopens immediately with new langCode
          try {
            ws.close(1000);
          } catch {
            switchingLanguage = false;
            try {
              ws.terminate();
            } catch {
              /* noop */
            }
            openSocket();
          }
        }
        // else: socket is between reconnects — the pending reconnect timer's
        // openSocket() will pick up the new langCode via buildWsUrl().
      },
      close(): void {
        intentionallyClosed = true;
        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }
        clearInterval(heartbeatInterval);
        if (
          ws.readyState === WebSocket.OPEN ||
          ws.readyState === WebSocket.CONNECTING
        ) {
          ws.close(1000);
        }
      },
      getPendingTranscript(): string {
        return "";
      },
    };

    // Expose _onSpeechStart / _onSpeechEnd via getter/setter so the WS handler (which
    // closes over these variables, declared before openSocket) stays in sync with whatever
    // callback the caller assigns after sttObj is returned.
    Object.defineProperty(sttObj, "onSpeechStart", {
      get(): (() => void) | null {
        return _onSpeechStart;
      },
      set(cb: (() => void) | null): void {
        _onSpeechStart = cb;
      },
      configurable: true,
      enumerable: true,
    });
    Object.defineProperty(sttObj, "onSpeechEnd", {
      get(): (() => void) | null {
        return _onSpeechEnd;
      },
      set(cb: (() => void) | null): void {
        _onSpeechEnd = cb;
      },
      configurable: true,
      enumerable: true,
    });

    // Sarvam closes the streaming WS after ~60 s of inactivity (documented
    // limit). The pipeline gates caller frames during agent playback, so a long
    // agent monologue / hold can starve the socket into an idle close + a
    // pointless reconnect cycle. After 15 s with nothing sent, ship a short
    // near-silent PCM frame as a keep-alive (official guidance). Sent RAW — not
    // via sendChunk — so it never updates lastAudioSentAt: keep-alives must not
    // count as "actively streaming" and arm the zombie detector.
    const KEEPALIVE_IDLE_MS = 15_000;
    const KEEPALIVE_FRAME = Buffer.alloc(Math.floor(sampleRate * 0.2) * 2); // 200 ms silence, s16le mono
    let lastKeepAliveAt = 0;

    // Start the heartbeat AFTER sttObj is created so the interval can reference it.
    const heartbeatInterval = setInterval(() => {
      if (intentionallyClosed) return; // torn down
      // ── Idle keep-alive (only OUTSIDE speech segments — real audio covers the rest) ──
      const nowMs = Date.now();
      if (
        wsReady &&
        ws.readyState === WebSocket.OPEN &&
        !inSpeechSegment &&
        nowMs - lastAudioSentAt > KEEPALIVE_IDLE_MS &&
        nowMs - lastKeepAliveAt > KEEPALIVE_IDLE_MS
      ) {
        lastKeepAliveAt = nowMs;
        try {
          ws.send(
            JSON.stringify({
              audio: {
                data: KEEPALIVE_FRAME.toString("base64"),
                encoding: "audio/wav",
                sample_rate: sampleRate,
              },
            }),
          );
          logger.debug(
            { langCode },
            "Sarvam STT: idle keep-alive frame sent (60s inactivity guard)",
          );
        } catch {
          /* socket racing closed — the close handler's reconnect path covers it */
        }
      }
      if (deadFired) return; // zombie already handled this episode
      if (ws.readyState !== WebSocket.OPEN) return; // CONNECTING/CLOSING handled elsewhere
      if (Date.now() - lastAudioSentAt > WS_DEAD_MS) return; // not actively streaming

      // (c) Protocol-level liveness, independent of anything Sarvam chooses to send.
      if (Date.now() - lastPingAt > PING_INTERVAL_MS) {
        lastPingAt = Date.now();
        try {
          ws.ping();
        } catch {
          /* racing close — the close handler reconnects */
        }
      }
      if (pongSupported && Date.now() - lastPongAt > PONG_DEAD_MS) {
        killZombie("no_pong", {
          sincePongMs: Date.now() - lastPongAt,
          reason: "WebSocket ping went unanswered",
        });
        return;
      }

      // (a) Owed transcript never arrived: speech_end was received, so Sarvam has
      //     committed to returning text and inbound silence is genuinely wrong.
      if (
        isTranscriptOverdue({
          transcriptOwedSince,
          nowMs: Date.now(),
          deadMs: WS_DEAD_MS,
        })
      ) {
        killZombie("transcript_never_arrived", {
          owedForMs: Date.now() - transcriptOwedSince,
          reason: "speech_end received but no transcript followed",
        });
        return;
      }

      // (b) Stalled recognition engine: VAD signals keep arriving — so (a) can
      //     never fire — but no transcript has come back across repeated speech
      //     segments. Requires BOTH repeated speech_starts and elapsed time so a
      //     single long utterance can never trip it.
      if (
        isRecognitionStalled({
          speechStartsSinceTranscript,
          awaitingTranscriptSince,
          nowMs: Date.now(),
          deadMs: WS_DEAD_MS,
          minSegments: VAD_STALL_MIN_SEGMENTS,
        })
      ) {
        killZombie("recognition_stalled", {
          stalledMs: Date.now() - awaitingTranscriptSince,
          speechStartsSinceTranscript,
          reason: "VAD active but recognition returned no transcript",
        });
      }
    }, HEARTBEAT_MS);

    return sttObj;
  }
}
