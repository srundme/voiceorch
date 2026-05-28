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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export default function CallsList() {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [agentFilter, setAgentFilter] = useState<string>("all");
  
  const { data: calls, isLoading: callsLoading } = useListCalls(
    { 
      status: statusFilter !== "all" ? statusFilter : undefined,
      agentId: agentFilter !== "all" ? parseInt(agentFilter) : undefined
    }, 
    {
      query: { 
        queryKey: getListCallsQueryKey({ 
          status: statusFilter !== "all" ? statusFilter : undefined,
          agentId: agentFilter !== "all" ? parseInt(agentFilter) : undefined
        })
      }
    }
  );

  const { data: agents } = useListAgents({
    query: { queryKey: getListAgentsQueryKey() }
  });

  const formatDuration = (seconds?: number | null) => {
    if (!seconds) return "-";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  };

  const formatMs = (ms?: number | null) => {
    if (ms == null) return null;
    return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
  };

  const getStatusBadge = (status: string) => {
    switch(status) {
      case "completed": return <Badge variant="default" className="bg-primary/20 text-primary hover:bg-primary/30 border-transparent">Completed</Badge>;
      case "failed": return <Badge variant="destructive" className="bg-destructive/20 text-destructive hover:bg-destructive/30 border-transparent">Failed</Badge>;
      case "in_progress": return <Badge variant="secondary" className="bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 hover:bg-yellow-500/30 border-transparent">In Progress</Badge>;
      case "pending": return <Badge variant="outline" className="text-muted-foreground">Pending</Badge>;
      case "cancelled": return <Badge variant="outline" className="bg-muted text-muted-foreground border-transparent">Cancelled</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getLatencyColor = (ms: number | null | undefined, thresholds: [number, number]) => {
    if (ms == null) return "text-muted-foreground";
    if (ms <= thresholds[0]) return "text-emerald-600 dark:text-gray-700";
    if (ms <= thresholds[1]) return "text-yellow-600 dark:text-yellow-400";
    return "text-red-600 dark:text-red-500";
  };

  return (
    <TooltipProvider>
    <div className="flex-1 space-y-6 p-6 md:p-8 pt-6 h-full flex flex-col">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Call Log</h2>
          <p className="text-muted-foreground">
            Complete history of all voice interactions across agents.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <div className="relative flex-1 max-w-sm min-w-[200px]">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search phone numbers..."
            className="pl-8"
          />
        </div>
        
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Filter by Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
            <SelectItem value="in_progress">In Progress</SelectItem>
          </SelectContent>
        </Select>

        <Select value={agentFilter} onValueChange={setAgentFilter}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Filter by Agent" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Agents</SelectItem>
            {agents?.map(agent => (
              <SelectItem key={agent.id} value={agent.id.toString()}>{agent.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card className="flex-1 flex flex-col overflow-hidden border-border/50">
        <CardContent className="p-0 flex-1 overflow-auto">
          <Table>
            <TableHeader className="bg-muted/50 sticky top-0 z-10 backdrop-blur-sm">
              <TableRow className="border-border/50 hover:bg-transparent">
                <TableHead className="w-[150px]">Date</TableHead>
                <TableHead className="w-[120px]">Execution ID</TableHead>
                <TableHead>Agent</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>To / From</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>
                  <Tooltip>
                    <TooltipTrigger className="cursor-default">Latency (avg)</TooltipTrigger>
                    <TooltipContent side="top" className="text-xs max-w-[220px]">
                      <p className="mb-1 font-semibold">Per-call averages across all turns</p>
                      <p><span className="text-blue-400">STT</span> — speech-to-text round-trip</p>
                      <p><span className="text-violet-600">LLM</span> — time to first token</p>
                      <p><span className="text-orange-400">TTS</span> — time to first audio chunk</p>
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
                  <TableRow key={i} className="border-border/50">
                    <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-6 w-20 rounded-full" /></TableCell>
                    <TableCell><Skeleton className="h-8 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-12" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-12" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="h-8 w-16 ml-auto" /></TableCell>
                  </TableRow>
                ))
              ) : calls && calls.length > 0 ? (
                calls.map((call) => {
                  const sttMs = formatMs(call.sttLatencyMs);
                  const llmMs = formatMs(call.llmLatencyMs);
                  const ttsMs = formatMs(call.ttsFirstChunkMs);
                  const hasLatency = sttMs || llmMs || ttsMs;

                  return (
                    <TableRow key={call.id} className="cursor-pointer hover:bg-muted/50 transition-colors border-border/50">
                      <TableCell className="whitespace-nowrap text-muted-foreground font-medium text-xs">
                        {format(parseISO(call.createdAt), "MMM d, HH:mm:ss")}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-gray-400">
                        {(call as any).executionId ?? `#${call.id}`}
                      </TableCell>
                      <TableCell>
                        <Link href={`/agents/${call.agentId}`}>
                          <span className="font-medium text-primary hover:underline">{call.agentName}</span>
                        </Link>
                      </TableCell>
                      <TableCell>
                        {getStatusBadge(call.status)}
                      </TableCell>
                      <TableCell>
                        <div className="text-sm font-medium">{call.toNumber}</div>
                        <div className="text-xs text-muted-foreground">{call.fromNumber}</div>
                      </TableCell>
                      <TableCell className="font-mono text-sm text-muted-foreground">
                        {formatDuration(call.durationSeconds)}
                      </TableCell>
                      <TableCell>
                        {hasLatency ? (
                          <div className="flex items-center gap-2 text-xs font-mono">
                            {sttMs && (
                              <Tooltip>
                                <TooltipTrigger>
                                  <span className={`flex items-center gap-0.5 ${getLatencyColor(call.sttLatencyMs, [400, 800])}`}>
                                    <Mic className="h-3 w-3" />
                                    {sttMs}
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent>STT latency (avg)</TooltipContent>
                              </Tooltip>
                            )}
                            {llmMs && (
                              <Tooltip>
                                <TooltipTrigger>
                                  <span className={`flex items-center gap-0.5 ${getLatencyColor(call.llmLatencyMs, [300, 600])}`}>
                                    <Cpu className="h-3 w-3" />
                                    {llmMs}
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent>LLM first-token latency (avg)</TooltipContent>
                              </Tooltip>
                            )}
                            {ttsMs && (
                              <Tooltip>
                                <TooltipTrigger>
                                  <span className={`flex items-center gap-0.5 ${getLatencyColor(call.ttsFirstChunkMs, [200, 500])}`}>
                                    <Volume2 className="h-3 w-3" />
                                    {ttsMs}
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent>TTS first-audio latency from LLM start (avg)</TooltipContent>
                              </Tooltip>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground/50">—</span>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {(call as any).costCents != null && (call as any).costCents > 0 ? (
                          <span className="flex items-center gap-0.5 text-amber-500 dark:text-amber-600">
                            <DollarSign className="h-3 w-3" />
                            {((call as any).costCents / 100).toFixed(3)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground/40">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Link href={`/app/calls/${call.id}`}>
                          <Button variant="secondary" size="sm" className="h-8 text-xs font-semibold">View Log</Button>
                        </Link>
                      </TableCell>
                    </TableRow>
                  );
                })
              ) : (
                <TableRow>
                  <TableCell colSpan={9} className="h-64 text-center text-muted-foreground border-0">
                    <div className="flex flex-col items-center justify-center">
                      <Phone className="h-10 w-10 opacity-20 mb-3" />
                      <p>No calls found matching your filters.</p>
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
    </TooltipProvider>
  );
}
