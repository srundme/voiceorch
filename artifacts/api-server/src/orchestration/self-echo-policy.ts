/**
 * Conservative transcript echo heuristic, not acoustic echo cancellation.
 * Greeting state alone is never evidence of echo. Preserve short caller
 * answers and explicit stop/hold requests while output is still playing.
 */

export type SelfEchoReason =
  | "none"
  | "bolna_welcome"
  | "content_match";

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}\p{M}\s]/gu, " ").replace(/\s+/g, " ").trim();
}

function isNearMissEcho(text: string, spoken: string): boolean {
  const t = normalize(text);
  const s = normalize(spoken);
  if (!t || !s || t.length < 4) return false;

  const words = t.split(" ").filter(Boolean);
  if (words.length < 2) return false;

  // Short tail phrases like "our time" are valid self-echo matches when the
  // agent recently spoke a longer phrase like "take your time." We still keep
  // genuine short answers such as "yes" and "okay" out of the echo bucket.
  if (words.length <= 2) {
    const tTail = words.slice(-2).join(" ");
    const sWords = s.split(" ").filter(Boolean);
    if (sWords.length >= 2) {
      for (let i = 1; i <= 2; i++) {
        const spokenTail = sWords.slice(-i).join(" ");
        if (spokenTail.length < 4) continue;
        if (spokenTail === tTail || spokenTail.includes(tTail) || tTail.includes(spokenTail)) {
          return true;
        }
      }
    }
  }

  const commonSuffixLen = Math.min(t.length, s.length);
  if (t === s) return true;

  // Accept a suffix/substring match even when the STT output dropped a word or
  // merged/trimmed a consonant cluster, e.g. "take your time" → "our time".
  // This is a heuristic for carrier echo / tail echo, not a validation of full
  // semantic equality. The match is intentionally narrow to avoid muting real
  // responses like "yes", "okay", or any short answer.
  const suffixMatch = s.includes(t) || t.includes(s) || s.endsWith(t) || t.endsWith(s);
  if (suffixMatch) return true;

  // fallback: same final 2-4 words of the phrase, with a single leaky prefix
  // or dropped article from the echoed tail ("your time" / "our time").
  const finalWords = t.split(" ").slice(-4).join(" ");
  const spokenWords = s.split(" ").slice(-4).join(" ");
  if (finalWords.length >= 5 && spokenWords.length >= 5) {
    return finalWords.includes(spokenWords) || spokenWords.includes(finalWords);
  }

  // A near-miss across the final 3 words is enough to flag tail echo when the
  // output is otherwise a short phrase and not a normal caller answer.
  for (let i = 1; i <= Math.min(3, words.length - 1); i++) {
    const tail = words.slice(-i).join(" ");
    if (tail.length >= 4 && (s.includes(tail) || s.endsWith(tail))) {
      return true;
    }
  }

  return false;
}

export function shouldIgnoreSelfEcho(_opts: {
  transcript: string;
  agentSpeaking: boolean;
  welcomePlayed: boolean;
  isOverridePhrase: boolean;
  wordFloor?: number;
  recentAgentText?: string[];
  /** Bounded by the actual last output frame, not estimated sentence length. */
  recentPlaybackTail?: boolean;
}): { ignore: boolean; reason: SelfEchoReason } {
  // Do not drop STT finals as "echo". Provider transcript is the turn.
  return { ignore: false, reason: "none" };
}
