import { useState } from "react";
import { Link, useParams } from "wouter";
import { format, parseISO } from "date-fns";
import {
  ArrowLeft, Download, FileText, AlertTriangle, Info, Bot, User,
  Receipt, Sparkles, ClipboardList, Pencil, Check, X, Zap,
  ChevronDown, ChevronUp, Phone, Calendar, Clock, TrendingUp,
  BarChart3, Mic, Cpu, Volume2, Hash, ArrowRight, UserCheck,
  Voicemail, BookOpen, Tag, Activity, ExternalLink, Copy, CheckCircle2,
  XCircle, PlayCircle, PauseCircle, MicOff, ScrollText
} from "lucide-react";
import { SnapServeExecutionsPanel } from "@/components/snapserve-executions-panel";
import {
  useGetCall,
  useGetAgent,
  useUpdateCallDisposition,
  getGetCallQueryKey,
  getGetAgentQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { formatApiError } from "@/lib/format-api-error";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface ToolEvent {
  toolName: string;
  result: string;
  status: "success" | "error";
}

const TOOL_CALL_RE = /\[calling tool:\s*([^\]]+)\]/i;
const TOOL_RESULT_RE = /\[Tool result for ([^\]]+)\]:\s*(.*)/i;

function parseToolEventsFromLines(lines: string[]): ToolEvent[] {
  const events: ToolEvent[] = [];
  for (const line of lines) {
    const resultMatch = TOOL_RESULT_RE.exec(line);
    if (resultMatch) {
      const toolName = resultMatch[1].trim();
      const result = resultMatch[2].trim();
      const status = result.toLowerCase().startsWith("error:") ? "error" : "success";
      events.push({ toolName, result, status });
    }
  }
  return events;
}

function PlainTranscriptLine({ line, index }: { line: string; index: number }) {
  const isToolCall = TOOL_CALL_RE.test(line);
  const isToolResult = TOOL_RESULT_RE.test(line);

  if (isToolCall || isToolResult) {
    return (
      <div
        key={index}
        className="flex items-start gap-2 px-3 py-2 rounded-md bg-amber-500/5 border border-amber-500/10 my-1"
      >
        <Zap className="h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-500" />
        <span className="font-mono text-xs text-muted-foreground leading-relaxed break-all">
          {line}
        </span>
      </div>
    );
  }

  return (
    <div key={index} className="font-mono text-sm leading-relaxed whitespace-pre-wrap text-foreground/80">
      {line}
    </div>
  );
}

