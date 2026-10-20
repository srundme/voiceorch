/**
 * Map each {{n}} placeholder of a chosen WhatsApp template to a value source
 * (caller name, summary, a collected field, fixed text…). Saved on the
 * template choice as `params`; the after-call sender fills the slots from it.
 */
import type { WaCatalogEntry, WaTplChoice, WaTplParam, WaTplParamSource } from "./agent-template-picks";

export type MapperField = { key: string; label: string };

const SOURCES: Array<{ value: WaTplParamSource; label: string }> = [
  { value: "auto", label: "Auto (let SnapServe guess)" },
  { value: "caller_name", label: "Caller's name" },
  { value: "agent_name", label: "Agent name" },
  { value: "summary", label: "Call summary" },
  { value: "phone", label: "Caller's phone number" },
  { value: "outcome", label: "Call outcome" },
  { value: "meeting_time", label: "Meeting date & time" },
  { value: "meet_link", label: "Meeting link" },
  { value: "field", label: "Collected field…" },
  { value: "text", label: "Fixed text…" },
];

const SAMPLE: Partial<Record<WaTplParamSource, string>> = {
  caller_name: "Caller's name",
  agent_name: "Agent name",
  summary: "Call summary",
  phone: "Phone number",
  outcome: "Outcome",
  meeting_time: "Meeting time",
  meet_link: "Meeting link",
};

const SELECT_CLS = "h-8 w-full rounded-md border border-input bg-background px-2 text-xs";
const INPUT_CLS = "h-8 w-full rounded-md border border-input bg-background px-2 text-xs";

/** Template body + slot count from the catalog (saved choices may lack paramCount). */
export function templateSlots(
  catalog: WaCatalogEntry[],
  value: WaTplChoice | null | undefined,
): { count: number; body: string } {
  if (!value?.name) return { count: 0, body: "" };
  const hit = catalog.find((t) => t.name === value.name && t.language === value.language)
    ?? catalog.find((t) => t.name === value.name);
  const body = (hit?.bodyPreview ?? "").trim();
  const fromBody = new Set([...body.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m) => m[1])).size;
  return { count: Math.max(hit?.paramCount ?? 0, value.paramCount ?? 0, fromBody), body };
}

function chipText(p: WaTplParam | undefined, fields: MapperField[]): string {
  if (!p || p.source === "auto") return "auto";
  if (p.source === "text") return p.text?.trim() || "fixed text";
  if (p.source === "field") return fields.find((f) => f.key === p.key)?.label || p.key || "field";
  return SAMPLE[p.source] ?? p.source;
}

export function TemplateVariableMapper({
  catalog,
  value,
  fields,
  onChange,
  onCommit,
}: {
  catalog: WaCatalogEntry[];
  value: WaTplChoice | null | undefined;
  fields: MapperField[];
  /** Every edit. */
  onChange: (next: WaTplChoice) => void;
  /** Persist now: after a dropdown change, or when a text box loses focus. */
  onCommit: () => void;
}) {
  if (!value?.name) return null;
  const { count, body } = templateSlots(catalog, value);
  if (count === 0) {
    return body ? (
      <p className="mt-2 text-[10px] text-muted-foreground">This template has no variables to fill.</p>
    ) : null;
  }

  const params: WaTplParam[] = Array.from({ length: count }, (_, i) => value.params?.[i] ?? { source: "auto" });
  const setParam = (i: number, next: WaTplParam, commit: boolean) => {
    const all = params.map((p, j) => (j === i ? next : p));
    onChange({ ...value, paramCount: count, params: all });
    if (commit) onCommit();
  };
  const usableFields = fields.filter((f) => f.key.trim());

  return (
    <div className="mt-2 space-y-2 rounded-lg border border-border/60 bg-background/40 p-2.5">
      <div>
        <p className="text-[11px] font-medium text-foreground">Fill the template variables</p>
        <p className="text-[10px] text-muted-foreground">
          Choose what goes into each {"{{n}}"} when the message is sent. "Auto" keeps SnapServe's best guess.
        </p>
      </div>

      {body && (
        <p className="whitespace-pre-wrap rounded-md bg-muted/40 px-2 py-1.5 text-[11px] leading-relaxed text-muted-foreground">
          {body.split(/(\{\{\s*\d+\s*\}\})/g).map((part, i) => {
            const m = /^\{\{\s*(\d+)\s*\}\}$/.exec(part);
            if (!m) return <span key={i}>{part}</span>;
            const n = Number(m[1]);
            return (
              <span key={i} className="mx-0.5 rounded bg-primary/15 px-1 font-medium text-foreground">
                {`{{${n}}}`} {chipText(params[n - 1], usableFields)}
              </span>
            );
          })}
          {body.length >= 150 ? "…" : ""}
        </p>
      )}

      {params.map((p, i) => (
        <div key={i} className="grid grid-cols-[3rem_1fr] items-start gap-2">
          <span className="pt-2 font-mono text-[11px] text-foreground">{`{{${i + 1}}}`}</span>
          <div className="space-y-1.5">
            <select
              aria-label={`Value for {{${i + 1}}}`}
              className={SELECT_CLS}
              value={p.source}
              onChange={(e) => {
                const source = e.target.value as WaTplParamSource;
                setParam(i, {
                  source,
                  ...(source === "field" ? { key: usableFields[0]?.key ?? "" } : {}),
                  ...(source === "text" ? { text: "" } : {}),
                  ...(p.fallback && source !== "text" && source !== "auto" ? { fallback: p.fallback } : {}),
                }, true);
              }}
            >
              {SOURCES.map((s) => (
                <option key={s.value} value={s.value} disabled={s.value === "field" && usableFields.length === 0}>
                  {s.label}
                </option>
              ))}
            </select>

            {p.source === "field" && (
              <select
                aria-label={`Field for {{${i + 1}}}`}
                className={SELECT_CLS}
                value={p.key ?? ""}
                onChange={(e) => setParam(i, { ...p, key: e.target.value }, true)}
              >
                {usableFields.map((f) => (
                  <option key={f.key} value={f.key}>{f.label || f.key}</option>
                ))}
              </select>
            )}

            {p.source === "text" && (
              <input
                aria-label={`Text for {{${i + 1}}}`}
                className={INPUT_CLS}
                placeholder="e.g. Snapserve AI"
                maxLength={1024}
                value={p.text ?? ""}
                onChange={(e) => setParam(i, { ...p, text: e.target.value }, false)}
                onBlur={onCommit}
              />
            )}

            {p.source !== "auto" && p.source !== "text" && (
              <input
                aria-label={`Fallback for {{${i + 1}}}`}
                className={INPUT_CLS}
                placeholder={p.source === "caller_name" ? "If unknown, use… (e.g. there)" : "If empty, use…"}
                maxLength={1024}
                value={p.fallback ?? ""}
                onChange={(e) => setParam(i, { ...p, fallback: e.target.value || undefined }, false)}
                onBlur={onCommit}
              />
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
