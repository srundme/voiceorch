/**
 * Diagnose why a PDF fails to import into the Knowledge Base.
 *
 * Runs the exact same extraction the upload route uses and reports which stage
 * fails, so a failed import can be attributed to a scanned page, encryption,
 * or a genuinely unreadable file rather than a generic "Import failed".
 *
 *   pnpm --filter @workspace/api-server exec tsx \
 *     src/scripts/diagnose-kb-pdf.ts /path/to/file.pdf
 */
import { readFileSync } from "node:fs";
import { parsePdfText } from "../lib/pdf-text.js";

interface Structure {
  header: string;
  encrypted: boolean;
  xrefStream: boolean;
  imageCount: number;
  fontCount: number;
}

function inspectStructure(buf: Buffer): Structure {
  const count = (needle: string) => {
    let n = 0;
    let i = buf.indexOf(needle);
    while (i !== -1) {
      n++;
      i = buf.indexOf(needle, i + needle.length);
    }
    return n;
  };
  return {
    header: buf.subarray(0, 8).toString("latin1"),
    encrypted: buf.includes("/Encrypt"),
    xrefStream: buf.includes("/XRef"),
    imageCount: count("/Image"),
    fontCount: count("/Font"),
  };
}

async function main(): Promise<void> {
  const path = process.argv[2];
  if (!path) {
    console.error("usage: diagnose-kb-pdf.ts <file.pdf>");
    process.exit(1);
  }

  const buf = readFileSync(path);
  const s = inspectStructure(buf);

  console.log(`file            ${path}`);
  console.log(`size            ${buf.length} bytes`);
  console.log(`header          ${s.header}`);
  console.log(`encrypted       ${s.encrypted}`);
  console.log(`xref stream     ${s.xrefStream}`);
  console.log(`/Font objects   ${s.fontCount}`);
  console.log(`/Image objects  ${s.imageCount}`);

  if (buf.length === 0) {
    console.log("\nVERDICT: file is empty (0 bytes) — the upload never completed.");
    return;
  }
  if (!s.header.startsWith("%PDF")) {
    console.log("\nVERDICT: not a PDF — the file is misnamed or corrupt.");
    return;
  }

  let text = "";
  try {
    text = (await parsePdfText(buf)).trim();
  } catch (err) {
    const msg = String((err as Error)?.message ?? err);
    console.log(`\npdf-parse threw: ${msg}`);
    console.log(
      s.encrypted
        ? "\nVERDICT: encrypted/password-protected PDF. Remove protection and re-upload."
        : "\nVERDICT: unreadable PDF. Re-export it (Print to PDF) and try again.",
    );
    return;
  }

  console.log(`extracted chars ${text.length}`);
  if (text.length > 0) {
    console.log(`\npreview:\n${text.slice(0, 400)}`);
    console.log("\nVERDICT: text extracts fine — this PDF should import.");
    return;
  }

  console.log(
    s.imageCount > 0 && s.fontCount === 0
      ? "\nVERDICT: scanned / image-only PDF (images, no fonts). Needs OCR."
      : "\nVERDICT: no extractable text. Likely scanned or vector-outlined text. Needs OCR.",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
