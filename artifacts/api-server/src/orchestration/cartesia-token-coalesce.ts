/**
 * Cartesia continuations docs use word-sized chunks
 * (`Hello`, `my name`, `is Sonic.`), not BPE letters. Call 25026 sent
 * `"N"` / `"o"` / `" p"` and Sonic spelled the sentence.
 *
 * Hold until a word boundary (whitespace or punctuation). Do not wait for a
 * full sentence — that is the docs "middle ground" with delay=3000.
 * Combining marks stay attached (call 24502). Do not insert or drop spaces.
 */

const BREAK = /[\s.,;:!?…।॥]/u;

export function pushCartesiaSpeakable(pending: string, token: string): { pieces: string[]; rest: string } {
  const buf = pending + token;
  if (!buf) return { pieces: [], rest: "" };
  if (/\p{M}$/u.test(buf)) return { pieces: [], rest: buf };
  let last = -1;
  for (let i = 0; i < buf.length; i++) {
    if (BREAK.test(buf[i]!)) last = i;
  }
  const head = last >= 0 ? buf.slice(0, last + 1) : "";
  const pieces = last >= 0 && head.trim() ? [head] : [];
  const rest = pieces.length ? buf.slice(last + 1) : buf;
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
