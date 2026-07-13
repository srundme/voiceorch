import { useState, useMemo, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useScrollRestoration } from "@/lib/use-scroll-restoration";
import { getExecutionId } from "@/lib/execution-id";
import { format, parseISO } from "date-fns";
import {
  Search, Phone, Mic, Cpu, Volume2, DollarSign,
  Filter, Calendar, Headphones, Download, X,
  ChevronDown, ChevronUp, ChevronLeft, ChevronRight, RefreshCw, Clock, AlertTriangle,
  CheckCircle2, PauseCircle, PlayCircle, XCircle, Voicemail,
  UserCheck, Users, TrendingUp, Globe, Eye,
  PhoneOff, PhoneMissed, Megaphone, ArrowUpRight, ArrowDownLeft,
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
import { CallDetailDrawer } from "@/components/call-detail-drawer";

/* ── Types ───────────────────────────────────────────────────────────────── */

type CallStatus = "completed" | "failed" | "ringing" | "in_progress" | "pending" | "cancelled" | "transferred" | "booked" | "callback_scheduled" | "voicemail" | "busy" | "no_pickup";

/* ── Helpers ─────────────────────────────────────────────────────────────── */
const formatDuration = (seconds?: number | null) => {
  if (!seconds) return "—";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
};

// Reserved meta keys in calls.dispositionResult that are NOT classification values.
const DISPOSITION_META_KEYS = new Set(["confidence", "summary"]);

/** Extract the human-readable disposition value(s) from a call's dispositionResult. */
function getDispositionValues(
  result: Record<string, string | number | boolean | null> | null | undefined,
): string[] {
  if (!result || typeof result !== "object") return [];
  return Object.entries(result)
    .filter(([k, v]) => !DISPOSITION_META_KEYS.has(k) && v != null && v !== "")
    .map(([, v]) => String(v));
}

function StatusBadge({ status }: { status: string }) {
  const configs: Record<string, { label: string; icon: React.ReactNode; variant: string; bg: string; text: string; border: string; dot: string }> = {
    ringing: {
      label: "Calling",
      icon: <Phone className="h-3 w-3" />,
      variant: "secondary",
      bg: "bg-amber-500/10",
      text: "text-amber-600 dark:text-amber-400",
      border: "border-amber-500/20",
      dot: "bg-amber-500 animate-pulse",
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
      bg: "bg-orange-500/10",
      text: "text-orange-600 dark:text-orange-400",
      border: "border-orange-500/20",
      dot: "bg-orange-500",
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
    busy: {
      label: "Busy",
      icon: <PhoneOff className="h-3 w-3" />,
      variant: "outline",
      bg: "bg-amber-500/10",
      text: "text-amber-600 dark:text-amber-400",
      border: "border-amber-500/20",
      dot: "bg-amber-500",
    },
    no_pickup: {
      label: "No Pickup",
      icon: <PhoneMissed className="h-3 w-3" />,
      variant: "outline",
      bg: "bg-muted/50",
      text: "text-muted-foreground",
      border: "border-border",
      dot: "bg-muted-foreground/40",
    },
  };

  const cfg = configs[status] ?? configs.pending;

  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-md border min-w-[100px] justify-center ${cfg.bg} ${cfg.text} ${cfg.border}`}>
      <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

/* ── Phone Cell ──────────────────────────────────────────────────────────── */
function PhoneCell({ number }: { number?: string | null }) {
  const [copied, setCopied] = useState(false);

  if (!number) return <span className="text-muted-foreground/25 text-[10px]">—</span>;

  const handleCopy = () => {
    navigator.clipboard.writeText(number).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={handleCopy}
          className="font-mono text-[11px] text-foreground/70 max-w-full truncate block hover:text-foreground transition-colors text-left"
        >
          {number}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        {copied ? "Copied!" : "Click to copy"}
      </TooltipContent>
    </Tooltip>
  );
}

/* ── Mini Stat Card ──────────────────────────────────────────────────────── */
function MiniStat({ label, value, icon, trend }: { label: string; value: string; icon: React.ReactNode; trend?: string }) {
  return (
    <Card className="h-full border border-border bg-elevated/40 shadow-sm hover:shadow-lg hover:-translate-y-1 hover:border-primary/40 transition-all duration-300">
      <CardContent className="h-full p-5 flex items-center gap-4">
        <div className="h-12 w-12 rounded-xl bg-elevated border border-border flex items-center justify-center shrink-0">
          {icon}
        </div>
        <div className="min-w-0">
          <p className="text-[11px] font-semibold text-muted-foreground/50 uppercase tracking-wider">{label}</p>
          <div className="flex items-center gap-1.5 mt-1">
            <p className="text-2xl font-bold text-foreground leading-tight tracking-tight">{value}</p>
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

  // Initialize filters/search/pagination from the URL so returning here via the
  // shared Back control (which uses history.back) restores the prior view.
  const initialParams = useMemo(() => new URLSearchParams(window.location.search), []);
  const [statusFilter, setStatusFilter] = useState<string>(() => initialParams.get("status") ?? "all");
  const [agentFilter, setAgentFilter] = useState<string>(() => initialParams.get("agent") ?? "all");
  const [searchQuery, setSearchQuery] = useState(() => initialParams.get("q") ?? "");
  const [dateFrom, setDateFrom] = useState(() => initialParams.get("from") ?? "");
  const [dateTo, setDateTo] = useState(() => initialParams.get("to") ?? "");
  const [sortBy, setSortBy] = useState<string>(() => initialParams.get("sort") ?? "newest");
  const [selectedCallId, setSelectedCallId] = useState<number | null>(null);
  const [currentPage, setCurrentPage] = useState(() => {
    const p = parseInt(initialParams.get("page") ?? "1", 10);
    return Number.isNaN(p) || p < 1 ? 1 : p;
  });
  const [pageInput, setPageInput] = useState("");
  const [pageSize, setPageSize] = useState(100);

  // Mirror filter/search/pagination state into the URL query string (replace, so
  // we don't spam history) so it can be restored on return.
  useEffect(() => {
    const params = new URLSearchParams();
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (agentFilter !== "all") params.set("agent", agentFilter);
    if (searchQuery.trim()) params.set("q", searchQuery);
    if (dateFrom) params.set("from", dateFrom);
    if (dateTo) params.set("to", dateTo);
    if (sortBy !== "newest") params.set("sort", sortBy);
    if (currentPage > 1) params.set("page", String(currentPage));
    const qs = params.toString();
    const next = qs ? `/app/calls?${qs}` : "/app/calls";
    const current = `/app/calls${window.location.search}`;
    if (next !== current) navigate(next, { replace: true });
  }, [statusFilter, agentFilter, searchQuery, dateFrom, dateTo, sortBy, currentPage, navigate]);

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
        // Poll fast when any call is live (ringing or in-progress) so status
        // transitions appear in real-time; slower interval when everything settled.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        refetchInterval: (query: any) =>
          (query.state.data as any[] | undefined)?.some((c: any) => c.status === "ringing" || c.status === "in_progress")
            ? 3_000
            : 15_000,
      },
    }
  );

  const { data: agents } = useListAgents({
    query: { queryKey: getListAgentsQueryKey() },
  });

  // Restore the table scroll position when returning to this list.
  const callsScrollRef = useScrollRestoration<HTMLDivElement>("calls-list", !callsLoading);

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

    const time = (c: (typeof result)[number]) => new Date(c.createdAt).getTime();
    const cost = (c: (typeof result)[number]) => c.costCents ?? 0;
    const dur = (c: (typeof result)[number]) => c.durationSeconds ?? 0;
    switch (sortBy) {
      case "oldest":
        result.sort((a, b) => time(a) - time(b));
        break;
      case "cost_high":
        result.sort((a, b) => cost(b) - cost(a));
        break;
      case "cost_low":
        result.sort((a, b) => cost(a) - cost(b));
        break;
      case "duration_high":
        result.sort((a, b) => dur(b) - dur(a));
        break;
      case "duration_low":
        result.sort((a, b) => dur(a) - dur(b));
        break;
      case "newest":
      default:
        result.sort((a, b) => time(b) - time(a));
        break;
    }

    return result;
  }, [calls, searchQuery, dateFrom, dateTo, sortBy]);

  // Reset to page 1 whenever any filter/search/sort changes — but NOT on the
  // initial mount, so a page restored from the URL survives.
  const filtersInitialized = useRef(false);
  useEffect(() => {
    if (!filtersInitialized.current) {
      filtersInitialized.current = true;
      return;
    }
    setCurrentPage(1);
  }, [statusFilter, agentFilter, searchQuery, dateFrom, dateTo, sortBy]);

  // Pagination math (page size configurable)
  const totalPages = Math.max(1, Math.ceil(filteredCalls.length / pageSize));
  const safePage = Math.min(Math.max(currentPage, 1), totalPages);
  const pagedCalls = useMemo(
    () => filteredCalls.slice((safePage - 1) * pageSize, safePage * pageSize),
    [filteredCalls, safePage, pageSize]
  );

  const goToPage = (page: number) => {
    if (Number.isNaN(page)) return;
    setCurrentPage(Math.min(Math.max(page, 1), totalPages));
  };

  const handleJumpToPage = () => {
    const parsed = parseInt(pageInput, 10);
    if (Number.isNaN(parsed)) {
      setPageInput("");
      return;
    }
    goToPage(parsed);
    setPageInput("");
  };

  // Compute stats
  const stats = useMemo(() => {
    if (!filteredCalls.length) return null;
    const total = filteredCalls.length;
    const completed = filteredCalls.filter((c) => c.status === "completed").length;
    const voicemail = filteredCalls.filter((c) => (c.status as string) === "voicemail").length;
    const failed = filteredCalls.filter((c) => c.status === "failed").length;
    const inProgress = filteredCalls.filter((c) => c.status === "in_progress").length;
    const avgDuration =
      total > 0
        ? Math.round(
            filteredCalls.reduce((sum, c) => sum + (c.durationSeconds ?? 0), 0) / total
          )
        : 0;
    return { total, completed, voicemail, failed, inProgress, avgDuration };
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
        <div className="px-8 pt-8 pb-6 border-b border-border shrink-0">
          <div className="flex items-start justify-between mb-6">
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <div className="h-6 w-6 rounded-md bg-primary/10 flex items-center justify-center">
                  <Headphones className="h-3.5 w-3.5 text-primary/70" />
                </div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/50">
                  Voice Operations
                </p>
              </div>
              <h1 className="text-3xl font-bold tracking-tight text-foreground leading-tight">
                Call Logs
              </h1>
              <p className="text-sm mt-2 text-muted-foreground/50">
                Complete history of voice interactions with AI agents
              </p>
            </div>
          </div>

          {/* Stats Row */}
          {stats && (
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mb-8">
              <MiniStat
                label="Total Calls"
                value={String(stats.total)}
                icon={<Phone className="h-4 w-4 text-muted-foreground/50" />}
              />
              <MiniStat
                label="Completed"
                value={String(stats.completed)}
                icon={<CheckCircle2 className="h-4 w-4 text-emerald-500" />}
              />
              <MiniStat
                label="Voicemail"
                value={String(stats.voicemail)}
                icon={<Voicemail className="h-4 w-4 text-violet-500" />}
              />
              <MiniStat
                label="Failed"
                value={String(stats.failed)}
                icon={<AlertTriangle className="h-4 w-4 text-red-500" />}
              />
              <MiniStat
                label="Avg Duration"
                value={formatDuration(stats.avgDuration)}
                icon={<Clock className="h-4 w-4 text-muted-foreground/50" />}
              />
            </div>
          )}

          {/* Filters Bar */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative shrink-0 w-full sm:w-[340px] lg:w-[420px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/40" />
              <Input
                type="search"
                placeholder="Search by number, agent, ID…"
                className="pl-9 h-9 text-xs"
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

            <div className="shrink-0">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[150px] h-9 text-xs">
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="ringing">Calling</SelectItem>
                  <SelectItem value="in_progress">In Progress</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                  <SelectItem value="transferred">Transferred</SelectItem>
                  <SelectItem value="booked">Booked</SelectItem>
                  <SelectItem value="callback_scheduled">Callback</SelectItem>
                  <SelectItem value="voicemail">Voicemail</SelectItem>
                  <SelectItem value="busy">Busy</SelectItem>
                  <SelectItem value="no_pickup">No Pickup</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="shrink-0">
              <Select value={agentFilter} onValueChange={setAgentFilter}>
                <SelectTrigger className="w-[170px] h-9 text-xs">
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
            </div>

            <div className="shrink-0">
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="h-9 text-xs gap-1.5">
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
            </div>

            <div className="shrink-0">
              <Select value={sortBy} onValueChange={setSortBy}>
                <SelectTrigger className="w-[180px] h-9 text-xs">
                  <SelectValue placeholder="Sort" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="newest">Newest to Oldest</SelectItem>
                  <SelectItem value="oldest">Oldest to Newest</SelectItem>
                  <SelectItem value="cost_high">Cost: High to Low</SelectItem>
                  <SelectItem value="cost_low">Cost: Low to High</SelectItem>
                  <SelectItem value="duration_high">Duration: High to Low</SelectItem>
                  <SelectItem value="duration_low">Duration: Low to High</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="shrink-0">
              <Button variant="outline" size="sm" className="h-9 text-xs gap-1.5" onClick={handleExport} disabled={!filteredCalls.length}>
                <Download className="h-3.5 w-3.5" /> Export
              </Button>
            </div>

            {hasActiveFilters && (
              <div className="shrink-0">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-9 text-xs text-muted-foreground hover:text-foreground"
                  onClick={clearFilters}
                >
                  <RefreshCw className="h-3 w-3 mr-1" /> Clear
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* Table */}
        <div ref={callsScrollRef} className="flex-1 overflow-auto px-8 py-6">
          <div className="rounded-2xl border border-border bg-elevated/40 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-elevated/95 backdrop-blur supports-[backdrop-filter]:bg-elevated/80">
                <TableRow className="hover:bg-transparent border-b border-border">
                  <TableHead className="w-[104px] py-3 px-4 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground/70">Date & Time</TableHead>
                  <TableHead className="w-[68px] py-3 px-4 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground/70">Call ID</TableHead>
                  <TableHead className="w-[160px] py-3 px-4 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground/70">Agent</TableHead>
                  <TableHead className="py-3 px-4 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground/70">From</TableHead>
                  <TableHead className="py-3 px-4 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground/70">To</TableHead>
                  <TableHead className="w-[118px] py-3 px-4 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground/70 text-center">Call Type</TableHead>
                  <TableHead className="w-[112px] py-3 px-4 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground/70 text-center">Status</TableHead>
                  <TableHead className="w-[72px] py-3 px-4 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground/70 text-center">Duration</TableHead>
                  <TableHead className="w-[80px] py-3 px-4 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground/70 text-right">Cost</TableHead>
                  <TableHead className="w-[64px] py-3 px-4 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground/70 text-center">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {callsLoading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <TableRow key={i} className="h-16 border-b border-border/60">
                      <TableCell className="px-4 py-0"><Skeleton className="h-3 w-20" /></TableCell>
                      <TableCell className="px-4 py-0"><Skeleton className="h-3 w-14" /></TableCell>
                      <TableCell className="px-4 py-0"><Skeleton className="h-3 w-28" /></TableCell>
                      <TableCell className="px-4 py-0"><Skeleton className="h-3 w-32" /></TableCell>
                      <TableCell className="px-4 py-0"><Skeleton className="h-3 w-32" /></TableCell>
                      <TableCell className="px-4 py-0"><Skeleton className="h-5 w-20 rounded-full mx-auto" /></TableCell>
                      <TableCell className="px-4 py-0"><Skeleton className="h-5 w-16 rounded-full mx-auto" /></TableCell>
                      <TableCell className="px-4 py-0"><Skeleton className="h-3 w-10 mx-auto" /></TableCell>
                      <TableCell className="px-4 py-0"><Skeleton className="h-3 w-10 ml-auto" /></TableCell>
                      <TableCell className="px-4 py-0"><Skeleton className="h-6 w-6 mx-auto rounded" /></TableCell>
                    </TableRow>
                  ))
                ) : pagedCalls.length > 0 ? (
                  pagedCalls.map((call) => {
                    const costCents = (call as any).costCents ?? 0;

                    return (
                      <TableRow key={call.id} className="group cursor-default h-16 border-b border-border/60 last:border-0 hover:bg-elevated/70 transition-colors">
                        <TableCell className="whitespace-nowrap px-4 py-0 align-middle">
                          <div className="text-[11px] text-foreground/80 font-medium">
                            {format(parseISO(call.createdAt), "MMM d, yyyy")}
                          </div>
                          <div className="text-[10px] text-muted-foreground/40 font-mono">
                            {format(parseISO(call.createdAt), "HH:mm:ss")}
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-[10px] text-muted-foreground/40 px-4 py-0 align-middle">
                          {getExecutionId(call)}
                        </TableCell>
                        <TableCell className="px-4 py-0 align-middle">
                          <div className="flex items-center gap-2">
                            <div className="h-6 w-6 rounded-md bg-elevated border border-border flex items-center justify-center shrink-0">
                              <Users className="h-3 w-3 text-muted-foreground/40" />
                            </div>
                            <span className="text-xs font-medium text-foreground/80 truncate">
                              {call.agentName}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="px-4 py-0 align-middle max-w-0">
                          <PhoneCell number={call.fromNumber} />
                        </TableCell>
                        <TableCell className="px-4 py-0 align-middle max-w-0">
                          <PhoneCell number={call.toNumber} />
                        </TableCell>
                        <TableCell className="px-4 py-0 align-middle text-center">
                          {(() => {
                            const isWeb = (call.fromNumber ?? "").startsWith("webcall") || (call.toNumber ?? "").startsWith("webcall");
                            const isCampaign = !isWeb && (call as any).campaignId != null;
                            const icon = isWeb ? <Globe className="h-3 w-3" /> : isCampaign ? <Megaphone className="h-3 w-3" /> : <Phone className="h-3 w-3" />;
                            const label = isWeb ? "Web Call" : isCampaign ? "Campaign" : "Live Call";
                            const direction: "inbound" | "outbound" = isWeb ? "outbound" : (call.direction ?? "inbound");
                            return (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-medium bg-elevated text-foreground/70 border border-border">
                                {direction === "outbound" ? (
                                  <ArrowUpRight className="h-3 w-3 text-foreground/50 shrink-0" />
                                ) : (
                                  <ArrowDownLeft className="h-3 w-3 text-foreground/50 shrink-0" />
                                )}
                                {icon}
                                {label}
                              </span>
                            );
                          })()}
                        </TableCell>
                        <TableCell className="px-4 py-0 align-middle text-center">
                          <StatusBadge status={call.status} />
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground/60 px-4 py-0 align-middle text-center">
                          {formatDuration(call.durationSeconds)}
                        </TableCell>
                        <TableCell className="px-4 py-0 align-middle text-right">
                          <div className="flex flex-col gap-0.5 items-end">
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
                                {((call as any).tokensSaved as number).toLocaleString()} tok saved
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="px-4 py-0 align-middle text-center">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 opacity-100 transition-opacity"
                            onClick={() => setSelectedCallId(call.id)}
                          >
                            <Eye className="h-3.5 w-3.5 text-muted-foreground/50" />
                          </Button>
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

            {/* Pagination footer */}
            <div className="flex flex-wrap items-center justify-end gap-3 px-4 py-3.5 border-t border-border bg-elevated/60">
              <div className="flex items-center gap-2 text-xs text-muted-foreground/60">
                <span>Per page</span>
                <Select value={String(pageSize)} onValueChange={v => { setPageSize(Number(v)); setCurrentPage(1); }}>
                  <SelectTrigger className="h-8 w-[70px] text-xs rounded-lg">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[25, 50, 100, 200].map(s => (
                      <SelectItem key={s} value={String(s)}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-1.5">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8 rounded-lg"
                  onClick={() => goToPage(safePage - 1)}
                  disabled={safePage <= 1}
                  aria-label="Previous page"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
                <span className="text-xs text-muted-foreground/70 whitespace-nowrap tabular-nums px-2">
                  Page {safePage} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8 rounded-lg"
                  onClick={() => goToPage(safePage + 1)}
                  disabled={safePage >= totalPages}
                  aria-label="Next page"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
              <div className="flex items-center gap-1.5">
                <Input
                  type="number"
                  min={1}
                  max={totalPages}
                  placeholder="#"
                  className="h-8 w-14 text-xs rounded-lg"
                  value={pageInput}
                  onChange={(e) => setPageInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleJumpToPage();
                    }
                  }}
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs rounded-lg"
                  onClick={handleJumpToPage}
                >
                  Go
                </Button>
              </div>
            </div>
          </div>
        </div>

        {/* Call Detail Drawer */}
        <CallDetailDrawer
          open={selectedCallId !== null}
          callId={selectedCallId}
          onClose={() => setSelectedCallId(null)}
        />
      </div>
    </TooltipProvider>
  );
}
