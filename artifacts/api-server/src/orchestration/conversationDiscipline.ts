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
- KEEP IT SHORT: Prefer ONE short spoken sentence; never more than two. If the second sentence is not a single clarifying question, stop after the first.
- WAIT FOR RESPONSE: Whenever the flow says "wait", "wait for response", "strictly wait", "pause", or anything similar — and after every question you ask — treat it as a HARD STOP. Finish your single point, then immediately yield the turn and stay silent. Do NOT continue to the next step until the caller has actually responded.
- FOLLOW THE ORDER: Move through the flow in the exact order it is written. Never skip ahead, never jump to the closing, never end the call early. Progress naturally from the opening through each step to the closure, one turn per step.
- ANSWER QUESTIONS FIRST: If the caller asks a question, you MUST answer it directly and completely FIRST — use the knowledge/context provided to give a real answer. Never brush a question off, never reply with only a filler like "okay" and move on, never continue the script as if the question was not asked. Only AFTER answering, resume from the exact point in the flow where you left off. Never restart the flow from the beginning, and never skip the steps you had not yet reached.
- RESPECT HOLD REQUESTS: If the caller asks you to wait — "wait", "one minute", "hold on", "just a second", or any equivalent in their language — acknowledge briefly (e.g. "Sure, take your time") and STOP. Stay on the current step. Do NOT advance the flow, do NOT continue the pitch, do NOT repeat your last line. Wait for them to speak again.
- NEVER REPEAT: Do not repeat a step, point, or benefit you have already delivered earlier in this conversation. Keep track of what you have already covered and only move forward. If the caller already answered (even briefly: "B2B", "start कर रहे हैं", "CRM integrations"), treat it as answered — do not re-ask the same qualification more than once.
- COMPOUND TERMS: Treat "CRM integration(s)" as ONE requirement, not CRM plus a separate integration product. Confirm the combined term, then ask the next unanswered question.
- EITHER/OR YES: If you asked B2B or B2C (or any two-option question) and the caller only says "हां"/"yes", re-ask ONLY those two options in one short sentence. Do not add a third choice.
- AFTER INTERRUPTION: If your speech was cut off, resume from the unfinished sentence — never restart the opening, consent, or pitch from the top, and never ask whether the caller can hear you unless they said absolutely nothing.
- NO FALSE "CUT OFF": After you have already opened this call, NEVER say that you got cut off, that the previous call dropped, or that you lost the connection — unless the caller themselves says the line dropped just now. If the caller asks you to explain or clarify something (even with a mangled product name), answer that question directly; do not restart the pitch with an apology about a cut-off.
- CLARIFY ≠ RESTART: Phrases like "what was that about", "about the …", "explain again", "tell me more" mean explain the last topic you covered — answer in 1–2 short sentences, then ask if that helps. Do not replay the full scripted intro.
- CALLBACK TIME: If the caller said "tomorrow", "today", or a clock time, confirm with THAT wording ("okay, I'll call you tomorrow"). Never read a calendar date, month, or year unless they asked which date.
- NO FILLER OPENER: Do not start a spoken turn with சரி, seri, sari, okay, or ok. Go straight to the point. Those words are already covered by a listening sound if needed.`;

/**
 * Compact per-turn reminder — appended to the last user turn (highest LLM
 * attention, just before generation) so it survives long prompts and the
 * staged-prompt override (which replaces the system prompt but not history).
 */
export const CONVERSATION_DISCIPLINE_TURN_REMINDER =
  `[Flow reminder: deliver only ONE step now — prefer ONE short sentence (never more than two), at most ONE question — then STOP and wait for the caller's response. Do not combine steps, do not ask a second question, do not keep talking. If the caller just asked a question or asked to clarify something you said, ANSWER it directly first (use the knowledge provided) before continuing the flow — never say "we got cut off" mid-call and never restart the pitch. If they asked you to wait, acknowledge briefly and wait — do not advance. Otherwise continue from where you left off — do not repeat points already covered, do not restart, do not skip ahead.]`;

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

/** Default cap on spoken sentences per agent turn (voice latency). */
export const VOICE_MAX_SENTENCES_PER_TURN = 2;

/** Terminal punctuation for a speakable sentence unit (Latin + Indic danda). */
const SPEAKABLE_TERMINAL_RE = /[.!?।]\s*$/;

/**
 * Streaming micro-clauses (early TTS dispatch before .!?) must not consume the
 * per-turn sentence budget — otherwise two word chunks block the final flush and
 * the caller hears a prefix then silence (call 2541).
 */
export function isSpeakableSentenceUnit(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return SPEAKABLE_TERMINAL_RE.test(t) || t.length >= 48;
}

export interface FlowStepGuardOptions {
  /** Max sentences to speak before suppressing the rest of the turn. */
  maxSentences?: number;
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
export function makeFlowStepGuard(opts?: FlowStepGuardOptions): { push: (sentence: string) => string; truncated: () => boolean } {
  const maxSentences = opts?.maxSentences ?? VOICE_MAX_SENTENCES_PER_TURN;
  let questionCount = 0;
  let sentenceCount = 0;
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
      // Early phrase dispatch emits clause fragments without .!? — let them stream
      // to TTS but only count completed sentences toward the monologue cap.
      if (isSpeakableSentenceUnit(sentence)) {
        sentenceCount++;
        if (sentenceCount > maxSentences) {
          suppressed = true;
          return "";
        }
      }
      return sentence;
    },
    truncated: () => suppressed,
  };
}

