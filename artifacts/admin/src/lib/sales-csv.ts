export type ParsedCsv = { headers: string[]; rows: string[][] };

/** RFC 4180-style parser: quoted fields, escaped quotes, CRLF/LF, BOM. */
export function parseCsv(text: string): ParsedCsv {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const records: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      records.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length) {
    row.push(field);
    records.push(row);
  }

  const nonEmpty = records.filter((r) => r.some((c) => c.trim() !== ""));
  const [headerRow, ...rows] = nonEmpty;
  return { headers: (headerRow ?? []).map((h) => h.trim()), rows };
}

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Best-guess mapping from target field → CSV column index (or -1). */
export function guessMapping(headers: string[], fields: Array<{ key: string; aliases?: string[] }>): Record<string, number> {
  const norm = headers.map(squash);
  const out: Record<string, number> = {};
  for (const f of fields) {
    const candidates = [f.key, ...(f.aliases ?? [])].map(squash);
    out[f.key] = norm.findIndex((h) => candidates.includes(h));
  }
  return out;
}

export function applyMapping(rows: string[][], mapping: Record<string, number>): Array<Record<string, string>> {
  return rows.map((r) => {
    const obj: Record<string, string> = {};
    for (const [key, idx] of Object.entries(mapping)) {
      if (idx >= 0) obj[key] = (r[idx] ?? "").trim();
    }
    return obj;
  });
}
