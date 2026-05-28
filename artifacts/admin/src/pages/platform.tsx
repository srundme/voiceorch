import { usePlatformActive, usePlatformFailedCalls, usePlatformFailedCallsByReason, useFailedCallsAgents, type FailedCallsFilters } from "@/hooks/use-admin-api";
import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Activity, AlertTriangle, BarChart2, ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { useState, useCallback } from "react";
import { useDebounce } from "@/hooks/use-debounce";

const PAGE_SIZE = 50;

function hasActiveFilters(filters: FailedCallsFilters): boolean {
  return !!(filters.agentId || filters.userId || filters.reason);
}

export default function Platform() {
  const { data: activeData, isLoading: loadingActive, isError: activeError, error: activeErr } = usePlatformActive();
  const { data: byReason, isLoading: loadingByReason, isError: byReasonError } = usePlatformFailedCallsByReason();
  const { data: agentsData } = useFailedCallsAgents();

  const [agentId, setAgentId] = useState<number | null>(null);
  const [userIdInput, setUserIdInput] = useState("");
  const [reasonInput, setReasonInput] = useState("");
  const [page, setPage] = useState(1);

  const debouncedUserId = useDebounce(userIdInput, 400);
  const debouncedReason = useDebounce(reasonInput, 400);

  const filters: FailedCallsFilters = {
    agentId: agentId ?? undefined,
    userId: debouncedUserId || undefined,
    reason: debouncedReason || undefined,
    page,
    limit: PAGE_SIZE,
  };

  const { data: failedData, isLoading: loadingFailed, isError: failedError, error: failedErr } = usePlatformFailedCalls(filters);

  const failedCalls = failedData?.data ?? [];
  const total = failedData?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtersActive = hasActiveFilters(filters);

  const resetFilters = useCallback(() => {
    setAgentId(null);
    setUserIdInput("");
    setReasonInput("");
    setPage(1);
  }, []);

  const handleAgentChange = (val: string) => {
    setAgentId(val === "all" ? null : Number(val));
    setPage(1);
  };

  const handleUserIdChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setUserIdInput(e.target.value);
    setPage(1);
  };

  const handleReasonChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setReasonInput(e.target.value);
    setPage(1);
  };

  const emptyMessage = filtersActive
    ? "No failed calls match the current filters"
    : "No failed calls recently";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Platform Health</h1>
      </div>

      <div className="grid grid-cols-1 gap-6">
        <Card className="border-primary/20 shadow-md shadow-primary/5">
          <CardHeader className="pb-3 border-b border-border bg-card">
            <CardTitle className="text-sm font-medium uppercase tracking-wider flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" /> Active Sessions ({activeData?.count || 0})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Session ID</TableHead>
                  <TableHead>Call ID</TableHead>
                  <TableHead className="text-right">Started At</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingActive ? (
                  <TableRow><TableCell colSpan={3} className="text-center py-4">Loading...</TableCell></TableRow>
                ) : activeError ? (
                  <TableRow><TableCell colSpan={3} className="text-center py-4 text-destructive">Failed to load active sessions: {(activeErr as Error)?.message}</TableCell></TableRow>
                ) : activeData?.activeSessions?.length === 0 ? (
                  <TableRow><TableCell colSpan={3} className="text-center py-8 text-muted-foreground">No active calls right now</TableCell></TableRow>
                ) : (
                  activeData?.activeSessions?.map((session: any) => (
                    <TableRow key={session.sessionId}>
                      <TableCell className="font-mono text-xs">{session.sessionId}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{session.callId}</TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {session.startedAt ? format(new Date(session.startedAt), "HH:mm:ss") : "-"}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="border-destructive/10">
          <CardHeader className="pb-3 border-b border-border bg-card">
            <CardTitle className="text-sm font-medium uppercase tracking-wider flex items-center gap-2 text-destructive">
              <BarChart2 className="h-4 w-4" /> Top Failure Reasons
              <span className="ml-auto text-xs font-normal normal-case tracking-normal text-muted-foreground">in last 100 failed calls</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <TooltipProvider delayDuration={200}>
              {loadingByReason ? (
                <div className="py-4 text-center text-sm text-muted-foreground">Loading...</div>
              ) : byReasonError ? (
                <div className="py-4 text-center text-sm text-destructive">Failed to load failure reasons</div>
              ) : !byReason || byReason.length === 0 ? (
                <div className="py-6 text-center text-sm text-muted-foreground">No failures recorded</div>
              ) : (
                <div className="p-4 space-y-2">
                  {(() => {
                    const total = byReason.reduce((sum, r) => sum + r.count, 0);
                    return byReason.map((row, i) => {
                      const pct = total > 0 ? Math.round((row.count / total) * 100) : 0;
                      return (
                        <div key={i} className="space-y-1">
                          <div className="flex items-center justify-between gap-4">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="text-xs truncate max-w-[70%] text-destructive/90">{row.reason}</span>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-[500px] whitespace-pre-wrap break-words">{row.reason}</TooltipContent>
                            </Tooltip>
                            <span className="text-xs font-mono text-muted-foreground shrink-0">{row.count} ({pct}%)</span>
                          </div>
                          <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                            <div
                              className="h-full rounded-full bg-destructive/70"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      );
                    });
                  })()}
                </div>
              )}
            </TooltipProvider>
          </CardContent>
        </Card>

        <Card className="border-destructive/20">
          <CardHeader className="pb-3 border-b border-border bg-card">
            <div className="flex items-center justify-between mb-3">
              <CardTitle className="text-sm font-medium uppercase tracking-wider flex items-center gap-2 text-destructive">
                <AlertTriangle className="h-4 w-4" /> Failed Calls
                {total > 0 && (
                  <span className="text-muted-foreground font-normal normal-case text-xs ml-1">
                    ({total.toLocaleString()} total)
                  </span>
                )}
              </CardTitle>
              {filtersActive && (
                <Button variant="ghost" size="sm" onClick={resetFilters} className="h-7 text-xs gap-1 text-muted-foreground hover:text-foreground">
                  <X className="h-3 w-3" /> Clear filters
                </Button>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Select value={agentId != null ? String(agentId) : "all"} onValueChange={handleAgentChange}>
                <SelectTrigger className="h-8 text-xs w-[180px]">
                  <SelectValue placeholder="All agents" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All agents</SelectItem>
                  {agentsData?.map((a) => (
                    <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                <Input
                  className="h-8 text-xs pl-6 w-[180px]"
                  placeholder="Filter by user / Clerk ID"
                  value={userIdInput}
                  onChange={handleUserIdChange}
                />
              </div>

              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                <Input
                  className="h-8 text-xs pl-6 w-[200px]"
                  placeholder="Search error text"
                  value={reasonInput}
                  onChange={handleReasonChange}
                />
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0 h-[400px] overflow-auto">
            <TooltipProvider delayDuration={200}>
              <Table className="table-fixed w-full">
                <TableHeader className="sticky top-0 bg-card z-10">
                  <TableRow>
                    <TableHead className="w-[110px]">Date</TableHead>
                    <TableHead className="w-[140px]">User</TableHead>
                    <TableHead className="w-[80px]">Call ID</TableHead>
                    <TableHead className="w-[160px]">Agent</TableHead>
                    <TableHead>Reason</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingFailed ? (
                    <TableRow><TableCell colSpan={5} className="text-center py-4">Loading...</TableCell></TableRow>
                  ) : failedError ? (
                    <TableRow><TableCell colSpan={5} className="text-center py-8 text-destructive">Failed to load failed calls: {(failedErr as Error)?.message}</TableCell></TableRow>
                  ) : failedCalls.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                        {emptyMessage}
                      </TableCell>
                    </TableRow>
                  ) : (
                    failedCalls.map((call: any) => {
                      const agentLabel = call.agentName ?? (call.agentId != null ? `Agent #${call.agentId}` : "—");
                      const reason = call.errorMessage ?? null;
                      return (
                        <TableRow
                          key={call.id}
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => window.open(`/app/calls/${call.id}`, "_blank", "noopener,noreferrer")}
                          data-testid={`row-failed-call-${call.id}`}
                        >
                          <TableCell className="text-xs font-mono text-muted-foreground">
                            {call.createdAt ? format(new Date(call.createdAt), "MMM d HH:mm") : "-"}
                          </TableCell>
                          <TableCell className="text-xs">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="block truncate">{call.userId ?? "—"}</span>
                              </TooltipTrigger>
                              {call.userId && <TooltipContent className="max-w-[400px] break-all">{call.userId}</TooltipContent>}
                            </Tooltip>
                          </TableCell>
                          <TableCell className="text-xs font-mono truncate" title={String(call.id)}>{call.id}</TableCell>
                          <TableCell className="text-xs">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="block truncate">{agentLabel}</span>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-[400px] break-all">{agentLabel}</TooltipContent>
                            </Tooltip>
                          </TableCell>
                          <TableCell className="text-xs">
                            {reason ? (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="block truncate text-destructive/90">{reason}</span>
                                </TooltipTrigger>
                                <TooltipContent className="max-w-[500px] whitespace-pre-wrap break-words">{reason}</TooltipContent>
                              </Tooltip>
                            ) : (
                              <span className="text-muted-foreground italic">Unknown</span>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </TooltipProvider>
          </CardContent>
          {total > PAGE_SIZE && (
            <div className="flex items-center justify-between px-4 py-2 border-t border-border text-xs text-muted-foreground">
              <span>
                Page {page} of {totalPages} &middot; {total.toLocaleString()} results
              </span>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
