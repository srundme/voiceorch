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
  const a = sent.normalize("NFC");
  const b = full.normalize("NFC");
  if (b.startsWith(a)) return b.slice(a.length);
  const aTrim = a.trimEnd();
  if (b.startsWith(aTrim)) return b.slice(aTrim.length);
  return "";
}

/**
 * If the held last fragment is a truncated prefix of the unspoken remainder,
 * speak the remainder (call 27214: "நல்லா " vs "நல்லா கேக்குதா?").
 */
export function completeCartesiaHeldTail(held: string, restOfFull: string): string {
  if (!restOfFull) return held;
  if (!held) return restOfFull;
  const h = held.normalize("NFC");
  const r = restOfFull.normalize("NFC");
  if (r.startsWith(h) || r.startsWith(h.trimEnd())) return r;
  return held;
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
