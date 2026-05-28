import React, { useState } from "react";
import { Link } from "wouter";
import { format, parseISO } from "date-fns";
import { Search, Phone, Mic, Cpu, Volume2, DollarSign } from "lucide-react";
import {
  useListCalls,
  getListCallsQueryKey,
  useListAgents,
  getListAgentsQueryKey
} from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";

/* ── Helpers ─────────────────────────────────────────────────────────────── */
const formatDuration = (seconds?: number | null) => {
  if (!seconds) return "—";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
};

const formatMs = (ms?: number | null) => {
  if (ms == null) return null;
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
};

function StatusBadge({ status }: { status: string }) {
  const base = "inline-flex items-center gap-1.5 text-[10px] font-semibold px-2 py-0.5 rounded-md border";
  const map: Record<string, string> = {
    completed:   "bg-foreground/[0.06] text-foreground/60 border-foreground/[0.07]",
    failed:      "bg-foreground/[0.03] text-muted-foreground border-foreground/[0.05]",
    in_progress: "bg-foreground/[0.07] text-foreground/70 border-foreground/[0.08]",
    pending:     "bg-transparent text-muted-foreground/50 border-border",
    cancelled:   "bg-transparent text-muted-foreground/40 border-border",
  };
  const dotMap: Record<string, string> = {
    completed:   "bg-foreground/30",
    failed:      "bg-foreground/12",
    in_progress: "bg-foreground/25 animate-pulse",
    pending:     "bg-foreground/10",
    cancelled:   "bg-foreground/8",
  };
  return (
    <span className={`${base} ${map[status] ?? map.pending}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dotMap[status] ?? dotMap.pending}`} />
      {status.replace("_", " ")}
    </span>
  );
}

