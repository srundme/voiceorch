/**
 * Reasoning / "thinking" stripping for live calls — shared by pipeline.ts
 * (telephony) and telephony/webcall.ts (browser WS) so both paths behave
 * identically.
 *
 * Reasoning-capable models leak their internal monologue into the spoken
 * channel in a few different shapes:
 *   • Inline tag blocks: <think>…</think>, <thinking>…</thinking>,
 *     <reasoning>…</reasoning> (case-insensitive, sometimes with attributes).
 *   • A separate `reasoning_content` delta field (DeepSeek R1 etc.) — handled at
 *     the adapter level by simply never forwarding it to onToken, so it never
 *     reaches this filter.
 *
 * Two entry points:
 *   • makeThinkFilter(): a STREAMING filter that drops reasoning token-by-token,
 *     hardened against an opening/closing tag that is split across token
 *     boundaries (e.g. "<thin" + "king>").
 *   • stripReasoningBlocks(): a WHOLE-STRING strip used on the final assembled
 *     reply before TTS enqueue and history storage. Handles both closed blocks
 *     and an UNCLOSED trailing block (reasoning that never emitted its closing
 *     tag — strip to end of string so it is never spoken).
 */

/** Opening reasoning tags we recognise (lower-cased, no attributes). */
const OPEN_TAGS = ["<think>", "<thinking>", "<reasoning>"] as const;
/** Closing reasoning tags we recognise (lower-cased). */
const CLOSE_TAGS = ["</think>", "</thinking>", "</reasoning>"] as const;

const MAX_TAG_LEN = Math.max(
  ...OPEN_TAGS.map((t) => t.length),
  ...CLOSE_TAGS.map((t) => t.length),
);

/** Earliest occurrence of any tag in `tags` within `hay` (case-insensitive). */
function findEarliestTag(
  hay: string,
  tags: readonly string[],
): { idx: number; len: number } | null {
  const lower = hay.toLowerCase();
  let bestIdx = -1;
  let bestLen = 0;
  for (const tag of tags) {
    const idx = lower.indexOf(tag);
    if (idx !== -1 && (bestIdx === -1 || idx < bestIdx)) {
      bestIdx = idx;
      bestLen = tag.length;
    }
  }
  return bestIdx === -1 ? null : { idx: bestIdx, len: bestLen };
}

/**
 * Length of the longest suffix of `buf` that is a (case-insensitive) PREFIX of
 * any tag in `tags`. Used by the streaming filter to hold back the minimum
 * number of trailing characters that might be the start of a tag split across
 * the next token, instead of emitting (and speaking) them prematurely.
 */
function maxPartialTagSuffix(buf: string, tags: readonly string[]): number {
  const lower = buf.toLowerCase();
  let maxLen = 0;
  for (const tag of tags) {
    const limit = Math.min(tag.length - 1, lower.length);
    for (let k = limit; k > 0; k--) {
      if (lower.slice(lower.length - k) === tag.slice(0, k)) {
        if (k > maxLen) maxLen = k;
        break;
      }
    }
  }
  return maxLen;
}

/**
 * Streaming reasoning-tag filter. Returns the visible (non-reasoning) portion of
 * each token. State is retained across calls; create one per LLM generation.
 *
 * Guarantees:
 *   • Text inside any recognised reasoning block is never emitted.
 *   • An opening OR closing tag split across token boundaries is detected — the
 *     trailing partial is held back rather than spoken, then resolved once the
 *     rest of the tag arrives.
 *   • While inside an unclosed block, nothing is emitted (the final whole-string
 *     strip handles the never-closed case for history/flush).
 */
export function makeThinkFilter(): (token: string) => string {
  let inThinkBlock = false;
  let buf = "";

  return function filterThinkToken(token: string): string {
    buf += token;
    let out = "";

    while (buf.length > 0) {
      if (inThinkBlock) {
        const close = findEarliestTag(buf, CLOSE_TAGS);
        if (close) {
          inThinkBlock = false;
          buf = buf.slice(close.idx + close.len);
        } else {
          // Keep only a possible split closing tag at the tail; discard the rest
          // (it is reasoning content and must never be spoken).
          const keep = maxPartialTagSuffix(buf, CLOSE_TAGS);
          buf = keep > 0 ? buf.slice(buf.length - keep) : "";
          break;
        }
      } else {
        const open = findEarliestTag(buf, OPEN_TAGS);
        if (open) {
          out += buf.slice(0, open.idx);
          inThinkBlock = true;
          buf = buf.slice(open.idx + open.len);
        } else {
          // Emit everything except a possible split opening tag at the tail.
          const keep = maxPartialTagSuffix(buf, OPEN_TAGS);
          out += keep > 0 ? buf.slice(0, buf.length - keep) : buf;
          buf = keep > 0 ? buf.slice(buf.length - keep) : "";
          break;
        }
      }
    }
    return out;
  };
}

// Whole-string strip patterns: closed blocks for each recognised tag pair, plus
// an unclosed trailing block (opening tag with no matching close → strip to end).
const CLOSED_BLOCK_RE =
  /<(think|thinking|reasoning)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const UNCLOSED_BLOCK_RE =
  /<(think|thinking|reasoning)\b[^>]*>[\s\S]*$/i;

/**
 * Remove every reasoning block from an already-assembled string. Handles closed
 * blocks (all recognised tag types) AND an unclosed trailing block. Also sweeps
 * any orphan reasoning tags left behind, then strips plain-English chain-of-
 * thought that some models (notably Sarvam 105B with thinking on) emit into
 * `content` without tags — so it never reaches TTS or the UI.
 */
