import { useState } from "react";
import { Link } from "wouter";
import {
  ChevronDown, ChevronUp, AlertTriangle, ExternalLink,
  Clock, DollarSign, PhoneOff, Voicemail, ChevronLeft, ChevronRight,
} from "lucide-react";
import {
  useGetAgentSnapserveExecutions,
  getGetAgentSnapserveExecutionsQueryKey,
} from "@workspace/api-client-react";
import type { SnapServeExecution } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { format, parseISO } from "date-fns";

function fmtDuration(secs?: number | null) {
  if (!secs) return "—";
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function fmtCost(cost?: number | null) {
  if (cost == null) return "—";
  return `$${cost.toFixed(4)}`;
}

function fmtDate(s?: string | null) {
  if (!s) return "—";
  try { return format(parseISO(s), "MMM d, yyyy HH:mm:ss"); } catch { return s; }
}

function CostBreakdownRow({ cb }: { cb: SnapServeExecution["cost_breakdown"] }) {
  if (!cb) return null;
  const items: Array<{ label: string; val: number | null | undefined }> = [
    { label: "LLM",         val: cb.llm },
    { label: "Transcriber", val: cb.transcriber },
    { label: "Synthesizer", val: cb.synthesizer },
    { label: "Network",     val: cb.network },
    { label: "Platform",    val: cb.platform },
  ];
  return (
    <div className="flex flex-wrap gap-3 mt-2">
      {items.map(({ label, val }) => (
        <div key={label} className="flex flex-col items-center px-3 py-1.5 rounded-md bg-elevated/50 border border-border/60 min-w-[70px]">
          <span className="text-[9px] text-muted-foreground uppercase tracking-wider">{label}</span>
          <span className="text-xs font-mono font-semibold">{val != null ? `$${val.toFixed(5)}` : "—"}</span>
        </div>
      ))}
    </div>
  );
}

function TelephonyGrid({ td }: { td: SnapServeExecution["telephony_data"] }) {
  if (!td) return null;
  const items: Array<{ label: string; val: string | number | boolean | null | undefined }> = [
    { label: "To",               val: td.to_number },
    { label: "From",             val: td.from_number },
    { label: "Duration",         val: td.duration != null ? fmtDuration(td.duration) : null },
    { label: "Hangup by",        val: td.hangup_by },
    { label: "Hangup reason",    val: td.hangup_reason },
    { label: "Hangup code",      val: td.hangup_provider_code },
    { label: "Provider call ID", val: td.provider_call_id },
    { label: "Hosted telephony", val: td.hosted_telephony != null ? (td.hosted_telephony ? "Yes" : "No") : null },
  ];
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-2">
      {items.map(({ label, val }) => val != null ? (
        <div key={label} className="flex justify-between text-xs py-0.5">
          <span className="text-muted-foreground">{label}</span>
          <span className="font-mono text-foreground/80 text-right max-w-[160px] truncate" title={String(val)}>{String(val)}</span>
        </div>
      ) : null)}
      {td.recording_url && (
        <div className="col-span-2 flex items-center gap-1.5 text-xs py-0.5">
          <span className="text-muted-foreground">Recording</span>
          <a href={td.recording_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-0.5">
            Open <ExternalLink className="h-2.5 w-2.5" />
          </a>
        </div>
      )}
    </div>
  );
}

function ExecutionRow({ exec }: { exec: SnapServeExecution }) {
  const [expanded, setExpanded] = useState(false);
  const hasDetails = exec.cost_breakdown || exec.telephony_data || exec.transcript;

  return (
    <>
      <tr className="border-b border-border hover:bg-elevated/20 transition-colors">
        <td className="px-4 py-3 text-xs font-mono text-muted-foreground whitespace-nowrap">
          {fmtDate(exec.created_at)}
        </td>
        <td className="px-4 py-3 text-xs font-mono">
          {fmtDuration(exec.conversation_duration)}
        </td>
        <td className="px-4 py-3 text-xs font-mono">
          {fmtCost(exec.total_cost)}
        </td>
        <td className="px-4 py-3 text-xs text-muted-foreground">
          {exec.telephony_data?.hangup_by ?? exec.error_message ?? "—"}
        </td>
        <td className="px-4 py-3 max-w-[200px]">
          {exec.transcript ? (
            <span className="text-[11px] text-muted-foreground/60 font-mono truncate block max-w-full" title={exec.transcript}>
              {exec.transcript.slice(0, 60)}{exec.transcript.length > 60 ? "…" : ""}
            </span>
          ) : (
            <span className="text-[10px] text-muted-foreground/30">—</span>
          )}
        </td>
        <td className="px-4 py-3">
          {exec.answered_by_voice_mail ? (
            <Badge variant="outline" className="text-[10px] gap-1 border-amber-500/30 text-amber-600">
              <Voicemail className="h-2.5 w-2.5" /> Voicemail
            </Badge>
          ) : (
            <span className="text-[10px] text-muted-foreground/40">—</span>
          )}
        </td>
        <td className="px-4 py-3">
          {hasDetails ? (
            <button
              onClick={() => setExpanded(v => !v)}
              className="flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
          ) : null}
        </td>
      </tr>
      {expanded && (
        <tr className="bg-elevated/10 border-b border-border">
          <td colSpan={7} className="px-5 py-4">
            {exec.cost_breakdown && (
              <div className="mb-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-1">
                  Cost Breakdown
                </p>
                <CostBreakdownRow cb={exec.cost_breakdown} />
              </div>
            )}
            {exec.telephony_data && (
              <div className="mb-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-1">
                  Telephony Data
                </p>
                <TelephonyGrid td={exec.telephony_data} />
              </div>
            )}
            {exec.transcript && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-1">
                  Transcript
                </p>
                <pre className="text-[11px] font-mono text-foreground/70 whitespace-pre-wrap leading-relaxed bg-background border border-border rounded p-3 max-h-60 overflow-auto">
                  {exec.transcript}
                </pre>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

interface SnapServeExecutionsPanelProps {
  agentId: number | undefined;
}

export function SnapServeExecutionsPanel({ agentId }: SnapServeExecutionsPanelProps) {
  const [pageNumber, setPageNumber] = useState(1);
  const pageSize = 20;

  const { data, isLoading, isError, error } = useGetAgentSnapserveExecutions(
    agentId!,
    { page_number: pageNumber, page_size: pageSize },
    {
      query: {
        enabled: !!agentId,
        queryKey: getGetAgentSnapserveExecutionsQueryKey(agentId!, { page_number: pageNumber, page_size: pageSize }),
        retry: false,
      },
    }
  );

  if (!agentId) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center py-16 px-4">
        <PhoneOff className="h-8 w-8 text-muted-foreground/20 mb-3" />
        <p className="text-sm text-foreground/40">No agent linked to this call</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="p-4 space-y-2">
        {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-10 w-full" />)}
      </div>
    );
  }

  if (isError) {
    const errMsg = (error as any)?.response?.data?.error ?? (error as any)?.message ?? "Unknown error";
    const is404 = (error as any)?.response?.status === 404;

    if (is404) {
      const isMissingKey = errMsg.includes("No active SnapServe");
      return (
        <div className="flex flex-col items-center justify-center h-full text-center py-16 px-6">
          <div className="h-10 w-10 rounded-xl bg-elevated border border-border flex items-center justify-center mb-3">
            <PhoneOff className="h-5 w-5 text-muted-foreground/30" />
          </div>
          <p className="text-sm text-foreground/50 font-medium mb-1">
            {isMissingKey ? "SnapServe API key not found" : "SnapServe Agent ID not configured"}
          </p>
          <p className="text-xs text-muted-foreground/40 max-w-xs leading-relaxed mb-4">
            {isMissingKey
              ? "Add a SnapServe API key on the Providers page under the Orchestration group."
              : "Set the SnapServe Agent ID on the agent's edit page to enable execution history."}
          </p>
          {isMissingKey ? (
            <Link href="/app/providers">
              <Button size="sm" variant="outline" className="gap-1.5 text-xs">
                <ExternalLink className="h-3 w-3" /> Go to Providers
              </Button>
            </Link>
          ) : (
            <Link href={`/app/agents/${agentId}/edit`}>
              <Button size="sm" variant="outline" className="gap-1.5 text-xs">
                <ExternalLink className="h-3 w-3" /> Configure SnapServe Agent ID
              </Button>
            </Link>
          )}
        </div>
      );
    }

    const httpStatus = (error as any)?.response?.status as number | undefined;
    return (
      <div className="m-4 p-3 bg-red-500/5 border border-red-500/10 rounded-lg flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-red-500" />
        <div>
          <p className="text-xs font-semibold text-red-600">
            Failed to load SnapServe executions{httpStatus ? ` (HTTP ${httpStatus})` : ""}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">{errMsg}</p>
        </div>
      </div>
    );
  }

  const executions = data?.data ?? [];

  if (executions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center py-16">
        <Clock className="h-8 w-8 text-muted-foreground/20 mb-3" />
        <p className="text-sm text-foreground/40">No executions found</p>
        <p className="text-xs text-muted-foreground/30 mt-1">Executions will appear here after calls are made through SnapServe</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-1 overflow-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-border bg-elevated/30 sticky top-0 z-10">
              <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">Time</th>
              <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 w-24">Duration</th>
              <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 w-24">Cost</th>
              <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">Hangup By</th>
              <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">Transcript Preview</th>
              <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 w-28">Voicemail</th>
              <th className="px-4 py-2.5 w-10"></th>
            </tr>
          </thead>
          <tbody>
            {executions.map((exec) => (
              <ExecutionRow key={exec.id ?? exec.created_at} exec={exec} />
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="shrink-0 border-t border-border px-4 py-2.5 flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground/50">
          Page {data?.page_number ?? pageNumber}
          {data?.total != null ? ` of ${Math.ceil(data.total / pageSize)}` : ""}
        </span>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="outline"
            className="h-7 w-7 p-0"
            disabled={pageNumber <= 1}
            onClick={() => setPageNumber(p => Math.max(1, p - 1))}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 w-7 p-0"
            disabled={!data?.has_more}
            onClick={() => setPageNumber(p => p + 1)}
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
