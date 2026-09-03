/**
 * Clause-level LLM → TTS dispatch.
 *
 * Start synthesis on the first usable clause. Do not wait for a grammatical
 * sentence, and do not treat tiny lead fragments ("Sorry,") as a complete reply.
 */

/** Clock / slot tokens — never early-split a comma between these (call 14390). */
const TIME_SLOT_TOKEN = /\b\d{1,2}(?::\d{2})?\s*(?:AM|PM|am|pm)\b/;

const TINY_LEAD =
  /^(sorry|hello|hi|hey|okay|ok|right|thanks|thank you|sure|um+|uh+|ah+|oh+|hmm+|mm+|yeah|yes|no|சரி|சரிங்க|ஓகே|ஓகேங்க|ओके|ठीक|अच्छा|हम्म|ம்ம்|ஆஹா|அப்படியா)$/i;

export function isTinyLeadFragment(text: string): boolean {
  const t = text.trim().replace(/[.!?…,]+$/g, "").trim();
  if (!t) return true;
  return TINY_LEAD.test(t);
}

export function isUsableSpeakableClause(text: string): boolean {
  const t = text.trim();
  if (!t || isTinyLeadFragment(t)) return false;
  if (t.length < 12) return false;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length < 3 && t.length < 20) return false;
  return true;
}

function isTimeListComma(clause: string, rest: string): boolean {
  const head = clause.slice(-48);
  const tail = rest.slice(0, 48);
  if (TIME_SLOT_TOKEN.test(head) && TIME_SLOT_TOKEN.test(tail)) return true;
  if (/\b(?:AM|PM)\s*$/i.test(clause.trim()) && /^\s*\d{1,2}\s*(?::\d{2})?\s*(?:AM|PM)?/i.test(rest)) {
    return true;
  }
  return false;
}

/**
 * First audible greeting clause. Coalesce "Sorry," until a usable clause exists.
 * A 4-word resume fragment may start TTS before the period arrives.
 */
export function pickStreamedGreetingHead(pending: string): string {
  const t = pending.trim();
  if (!t || isTinyLeadFragment(t)) return "";

  const m = t.match(/^[\s\S]{16,}?[.!?…](?:\s|$)/);
  if (m) {
    const head = m[0].trim();
    if (isUsableSpeakableClause(head)) return head;
  }

  const early = tryEarlyPhraseDispatch(t, 12);
  if (early && isUsableSpeakableClause(early.clause)) return early.clause;
  if (early && isUsableSpeakableClause(t)) return t;

  if (isUsableSpeakableClause(t) && t.split(/\s+/).filter(Boolean).length >= 4 && t.length >= 20) {
    return t;
  }
  return "";
}

/**
 * Emit the first speakable clause from streaming LLM text before a sentence
 * boundary (.!?) arrives.
 */
