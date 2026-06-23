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
 * any orphan reasoning tags left behind. Used for the final flush text and the
 * stored conversation-history/transcript so reasoning never reaches TTS or the UI.
 */
export function stripReasoningBlocks(text: string): string {
  return text
    .replace(CLOSED_BLOCK_RE, "")
    .replace(UNCLOSED_BLOCK_RE, "")
    .replace(/<\/?(?:think|thinking|reasoning)\b[^>]*>/gi, "");
}

export const __test = { findEarliestTag, maxPartialTagSuffix, MAX_TAG_LEN };
