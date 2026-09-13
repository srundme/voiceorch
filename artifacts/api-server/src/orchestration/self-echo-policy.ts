/**
 * Conservative transcript echo heuristic, not acoustic echo cancellation.
 * Greeting state alone is never evidence of echo. Preserve short caller
 * answers and explicit stop/hold requests while output is still playing.
 */

export type SelfEchoReason =
  | "none"
  | "bolna_welcome"
  | "content_match";

export function shouldIgnoreSelfEcho(opts: {
  transcript: string;
  agentSpeaking: boolean;
  welcomePlayed: boolean;
  isOverridePhrase: boolean;
  wordFloor?: number;
  recentAgentText?: string[];
  /** Bounded by the actual last output frame, not estimated sentence length. */
  recentPlaybackTail?: boolean;
}): { ignore: boolean; reason: SelfEchoReason } {
  if (opts.isOverridePhrase || (!opts.agentSpeaking && !opts.recentPlaybackTail)) return { ignore: false, reason: "none" };
  const normalize = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}\p{M}\s]/gu, " ").replace(/\s+/g, " ").trim();
  const text = normalize(opts.transcript);
  // Short answers must survive. Only a substantial exact contiguous phrase
  // from current/recent output qualifies as probable echo, not an AEC verdict.
  if (text.split(" ").length >= 4 && (opts.recentAgentText ?? []).some((spoken) =>
    ` ${normalize(spoken)} `.includes(` ${text} `))) {
    return { ignore: true, reason: "content_match" };
  }
  return { ignore: false, reason: "none" };
}
