import React, { useState } from "react";
import { Link, useParams } from "wouter";
import { format, parseISO } from "date-fns";
import { ArrowLeft, Download, FileText, AlertTriangle, Info, Bot, User, Receipt, Sparkles, ClipboardList, Pencil, Check, X, Zap, ChevronDown, ChevronUp } from "lucide-react";
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
        className="flex items-start gap-2 px-3 py-2 rounded-md bg-muted/40 border border-border/60 my-1"
      >
        <Zap className="h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-500" />
        <span className="font-mono text-xs text-muted-foreground leading-relaxed break-all">
          {line}
        </span>
      </div>
    );
  }

  return (
    <div key={index} className="font-mono text-sm leading-relaxed whitespace-pre-wrap">
      {line}
    </div>
  );
}

function ToolEventRow({ event }: { event: ToolEvent }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = event.result.length > 120;
  const displayResult = !isLong || expanded ? event.result : event.result.slice(0, 120) + "…";

  return (
    <div className="p-3 border-b border-border last:border-0">
      <div className="flex items-center gap-2 flex-wrap">
        <Zap className="h-3.5 w-3.5 shrink-0 text-amber-500" />
        <Badge variant="outline" className="font-mono text-xs px-2 py-0 h-5">
          {event.toolName}
        </Badge>
        {event.status === "success" ? (
          <Badge variant="default" className="text-xs h-5 px-2 py-0 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-transparent hover:bg-emerald-500/20">
            Success
          </Badge>
        ) : (
          <Badge variant="destructive" className="text-xs h-5 px-2 py-0 bg-destructive/15 text-destructive border-transparent hover:bg-destructive/20">
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

  const getStatusBadge = (status: string) => {
    switch(status) {
      case "completed": return <Badge variant="default" className="bg-primary/20 text-primary hover:bg-primary/30 border-transparent">Completed</Badge>;
      case "failed": return <Badge variant="destructive" className="bg-destructive/20 text-destructive hover:bg-destructive/30 border-transparent">Failed</Badge>;
      case "in_progress": return <Badge variant="secondary" className="bg-muted text-foreground dark:text-zinc-400 hover:bg-zinc-500/30 border-transparent animate-pulse">In Progress</Badge>;
      case "pending": return <Badge variant="outline" className="text-muted-foreground">Pending</Badge>;
      case "cancelled": return <Badge variant="outline" className="bg-muted text-muted-foreground border-transparent">Cancelled</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  if (isLoading) {
    return (
      <div className="p-8 space-y-6">
        <Skeleton className="h-10 w-[200px]" />
        <div className="grid grid-cols-3 gap-6">
          <Skeleton className="col-span-2 h-[400px] w-full" />
          <Skeleton className="col-span-1 h-[400px] w-full" />
        </div>
      </div>
    );
  }

  if (!call) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        Call not found.
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
  const evalReason  = rawEval ? rawEval.split(/\r?\n/).slice(1).join(" ").trim() : undefined;
  const evalIsPass  = evalVerdict?.startsWith("PASS");
  const evalIsFail  = evalVerdict?.startsWith("FAIL");

  return (
    <div className="flex-1 space-y-6 p-6 md:p-8 pt-6 h-full flex flex-col">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Link href="/app/calls">
            <Button variant="outline" size="icon" className="h-8 w-8">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-2xl font-bold tracking-tight">Call Log #{call.id}</h2>
              {getStatusBadge(call.status)}
            </div>
            <p className="text-muted-foreground text-sm flex items-center gap-2 mt-1">
              {format(parseISO(call.createdAt), "MMM d, yyyy 'at' h:mm:ss a")}
              <span>•</span>
              Agent: <Link href={`/app/agents/${call.agentId}`}><span className="text-primary hover:underline font-medium cursor-pointer">{call.agentName}</span></Link>
            </p>
          </div>
        </div>
        {call.recordingUrl && (
          <div className="flex items-center gap-2">
            <audio
              controls
              src={call.recordingUrl}
              className="h-8 max-w-xs rounded"
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
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1 min-h-0">
        {/* Left Column: Transcript */}
        <Card className="col-span-1 lg:col-span-2 flex flex-col h-[calc(100vh-140px)]">
          <CardHeader className="py-4 border-b">
            <CardTitle className="flex items-center gap-2 text-lg">
              <FileText className="h-5 w-5 text-primary" />
              Transcript
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 flex-1 overflow-auto bg-muted/10">
            {call.status === "failed" && call.errorMessage && (
              <div className="m-4 p-4 bg-destructive/10 border border-destructive/20 rounded-md flex items-start gap-3 text-destructive">
                <AlertTriangle className="h-5 w-5 mt-0.5 shrink-0" />
                <div>
                  <h4 className="font-semibold text-sm">Call Failed</h4>
                  <p className="text-sm mt-1 opacity-90">{call.errorMessage}</p>
                </div>
              </div>
            )}

            {/* Success Evaluation */}
            {(evalIsPass || evalIsFail) && (
              <div className={`mx-4 mt-4 p-4 rounded-lg border ${evalIsPass ? "bg-muted border-border" : "bg-muted border-border"}`}>
                <div className={`flex items-center gap-2 mb-1 text-sm font-semibold ${evalIsPass ? "text-foreground" : "text-foreground"}`}>
                  {evalIsPass ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
                  AI Evaluation: {evalIsPass ? "PASS" : "FAIL"}
                </div>
                {evalReason && (
                  <p className={`text-xs leading-relaxed ${evalIsPass ? "text-foreground" : "text-foreground"}`}>{evalReason}</p>
                )}
              </div>
            )}

            {/* AI Summary */}
            {callSummary && (
              <div className="mx-4 mt-4 p-4 bg-primary/5 border border-primary/20 rounded-lg">
                <div className="flex items-center gap-2 mb-2 text-primary text-sm font-semibold">
                  <Sparkles className="h-4 w-4" /> AI Summary
                </div>
                <div className="text-sm text-muted-foreground whitespace-pre-line leading-relaxed">
                  {callSummary}
                </div>
              </div>
            )}

            <div className="p-6 space-y-1">
              {!call.transcript ? (
                <div className="text-center text-muted-foreground py-10 italic">
                  No transcript available for this call.
                </div>
              ) : isJsonTranscript ? (
                <div className="space-y-6">
                  {transcriptLines.map((line, i) => (
                    <div key={i} className={`flex gap-4 ${line.role === 'user' ? 'flex-row-reverse' : ''}`}>
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${line.role === 'user' ? 'bg-secondary' : 'bg-primary/20 text-primary'}`}>
                        {line.role === 'user' ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
                      </div>
                      <div className={`max-w-[80%] rounded-2xl p-4 ${line.role === 'user' ? 'bg-secondary text-secondary-foreground rounded-tr-sm' : 'bg-card border border-border shadow-sm rounded-tl-sm'}`}>
                        <p className="text-sm leading-relaxed">{line.content}</p>
                        {line.timestamp && (
                          <span className="text-[10px] text-muted-foreground mt-2 block opacity-70">
                            {line.timestamp}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-4 bg-card rounded-md border border-border space-y-0.5">
                  {plainLines.map((line, i) => (
                    <PlainTranscriptLine key={i} line={line} index={i} />
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Right Column: Metadata */}
        <div className="space-y-4 overflow-auto h-[calc(100vh-140px)]">
          {/* Call Details */}
          <Card>
            <CardHeader className="py-4 border-b">
              <CardTitle className="text-lg flex items-center gap-2">
                <Info className="h-5 w-5 text-primary" />
                Call Details
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <dl className="divide-y divide-border text-sm">
                <div className="grid grid-cols-3 p-4">
                  <dt className="text-muted-foreground font-medium">To Number</dt>
                  <dd className="col-span-2 font-mono text-right">{call.toNumber}</dd>
                </div>
                <div className="grid grid-cols-3 p-4 bg-muted/20">
                  <dt className="text-muted-foreground font-medium">From Number</dt>
                  <dd className="col-span-2 font-mono text-right">{call.fromNumber}</dd>
                </div>
                <div className="grid grid-cols-3 p-4">
                  <dt className="text-muted-foreground font-medium">Duration</dt>
                  <dd className="col-span-2 text-right font-mono font-medium text-primary">
                    {formatDuration(call.durationSeconds)}
                  </dd>
                </div>
                <div className="grid grid-cols-3 p-4 bg-muted/20">
                  <dt className="text-muted-foreground font-medium">Started</dt>
                  <dd className="col-span-2 text-right">{format(parseISO(call.createdAt), "HH:mm:ss")}</dd>
                </div>
                <div className="grid grid-cols-3 p-4">
                  <dt className="text-muted-foreground font-medium">Ended</dt>
                  <dd className="col-span-2 text-right">
                    {call.endedAt ? format(parseISO(call.endedAt), "HH:mm:ss") : "-"}
                  </dd>
                </div>
                {(call.costCents != null && call.costCents > 0) && (
                  <div className="grid grid-cols-3 p-4 bg-muted/20">
                    <dt className="text-muted-foreground font-medium flex items-center gap-1.5">
                      <Receipt className="h-3.5 w-3.5" /> Platform fee
                    </dt>
                    <dd className="col-span-2 text-right font-mono font-medium text-zinc-500">
                      ${(call.costCents / 100).toFixed(3)}
                    </dd>
                  </div>
                )}
              </dl>
            </CardContent>
          </Card>

          {/* Tool Calls */}
          <Card>
            <CardHeader className="py-3 border-b">
              <CardTitle className="text-base flex items-center gap-2">
                <Zap className="h-4 w-4 text-amber-500" />
                Tool Calls
                {toolEvents.length > 0 && (
                  <Badge variant="secondary" className="ml-auto text-xs h-5 px-2">
                    {toolEvents.length}
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {toolEvents.length === 0 ? (
                <p className="px-4 py-5 text-xs text-muted-foreground italic text-center">
                  No tool calls during this call.
                </p>
              ) : (
                <div>
                  {toolEvents.map((event, i) => (
                    <ToolEventRow key={i} event={event} />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Disposition */}
          {dispositionSchema.length > 0 && (
            <Card>
              <CardHeader className="py-3 border-b">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <ClipboardList className="h-4 w-4 text-primary" />
                    Disposition
                  </CardTitle>
                  {!editing ? (
                    <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={startEditing}>
                      <Pencil className="h-3 w-3" /> Override
                    </Button>
                  ) : (
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditing(false)}>
                        <X className="h-3 w-3" />
                      </Button>
                      <Button size="sm" className="h-7 text-xs gap-1" onClick={saveDisposition} disabled={updateDisposition.isPending}>
                        <Check className="h-3 w-3" /> Save
                      </Button>
                    </div>
                  )}
                </div>
                {!dispositionResult && !editing && (
                  <CardDescription className="text-xs mt-1">
                    Extracted automatically after the call ends.
                  </CardDescription>
                )}
              </CardHeader>
              <CardContent className="p-0">
                <dl className="divide-y divide-border text-sm">
                  {dispositionSchema.map((field, i) => {
                    const value = dispositionResult?.[field.key];
                    return (
                      <div key={field.key} className={`p-3 ${i % 2 === 1 ? "bg-muted/20" : ""}`}>
                        <dt className="text-xs text-muted-foreground font-medium mb-1">{field.label}</dt>
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
                              className="h-7 text-xs"
                              type={field.type === "number" ? "number" : "text"}
                              value={edits[field.key] ?? ""}
                              onChange={e => setEdits(prev => ({ ...prev, [field.key]: e.target.value }))}
                            />
                          )
                        ) : (
                          <dd className="font-medium text-sm">
                            {value != null ? (
                              field.type === "boolean" ? (
                                <Badge variant={value ? "default" : "secondary"} className="text-xs">
                                  {value ? "Yes" : "No"}
                                </Badge>
                              ) : (
                                String(value)
                              )
                            ) : (
                              <span className="text-muted-foreground/50 text-xs italic">Not captured</span>
                            )}
                          </dd>
                        )}
                      </div>
                    );
                  })}
                </dl>
              </CardContent>
            </Card>
          )}

          {/* Metadata */}
          {call.metadata && (
            <Card>
              <CardHeader className="py-4 border-b">
                <CardTitle className="text-lg">Metadata</CardTitle>
                <CardDescription>Provider-specific data</CardDescription>
              </CardHeader>
              <CardContent className="p-4">
                <pre className="text-xs font-mono bg-muted/50 p-4 rounded-md overflow-x-auto border">
                  {call.metadata}
                </pre>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
