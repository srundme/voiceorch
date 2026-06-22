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
  `[CONVERSATION DISCIPLINE — MANDATORY] You are executing a defined call flow. Obey these rules at all times, they override any tendency to be thorough or efficient:
- ONE STEP AT A TIME: Deliver exactly ONE step, point, question, or benefit per turn. Never combine multiple steps, never list several points, never dump information. Say one thing, then stop.
- WAIT FOR RESPONSE: Whenever the flow says "wait", "wait for response", "strictly wait", "pause", or anything similar, treat it as a HARD STOP. Finish your single point, then immediately yield the turn and stay silent. Do NOT continue to the next step until the caller has actually responded.
- FOLLOW THE ORDER: Move through the flow in the exact order it is written. Never skip ahead, never jump to the closing, never end the call early. Progress naturally from the opening through each step to the closure.
- RESUME AFTER OBJECTIONS: If the caller asks a question, raises an objection, or goes off-topic, answer it briefly and then RESUME from the exact point in the flow where you left off. Never restart the flow from the beginning, and never skip the steps you had not yet reached.
- NEVER REPEAT: Do not repeat a step, point, or benefit you have already delivered earlier in this conversation. Keep track of what you have already covered and only move forward.`;

/**
 * Compact per-turn reminder — appended to the last user turn (highest LLM
 * attention, just before generation) so it survives long prompts and the
 * staged-prompt override (which replaces the system prompt but not history).
 */
export const CONVERSATION_DISCIPLINE_TURN_REMINDER =
  `[Flow reminder: deliver only ONE step now, then stop and wait for the caller's response. Continue from where you left off in the flow — do not repeat points already covered, do not restart, do not skip ahead.]`;
