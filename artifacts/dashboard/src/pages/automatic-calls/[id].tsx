/**
 * Automatic Calls pipeline detail — status, pause/resume/stop, activity.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ExternalLink, Loader2, Pause, Play, Square } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
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
  enqueuedCount: number;
  dialedCount: number;
  failedCount: number;
  lastPolledAt: string | null;
  lastError: string | null;
  cursorRowIndex: number;
};

type RowState = {
  id: string;
  sheetRowIndex: number;
  phoneNormalized: string;
  status: string;
  error: string | null;
  callId: number | null;
  updatedAt: string;
};

export default function AutomaticCallDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id!;
  const { toast } = useToast();
  const qc = useQueryClient();

  const detailQ = useQuery({
    queryKey: ["automatic-calls", id],
    queryFn: () => customFetch<Pipeline>(`${API}/automatic-calls/${id}`),
  });
  const activityQ = useQuery({
    queryKey: ["automatic-calls", id, "activity"],
    queryFn: () => customFetch<{ pipeline: Pipeline; rows: RowState[] }>(`${API}/automatic-calls/${id}/activity`),
    refetchInterval: detailQ.data?.status === "running" ? 10_000 : false,
  });

  const action = useMutation({
    mutationFn: (op: "start" | "pause" | "resume" | "stop") =>
      customFetch(`${API}/automatic-calls/${id}/${op}`, { method: "POST" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["automatic-calls", id] });
      void qc.invalidateQueries({ queryKey: ["automatic-calls"] });
    },
    onError: (err: any) => toast({ title: "Action failed", description: err?.message, variant: "destructive" }),
  });

  const p = detailQ.data;
  const rows = activityQ.data?.rows ?? [];

  if (detailQ.isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground text-sm gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }

  if (!p) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-12 text-center space-y-3">
        <p className="text-sm">Pipeline not found</p>
        <Button asChild size="sm" variant="outline"><Link href="/app/automatic-calls">Back</Link></Button>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
      <div className="flex items-start gap-3">
        <Button variant="ghost" size="sm" asChild className="h-8 px-2 mt-0.5">
          <Link href="/app/automatic-calls"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-semibold truncate">{p.name}</h1>
            <span className={cn(
              "text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded font-medium",
              p.status === "running" && "bg-emerald-500/15 text-emerald-600",
              p.status === "paused" && "bg-amber-500/15 text-amber-700",
              p.status === "draft" && "bg-muted text-muted-foreground",
              p.status === "stopped" && "bg-rose-500/10 text-rose-600",
            )}>
              {p.status}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {p.spreadsheetTitle || p.spreadsheetId} · {p.sheetName} · {p.startMode.replace(/_/g, " ")} · {p.writebackMode.replace(/_/g, " ")}
          </p>
        </div>
        <a
          href={`https://docs.google.com/spreadsheets/d/${p.spreadsheetId}`}
          target="_blank"
          rel="noreferrer"
          className="text-muted-foreground hover:text-foreground shrink-0 mt-1"
        >
          <ExternalLink className="h-4 w-4" />
        </a>
      </div>

      {p.lastError && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-700">
          {p.lastError}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {p.status === "draft" && (
          <Button size="sm" onClick={() => action.mutate("start")} disabled={action.isPending}>
            <Play className="h-3.5 w-3.5 mr-1" /> Start
          </Button>
        )}
        {p.status === "running" && (
          <Button size="sm" variant="outline" onClick={() => action.mutate("pause")} disabled={action.isPending}>
            <Pause className="h-3.5 w-3.5 mr-1" /> Pause
          </Button>
        )}
        {p.status === "paused" && (
          <Button size="sm" onClick={() => action.mutate("resume")} disabled={action.isPending}>
            <Play className="h-3.5 w-3.5 mr-1" /> Resume
          </Button>
        )}
        {p.status !== "stopped" && (
          <Button size="sm" variant="destructive" onClick={() => action.mutate("stop")} disabled={action.isPending}>
            <Square className="h-3.5 w-3.5 mr-1" /> Stop
          </Button>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3">
        {[
          ["Enqueued", p.enqueuedCount],
          ["Dialed", p.dialedCount],
          ["Failed", p.failedCount],
        ].map(([label, val]) => (
          <div key={String(label)} className="rounded-lg border border-border/50 px-3 py-2">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
            <p className="text-lg font-semibold tabular-nums">{val}</p>
          </div>
        ))}
      </div>

      <div>
        <p className="text-xs text-muted-foreground mb-2">
          Cursor row {p.cursorRowIndex}
          {p.lastPolledAt ? ` · last poll ${new Date(p.lastPolledAt).toLocaleString()}` : ""}
        </p>
        <div className="rounded-xl border border-border/60 overflow-hidden">
          <div className="px-3 py-2 border-b border-border/50 text-xs font-medium">Recent activity</div>
          {rows.length === 0 ? (
            <p className="px-3 py-6 text-xs text-muted-foreground text-center">No rows processed yet</p>
          ) : (
            <ul className="divide-y divide-border/40">
              {rows.map((r) => (
                <li key={r.id} className="px-3 py-2 flex items-center gap-3 text-xs">
                  <span className="text-muted-foreground w-12 shrink-0">Row {r.sheetRowIndex}</span>
                  <span className="font-mono truncate flex-1">{r.phoneNormalized || "—"}</span>
                  <span className="capitalize text-muted-foreground shrink-0">{r.status}</span>
                  {r.error && (
                    <span className="text-amber-600 dark:text-amber-400 truncate max-w-[220px]" title={r.error}>
                      {r.error}
                    </span>
                  )}
                  {r.callId != null && (
                    <Link href={`/app/calls/${r.callId}`} className="text-foreground underline-offset-2 hover:underline">
                      Call #{r.callId}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
