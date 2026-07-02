/**
 * Domain-compliance + required-section checks for layered System Prompt generation.
 *
 * Complements the Foundation contradiction guardrails
 * (system-prompt-guardrails.ts) with two additional static check families:
 *
 *  1. Required-sections check ("structure"): the generated prompt must contain
 *     each mandatory section heading (Agent Identity & Role, Language &
 *     Communication Style, Conversation Flow, …) with non-trivial content.
 *
 *  2. Domain-compliance check ("domain"): parses the selected domain template's
 *     text for structural elements — numbered conversation-flow steps,
 *     backtick-quoted "Defined Outcomes" entries, a compliance-note section,
 *     mandatory-disclosure steps — and verifies each survived into the
 *     generated prompt. Skipped entirely when no domain is selected.
 *
 * All checks return the same GuardrailCheck shape so the route can merge them
 * into one list that drives the modal's pass/fail UI and gates "Use this
 * prompt". Additionally, a NON-BLOCKING jurisdiction/language mismatch warning
 * is produced when the domain template carries regulator cues (e.g. IRDAI) that
 * conflict with the agent's configured language/market (e.g. English (US)).
 */

import type { GuardrailCheck } from "./system-prompt-guardrails";

// ── Required output sections ─────────────────────────────────────────────────

interface SectionSpec {
  name: string;
  label: string;
  /** Matches a heading line for this section (line-anchored, case-insensitive). */
  heading: RegExp;
  /** Override for the minimum non-trivial content length (e.g. Variables Used is legitimately short). */
  minContentChars?: number;
}

// Heading lines may be decorated (##, **, numbering, trailing colon). We match
// the canonical heading text plus close synonyms anywhere on a short line.
const SECTION_SPECS: SectionSpec[] = [
  {
    name: "section_identity_role",
    label: "Agent Identity & Role section",
    heading: /(agent\s+)?identity\s*(&|and)\s*role|agent\s+identity|identity\s*\/\s*role/i,
  },
  {
    name: "section_language_style",
    label: "Language & Communication Style section",
    heading: /language\s*(&|and)\s*(communication\s+)?style|communication\s+style|language\s+(&|and)\s+tone/i,
  },
  {
    name: "section_conversation_flow",
    label: "Conversation Flow section",
    heading: /conversation\s+flow|call\s+flow/i,
  },
  {
    name: "section_objection_handling",
    label: "Objection Handling section",
    heading: /objection\s+handling|handling\s+objections/i,
  },
  {
    name: "section_escalation",
    label: "Escalation & Transfer Rules section",
    heading: /escalation\s*(&|and|\/)?\s*transfer|transfer\s+rules|escalation\s+rules/i,
  },
  {
    name: "section_compliance",
    label: "Compliance & Disclosures section",
    heading: /compliance\s*(&|and)?\s*disclosures?|compliance\s+(note|guardrails|rules)|disclosures?\s+(&|and)\s+compliance/i,
  },
  {
    name: "section_defined_outcomes",
    label: "Defined Outcomes section",
    heading: /defined\s+outcomes|call\s+outcomes/i,
  },
  {
    name: "section_variables",
    label: "Variables Used section",
    heading: /variables\s+used|variables\b/i,
    minContentChars: 15,
  },
  {
    name: "section_response_guidelines",
    label: "Response Guidelines section",
    heading: /response\s+guidelines|response\s+rules/i,
  },
];

const MIN_SECTION_CONTENT_CHARS = 60;
const MAX_HEADING_LINE_LEN = 90;

interface HeadingHit {
  spec: SectionSpec;
  /** Character offset of the start of the heading line. */
  start: number;
  /** Character offset just past the end of the heading line. */
  end: number;
}

function findSectionHeadings(prompt: string): HeadingHit[] {
  const hits: HeadingHit[] = [];
  const lines = prompt.split("\n");
  let offset = 0;
  for (const line of lines) {
    const lineStart = offset;
    offset += line.length + 1;
    const trimmed = line.trim();
    if (!trimmed || trimmed.length > MAX_HEADING_LINE_LEN) continue;
    for (const spec of SECTION_SPECS) {
      if (spec.heading.test(trimmed)) {
        // First heading hit per section wins.
        if (!hits.some((h) => h.spec.name === spec.name)) {
          hits.push({ spec, start: lineStart, end: lineStart + line.length });
        }
        break;
      }
    }
  }
  return hits.sort((a, b) => a.start - b.start);
}

