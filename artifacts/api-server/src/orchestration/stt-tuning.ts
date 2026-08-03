/**
 * Turn-path timings for the streaming STT recovery machinery, resolved in one place.
 *
 * Two rules hold here:
 *
 * 1. Every value is WALL-CLOCK MILLISECONDS, never a frame or chunk count. Sarvam's
 *    VAD counts frames of a fixed 512 samples, so a frame count means 32ms at 16kHz
 *    but 64ms at 8kHz — a raw count silently behaves differently on telephony than
 *    on a webcall, which is how short first replies were being lost outright.
 *
 * 2. Nothing is an unexplained literal. Each value is either DERIVED from a setting
 *    the operator already controls (so it stays coherent when they retune the agent)
 *    or carries a documented rationale, and every one takes an environment override
 *    so a live call can be tuned without a redeploy.
 */

function envInt(name: string): number | null {
  const raw = process.env[name];
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Read an optional millisecond setting out of the agent config JSON. Absent or
 * unparseable means null, which downstream code treats as "leave the provider
 * default alone" rather than substituting a number of our own.
 */
export function optionalMs(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : null;
}

/** Agent-level settings the recovery timings are derived from. */
export interface SttTuningInputs {
  /** Local VAD silence that closes a turn on the batch path (agent `vadSilenceMs`). */
  vadSilenceMs: number;
  /** Provider endpointing silence (agent `asrEndpointingSilenceMs`). */
  endpointingSilenceMs: number;
  /** Stall reprompt window — the point the caller already hears a recovery prompt. */
  stallBackstopMs: number;
}

export interface SttTuning {
  /** Speech started but no STT activity for this long → treat the turn as lost. */
  lostTurnBackstopMs: number;
  /** Local silence proving the caller finished, before replaying audio to batch STT. */
  recoveryMinSilenceMs: number;
  /** Longest utterance worth recovering. */
  recoveryMaxAudioMs: number;
  /** Below this there is no utterance to recover. */
  recoveryMinAudioMs: number;
  /** Window in which a late streaming final is the turn we already recovered. */
  recoveryDedupMs: number;
  /** VAD speech this long means a one-syllable transcript is a mishearing, not noise. */
  substantiveSpeechMs: number;
}

/**
 * Speech long enough that a one-syllable transcript ("Hmm") must be a mishearing of
 * real words rather than a noise blip. Two average syllables of Indian-English or
 * Tamil speech; call 5490 discarded a 1.36s utterance on text length alone.
 */
const SUBSTANTIVE_SPEECH_MS = 700;

/**
 * How long to wait after speech starts before concluding the socket lost the turn.
 * Long enough to sit above an ordinary uninterrupted sentence, since Sarvam emits
 * nothing at all until end-of-speech and a talkative caller is not a failure.
 */
const LOST_TURN_BACKSTOP_MS = 6_000;

/** Floor for the recovery silence gate, for agents configured with very short windows. */
const RECOVERY_MIN_SILENCE_FLOOR_MS = 400;

/** Roughly two syllables — shorter than this cannot carry a recoverable turn. */
const RECOVERY_MIN_AUDIO_MS = 400;

export function resolveSttTuning(inputs: SttTuningInputs): SttTuning {
  const lostTurnBackstopMs = envInt("STT_LOST_TURN_BACKSTOP_MS") ?? LOST_TURN_BACKSTOP_MS;

  // Derived, not picked: recovery must be certain the caller stopped, so it waits
  // twice the longest silence the agent already uses to close a turn normally. An
  // agent tuned to be more patient automatically gets a more patient recovery.
  const recoveryMinSilenceMs =
    envInt("STT_RECOVERY_MIN_SILENCE_MS") ??
    Math.max(
      RECOVERY_MIN_SILENCE_FLOOR_MS,
      2 * Math.max(inputs.vadSilenceMs, inputs.endpointingSilenceMs),
    );

  // Past the stall backstop the caller has already been reprompted, so anything
  // older than a couple of those windows is no longer the turn we are recovering.
  const recoveryMaxAudioMs =
    envInt("STT_RECOVERY_MAX_AUDIO_MS") ?? 2 * inputs.stallBackstopMs;

  // A duplicate can only arrive after the socket reconnects and replays its queue,
  // so the window has to outlast the backstop that triggered the recovery.
  const recoveryDedupMs = envInt("STT_RECOVERY_DEDUP_MS") ?? 2 * lostTurnBackstopMs;

  return {
    lostTurnBackstopMs,
    recoveryMinSilenceMs,
    recoveryMaxAudioMs,
    recoveryMinAudioMs: envInt("STT_RECOVERY_MIN_AUDIO_MS") ?? RECOVERY_MIN_AUDIO_MS,
    recoveryDedupMs,
    substantiveSpeechMs: envInt("STT_SUBSTANTIVE_SPEECH_MS") ?? SUBSTANTIVE_SPEECH_MS,
  };
}