/* ── Page ────────────────────────────────────────────────────────────────── */
export default function CallsList() {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [agentFilter,  setAgentFilter]  = useState<string>("all");

  const { data: calls, isLoading: callsLoading } = useListCalls(
    {
      status:  statusFilter !== "all" ? statusFilter : undefined,
      agentId: agentFilter  !== "all" ? parseInt(agentFilter) : undefined,
    },
    { query: { queryKey: getListCallsQueryKey({ status: statusFilter !== "all" ? statusFilter : undefined, agentId: agentFilter !== "all" ? parseInt(agentFilter) : undefined }) } }
  );

  const { data: agents } = useListAgents({ query: { queryKey: getListAgentsQueryKey() } });

  return (
    <TooltipProvider>
    <div className="flex-1 flex flex-col h-full overflow-hidden animate-fade-in">

      {/* Header */}
      <div className="px-8 pt-7 pb-5 border-b border-border shrink-0">
        <div className="flex items-end justify-between mb-5">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/50 mb-1.5">Observe</p>
            <h1 className="text-[22px] font-semibold tracking-tight text-foreground leading-none">Call Log</h1>
            <p className="text-[12.5px] mt-1.5 text-muted-foreground/60">Complete history of voice interactions.</p>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 max-w-xs min-w-[180px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/40" />
            <Input type="search" placeholder="Search numbers…" className="pl-9 h-9 text-[12.5px]" />
          </div>

          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[155px] h-9">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
              <SelectItem value="in_progress">In Progress</SelectItem>
            </SelectContent>
          </Select>

          <Select value={agentFilter} onValueChange={setAgentFilter}>
            <SelectTrigger className="w-[180px] h-9">
              <SelectValue placeholder="All agents" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All agents</SelectItem>
              {agents?.map(agent => (
                <SelectItem key={agent.id} value={agent.id.toString()}>{agent.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <Table>
          <TableHeader className="sticky top-0 z-10">
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-[140px]">Date</TableHead>
              <TableHead className="w-[110px]">Exec ID</TableHead>
              <TableHead>Agent</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Number</TableHead>
              <TableHead>Duration</TableHead>
              <TableHead>
                <Tooltip>
                  <TooltipTrigger className="cursor-default">Latency</TooltipTrigger>
                  <TooltipContent side="top" className="text-xs max-w-[200px]">
                    <p className="mb-1 font-semibold">Per-call averages across all turns</p>
                    <p><span className="text-muted-foreground">STT</span> — speech-to-text round-trip</p>
                    <p><span className="text-muted-foreground">LLM</span> — time to first token</p>
                    <p><span className="text-muted-foreground">TTS</span> — time to first audio chunk</p>
                  </TooltipContent>
                </Tooltip>
              </TableHead>
              <TableHead>Cost</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {callsLoading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell><Skeleton className="h-3.5 w-24" /></TableCell>
                  <TableCell><Skeleton className="h-3.5 w-16" /></TableCell>
                  <TableCell><Skeleton className="h-3.5 w-28" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-20 rounded-md" /></TableCell>
                  <TableCell><Skeleton className="h-3.5 w-28" /></TableCell>
                  <TableCell><Skeleton className="h-3.5 w-10" /></TableCell>
                  <TableCell><Skeleton className="h-3.5 w-24" /></TableCell>
                  <TableCell><Skeleton className="h-3.5 w-10" /></TableCell>
                  <TableCell className="text-right"><Skeleton className="h-7 w-14 ml-auto rounded-lg" /></TableCell>
                </TableRow>
              ))
            ) : calls && calls.length > 0 ? (
              calls.map((call) => {
                const sttMs = formatMs(call.sttLatencyMs);
                const llmMs = formatMs(call.llmLatencyMs);
                const ttsMs = formatMs(call.ttsFirstChunkMs);
                const hasLatency = sttMs || llmMs || ttsMs;

                return (
                  <TableRow key={call.id} className="cursor-default">
                    <TableCell className="whitespace-nowrap text-muted-foreground/60 text-[11px] font-mono">
                      {format(parseISO(call.createdAt), "MMM d, HH:mm")}
                    </TableCell>
                    <TableCell className="font-mono text-[11px] text-muted-foreground/40">
                      {(call as any).executionId ?? `#${call.id}`}
                    </TableCell>
                    <TableCell>
                      <span className="text-[12.5px] font-medium text-foreground/80">{call.agentName}</span>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={call.status} />
                    </TableCell>
                    <TableCell>
                      <div className="text-[12px] font-mono text-foreground/70">{call.toNumber}</div>
                      <div className="text-[11px] font-mono text-muted-foreground/40">{call.fromNumber}</div>
                    </TableCell>
                    <TableCell className="font-mono text-[12px] text-muted-foreground/60">
                      {formatDuration(call.durationSeconds)}
                    </TableCell>
                    <TableCell>
                      {hasLatency ? (
                        <div className="flex items-center gap-2 text-[11px] font-mono text-muted-foreground/50">
                          {sttMs && (
                            <Tooltip>
                              <TooltipTrigger>
                                <span className="flex items-center gap-0.5"><Mic className="h-2.5 w-2.5" />{sttMs}</span>
                              </TooltipTrigger>
                              <TooltipContent>STT latency</TooltipContent>
                            </Tooltip>
                          )}
                          {llmMs && (
                            <Tooltip>
                              <TooltipTrigger>
                                <span className="flex items-center gap-0.5"><Cpu className="h-2.5 w-2.5" />{llmMs}</span>
                              </TooltipTrigger>
                              <TooltipContent>LLM first-token</TooltipContent>
                            </Tooltip>
                          )}
                          {ttsMs && (
                            <Tooltip>
                              <TooltipTrigger>
                                <span className="flex items-center gap-0.5"><Volume2 className="h-2.5 w-2.5" />{ttsMs}</span>
                              </TooltipTrigger>
                              <TooltipContent>TTS first-audio</TooltipContent>
                            </Tooltip>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted-foreground/25 text-[11px]">—</span>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-[11px]">
                      {(call as any).costCents != null && (call as any).costCents > 0 ? (
                        <span className="flex items-center gap-0.5 text-muted-foreground/50">
                          <DollarSign className="h-2.5 w-2.5" />
                          {((call as any).costCents / 100).toFixed(3)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground/25">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Link href={`/app/calls/${call.id}`}>
                        <button className="text-[11.5px] font-medium text-muted-foreground/60 hover:text-foreground border border-border rounded-lg px-3 py-1.5 hover:bg-accent transition-colors">
                          View
                        </button>
                      </Link>
                    </TableCell>
                  </TableRow>
                );
              })
            ) : (
              <TableRow>
                <TableCell colSpan={9} className="h-64 text-center border-0">
                  <div className="flex flex-col items-center justify-center gap-3 text-muted-foreground/30">
                    <Phone className="h-8 w-8" />
                    <p className="text-[12px]">No calls found</p>
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
    </TooltipProvider>
  );
}