export interface RequiredSectionsOptions {
  /** When false (Custom / Other with no outcomes requirement), the Defined Outcomes section check is skipped. */
  requireDefinedOutcomes: boolean;
}

/** Statically verify the generated prompt contains each mandatory section with non-trivial content. */
export function checkRequiredSections(
  generatedPrompt: string,
  opts: RequiredSectionsOptions,
): GuardrailCheck[] {
  const text = generatedPrompt ?? "";
  const hits = findSectionHeadings(text);

  const specs = SECTION_SPECS.filter(
    (s) => opts.requireDefinedOutcomes || s.name !== "section_defined_outcomes",
  );

  return specs.map((spec) => {
    const idx = hits.findIndex((h) => h.spec.name === spec.name);
    if (idx === -1) {
      return {
        name: spec.name,
        label: spec.label,
        passed: false,
        detail: `The generated prompt is missing a "${spec.label.replace(/ section$/, "")}" section.`,
        source: "structure" as const,
      };
    }
    const hit = hits[idx]!;
    const next = hits[idx + 1];
    const body = text.slice(hit.end, next ? next.start : undefined);
    const contentLen = body.replace(/\s+/g, " ").trim().length;
    const passed = contentLen >= (spec.minContentChars ?? MIN_SECTION_CONTENT_CHARS);
    return {
      name: spec.name,
      label: spec.label,
      passed,
      detail: passed
        ? "Present with detailed content."
        : "Section heading found but its content is too thin — it must be filled in detail, not a one-liner.",
      source: "structure" as const,
      ...(passed
        ? {}
        : { snippet: `${text.slice(hit.start, hit.end).trim()}\n${body.replace(/\s+/g, " ").trim()}`.slice(0, 240) }),
    };
  });
}

// ── Domain template parsing ──────────────────────────────────────────────────

const NUMBERED_STEP_RE = /^[ \t]{0,6}(?:\*{0,2}|#{0,4}\s*)?(\d{1,2})[.):]\s+(\S.*)$/;
const DISCLOSURE_STEP_RE =
  /disclos|regulat|irdai|sebi|\brbi\b|trai|hipaa|tcpa|gdpr|\bfca\b|kyc|consent|eligib|needs[- ]check|verification|mandatory/i;
const COMPLIANCE_HEADING_RE = /compliance|guardrails?|disclosures?/i;

export interface DomainTemplateElements {
  /** Text of each numbered flow step found in the template. */
  numberedSteps: string[];
  /** Steps (subset of numberedSteps) that carry mandatory/regulatory language. */
  disclosureSteps: string[];
  /** Backtick-quoted Defined Outcomes entries, e.g. "interested". */
  definedOutcomes: string[];
  /** Whether the template has a compliance-note / guardrails section. */
  hasComplianceNote: boolean;
  /** Distinctive compliance keywords/acronyms extracted from that section. */
  complianceKeywords: string[];
}

function extractRegionAfterHeading(text: string, headingRe: RegExp): string | null {
  const lines = text.split("\n");
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]!.trim();
    if (trimmed && trimmed.length <= MAX_HEADING_LINE_LEN && headingRe.test(trimmed)) {
      start = i + 1;
      break;
    }
  }
  if (start === -1) return null;
  // Region ends at the next heading-looking line (markdown heading, ALL-CAPS
  // short line, or **bold** line) or after a generous cap.
  const out: string[] = [];
  for (let i = start; i < lines.length; i++) {
    const trimmed = lines[i]!.trim();
    const isHeading =
      trimmed.length > 0 &&
      trimmed.length <= MAX_HEADING_LINE_LEN &&
      (/^#{1,6}\s+\S/.test(trimmed) ||
        /^\*\*[^*]+\*\*:?$/.test(trimmed) ||
        (/^[A-Z0-9][A-Z0-9 &/\-()]+:?$/.test(trimmed) && trimmed.length >= 8));
    if (isHeading && out.length > 0) break;
    out.push(lines[i]!);
    if (out.join("\n").length > 4000) break;
  }
  return out.join("\n");
}

