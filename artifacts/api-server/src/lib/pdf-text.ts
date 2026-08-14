/**
 * Raw PDF text extraction (pdf-parse). Kept free of DB/LLM imports so the
 * diagnose-kb-pdf script can run without a configured environment.
 */
import { createRequire } from "node:module";

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
  const require = createRequire(import.meta.url);
  const pdfParse = require("pdf-parse") as (buf: Uint8Array) => Promise<{ text: string }>;
  const bytes = new Uint8Array(buffer.byteLength);
  bytes.set(buffer);
  const parsed = await pdfParse(bytes);
  return parsed.text ?? "";
}
