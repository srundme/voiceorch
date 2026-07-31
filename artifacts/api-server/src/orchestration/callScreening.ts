/**
 * Call-screening bot handling for OUTBOUND calls.
 *
 * iPhone (Live Voicemail / Call Screening) and Google Call Screen answer the
 * call with an automated assistant that asks the caller to state who they are
 * and why they're calling, then relays it to the real person, who may then
 * pick up. Carrier AMD misclassifies these as humans (they speak naturally),
 * so the agent would launch into its pitch at a robot.
 *
 * Strategy (three layers, see pipeline wiring):
 *  1. Detect the screener from its near-fixed phrasing in the first ~25s.
 *  2. Answer with ONE short, honest sentence stating business + reason, then
 *     go quiet (screeners reject callers who talk over them).
 *  3. When the real human picks up ("Hello?"), restart the conversation with
 *     a one-shot prompt note so the agent greets from the beginning.
 */

/** Detection window from pipeline start — screeners always speak first. */
export const CALL_SCREENING_WINDOW_MS = 25_000;

/**
 * Near-fixed phrases used by iOS Call Screening / Live Voicemail and Google
 * Call Screen (plus common carrier screening apps). Matched case-insensitively
 * against a final caller-side transcript. Deliberately specific — a human
 * asking "who is this?" must NOT match.
 */
const SCREENING_PATTERNS: RegExp[] = [
  /\bcall(?:\s|-)?screening\b/i,
  /\bscreening (?:service|assistant|tool|feature)\b/i,
  /\bperson you(?:'re| are) (?:calling|trying to reach) (?:is using|isn'?t available)\b/i,
  // NOTE: deliberately NO generic "what is this call about" / "who is this"
  // patterns — real humans say those in the first seconds of outbound calls.
  /\b(?:say|state) (?:your name and )?(?:why|the reason) (?:you'?re|you are) calling\b/i,
  /\bstate your name and reason\b/i,
  /\bplease say why you(?:'re| are) calling\b/i,
  /\bgoogle(?:'s)? (?:call screen|assistant will)\b/i,
  /\bthis call is being screened\b/i,
  /\brecord(?:ing)? this call.{0,40}screen/i,
  /\bwill (?:get|see) a copy of (?:this|the) (?:conversation|transcript)\b/i,
  /\bthey(?:'ll| will) (?:decide|choose) (?:whether|if) to (?:take|answer|accept) (?:the|your) call\b/i,
];

export function detectScreeningPrompt(transcript: string): boolean {
  const text = transcript.trim();
  // Screener prompts are full sentences; scraps and one-word finals never match.
  if (text.length < 15) return false;
  return SCREENING_PATTERNS.some((re) => re.test(text));
}

/**
 * Build the one-sentence reply given to the screening bot. Screeners pass
 * calls through when the stated reason sounds specific and legitimate — so:
 * identify the caller (agent/business), give the reason, then stop talking.
 *
 * Precedence: explicit per-agent `screeningResponse` (raw agent_config) →
 * derived from the static greeting (usually states business + purpose) →
 * generic identification using the agent name.
 */
export function buildScreeningResponse(opts: {
  explicit?: string | null;
  agentName?: string | null;
  greetingMessage?: string | null;
}): string {
  const explicit = opts.explicit?.trim();
  if (explicit) return explicit;

  const greeting = (opts.greetingMessage ?? "").trim();
  // A real greeting usually already says who's calling and why — reuse its
  // first two sentences, stripped of salutation placeholders/fluff.
  if (greeting.length > 25) {
    const cleaned = greeting
      .replace(/\{\{?caller_salutation\}?\}/gi, "")
      .replace(/\s{2,}/g, " ")
      .trim();
    const sentences = cleaned.split(/(?<=[.!?।])\s+/).slice(0, 2).join(" ").trim();
    if (sentences.length > 25) {
      return `${sentences} I'll wait while you pick up.`;
    }
  }

  const who = opts.agentName?.trim() ? `${opts.agentName.trim()}` : "an assistant";
  return (
    `Hi, this is ${who} calling with a quick business call for the owner of this phone. ` +
    `It will only take a minute. I'll wait while they pick up.`
  );
}

/** One-shot prompt note injected when the real human picks up after screening. */
export const SCREENING_PICKUP_NOTE =
  "[CALL SCREENING NOTE] This outbound call was first answered by an automated call-screening " +
  "assistant (e.g. iPhone or Google call screening), NOT the real person. The real person has " +
  "just picked up NOW. Start the conversation over from the beginning: greet them and deliver " +
  "your normal opening as if the call just connected. Do not reference the screening exchange, " +
  "and do not assume anything said so far was heard by them.";
