import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  MessageSquare, Play, Plus, Trash2, Download, ChevronDown,
  CheckCircle2, XCircle, Loader2, RotateCcw, Wrench, BookOpen, Database,
  Clock, Hash, Bot, User, Sparkles, ChevronUp, AlertTriangle, Pencil,
  PlayCircle, ListChecks, StopCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";

const _DASH_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const API = `${_DASH_BASE}/api`;

/* ── Types ─────────────────────────────────────────────────────────────────── */

interface KbSource {
  id: number;
  name: string;
  type: string;
  entryCount: number;
}

interface TestCase {
  id: number;
  agentId: number;
  name: string;
  personaPrompt: string;
  goal: string;
  successCriteria: string[];
  variables: Record<string, unknown> | null;
  kbSourceId: number | null;
  maxTurns: number;
  createdAt: string;
  lastRun?: { status: string; score: number | null; createdAt: string } | null;
}

interface SimRun {
  id: number;
  status: string;
  score: number | null;
  result: RunScore | null;
  messages: SimMessage[];
  startedAt: string | null;
  completedAt: string | null;
}

interface SimMessage {
  id: number;
  simulationRunId: number;
  role: "user" | "agent" | "system";
  content: string;
  metadata: {
    toolsCalled?: Array<{ name: string; args: Record<string, unknown>; result?: string }>;
    latencyMs?: number;
    inputTokens?: number;
    outputTokens?: number;
    turn?: number;
    source?: string;
  } | null;
  createdAt: string;
}

interface CriterionScore {
  criterion: string;
  score: number;
  maxScore: number;
  reason: string;
}

interface RunScore {
  overall: number | null;
  pass: boolean;
  summary: string;
  metrics: Array<{ name: string; score: number; maxScore: number; notes: string }>;
  criteriaScores?: CriterionScore[];
  criteriaSource?: "user_defined" | "auto_generated" | "replaced_mismatch";
  evaluationError?: boolean;
  evaluationErrorReason?: string;
  evaluatorPrompt?: string;
  rawEvaluatorResponse?: string;
}

interface PersonaTemplate {
  id: string;
  name: string;
  personaPrompt: string;
  goal: string;
  successCriteria: string[];
}

interface TemplateCategory {
  id: string;
  label: string;
  templates: PersonaTemplate[];
}

interface DebugInfo {
  resolvedPrompt?: string;
  kbChunks?: string;
  toolsCalled?: Array<{ name: string; args: Record<string, unknown>; result?: string }>;
  latencyMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  variables?: Record<string, string>;
}

interface ChatMessage {
  role: "user" | "agent" | "tool_call";
  content: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolCalls?: Array<{ name: string; args: Record<string, unknown> }>;
  streaming?: boolean;
}

interface LiveMessage {
  role: "persona" | "agent" | "tool_call";
  content: string;
  turn?: number;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
}

interface BatchRunResult {
  testCaseId: number;
  testCaseName: string;
  status: "pending" | "running" | "completed" | "failed";
  score: number | null;
  pass: boolean | null;
  durationMs: number | null;
  runId: number | null;
  error?: string;
}

/* ── Auth token ─────────────────────────────────────────────────────────────── */

