export interface CsvColumn<T> {
  header: string;
  value: (row: T) => unknown;
}

function cell(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  let s = value instanceof Date ? value.toISOString() : typeof value === "object" ? JSON.stringify(value) : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv<T>(columns: CsvColumn<T>[], rows: T[]): string {
  const lines = [columns.map((c) => cell(c.header)).join(",")];
  for (const row of rows) lines.push(columns.map((c) => cell(c.value(row))).join(","));
  return `${lines.join("\r\n")}\r\n`;
}
