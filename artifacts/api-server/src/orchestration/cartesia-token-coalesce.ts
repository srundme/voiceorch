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
 */

const BREAK = /[\s.,;:!?…।॥]$/u;
const INDIC = /[\u0900-\u0D7F]/u;

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
