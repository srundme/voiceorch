/**
 * Merge Gemini Live streaming transcription fragments.
 * Fragments may be deltas ("hel"+"lo") or cumulative ("hel"→"hello").
 */
export function mergeTranscriptFragment(buf: string, frag: string): string {
  const f = frag.trim();
  if (!f) return buf;
  if (!buf) return f;
  if (f.startsWith(buf)) return f;
  if (buf.startsWith(f)) return buf;
  // Syllable deltas: join without a space when both edges are alphanumeric
  // (incl. common Indic ranges) so "68"+"365" → "68365", not "68 365".
  const bufEnd = buf[buf.length - 1]!;
  const fragStart = f[0]!;
  const alnum = (c: string) => /[0-9A-Za-z\u0B80-\u0BFF\u0900-\u097F\u0C00-\u0C7F]/.test(c);
  const join = alnum(bufEnd) && alnum(fragStart) ? "" : (/^\s/.test(frag) || /\s$/.test(buf) ? "" : " ");
  return `${buf}${join}${f}`.replace(/[^\S\n]+/g, " ").trim();
}
