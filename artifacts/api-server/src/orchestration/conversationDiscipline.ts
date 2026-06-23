/**
 * Conversation-discipline steering for live calls.
 *
 * The configured agent prompt / call flow describes WHAT to say and in what
 * order, but LLMs left to their own devices tend to: dump several steps in one
 * turn, ignore "wait for response" markers, restart the flow after handling an
 * objection, or skip ahead to closing. This module supplies an explicit,
 * mandatory behavioural block (in the same style as the [TTS OUTPUT RULES] and
 * [STRICT LANGUAGE RULE] blocks) plus a compact per-turn reminder that forces
 * one-step-at-a-time delivery, turn yielding, and place-keeping.
 *
 * Used by session.ts (base prompt assembly), pipeline.ts (telephony per-turn)
 * and telephony/webcall.ts (web-call per-turn). Keep all three in sync by
 * importing from here rather than re-inlining the text.
 */

/**
 * Full discipline block — appended to the base system prompt so every call
 * carries it, and re-asserted when a staged-prompt block replaces the system
 * prompt for a turn.
 */
export const CONVERSATION_DISCIPLINE_BLOCK =
  `[CONVERSATION DISCIPLINE — MANDATORY] You are on a live phone call executing a defined call flow. This is a two-way conversation, NOT a monologue. Obey these rules at all times — they override any tendency to be thorough, helpful, or efficient:
- ONE STEP AT A TIME: Deliver exactly ONE step, point, question, or benefit per turn, then STOP. Never combine multiple steps. Never list several points. Never read out more than one step of the flow in a single turn. Never dump the script. Say one thing, then stop talking.
- ASK ONLY ONE QUESTION: Each turn may contain at most ONE question. After you ask it, STOP immediately and wait — do not ask a second question, do not add another step, do not keep talking.
- KEEP IT SHORT: A turn is one or two short spoken sentences. If you find yourself about to say a third sentence that starts a new point or asks something new, do not — stop instead and let the caller speak.
- WAIT FOR RESPONSE: Whenever the flow says "wait", "wait for response", "strictly wait", "pause", or anything similar — and after every question you ask — treat it as a HARD STOP. Finish your single point, then immediately yield the turn and stay silent. Do NOT continue to the next step until the caller has actually responded.
- FOLLOW THE ORDER: Move through the flow in the exact order it is written. Never skip ahead, never jump to the closing, never end the call early. Progress naturally from the opening through each step to the closure, one turn per step.
- RESUME AFTER OBJECTIONS: If the caller asks a question, raises an objection, or goes off-topic, answer it briefly and then RESUME from the exact point in the flow where you left off. Never restart the flow from the beginning, and never skip the steps you had not yet reached.
- NEVER REPEAT: Do not repeat a step, point, or benefit you have already delivered earlier in this conversation. Keep track of what you have already covered and only move forward.`;

/**
 * Compact per-turn reminder — appended to the last user turn (highest LLM
 * attention, just before generation) so it survives long prompts and the
 * staged-prompt override (which replaces the system prompt but not history).
 */
export const CONVERSATION_DISCIPLINE_TURN_REMINDER =
  `[Flow reminder: deliver only ONE step now — one or two short sentences, at most ONE question — then STOP and wait for the caller's response. Do not combine steps, do not ask a second question, do not keep talking. Continue from where you left off in the flow — do not repeat points already covered, do not restart, do not skip ahead.]`;

/**
 * Detect whether a spoken sentence ENDS on a question (the natural turn-yield
 * point in a call flow). Tolerates a trailing closing quote/bracket after the
 * question mark and the full-width "？".
 */
function endsWithQuestion(sentence: string): boolean {
  return /[?？]["'\u201d\u2019)\]]?\s*$/.test(sentence.trim());
}

/**
 * Whole-string output guard. Truncates a turn after the FIRST question when the
 * reply contains TWO OR MORE questions — the unambiguous "ran through multiple
 * flow steps / asked several things at once" anti-pattern that prompting alone
 * does not reliably prevent. A single question (optionally followed by trailing
 * statements) is left untouched, so normal one-step turns are never harmed.
 *
 * Returns the (possibly shortened) text and whether truncation occurred so the
 * caller can keep the stored conversation history in sync with what was spoken,
 * letting the agent resume cleanly from the dropped step on the next turn.
 */
export function truncateToSingleStep(text: string): { text: string; truncated: boolean } {
  const sentences = splitSpokenSentences(text);
  let questionCount = 0;
  const kept: string[] = [];
  for (const s of sentences) {
    if (endsWithQuestion(s)) {
      questionCount++;
      if (questionCount >= 2) {
        return { text: kept.join(" ").trim(), truncated: true };
      }
    }
    kept.push(s);
  }
  return { text: text.trim(), truncated: false };
}

/**
 * Stateful streaming counterpart of {@link truncateToSingleStep}, applied to the
 * sentences a turn enqueues for TTS in real time. Feed each spoken sentence to
 * `push()`; it returns the sentence to speak, or "" once a second question has
 * been reached (that sentence and everything after it are suppressed). Mirrors
 * the whole-string rule so streamed audio and stored history agree. Create one
 * per turn; only route real LLM-response sentences through it (never fillers or
 * tool-acknowledgement phrases).
 */
export function makeFlowStepGuard(): { push: (sentence: string) => string; truncated: () => boolean } {
  let questionCount = 0;
  let suppressed = false;
  return {
    push(sentence: string): string {
      if (suppressed) return "";
      if (endsWithQuestion(sentence)) {
        questionCount++;
        if (questionCount >= 2) {
          suppressed = true;
          return "";
        }
      }
      return sentence;
    },
    truncated: () => suppressed,
  };
}

/** Lightweight sentence splitter for the output guard (TTS-oriented, not exact). */
function splitSpokenSentences(text: string): string[] {
  const parts = text.match(/[^.!?？]*[.!?？]+["'\u201d\u2019)\]]?\s*|[^.!?？]+$/g);
  if (!parts) return text.trim() ? [text.trim()] : [];
  return parts.map((p) => p.trim()).filter(Boolean);
}
