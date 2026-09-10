/**
 * Cartesia managed buffering (Sonic 3.6 docs): stream LLM tokens with
 * continue:true and max_buffer_delay_ms 3000. Do NOT wait for words/sentences
 * client-side — that is the documented "middle ground" (up to 3s extra per
 * chunk) and VoBiz drops the call after ~2s of no audio.
 *
 * Only hold:
 *  - a combining mark so "்" is never its own WS transcript (call 24502)
 *  - an unspaced Indic run until whitespace (virama can still attach)
 * Latin BPE ("cof"+"f") is streamed through; Sonic concatenates in the buffer.
 *
 * Sonic closes the first WS clip at `.!?` (call 24547). Tokens after that must
 * not be more WS continuations (0-byte). Speak the unspoken suffix of the full
 * LLM text as one leftover clip.
 */

const BREAK = /[\s.,;:!?…।॥]$/u;
const INDIC = /[\u0900-\u0D7F]/u;
export const CARTESIA_SENTENCE_END = /[.!?…।॥]/u;

export function pushCartesiaSpeakable(pending: string, token: string): { pieces: string[]; rest: string } {
  const buf = pending + token;
  if (!buf) return { pieces: [], rest: "" };
  if (/\p{M}$/u.test(buf)) return { pieces: [], rest: buf };
  if (BREAK.test(buf)) return { pieces: [buf], rest: "" };
  if (!INDIC.test(buf)) return { pieces: [buf], rest: "" };
  const cut = buf.lastIndexOf(" ");
  if (cut >= 0) {
    return { pieces: [buf.slice(0, cut + 1)], rest: buf.slice(cut + 1) };
  }
  return { pieces: [], rest: buf };
}

export function flushCartesiaSpeakable(pending: string): string {
  return pending;
}

/** Full LLM text minus what we already sent to Cartesia (call 24547 truncated `இல`). */
export function cartesiaUnspokenTail(sent: string, full: string): string {
  if (!full) return "";
  if (!sent) return full;
  if (full.startsWith(sent)) return full.slice(sent.length);
  let i = 0;
  const n = Math.min(sent.length, full.length);
  while (i < n && sent[i] === full[i]) i++;
  let start = i;
  if (start < full.length && /^\p{M}/u.test(full.slice(start))) {
    const prev = full.slice(0, start);
    const segs = [...new Intl.Segmenter("ta", { granularity: "grapheme" }).segment(prev)];
    const last = segs.at(-1);
    if (last) start -= last.segment.length;
  }
  return full.slice(Math.max(0, start));
}

export class CartesiaTurnStream {
  pending = "";
  sent = "";
  hitPunct = false;

  push(token: string): string[] {
    if (this.hitPunct) return [];
    const r = pushCartesiaSpeakable(this.pending, token);
    this.pending = r.rest;
    const out: string[] = [];
    for (const p of r.pieces) {
      out.push(p);
      this.sent += p;
      if (CARTESIA_SENTENCE_END.test(p)) this.hitPunct = true;
    }
    return out;
  }

  finish(fullReply: string): { stream: string[]; leftover: string } {
    const held = flushCartesiaSpeakable(this.pending);
    this.pending = "";
    const stream: string[] = [];
    if (held && !this.hitPunct) {
      stream.push(held);
      this.sent += held;
      if (CARTESIA_SENTENCE_END.test(held)) this.hitPunct = true;
    }
    return { stream, leftover: cartesiaUnspokenTail(this.sent, fullReply) };
  }

  reset(): void {
    this.pending = "";
    this.sent = "";
    this.hitPunct = false;
  }
}