function ToolEventRow({ event }: { event: ToolEvent }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = event.result.length > 120;
  const displayResult = !isLong || expanded ? event.result : event.result.slice(0, 120) + "…";

  return (
    <div className="p-3 border-b border-border last:border-0 hover:bg-elevated/20 transition-colors">
      <div className="flex items-center gap-2 flex-wrap">
        <Zap className="h-3.5 w-3.5 shrink-0 text-amber-500" />
        <Badge variant="outline" className="font-mono text-xs px-2 py-0 h-5 border-amber-500/20">
          {event.toolName}
        </Badge>
        {event.status === "success" ? (
          <Badge variant="default" className="text-xs h-5 px-2 py-0 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-transparent hover:bg-emerald-500/20">
            Success
          </Badge>
        ) : (
          <Badge variant="destructive" className="text-xs h-5 px-2 py-0 bg-red-500/15 text-red-600 dark:text-red-400 border-transparent hover:bg-red-500/20">
            Error
          </Badge>
        )}
      </div>
      {event.result && (
        <div className="mt-2">
          <p className="font-mono text-xs text-muted-foreground leading-relaxed break-all">
            {displayResult}
          </p>
          {isLong && (
            <button
              onClick={() => setExpanded(v => !v)}
              className="mt-1 flex items-center gap-0.5 text-xs text-primary hover:underline"
            >
              {expanded ? (
                <><ChevronUp className="h-3 w-3" /> Show less</>
              ) : (
                <><ChevronDown className="h-3 w-3" /> Show more</>
              )}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const configs: Record<string, { label: string; icon: React.ReactNode; bg: string; text: string; border: string }> = {
    completed: {
      label: "Completed",
      icon: <CheckCircle2 className="h-3 w-3" />,
      bg: "bg-emerald-500/10",
      text: "text-emerald-600 dark:text-emerald-400",
      border: "border-emerald-500/20",
    },
    failed: {
      label: "Failed",
      icon: <XCircle className="h-3 w-3" />,
      bg: "bg-red-500/10",
      text: "text-red-600 dark:text-red-400",
      border: "border-red-500/20",
    },
    in_progress: {
      label: "In Progress",
      icon: <PlayCircle className="h-3 w-3" />,
      bg: "bg-blue-500/10",
      text: "text-blue-600 dark:text-blue-400",
      border: "border-blue-500/20",
    },
    pending: {
      label: "Pending",
      icon: <PauseCircle className="h-3 w-3" />,
      bg: "bg-muted/50",
      text: "text-muted-foreground",
      border: "border-border",
    },
    cancelled: {
      label: "Cancelled",
      icon: <X className="h-3 w-3" />,
      bg: "bg-muted/30",
      text: "text-muted-foreground/60",
      border: "border-border",
    },
    transferred: {
      label: "Transferred",
      icon: <UserCheck className="h-3 w-3" />,
      bg: "bg-amber-500/10",
      text: "text-amber-600 dark:text-amber-400",
      border: "border-amber-500/20",
    },
    booked: {
      label: "Booked",
      icon: <Calendar className="h-3 w-3" />,
      bg: "bg-violet-500/10",
      text: "text-violet-600 dark:text-violet-400",
      border: "border-violet-500/20",
    },
    callback_scheduled: {
      label: "Callback",
      icon: <Clock className="h-3 w-3" />,
      bg: "bg-orange-500/10",
      text: "text-orange-600 dark:text-orange-400",
      border: "border-orange-500/20",
    },
    voicemail: {
      label: "Voicemail",
      icon: <Voicemail className="h-3 w-3" />,
      bg: "bg-muted/50",
      text: "text-muted-foreground",
      border: "border-border",
    },
  };

  const cfg = configs[status] ?? configs.pending;
  return (
    <span className={`inline-flex items-center gap-1.5 text-[10px] font-semibold px-2.5 py-1 rounded-md border ${cfg.bg} ${cfg.text} ${cfg.border}`}>
      {cfg.icon}
      {cfg.label}
    </span>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="text-muted-foreground/40 hover:text-muted-foreground transition-colors"
    >
      {copied ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

function DetailRow({ label, value, icon, highlight }: { label: string; value: React.ReactNode; icon?: React.ReactNode; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between py-2.5 px-4 border-b border-border last:border-0">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className={`text-xs font-mono ${highlight ? "text-foreground font-semibold" : "text-foreground/70"}`}>
        {value}
      </div>
    </div>
  );
}

export default function CallDetail() {
  const params = useParams();
  const id = parseInt(params.id || "0", 10);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: call, isLoading } = useGetCall(id, {
    query: { enabled: !!id, queryKey: getGetCallQueryKey(id) }
  });

  const agentId = call?.agentId;
  const { data: agent } = useGetAgent(agentId!, {
    query: { enabled: !!agentId, queryKey: getGetAgentQueryKey(agentId!) }
  });

  const updateDisposition = useUpdateCallDisposition();
  const [editing, setEditing] = useState(false);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [activeTab, setActiveTab] = useState("logs");

  const dispositionSchema = Array.isArray((agent as any)?.dispositionSchema)
    ? (agent as any).dispositionSchema as Array<{ key: string; label: string; type: string; options?: string[] }>
    : [];

  const dispositionResult = (call as any)?.dispositionResult as Record<string, string | number | boolean | null> | null | undefined;

  const startEditing = () => {
    const initial: Record<string, string> = {};
    dispositionSchema.forEach(f => {
      const v = dispositionResult?.[f.key];
      initial[f.key] = v != null ? String(v) : "";
    });
    setEdits(initial);
    setEditing(true);
  };

  const saveDisposition = () => {
    const result: Record<string, string | number | boolean> = {};
    dispositionSchema.forEach(f => {
      const v = edits[f.key];
      if (v !== "" && v != null) {
        if (f.type === "number") result[f.key] = parseFloat(v) || 0;
        else if (f.type === "boolean") result[f.key] = v === "true";
        else result[f.key] = v;
      }
    });
    updateDisposition.mutate(
      { id, data: { dispositionResult: result } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetCallQueryKey(id) });
          setEditing(false);
          toast({ title: "Disposition saved" });
        },
        onError: (err: unknown) => toast({ title: "Failed to save", description: formatApiError(err), variant: "destructive" }),
      }
    );
  };

  const formatDuration = (seconds?: number | null) => {
    if (!seconds) return "0s";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  };

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-10 w-[200px]" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Skeleton className="col-span-1 lg:col-span-2 h-[500px] w-full" />
          <Skeleton className="col-span-1 h-[500px] w-full" />
        </div>
      </div>
    );
  }

  if (!call) {
    return (
      <div className="p-6 flex flex-col items-center justify-center h-[60vh] text-center">
        <div className="h-12 w-12 rounded-2xl bg-elevated border border-border flex items-center justify-center mb-4">
          <Phone className="h-6 w-6 text-muted-foreground/30" />
        </div>
        <p className="text-sm font-medium text-foreground/40">Call not found</p>
        <p className="text-xs text-muted-foreground/30 mt-1">The call may have been deleted or you may not have access</p>
        <Link href="/app/calls">
          <Button variant="outline" size="sm" className="mt-4 gap-1.5">
            <ArrowLeft className="h-3.5 w-3.5" /> Back to Calls
          </Button>
        </Link>
      </div>
    );
  }

  let transcriptLines: any[] = [];
  let isJsonTranscript = false;
  if (call.transcript) {
    try {
      transcriptLines = JSON.parse(call.transcript);
      isJsonTranscript = Array.isArray(transcriptLines);
    } catch(e) {
      isJsonTranscript = false;
    }
  }

  const plainLines = (!isJsonTranscript && call.transcript)
    ? call.transcript.split(/\r?\n/)
    : [];

  const toolEvents: ToolEvent[] = isJsonTranscript
    ? parseToolEventsFromLines(transcriptLines.map((l: any) => String(l.content ?? "")))
    : call.transcript
      ? parseToolEventsFromLines(call.transcript.split(/\r?\n/))
      : [];

  const callSummary = (call as any).callSummary as string | null | undefined;
  const rawEval = (call as any).successEvaluation as string | null | undefined;
  const evalVerdict = rawEval ? rawEval.split(/\r?\n/)[0]?.trim().toUpperCase() : undefined;
  const evalReason = rawEval ? rawEval.split(/\r?\n/).slice(1).join(" ").trim() : undefined;
  const evalIsPass = evalVerdict?.startsWith("PASS");
  const evalIsFail = evalVerdict?.startsWith("FAIL");

  const costCents = (call as any).costCents ?? 0;

  return (
    <TooltipProvider>
      <div className="flex-1 space-y-5 p-6 h-full flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3">
            <Link href="/app/calls">
              <Button variant="outline" size="icon" className="h-8 w-8">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div>
              <div className="flex items-center gap-3">
                <h2 className="text-xl font-semibold tracking-tight">Call #{call.id}</h2>
                <StatusBadge status={call.status} />
              </div>
              <p className="text-muted-foreground text-xs flex items-center gap-2 mt-0.5">
                <span className="font-mono">{call.executionId ?? `EXE-${String(call.id).padStart(7, '0')}`}</span>
                <span className="text-muted-foreground/30">•</span>
                {format(parseISO(call.createdAt), "MMM d, yyyy 'at' h:mm:ss a")}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {call.recordingUrl ? (
              <>
                <audio
                  controls
                  src={call.recordingUrl}
                  className="h-8 max-w-[200px] rounded"
                  style={{ colorScheme: "dark" }}
                />
                <a
                  href={call.recordingUrl}
                  download={`call-${call.id}.wav`}
                  title="Download Recording"
                  className="inline-flex items-center justify-center h-8 w-8 rounded-md border border-input bg-background hover:bg-accent hover:text-accent-foreground"
                >
                  <Download className="h-4 w-4" />
                </a>
              </>
            ) : (call.status === "completed" || call.status === "failed") ? (
              <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground/40 border border-dashed border-border rounded-md px-2.5 py-1.5">
                <MicOff className="h-3 w-3" /> Recording not enabled
              </span>
            ) : null}
          </div>
        </div>

        {/* Quick Stats Row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2 shrink-0">
          <Card className="border-0 shadow-none bg-transparent">
            <CardContent className="p-2.5">
              <p className="text-[9px] text-muted-foreground/50 uppercase tracking-wider">Agent</p>
              <Link href={`/app/agents/${call.agentId}`}>
                <p className="text-xs font-medium text-primary hover:underline truncate">{call.agentName}</p>
              </Link>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-none bg-transparent">
            <CardContent className="p-2.5">
              <p className="text-[9px] text-muted-foreground/50 uppercase tracking-wider">Duration</p>
              <p className="text-xs font-mono font-semibold text-foreground">{formatDuration(call.durationSeconds)}</p>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-none bg-transparent">
            <CardContent className="p-2.5">
              <p className="text-[9px] text-muted-foreground/50 uppercase tracking-wider">From</p>
              <p className="text-xs font-mono text-foreground/70">{call.fromNumber}</p>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-none bg-transparent">
            <CardContent className="p-2.5">
              <p className="text-[9px] text-muted-foreground/50 uppercase tracking-wider">To</p>
              <p className="text-xs font-mono text-foreground/70">{call.toNumber}</p>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-none bg-transparent">
            <CardContent className="p-2.5">
              <p className="text-[9px] text-muted-foreground/50 uppercase tracking-wider">Cost</p>
              <p className="text-xs font-mono text-foreground/70">
                {costCents > 0 ? `₹${(costCents / 100).toFixed(2)}` : "—"}
              </p>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-none bg-transparent">
            <CardContent className="p-2.5">
              <p className="text-[9px] text-muted-foreground/50 uppercase tracking-wider">Direction</p>
              <p className="text-xs font-medium text-foreground/70">Outbound</p>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 flex-1 min-h-0">
          {/* Left Column */}
          <div className="col-span-1 lg:col-span-2 flex flex-col h-full min-h-0">
            <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
              <TabsList className="h-8 w-fit shrink-0">
                <TabsTrigger value="transcript" className="text-xs h-6 gap-1">
                  <FileText className="h-3 w-3" /> Transcript
                </TabsTrigger>
                <TabsTrigger value="tools" className="text-xs h-6 gap-1">
                  <Zap className="h-3 w-3" /> Tools {toolEvents.length > 0 && `(${toolEvents.length})`}
                </TabsTrigger>
                <TabsTrigger value="logs" className="text-xs h-6 gap-1">
                  <ScrollText className="h-3 w-3" /> SnapServe Executions
                </TabsTrigger>
                <TabsTrigger value="metadata" className="text-xs h-6 gap-1">
                  <Hash className="h-3 w-3" /> Metadata
                </TabsTrigger>
              </TabsList>

              <TabsContent value="transcript" className="flex-1 overflow-auto mt-2 min-h-0">
                <Card className="h-full flex flex-col">
                  <CardContent className="p-0 flex-1 overflow-auto">
                    {/* Error Banner */}
                    {call.status === "failed" && call.errorMessage && (
                      <div className="m-4 p-3 bg-red-500/5 border border-red-500/10 rounded-lg flex items-start gap-2 text-red-600">
                        <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                        <div>
                          <h4 className="font-semibold text-xs">Call Failed</h4>
                          <p className="text-xs opacity-80">{call.errorMessage}</p>
                        </div>
                      </div>
                    )}

                    {/* AI Evaluation */}
                    {(evalIsPass || evalIsFail) && (
                      <div className={`mx-4 mt-3 p-3 rounded-lg border ${evalIsPass ? "bg-emerald-500/5 border-emerald-500/10" : "bg-red-500/5 border-red-500/10"}`}>
                        <div className={`flex items-center gap-2 mb-1 text-xs font-semibold ${evalIsPass ? "text-emerald-600" : "text-red-600"}`}>
                          {evalIsPass ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                          AI Evaluation: {evalIsPass ? "PASS" : "FAIL"}
                        </div>
                        {evalReason && (
                          <p className="text-xs text-muted-foreground leading-relaxed">{evalReason}</p>
                        )}
                      </div>
                    )}

                    {/* AI Summary */}
                    {callSummary && (
                      <div className="mx-4 mt-3 p-3 bg-primary/5 border border-primary/10 rounded-lg">
                        <div className="flex items-center gap-2 mb-2 text-primary text-xs font-semibold">
                          <Sparkles className="h-3.5 w-3.5" /> AI Summary
                        </div>
                        <div className="text-xs text-muted-foreground whitespace-pre-line leading-relaxed">
                          {callSummary}
                        </div>
                      </div>
                    )}

                    {/* Transcript Content */}
                    <div className="p-5 space-y-1">
                      {!call.transcript ? (
                        <div className="text-center text-muted-foreground py-10">
                          <div className="h-10 w-10 rounded-xl bg-elevated border border-border flex items-center justify-center mx-auto mb-3">
                            <Mic className="h-5 w-5 text-muted-foreground/30" />
                          </div>
                          <p className="text-sm text-foreground/40">No transcript available</p>
                          <p className="text-xs text-muted-foreground/30 mt-1">Transcript will appear once the call completes</p>
                        </div>
                      ) : isJsonTranscript ? (
                        <div className="space-y-5">
                          {transcriptLines.map((line, i) => (
                            <div key={i} className={`flex gap-3 ${line.role === 'user' ? 'flex-row-reverse' : ''}`}>
                              <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${line.role === 'user' ? 'bg-secondary' : 'bg-primary/15 text-primary'}`}>
                                {line.role === 'user' ? <User className="h-3 w-3" /> : <Bot className="h-3 w-3" />}
                              </div>
                              <div className={`max-w-[80%] rounded-xl p-3 text-xs ${line.role === 'user' ? 'bg-secondary text-secondary-foreground rounded-tr-sm' : 'bg-card border border-border shadow-sm rounded-tl-sm'}`}>
                                <p className="leading-relaxed">{line.content}</p>
                                {line.timestamp && (
                                  <span className="text-[10px] text-muted-foreground mt-1.5 block opacity-60">
                                    {line.timestamp}
                                  </span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="p-3 bg-card rounded-lg border border-border space-y-0.5">
                          {plainLines.map((line, i) => (
                            <PlainTranscriptLine key={i} line={line} index={i} />
                          ))}
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="tools" className="flex-1 overflow-auto mt-2 min-h-0">
                <Card className="h-full flex flex-col">
                  <CardContent className="p-0 flex-1 overflow-auto">
                    {toolEvents.length === 0 ? (
                      <div className="flex flex-col items-center justify-center h-full text-center py-10">
                        <div className="h-10 w-10 rounded-xl bg-elevated border border-border flex items-center justify-center mb-3">
                          <Zap className="h-5 w-5 text-muted-foreground/30" />
                        </div>
                        <p className="text-sm text-foreground/40">No tool calls</p>
                        <p className="text-xs text-muted-foreground/30 mt-1">This call did not trigger any tools</p>
                      </div>
                    ) : (
                      <div>
                        {toolEvents.map((event, i) => (
                          <ToolEventRow key={i} event={event} />
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="logs" className="flex-1 overflow-auto mt-2 min-h-0">
                <Card className="h-full flex flex-col overflow-hidden">
                  <CardContent className="p-0 flex-1 overflow-hidden">
                    <SnapServeExecutionsPanel agentId={call.agentId ?? undefined} />
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="metadata" className="flex-1 overflow-auto mt-2 min-h-0">
                <Card className="h-full">
                  <CardContent className="p-4">
                    {call.metadata ? (
                      <pre className="text-xs font-mono bg-elevated/50 p-4 rounded-lg overflow-x-auto border border-border">
                        {(() => {
                          try {
                            return JSON.stringify(JSON.parse(call.metadata), null, 2);
                          } catch {
                            return call.metadata;
                          }
                        })()}
                      </pre>
                    ) : (
                      <div className="text-center text-muted-foreground py-10">
                        <p className="text-sm text-foreground/40">No metadata</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>

          {/* Right Column: Sidebar */}
          <div className="space-y-4 overflow-auto h-full">
            {/* Call Details */}
            <Card>
              <CardHeader className="py-3 border-b">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Info className="h-4 w-4 text-primary/70" />
                  Call Details
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <DetailRow label="To Number" value={call.toNumber} icon={<Phone className="h-3 w-3" />} />
                <DetailRow label="From Number" value={call.fromNumber} icon={<Phone className="h-3 w-3" />} />
                <DetailRow label="Duration" value={formatDuration(call.durationSeconds)} icon={<Clock className="h-3 w-3" />} highlight />
                <DetailRow label="Started" value={format(parseISO(call.createdAt), "HH:mm:ss")} icon={<PlayCircle className="h-3 w-3" />} />
                <DetailRow label="Ended" value={call.endedAt ? format(parseISO(call.endedAt), "HH:mm:ss") : "—"} icon={<XCircle className="h-3 w-3" />} />
                <DetailRow
                  label="Platform Fee"
                  value={costCents > 0
                    ? `₹${(costCents / 100).toFixed(2)}`
                    : (call.status === "completed" || call.status === "failed") ? "₹0.00" : "—"
                  }
                  icon={<Receipt className="h-3 w-3" />}
                />
                <DetailRow label="Execution ID" value={call.executionId ?? `—`} icon={<Hash className="h-3 w-3" />} />
              </CardContent>
            </Card>

            {/* Latency Metrics */}
            {(call.sttLatencyMs || call.llmLatencyMs || call.ttsFirstChunkMs) && (
              <Card>
                <CardHeader className="py-3 border-b">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <BarChart3 className="h-4 w-4 text-primary/70" />
                    Latency Metrics
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-3 space-y-2">
                  {call.sttLatencyMs && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-1.5 text-muted-foreground">
                        <Mic className="h-3 w-3" /> STT
                      </span>
                      <span className="font-mono">{call.sttLatencyMs >= 1000 ? `${(call.sttLatencyMs / 1000).toFixed(1)}s` : `${call.sttLatencyMs}ms`}</span>
                    </div>
                  )}
                  {call.llmLatencyMs && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-1.5 text-muted-foreground">
                        <Cpu className="h-3 w-3" /> LLM
                      </span>
                      <span className="font-mono">{call.llmLatencyMs >= 1000 ? `${(call.llmLatencyMs / 1000).toFixed(1)}s` : `${call.llmLatencyMs}ms`}</span>
                    </div>
                  )}
                  {call.ttsFirstChunkMs && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-1.5 text-muted-foreground">
                        <Volume2 className="h-3 w-3" /> TTS
                      </span>
                      <span className="font-mono">{call.ttsFirstChunkMs >= 1000 ? `${(call.ttsFirstChunkMs / 1000).toFixed(1)}s` : `${call.ttsFirstChunkMs}ms`}</span>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Disposition */}
            {dispositionSchema.length > 0 && (
              <Card>
                <CardHeader className="py-3 border-b">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <ClipboardList className="h-4 w-4 text-primary/70" />
                      Disposition
                    </CardTitle>
                    {!editing ? (
                      <Button variant="ghost" size="sm" className="h-6 gap-1 text-xs px-2" onClick={startEditing}>
                        <Pencil className="h-3 w-3" /> Edit
                      </Button>
                    ) : (
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setEditing(false)}>
                          <X className="h-3 w-3" />
                        </Button>
                        <Button size="sm" className="h-6 text-xs gap-1 px-2" onClick={saveDisposition} disabled={updateDisposition.isPending}>
                          <Check className="h-3 w-3" /> Save
                        </Button>
                      </div>
                    )}
                  </div>
                  {!dispositionResult && !editing && (
                    <CardDescription className="text-[10px] mt-1">
                      Extracted automatically after the call ends
                    </CardDescription>
                  )}
                </CardHeader>
                <CardContent className="p-0">
                  <div className="divide-y divide-border">
                    {dispositionSchema.map((field, i) => {
                      const value = dispositionResult?.[field.key];
                      return (
                        <div key={field.key} className={`py-2 px-4 ${i % 2 === 1 ? "bg-elevated/20" : ""}`}>
                          <p className="text-[10px] text-muted-foreground/50 mb-1">{field.label}</p>
                          {editing ? (
                            field.type === "boolean" ? (
                              <select
                                className="w-full text-xs border rounded px-2 py-1 bg-background"
                                value={edits[field.key] ?? ""}
                                onChange={e => setEdits(prev => ({ ...prev, [field.key]: e.target.value }))}
                              >
                                <option value="">—</option>
                                <option value="true">Yes</option>
                                <option value="false">No</option>
                              </select>
                            ) : field.type === "choice" && field.options?.length ? (
                              <select
                                className="w-full text-xs border rounded px-2 py-1 bg-background"
                                value={edits[field.key] ?? ""}
                                onChange={e => setEdits(prev => ({ ...prev, [field.key]: e.target.value }))}
                              >
                                <option value="">—</option>
                                {field.options.map(opt => (
                                  <option key={opt} value={opt}>{opt}</option>
                                ))}
                              </select>
                            ) : (
                              <Input
                                className="h-6 text-xs"
                                type={field.type === "number" ? "number" : "text"}
                                value={edits[field.key] ?? ""}
                                onChange={e => setEdits(prev => ({ ...prev, [field.key]: e.target.value }))}
                              />
                            )
                          ) : (
                            <div className="text-xs font-medium">
                              {value != null ? (
                                field.type === "boolean" ? (
                                  <Badge variant={value ? "default" : "secondary"} className="text-[10px] h-5">
                                    {value ? "Yes" : "No"}
                                  </Badge>
                                ) : (
                                  String(value)
                                )
                              ) : (
                                <span className="text-muted-foreground/40 text-[10px] italic">Not captured</span>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Transfer Info */}
            {(call as any).transferType && (
              <Card>
                <CardHeader className="py-3 border-b">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <UserCheck className="h-4 w-4 text-amber-500" />
                    Transfer
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-3 space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Type</span>
                    <Badge variant="outline" className="text-[10px] h-5 capitalize">{(call as any).transferType}</Badge>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Target</span>
                    <span className="font-mono">{(call as any).transferTarget}</span>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Booking Info */}
            {(call as any).bookingStatus && (
              <Card>
                <CardHeader className="py-3 border-b">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-violet-500" />
                    Booking
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-3 space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Status</span>
                    <Badge variant="outline" className="text-[10px] h-5">{(call as any).bookingStatus}</Badge>
                  </div>
                  {(call as any).bookingDate && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Date</span>
                      <span>{(call as any).bookingDate}</span>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Callback Info */}
            {(call as any).callbackRequested && (
              <Card>
                <CardHeader className="py-3 border-b">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Clock className="h-4 w-4 text-orange-500" />
                    Callback
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-3 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Requested At</span>
                    <span className="font-mono">{(call as any).callbackTime}</span>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
