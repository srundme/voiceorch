/**
 * LLM emotion / break markup. Complete leading `<emotion value="…"/>` tags
 * are voice controls; truncated leftovers (call 17666: `<emotion value="c`)
 * must never reach TTS.
 */

import { CARTESIA_EMOTIONS } from "./adapters/tts/cartesia.js";

export function stripMarkupTags(text: string, trim = true): string {
  const stripped = text
    .replace(/<\/?emotion\b[^>]*>/gi, "")
    .replace(/<break\b[^>]*\/?>/gi, "")
    // Mid-tag leftovers have no `>`, so the complete-tag regex misses them.
    .replace(/<\/?(?:emotion|break)\b[^>]*$/gi, "")
    .replace(/[^\S\r\n]{2,}/g, " ");
  return trim ? stripped.trim() : stripped;
}

/**
 * Extracts the first `<emotion value="…"/>` tag from the very beginning of a
 * sentence. Returns the matched emotion value (lowercased) and speakable text
 * with complete and truncated markup stripped. Empty `text` means enqueue
 * should skip TTS.
 */
export function extractEmotionTag(
  text: string,
  opts?: { trim?: boolean },
): { emotion: string | null; text: string } {
  const match = /^\s*<emotion\s+(?:value|type)=["']([^"']+)["']\s*\/?>/i.exec(text);
  if (match) {
    return { emotion: match[1]!.toLowerCase(), text: stripMarkupTags(text, opts?.trim !== false) };
  }
  // Call 42507: the model sometimes drops the tag syntax and writes the bare
  // value ("curious Achha, …", "[calm] Five crore …"), which Sonic read aloud.
  // Lowercase only, and only before a capital / non-Latin word, so ordinary
  // sentences ("Happy to help", "calm down") are untouched.
  const bare = /^(\s*)\[?([a-z]+)\]?\s+(?=[A-Z]|[^\x00-\x7F])/.exec(text);
  if (bare && CARTESIA_EMOTIONS.has(bare[2]!)) {
    const rest = bare[1]! + text.slice(bare[0].length);
    return { emotion: bare[2]!, text: stripMarkupTags(rest, opts?.trim !== false) };
  }
  return { emotion: null, text: stripMarkupTags(text, opts?.trim !== false) };
}

/**
 * Stateful per-turn filter: strip `</emotion>` and `<break …/>`, pass complete
 * `<emotion …>` through for extractEmotionTag, hold incomplete opening tags
 * so they never become a TTS sentence.
 */
export function makeMarkupTagFilter(): (token: string) => string {
  const STRIP_PREFIXES = ["</emotion", "<break"];
  const PASS_PREFIXES = ["<emotion"];
  let buf = "";
  let prevEndedWithSpace = false;

  return function filterMarkupToken(token: string): string {
    buf += token;
    let raw = "";

    while (buf.length > 0) {
      const lt = buf.indexOf("<");
      if (lt === -1) {
        raw += buf;
        buf = "";
        break;
      }
      raw += buf.slice(0, lt);
      buf = buf.slice(lt);

      const lower = buf.toLowerCase();
      let strip = false;
      let pass = false;
      let partial = false;
      for (const p of STRIP_PREFIXES) {
        if (lower.startsWith(p)) { strip = true; break; }
        if (p.startsWith(lower)) partial = true;
      }
      if (!strip) {
        for (const p of PASS_PREFIXES) {
          if (lower.startsWith(p)) { pass = true; break; }
          if (p.startsWith(lower)) partial = true;
        }
      }

      if (strip) {
        const gt = buf.indexOf(">");
        if (gt === -1) break;
        buf = buf.slice(gt + 1);
      } else if (pass) {
        const gt = buf.indexOf(">");
        if (gt === -1) break;
        raw += buf.slice(0, gt + 1);
        buf = buf.slice(gt + 1);
      } else if (partial) {
        break;
      } else {
        raw += "<";
        buf = buf.slice(1);
      }
    }

    let out = "";
    for (const ch of raw) {
      if (ch === " ") {
        if (prevEndedWithSpace) continue;
        prevEndedWithSpace = true;
        out += ch;
      } else {
        prevEndedWithSpace = false;
        out += ch;
      }
    }
    return out;
  };
}