export function stripReasoningBlocks(text: string): string {
  return stripLeakedMonologue(
    text
      .replace(CLOSED_BLOCK_RE, "")
      .replace(UNCLOSED_BLOCK_RE, "")
      .replace(/<\/?(?:think|thinking|reasoning)\b[^>]*>/gi, ""),
  ).trimEnd();
}

/**
 * Indic / South-Asian scripts commonly used on SnapServe voice calls.
 * When CoT English precedes real speech in these scripts, keep the speech.
 */
const INDIC_SCRIPT_RE =
  /[\u0900-\u097F\u0980-\u09FF\u0A00-\u0A7F\u0A80-\u0AFF\u0B00-\u0B7F\u0B80-\u0BFF\u0C00-\u0C7F\u0C80-\u0CFF\u0D00-\u0D7F]/;

/** Opens that look like planning / meta commentary, not caller-facing speech. */
const COT_OPEN_RE =
  /^(The user |Let me |According to |Wait[, ]|Actually[, ]|Looking (carefully )?at |Since (they|the caller) |So I should |I (need to|already|should) |Based on |Okay[, ]?I |Hmm[, ]|Stage \d|Two:|Three:|Four:|IDENTITY:|FACTS:)/i;

/**
 * True when a single TTS clause is English chain-of-thought, not speech.
 * Used by the streaming sentence flusher to drop CoT mid-turn.
 */
export function isLeakedMonologueClause(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (INDIC_SCRIPT_RE.test(t)) return false;
  if (COT_OPEN_RE.test(t)) return true;
  return /\b(Let me analyze|According to the flow|I should (continue|present|ask|share)|constraints:)\b/i.test(t)
    && t.length > 40;
}

/**
 * Strip plain-English chain-of-thought that leaked into the spoken channel
 * without `<think>` tags (Sarvam 105B call 5646 pattern).
 *
 * Prefer the last speakable paragraph (Indic speech / short opener) when CoT
 * precedes it; drop pure English planning dumps with no speakable tail.
 */
export function stripLeakedMonologue(text: string): string {
  const t = text.trim();
  if (!t) return t;

  const looksLikeCot =
    COT_OPEN_RE.test(t) ||
    /\b(Let me analyze|According to the flow|I should |constraints:)\b/i.test(t.slice(0, 800));

  // Explicit "say something like:" draft → keep only the draft.
  const sayLike = t.match(/(?:Let me say something like|I(?:'ll| will) say(?: something like)?)\s*[:：]\s*([\s\S]+)$/i);
  if (sayLike?.[1]) {
    return sayLike[1]!
      .trim()
      .replace(/^["“'`]+/, "")
      .replace(/["”'`]+$/, "")
      .trim();
  }

  if (looksLikeCot && INDIC_SCRIPT_RE.test(t)) {
    // Walk paragraphs from the end — speech is usually the last block after planning.
    const paras = t.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    for (let i = paras.length - 1; i >= 0; i--) {
      const p = paras[i]!;
      if (!INDIC_SCRIPT_RE.test(p)) continue;
      if (COT_OPEN_RE.test(p)) continue;
      if (/\b(According to the flow|Let me analyze|which means)\b/i.test(p.slice(0, 100))) continue;
      // Skip short quoted fragments that are just cited caller text inside CoT.
      const indicOnly = p.replace(/[^\u0900-\u0D7F]+/g, "");
      if (indicOnly.length < 4 && /["“]/.test(p)) continue;
      return p;
    }

    // Fallback: first Indic run that isn't inside the opening CoT sentence.
    const indicIdx = t.search(INDIC_SCRIPT_RE);
    if (indicIdx > 40) {
      const before = t.slice(0, indicIdx);
      const lastBreak = Math.max(
        before.lastIndexOf("\n\n"),
        before.lastIndexOf(". "),
        before.lastIndexOf("! "),
      );
      let start = lastBreak >= 0 ? lastBreak + (before[lastBreak] === "\n" ? 2 : 2) : indicIdx;
      while (start < t.length && /\s/.test(t[start]!)) start++;
      const candidate = t.slice(start).trim();
      if (INDIC_SCRIPT_RE.test(candidate) && !COT_OPEN_RE.test(candidate)) {
        return candidate;
      }
    }
  }

  // Pure English planning with no speech — do not TTS it.
  if (
    looksLikeCot &&
    t.length > 180 &&
    /\b(I should|Let me analyze|According to the flow|constraints:|Stage \d)\b/i.test(t) &&
    !INDIC_SCRIPT_RE.test(t)
  ) {
    return "";
  }

  return t;
}

export const __test = { findEarliestTag, maxPartialTagSuffix, MAX_TAG_LEN };

// ── JSON message-wrapper stripping ───────────────────────────────────────────

/**
 * Some LLM system prompts instruct the model to respond in JSON:
 *   {"message": "Hi Karthi! Welcome to VoiceOrch."}
 *
 * Strip the wrapper and return only the inner text so TTS and the transcript
 * receive plain speech, not a JSON literal. Only strips when the ENTIRE
 * trimmed string is a single {"message":"..."} object — never mutates
 * ordinary text that happens to contain JSON fragments.
 */
export function stripJsonMessageWrapper(text: string): string {
  const t = text.trim();
  // Match: optional whitespace, {"message":"<content>"}, optional whitespace
  // Content may contain JSON escape sequences (\n, \t, \", \\, etc.)
  const m = t.match(/^\{\s*"message"\s*:\s*"((?:[^"\\]|\\.)*)"\s*\}$/s);
  if (!m) return text;
  try {
    // Let JSON.parse handle all escape sequences correctly
    return JSON.parse(`"${m[1]!}"`) as string;
  } catch {
    // Fallback manual unescape for the common cases
    return m[1]!
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t")
      .replace(/\\r/g, "\r")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
  }
}
