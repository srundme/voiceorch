/**
 * Post-generation guardrail check for layered System Prompt generation.
 *
 * The Foundation layer defines a set of LOCKED, universal rules. After the LLM
 * assembles the final prompt, we statically scan it for phrasing that would
 * CONTRADICT those Foundation-locked rules (e.g. the domain/inputs sneaking in a
 * "pretend to be human" instruction). Each named check passes unless a
 * contradiction pattern is found. This never blocks generation — it drives the
 * modal's named pass/fail list and gates the "Use this prompt" button.
 */

export type GuardrailCheckSource = "foundation" | "structure" | "domain";

export interface GuardrailCheck {
  name: string;
  label: string;
  passed: boolean;
  detail: string;
  /** Which layer of verification produced this check. */
  source: GuardrailCheckSource;
  /** The exact generated-prompt text that tripped this check (failed checks only). */
  snippet?: string | null;
}

export interface GuardrailResult {
  passed: boolean;
  checks: GuardrailCheck[];
}

interface GuardrailRule {
  name: string;
  label: string;
  /** If ANY pattern matches the generated prompt, the rule is CONTRADICTED (fails). */
  contradictions: RegExp[];
  passDetail: string;
  failDetail: string;
  /**
   * When true, a contradiction match is DISCARDED if the sentence containing it
   * is moderation phrasing about frequency/overuse (e.g. "don't overuse Sir/Ma'am",
   * "avoid repeating sir in every sentence") rather than a genuine disable.
   */
  moderationExemptible?: boolean;
}

/**
 * Frequency/overuse moderation cues. A sentence that tells the agent to tone
 * something DOWN (not turn it OFF) legitimately co-occurs with "avoid"/"don't"
 * verbs — e.g. "avoid repeating sir in every sentence" — and must not be
 * treated as a Foundation contradiction.
 */
const MODERATION_CUE_RE =
  /\b(?:overus\w*|over-?rel\w*|too\s+(?:often|much|frequently|many)|repeat\w*|repetiti\w*|every\s+(?:sentence|line|turn|response|reply|phrase|utterance)|each\s+(?:sentence|line|turn|response|reply)|excessiv\w*|constantly|sparingly|occasionally|frequency|multiple\s+times)\b/i;

/** Extract the sentence (bounded by newline or period) containing a match offset. */
function sentenceAround(text: string, index: number, matchLen: number): string {
  const boundary = /[.\n]/;
  let start = index;
  while (start > 0 && !boundary.test(text[start - 1]!)) start--;
  let end = index + matchLen;
  while (end < text.length && !boundary.test(text[end]!)) end++;
  return text.slice(start, end).trim();
}

