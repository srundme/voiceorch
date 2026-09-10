/**
 * Cartesia concatenates WS transcripts verbatim, but a combining mark or BPE
 * scrap sent as its own message is spoken as junk (call 24502: "லும" then "் th",
 * "cof"+"f"+"ee "). Hold the last incomplete word; flush on whitespace/punct
 * or at stream end. Not sentence-wait and not comma-splitting.
 */

const BREAK = /[\s.,;:!?…।॥]$/u;

export function pushCartesiaSpeakable(pending: string, token: string): { pieces: string[]; rest: string } {
  const buf = pending + token;
  if (!buf) return { pieces: [], rest: "" };
  if (/\p{M}$/u.test(buf)) return { pieces: [], rest: buf };
  if (BREAK.test(buf)) return { pieces: [buf], rest: "" };
  const m = buf.match(/^(.*?)([\p{L}\p{M}]+)$/u);
  if (!m) return { pieces: [], rest: buf };
  const prefix = m[1] ?? "";
  const word = m[2] ?? "";
  if (prefix) return { pieces: [prefix], rest: word };
  return { pieces: [], rest: word };
}

export function flushCartesiaSpeakable(pending: string): string {
  return pending;
}