function getAuthToken(): Record<string, string> {
  const token = localStorage.getItem("voiceorch:session");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/* ── ScoreBadge / StatusBadge ───────────────────────────────────────────────── */

function ScoreBadge({ score, pass, evaluationError }: { score: number | null; pass?: boolean; evaluationError?: boolean }) {
  if (evaluationError) {
    return (
      <Badge className="bg-orange-600/20 text-orange-400 border-orange-600/30 gap-1">
        <AlertTriangle className="h-2.5 w-2.5" /> Eval Error
      </Badge>
    );
  }
  if (score == null) return <Badge variant="secondary">—</Badge>;
  return (
    <Badge className={cn(
      "font-mono",
      pass ? "bg-emerald-600/20 text-emerald-400 border-emerald-600/30"
           : "bg-red-600/20 text-red-400 border-red-600/30",
    )}>
      {score}/100 · {pass ? "PASS" : "FAIL"}
    </Badge>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending:          "bg-amber-600/20 text-amber-400 border-amber-600/30",
    running:          "bg-blue-600/20 text-blue-400 border-blue-600/30",
    completed:        "bg-emerald-600/20 text-emerald-400 border-emerald-600/30",
    failed:           "bg-red-600/20 text-red-400 border-red-600/30",
    evaluation_error: "bg-orange-600/20 text-orange-400 border-orange-600/30",
  };
  const label = status === "evaluation_error" ? "Eval Error" : status;
  return (
    <Badge variant="outline" className={cn("capitalize", map[status] ?? "")}>
      {status === "running" && <Loader2 className="h-2.5 w-2.5 mr-1 animate-spin" />}
      {status === "evaluation_error" && <AlertTriangle className="h-2.5 w-2.5 mr-1" />}
      {label}
    </Badge>
  );
}

/* ── ScoreCard ──────────────────────────────────────────────────────────────── */

function MetricBar({ score, maxScore }: { score: number; maxScore: number }) {
  const pct = maxScore > 0 ? (score / maxScore) * 100 : 0;
  return (
    <div className="h-1.5 rounded-full bg-border/60 overflow-hidden">
      <div
        className={cn("h-full rounded-full transition-all", pct >= 70 ? "bg-emerald-500" : "bg-red-500")}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function ScoreCard({ result }: { result: RunScore }) {
  const [showMetrics, setShowMetrics] = useState(false);
  const [showEval, setShowEval] = useState(false);

  // Evaluation error state
  if (result.evaluationError) {
    return (
      <div className="rounded-xl border border-orange-500/30 bg-orange-500/5 p-5 space-y-3">
        <div className="flex items-center gap-2 text-orange-400">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <p className="text-sm font-semibold">Evaluation Error</p>
        </div>
        <p className="text-xs text-orange-300/80 leading-relaxed">
          {result.evaluationErrorReason ?? "The evaluator failed to produce a score for this run."}
        </p>
        <p className="text-[10px] text-muted-foreground">
          The conversation ran to completion but the evaluation pipeline encountered an error. Check the evaluator details below.
        </p>
        {(result.evaluatorPrompt || result.rawEvaluatorResponse) && (
          <div className="space-y-1.5">
            <button
              type="button"
              onClick={() => setShowEval(!showEval)}
              className="flex w-full items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors"
            >
              <MessageSquare className="h-3 w-3" />
              View Evaluator Details
              {showEval ? <ChevronUp className="h-3 w-3 ml-auto" /> : <ChevronDown className="h-3 w-3 ml-auto" />}
            </button>
            {showEval && (
              <div className="space-y-2">
                {result.evaluatorPrompt && (
                  <div className="space-y-1">
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Evaluator Prompt</p>
                    <pre className="text-[10px] text-muted-foreground bg-border/20 rounded p-2 overflow-x-auto max-h-48 whitespace-pre-wrap">
                      {result.evaluatorPrompt.slice(0, 3000)}
                    </pre>
                  </div>
                )}
                {result.rawEvaluatorResponse && (
                  <div className="space-y-1">
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Raw LLM Response</p>
                    <pre className="text-[10px] text-muted-foreground bg-border/20 rounded p-2 overflow-x-auto max-h-48 whitespace-pre-wrap">
                      {result.rawEvaluatorResponse.slice(0, 2000)}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  const hasCriteria = (result.criteriaScores ?? []).length > 0;
  const hasMetrics  = (result.metrics ?? []).length > 0;
  const hasEvalData = result.evaluatorPrompt || result.rawEvaluatorResponse;

  return (
    <div className="rounded-xl border border-border/60 bg-card/50 p-5 space-y-4">
      {/* Overall score */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={cn(
            "w-16 h-16 rounded-full border-4 flex items-center justify-center font-bold text-xl",
            result.pass
              ? "border-emerald-500/50 text-emerald-400"
              : "border-red-500/50 text-red-400",
          )}>
            {result.overall ?? "—"}
          </div>
          <div>
            <p className="text-sm font-semibold">{result.pass ? "PASSED" : "FAILED"}</p>
            <p className="text-xs text-muted-foreground">Threshold: 70/100</p>
          </div>
        </div>
        {result.pass
          ? <CheckCircle2 className="h-7 w-7 text-emerald-500" />
          : <XCircle className="h-7 w-7 text-red-500" />}
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed">{result.summary}</p>

      {/* Per-criterion scores */}
      {hasCriteria && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Success Criteria</p>
            {result.criteriaSource === "auto_generated" && (
              <Badge variant="outline" className="text-[10px] py-0 px-1.5 bg-blue-500/10 text-blue-400 border-blue-500/30">
                <Sparkles className="h-2.5 w-2.5 mr-1" />Auto-generated from agent config
              </Badge>
            )}
            {result.criteriaSource === "replaced_mismatch" && (
              <Badge variant="outline" className="text-[10px] py-0 px-1.5 bg-amber-500/10 text-amber-400 border-amber-500/30">
                <Sparkles className="h-2.5 w-2.5 mr-1" />Auto-derived — stored criteria didn't match this agent
              </Badge>
            )}
            {result.criteriaSource === "user_defined" && (
              <Badge variant="outline" className="text-[10px] py-0 px-1.5 bg-emerald-500/10 text-emerald-400 border-emerald-500/30">
                User-defined
              </Badge>
            )}
          </div>
          {result.criteriaSource === "replaced_mismatch" && (
            <p className="text-[10px] text-amber-400/80 leading-relaxed">
              Stored criteria were not relevant to this agent — criteria were auto-derived from the agent's system prompt.
            </p>
          )}
          {result.criteriaScores!.map((cs, i) => (
            <div key={i} className="space-y-1">
              <div className="flex items-start justify-between text-xs gap-2">
                <span className="font-medium leading-snug flex-1">{cs.criterion}</span>
                <span className="text-muted-foreground tabular-nums shrink-0">{cs.score}/{cs.maxScore}</span>
              </div>
              <MetricBar score={cs.score} maxScore={cs.maxScore} />
              {cs.reason && <p className="text-[10px] text-muted-foreground">{cs.reason}</p>}
            </div>
          ))}
        </div>
      )}

      {/* Metric breakdown (collapsible) */}
      {hasMetrics && (
        <div className="space-y-1.5">
          <button
            type="button"
            onClick={() => setShowMetrics(!showMetrics)}
            className="flex w-full items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors"
          >
            <ListChecks className="h-3 w-3" />
            Metric Breakdown
            {showMetrics ? <ChevronUp className="h-3 w-3 ml-auto" /> : <ChevronDown className="h-3 w-3 ml-auto" />}
          </button>
          {showMetrics && (
            <div className="space-y-2 pt-1">
              {result.metrics.map((m) => (
                <div key={m.name} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium">{m.name}</span>
                    <span className="text-muted-foreground tabular-nums">{m.score}/{m.maxScore}</span>
                  </div>
                  <MetricBar score={m.score} maxScore={m.maxScore} />
                  {m.notes && <p className="text-[10px] text-muted-foreground">{m.notes}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Full evaluation expander */}
      {hasEvalData && (
        <div className="space-y-1.5">
          <button
            type="button"
            onClick={() => setShowEval(!showEval)}
            className="flex w-full items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors"
          >
            <MessageSquare className="h-3 w-3" />
            View Full Evaluation
            {showEval ? <ChevronUp className="h-3 w-3 ml-auto" /> : <ChevronDown className="h-3 w-3 ml-auto" />}
          </button>
          {showEval && (
            <div className="space-y-2">
              {result.evaluatorPrompt && (
                <div className="space-y-1">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Evaluator Prompt</p>
                  <pre className="text-[10px] text-muted-foreground bg-border/20 rounded p-2 overflow-x-auto max-h-56 whitespace-pre-wrap">
                    {result.evaluatorPrompt.slice(0, 4000)}
                  </pre>
                </div>
              )}
              {result.rawEvaluatorResponse && (
                <div className="space-y-1">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Raw LLM Response</p>
                  <pre className="text-[10px] text-muted-foreground bg-border/20 rounded p-2 overflow-x-auto max-h-48 whitespace-pre-wrap">
                    {result.rawEvaluatorResponse.slice(0, 3000)}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── DebugPanel ─────────────────────────────────────────────────────────────── */

function DebugPanel({ debug }: { debug: DebugInfo }) {
  const [showPrompt, setShowPrompt] = useState(false);
  const [showKb, setShowKb] = useState(false);

  return (
    <div className="h-full overflow-y-auto p-4 space-y-4 text-xs">
      <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">
        Debug Panel
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Clock className="h-3 w-3" />
          <span>Latency</span>
          <span className="ml-auto font-mono text-foreground">{debug.latencyMs ?? "—"}ms</span>
        </div>
        <div className="flex items-center gap-2 text-muted-foreground">
          <Hash className="h-3 w-3" />
          <span>Tokens</span>
          <span className="ml-auto font-mono text-foreground">
            {debug.inputTokens ?? 0} in / {debug.outputTokens ?? 0} out
          </span>
        </div>
      </div>

      {debug.variables && Object.keys(debug.variables).length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            <Database className="h-3 w-3" /> Variables
          </div>
          {Object.entries(debug.variables).map(([k, v]) => (
            <div key={k} className="flex gap-2 rounded bg-border/20 px-2 py-1">
              <span className="text-primary/80 shrink-0">{k}:</span>
              <span className="text-muted-foreground truncate">{v}</span>
            </div>
          ))}
        </div>
      )}

      {debug.toolsCalled && debug.toolsCalled.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            <Wrench className="h-3 w-3" /> Tools Called ({debug.toolsCalled.length})
          </div>
          {debug.toolsCalled.map((tc, i) => (
            <div key={i} className="rounded bg-border/20 px-2 py-1.5 space-y-0.5">
              <div className="font-mono text-primary/80">{tc.name}</div>
              <pre className="text-[10px] text-muted-foreground overflow-x-auto">
                {JSON.stringify(tc.args, null, 2)}
              </pre>
              {tc.result && (
                <div className="text-[10px] text-emerald-400/80 mt-1">
                  ↳ {tc.result.slice(0, 120)}{tc.result.length > 120 ? "…" : ""}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {debug.kbChunks && (
        <div className="space-y-1.5">
          <button
            type="button"
            onClick={() => setShowKb(!showKb)}
            className="flex w-full items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors"
          >
            <BookOpen className="h-3 w-3" />
            KB Retrieval Context
            {showKb
              ? <ChevronUp className="h-3 w-3 ml-auto" />
              : <ChevronDown className="h-3 w-3 ml-auto" />}
          </button>
          {showKb && (
            <pre className="text-[10px] text-muted-foreground bg-border/20 rounded p-2 overflow-x-auto max-h-48 whitespace-pre-wrap">
              {debug.kbChunks.slice(0, 2000)}
            </pre>
          )}
        </div>
      )}

      {!debug.kbChunks && (
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/50">
          <BookOpen className="h-3 w-3" />
          No KB sources attached to this agent
        </div>
      )}

      {debug.resolvedPrompt && (
        <div className="space-y-1.5">
          <button
            type="button"
            onClick={() => setShowPrompt(!showPrompt)}
            className="flex w-full items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors"
          >
            <MessageSquare className="h-3 w-3" />
            System Prompt
            {showPrompt
              ? <ChevronUp className="h-3 w-3 ml-auto" />
              : <ChevronDown className="h-3 w-3 ml-auto" />}
          </button>
          {showPrompt && (
            <pre className="text-[10px] text-muted-foreground bg-border/20 rounded p-2 overflow-x-auto max-h-48 whitespace-pre-wrap">
              {debug.resolvedPrompt.slice(0, 3000)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

/* ── ChatBubble ─────────────────────────────────────────────────────────────── */

function ChatBubble({ msg, variant }: {
  msg: ChatMessage | LiveMessage;
  variant?: "manual" | "scenario";
}) {
  const isUser  = msg.role === "user" || msg.role === "persona";
  const isAgent = msg.role === "agent";
  const isTool  = msg.role === "tool_call";

  if (isTool) {
    return (
      <div className="flex items-center gap-2 px-4 py-1.5">
        <div className="h-px flex-1 bg-border/40" />
        <div className="flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-[10px] font-mono text-amber-400">
          <Wrench className="h-2.5 w-2.5" />
          {(msg as LiveMessage).toolName ?? "tool"}
          {(msg as LiveMessage).toolArgs && (
            <span className="opacity-60">
              {JSON.stringify((msg as LiveMessage).toolArgs).slice(0, 60)}
            </span>
          )}
        </div>
        <div className="h-px flex-1 bg-border/40" />
      </div>
    );
  }

  const label = isUser
    ? (variant === "scenario" ? "Persona" : "You")
    : "Agent";

  const avatarClass = isUser
    ? "bg-blue-500/20 text-blue-400"
    : "bg-violet-500/20 text-violet-400";

  const bubbleClass = isUser
    ? "bg-blue-500/10 border border-blue-500/20 rounded-tl-sm"
    : "bg-violet-500/10 border border-violet-500/20 rounded-tr-sm";

  const tools = isAgent
    ? (msg as ChatMessage).toolCalls
    : undefined;

  return (
    <div className={cn("flex gap-2", isAgent ? "flex-row-reverse" : "flex-row")}>
      <div className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold", avatarClass)}>
        {isUser
          ? (variant === "scenario" ? "P" : <User className="h-3.5 w-3.5" />)
          : <Bot className="h-3.5 w-3.5" />}
      </div>
      <div className={cn("max-w-[72%] rounded-2xl px-3.5 py-2.5 text-sm", bubbleClass)}>
        <p className="text-[10px] font-semibold mb-1 text-muted-foreground">{label}</p>
        {msg.content}
        {(msg as ChatMessage).streaming && (
          <span className="inline-block w-1.5 h-3.5 ml-0.5 bg-current animate-pulse rounded-full" />
        )}
        {tools && tools.length > 0 && (
          <div className="mt-2 space-y-1">
            {tools.map((tc, j) => (
              <div key={j} className="rounded bg-black/20 px-2 py-1 text-[10px] font-mono">
                <Wrench className="h-2.5 w-2.5 inline mr-1 text-amber-400" />{tc.name}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── ManualChatPanel ────────────────────────────────────────────────────────── */

function ManualChatPanel({ agentId }: { agentId: number }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [runId, setRunId] = useState<number | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [debug, setDebug] = useState<DebugInfo>({});
  const bottomRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const resetSession = useCallback(() => {
    setMessages([]);
    setRunId(null);
    setDebug({});
    setInput("");
  }, []);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming) return;

    setInput("");
    setStreaming(true);
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setMessages((prev) => [...prev, { role: "agent", content: "", streaming: true }]);

    try {
      const response = await fetch(`${API}/simulation/runs/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthToken() },
        body: JSON.stringify({ agent_id: agentId, run_id: runId, message: text }),
      });

      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let agentText = "";
      let currentEvent = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (line.startsWith("event: ")) { currentEvent = line.slice(7).trim(); continue; }
          if (!line.startsWith("data: ")) continue;
          try {
            const payload = JSON.parse(line.slice(6)) as Record<string, unknown>;
            if (currentEvent === "agent_token" && "token" in payload) {
              agentText += payload["token"] as string;
              setMessages((prev) => {
                const next = [...prev];
                const last = next[next.length - 1];
                if (last?.role === "agent") next[next.length - 1] = { ...last, content: agentText, streaming: true };
                return next;
              });
            } else if (currentEvent === "debug_info") {
              setDebug((prev) => ({ ...prev, ...(payload as DebugInfo) }));
            } else if (currentEvent === "done") {
              if (payload["run_id"]) setRunId(payload["run_id"] as number);
              const doneDebug = payload["debug"] as DebugInfo | undefined;
              if (doneDebug) {
                setDebug(doneDebug);
                if (doneDebug.toolsCalled?.length) {
                  setMessages((prev) => {
                    const next = [...prev];
                    const last = next[next.length - 1];
                    if (last?.role === "agent") {
                      next[next.length - 1] = {
                        ...last,
                        toolCalls: doneDebug.toolsCalled as Array<{ name: string; args: Record<string, unknown> }>,
                        streaming: false,
                      };
                    }
                    return next;
                  });
                }
              }
            } else if (currentEvent === "error") {
              toast({ title: "Simulation error", description: String(payload["error"]), variant: "destructive" });
            }
          } catch {
            // ignore parse errors
          }
        }
      }

      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last?.role === "agent") next[next.length - 1] = { ...last, content: agentText, streaming: false };
        return next;
      });
    } catch (err) {
      toast({ title: "Chat failed", description: String(err), variant: "destructive" });
      setMessages((prev) => prev.slice(0, -1));
    } finally {
      setStreaming(false);
    }
  }, [input, streaming, agentId, runId, toast]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void sendMessage(); }
  };

  return (
    <div className="flex h-full overflow-hidden">
      <div className="flex flex-col flex-1 min-w-0 border-r border-border/50">
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
              <MessageSquare className="h-10 w-10 opacity-20" />
              <p className="text-sm">Type a message to start testing your agent</p>
              <p className="text-xs opacity-60">Tool calls are simulated — no real bookings or webhooks are triggered.</p>
            </div>
          )}
          {messages.map((msg, i) => <ChatBubble key={i} msg={msg} variant="manual" />)}
          <div ref={bottomRef} />
        </div>

        <div className="shrink-0 border-t border-border/60 p-3 flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={resetSession}
            className="shrink-0 h-9 px-2" title="New session">
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message… (Enter to send)"
            className="min-h-[36px] max-h-32 resize-none text-sm py-2"
            rows={1}
            disabled={streaming}
          />
          <Button type="button" size="sm" onClick={sendMessage}
            disabled={!input.trim() || streaming} className="shrink-0 h-9">
            {streaming ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Send"}
          </Button>
        </div>
      </div>

      <div className="w-72 shrink-0 overflow-hidden">
        <DebugPanel debug={debug} />
      </div>
    </div>
  );
}

/* ── KbSourceSelect ─────────────────────────────────────────────────────────── */

function KbSourceSelect({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (id: number | null) => void;
}) {
  const { data: sources } = useQuery<KbSource[]>({
    queryKey: ["kb-sources-sim"],
    queryFn: () => customFetch<KbSource[]>(`${API}/knowledge-sources`),
    staleTime: 60_000,
  });

  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
    >
      <option value="">None — use agent KB sources</option>
      {(sources ?? []).map((s) => (
        <option key={s.id} value={s.id}>
          {s.name} ({s.type}
          {s.entryCount > 0 ? `, ${s.entryCount} entries` : ""})
        </option>
      ))}
    </select>
  );
}

/* ── TestCaseForm (shared by Create and Edit modals) ────────────────────────── */

interface TestCaseFormState {
  name: string;
  personaPrompt: string;
  goal: string;
  successCriteria: string;
  variables: string;
  kbSourceId: number | null;
  maxTurns: number;
}

function emptyForm(): TestCaseFormState {
  return { name: "", personaPrompt: "", goal: "", successCriteria: "", variables: "", kbSourceId: null, maxTurns: 20 };
}

function formFromTestCase(tc: TestCase): TestCaseFormState {
  return {
    name: tc.name,
    personaPrompt: tc.personaPrompt,
    goal: tc.goal,
    successCriteria: tc.successCriteria.join("\n"),
    variables: tc.variables ? JSON.stringify(tc.variables, null, 2) : "",
    kbSourceId: tc.kbSourceId,
    maxTurns: tc.maxTurns,
  };
}

function TestCaseFormFields({
  form,
  onChange,
  categories,
}: {
  form: TestCaseFormState;
  onChange: (patch: Partial<TestCaseFormState>) => void;
  categories?: TemplateCategory[];
}) {
  const [showTemplates, setShowTemplates] = useState(false);
  const [openCategory, setOpenCategory] = useState<string | null>(null);

  const applyTemplate = (t: PersonaTemplate) => {
    onChange({
      name: t.name,
      personaPrompt: t.personaPrompt,
      goal: t.goal,
      successCriteria: t.successCriteria.join("\n"),
    });
    setShowTemplates(false);
    setOpenCategory(null);
  };

  const hasCategories = categories && categories.length > 0;

  return (
    <div className="space-y-4 py-2">
      <div className="space-y-1.5">
        <label className="text-xs font-medium">Name</label>
        <Input value={form.name} onChange={(e) => onChange({ name: e.target.value })} placeholder="e.g. First-Time Buyer" />
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium">Persona Prompt</label>
        <Textarea
          value={form.personaPrompt}
          onChange={(e) => onChange({ personaPrompt: e.target.value })}
          placeholder="Describe who this customer is, their background, concerns, and how they communicate…"
          rows={5} className="text-sm"
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium">Goal</label>
        <Textarea
          value={form.goal}
          onChange={(e) => onChange({ goal: e.target.value })}
          placeholder="What does this customer want to achieve?"
          rows={2} className="text-sm"
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium">
          Success Criteria <span className="text-muted-foreground font-normal">(one per line — leave blank to auto-generate from agent config)</span>
        </label>
        <Textarea
          value={form.successCriteria}
          onChange={(e) => onChange({ successCriteria: e.target.value })}
          placeholder={"Agent explains the product clearly\nAgent collects customer contact details"}
          rows={4} className="text-sm"
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium">
          Variables <span className="text-muted-foreground font-normal">(JSON — override agent prompt variables)</span>
        </label>
        <Textarea
          value={form.variables}
          onChange={(e) => onChange({ variables: e.target.value })}
          placeholder={'{"customer_name": "Jane Doe", "plan_type": "Family"}'}
          rows={2} className="text-sm font-mono"
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium">
          KB Source Override <span className="text-muted-foreground font-normal">(adds to agent KB sources for this test)</span>
        </label>
        <KbSourceSelect value={form.kbSourceId} onChange={(id) => onChange({ kbSourceId: id })} />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium">Max Turns: {form.maxTurns}</label>
        </div>
        <Slider
          value={[form.maxTurns]}
          onValueChange={([v]) => onChange({ maxTurns: v! })}
          min={5} max={50} step={5} className="w-full"
        />
        <div className="flex justify-between text-[10px] text-muted-foreground">
          <span>5</span><span>50</span>
        </div>
      </div>

      {hasCategories && (
        <div className="border border-border/60 rounded-lg overflow-hidden">
          <button
            type="button"
            onClick={() => setShowTemplates(!showTemplates)}
            className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium hover:bg-card/40 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-amber-400" />
              Use a built-in template
            </div>
            {showTemplates ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          {showTemplates && (
            <div className="border-t border-border/60 max-h-72 overflow-y-auto">
              {categories!.map((cat) => (
                <div key={cat.id}>
                  <button
                    type="button"
                    onClick={() => setOpenCategory(openCategory === cat.id ? null : cat.id)}
                    className="w-full flex items-center justify-between px-4 py-2 bg-muted/30 hover:bg-muted/50 transition-colors border-b border-border/40"
                  >
                    <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                      {cat.label}
                    </span>
                    {openCategory === cat.id
                      ? <ChevronUp className="h-3 w-3 text-muted-foreground" />
                      : <ChevronDown className="h-3 w-3 text-muted-foreground" />}
                  </button>
                  {openCategory === cat.id && (
                    <div className="divide-y divide-border/40">
                      {cat.templates.map((t) => (
                        <button key={t.id} type="button" onClick={() => applyTemplate(t)}
                          className="w-full text-left px-4 py-2.5 hover:bg-card/40 transition-colors">
                          <p className="text-sm font-medium">{t.name}</p>
                          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{t.goal}</p>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── CreateTestCaseModal ────────────────────────────────────────────────────── */

function CreateTestCaseModal({
  agentId, open, onClose, onCreated,
}: {
  agentId: number;
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState<TestCaseFormState>(emptyForm());
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: templateData } = useQuery<{ categories: TemplateCategory[] }>({
    queryKey: ["simulation-templates"],
    queryFn: () => customFetch(`${API}/simulation/templates`),
    staleTime: Infinity,
  });

  const handleClose = () => { setForm(emptyForm()); onClose(); };

  const handleSubmit = async () => {
    if (!form.name.trim() || !form.personaPrompt.trim() || !form.goal.trim()) {
      toast({ title: "Validation", description: "Name, persona, and goal are required", variant: "destructive" });
      return;
    }
    let parsedVariables: Record<string, unknown> | undefined;
    if (form.variables.trim()) {
      try {
        parsedVariables = JSON.parse(form.variables) as Record<string, unknown>;
      } catch {
        toast({ title: "Invalid Variables JSON", description: "Variables must be a valid JSON object", variant: "destructive" });
        return;
      }
    }
    setSaving(true);
    try {
      const res = await fetch(`${API}/simulation/test-cases`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthToken() },
        body: JSON.stringify({
          agent_id: agentId,
          name: form.name,
          persona_prompt: form.personaPrompt,
          goal: form.goal,
          success_criteria: form.successCriteria.split("\n").map((s) => s.trim()).filter(Boolean),
          variables: parsedVariables,
          kb_source_id: form.kbSourceId,
          max_turns: form.maxTurns,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      await queryClient.invalidateQueries({ queryKey: ["simulation-test-cases", agentId] });
      onCreated();
      handleClose();
    } catch (err) {
      toast({ title: "Failed to create test case", description: String(err), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Test Case</DialogTitle>
          <DialogDescription>Configure a customer persona to test your agent.</DialogDescription>
        </DialogHeader>
        <TestCaseFormFields
          form={form}
          onChange={(patch) => setForm((prev) => ({ ...prev, ...patch }))}
          categories={templateData?.categories}
        />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={handleClose} disabled={saving}>Cancel</Button>
          <Button type="button" onClick={handleSubmit} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Plus className="h-4 w-4 mr-1" />}
            Create Test Case
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── EditTestCaseModal ──────────────────────────────────────────────────────── */

function EditTestCaseModal({
  agentId, testCase, open, onClose, onSaved,
}: {
  agentId: number;
  testCase: TestCase;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<TestCaseFormState>(formFromTestCase(testCase));
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (open) setForm(formFromTestCase(testCase));
  }, [open, testCase]);

  const handleSubmit = async () => {
    if (!form.name.trim() || !form.personaPrompt.trim() || !form.goal.trim()) {
      toast({ title: "Validation", description: "Name, persona, and goal are required", variant: "destructive" });
      return;
    }
    let parsedVariables: Record<string, unknown> | null = null;
    if (form.variables.trim()) {
      try {
        parsedVariables = JSON.parse(form.variables) as Record<string, unknown>;
      } catch {
        toast({ title: "Invalid Variables JSON", description: "Variables must be a valid JSON object", variant: "destructive" });
        return;
      }
    }
    setSaving(true);
    try {
      const res = await fetch(`${API}/simulation/test-cases/${testCase.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...getAuthToken() },
        body: JSON.stringify({
          name: form.name,
          persona_prompt: form.personaPrompt,
          goal: form.goal,
          success_criteria: form.successCriteria.split("\n").map((s) => s.trim()).filter(Boolean),
          variables: parsedVariables,
          kb_source_id: form.kbSourceId,
          max_turns: form.maxTurns,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      await queryClient.invalidateQueries({ queryKey: ["simulation-test-cases", agentId] });
      onSaved();
      onClose();
    } catch (err) {
      toast({ title: "Failed to save", description: String(err), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Test Case</DialogTitle>
          <DialogDescription>Update the persona, goal, and criteria for this test.</DialogDescription>
        </DialogHeader>
        <TestCaseFormFields
          form={form}
          onChange={(patch) => setForm((prev) => ({ ...prev, ...patch }))}
        />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="button" onClick={handleSubmit} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Pencil className="h-4 w-4 mr-1" />}
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── RunViewer ──────────────────────────────────────────────────────────────── */

function RunViewer({ runId, onBack }: { runId: number; onBack: () => void }) {
  const { data: run, refetch } = useQuery<SimRun>({
    queryKey: ["simulation-run", runId],
    queryFn: () => customFetch<SimRun>(`${API}/simulation/runs/${runId}`),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "running" || status === "pending" ? 2000 : false;
    },
  });

  const downloadReport = async () => {
    const res = await fetch(`${API}/simulation/runs/${runId}/report`, { headers: getAuthToken() });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `simulation-run-${runId}.json`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="shrink-0 flex items-center justify-between px-5 py-3 border-b border-border/60">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onBack} className="h-7 px-2">← Back</Button>
          <span className="text-sm font-medium">Run #{runId}</span>
          {run && <StatusBadge status={run.status} />}
          {run?.result?.evaluationError
            ? <ScoreBadge score={null} evaluationError />
            : run?.score != null && <ScoreBadge score={run.score} pass={run?.result?.pass} />}
        </div>
        <div className="flex items-center gap-2">
          {(run?.status === "running" || run?.status === "pending") && (
            <Button variant="ghost" size="sm" onClick={() => void refetch()} className="h-7 px-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> Refreshing…
            </Button>
          )}
          {run?.status === "completed" && (
            <Button variant="outline" size="sm" onClick={downloadReport} className="h-7">
              <Download className="h-3.5 w-3.5 mr-1" /> Download JSON
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-1 min-h-0 overflow-hidden">
        <div className="flex-1 overflow-y-auto p-5 space-y-3 border-r border-border/50">
          {(!run || run.messages.length === 0) && (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}
          {run?.messages.map((msg, i) => {
            if (msg.role === "agent" && (msg.metadata?.toolsCalled?.length ?? 0) > 0) {
              return (
                <React.Fragment key={i}>
                  {msg.metadata!.toolsCalled!.map((tc, j) => (
                    <ChatBubble
                      key={`tool-${i}-${j}`}
                      msg={{ role: "tool_call", content: tc.name, toolName: tc.name, toolArgs: tc.args }}
                      variant="scenario"
                    />
                  ))}
                  <ChatBubble msg={{ role: "agent", content: msg.content }} variant="scenario" />
                </React.Fragment>
              );
            }
            return (
              <ChatBubble
                key={i}
                msg={{ role: msg.role as "user" | "agent", content: msg.content }}
                variant="scenario"
              />
            );
          })}
        </div>
        {run?.result && (
          <div className="w-80 shrink-0 overflow-y-auto p-4">
            <ScoreCard result={run.result} />
          </div>
        )}
      </div>
    </div>
  );
}

/* ── StreamingRunPanel ──────────────────────────────────────────────────────── */

interface StreamingRunState {
  runId: number | null;
  messages: LiveMessage[];
  status: "running" | "completed" | "failed";
  score?: number | null;
  pass?: boolean;
  result?: RunScore | null;
  error?: string;
}

function StreamingRunPanel({
  state, onViewDetails, onBack,
}: {
  state: StreamingRunState;
  onViewDetails: () => void;
  onBack: () => void;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [state.messages]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="shrink-0 flex items-center justify-between px-5 py-3 border-b border-border/60">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onBack} className="h-7 px-2">← Back</Button>
          <span className="text-sm font-medium">{state.runId ? `Run #${state.runId}` : "Starting…"}</span>
          <StatusBadge status={state.result?.evaluationError ? "evaluation_error" : state.status} />
          {state.result?.evaluationError
            ? <ScoreBadge score={null} evaluationError />
            : state.score != null && <ScoreBadge score={state.score} pass={state.pass} />}
        </div>
        {state.status === "completed" && state.runId && (
          <Button size="sm" variant="outline" onClick={onViewDetails} className="h-7">
            View Full Report →
          </Button>
        )}
      </div>

      <div className="flex flex-1 min-h-0 overflow-hidden">
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {state.messages.length === 0 && state.status === "running" && (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin opacity-40" />
              <p className="text-sm">Simulation starting…</p>
            </div>
          )}
          {state.messages.map((msg, i) => <ChatBubble key={i} msg={msg} variant="scenario" />)}
          {state.status === "running" && state.messages.length > 0 && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground px-2">
              <Loader2 className="h-3 w-3 animate-spin" /> Simulation running…
            </div>
          )}
          {state.status === "failed" && (
            <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {state.error ?? "Simulation failed"}
            </div>
          )}
          <div ref={bottomRef} />
        </div>
        {state.result && (
          <div className="w-80 shrink-0 overflow-y-auto p-4">
            <ScoreCard result={state.result} />
          </div>
        )}
      </div>
    </div>
  );
}

/* ── BatchRunPanel ──────────────────────────────────────────────────────────── */

function BatchRunPanel({
  testCases,
  onBack,
  onViewRun,
}: {
  testCases: TestCase[];
  onBack: () => void;
  onViewRun: (runId: number) => void;
}) {
  const [results, setResults] = useState<BatchRunResult[]>(
    testCases.map((tc) => ({
      testCaseId: tc.id,
      testCaseName: tc.name,
      status: "pending",
      score: null,
      pass: null,
      durationMs: null,
      runId: null,
    })),
  );
  const [currentIdx, setCurrentIdx] = useState(-1);
  const [started, setStarted] = useState(false);
  const [done, setDone] = useState(false);
  const abortRef = useRef(false);
  const { toast } = useToast();

  const runOnce = useCallback(
    async (tc: TestCase, idx: number): Promise<void> => {
      const startTime = Date.now();
      setResults((prev) =>
        prev.map((r, i) => i === idx ? { ...r, status: "running" } : r),
      );

      try {
        const response = await fetch(`${API}/simulation/runs/stream`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...getAuthToken() },
          body: JSON.stringify({ test_case_id: tc.id, max_turns: tc.maxTurns }),
        });

        if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let currentEvent = "";
        let runId: number | null = null;

        while (true) {
          if (abortRef.current) { reader.cancel(); break; }
          const { done: streamDone, value } = await reader.read();
          if (streamDone) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (line.startsWith("event: ")) { currentEvent = line.slice(7).trim(); continue; }
            if (!line.startsWith("data: ")) continue;
            try {
              const payload = JSON.parse(line.slice(6)) as Record<string, unknown>;
              if (currentEvent === "run_created") {
                runId = payload["run_id"] as number;
                setResults((prev) => prev.map((r, i) => i === idx ? { ...r, runId } : r));
              } else if (currentEvent === "completed") {
                const score = payload["score"] as number | null;
                const pass = payload["pass"] as boolean;
                setResults((prev) =>
                  prev.map((r, i) =>
                    i === idx
                      ? { ...r, status: "completed", score, pass, durationMs: Date.now() - startTime }
                      : r,
                  ),
                );
              } else if (currentEvent === "failed") {
                setResults((prev) =>
                  prev.map((r, i) =>
                    i === idx
                      ? { ...r, status: "failed", error: payload["error"] as string, durationMs: Date.now() - startTime }
                      : r,
                  ),
                );
              }
            } catch {
              // ignore
            }
          }
        }
      } catch (err) {
        setResults((prev) =>
          prev.map((r, i) =>
            i === idx
              ? { ...r, status: "failed", error: String(err), durationMs: Date.now() - startTime }
              : r,
          ),
        );
      }
    },
    [toast],
  );

  const runAll = useCallback(async () => {
    abortRef.current = false;
    setStarted(true);
    for (let i = 0; i < testCases.length; i++) {
      if (abortRef.current) break;
      setCurrentIdx(i);
      await runOnce(testCases[i]!, i);
    }
    setCurrentIdx(-1);
    setDone(true);
  }, [testCases, runOnce]);

  useEffect(() => { void runAll(); return () => { abortRef.current = true; }; }, []);

  const passed  = results.filter((r) => r.pass === true).length;
  const failed  = results.filter((r) => r.pass === false && r.status === "completed").length;
  const errored = results.filter((r) => r.status === "failed").length;
  const pending = results.filter((r) => r.status === "pending" || r.status === "running").length;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="shrink-0 flex items-center justify-between px-5 py-3 border-b border-border/60">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onBack} className="h-7 px-2">← Back</Button>
          <span className="text-sm font-medium">Batch Run ({testCases.length} scenarios)</span>
          {!done && <Badge variant="outline" className="bg-blue-600/20 text-blue-400 border-blue-600/30">
            <Loader2 className="h-2.5 w-2.5 mr-1 animate-spin" /> Running…
          </Badge>}
          {done && <Badge variant="outline" className="bg-emerald-600/20 text-emerald-400 border-emerald-600/30">
            <CheckCircle2 className="h-2.5 w-2.5 mr-1" /> Complete
          </Badge>}
        </div>
        {done && (
          <div className="flex items-center gap-3 text-xs">
            <span className="text-emerald-400">{passed} passed</span>
            <span className="text-red-400">{failed + errored} failed</span>
            {pending > 0 && <span className="text-amber-400">{pending} pending</span>}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-background/95 backdrop-blur z-10">
            <tr className="border-b border-border/60">
              <th className="text-left px-5 py-2.5 text-xs font-semibold text-muted-foreground">Scenario</th>
              <th className="text-left px-3 py-2.5 text-xs font-semibold text-muted-foreground">Status</th>
              <th className="text-left px-3 py-2.5 text-xs font-semibold text-muted-foreground">Score</th>
              <th className="text-left px-3 py-2.5 text-xs font-semibold text-muted-foreground">Duration</th>
              <th className="text-left px-3 py-2.5 text-xs font-semibold text-muted-foreground">Result</th>
              <th className="px-3 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {results.map((r, i) => (
              <tr key={r.testCaseId} className={cn(
                "border-b border-border/40 transition-colors",
                i === currentIdx && "bg-blue-500/5",
              )}>
                <td className="px-5 py-3">
                  <div className="flex items-center gap-2">
                    {i === currentIdx && <Loader2 className="h-3 w-3 animate-spin text-blue-400 shrink-0" />}
                    <span className="font-medium truncate max-w-[200px]">{r.testCaseName}</span>
                  </div>
                </td>
                <td className="px-3 py-3"><StatusBadge status={r.status} /></td>
                <td className="px-3 py-3 font-mono tabular-nums text-xs">
                  {r.score != null ? `${r.score}/100` : "—"}
                </td>
                <td className="px-3 py-3 tabular-nums text-xs text-muted-foreground">
                  {r.durationMs != null ? `${(r.durationMs / 1000).toFixed(1)}s` : "—"}
                </td>
                <td className="px-3 py-3">
                  {r.status === "completed" && r.pass != null && (
                    r.pass
                      ? <span className="flex items-center gap-1 text-emerald-400 text-xs font-medium"><CheckCircle2 className="h-3.5 w-3.5" /> PASS</span>
                      : <span className="flex items-center gap-1 text-red-400 text-xs font-medium"><XCircle className="h-3.5 w-3.5" /> FAIL</span>
                  )}
                  {r.status === "failed" && (
                    <span className="flex items-center gap-1 text-red-400 text-xs font-medium">
                      <AlertTriangle className="h-3.5 w-3.5" /> Error
                    </span>
                  )}
                  {(r.status === "pending" || r.status === "running") && (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-3 py-3 text-right">
                  {r.runId && r.status === "completed" && (
                    <Button variant="ghost" size="sm" className="h-6 px-2 text-xs"
                      onClick={() => onViewRun(r.runId!)}>
                      View →
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── ScenarioPanel ──────────────────────────────────────────────────────────── */

type ScenarioPanelView = "list" | "streaming" | "viewing" | "batch";

function ScenarioPanel({ agentId }: { agentId: number }) {
  const [view, setView] = useState<ScenarioPanelView>("list");
  const [createOpen, setCreateOpen] = useState(false);
  const [editingTc, setEditingTc] = useState<TestCase | null>(null);
  const [viewingRunId, setViewingRunId] = useState<number | null>(null);
  const [streamingState, setStreamingState] = useState<StreamingRunState>({
    runId: null, messages: [], status: "running",
  });
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: cases, isLoading } = useQuery<TestCase[]>({
    queryKey: ["simulation-test-cases", agentId],
    queryFn: () => customFetch(`${API}/simulation/test-cases?agent_id=${agentId}`),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) =>
      fetch(`${API}/simulation/test-cases/${id}`, { method: "DELETE", headers: getAuthToken() }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["simulation-test-cases", agentId] });
      toast({ title: "Test case deleted" });
    },
  });

  const runTestCase = useCallback(async (tc: TestCase) => {
    setStreamingState({ runId: null, messages: [], status: "running" });
    setView("streaming");

    try {
      const response = await fetch(`${API}/simulation/runs/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthToken() },
        body: JSON.stringify({ test_case_id: tc.id, max_turns: tc.maxTurns }),
      });

      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let currentEvent = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (line.startsWith("event: ")) { currentEvent = line.slice(7).trim(); continue; }
          if (!line.startsWith("data: ")) continue;
          try {
            const payload = JSON.parse(line.slice(6)) as Record<string, unknown>;

            if (currentEvent === "run_created") {
              setStreamingState((prev) => ({ ...prev, runId: payload["run_id"] as number }));
            } else if (currentEvent === "persona_message") {
              setStreamingState((prev) => ({
                ...prev,
                messages: [...prev.messages, {
                  role: "persona", content: payload["content"] as string, turn: payload["turn"] as number,
                }],
              }));
            } else if (currentEvent === "agent_message") {
              const toolsCalled = payload["toolsCalled"] as Array<{ name: string; args: Record<string, unknown> }> | undefined;
              const newMsgs: LiveMessage[] = [];
              if (toolsCalled?.length) {
                for (const tc of toolsCalled) {
                  newMsgs.push({ role: "tool_call", content: tc.name, toolName: tc.name, toolArgs: tc.args, turn: payload["turn"] as number });
                }
              }
              newMsgs.push({ role: "agent", content: payload["content"] as string, turn: payload["turn"] as number });
              setStreamingState((prev) => ({ ...prev, messages: [...prev.messages, ...newMsgs] }));
            } else if (currentEvent === "tool_call") {
              setStreamingState((prev) => ({
                ...prev,
                messages: [...prev.messages, {
                  role: "tool_call", content: payload["name"] as string,
                  toolName: payload["name"] as string, toolArgs: payload["args"] as Record<string, unknown>,
                  turn: payload["turn"] as number,
                }],
              }));
            } else if (currentEvent === "completed") {
              setStreamingState((prev) => ({
                ...prev, status: "completed",
                score: payload["score"] as number | null,
                pass: payload["pass"] as boolean,
                result: (payload["result"] as RunScore | null) ?? null,
              }));
              void queryClient.invalidateQueries({ queryKey: ["simulation-test-cases", agentId] });
            } else if (currentEvent === "failed") {
              setStreamingState((prev) => ({ ...prev, status: "failed", error: payload["error"] as string }));
            }
          } catch { /* ignore */ }
        }
      }
    } catch (err) {
      setStreamingState((prev) => ({ ...prev, status: "failed", error: String(err) }));
    }
  }, [agentId, queryClient]);

  if (view === "streaming") {
    return (
      <StreamingRunPanel
        state={streamingState}
        onViewDetails={() => { if (streamingState.runId) { setViewingRunId(streamingState.runId); setView("viewing"); } }}
        onBack={() => setView("list")}
      />
    );
  }

  if (view === "viewing" && viewingRunId) {
    return <RunViewer runId={viewingRunId} onBack={() => { setView("list"); setViewingRunId(null); }} />;
  }

  if (view === "batch" && cases && cases.length > 0) {
    return (
      <BatchRunPanel
        testCases={cases}
        onBack={() => { setView("list"); void queryClient.invalidateQueries({ queryKey: ["simulation-test-cases", agentId] }); }}
        onViewRun={(runId) => { setViewingRunId(runId); setView("viewing"); }}
      />
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="shrink-0 flex items-center justify-between px-5 py-3 border-b border-border/60">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">Test Cases</h3>
          {cases && cases.length > 0 && (
            <Badge variant="secondary" className="text-xs">{cases.length}</Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {cases && cases.length > 1 && (
            <Button size="sm" variant="outline" onClick={() => setView("batch")} className="h-7">
              <PlayCircle className="h-3.5 w-3.5 mr-1" /> Run All
            </Button>
          )}
          <Button size="sm" onClick={() => setCreateOpen(true)} className="h-7">
            <Plus className="h-3.5 w-3.5 mr-1" /> New Test Case
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {isLoading && (
          <div className="p-5 space-y-3">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
          </div>
        )}

        {!isLoading && cases?.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground py-16">
            <ListChecks className="h-10 w-10 opacity-20" />
            <p className="text-sm font-medium">No test cases yet</p>
            <p className="text-xs">Create one to start scenario testing your agent.</p>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="h-3.5 w-3.5 mr-1" /> New Test Case
            </Button>
          </div>
        )}

        {!isLoading && cases && cases.length > 0 && (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-background/95 backdrop-blur z-10">
              <tr className="border-b border-border/60">
                <th className="text-left px-5 py-2.5 text-xs font-semibold text-muted-foreground">Scenario</th>
                <th className="text-left px-3 py-2.5 text-xs font-semibold text-muted-foreground">Last Score</th>
                <th className="text-left px-3 py-2.5 text-xs font-semibold text-muted-foreground">Last Run</th>
                <th className="text-left px-3 py-2.5 text-xs font-semibold text-muted-foreground">Turns</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {cases.map((tc) => (
                <tr key={tc.id} className="border-b border-border/40 hover:bg-card/20 transition-colors group">
                  <td className="px-5 py-3">
                    <div>
                      <p className="font-medium">{tc.name}</p>
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{tc.goal}</p>
                      <div className="flex gap-3 mt-1 text-[11px] text-muted-foreground/70">
                        {tc.successCriteria.length > 0 && (
                          <span>{tc.successCriteria.length} criteria</span>
                        )}
                        {tc.variables && Object.keys(tc.variables).length > 0 && (
                          <span>{Object.keys(tc.variables).length} vars</span>
                        )}
                        {tc.kbSourceId && <span>KB override</span>}
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    {tc.lastRun
                      ? <ScoreBadge
                          score={tc.lastRun.score}
                          pass={tc.lastRun.score != null && tc.lastRun.score >= 70}
                          evaluationError={tc.lastRun.status === "evaluation_error"}
                        />
                      : <span className="text-xs text-muted-foreground/50">—</span>}
                  </td>
                  <td className="px-3 py-3 text-xs text-muted-foreground">
                    {tc.lastRun
                      ? (
                        <div className="space-y-0.5">
                          <StatusBadge status={tc.lastRun.status} />
                          <p className="text-[10px] mt-1">{new Date(tc.lastRun.createdAt).toLocaleDateString()}</p>
                        </div>
                      )
                      : <span className="text-muted-foreground/50">never</span>}
                  </td>
                  <td className="px-3 py-3 text-xs text-muted-foreground tabular-nums">{tc.maxTurns}</td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-1 justify-end">
                      <Button size="sm" variant="outline" onClick={() => void runTestCase(tc)} className="h-7">
                        <Play className="h-3 w-3 mr-1" /> Run
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditingTc(tc)}
                        className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground">
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => deleteMutation.mutate(tc.id)}
                        className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <CreateTestCaseModal
        agentId={agentId}
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => setCreateOpen(false)}
      />
      {editingTc && (
        <EditTestCaseModal
          agentId={agentId}
          testCase={editingTc}
          open={!!editingTc}
          onClose={() => setEditingTc(null)}
          onSaved={() => setEditingTc(null)}
        />
      )}
    </div>
  );
}

/* ── SimulationTab ──────────────────────────────────────────────────────────── */

type SimTab = "chat" | "scenario";

export function SimulationTab({ agentId }: { agentId: number }) {
  const [activeTab, setActiveTab] = useState<SimTab>("chat");

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-0.5 px-4 pt-3 pb-0 border-b border-border/60 shrink-0">
        {[
          { id: "chat" as SimTab, label: "Manual Chat", icon: <MessageSquare className="h-3 w-3" /> },
          { id: "scenario" as SimTab, label: "Scenario Simulation", icon: <Play className="h-3 w-3" /> },
        ].map((tab) => (
          <button
            key={tab.id} type="button" onClick={() => setActiveTab(tab.id)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-2 text-xs font-medium whitespace-nowrap border-b-2 transition-colors -mb-px",
              activeTab === tab.id
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.icon}{tab.label}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        {activeTab === "chat" && <ManualChatPanel agentId={agentId} />}
        {activeTab === "scenario" && <ScenarioPanel agentId={agentId} />}
      </div>
    </div>
  );
}