// ── Caller-utterance intent gating (call 1915) ───────────────────────────────
// The per-turn anti-repeat nudge used to tell the model "the caller responded —
// advance to the next point" for EVERY short utterance, which made the agent
// steamroll hold-requests ("wait, I'm installing the app") and ignore direct
// questions. These helpers classify the last caller utterance so the nudge can
// be scoped to genuine bare acknowledgements only.

// Hold / "give me a moment" requests — English + Tamil/Hindi (script + romanized).
const HOLD_REQUEST_LATIN = new RegExp(
  "\\b(" +
    [
      "wait", "waiting", "hold on", "hang on", "hold please", "hold the line",
      "one minute", "a minute", "one moment", "a moment", "just a moment",
      "one sec(?:ond)?", "a second", "just a sec(?:ond)?",
      "give me (?:a|one|two|some)", "gimme (?:a|one)", "bear with me",
      "ek minute", "ek min(?:ute|at)?", "do minute", "ruko", "rukiye", "rukna", "thahro", "thahariye",
      "oru nimisham", "oru nimidam", "oru second", "konjam iru(?:nga)?", "irunga", "porunga",
      "wait pannunga", "wait pannu", "hold karo", "hold kariye",
    ].join("|") +
  ")\\b",
  "i",
);
const HOLD_REQUEST_INDIC = [
  // Tamil
  "ஒரு நிமிஷம்", "ஒரு நிமிடம்", "ஒரு செகண்ட்", "இருங்க", "பொறுங்க", "கொஞ்சம் இரு", "வெயிட்",
  // Hindi
  "एक मिनट", "दो मिनट", "एक सेकंड", "रुक", "ठहर", "होल्ड",
];

/** True when the utterance asks the agent to wait / hold on (any supported language). */
export function isHoldRequest(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (HOLD_REQUEST_LATIN.test(t)) return true;
  return HOLD_REQUEST_INDIC.some((kw) => t.includes(kw));
}

// Interrogative markers — English + Tamil/Hindi (script + romanized).
const QUESTION_LATIN = new RegExp(
  "\\b(" +
    [
      "what", "why", "how", "when", "where", "which", "who", "whom", "whose",
      "can (?:i|you|we)", "could (?:i|you|we)", "should i", "shall i", "do i", "does it",
      "is (?:it|there|this)", "are (?:there|you)", "tell me",
      "kya", "kaise", "kab", "kahan", "kaha", "kyu", "kyun", "kaun", "kitna", "kitne", "kitni",
      "enna", "eppadi", "epdi", "eppo", "eppodhu", "enga", "engey", "yaen", "yen", "yaar", "edhu", "evlo", "evvalavu",
    ].join("|") +
  ")\\b",
  "i",
);
const QUESTION_INDIC = [
  // Tamil
  "என்ன", "எப்படி", "எப்போ", "எப்போது", "எங்க", "எங்கே", "ஏன்", "எது", "யார்", "எவ்வளவு",
  // Hindi
  "क्या", "कैसे", "कब", "कहाँ", "कहां", "क्यों", "कौन", "कितना", "कितने", "कितनी",
];

