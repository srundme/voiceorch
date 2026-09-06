/**
 * Bolna self-echo. They do not match TTS text to STT.
 *
 * `welcome_played=false` mutes every transcript (including stop).
 * The word floor only blocks barge-in — it must not drop a caller answer
 * like "yes" that arrives while TTS is still finishing.
 */

export type SelfEchoReason =
  | "none"
  | "bolna_welcome";

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
  return { ignore: false, reason: "none" };
}
