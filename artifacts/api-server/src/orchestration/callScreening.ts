import { looksLikeVoicemailGreeting } from "../lib/voicemail-detect.js";

/**
 * Call-screening bot handling for OUTBOUND calls.
 *
 * iPhone ("Ask Reason for Calling" / Live Voicemail) and Google Call Screen
 * answer the call with an automated assistant. Carrier AMD classifies them as
 * humans (they speak naturally), so the agent would pitch a robot.
 *
 * Product policy: hang up immediately and record the call as voicemail —
 * do not converse with the screener.
 */

/** Detection window from pipeline start — screeners always speak first. */
export const CALL_SCREENING_WINDOW_MS = 25_000;

/**
 * Near-fixed phrases used by iOS Call Screening / Live Voicemail and Google
 * Call Screen (plus common carrier screening apps). Matched case-insensitively
 * against a caller-side transcript. Deliberately specific — a human asking
 * "who is this?" must NOT match.
 */
const SCREENING_PATTERNS: RegExp[] = [
  /\bcall(?:\s|-)?screening\b/i,
  /\bscreening (?:service|assistant|tool|feature)\b/i,
  /\bperson you(?:'re| are) (?:calling|trying to reach) (?:is using|isn'?t available)\b/i,
  // iPhone Ask Reason for Calling (call 15619) — instruct the *caller* to
  // identify themselves. Do not match a human asking "why are you calling?".
  /\b(?:please )?(?:say|state|record|leave)\s+(?:your\s+)?name\b.{0,50}\b(?:reason|why)\b.{0,40}\bcall/i,
  /\b(?:say|state) (?:your name and )?(?:why|the reason) (?:you'?re|you are) calling\b/i,
  /\bstate your name and reason\b/i,
  /\byour name and (?:the )?reason for calling\b/i,
  /\breason for calling\b/i,
  /\bplease say why you(?:'re| are) calling\b/i,
  /\bask(?:ed|ing)? (?:the )?reason for calling\b/i,
  /\bthis is (?:iphone |apple )?call screening\b/i,
  /\bbefore (?:this |the |your )?(?:iphone|phone) rings\b/i,
  /\bgoogle(?:'s)? (?:call screen|assistant will)\b/i,
  /\bthis call is being screened\b/i,
  /\brecord(?:ing)? this call.{0,40}screen/i,
  /\bwill (?:get|see) a copy of (?:this|the) (?:conversation|transcript)\b/i,
  /\bthey(?:'ll| will) (?:decide|choose) (?:whether|if) to (?:take|answer|accept) (?:the|your) call\b/i,
  // iPhone Live Voicemail / Ask Reason (call 16959) — STT often catches
  // "stay on the line" without "call screening". Lone "Thanks" is not a hangup.
  /\bif you record your name\b/i,
  /\bsee if this person is available\b/i,
  /\bplease stay on the line\b/i,
  /\bstay on the line\b/i,
  /\bthis person is not available\b/i,
  /\b(?:this|that) person (?:isn'?t|is not) available\b/i,
  /\bleave an additional message\b/i,
  /\breply after the tone\b/i,
  /\bafter the (?:beep|tone)\b/i,
];

export function detectScreeningPrompt(transcript: string): boolean {
  const text = transcript.trim();
  // Screener prompts are full sentences; scraps and one-word finals never match.
  if (text.length < 12) return false;
  if (SCREENING_PATTERNS.some((re) => re.test(text))) return true;
  // Same hangup path for classic carrier voicemail greetings (leave a message / after the beep).
  return looksLikeVoicemailGreeting(text);
}

/**
 * @deprecated Kept for agent-config `screeningResponse` tooling; Live/classic
 * no longer speak this — they hang up as voicemail.
 */
export function buildScreeningResponse(opts: {
  explicit?: string | null;
  agentName?: string | null;
  greetingMessage?: string | null;
}): string {
  const explicit = opts.explicit?.trim();
  if (explicit) return explicit;

  const greeting = (opts.greetingMessage ?? "").trim();
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

/** @deprecated Pickup restart is unused — screening now hangs up as voicemail. */
export const SCREENING_PICKUP_NOTE =
  "[CALL SCREENING NOTE] This outbound call was first answered by an automated call-screening " +
  "assistant (e.g. iPhone or Google call screening), NOT the real person. The real person has " +
  "just picked up NOW. Start the conversation over from the beginning: greet them and deliver " +
  "your normal opening as if the call just connected. Do not reference the screening exchange, " +
  "and do not assume anything said so far was heard by them.";
