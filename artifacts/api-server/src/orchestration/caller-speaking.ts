/**
 * Advisory caller_speaking fusion for the classic PSTN path.
 *
 * Never gates streamSTT.sendAudio (invariant 772→1320). Used for soft-duck
 * promotion, idle-cancel confidence, and room-crosstalk discard.
 *
 *   caller_speaking =
 *     STT partial
 *     OR contextual short-answer context with energy
 *     OR Silero with sustained confidence
 *     OR sustained raw energy above near-field floor
 */

export const SILERO_SUSTAINED_MS = 64;

export type CallerSpeakingInput = {
  hasSttPartial: boolean;
  /** Expecting yes/no (etc.) and near-field energy present. */
  shortAnswerWithEnergy: boolean;
  sileroSpeaking: boolean;
  /** How long Silero has been in SPEECH (ms). 0 if not speaking. */
  sileroSpeakingForMs: number;
  rawEnergyAboveFloor: boolean;
};

export type CallerSpeakingResult = {
  speaking: boolean;
  /** Which signal tipped the decision (for canary bargeSource). */
  tippedBy: "stt" | "context" | "silero" | "energy" | "none";
};

export function isSileroSustained(
  speaking: boolean,
  speakingForMs: number,
  minMs: number = SILERO_SUSTAINED_MS,
): boolean {
  return speaking && speakingForMs >= minMs;
}

export function fuseCallerSpeaking(input: CallerSpeakingInput): CallerSpeakingResult {
  if (input.hasSttPartial) return { speaking: true, tippedBy: "stt" };
  if (input.shortAnswerWithEnergy) return { speaking: true, tippedBy: "context" };
  if (isSileroSustained(input.sileroSpeaking, input.sileroSpeakingForMs)) {
    return { speaking: true, tippedBy: "silero" };
  }
  if (input.rawEnergyAboveFloor) return { speaking: true, tippedBy: "energy" };
  return { speaking: false, tippedBy: "none" };
}

/**
 * Fragment barge that never gained Silero / short-answer support → room talk.
 * Does not discard long clear near-field speech.
 */
export function shouldDiscardAsRoomCrosstalk(opts: {
  transcript: string;
  sileroSustained: boolean;
  expectingShortAnswer: boolean;
  /** Soft-duck cancelled or false barge abandoned recently. */
  recentWeakBargeEvidence: boolean;
}): boolean {
  if (!opts.recentWeakBargeEvidence) return false;
  if (opts.expectingShortAnswer) return false;
  if (opts.sileroSustained) return false;
  const text = opts.transcript.trim();
  if (!text) return false;
  const words = text.split(/\s+/).filter(Boolean);
  // Only short / weak fragments — not multi-sentence caller turns.
  return words.length <= 4 && text.length < 48;
}
