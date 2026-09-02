/**
 * Filler vs Talk playback rules.
 *
 * Call 17487: backchannel "Mm-hmm." claimed the Cartesia turn context, then
 * Talk played as separate clips on top of leftover filler — overlay + breaks.
 */

/** Fillers are one-shot PCM and must not own the streaming TTS turn context. */
export function ttsContextIdForSequence(
  sequenceId: number,
  turnContextId: string | undefined,
  fillerSequenceId: number,
): string | undefined {
  if (sequenceId === fillerSequenceId) return undefined;
  return turnContextId;
}

/**
 * Immediate backchannel is wasted (and overlays Talk) when eager/speculative
 * LLM is already generating this turn. Dead-air filler still covers a miss.
 */
export function shouldSkipImmediateBackchannel(speculativeLlmInFlight: boolean): boolean {
  return speculativeLlmInFlight;
}