/** Parse the selected domain template's text for its structural elements. */
export function parseDomainTemplate(domainText: string): DomainTemplateElements {
  const text = domainText ?? "";
  const lines = text.split("\n");

  const numberedSteps: string[] = [];
  for (const line of lines) {
    const m = NUMBERED_STEP_RE.exec(line);
    if (m) numberedSteps.push(m[2]!.trim());
  }
  const disclosureSteps = numberedSteps.filter((s) => DISCLOSURE_STEP_RE.test(s));

  // Defined Outcomes: backtick-quoted entries within the Defined Outcomes region.
  const outcomesRegion = extractRegionAfterHeading(text, /defined\s+outcomes/i);
  const definedOutcomes: string[] = [];
  if (outcomesRegion) {
    for (const m of outcomesRegion.matchAll(/`([^`\n]{2,60})`/g)) {
      const v = m[1]!.trim();
      if (v && !definedOutcomes.includes(v)) definedOutcomes.push(v);
    }
  }

  // Compliance note region + distinctive keywords.
  const complianceRegion = extractRegionAfterHeading(text, COMPLIANCE_HEADING_RE);
  const hasComplianceNote = complianceRegion != null && complianceRegion.trim().length > 0;
  const complianceKeywords: string[] = [];
  if (hasComplianceNote) {
    // Regulator acronyms mentioned in the compliance region MUST survive.
    for (const m of complianceRegion!.matchAll(/\b(IRDAI|SEBI|RBI|TRAI|UIDAI|DPDP|HIPAA|TCPA|GDPR|FCA|FTC|FCC)\b/g)) {
      if (!complianceKeywords.includes(m[1]!)) complianceKeywords.push(m[1]!);
    }
    if (/never\s+guarantee/i.test(complianceRegion!)) complianceKeywords.push("never guarantee");
    if (/fear[- ]based/i.test(complianceRegion!)) complianceKeywords.push("fear-based");
  }

  return { numberedSteps, disclosureSteps, definedOutcomes, hasComplianceNote, complianceKeywords };
}

// ── Per-step keyword signatures ──────────────────────────────────────────────

const STEP_STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "your", "their", "them", "they",
  "from", "into", "about", "have", "has", "will", "would", "should", "must",
  "can", "could", "may", "might", "shall", "was", "were", "been", "being",
  "are", "is", "a", "an", "of", "to", "in", "on", "at", "by", "or", "as",
  "if", "it", "its", "be", "do", "does", "did", "not", "no", "any", "all",
  "each", "per", "call", "caller", "user", "customer", "agent", "step",
  "based", "using", "make", "sure", "ensure", "then", "next", "also", "etc",
  "warm", "mandatory", "pick", "exactly", "one", "chosen",
]);

const REGULATOR_ACRONYM_RE = /\b(IRDAI|SEBI|RBI|TRAI|UIDAI|DPDP|HIPAA|TCPA|GDPR|FCA|FTC|FCC|KYC)\b/g;

/** Reduce a word to a crude stem so "introduction" matches "introduce", "disclosures" matches "disclosure". */
function stem(word: string): string {
  let w = word;
  for (const suffix of ["ations", "ation", "ings", "ing", "ions", "ion", "ies", "es", "ed", "s", "e"]) {
    if (w.length - suffix.length >= 4 && w.endsWith(suffix)) {
      w = w.slice(0, -suffix.length);
      break;
    }
  }
  return w;
}

export interface StepSignature {
  /** Original step text from the template. */
  step: string;
  /** Distinctive stemmed keywords extracted from the step. */
  keywords: string[];
  /** Regulator acronyms in the step — each must appear verbatim in the prompt. */
  anchors: string[];
}

/** Tokenize a template step into a stable keyword signature. */
export function stepSignature(step: string): StepSignature {
  const anchors = [...new Set([...step.matchAll(REGULATOR_ACRONYM_RE)].map((m) => m[1]!))];
  const words = step
    .toLowerCase()
    .replace(/[`*_#()[\]{}"'“”‘’:;,.!?/\\|—–-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !STEP_STOPWORDS.has(w) && !/^\d+$/.test(w));
  const keywords = [...new Set(words.map(stem))].filter((w) => w.length >= 4);
  return { step, keywords, anchors };
}

/**
 * A step "survived" into the prompt when every regulator acronym appears
 * verbatim AND at least half of its keyword stems are present.
 */
function stepSurvived(sig: StepSignature, prompt: string, promptLower: string): boolean {
  if (sig.anchors.length > 0 && !sig.anchors.every((a) => prompt.includes(a))) return false;
  if (sig.keywords.length === 0) return sig.anchors.length > 0;
  const matched = sig.keywords.filter((k) => promptLower.includes(k)).length;
  return matched >= Math.ceil(sig.keywords.length / 2);
}

// ── Domain-compliance checks ─────────────────────────────────────────────────

export interface DomainComplianceInput {
  domainText: string;
  domainName: string;
  generatedPrompt: string;
}

/**
 * Verify the generated prompt carries the domain template's structural
 * elements. Returns [] when the template has no detectable elements.
 */
export function checkDomainCompliance(input: DomainComplianceInput): GuardrailCheck[] {
  const prompt = input.generatedPrompt ?? "";
  const promptLower = prompt.toLowerCase();
  const el = parseDomainTemplate(input.domainText);
  const checks: GuardrailCheck[] = [];

  // 1) Numbered conversation-flow steps carried through — PER-STEP presence.
  //    Each template step is tokenized into a stable keyword signature and must
  //    individually survive into the generated prompt (count parity alone is
  //    NOT enough — a dropped step replaced by an invented one must fail).
  if (el.numberedSteps.length >= 2) {
    const signatures = el.numberedSteps.map(stepSignature);
    const missing = signatures.filter((sig) => !stepSurvived(sig, prompt, promptLower));
    const passed = missing.length === 0;
    checks.push({
      name: "domain_flow_steps",
      label: "Conversation flow steps carried through",
      passed,
      detail: passed
        ? `All ${el.numberedSteps.length} numbered steps from the ${input.domainName} template are individually represented.`
        : `Missing flow step(s) from the ${input.domainName} template: ${missing
            .slice(0, 4)
            .map((s) => `"${s.step.slice(0, 80)}"`)
            .join(", ")}${missing.length > 4 ? ` (+${missing.length - 4} more)` : ""} — each numbered step must be carried into the prompt.`,
      source: "domain",
      ...(passed ? {} : { snippet: missing.map((s) => s.step).join(" | ").slice(0, 240) }),
    });
  }

  // 2) Mandatory-disclosure / regulatory steps present — PER-STEP, stricter:
  //    every regulator acronym in the step must appear verbatim, and the step's
  //    keyword signature must survive.
  if (el.disclosureSteps.length > 0) {
    const missing = el.disclosureSteps
      .map(stepSignature)
      .filter((sig) => !stepSurvived(sig, prompt, promptLower));
    const passed = missing.length === 0;
    checks.push({
      name: "domain_disclosure_step",
      label: "Mandatory disclosures step present",
      passed,
      detail: passed
        ? "All mandatory/regulatory steps from the domain template are represented."
        : `Missing mandatory step(s) from the domain template: ${missing.map((s) => `"${s.step.slice(0, 80)}"`).join(", ")}.`,
      source: "domain",
      ...(passed ? {} : { snippet: missing.map((s) => s.step).join(" | ").slice(0, 240) }),
    });
  }

  // 3) Defined Outcomes list present verbatim.
  if (el.definedOutcomes.length > 0) {
    const missing = el.definedOutcomes.filter((o) => !promptLower.includes(o.toLowerCase()));
    const passed = missing.length === 0;
    checks.push({
      name: "domain_defined_outcomes",
      label: "Defined Outcomes present",
      passed,
      detail: passed
        ? `All ${el.definedOutcomes.length} outcome values from the domain template are present.`
        : `Missing outcome value(s): ${missing.map((o) => `\`${o}\``).join(", ")} — the Defined Outcomes list must be carried verbatim.`,
      source: "domain",
      ...(passed ? {} : { snippet: missing.map((o) => `\`${o}\``).join(", ").slice(0, 240) }),
    });
  }

  // 4) Compliance note carried through.
  if (el.hasComplianceNote) {
    const mentionsCompliance = /compliance|disclosure/i.test(prompt);
    const missingKeywords = el.complianceKeywords.filter(
      (k) => !promptLower.includes(k.toLowerCase()),
    );
    const passed = mentionsCompliance && missingKeywords.length === 0;
    checks.push({
      name: "domain_compliance_note",
      label: "Compliance note carried through",
      passed,
      detail: passed
        ? "The domain template's compliance requirements are represented."
        : !mentionsCompliance
          ? "The generated prompt has no compliance/disclosure content despite the domain template's Compliance Note."
          : `Compliance requirement(s) missing from the prompt: ${missingKeywords.join(", ")}.`,
      source: "domain",
      ...(passed ? {} : { snippet: missingKeywords.join(", ").slice(0, 240) || null }),
    });
  }

  return checks;
}