const RULES: GuardrailRule[] = [
  {
    name: "identity_lock",
    label: "Identity lock",
    contradictions: [
      /\byou\s+are\s+(?:a\s+)?(?:real\s+)?human\b/i,
      /\bpretend(?:ing)?\s+to\s+be\s+(?:a\s+)?(?:real\s+)?(?:human|person)\b/i,
      /\bclaim\s+to\s+be\s+(?:a\s+)?(?:real\s+)?(?:human|person)\b/i,
      /\bact\s+as\s+(?:if\s+you\s+are|though\s+you\s+are)\s+(?:a\s+)?human\b/i,
    ],
    passDetail: "No instruction to impersonate a human.",
    failDetail: "Prompt tells the agent to present itself as a human — contradicts the Foundation identity rule.",
  },
  {
    name: "ai_honesty",
    label: "AI honesty",
    contradictions: [
      /\b(?:never|do\s*n['o]t|don't|avoid)\b[^.\n]{0,40}\b(?:admit|reveal|disclose|say|mention|tell)\b[^.\n]{0,40}\b(?:ai|a\.i\.|bot|robot|automated|machine|virtual\s+assistant)\b/i,
      /\bdeny\b[^.\n]{0,30}\b(?:being|that\s+you(?:'re| are))\b[^.\n]{0,20}\b(?:ai|a\.i\.|bot|robot|automated)\b/i,
      /\b(?:lie|deceive|mislead)\b[^.\n]{0,30}\b(?:caller|customer|user|them)\b/i,
    ],
    passDetail: "No instruction to hide or deny being an AI.",
    failDetail: "Prompt instructs the agent to hide/deny its AI nature — contradicts Foundation AI-honesty rule.",
  },
  {
    name: "salutation_protocol",
    label: "Salutation protocol",
    contradictions: [
      /\b(?:never|do\s*n['o]t|don't|avoid|skip|ignore)\b[^.\n]{0,25}\b(?:salutation|sir\b|ma['’]?am|honorific)\b/i,
    ],
    passDetail: "Salutation handling not overridden.",
    failDetail: "Prompt disables the salutation protocol — contradicts the Foundation salutation rule.",
    moderationExemptible: true,
  },
  {
    name: "spoken_form",
    label: "Spoken-form rules",
    contradictions: [
      /\b(?:read|say|speak|pronounce)\b[^.\n]{0,30}\b(?:numbers|digits|dates|currency|amounts)\b[^.\n]{0,25}\b(?:as\s+(?:digits|numerals|symbols)|in\s+numerals)\b/i,
      /\buse\s+(?:symbols|numerals|digits)\s+instead\s+of\s+words\b/i,
    ],
    passDetail: "Numbers/dates left to be spoken naturally.",
    failDetail: "Prompt tells the agent to speak numbers/dates as raw digits/symbols — contradicts Foundation spoken-form rule.",
  },
  {
    name: "silent_tool_call",
    label: "Silent tool calls",
    contradictions: [
      /\b(?:say|read\s*out|announce|tell\s+the\s+caller|mention|speak)\b[^.\n]{0,40}\b(?:tool|function|api)\b[^.\n]{0,15}\b(?:name|call|json)\b/i,
      /\bread\s+(?:out\s+)?the\s+(?:json|function\s+call|tool\s+call)\b/i,
    ],
    passDetail: "Tool calls kept silent.",
    failDetail: "Prompt tells the agent to speak tool/function-call details — contradicts Foundation silent-tool-call rule.",
  },
  {
    name: "off_script",
    label: "Stay-on-script",
    contradictions: [
      /\b(?:go\s+off[-\s]?script|improvise\s+freely|ignore\s+(?:the\s+)?(?:script|prompt|instructions|rules)|make\s+(?:things|stuff)\s+up)\b/i,
    ],
    passDetail: "No instruction to go off-script or fabricate.",
    failDetail: "Prompt encourages going off-script/fabricating — contradicts Foundation stay-on-script rule.",
  },
  {
    name: "closing_protocol",
    label: "Closing protocol",
    contradictions: [
      /\bhang\s*up\b[^.\n]{0,25}\b(?:immediately|abruptly|without\s+(?:a\s+)?(?:closing|goodbye|thank))\b/i,
      /\bend\s+the\s+call\b[^.\n]{0,25}\bwithout\s+(?:a\s+)?(?:closing|goodbye|farewell)\b/i,
    ],
    passDetail: "Call closing not shortened.",
    failDetail: "Prompt tells the agent to end abruptly with no closing — contradicts Foundation closing rule.",
  },
  {
    name: "opt_out",
    label: "Opt-out handling",
    contradictions: [
      /\b(?:ignore|refuse|deny|do\s*n['o]t|don't|never)\b[^.\n]{0,30}\b(?:opt[-\s]?out|do\s+not\s+call|unsubscribe|remove\s+me|stop\s+calling)\b/i,
    ],
    passDetail: "Opt-out requests honoured.",
    failDetail: "Prompt tells the agent to ignore opt-out/do-not-call requests — contradicts Foundation opt-out rule.",
  },
];

/**
 * Find the first genuine contradiction of a rule in the text. Returns the
 * offending sentence, or null when the rule is not contradicted. For
 * moderation-exemptible rules, matches whose containing sentence is frequency/
 * overuse moderation phrasing are skipped.
 */
function findContradiction(rule: GuardrailRule, text: string): string | null {
  for (const re of rule.contradictions) {
    // Scan all occurrences so a moderation-phrased first hit doesn't mask a
    // genuine disable later in the prompt.
    const global = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    for (const m of text.matchAll(global)) {
      const sentence = sentenceAround(text, m.index ?? 0, m[0]!.length);
      if (rule.moderationExemptible && MODERATION_CUE_RE.test(sentence)) continue;
      return sentence || m[0]!;
    }
  }
  return null;
}

/** Scan a generated system prompt against the Foundation-locked rule set. */
export function checkFoundationGuardrails(generatedPrompt: string): GuardrailResult {
  const text = generatedPrompt ?? "";
  const checks: GuardrailCheck[] = RULES.map((rule) => {
    const offending = findContradiction(rule, text);
    const contradicted = offending != null;
    return {
      name: rule.name,
      label: rule.label,
      passed: !contradicted,
      detail: contradicted ? rule.failDetail : rule.passDetail,
      source: "foundation" as const,
      ...(contradicted ? { snippet: offending.slice(0, 240) } : {}),
    };
  });
  return { passed: checks.every((c) => c.passed), checks };
}
