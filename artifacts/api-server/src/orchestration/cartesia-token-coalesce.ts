/**
 * Cartesia continuations docs allow word-sized chunks, but feeding Sonic a
 * word every token (call 25295: "Hey, I " / "don't think " / "VP-level ")
 * makes it spell and overlap itself. Hold until a real sentence end.
 * Combining marks stay attached (call 24502). Do not insert or drop spaces.
 * Do not treat `3.5` / `3.` as a sentence (digit + period).
 */

const SENTENCE_MARK = /[?!…।॥]/u;

function firstCartesiaSentenceEnd(buf: string): number {
  for (let i = 0; i < buf.length; i++) {
    const c = buf[i]!;
    if (SENTENCE_MARK.test(c)) return i;
    if (c !== ".") continue;
    if (i > 0 && /\d/.test(buf[i - 1]!)) continue;
    if (i + 1 < buf.length && /\d/.test(buf[i + 1]!)) continue;
    return i;
  }
  return -1;
}

export function pushCartesiaSpeakable(pending: string, token: string): { pieces: string[]; rest: string } {
  let rest = pending + token;
  if (!rest) return { pieces: [], rest: "" };
  const pieces: string[] = [];
  while (rest && !/\p{M}$/u.test(rest)) {
    const last = firstCartesiaSentenceEnd(rest);
    if (last < 0) break;
    let end = last + 1;
    if (end < rest.length && /\s/.test(rest[end]!)) end++;
    const head = rest.slice(0, end);
    rest = rest.slice(end);
    if (head.trim()) pieces.push(head);
  }
  return { pieces, rest };
}

export function flushCartesiaSpeakable(pending: string): string {
  return pending;
}

const MARKUP_TAG = /<[^<>]*>/g;
const LEADING_MARKUP = /^(?:\s*<[^<>]*>)+\s*/;

/**
 * Index in `full` just past the text of `prefix`, or -1 when `prefix` is not a
 * prefix of `full`. Markup tags and whitespace are ignored on both sides: the
 * streamed text keeps `<emotion …/>` for Cartesia while the full reply is
 * markup-stripped and trimmed (call 43738 lost "இருக்கா?" / "ருக்குமா?").
 */
function spokenPrefixEnd(prefix: string, full: string): number {
  const a = prefix.normalize("NFC").replace(MARKUP_TAG, "");
  const b = full.normalize("NFC");
  let j = 0;
  for (let i = 0; i < a.length; i++) {
    if (/\s/u.test(a[i]!)) continue;
    for (;;) {
      if (j >= b.length) return -1;
      if (/\s/u.test(b[j]!)) { j++; continue; }
      if (b[j] === "<") {
        const close = b.indexOf(">", j);
        if (close > j) { j = close + 1; continue; }
      }
      break;
    }
    if (b[j] !== a[i]) return -1;
    j++;
  }
  return j;
}

/** Full LLM text minus what we already sent to Cartesia (call 24547 truncated `இல`). */
export function cartesiaUnspokenTail(sent: string, full: string): string {
  if (!full) return "";
  if (!sent) return full;
  const end = spokenPrefixEnd(sent, full);
  if (end < 0) return "";
  const tail = full.normalize("NFC").slice(end);
  return /\s$/u.test(sent) ? tail.trimStart() : tail;
}

/**
 * If the held last fragment is a truncated prefix of the unspoken remainder,
 * speak the remainder (call 27214: "நல்லா " vs "நல்லா கேக்குதா?").
 * A leading emotion tag on the held text is kept so Cartesia still gets it.
 */
export function completeCartesiaHeldTail(held: string, restOfFull: string): string {
  if (!restOfFull) return held;
  if (!held) return restOfFull;
  const end = spokenPrefixEnd(held, restOfFull);
  if (end < 0) return held;
  const r = restOfFull.normalize("NFC");
  if (!r.slice(end).trim()) return held;
  const tags = LEADING_MARKUP.exec(held.normalize("NFC"))?.[0] ?? "";
  return tags + (tags ? r.trimStart() : r);
}

export class CartesiaTurnStream {
  pending = "";
  sent = "";

  push(token: string): string[] {
    const r = pushCartesiaSpeakable(this.pending, token);
    this.pending = r.rest;
    const out: string[] = [];
    for (const p of r.pieces) {
      out.push(p);
      this.sent += p;
    }
    return out;
  }

  finish(fullReply: string): { stream: string[]; leftover: string } {
    const restOfFull = cartesiaUnspokenTail(this.sent, fullReply);
    const held = flushCartesiaSpeakable(this.pending);
    this.pending = "";
    const last = completeCartesiaHeldTail(held, restOfFull);
    const stream: string[] = [];
    if (last) {
      stream.push(last);
      this.sent += last;
    }
    return { stream, leftover: cartesiaUnspokenTail(this.sent, fullReply) };
  }

  reset(): void {
    this.pending = "";
    this.sent = "";
  }
}