export function tryEarlyPhraseDispatch(
  remainder: string,
  minChars: number,
): { clause: string; rest: string } | null {
  const minBuffer = minChars + 6;
  if (remainder.length < minBuffer) return null;

  const firstComma = remainder.indexOf(", ");
  if (firstComma !== -1 && remainder.length >= minBuffer) {
    const clause = remainder.slice(0, firstComma).trim();
    const rest = remainder.slice(firstComma + 2);
    if (isTimeListComma(clause, rest)) {
      // fall through
    } else {
      const indic = /[\u0900-\u0D7F]/.test(clause);
      const minClause = indic ? Math.max(24, minChars) : 5;
      if (/^(or|and|but|ya|या|और|अथवा|लेकिन|அல்லது|இல்ல)\b/iu.test(rest.trim())) {
        return null;
      }
      if (/\b(or|या|अथवा|அல்லது)\b/iu.test(rest.slice(0, 48))) {
        return null;
      }
      if (clause.length >= minClause && !isTinyLeadFragment(clause)) {
        return { clause, rest };
      }
    }
  }

  for (const sep of ["; ", " — ", " - "] as const) {
    const idx = remainder.lastIndexOf(sep);
    if (idx >= minChars - 1) {
      const clause = remainder.slice(0, idx).trim();
      if (clause.length >= minChars && !isTinyLeadFragment(clause)) {
        return { clause, rest: remainder.slice(idx + sep.length) };
      }
    }
  }

  // Word-boundary only while the LLM is still mid-clause (no .!? yet).
  // Do not slice finished sentences, either/or questions, or time lists.
  if (/[.!?…]/.test(remainder)) return null;
  if (/\b(or|या|अथवा|அல்லது)\b/iu.test(remainder)) return null;
  const indic = /[\u0900-\u0D7F]/.test(remainder);
  const wordSplitAt = indic ? Math.max(48, minChars + 24) : Math.max(36, minChars + 16);
  if (remainder.length >= wordSplitAt) {
    const cut = remainder.lastIndexOf(" ");
    if (cut >= minChars) {
      const clause = remainder.slice(0, cut).trim();
      const words = clause.split(/\s+/).filter(Boolean);
      if (!isTinyLeadFragment(clause) && words.length >= 4 && isUsableSpeakableClause(clause)) {
        return { clause, rest: remainder.slice(cut + 1) };
      }
    }
  }

  return null;
}

/**
 * Splits accumulated LLM streaming text into speakable clauses for TTS.
 *
 *  • "!" and "?" are always boundaries.
 *  • "..." is a breath, not a clip.
 *  • "." splits on whitespace + uppercase / Indic / quote.
 *  • Falls back to comma / word-boundary dispatch before the sentence ends.
 */
export function extractSentences(text: string, minCommaClauseChars = 8): { sentences: string[]; remainder: string } {
  const sentences: string[] = [];
  let i = 0;
  let segStart = 0;

  while (i < text.length) {
    const ch = text[i]!;

    if (ch === "!" || ch === "?") {
      while (i + 1 < text.length && (text[i + 1] === "!" || text[i + 1] === "?")) i++;
      const s = text.slice(segStart, i + 1).trim();
      if (s.length >= Math.min(10, minCommaClauseChars)) sentences.push(s);
      i++;
      while (i < text.length && text[i] === " ") i++;
      segStart = i;
    } else if (ch === "." && text[i + 1] === "." && text[i + 2] === ".") {
      i += 3;
      continue;
    } else if (ch === "\u0964") {
      const s = text.slice(segStart, i + 1).trim();
      if (s.length >= 4) sentences.push(s);
      i++;
      while (i < text.length && text[i] === " ") i++;
      segStart = i;
    } else if (ch === ".") {
      const next = i + 1;
      if (next >= text.length) {
        const s = text.slice(segStart, i + 1).trim();
        if (s.length >= 4) sentences.push(s);
        i++;
        segStart = i;
      } else if (text[next] === " " || text[next] === "\n") {
        let j = next + 1;
        while (j < text.length && (text[j] === " " || text[j] === "\n")) j++;
        const afterSpace = j < text.length ? text[j] : undefined;
        const shouldSplit = afterSpace === undefined || /[A-Z"'(\u2018\u201C\u0900-\u0D7F]/.test(afterSpace);

        if (shouldSplit) {
          const wordBefore = text.slice(segStart, i).match(/([A-Za-z]+)$/)?.[1];
          const isAbbrev = wordBefore !== undefined && wordBefore.length <= 2;
          if (!isAbbrev) {
            const s = text.slice(segStart, i + 1).trim();
            if (s.length >= 4) sentences.push(s);
            segStart = j;
            i = j;
          } else {
            i++;
          }
        } else {
          i++;
        }
      } else {
        i++;
      }
    } else {
      i++;
    }
  }

  let remainder = text.slice(segStart);

  const early = tryEarlyPhraseDispatch(remainder, minCommaClauseChars);
  if (early) {
    sentences.push(early.clause);
    remainder = early.rest;
  }

  return { sentences, remainder };
}
