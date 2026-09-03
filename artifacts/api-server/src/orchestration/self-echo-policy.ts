/**
 * Bolna self-echo. They do not match TTS text to STT.
 *
 * `welcome_played=false` mutes every transcript (including stop).
 * While the agent is speaking, `word_count <= number_of_words` is ignored.
 * After the agent stops, the floor is 0.
 */

import { countTranscriptWords, PLAYING_INTERRUPT_WORD_FLOOR } from "./interruption-manager.js";

export type SelfEchoReason =
  | "none"
  | "bolna_welcome"
  | "bolna_word_floor";

export function shouldIgnoreSelfEcho(opts: {
  transcript: string;
  agentSpeaking: boolean;
  welcomePlayed: boolean;
  isOverridePhrase: boolean;
  wordFloor?: number;
}): { ignore: boolean; reason: SelfEchoReason } {
  if (!opts.welcomePlayed) {
    return { ignore: true, reason: "bolna_welcome" };
  }
  if (opts.isOverridePhrase) {
    return { ignore: false, reason: "none" };
  }
  if (opts.agentSpeaking) {
    const floor = opts.wordFloor && opts.wordFloor > 0
      ? opts.wordFloor
      : PLAYING_INTERRUPT_WORD_FLOOR;
    const words = countTranscriptWords(opts.transcript);
    if (words <= floor) {
      return { ignore: true, reason: "bolna_word_floor" };
    }
  }
  return { ignore: false, reason: "none" };
}
