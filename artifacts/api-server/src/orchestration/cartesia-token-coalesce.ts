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

/** Full LLM text minus what we already sent to Cartesia (call 24547 truncated `இல`). */
export function cartesiaUnspokenTail(sent: string, full: string): string {
  if (!full) return "";
  if (!sent) return full;
  if (full.startsWith(sent)) return full.slice(sent.length);
  // A rewrite/normalization mismatch is not evidence of an unspoken suffix.
  // Never replay words the caller may already have heard.
  return "";
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
    const held = flushCartesiaSpeakable(this.pending);
    this.pending = "";
    const stream: string[] = [];
    if (held) {
      stream.push(held);
      this.sent += held;
    }
    return { stream, leftover: cartesiaUnspokenTail(this.sent, fullReply) };
  }

  reset(): void {
    this.pending = "";
    this.sent = "";
  }
}
