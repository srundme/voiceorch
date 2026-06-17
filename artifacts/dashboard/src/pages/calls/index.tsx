import { useState, useMemo } from "react";
import { Link, useLocation } from "wouter";
import { format, parseISO } from "date-fns";
import {
  Search, Phone, Mic, Cpu, Volume2, DollarSign, ArrowRight,
  Filter, Calendar, Headphones, BarChart3, Download, X,
  ChevronDown, ChevronUp, RefreshCw, Clock, AlertTriangle,
  CheckCircle2, PauseCircle, PlayCircle, XCircle, Voicemail,
  UserCheck, Users, Hash, TrendingUp, Activity
} from "lucide-react";
import {
  useListCalls,
  getListCallsQueryKey,
  useListAgents,
  getListAgentsQueryKey,
} from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { Card, CardContent } from "@/components/ui/card";

/* ── Types ───────────────────────────────────────────────────────────────── */

type CallStatus = "completed" | "failed" | "in_progress" | "pending" | "cancelled" | "transferred" | "booked" | "callback_scheduled" | "voicemail";

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
  const configs: Record<string, { label: string; icon: React.ReactNode; variant: string; bg: string; text: string; border: string; dot: string }> = {
    completed: {
      label: "Completed",
      icon: <CheckCircle2 className="h-3 w-3" />,
      variant: "default",
      bg: "bg-emerald-500/10",
      text: "text-emerald-600 dark:text-emerald-400",
      border: "border-emerald-500/20",
      dot: "bg-emerald-500",
    },
    failed: {
      label: "Failed",
      icon: <XCircle className="h-3 w-3" />,
      variant: "destructive",
      bg: "bg-red-500/10",
      text: "text-red-600 dark:text-red-400",
      border: "border-red-500/20",
      dot: "bg-red-500",
    },
    in_progress: {
      label: "In Progress",
      icon: <PlayCircle className="h-3 w-3" />,
      variant: "secondary",
      bg: "bg-blue-500/10",
      text: "text-blue-600 dark:text-blue-400",
      border: "border-blue-500/20",
      dot: "bg-blue-500 animate-pulse",
    },
    pending: {
      label: "Pending",
      icon: <PauseCircle className="h-3 w-3" />,
      variant: "outline",
      bg: "bg-muted/50",
      text: "text-muted-foreground",
      border: "border-border",
      dot: "bg-muted-foreground/40",
    },
    cancelled: {
      label: "Cancelled",
      icon: <X className="h-3 w-3" />,
      variant: "outline",
      bg: "bg-muted/30",
      text: "text-muted-foreground/60",
      border: "border-border",
      dot: "bg-muted-foreground/20",
    },
    transferred: {
      label: "Transferred",
      icon: <UserCheck className="h-3 w-3" />,
      variant: "default",
      bg: "bg-amber-500/10",
      text: "text-amber-600 dark:text-amber-400",
      border: "border-amber-500/20",
      dot: "bg-amber-500",
    },
    booked: {
      label: "Booked",
      icon: <Calendar className="h-3 w-3" />,
      variant: "default",
      bg: "bg-violet-500/10",
      text: "text-violet-600 dark:text-violet-400",
      border: "border-violet-500/20",
      dot: "bg-violet-500",
    },
    callback_scheduled: {
      label: "Callback",
      icon: <Clock className="h-3 w-3" />,
      variant: "default",
      bg: "bg-orange-500/10",
      text: "text-orange-600 dark:text-orange-400",
      border: "border-orange-500/20",
      dot: "bg-orange-500",
    },
    voicemail: {
      label: "Voicemail",
      icon: <Voicemail className="h-3 w-3" />,
      variant: "outline",
      bg: "bg-muted/50",
      text: "text-muted-foreground",
      border: "border-border",
      dot: "bg-muted-foreground/40",
    },
  };

  const cfg = configs[status] ?? configs.pending;

  return (
    <span className={`inline-flex items-center gap-1.5 text-[10px] font-semibold px-2.5 py-1 rounded-md border ${cfg.bg} ${cfg.text} ${cfg.border}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

function LatencyBar({ value, max, label, color }: { value: number; max: number; label: string; color: string }) {
  const pct = Math.min((value / max) * 100, 100);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex items-center gap-1.5 cursor-default">
          <span className="text-[9px] text-muted-foreground/50 w-6">{label}</span>
          <div className="h-1.5 w-16 bg-muted rounded-full overflow-hidden">
            <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
          </div>
          <span className="text-[10px] font-mono text-muted-foreground/50">{formatMs(value)}</span>
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        {label} latency: {formatMs(value)}
      </TooltipContent>
    </Tooltip>
  );
}

/* ── Mini Stat Card ──────────────────────────────────────────────────────── */
function MiniStat({ label, value, icon, trend }: { label: string; value: string; icon: React.ReactNode; trend?: string }) {
  return (
    <Card className="border-0 shadow-none bg-transparent hover:bg-elevated/30 transition-colors">
      <CardContent className="p-3 flex items-center gap-3">
        <div className="h-8 w-8 rounded-lg bg-elevated border border-border flex items-center justify-center shrink-0">
          {icon}
        </div>
        <div>
          <p className="text-[10px] text-muted-foreground/50 uppercase tracking-wider">{label}</p>
          <div className="flex items-center gap-1.5">
            <p className="text-sm font-semibold text-foreground">{value}</p>
            {trend && (
              <span className="text-[10px] text-emerald-500 flex items-center gap-0.5">
                <TrendingUp className="h-3 w-3" />{trend}
              </span>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}


/* ── Page ────────────────────────────────────────────────────────────────── */
export default function CallsList() {
  const [, navigate] = useLocation();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [agentFilter, setAgentFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [showFilters, setShowFilters] = useState(false);

  const { data: calls, isLoading: callsLoading } = useListCalls(
    {
      status: statusFilter !== "all" ? statusFilter : undefined,
      agentId: agentFilter !== "all" ? parseInt(agentFilter) : undefined,
    },
    {
      query: {
        queryKey: getListCallsQueryKey({
          status: statusFilter !== "all" ? statusFilter : undefined,
          agentId: agentFilter !== "all" ? parseInt(agentFilter) : undefined,
        }),
      },
    }
  );

  const { data: agents } = useListAgents({
    query: { queryKey: getListAgentsQueryKey() },
  });

  // Client-side search filter
  const filteredCalls = useMemo(() => {
    if (!calls) return [];
    let result = [...calls];

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (c) =>
          c.toNumber?.toLowerCase().includes(q) ||
          c.fromNumber?.toLowerCase().includes(q) ||
          c.agentName?.toLowerCase().includes(q) ||
          String(c.id).includes(q)
      );
    }

    if (dateFrom) {
      const from = new Date(dateFrom);
      result = result.filter((c) => new Date(c.createdAt) >= from);
    }
    if (dateTo) {
      const to = new Date(dateTo);
      to.setHours(23, 59, 59);
      result = result.filter((c) => new Date(c.createdAt) <= to);
    }

    return result;
  }, [calls, searchQuery, dateFrom, dateTo]);

  // Compute stats
  const stats = useMemo(() => {
    if (!filteredCalls.length) return null;
    const total = filteredCalls.length;
    const completed = filteredCalls.filter((c) => c.status === "completed").length;
    const failed = filteredCalls.filter((c) => c.status === "failed").length;
    const inProgress = filteredCalls.filter((c) => c.status === "in_progress").length;
    const avgDuration =
      total > 0
        ? Math.round(
            filteredCalls.reduce((sum, c) => sum + (c.durationSeconds ?? 0), 0) / total
          )
        : 0;
    return { total, completed, failed, inProgress, avgDuration };
  }, [filteredCalls]);

  const clearFilters = () => {
    setStatusFilter("all");
    setAgentFilter("all");
    setSearchQuery("");
    setDateFrom("");
    setDateTo("");
  };

  const handleExport = () => {
    if (!filteredCalls.length) return;
    const headers = ["ID","Execution ID","Date","Agent","Status","From","To","Duration (s)","Cost ($)"];
    const rows = filteredCalls.map(c => [
      c.id,
      c.executionId ?? "",
      c.createdAt ? format(parseISO(c.createdAt), "yyyy-MM-dd HH:mm:ss") : "",
      c.agentName ?? "",
      c.status ?? "",
      c.fromNumber ?? "",
      c.toNumber ?? "",
      c.durationSeconds ?? "",
      c.costCents != null ? (c.costCents / 100).toFixed(3) : "",
    ]);
    const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `call-log-${format(new Date(), "yyyy-MM-dd")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const hasActiveFilters =
    statusFilter !== "all" ||
    agentFilter !== "all" ||
    searchQuery.trim() ||
    dateFrom ||
    dateTo;

  return (
    <TooltipProvider>
      <div className="flex-1 flex flex-col h-full overflow-hidden animate-fade-in">
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-border shrink-0">
          <div className="flex items-start justify-between mb-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <div className="h-6 w-6 rounded-md bg-primary/10 flex items-center justify-center">
                  <Headphones className="h-3.5 w-3.5 text-primary/70" />
                </div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/50">
                  Voice Operations
                </p>
              </div>
              <h1 className="text-xl font-semibold tracking-tight text-foreground leading-none">
                Call Log
              </h1>
              <p className="text-xs mt-1 text-muted-foreground/60">
                Complete history of voice interactions with AI agents
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={handleExport} disabled={!filteredCalls.length}>
                <Download className="h-3.5 w-3.5" /> Export
              </Button>
              <Button size="sm" className="h-8 text-xs gap-1.5" onClick={() => navigate("/app/analytics")}>
                <BarChart3 className="h-3.5 w-3.5" /> Analytics
              </Button>
            </div>
          </div>

          {/* Stats Row */}
          {stats && (
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-2 mb-4">
              <MiniStat
                label="Total Calls"
                value={String(stats.total)}
                icon={<Phone className="h-3.5 w-3.5 text-muted-foreground/50" />}
              />
              <MiniStat
                label="Completed"
                value={String(stats.completed)}
                icon={<CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />}
              />
              <MiniStat
                label="Failed"
                value={String(stats.failed)}
                icon={<AlertTriangle className="h-3.5 w-3.5 text-red-500" />}
              />
              <MiniStat
                label="In Progress"
                value={String(stats.inProgress)}
                icon={<Activity className="h-3.5 w-3.5 text-blue-500" />}
              />
              <MiniStat
                label="Avg Duration"
                value={formatDuration(stats.avgDuration)}
                icon={<Clock className="h-3.5 w-3.5 text-muted-foreground/50" />}
              />
            </div>
          )}

          {/* Filters Bar */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 max-w-xs min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/40" />
              <Input
                type="search"
                placeholder="Search by number, agent, ID…"
                className="pl-9 h-8 text-xs"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2"
                >
                  <X className="h-3 w-3 text-muted-foreground/40 hover:text-muted-foreground" />
                </button>
              )}
            </div>

            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[140px] h-8 text-xs">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
                <SelectItem value="in_progress">In Progress</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
                <SelectItem value="transferred">Transferred</SelectItem>
                <SelectItem value="booked">Booked</SelectItem>
                <SelectItem value="callback_scheduled">Callback</SelectItem>
                <SelectItem value="voicemail">Voicemail</SelectItem>
              </SelectContent>
            </Select>

            <Select value={agentFilter} onValueChange={setAgentFilter}>
              <SelectTrigger className="w-[160px] h-8 text-xs">
                <SelectValue placeholder="All agents" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All agents</SelectItem>
                {agents?.map((agent) => (
                  <SelectItem key={agent.id} value={agent.id.toString()}>
                    {agent.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5">
                  <Calendar className="h-3.5 w-3.5" /> Date Range
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80 p-4">
                <div className="space-y-3">
                  <p className="text-xs font-semibold">Date Range</p>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] text-muted-foreground/60 mb-1 block">From</label>
                      <Input
                        type="date"
                        className="h-8 text-xs"
                        value={dateFrom}
                        onChange={(e) => setDateFrom(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-muted-foreground/60 mb-1 block">To</label>
                      <Input
                        type="date"
                        className="h-8 text-xs"
                        value={dateTo}
                        onChange={(e) => setDateTo(e.target.value)}
                      />
                    </div>
                  </div>
                </div>
              </PopoverContent>
            </Popover>

            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs text-muted-foreground hover:text-foreground"
                onClick={clearFilters}
              >
                <RefreshCw className="h-3 w-3 mr-1" /> Clear
              </Button>
            )}

            <div className="ml-auto text-[10px] text-muted-foreground/40">
              {filteredCalls.length} call{filteredCalls.length !== 1 ? "s" : ""}
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-auto px-6">
          <div className="overflow-x-auto">
          <Table>
            <TableHeader className="sticky top-0 z-10">
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[50px]">
                  <Hash className="h-3 w-3 text-muted-foreground/30" />
                </TableHead>
                <TableHead className="w-[130px]">Date & Time</TableHead>
                <TableHead className="w-[90px]">Exec ID</TableHead>
                <TableHead>Agent</TableHead>
                <TableHead className="w-[110px]">Status</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead className="w-[80px]">Duration</TableHead>
                <TableHead className="w-[140px]">Latency</TableHead>
                <TableHead className="w-[70px]">Cost</TableHead>
                <TableHead className="w-[80px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {callsLoading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-3 w-6" /></TableCell>
                    <TableCell><Skeleton className="h-3 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-3 w-16" /></TableCell>
                    <TableCell><Skeleton className="h-3 w-28" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-20 rounded-md" /></TableCell>
                    <TableCell><Skeleton className="h-3 w-28" /></TableCell>
                    <TableCell><Skeleton className="h-3 w-10" /></TableCell>
                    <TableCell><Skeleton className="h-3 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-3 w-10" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="h-7 w-14 ml-auto rounded-lg" /></TableCell>
                  </TableRow>
                ))
              ) : filteredCalls.length > 0 ? (
                filteredCalls.map((call, idx) => {
                  const sttMs = call.sttLatencyMs;
                  const llmMs = call.llmLatencyMs;
                  const ttsMs = call.ttsFirstChunkMs;
                  const hasLatency =
                    sttMs != null || llmMs != null || ttsMs != null;
                  const maxLatency = Math.max(sttMs ?? 0, llmMs ?? 0, ttsMs ?? 0, 1);
                  const costCents = (call as any).costCents ?? 0;

                  return (
                    <TableRow key={call.id} className="group cursor-default">
                      <TableCell className="text-[10px] font-mono text-muted-foreground/30">
                        {idx + 1}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <div className="text-[11px] text-foreground/80 font-medium">
                          {format(parseISO(call.createdAt), "MMM d, yyyy")}
                        </div>
                        <div className="text-[10px] text-muted-foreground/40 font-mono">
                          {format(parseISO(call.createdAt), "HH:mm:ss")}
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-[10px] text-muted-foreground/40">
                        {(call as any).executionId ?? `#${call.id}`}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="h-6 w-6 rounded-md bg-elevated border border-border flex items-center justify-center shrink-0">
                            <Users className="h-3 w-3 text-muted-foreground/40" />
                          </div>
                          <span className="text-xs font-medium text-foreground/80">
                            {call.agentName}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={call.status} />
                      </TableCell>
                      <TableCell>
                        {/* disposition chips placeholder — awaiting full feature */}
                        {null}
                      </TableCell>
                      <TableCell>
                        <div className="text-xs font-mono text-foreground/70">
                          {call.toNumber}
                        </div>
                        <div className="text-[10px] font-mono text-muted-foreground/40">
                          {call.fromNumber}
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground/60">
                        {formatDuration(call.durationSeconds)}
                      </TableCell>
                      <TableCell>
                        {hasLatency ? (
                          <div className="flex flex-col gap-0.5">
                            {sttMs != null && (
                              <LatencyBar
                                value={sttMs}
                                max={maxLatency}
                                label="STT"
                                color="bg-blue-500"
                              />
                            )}
                            {llmMs != null && (
                              <LatencyBar
                                value={llmMs}
                                max={maxLatency}
                                label="LLM"
                                color="bg-violet-500"
                              />
                            )}
                            {ttsMs != null && (
                              <LatencyBar
                                value={ttsMs}
                                max={maxLatency}
                                label="TTS"
                                color="bg-emerald-500"
                              />
                            )}
                          </div>
                        ) : (
                          <span className="text-muted-foreground/25 text-[10px]">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-0.5">
                          {costCents > 0 ? (
                            <span className="flex items-center gap-0.5 text-[10px] font-mono text-muted-foreground/50">
                              <DollarSign className="h-2.5 w-2.5" />
                              {(costCents / 100).toFixed(3)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground/25 text-[10px]">—</span>
                          )}
                          {((call as any).tokensSaved ?? 0) > 0 && (
                            <span className="inline-flex items-center gap-0.5 text-[9px] font-medium px-1 rounded bg-amber-500/15 text-amber-400">
                              ↓{((call as any).tokensSaved as number).toLocaleString()} tok saved
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Link href={`/app/calls/${call.id}`}>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-[11px] text-muted-foreground/60 hover:text-foreground gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            View <ArrowRight className="h-3 w-3" />
                          </Button>
                        </Link>
                      </TableCell>
                    </TableRow>
                  );
                })
              ) : (
                <TableRow>
                  <TableCell colSpan={10} className="h-64 text-center border-0">
                    <div className="flex flex-col items-center justify-center gap-3 text-muted-foreground/30">
                      <div className="h-12 w-12 rounded-2xl bg-elevated border border-border flex items-center justify-center">
                        <Phone className="h-6 w-6" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-foreground/40">
                          No calls found
                        </p>
                        <p className="text-xs text-muted-foreground/30 mt-0.5">
                          {hasActiveFilters
                            ? "Try adjusting your filters"
                            : "Calls will appear once your agents start making them"}
                        </p>
                      </div>
                      {hasActiveFilters && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs mt-1"
                          onClick={clearFilters}
                        >
                          <RefreshCw className="h-3 w-3 mr-1" /> Clear Filters
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
