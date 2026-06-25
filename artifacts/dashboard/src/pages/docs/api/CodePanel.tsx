import { useMemo, useState } from "react";
import { Check, Copy, Terminal } from "lucide-react";
import { buildCurl, getResponses } from "../openapi/curl";
import { schemaToExample } from "../openapi/schema";
import type { IndexedOperation } from "../openapi/spec";

function useCopy() {
  const [copied, setCopied] = useState(false);
  const copy = (text: string) => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return { copied, copy };
}

function statusTone(status: string): string {
  if (status.startsWith("2")) return "text-emerald-400 border-emerald-400/40";
  if (status.startsWith("3")) return "text-sky-400 border-sky-400/40";
  if (status.startsWith("4")) return "text-amber-400 border-amber-400/40";
  if (status.startsWith("5")) return "text-rose-400 border-rose-400/40";
  return "text-muted-foreground border-white/20";
}

export function CodePanel({
  op,
  baseUrl,
}: {
  op: IndexedOperation;
  baseUrl: string;
}) {
  const req = useCopy();
  const res = useCopy();

  const curl = useMemo(() => buildCurl(op, { baseUrl }), [op, baseUrl]);

  const responses = useMemo(() => {
    return getResponses(op).map((r) => {
      const example = r.schema ? schemaToExample(r.schema) : undefined;
      return {
        status: r.status,
        description: r.description,
        body: example === undefined ? null : JSON.stringify(example, null, 2),
      };
    });
  }, [op]);

  const [activeStatus, setActiveStatus] = useState(
    () => responses.find((r) => r.status.startsWith("2"))?.status ?? responses[0]?.status,
  );
  const active = responses.find((r) => r.status === activeStatus) ?? responses[0];

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-white/10 bg-[#0B0D12] overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 border-b border-white/10 bg-white/[0.03]">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Terminal className="h-3.5 w-3.5" />
            <span className="font-medium text-foreground/80">Request</span>
            <span className="font-mono text-[11px] text-muted-foreground/60">cURL</span>
          </div>
          <button
            onClick={() => req.copy(curl)}
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          >
            {req.copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
            {req.copied ? "Copied" : "Copy"}
          </button>
        </div>
        <pre className="p-3 text-[12px] leading-relaxed font-mono text-foreground/90 overflow-x-auto">
          <code>{curl}</code>
        </pre>
      </div>

      {responses.length ? (
        <div className="rounded-xl border border-white/10 bg-[#0B0D12] overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-white/10 bg-white/[0.03]">
            <div className="flex items-center gap-1.5 overflow-x-auto">
              {responses.map((r) => (
                <button
                  key={r.status}
                  onClick={() => setActiveStatus(r.status)}
                  className={`rounded-md border px-2 py-0.5 text-[11px] font-mono font-semibold transition-colors ${
                    r.status === active?.status
                      ? statusTone(r.status)
                      : "text-muted-foreground/60 border-transparent hover:text-foreground"
                  }`}
                >
                  {r.status}
                </button>
              ))}
            </div>
            {active?.body ? (
              <button
                onClick={() => res.copy(active.body!)}
                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors shrink-0"
              >
                {res.copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                {res.copied ? "Copied" : "Copy"}
              </button>
            ) : null}
          </div>
          {active?.body ? (
            <pre className="p-3 text-[12px] leading-relaxed font-mono text-foreground/90 overflow-x-auto max-h-[420px]">
              <code>{active.body}</code>
            </pre>
          ) : (
            <p className="p-3 text-xs text-muted-foreground">
              {active?.description ?? "No response body."}
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
