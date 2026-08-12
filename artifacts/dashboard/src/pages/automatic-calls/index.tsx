/**
 * Automatic Calls — list pipelines that watch Google Sheets and dial leads.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { StripePage } from "@/components/stripe-page";
import { useToast } from "@/hooks/use-toast";
import { Plus, Sheet, Loader2, Play, Pause, ExternalLink, Square } from "lucide-react";
import { cn } from "@/lib/utils";

const API = "/api";

type Pipeline = {
  id: string;
  name: string;
  status: string;
  startMode: string;
  writebackMode: string;
  spreadsheetId: string;
  spreadsheetTitle: string | null;
  sheetName: string;
  agentId: number;
  enqueuedCount: number;
  dialedCount: number;
  failedCount: number;
  lastPolledAt: string | null;
  lastError: string | null;
  createdAt: string;
};

const STATUS_STYLE: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  running: "bg-emerald-500/15 text-emerald-600",
  paused: "bg-amber-500/15 text-amber-700",
  stopped: "bg-rose-500/10 text-rose-600",
};

type PipelineAction = "start" | "pause" | "resume" | "stop";

export default function AutomaticCallsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const q = useQuery({
    queryKey: ["automatic-calls"],
    queryFn: () => customFetch<Pipeline[]>(`${API}/automatic-calls`),
  });

  const action = useMutation({
    mutationFn: ({ id, op }: { id: string; op: PipelineAction }) =>
      customFetch(`${API}/automatic-calls/${id}/${op}`, { method: "POST" }),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ["automatic-calls"] });
      toast({
        title:
          vars.op === "pause" ? "Pipeline paused" :
          vars.op === "stop" ? "Pipeline stopped" :
          vars.op === "resume" ? "Pipeline resumed" :
          "Pipeline started",
      });
    },
    onError: (err: Error) => {
      toast({ title: "Action failed", description: err.message, variant: "destructive" });
    },
  });

  const rows = q.data ?? [];
  const busyId = action.isPending ? action.variables?.id : null;

  return (
    <StripePage
      title="Google Sheets"
      description="Watch a sheet and dial new rows automatically."
      back={{ href: "/app/campaigns", label: "Campaigns" }}
      actions={
        <Button asChild size="sm" className="h-9 gap-1.5">
          <Link href="/app/automatic-calls/new">
            <Plus className="h-4 w-4" />
            Connect sheet
          </Link>
        </Button>
      }
    >
    <div className="mx-auto max-w-5xl space-y-6">

      {q.isLoading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-12 justify-center">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      )}

      {!q.isLoading && rows.length === 0 && (
        <div className="rounded-xl border border-dashed border-border/70 px-6 py-14 text-center space-y-3">
          <Sheet className="h-8 w-8 mx-auto text-muted-foreground/60" />
          <p className="text-sm font-medium">No Google Sheets yet</p>
          <p className="text-xs text-muted-foreground max-w-md mx-auto">
            Connect a sheet under Connections, map columns, and dial from the sheet pipeline.
          </p>
          <Button asChild size="sm" className="mt-2">
            <Link href="/app/automatic-calls/new">Connect sheet</Link>
          </Button>
        </div>
      )}

      <div className="space-y-2">
        {rows.map((p) => (
          <div
            key={p.id}
            className="rounded-xl border border-border/60 bg-card/40 px-4 py-3 hover:border-border transition-colors"
          >
            <div className="flex items-center gap-3">
              <Link
                href={`/app/automatic-calls/${p.id}`}
                className="h-9 w-9 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0"
              >
                {p.status === "running" ? (
                  <Play className="h-4 w-4 text-emerald-600" />
                ) : p.status === "paused" ? (
                  <Pause className="h-4 w-4 text-amber-600" />
                ) : (
                  <Sheet className="h-4 w-4 text-muted-foreground" />
                )}
              </Link>
              <Link href={`/app/automatic-calls/${p.id}`} className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium truncate">{p.name}</p>
                  <span className={cn("text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded font-medium", STATUS_STYLE[p.status] ?? STATUS_STYLE.draft)}>
                    {p.status}
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                  {p.spreadsheetTitle || "Sheet"} · {p.sheetName} · {p.startMode.replace(/_/g, " ")} · writeback {p.writebackMode.replace(/_/g, " ")}
                </p>
              </Link>
              <div className="text-right shrink-0 hidden sm:block">
                <p className="text-xs text-muted-foreground">
                  {p.enqueuedCount} queued · {p.dialedCount} dialed
                  {p.failedCount > 0 ? ` · ${p.failedCount} failed` : ""}
                </p>
                {p.lastError && (
                  <p className="text-[10px] text-rose-600 truncate max-w-[200px]">{p.lastError}</p>
                )}
                {p.spreadsheetId && (
                  <button
                    type="button"
                    className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-foreground mt-0.5"
                    onClick={() => {
                      window.open(`https://docs.google.com/spreadsheets/d/${p.spreadsheetId}/edit`, "_blank", "noopener");
                    }}
                  >
                    Open sheet <ExternalLink className="h-2.5 w-2.5" />
                  </button>
                )}
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              {(p.status === "draft" || p.status === "stopped") && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs gap-1 text-emerald-600 border-emerald-500/40 hover:bg-emerald-500/10"
                  disabled={busyId === p.id}
                  onClick={() => action.mutate({ id: p.id, op: "start" })}
                >
                  <Play className="h-3 w-3" /> Start
                </Button>
              )}
              {p.status === "running" && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs gap-1 text-amber-600 border-amber-500/40 hover:bg-amber-500/10"
                  disabled={busyId === p.id}
                  onClick={() => action.mutate({ id: p.id, op: "pause" })}
                >
                  <Pause className="h-3 w-3" /> Pause
                </Button>
              )}
              {p.status === "paused" && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs gap-1 text-emerald-600 border-emerald-500/40 hover:bg-emerald-500/10"
                  disabled={busyId === p.id}
                  onClick={() => action.mutate({ id: p.id, op: "resume" })}
                >
                  <Play className="h-3 w-3" /> Resume
                </Button>
              )}
              {p.status !== "stopped" && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs gap-1 text-red-500 border-red-500/40 hover:bg-red-500/10"
                  disabled={busyId === p.id}
                  onClick={() => action.mutate({ id: p.id, op: "stop" })}
                >
                  <Square className="h-3 w-3" /> Stop
                </Button>
              )}
              <Button asChild size="sm" variant="outline" className="h-7 text-xs gap-1 ml-auto">
                <Link href={`/app/automatic-calls/${p.id}`}>
                  Edit / Open <ExternalLink className="h-3 w-3" />
                </Link>
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
    </StripePage>
  );
}
