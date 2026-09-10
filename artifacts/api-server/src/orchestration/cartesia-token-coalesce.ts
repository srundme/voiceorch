/**
 * Cartesia must not receive LLM subword scraps (call 24404 / follow-up
 * blabber). Hold tokens until a space or pause mark, and never flush while
 * the buffer ends on a combining mark (Tamil virama, etc.).
 * This is not sentence-wait (no `.!?` floor) and not comma-splitting.
 */

const BREAK_RUN = /[\s.,;:!?…।॥]+/u;

export function pushCartesiaSpeakable(pending: string, token: string): { pieces: string[]; rest: string } {
  let buf = pending + token;
  const pieces: string[] = [];
  while (buf.length > 0) {
    if (/\p{M}$/u.test(buf)) break;
    const m = buf.match(/^([\s\S]*?[\s.,;:!?…।॥]+)([\s\S]*)$/u);
    if (!m) break;
    pieces.push(m[1]!);
    buf = m[2]!;
  }
  return { pieces, rest: buf };
}

export function hasCartesiaWordBreak(text: string): boolean {
  return BREAK_RUN.test(text);
}