/** True when the utterance is (or contains) a direct question to be answered. */
export function isQuestionUtterance(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/[?？]/.test(t)) return true;
  if (QUESTION_LATIN.test(t)) return true;
  return QUESTION_INDIC.some((kw) => t.includes(kw));
}

// Bare acknowledgement vocabulary — every word of a short utterance must match.
const ACK_WORDS = new Set([
  // English
  "ok", "okay", "k", "kk", "hmm", "hm", "mm", "mhm", "mmhm", "uh", "huh", "uhhuh",
  "yes", "yeah", "yep", "yup", "ya", "sure", "right", "fine", "alright", "correct",
  "got", "it", "good", "great", "done", "understood", "noted", "perfect",
  // Hindi (roman + script)
  "haan", "han", "ha", "ji", "achha", "accha", "acha", "theek", "thik", "hai", "sahi",
  "हाँ", "हां", "जी", "ठीक", "है", "अच्छा", "सही", "ओके",
  // Tamil (roman + script)
  "seri", "sari", "aama", "aamam", "amam", "okva", "sariya",
  "சரி", "ஆமா", "ஆமாம்", "ஓகே", "ம்", "ம்ம்",
]);

/**
 * True only for a genuine short acknowledgement ("okay", "hmm", "haan ji",
 * "சரி") — the ONLY caller intent that should trigger the "advance to the next
 * point" nudge. Hold-requests and questions are explicitly excluded.
 */
export function isBareAcknowledgement(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (isHoldRequest(t) || isQuestionUtterance(t)) return false;
  const words = t
    .toLowerCase()
    .replace(/[.,!।|?？"'\u2018\u2019\u201c\u201d()\-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0 || words.length > 4) return false;
  return words.every((w) => ACK_WORDS.has(w));
}

/**
 * Build the per-turn anti-repeat directive appended to the last user turn,
 * scoped to the caller's actual intent:
 *  - hold-request → confirm you're waiting, do NOT advance;
 *  - question     → answer it first, then resume;
 *  - bare ack     → the original "advance to the next point" nudge;
 *  - anything else → neutral do-not-repeat (respond to what was said).
 * `escalated` = a verbatim repeat was already detected this call.
 */
export function buildAntiRepeatNudge(_opts: {
  lastUserText: string;
  prevLine: string;
  escalated: boolean;
  alreadyAsked?: string[];
}): string {
  return "";
}

/** Recent agent questions so the model cannot replay qualification (call 20113). */
export function extractRecentAgentQuestions(
  messages: ReadonlyArray<{ role: string; content: string }>,
  limit = 6,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (let i = messages.length - 1; i >= 0 && out.length < limit; i--) {
    const msg = messages[i];
    if (msg?.role !== "assistant") continue;
    const sentences = splitSpokenSentences(msg.content);
    for (const s of sentences) {
      if (!/[?？]/.test(s)) continue;
      const compact = s.replace(/\s+/g, " ").trim().slice(0, 140);
      const key = compact.toLowerCase();
      if (seen.has(key) || compact.length < 8) continue;
      seen.add(key);
      out.push(compact);
      if (out.length >= limit) break;
    }
  }
  return out.reverse();
}

/** Lightweight sentence splitter for the output guard (TTS-oriented, not exact). */
function splitSpokenSentences(text: string): string[] {
  const parts = text.match(/[^.!?？]*[.!?？]+["'\u201d\u2019)\]]?\s*|[^.!?？]+$/g);
  if (!parts) return text.trim() ? [text.trim()] : [];
  return parts.map((p) => p.trim()).filter(Boolean);
}
