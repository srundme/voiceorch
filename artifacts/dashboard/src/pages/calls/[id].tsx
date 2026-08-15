import { useState, useEffect, useRef } from "react";
import { Link, useParams, useLocation } from "wouter";
import { format, parseISO } from "date-fns";
import {
  Download, FileText, AlertTriangle, Info, Bot, User,
  Receipt, Sparkles, ClipboardList, Pencil, Check, X, Zap,
  ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Phone, Calendar, Clock, TrendingUp,
  BarChart3, Mic, Cpu, Volume2, Hash, ArrowRight, ArrowUpRight, UserCheck,
  Voicemail, BookOpen, Tag, Activity, ExternalLink, Copy, CheckCircle2,
  XCircle, PlayCircle, PauseCircle, MicOff, ScrollText, Video,
  Play, Pause, MoreVertical, VolumeX, Gauge
} from "lucide-react";
import {
  useGetCall,
  useGetAgent,
  useUpdateCallDisposition,
  useGetCallCallerMemory,
  getGetCallQueryKey,
  getGetAgentQueryKey,
  getGetCallCallerMemoryQueryKey,
  getClientContext,
} from "@workspace/api-client-react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { getExecutionId } from "@/lib/execution-id";
import { Button } from "@/components/ui/button";
import { DetailNav } from "@/components/detail-nav";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { formatApiError } from "@/lib/format-api-error";
import { uiTypeFromStored, type StoredDomainField } from "@/lib/disposition-fields";
import {
  getDispositionConfidence,
  getDispositionSummary,
  getDispositionValues,
} from "@/lib/disposition-display";
import { stripTranscriptMarkup } from "@/lib/transcript-display";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Slider } from "@/components/ui/slider";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuPortal,
} from "@/components/ui/dropdown-menu";

interface ToolEvent {
  toolName: string;
  args: Record<string, unknown> | null;
  result: string | null;
  status: "success" | "error" | "pending";
  durationMs: number | null;
  turnNumber: number | null;
  errorMessage: string | null;
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
      events.push({ toolName, args: null, result, status, durationMs: null, turnNumber: null, errorMessage: null });
    }
  }
  return events;
}

function PlainTranscriptLine({ line, index }: { line: string; index: number }) {
  const isToolCall = TOOL_CALL_RE.test(line);
  const isToolResult = TOOL_RESULT_RE.test(line);

  if (isToolCall || isToolResult) {
    return (
      <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-amber-500/5 border border-amber-500/10 my-1">
        <Zap className="h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-500" />
        <span className="font-mono text-xs text-muted-foreground leading-relaxed break-all">{line}</span>
      </div>
    );
  }

  const agentMatch = line.match(/^Agent:\s*([\s\S]*)/);
  const callerMatch = line.match(/^Caller:\s*([\s\S]*)/);

  if (agentMatch) {
    const content = stripTranscriptMarkup(agentMatch[1] ?? "");
    if (!content) return null;
    return (
      <div className="flex gap-2.5 items-start">
        <div className="w-6 h-6 rounded-full bg-primary/15 flex items-center justify-center shrink-0 mt-0.5">
          <Bot className="h-3 w-3 text-primary" />
        </div>
        <div className="flex-1 max-w-[78%]">
          <span className="text-[10px] font-semibold text-primary/70 uppercase tracking-wide mb-1 block">Agent</span>
          <div className="bg-primary/8 border border-primary/15 rounded-xl rounded-tl-sm px-3 py-2">
            <p className="text-xs leading-relaxed text-foreground whitespace-pre-wrap">{content}</p>
          </div>
        </div>
      </div>
    );
  }

  if (callerMatch) {
    const content = stripTranscriptMarkup(callerMatch[1] ?? "");
    if (!content) return null;
    return (
      <div className="flex gap-2.5 items-start flex-row-reverse">
        <div className="w-6 h-6 rounded-full bg-secondary flex items-center justify-center shrink-0 mt-0.5">
          <User className="h-3 w-3 text-secondary-foreground" />
        </div>
        <div className="flex-1 max-w-[78%] flex flex-col items-end">
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1 block">Caller</span>
          <div className="bg-secondary border border-border rounded-xl rounded-tr-sm px-3 py-2">
            <p className="text-xs leading-relaxed text-secondary-foreground whitespace-pre-wrap">{content}</p>
          </div>
        </div>
      </div>
    );
  }

  // Fallback for lines without a role prefix
  if (line.trim() === "") return null;
  return (
    <div className="font-mono text-xs text-muted-foreground/50 leading-relaxed whitespace-pre-wrap px-1">{line}</div>
  );
}