// ── Jurisdiction / language mismatch warning (non-blocking) ─────────────────

interface JurisdictionSpec {
  region: string;
  cues: RegExp;
  /** Language/market strings that BELONG to this region (no conflict). */
  market: RegExp;
}

const JURISDICTIONS: JurisdictionSpec[] = [
  {
    region: "India",
    cues: /\b(IRDAI|TRAI|SEBI|UIDAI|DPDP)\b|\bRBI\b/,
    market:
      /india|\ben[-_ ]?in\b|hindi|tamil|telugu|marathi|bengali|kannada|malayalam|punjabi|gujarati|urdu|hinglish/i,
  },
  {
    region: "United States",
    cues: /\b(HIPAA|TCPA|FTC|FCC)\b/,
    market: /\ben[-_ ]?us\b|united states|\bu\.?s\.?a?\b|american/i,
  },
  {
    region: "United Kingdom",
    cues: /\bFCA\b|\bOfcom\b/,
    market: /\ben[-_ ]?gb\b|united kingdom|\buk\b|british/i,
  },
  {
    region: "European Union",
    cues: /\bGDPR\b/,
    market: /\beu\b|europe/i,
  },
];

// Market cues in the agent's language string that identify a specific region.
const MARKET_DETECTORS: { region: string; re: RegExp }[] = [
  { region: "United States", re: /\ben[-_ ]?us\b|united states|\bu\.?s\.?a?\b|american/i },
  { region: "United Kingdom", re: /\ben[-_ ]?gb\b|united kingdom|\buk\b|british/i },
  {
    region: "India",
    re: /india|\ben[-_ ]?in\b|hindi|tamil|telugu|marathi|bengali|kannada|malayalam|punjabi|gujarati|urdu|hinglish/i,
  },
  { region: "European Union", re: /europe/i },
];

/**
 * Non-blocking: warn when the domain template mandates region-specific
 * regulatory machinery (e.g. IRDAI) but the agent's configured language/market
 * points at a different region (e.g. English (US)).
 */
export function jurisdictionMismatchWarnings(domainText: string, agentLanguage: string): string[] {
  const warnings: string[] = [];
  const lang = agentLanguage ?? "";
  if (!lang.trim() || !domainText?.trim()) return warnings;

  const detectedMarkets = MARKET_DETECTORS.filter((d) => d.re.test(lang)).map((d) => d.region);
  if (detectedMarkets.length === 0) return warnings;

  for (const j of JURISDICTIONS) {
    if (!j.cues.test(domainText)) continue;
    if (j.market.test(lang)) continue; // language matches this jurisdiction's market
    if (!detectedMarkets.some((m) => m !== j.region)) continue;
    const cue = domainText.match(j.cues)?.[0] ?? j.region;
    warnings.push(
      `The selected use-case template mandates ${j.region} regulatory requirements (${cue}), but the agent's language/market is set to ${detectedMarkets.join(", ")} ("${lang.trim()}"). Double-check the use case and language before applying.`,
    );
  }
  return warnings;
}
