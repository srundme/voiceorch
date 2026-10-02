import { useRef, useState } from "react";
import { FileUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DataTable, touch } from "@/components/sales/sales-ui";
import { applyMapping, guessMapping, parseCsv, type ParsedCsv } from "@/lib/sales-csv";

export type CsvField = { key: string; label: string; required?: boolean; aliases?: string[] };
export type MappedCsv = { filename: string; rows: Array<Record<string, string>> };

const MAX_ROWS = 5000;

/** File picker → column mapping → preview. Parsing happens entirely in the browser. */
export function CsvMapper({ fields, onReady, readyLabel = "Continue", pending }: { fields: CsvField[]; onReady: (data: MappedCsv) => void; readyLabel?: string; pending?: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedCsv | null>(null);
  const [mapping, setMapping] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);

  const load = async (f: File) => {
    setError(null);
    try {
      const text = await f.text();
      const csv = parseCsv(text);
      if (!csv.headers.length || !csv.rows.length) throw new Error("The file has no data rows.");
      if (csv.rows.length > MAX_ROWS) throw new Error(`The file has ${csv.rows.length} rows; the limit is ${MAX_ROWS}.`);
      setFile(f.name);
      setParsed(csv);
      setMapping(guessMapping(csv.headers, fields));
    } catch (e) {
      setParsed(null);
      setError(e instanceof Error ? e.message : "Could not read the file.");
    }
  };

  const missing = fields.filter((f) => f.required && (mapping[f.key] ?? -1) < 0);
  const mapped = parsed ? applyMapping(parsed.rows, mapping) : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void load(f);
            e.target.value = "";
          }}
        />
        <Button type="button" variant="outline" className={touch} onClick={() => inputRef.current?.click()}>
          <FileUp className="mr-1.5 h-4 w-4" /> {file ? "Choose another CSV" : "Choose CSV file"}
        </Button>
        {file && parsed && (
          <span className="text-xs text-muted-foreground">
            {file} · {parsed.rows.length} rows · {parsed.headers.length} columns
          </span>
        )}
      </div>
      {error && <p className="text-sm text-red-500">{error}</p>}

      {parsed && (
        <>
          <div>
            <p className="mb-2 text-sm font-medium">Map columns</p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {fields.map((f) => (
                <div key={f.key} className="space-y-1">
                  <Label className="text-xs">
                    {f.label}
                    {f.required && <span className="text-red-500"> *</span>}
                  </Label>
                  <Select value={String(mapping[f.key] ?? -1)} onValueChange={(v) => setMapping({ ...mapping, [f.key]: Number(v) })}>
                    <SelectTrigger className={touch}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="-1">— not in file —</SelectItem>
                      {parsed.headers.map((h, i) => (
                        <SelectItem key={`${h}-${i}`} value={String(i)}>
                          {h || `Column ${i + 1}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-2 text-sm font-medium">Preview (first 5 rows)</p>
            <DataTable>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead>
                    {fields
                      .filter((f) => (mapping[f.key] ?? -1) >= 0)
                      .map((f) => (
                        <TableHead key={f.key}>{f.label}</TableHead>
                      ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {mapped.slice(0, 5).map((r, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-xs text-muted-foreground">{i + 1}</TableCell>
                      {fields
                        .filter((f) => (mapping[f.key] ?? -1) >= 0)
                        .map((f) => (
                          <TableCell key={f.key} className="max-w-48 truncate text-xs">
                            {r[f.key] || "—"}
                          </TableCell>
                        ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </DataTable>
          </div>

          {missing.length > 0 && <p className="text-xs text-amber-600 dark:text-amber-400">Map required columns: {missing.map((f) => f.label).join(", ")}</p>}
          <Button type="button" className={touch} disabled={missing.length > 0 || pending} onClick={() => onReady({ filename: file ?? "upload.csv", rows: mapped })}>
            {pending ? "Working…" : readyLabel}
          </Button>
        </>
      )}
    </div>
  );
}