function ToolEventRow({ event }: { event: ToolEvent }) {
  const [expanded, setExpanded] = useState(false);
  const hasArgs = !!event.args && Object.keys(event.args).length > 0;
  const isExpandable = hasArgs || !!event.result || !!event.errorMessage;

  return (
    <div className="border-b border-border last:border-0">
      <div
        className={`flex items-start gap-2.5 p-3 transition-colors ${isExpandable ? "cursor-pointer hover:bg-elevated/20" : ""}`}
        onClick={() => isExpandable && setExpanded(v => !v)}
      >
        <Zap className="h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-500" />
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className="font-mono text-xs px-2 py-0 h-5 border-amber-500/20">
              {event.toolName}
            </Badge>
            {event.turnNumber != null && (
              <span className="text-[10px] font-mono text-muted-foreground/40">turn #{event.turnNumber}</span>
            )}
            {event.durationMs != null && (
              <span className="text-[10px] font-mono text-muted-foreground/40">{event.durationMs}ms</span>
            )}
            <span className={`ml-auto text-[10px] font-semibold px-1.5 py-0.5 rounded border ${
              event.status === "success" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20" :
              event.status === "error"   ? "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20" :
                                          "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/20"
            }`}>
              {event.status}
            </span>
          </div>
          {!expanded && event.result && (
            <p className="text-xs text-muted-foreground/60 truncate font-mono">{event.result}</p>
          )}
          {!expanded && event.errorMessage && (
            <p className="text-xs text-red-700 dark:text-red-400/70 truncate font-mono">{event.errorMessage}</p>
          )}
        </div>
        {isExpandable && (
          <ChevronDown className={`h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground/30 transition-transform ${expanded ? "rotate-180" : ""}`} />
        )}
      </div>
      {expanded && (
        <div className="px-3 pb-3 space-y-2 ml-[26px]">
          {hasArgs && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground/40 mb-1">Args</p>
              <pre className="text-[11px] font-mono text-muted-foreground/70 bg-elevated/50 border border-border rounded p-2 overflow-x-auto whitespace-pre-wrap break-all">
                {JSON.stringify(event.args, null, 2)}
              </pre>
            </div>
          )}
          {event.result && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground/40 mb-1">Result</p>
              <pre className="text-[11px] font-mono text-muted-foreground/70 bg-elevated/50 border border-border rounded p-2 whitespace-pre-wrap break-all">
                {event.result}
              </pre>
            </div>
          )}
          {event.errorMessage && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-red-700 dark:text-red-400/60 mb-1">Error</p>
              <pre className="text-[11px] font-mono text-red-700 dark:text-red-400/70 bg-red-500/5 border border-red-500/15 rounded p-2 whitespace-pre-wrap">
                {event.errorMessage}
              </pre>
            </div>
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

interface ExecutionLogEvent {
  id: number;
  callId: number;
  agentId: number | null;
  ts: string;
  component: string;
  provider: string | null;
  direction: string;
  status: string;
  latencyMs: number | null;
  requestPayload: Record<string, unknown> | null;
  responsePayload: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
}

// The -300/-400 text tones only carry contrast against a dark surface; on the
// light theme they wash out against the tinted background. Pair every badge
// with a darker light-mode tone.
const COMPONENT_COLORS: Record<string, string> = {
  Agent:            "bg-slate-500/15   text-slate-700   dark:text-slate-300   border-slate-500/30",
  STT:              "bg-violet-500/15  text-violet-700  dark:text-violet-300  border-violet-500/30",
  LLM:              "bg-amber-500/15   text-amber-700   dark:text-amber-300   border-amber-500/30",
  TTS:              "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
  Tool:             "bg-orange-500/15  text-orange-700  dark:text-orange-300  border-orange-500/30",
  Memory:           "bg-sky-500/15     text-sky-700     dark:text-sky-300     border-sky-500/30",
  Knowledge:        "bg-teal-500/15    text-teal-700    dark:text-teal-300    border-teal-500/30",
  VariableResolver: "bg-pink-500/15    text-pink-700    dark:text-pink-300    border-pink-500/30",
  Webhook:          "bg-rose-500/15    text-rose-700    dark:text-rose-300    border-rose-500/30",
};
const DIRECTION_COLORS: Record<string, string> = {
  request:  "bg-blue-500/15  text-blue-700  dark:text-blue-300  border-blue-500/25",
  response: "bg-green-500/15 text-green-700 dark:text-green-300 border-green-500/25",
  system:   "bg-gray-500/15  text-gray-700  dark:text-gray-400  border-gray-500/25",
};

const PREVIEW_MAX = 160;

interface LogEnrichment {
  turnNumber?: number;
  relatedTurnId?: number;
  durationMs?: number;
  retryCount?: number;
  warningFlags?: string[];
  errorMessage?: string;
  errorCode?: string | number;
  event?: string;
  callEnded?: CallEndedSummary;
}

interface CallEndedSummary {
  reason: string;
  reasonLabel: string;
  component: string;
  provider: string | null;
  errorCode: string | number | null;
  errorMessage: string | null;
  expected: boolean;
  retryAttempted: boolean;
  fallbackAttempted: boolean;
  recoverySucceeded: boolean | null;
  outcome: string;
  durationSeconds: number;
  turns: number;
  lastComponent?: string | null;
  lastUserTranscript?: string | null;
  lastAgentResponse?: string | null;
  recordingStatus?: string | null;
  warningCount?: number;
  errorCount?: number;
  retryCount?: number;
  fallbackCount?: number;
}

function getEnrichment(entry: ExecutionLogEvent): LogEnrichment {
  const md = (entry.metadata ?? {}) as Record<string, unknown>;
  return {
    turnNumber: md["turnNumber"] as number | undefined,
    relatedTurnId: md["relatedTurnId"] as number | undefined,
    durationMs: md["durationMs"] as number | undefined,
    retryCount: md["retryCount"] as number | undefined,
    warningFlags: md["warningFlags"] as string[] | undefined,
    errorMessage: (md["errorMessage"] as string | undefined) ?? (md["error"] as string | undefined),
    errorCode: md["errorCode"] as string | number | undefined,
    event: md["event"] as string | undefined,
    callEnded: md["callEnded"] as CallEndedSummary | undefined,
  };
}

function getLogPreview(entry: ExecutionLogEvent): string | null {
  const rq = entry.requestPayload as Record<string, unknown> | null;
  const rs = entry.responsePayload as Record<string, unknown> | null;
  const md = entry.metadata as Record<string, unknown> | null;
  const { component, direction } = entry;

  // Named pipeline events (First Token Received, Provider Fallback, Barge-in
  // Detected, Call Ended, Provider Initialized, Voice Loaded, Prompt Generated)
  // carry a human label under metadata.event — surface it directly.
  const evt = md?.event as string | undefined;
  if (evt) {
    const ce = md?.callEnded as CallEndedSummary | undefined;
    if (ce) return `${ce.reasonLabel} · ${ce.outcome} · ${ce.durationSeconds.toFixed(1)}s · ${ce.turns} turns`;
    const extras: string[] = [];
    if (typeof md?.ttftMs === "number") extras.push(`${md.ttftMs}ms`);
    if (typeof md?.fromProvider === "string" && typeof md?.toProvider === "string") extras.push(`${md.fromProvider} → ${md.toProvider}`);
    if (typeof md?.reason === "string") extras.push(md.reason as string);
    if (typeof md?.voice === "string") extras.push(md.voice as string);
    if (typeof md?.promptHash === "string") extras.push(`sha256:${(md.promptHash as string).slice(0, 12)}`);
    return [evt, extras.join(" · ")].filter(Boolean).join(" — ") || evt;
  }

  if (component === "STT" && direction === "response")
    return (rs?.transcript as string) ?? null;

  if (component === "LLM" && direction === "response")
    return (rs?.text as string) ?? null;

  if (component === "LLM" && direction === "request") {
    const preview = (rq?.systemPromptPreview as string) ?? null;
    const model   = rq?.model as string | undefined;
    const hist    = rq?.historyLength as number | undefined;
    const tools   = (rq?.tools as string[])?.join(", ");
    const meta = [model, hist != null ? `${hist} msgs` : null, tools ? `tools: ${tools}` : null].filter(Boolean).join(" · ");
    return [meta, preview].filter(Boolean).join("\n") || null;
  }

  if (component === "TTS" && direction === "request")
    return (rq?.text as string) ?? null;

  if (component === "TTS" && direction === "response") {
    const bytes = rs?.audioBytes as number | undefined;
    const len   = rs?.textLength as number | undefined;
    return [bytes != null ? `${(bytes / 1024).toFixed(1)} KB audio` : null, len != null ? `${len} chars` : null].filter(Boolean).join(", ") || null;
  }

  if (component === "Memory" && direction === "response") {
    const factCount = rs?.factCount as number | undefined;
    const profile   = rs?.profile as Record<string, unknown> | undefined;
    const name      = profile?.name as string | undefined;
    const parts = [name ? `caller: ${name}` : null, factCount != null ? `${factCount} facts` : null].filter(Boolean);
    const facts = rs?.facts as Record<string, unknown> | undefined;
    if (facts) {
      const items = Object.entries(facts).slice(0, 3).map(([k, v]) => `${k}: ${v}`);
      parts.push(...items);
    }
    return parts.join(" · ") || null;
  }

  if (component === "Knowledge" && direction === "response") {
    const count   = rs?.chunksCount as number | undefined;
    const sources = rs?.sources as string[] | undefined;
    return [count != null ? `${count} chunks` : null, sources?.slice(0, 2).join(", ")].filter(Boolean).join(" — ") || null;
  }

  if (component === "VariableResolver") {
    const preview = (rs?.resolvedPromptPreview as string) ?? (rq?.variables ? `vars: ${Object.keys(rq.variables as object).join(", ")}` : null);
    return preview ?? null;
  }

  if (component === "Tool" && direction === "request") {
    const tool = rq?.tool as string | undefined;
    const args = rq?.args;
    return [tool, args != null ? JSON.stringify(args).substring(0, 80) : null].filter(Boolean).join(" ") || null;
  }

  if (component === "Tool" && direction === "response") {
    return (rs?.result as string) ?? (rs?.error as string) ?? (md?.error as string) ?? null;
  }

  if (component === "Agent") {
    const name = rq?.agentName as string | undefined;
    const asr  = rq?.asrProvider as string | undefined;
    const llm  = rq?.llmProvider as string | undefined;
    const tts  = rq?.ttsProvider as string | undefined;
    const dur  = rq?.durationMs as number | undefined;
    if (dur != null) return `Call ended · ${(dur / 1000).toFixed(1)}s`;
    return [name, [asr, llm, tts].filter(Boolean).join(" · ")].filter(Boolean).join(" — ") || null;
  }

  return null;
}

function LogDataCell({ preview }: { preview: string | null }) {
  const [expanded, setExpanded] = useState(false);
  if (!preview) return <span className="text-muted-foreground/40 text-xs">—</span>;
  const isLong = preview.length > PREVIEW_MAX;
  const shown  = !isLong || expanded ? preview : preview.slice(0, PREVIEW_MAX) + "…";
  return (
    <div className="min-w-0" onClick={e => { if (isLong) { e.stopPropagation(); setExpanded(v => !v); } }}>
      <span className="text-foreground/80 text-xs leading-relaxed whitespace-pre-wrap break-words">{shown}</span>
      {isLong && (
        <button className="ml-1.5 text-[10px] text-primary/60 hover:text-primary underline-offset-2 hover:underline whitespace-nowrap">
          {expanded ? <><ChevronUp className="h-3 w-3 inline" /> Show less</> : <><ChevronDown className="h-3 w-3 inline" /> Show more</>}
        </button>
      )}
    </div>
  );
}

function JsonViewer({ data }: { data: Record<string, unknown> }) {
  const [copied, setCopied] = useState(false);
  const str = JSON.stringify(data, null, 2);
  return (
    <div className="relative group">
      <button
        onClick={() => { navigator.clipboard.writeText(str); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
        className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity bg-muted hover:bg-muted rounded px-1.5 py-0.5 text-[9px] text-foreground/80 font-mono"
      >
        {copied ? "copied!" : "copy"}
      </button>
      <pre className="text-[11px] font-mono text-foreground/85 bg-muted rounded p-3 overflow-x-auto whitespace-pre-wrap break-all leading-relaxed border border-border">
        {str}
      </pre>
    </div>
  );
}

const LOG_GRID_COLUMNS = "120px 46px minmax(0,1fr) 80px 110px 90px 64px 56px 16px";

const OUTCOME_STYLE: Record<string, { dot: string; text: string; ring: string }> = {
  Completed:         { dot: "bg-emerald-400", text: "text-emerald-700 dark:text-emerald-300", ring: "border-emerald-500/30 bg-emerald-500/[0.07]" },
  Transferred:       { dot: "bg-sky-400",     text: "text-sky-700 dark:text-sky-300",     ring: "border-sky-500/30 bg-sky-500/[0.07]" },
  "Call Terminated": { dot: "bg-slate-400",   text: "text-slate-700 dark:text-slate-300",   ring: "border-slate-500/30 bg-slate-500/[0.07]" },
  Timeout:           { dot: "bg-amber-400",   text: "text-amber-700 dark:text-amber-300",   ring: "border-amber-500/30 bg-amber-500/[0.07]" },
  Error:             { dot: "bg-red-400",     text: "text-red-700 dark:text-red-300",     ring: "border-red-500/30 bg-red-500/[0.07]" },
};

function CallEndedCard({ summary }: { summary: CallEndedSummary }) {
  const st = OUTCOME_STYLE[summary.outcome] ?? OUTCOME_STYLE["Error"]!;
  const chips: { label: string; value: string }[] = [
    { label: "Outcome", value: summary.outcome },
    { label: "Duration", value: `${summary.durationSeconds.toFixed(1)}s` },
    { label: "Turns", value: String(summary.turns) },
    ...(summary.component ? [{ label: "Triggered by", value: summary.component }] : []),
    ...(summary.provider ? [{ label: "Provider", value: summary.provider }] : []),
    ...(summary.lastComponent ? [{ label: "Last active", value: summary.lastComponent }] : []),
    ...(summary.recordingStatus && summary.recordingStatus !== "disabled"
      ? [{ label: "Recording", value: summary.recordingStatus }]
      : []),
  ];
  const warningCount = summary.warningCount ?? 0;
  const errorCount = summary.errorCount ?? 0;
  const retryCount = summary.retryCount ?? 0;
  const fallbackCount = summary.fallbackCount ?? 0;
  const hasHealth = warningCount > 0 || errorCount > 0 || retryCount > 0 || fallbackCount > 0;
  return (
    <div className={`mx-3 my-3 rounded-lg border ${st.ring} p-3.5`}>
      <div className="flex items-center gap-2 mb-2">
        <span className={`h-2 w-2 rounded-full ${st.dot}`} />
        <span className={`text-sm font-semibold ${st.text}`}>Call Ended — {summary.reasonLabel}</span>
        {!summary.expected && (
          <span className="ml-auto inline-flex items-center rounded bg-red-500/20 text-red-700 dark:text-red-300 border border-red-500/30 text-[9px] font-bold uppercase px-1.5 py-0.5">
            Unexpected
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1.5">
        {chips.map(c => (
          <div key={c.label} className="flex flex-col">
            <span className="text-[9px] uppercase tracking-widest text-muted-foreground/50 font-semibold">{c.label}</span>
            <span className="text-xs text-foreground/85 font-medium">{c.value}</span>
          </div>
        ))}
      </div>
      {(summary.errorMessage || summary.retryAttempted || summary.fallbackAttempted || summary.recoverySucceeded != null) && (
        <div className="flex flex-wrap items-center gap-1.5 mt-2.5 pt-2.5 border-t border-border">
          {summary.errorMessage && (
            <span className="inline-flex items-center rounded bg-red-500/15 text-red-700 dark:text-red-300/90 border border-red-500/25 text-[10px] font-medium px-1.5 py-0.5">
              {summary.errorCode != null ? `[${summary.errorCode}] ` : ""}{summary.errorMessage}
            </span>
          )}
          {summary.retryAttempted && (
            <span className="inline-flex items-center rounded bg-orange-500/15 text-orange-700 dark:text-orange-300/80 border border-orange-500/25 text-[10px] font-medium px-1.5 py-0.5">↻ retry attempted</span>
          )}
          {summary.fallbackAttempted && (
            <span className="inline-flex items-center rounded bg-amber-500/15 text-amber-700 dark:text-amber-300/80 border border-amber-500/25 text-[10px] font-medium px-1.5 py-0.5">⤳ fallback attempted</span>
          )}
          {summary.recoverySucceeded != null && (
            <span className={`inline-flex items-center rounded text-[10px] font-medium px-1.5 py-0.5 border ${summary.recoverySucceeded ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300/80 border-emerald-500/25" : "bg-red-500/15 text-red-700 dark:text-red-300/80 border-red-500/25"}`}>
              {summary.recoverySucceeded ? <><CheckCircle2 className="h-3 w-3 inline mr-0.5" />recovered</> : <><XCircle className="h-3 w-3 inline mr-0.5" />recovery failed</>}
            </span>
          )}
        </div>
      )}
      {hasHealth && (
        <div className="flex flex-wrap items-center gap-1.5 mt-2.5 pt-2.5 border-t border-border">
          {errorCount > 0 && (
            <span className="inline-flex items-center rounded bg-red-500/15 text-red-700 dark:text-red-300/90 border border-red-500/25 text-[10px] font-medium px-1.5 py-0.5">{errorCount} error{errorCount === 1 ? "" : "s"}</span>
          )}
          {warningCount > 0 && (
            <span className="inline-flex items-center rounded bg-yellow-500/15 text-yellow-700 dark:text-yellow-300/90 border border-yellow-500/25 text-[10px] font-medium px-1.5 py-0.5">{warningCount} warning{warningCount === 1 ? "" : "s"}</span>
          )}
          {retryCount > 0 && (
            <span className="inline-flex items-center rounded bg-orange-500/15 text-orange-700 dark:text-orange-300/80 border border-orange-500/25 text-[10px] font-medium px-1.5 py-0.5">↻ {retryCount} retr{retryCount === 1 ? "y" : "ies"}</span>
          )}
          {fallbackCount > 0 && (
            <span className="inline-flex items-center rounded bg-amber-500/15 text-amber-700 dark:text-amber-300/80 border border-amber-500/25 text-[10px] font-medium px-1.5 py-0.5">⤳ {fallbackCount} fallback{fallbackCount === 1 ? "" : "s"}</span>
          )}
        </div>
      )}
      {(summary.lastUserTranscript || summary.lastAgentResponse) && (
        <div className="mt-2.5 pt-2.5 border-t border-border space-y-1.5">
          {summary.lastUserTranscript && (
            <div className="flex flex-col gap-0.5">
              <span className="text-[9px] uppercase tracking-widest text-muted-foreground/50 font-semibold">Last caller</span>
              <span className="text-xs text-foreground/80 italic">"{summary.lastUserTranscript}"</span>
            </div>
          )}
          {summary.lastAgentResponse && (
            <div className="flex flex-col gap-0.5">
              <span className="text-[9px] uppercase tracking-widest text-muted-foreground/50 font-semibold">Last agent</span>
              <span className="text-xs text-foreground/80 italic">"{summary.lastAgentResponse}"</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ExecLogRow({ entry }: { entry: ExecutionLogEvent }) {
  const [expanded, setExpanded] = useState(false);
  // Local time, matching the header and Call Details panel. toISOString() here
  // rendered UTC, so an IST call started at 18:33 logged its first event at 13:03.
  const ts = format(parseISO(entry.ts), "HH:mm:ss.SSS");
  const compCls = COMPONENT_COLORS[entry.component] ?? "bg-gray-500/15 text-gray-700 dark:text-gray-400 border-gray-500/25";
  const dirCls  = DIRECTION_COLORS[entry.direction] ?? "bg-gray-500/15 text-gray-700 dark:text-gray-400 border-gray-500/25";
  const hasPayload = !!(entry.requestPayload || entry.responsePayload || entry.metadata);
  const en = getEnrichment(entry);
  const durMs = en.durationMs ?? entry.latencyMs ?? null;
  return (
    <div className={`border-b border-border ${hasPayload ? "cursor-pointer hover:bg-muted/40" : ""}`}>
      <div
        className="grid items-start gap-2 px-3 py-2.5 text-xs select-none"
        style={{ gridTemplateColumns: LOG_GRID_COLUMNS }}
        onClick={() => { if (hasPayload) setExpanded(e => !e); }}
      >
        <span className="font-mono text-muted-foreground/70 tabular-nums pt-0.5">{ts}</span>
        <span className="font-mono text-cyan-700 dark:text-cyan-300/50 tabular-nums text-center pt-0.5">
          {en.turnNumber != null ? `#${en.turnNumber}` : <span className="text-muted-foreground/40">—</span>}
        </span>
        <div className="min-w-0">
          <LogDataCell preview={getLogPreview(entry)} />
          {(en.warningFlags?.length || en.retryCount || en.errorMessage) && (
            <div className="flex flex-wrap items-center gap-1 mt-1">
              {en.warningFlags?.map(f => (
                <span key={f} className="inline-flex items-center gap-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-300/80 border border-amber-500/25 text-[9px] font-medium px-1 py-px">
                  <AlertTriangle className="h-3 w-3 shrink-0" />{f}
                </span>
              ))}
              {en.retryCount != null && en.retryCount > 0 && (
                <span className="inline-flex items-center rounded bg-orange-500/15 text-orange-700 dark:text-orange-300/80 border border-orange-500/25 text-[9px] font-medium px-1 py-px">
                  ↻ retry {en.retryCount}
                </span>
              )}
              {en.errorMessage && (
                <span className="inline-flex items-center rounded bg-red-500/15 text-red-700 dark:text-red-300/90 border border-red-500/25 text-[9px] font-medium px-1 py-px max-w-full truncate">
                  {en.errorCode != null ? `[${en.errorCode}] ` : ""}{en.errorMessage}
                </span>
              )}
            </div>
          )}
        </div>
        <span className={`inline-flex items-center justify-center border rounded text-[10px] font-medium px-1.5 py-0.5 mt-0.5 ${dirCls}`}>
          {entry.direction}
        </span>
        <span className={`inline-flex items-center justify-center border rounded text-[10px] font-semibold px-1.5 py-0.5 mt-0.5 ${compCls}`}>
          {entry.component}
        </span>
        <span className="text-muted-foreground truncate pt-0.5">{entry.provider ?? <span className="text-muted-foreground/50">—</span>}</span>
        <span className="font-mono text-muted-foreground/70 tabular-nums text-right pt-0.5">
          {durMs != null ? (durMs >= 1000 ? `${(durMs / 1000).toFixed(1)}s` : `${durMs}ms`) : <span className="text-muted-foreground/40">—</span>}
        </span>
        <span className={`inline-flex items-center justify-center text-[9px] font-bold uppercase rounded px-1 py-0.5 mt-0.5 ${
          entry.status === "error" ? "bg-red-500/20 text-red-700 dark:text-red-400" :
          entry.status === "success" ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" :
          "bg-muted text-muted-foreground/60"
        }`}>
          {entry.status === "error" ? "ERR" : entry.status === "success" ? "OK" : "—"}
        </span>
        {hasPayload ? (
          expanded
            ? <ChevronUp className="h-3 w-3 text-muted-foreground/50 mt-0.5" />
            : <ChevronDown className="h-3 w-3 text-muted-foreground/50 mt-0.5" />
        ) : <span />}
      </div>
      {expanded && hasPayload && (
        <div className="px-3 pb-3 space-y-2">
          {entry.requestPayload && Object.keys(entry.requestPayload).length > 0 && (
            <div>
              <p className="text-[9px] text-muted-foreground/50 uppercase tracking-widest mb-1 font-semibold">Request</p>
              <JsonViewer data={entry.requestPayload} />
            </div>
          )}
          {entry.responsePayload && Object.keys(entry.responsePayload).length > 0 && (
            <div>
              <p className="text-[9px] text-muted-foreground/50 uppercase tracking-widest mb-1 font-semibold">Response</p>
              <JsonViewer data={entry.responsePayload} />
            </div>
          )}
          {entry.metadata && Object.keys(entry.metadata).length > 0 && (
            <div>
              <p className="text-[9px] text-muted-foreground/50 uppercase tracking-widest mb-1 font-semibold">Metadata</p>
              <JsonViewer data={entry.metadata} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function formatPlayerTime(secs: number): string {
  if (!Number.isFinite(secs) || secs < 0) return "0:00";
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function parseCallMeta(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "string") return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function hasMeetingVideo(call: { metadata?: string | null }): boolean {
  const m = parseCallMeta(call.metadata);
  return typeof m["recallBotId"] === "string" && !!m["recallBotId"].trim();
}

const PLAYBACK_SPEEDS = [0.5, 1, 1.5, 2] as const;

type SeparateAudioTrack = {
  name: string;
  participantId: string | null;
  isHost: boolean;
  url: string;
};

/** Meeting bot mixed MP4 + per-speaker audio via Recall pre-signed URLs. */
function MeetingRecordingPlayer({ callId }: { callId: number | string }) {
  const { getToken } = useAuth();
  const [url, setUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [tracks, setTracks] = useState<SeparateAudioTrack[] | null>(null);
  const [tracksPending, setTracksPending] = useState(false);
  const [tracksError, setTracksError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoadError(null);
        setPending(false);
        const token = await getToken();
        const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
        const r = await fetch(`/api/calls/${callId}/meeting-recording`, { headers });
        const body = await r.json().catch(() => ({}));
        if (!r.ok) {
          if (body?.pending) {
            if (!cancelled) setPending(true);
            return;
          }
          throw new Error(body?.error || `Failed to load meeting recording (${r.status})`);
        }
        if (cancelled) return;
        if (typeof body?.url === "string") setUrl(body.url);
        else throw new Error("No recording URL returned");
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "Failed to load meeting recording");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [callId, getToken]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setTracksError(null);
        setTracksPending(false);
        const token = await getToken();
        const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
        const r = await fetch(`/api/calls/${callId}/meeting-separate-audio`, { headers });
        const body = await r.json().catch(() => ({}));
        if (!r.ok) {
          if (body?.pending) {
            if (!cancelled) setTracksPending(true);
            return;
          }
          // Soft-fail: video may exist without separate audio yet.
          if (!cancelled) setTracks([]);
          return;
        }
        if (cancelled) return;
        const list = Array.isArray(body?.tracks) ? body.tracks : [];
        setTracks(
          list
            .filter((t: any) => typeof t?.url === "string" && typeof t?.name === "string")
            .map((t: any) => ({
              name: String(t.name),
              participantId: typeof t.participantId === "string" ? t.participantId : null,
              isHost: t.isHost === true,
              url: String(t.url),
            })),
        );
      } catch (e) {
        if (!cancelled) setTracksError(e instanceof Error ? e.message : "Failed to load speaker audio");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [callId, getToken]);

  if (loadError && !url) {
    return (
      <div className="text-center max-w-md py-10">
        <AlertTriangle className="h-5 w-5 text-destructive mx-auto mb-2" />
        <p className="text-sm text-foreground/80">Could not load meeting video</p>
        <p className="text-xs text-muted-foreground mt-1">{loadError}</p>
      </div>
    );
  }
  if (pending && !url) {
    return (
      <div className="text-center text-muted-foreground py-10">
        <Video className="h-5 w-5 mx-auto mb-2 opacity-40" />
        <p className="text-sm">Meeting recording is still processing — refresh in a minute.</p>
      </div>
    );
  }
  if (!url && !tracks?.length && !tracksPending) {
    return (
      <div className="text-center text-muted-foreground py-10">
        <p className="text-sm">Loading meeting recording…</p>
      </div>
    );
  }
  return (
    <div className="w-full max-w-3xl space-y-5">
      {url ? (
        <div className="space-y-3">
          <p className="text-[11px] text-muted-foreground text-center">Meeting video (Recall)</p>
          <video
            key={url}
            controls
            playsInline
            className="w-full rounded-lg border border-border bg-black aspect-video"
            src={url}
          />
          <div className="flex justify-center">
            <a
              href={url}
              download
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-[11px] text-foreground/70 border border-border rounded-md px-2.5 py-1.5 hover:bg-accent"
            >
              <Download className="h-3 w-3" /> Open / download MP4
            </a>
          </div>
        </div>
      ) : null}

      <div className="space-y-2 border-t border-border/60 pt-4">
        <p className="text-[11px] text-muted-foreground text-center">Per-speaker audio</p>
        {tracksPending ? (
          <p className="text-center text-xs text-muted-foreground py-2">
            Speaker tracks still processing — refresh shortly.
          </p>
        ) : tracksError ? (
          <p className="text-center text-xs text-muted-foreground py-2">{tracksError}</p>
        ) : tracks && tracks.length > 0 ? (
          <ul className="space-y-1.5 max-w-md mx-auto">
            {tracks.map((t, i) => (
              <li
                key={`${t.participantId ?? t.name}-${i}`}
                className="flex items-center justify-between gap-3 rounded-md border border-border/60 px-3 py-2 text-[12px]"
              >
                <span className="truncate">
                  {t.name}
                  {t.isHost ? (
                    <span className="ml-1.5 text-[10px] text-muted-foreground">host</span>
                  ) : null}
                </span>
                <a
                  href={t.url}
                  download
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex shrink-0 items-center gap-1 text-[11px] text-foreground/70 hover:text-foreground"
                >
                  <Download className="h-3 w-3" /> MP3
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-center text-xs text-muted-foreground py-2">No separate speaker audio for this meeting.</p>
        )}
      </div>
    </div>
  );
}

function CallRecordingPlayer({ src, callId }: { src: string; callId: number | string }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const { getToken } = useAuth();
  const [objUrl, setObjUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState<number>(1);

  // The recording endpoint requires a Bearer token, so fetch it as an
  // authenticated blob and play it via an object URL.
  useEffect(() => {
    let revoked: string | null = null;
    let cancelled = false;
    (async () => {
      try {
        setLoadError(null);
        const token = await getToken();
        const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
        // Partner acting-as-client — same header customFetch sends on history APIs.
        const clientCtx = getClientContext();
        if (clientCtx) headers["x-client-context"] = clientCtx;
        const r = await fetch(src, { headers });
        if (!r.ok) throw new Error(`Failed to load recording (${r.status})`);
        const blob = await r.blob();
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        revoked = url;
        setObjUrl(url);
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "Failed to load recording");
      }
    })();
    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [src, getToken]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => setCurrentTime(audio.currentTime);
    const onLoaded = () => setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
    const onEnded = () => setIsPlaying(false);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onLoaded);
    audio.addEventListener("durationchange", onLoaded);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onLoaded);
      audio.removeEventListener("durationchange", onLoaded);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
    };
  }, [src]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = speed;
  }, [speed]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = muted ? 0 : volume;
  }, [volume, muted]);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void audio.play();
    else audio.pause();
  };

  const handleSeek = (vals: number[]) => {
    const audio = audioRef.current;
    if (!audio) return;
    const t = vals[0] ?? 0;
    audio.currentTime = t;
    setCurrentTime(t);
  };

  const handleVolume = (vals: number[]) => {
    const v = (vals[0] ?? 0) / 100;
    setVolume(v);
    setMuted(v === 0);
  };

  return (
    <div className="w-full max-w-2xl mx-auto rounded-xl border border-border bg-card p-5">
      <audio ref={audioRef} src={objUrl ?? undefined} preload="metadata" />
      {loadError && (
        <p className="text-xs text-destructive mb-3">{loadError}</p>
      )}

      <div className="flex items-center gap-4">
        <Button
          type="button"
          size="icon"
          onClick={togglePlay}
          className="h-12 w-12 rounded-full shrink-0"
          aria-label={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 ml-0.5" />}
        </Button>

        <div className="flex-1 min-w-0">
          <Slider
            value={[currentTime]}
            min={0}
            max={duration || 0}
            step={0.1}
            onValueChange={handleSeek}
            aria-label="Seek"
          />
          <div className="flex items-center justify-between mt-1.5 text-[11px] font-mono text-muted-foreground tabular-nums">
            <span>{formatPlayerTime(currentTime)}</span>
            <span>{formatPlayerTime(duration)}</span>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setMuted(m => !m)}
            aria-label={muted ? "Unmute" : "Mute"}
          >
            {muted || volume === 0 ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </Button>
          <Slider
            value={[muted ? 0 : Math.round(volume * 100)]}
            min={0}
            max={100}
            step={1}
            onValueChange={handleVolume}
            className="w-20"
            aria-label="Volume"
          />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label="More options">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem asChild>
                <a href={objUrl ?? undefined} download={`call-${callId}.wav`}>
                  <Download className="h-4 w-4 mr-2" /> Download recording
                </a>
              </DropdownMenuItem>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Gauge className="h-4 w-4 mr-2" /> Playback Speed
                </DropdownMenuSubTrigger>
                <DropdownMenuPortal>
                  <DropdownMenuSubContent>
                    {PLAYBACK_SPEEDS.map(s => (
                      <DropdownMenuItem
                        key={s}
                        onClick={() => setSpeed(s)}
                        className={s === speed ? "font-semibold text-primary" : ""}
                      >
                        {s === 1 ? "1x (Normal)" : `${s}x`}
                        {s === speed && <Check className="h-3.5 w-3.5 ml-auto" />}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuPortal>
              </DropdownMenuSub>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {speed !== 1 && (
        <div className="mt-3 text-[11px] text-muted-foreground text-right">
          Playback speed: <span className="font-medium text-foreground/70">{speed}x</span>
        </div>
      )}
    </div>
  );
}

export function CallDetailContent({
  callId,
  drawerMode = false,
  onClose,
  onPrev,
  onNext,
  prevLabel,
  nextLabel,
  currentIndex,
  totalCount,
}: {
  callId: number;
  drawerMode?: boolean;
  onClose?: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  prevLabel?: string;
  nextLabel?: string;
  currentIndex?: number;
  totalCount?: number;
}) {
  const id = callId;
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { getToken } = useAuth();

  const { data: call, isLoading } = useGetCall(id, {
    query: { enabled: !!id, queryKey: getGetCallQueryKey(id) }
  });

  const agentId = call?.agentId;
  const { data: agent } = useGetAgent(agentId!, {
    query: { enabled: !!agentId, queryKey: getGetAgentQueryKey(agentId!) }
  });

  const { data: callerMemory } = useGetCallCallerMemory(id, {
    query: { enabled: !!id, queryKey: getGetCallCallerMemoryQueryKey(id) }
  });

  const { data: callLogs, isLoading: logsLoading } = useQuery<ExecutionLogEvent[]>({
    queryKey: ["call-logs", id],
    enabled: !!id,
    queryFn: async () => {
      const token = await getToken();
      const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
      const r = await fetch(`/api/calls/${id}/logs`, { headers });
      if (!r.ok) return [];
      return r.json();
    },
  });

  const [logSearch, setLogSearch]   = useState("");
  const [logComponent, setLogComponent] = useState("all");
  const [logDirection, setLogDirection] = useState("all");
  const [logStatus, setLogStatus]   = useState("all");

  const updateDisposition = useUpdateCallDisposition();
  const [editing, setEditing] = useState(false);
  const [editingDomain, setEditingDomain] = useState(false);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [domainEdits, setDomainEdits] = useState<Record<string, string>>({});
  const initialTab = new URLSearchParams(window.location.search).get("tab") || "logs";
  const [activeTab, setActiveTab] = useState(initialTab);

  const dispositionSchema = Array.isArray((agent as any)?.dispositionSchema)
    ? (agent as any).dispositionSchema as Array<{ key: string; label: string; type: string; options?: string[] }>
    : [];

  const { data: dispConfig } = useQuery<{ domainFields?: StoredDomainField[] } | null>({
    queryKey: ["disposition-config", agentId],
    enabled: !!agentId,
    staleTime: 60_000,
    queryFn: async () => {
      const token = await getToken();
      const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
      const r = await fetch(`/api/disposition/config/${agentId}`, { headers });
      if (!r.ok) return null;
      return r.json();
    },
  });

  const domainFields = (dispConfig?.domainFields ?? []) as StoredDomainField[];
  const collectFields = domainFields.map((f) => {
    const uiType = uiTypeFromStored(f);
    return {
      key: f.key,
      label: f.label?.trim() || f.key,
      type: uiType === "yes_no" ? "boolean" : uiType === "choice" ? "choice" : uiType === "number" ? "number" : "text",
      options: f.enum,
    };
  });

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

  const startEditingDomain = () => {
    const initial: Record<string, string> = {};
    collectFields.forEach((f) => {
      const v = dispositionResult?.[f.key];
      initial[f.key] = v != null ? String(v) : "";
    });
    setDomainEdits(initial);
    setEditingDomain(true);
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

  const saveDomainFields = () => {
    const merged: Record<string, string | number | boolean | null> = {
      ...(dispositionResult ?? {}),
    };
    collectFields.forEach((f) => {
      const v = domainEdits[f.key];
      if (v === "" || v == null) {
        merged[f.key] = null;
        return;
      }
      if (f.type === "number") merged[f.key] = parseFloat(v) || 0;
      else if (f.type === "boolean") merged[f.key] = v === "true";
      else merged[f.key] = v;
    });
    updateDisposition.mutate(
      { id, data: { dispositionResult: merged } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetCallQueryKey(id) });
          setEditingDomain(false);
          toast({ title: "Collected data saved" });
        },
        onError: (err: unknown) => toast({ title: "Failed to save", description: formatApiError(err), variant: "destructive" }),
      },
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
        <div className="mt-4">
          <DetailNav backTo="/app/history" backLabel="Back to History" />
        </div>
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

  const toolEvents: ToolEvent[] = (() => {
    if (callLogs && callLogs.length > 0) {
      const toolLogs = callLogs.filter(l => l.component === "Tool");
      if (toolLogs.length > 0) {
        const groups: ToolEvent[] = [];
        for (const entry of toolLogs) {
          if (entry.direction === "request") {
            const toolName = (entry.requestPayload?.["tool"] as string) ?? "unknown";
            const args = (entry.requestPayload?.["args"] as Record<string, unknown> | null) ?? null;
            const turnNumber = (entry.metadata?.["turnNumber"] ?? null) as number | null;
            groups.push({ toolName, args, result: null, status: "pending", durationMs: null, turnNumber, errorMessage: null });
          } else if (entry.direction === "response" && groups.length > 0) {
            const last = groups[groups.length - 1]!;
            last.result = (entry.responsePayload?.["result"] as string) ?? null;
            last.status = entry.status === "success" ? "success" : "error";
          } else if (entry.direction === "system" && entry.metadata?.["event"] === "Execution Completed" && groups.length > 0) {
            const last = groups[groups.length - 1]!;
            last.durationMs = (entry.metadata?.["durationMs"] as number) ?? null;
            if (last.status === "pending") last.status = "success";
          } else if (entry.status === "error" && entry.direction === "system" && groups.length > 0) {
            const last = groups[groups.length - 1]!;
            last.errorMessage = (entry.metadata?.["message"] as string) ?? (entry.metadata?.["error"] as string) ?? null;
            last.status = "error";
          }
        }
        return groups;
      }
    }
    const lines = isJsonTranscript
      ? transcriptLines.map((l: any) => String(l.content ?? ""))
      : call.transcript?.split(/\r?\n/) ?? [];
    return parseToolEventsFromLines(lines);
  })();

  const callSummary = (call as any).callSummary as string | null | undefined;
  const summarizationEnabled = ((agent as any)?.agentConfig?.summarizationEnabled as boolean | undefined) ?? false;
  const rawEval = (call as any).successEvaluation as string | null | undefined;
  const evalVerdict = rawEval ? rawEval.split(/\r?\n/)[0]?.trim().toUpperCase() : undefined;
  const evalReason = rawEval ? rawEval.split(/\r?\n/).slice(1).join(" ").trim() : undefined;
  const evalIsPass = evalVerdict?.startsWith("PASS");
  const evalIsFail = evalVerdict?.startsWith("FAIL");

  const costCents = (call as any).costCents ?? 0;

  return (
    <TooltipProvider>
      <div className="flex-1 space-y-5 p-4 sm:p-6 h-full flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 min-w-0">
            {!drawerMode ? (
              <DetailNav backTo="/app/history" backLabel="Back to History" />
            ) : (
              <div className="flex items-center gap-1">
                <DetailNav backLabel="Close" onBack={onClose} preferOnBack className="mr-1" />
                <Button
                  variant="outline"
                  size="icon"
                  className="h-7 w-7"
                  onClick={onPrev}
                  disabled={!onPrev}
                  title={prevLabel ? `Previous: ${prevLabel}` : "Previous"}
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-7 w-7"
                  onClick={onNext}
                  disabled={!onNext}
                  title={nextLabel ? `Next: ${nextLabel}` : "Next"}
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
                {currentIndex != null && totalCount != null && (
                  <span className="text-[10px] text-muted-foreground/50 font-mono ml-1 tabular-nums">
                    {currentIndex + 1} / {totalCount}
                  </span>
                )}
              </div>
            )}
            <div>
              <div className="flex items-center gap-3">
                <h2 className="text-xl font-semibold tracking-tight">Call #{call.id}</h2>
                <StatusBadge status={call.status} />
                {(call as any).campaignId != null && (
                  <button
                    type="button"
                    onClick={() => setLocation(`/app/campaigns/${(call as any).campaignId}`)}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-elevated text-foreground/70 border border-border hover:text-foreground hover:bg-accent transition-colors"
                    title="Go to Campaign"
                  >
                    Go to Campaign
                    <ArrowUpRight className="h-3 w-3" />
                  </button>
                )}
              </div>
              <p className="text-muted-foreground text-xs flex items-center gap-2 mt-0.5">
                <span className="font-mono">{getExecutionId(call)}</span>
                <span className="text-muted-foreground/30">•</span>
                {format(parseISO(call.createdAt), "MMM d, yyyy 'at' h:mm:ss a")}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap shrink-0">
            {hasMeetingVideo(call) ? (
              <button
                type="button"
                onClick={() => setActiveTab("recording")}
                title="View meeting recording"
                className="inline-flex items-center gap-1.5 text-[11px] text-foreground/70 border border-border rounded-md px-2.5 py-1.5 hover:bg-accent hover:text-accent-foreground"
              >
                <Video className="h-3 w-3" /> Meeting recording
              </button>
            ) : null}
            {call.recordingUrl ? (
              <button
                type="button"
                onClick={() => setActiveTab("recording")}
                title="View call recording"
                className="inline-flex items-center gap-1.5 text-[11px] text-foreground/70 border border-border rounded-md px-2.5 py-1.5 hover:bg-accent hover:text-accent-foreground"
              >
                <Mic className="h-3 w-3" /> Recording available
              </button>
            ) : (call.recordingEnabled && call.recordingError) ? (
              <button
                type="button"
                onClick={() => setActiveTab("recording")}
                title="Recording failed — view details"
                className="inline-flex items-center gap-1.5 text-[11px] text-destructive border border-destructive/40 rounded-md px-2.5 py-1.5 hover:bg-destructive/10"
              >
                <AlertTriangle className="h-3 w-3" /> Recording failed
              </button>
            ) : (call.status === "completed" || call.status === "failed") ? (
              call.recordingEnabled ? (
                <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground/40 border border-dashed border-border rounded-md px-2.5 py-1.5">
                  <MicOff className="h-3 w-3" /> Recording unavailable
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground/40 border border-dashed border-border rounded-md px-2.5 py-1.5">
                  <MicOff className="h-3 w-3" /> Recording not enabled
                </span>
              )
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
              <p className="text-[9px] text-muted-foreground/50 uppercase tracking-wider">Platform fee</p>
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
              <TabsList className="h-8 w-full sm:w-fit shrink-0 overflow-x-auto justify-start">
                <TabsTrigger value="transcript" className="text-xs h-6 gap-1">
                  <FileText className="h-3 w-3" /> Transcript
                </TabsTrigger>
                <TabsTrigger value="summary" className="text-xs h-6 gap-1">
                  <Sparkles className="h-3 w-3" /> Summary
                </TabsTrigger>
                <TabsTrigger value="tools" className="text-xs h-6 gap-1">
                  <Zap className="h-3 w-3" /> Tools {toolEvents.length > 0 && `(${toolEvents.length})`}
                </TabsTrigger>
                <TabsTrigger value="logs" className="text-xs h-6 gap-1">
                  <ScrollText className="h-3 w-3" /> Logs {callLogs && callLogs.length > 0 && `(${callLogs.length})`}
                </TabsTrigger>
                <TabsTrigger value="recording" className="text-xs h-6 gap-1">
                  <Mic className="h-3 w-3" /> Call Recording
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
                          {transcriptLines.map((line, i) => {
                            const content = stripTranscriptMarkup(String(line.content ?? ""));
                            if (!content) return null;
                            return (
                            <div key={i} className={`flex gap-3 ${line.role === 'user' ? 'flex-row-reverse' : ''}`}>
                              <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${line.role === 'user' ? 'bg-secondary' : 'bg-primary/15 text-primary'}`}>
                                {line.role === 'user' ? <User className="h-3 w-3" /> : <Bot className="h-3 w-3" />}
                              </div>
                              <div className={`max-w-[80%] rounded-xl p-3 text-xs ${line.role === 'user' ? 'bg-secondary text-secondary-foreground rounded-tr-sm' : 'bg-card border border-border shadow-sm rounded-tl-sm'}`}>
                                <p className="leading-relaxed">{content}</p>
                                {line.timestamp && (
                                  <span className="text-[10px] text-muted-foreground mt-1.5 block opacity-60">
                                    {line.timestamp}
                                  </span>
                                )}
                              </div>
                            </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="p-4 space-y-4">
                          {plainLines.map((line, i) => (
                            <PlainTranscriptLine key={i} line={line} index={i} />
                          ))}
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="summary" className="flex-1 overflow-auto mt-2 min-h-0">
                <Card className="h-full flex flex-col">
                  <CardHeader className="shrink-0 pb-3">
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <Sparkles className="h-4 w-4 text-primary" /> Conversation Summary
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="flex-1 overflow-auto min-h-0">
                    {callSummary ? (
                      <p className="text-sm text-muted-foreground whitespace-pre-line leading-relaxed">
                        {callSummary}
                      </p>
                    ) : summarizationEnabled ? (
                      <p className="text-sm text-muted-foreground">No summary available for this call.</p>
                    ) : (
                      <p className="text-sm text-muted-foreground">Auto Summarization is disabled for this agent.</p>
                    )}
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

              <TabsContent value="logs" className="flex-1 mt-2 min-h-0 flex flex-col">
                <Card className="flex-1 flex flex-col overflow-hidden bg-card border-border min-h-0">
                  {/* Filters bar */}
                  {callLogs && callLogs.length > 0 && (
                    <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/50 shrink-0 flex-wrap">
                      <input
                        value={logSearch}
                        onChange={e => setLogSearch(e.target.value)}
                        placeholder="Search logs…"
                        className="h-6 px-2 text-[11px] rounded bg-muted border border-border text-foreground/85 placeholder:text-muted-foreground focus:outline-none focus:border-ring w-36"
                      />
                      <select value={logComponent} onChange={e => setLogComponent(e.target.value)}
                        className="h-6 px-1.5 text-[11px] rounded bg-muted border border-border text-foreground/80 focus:outline-none focus:border-ring">
                        <option value="all">All Components</option>
                        {Array.from(new Set(callLogs.map(l => l.component))).sort().map(c => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                      <select value={logDirection} onChange={e => setLogDirection(e.target.value)}
                        className="h-6 px-1.5 text-[11px] rounded bg-muted border border-border text-foreground/80 focus:outline-none focus:border-ring">
                        <option value="all">All Directions</option>
                        <option value="request">Request</option>
                        <option value="response">Response</option>
                        <option value="system">System</option>
                      </select>
                      <select value={logStatus} onChange={e => setLogStatus(e.target.value)}
                        className="h-6 px-1.5 text-[11px] rounded bg-muted border border-border text-foreground/80 focus:outline-none focus:border-ring">
                        <option value="all">All Status</option>
                        <option value="success">Success</option>
                        <option value="error">Error</option>
                        <option value="info">Info</option>
                      </select>
                      <div className="flex-1" />
                      <span className="text-[10px] text-muted-foreground/50 font-mono">
                        {callLogs.length} event{callLogs.length !== 1 ? "s" : ""}
                      </span>
                      <button
                        onClick={() => {
                          const blob = new Blob([JSON.stringify(callLogs, null, 2)], { type: "application/json" });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement("a");
                          a.href = url; a.download = `call-${id}-logs.json`; a.click();
                          URL.revokeObjectURL(url);
                        }}
                        className="flex items-center gap-1 h-6 px-2 text-[10px] rounded bg-muted border border-border text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                      >
                        <Download className="h-2.5 w-2.5" /> JSON
                      </button>
                    </div>
                  )}

                  <div className="flex-1 overflow-auto min-h-0">
                    {logsLoading ? (
                      <div className="flex items-center justify-center h-full text-muted-foreground/50 gap-2">
                        <ScrollText className="h-4 w-4 animate-pulse" />
                        <span className="text-xs">Loading logs…</span>
                      </div>
                    ) : !callLogs || callLogs.length === 0 ? (
                      <div className="flex flex-col items-center justify-center h-full text-center py-10">
                        <div className="h-10 w-10 rounded-xl bg-muted border border-border flex items-center justify-center mb-3">
                          <ScrollText className="h-5 w-5 text-muted-foreground/50" />
                        </div>
                        <p className="text-sm text-muted-foreground/60">No logs recorded</p>
                        <p className="text-xs text-muted-foreground/50 mt-1">Logs are captured for new calls going forward</p>
                      </div>
                    ) : (() => {
                      const q = logSearch.toLowerCase();
                      const callEndedSummary = callLogs
                        .map(e => getEnrichment(e).callEnded)
                        .find((s): s is CallEndedSummary => s != null);
                      const filtered = callLogs.filter(e => {
                        if (logComponent !== "all" && e.component !== logComponent) return false;
                        if (logDirection !== "all" && e.direction !== logDirection) return false;
                        if (logStatus !== "all" && e.status !== logStatus) return false;
                        if (q) {
                          const hay = JSON.stringify(e).toLowerCase();
                          if (!hay.includes(q)) return false;
                        }
                        return true;
                      });
                      const noFilters = logComponent === "all" && logDirection === "all" && logStatus === "all" && !q;
                      if (filtered.length === 0) {
                        return (
                          <div className="flex flex-col items-center justify-center h-full text-center py-10">
                            <p className="text-xs text-muted-foreground/50">No matching events</p>
                          </div>
                        );
                      }
                      return (
                        <div className="min-w-[780px]">
                          {/* Table header — sticky inside the scroll container so it scrolls horizontally with the rows */}
                          <div
                            className="grid items-center gap-2 px-3 py-1.5 border-b border-border bg-muted/50 text-[9px] uppercase tracking-widest text-muted-foreground/50 font-semibold sticky top-0 z-10"
                            style={{ gridTemplateColumns: LOG_GRID_COLUMNS }}
                          >
                            <span>Timestamp</span>
                            <span className="text-center">Turn</span>
                            <span>Log data</span>
                            <span>Direction</span>
                            <span>Component</span>
                            <span>Provider</span>
                            <span className="text-right">Duration</span>
                            <span>Status</span>
                            <span />
                          </div>
                          {callEndedSummary && noFilters && <CallEndedCard summary={callEndedSummary} />}
                          {filtered.map(entry => <ExecLogRow key={entry.id} entry={entry} />)}
                        </div>
                      );
                    })()}
                  </div>
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

              <TabsContent value="recording" className="flex-1 overflow-auto mt-2 min-h-0">
                <Card className="h-full flex flex-col">
                  <CardContent className="flex-1 flex flex-col items-center justify-center gap-8 p-6">
                    {hasMeetingVideo(call) ? (
                      <MeetingRecordingPlayer callId={call.id} />
                    ) : null}
                    {call.recordingUrl ? (
                      <CallRecordingPlayer src={call.recordingUrl} callId={call.id} />
                    ) : hasMeetingVideo(call) ? null : (call.recordingEnabled && call.recordingError) ? (
                      <div className="text-center max-w-md py-10">
                        <div className="h-10 w-10 rounded-xl bg-destructive/10 border border-destructive/30 flex items-center justify-center mx-auto mb-3">
                          <AlertTriangle className="h-5 w-5 text-destructive" />
                        </div>
                        <p className="text-sm font-medium text-foreground/80">Recording failed</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Recording was enabled for this call, but it could not be saved:
                        </p>
                        <p className="text-xs font-mono text-destructive mt-2 break-words">{call.recordingError}</p>
                      </div>
                    ) : !call.recordingEnabled ? (
                      <div className="text-center text-muted-foreground py-10">
                        <div className="h-10 w-10 rounded-xl bg-elevated border border-border flex items-center justify-center mx-auto mb-3">
                          <MicOff className="h-5 w-5 text-muted-foreground/30" />
                        </div>
                        <p className="text-sm text-foreground/40">Recording was not enabled for this call.</p>
                      </div>
                    ) : (call.status === "completed" || call.status === "failed") ? (
                      <div className="text-center text-muted-foreground py-10">
                        <div className="h-10 w-10 rounded-xl bg-elevated border border-border flex items-center justify-center mx-auto mb-3">
                          <MicOff className="h-5 w-5 text-muted-foreground/30" />
                        </div>
                        <p className="text-sm text-foreground/40">Recording was enabled, but no audio was captured for this call.</p>
                      </div>
                    ) : (
                      <div className="text-center text-muted-foreground py-10">
                        <div className="h-10 w-10 rounded-xl bg-elevated border border-border flex items-center justify-center mx-auto mb-3">
                          <Mic className="h-5 w-5 text-muted-foreground/30" />
                        </div>
                        <p className="text-sm text-foreground/40">Recording is still finalizing…</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>

          {/* Right Column: Sidebar */}
          <div className="space-y-4 overflow-auto h-full">
            {/* Disposition — the call's main outcome, promoted to its own card
                at the top of the sidebar (was a cramped truncated row inside
                Call Details). */}
            {(() => {
              const r = dispositionResult;
              if (!r || typeof r !== "object") return null;
              // Outcome chips only — domain fields render in Collected data below.
              const values = getDispositionValues(r, collectFields.map((f) => f.key));
              if (values.length === 0) return null;
              const confidence = getDispositionConfidence(r);
              const summary = getDispositionSummary(r);
              return (
                <Card className="border-primary/30">
                  <CardHeader className="py-3 border-b">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <ClipboardList className="h-4 w-4 text-primary/70" />
                        Disposition
                      </CardTitle>
                      {confidence != null && (
                        <span className="text-[10px] text-muted-foreground">
                          {Math.round(confidence * 100)}% confidence
                        </span>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="p-3 space-y-2">
                    <div className="flex flex-wrap gap-1.5">
                      {values.map((v, i) => (
                        <span
                          key={i}
                          className="inline-flex items-center px-2 py-1 rounded-md text-xs font-semibold bg-primary/10 border border-primary/30 text-primary capitalize"
                        >
                          {v}
                        </span>
                      ))}
                    </div>
                    {summary && (
                      <p className="text-xs text-muted-foreground leading-relaxed">{summary}</p>
                    )}
                  </CardContent>
                </Card>
              );
            })()}

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
                <DetailRow label="Execution ID" value={getExecutionId(call)} icon={<Hash className="h-3 w-3" />} />
              </CardContent>
            </Card>

            {/* Caller Memory (caller-scoped CRM) */}
            {callerMemory && (callerMemory.factCount > 0 || callerMemory.episodeCount > 0 || callerMemory.summary || callerMemory.name) && (
              <Card>
                <CardHeader className="py-3 border-b">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <BookOpen className="h-4 w-4 text-primary/70" />
                      Caller Memory
                    </CardTitle>
                    {agentId != null && callerMemory.phoneNumber && (
                      <Link
                        href={`/app/memory?agentId=${agentId}&caller=${encodeURIComponent(callerMemory.phoneNumber)}`}
                      >
                        <Button variant="ghost" size="sm" className="h-6 gap-1 text-xs px-2">
                          View in CRM <ArrowRight className="h-3 w-3" />
                        </Button>
                      </Link>
                    )}
                  </div>
                  <CardDescription className="text-[10px] mt-1">
                    What this agent remembers about this caller across calls
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-3 space-y-3">
                  {(callerMemory.name || callerMemory.phoneNumber) && (
                    <div className="flex items-center gap-2 text-xs">
                      <User className="h-3 w-3 text-muted-foreground" />
                      <span className="font-medium text-foreground/90">
                        {callerMemory.name || callerMemory.phoneNumber}
                      </span>
                      {callerMemory.callCount > 0 && (
                        <Badge variant="secondary" className="text-[10px] h-5">
                          {callerMemory.callCount} {callerMemory.callCount === 1 ? "call" : "calls"}
                        </Badge>
                      )}
                    </div>
                  )}

                  {callerMemory.summary && (
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {callerMemory.summary}
                    </p>
                  )}

                  {callerMemory.facts.length > 0 && (
                    <div className="space-y-1.5">
                      <p className="text-[10px] text-muted-foreground/50 uppercase tracking-wider">
                        Facts ({callerMemory.factCount})
                      </p>
                      {callerMemory.facts.slice(0, 6).map(f => (
                        <div key={f.id} className="flex items-start gap-2 text-xs">
                          <Tag className="h-3 w-3 mt-0.5 text-muted-foreground/60 shrink-0" />
                          <span className="text-foreground/80">
                            <span className="text-muted-foreground/70">{f.key}:</span> {f.value}
                          </span>
                        </div>
                      ))}
                      {callerMemory.factCount > 6 && (
                        <p className="text-[10px] text-muted-foreground/40 pl-5">
                          +{callerMemory.factCount - 6} more
                        </p>
                      )}
                    </div>
                  )}

                  {callerMemory.episodeCount > 0 && (
                    <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/50 pt-1 border-t border-border">
                      <Activity className="h-3 w-3" />
                      {callerMemory.episodeCount} {callerMemory.episodeCount === 1 ? "episode" : "episodes"} remembered
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

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

            {/* Collected data — domainFields from Builder disposition config */}
            {collectFields.length > 0 && (
              <Card>
                <CardHeader className="py-3 border-b">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <ClipboardList className="h-4 w-4 text-primary/70" />
                      Collected data
                    </CardTitle>
                    {!editingDomain ? (
                      <Button variant="ghost" size="sm" className="h-6 gap-1 text-xs px-2" onClick={startEditingDomain}>
                        <Pencil className="h-3 w-3" /> Edit
                      </Button>
                    ) : (
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setEditingDomain(false)}>
                          <X className="h-3 w-3" />
                        </Button>
                        <Button size="sm" className="h-6 text-xs gap-1 px-2" onClick={saveDomainFields} disabled={updateDisposition.isPending}>
                          <Check className="h-3 w-3" /> Save
                        </Button>
                      </div>
                    )}
                  </div>
                  <CardDescription className="text-[10px] mt-1">
                    Fields configured on the agent — filled automatically after the call
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="divide-y divide-border">
                    {collectFields.map((field, i) => {
                      const value = dispositionResult?.[field.key];
                      return (
                        <div key={field.key} className={`py-2 px-4 ${i % 2 === 1 ? "bg-elevated/20" : ""}`}>
                          <p className="text-[10px] text-muted-foreground/50 mb-1">{field.label}</p>
                          {editingDomain ? (
                            field.type === "boolean" ? (
                              <select
                                className="w-full text-xs border rounded px-2 py-1 bg-background"
                                value={domainEdits[field.key] ?? ""}
                                onChange={(e) => setDomainEdits((prev) => ({ ...prev, [field.key]: e.target.value }))}
                              >
                                <option value="">—</option>
                                <option value="true">Yes</option>
                                <option value="false">No</option>
                              </select>
                            ) : field.type === "choice" && field.options?.length ? (
                              <select
                                className="w-full text-xs border rounded px-2 py-1 bg-background"
                                value={domainEdits[field.key] ?? ""}
                                onChange={(e) => setDomainEdits((prev) => ({ ...prev, [field.key]: e.target.value }))}
                              >
                                <option value="">—</option>
                                {field.options.map((opt) => (
                                  <option key={opt} value={opt}>{opt}</option>
                                ))}
                              </select>
                            ) : (
                              <Input
                                className="h-6 text-xs"
                                type={field.type === "number" ? "number" : "text"}
                                value={domainEdits[field.key] ?? ""}
                                onChange={(e) => setDomainEdits((prev) => ({ ...prev, [field.key]: e.target.value }))}
                              />
                            )
                          ) : (
                            <div className="text-xs font-medium">
                              {value != null && value !== "" ? (
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

            {/* Legacy dispositionSchema (admin) */}
            {dispositionSchema.length > 0 && (
              <Card>
                <CardHeader className="py-3 border-b">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <ClipboardList className="h-4 w-4 text-primary/70" />
                      Disposition fields
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

export default function CallDetail() {
  const params = useParams();
  const callId = parseInt(params.id || "0", 10);
  return <CallDetailContent callId={callId} />;
}
