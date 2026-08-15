/**
 * Raw PDF text extraction (pdf-parse). Kept free of DB/LLM imports so the
 * diagnose-kb-pdf script can run without a configured environment.
 */

type PdfParseFn = (buf: Uint8Array) => Promise<{ text: string }>;

/**
 * Load pdf-parse via dynamic import so esbuild bundles it into dist/.
 *
 * The previous createRequire() form resolved pdf-parse from node_modules at
 * runtime, so PDF extraction broke in any deployment that ships only the
 * bundle — while TXT/DOCX kept working. Import keeps it inside the bundle.
 */
async function loadPdfParse(): Promise<PdfParseFn> {
  const mod: unknown = await import("pdf-parse");
  const fn = typeof mod === "function" ? mod : (mod as { default?: unknown })?.default;
  if (typeof fn !== "function") throw new Error("pdf-parse: unexpected module shape");
  return fn as PdfParseFn;
}

/**
 * Run pdf-parse over a PDF buffer and return its raw text.
 *
 * Node allocates Buffers under ~4KB as views into a shared 8KB pool, so
 * `buffer.byteOffset` is often non-zero. pdf.js ignores the view bounds and
 * reads the whole underlying ArrayBuffer, which turns a perfectly valid small
 * PDF into garbage ("bad XRef entry"). Copying into an exactly-sized
 * Uint8Array first is what makes small PDFs parse at all.
 */
export async function parsePdfText(buffer: Buffer): Promise<string> {
  const pdfParse = await loadPdfParse();
  const bytes = new Uint8Array(buffer.byteLength);
  bytes.set(buffer);
  const parsed = await pdfParse(bytes);
  return parsed.text ?? "";
}
