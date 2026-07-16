import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import {
  ListTodo, Send, Loader2, Phone, MapPin, CheckCircle2, XCircle,
  Sparkles, Bot, RefreshCw, ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

function getToken(): string | null {
  try { return localStorage.getItem("voiceorch:session"); } catch { return null; }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
  }
  return data as T;
}

type EligibleAgent = {
  id: number;
  name: string;
  useCase: string | null;
  description: string | null;
  outboundNumber: string | null;
  telephonyProvider: string;
};

type TaskRow = {
  id: number;
  title: string;
  goal: string;
  status: string;
  dialPolicy: string;
  agentId: number;
  resultSummary: string | null;
  updatedAt: string;
};

type Candidate = {
  id: number;
  name: string;
  phone: string | null;
  address: string | null;
  sourceUrl: string | null;
  rank: number;
  selected: boolean;
};

type Message = {
  id: number;
  role: string;
  content: string;
  createdAt: string;
};

type TaskDetail = {
  task: TaskRow & { prefs?: Record<string, unknown>; errorMessage?: string | null; dialAttempts?: number };
  messages: Message[];
  candidates: Candidate[];
  steps: Array<{ id: number; type: string; status: string }>;
  calls: Array<{ id: number; callId: number | null; outcome: string | null; toNumber: string }>;
};

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  running: "Looking up…",
  awaiting_approval: "Awaiting approval",
  calling: "Calling…",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

export default function TasksPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [agents, setAgents] = useState<EligibleAgent[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [agentId, setAgentId] = useState<string>("");
  const [dialPolicy, setDialPolicy] = useState<"approval" | "auto">("approval");
  const [goal, setGoal] = useState("");
  const [activeId, setActiveId] = useState<number | null>(null);
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [chatInput, setChatInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadingList, setLoadingList] = useState(true);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const loadAgents = useCallback(async () => {
    try {
      const data = await api<{ agents: EligibleAgent[] }>("/api/agent-tasks/eligible-agents");
      setAgents(data.agents);
      if (data.agents[0] && !agentId) setAgentId(String(data.agents[0].id));
    } catch (err) {
      toast({ title: "Could not load agents", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    }
  }, [agentId, toast]);

  const loadTasks = useCallback(async () => {
    setLoadingList(true);
    try {
      const data = await api<{ tasks: TaskRow[] }>("/api/agent-tasks");
      setTasks(data.tasks);
    } catch (err) {
      toast({ title: "Could not load tasks", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setLoadingList(false);
    }
  }, [toast]);

  const loadDetail = useCallback(async (id: number) => {
    try {
      const data = await api<TaskDetail>(`/api/agent-tasks/${id}`);
      setDetail(data);
      setActiveId(id);
    } catch (err) {
      toast({ title: "Could not load task", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    }
  }, [toast]);

  useEffect(() => {
    void loadAgents();
    void loadTasks();
  }, [loadAgents, loadTasks]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [detail?.messages?.length]);

  // Poll while calling / running
  useEffect(() => {
    if (!activeId || !detail) return;
    const s = detail.task.status;
    if (!["running", "calling"].includes(s)) return;
    const t = setInterval(() => { void loadDetail(activeId); }, 4000);
    return () => clearInterval(t);
  }, [activeId, detail?.task.status, loadDetail]);

  const createTask = async () => {
    if (!agentId || !goal.trim()) {
      toast({ title: "Pick an agent and describe the task", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const data = await api<TaskDetail>("/api/agent-tasks", {
        method: "POST",
        body: JSON.stringify({ agentId: Number(agentId), goal: goal.trim(), dialPolicy }),
      });
      setGoal("");
      setDetail(data);
      setActiveId(data.task.id);
      await loadTasks();
    } catch (err) {
      toast({ title: "Could not start task", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const sendChat = async () => {
    if (!activeId || !chatInput.trim()) return;
    setBusy(true);
    try {
      const data = await api<TaskDetail>(`/api/agent-tasks/${activeId}/messages`, {
        method: "POST",
        body: JSON.stringify({ content: chatInput.trim() }),
      });
      setChatInput("");
      setDetail(data);
      await loadTasks();
    } catch (err) {
      toast({ title: "Message failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const approve = async (candidateId: number) => {
    if (!activeId) return;
    setBusy(true);
    try {
      const data = await api<TaskDetail>(`/api/agent-tasks/${activeId}/approve`, {
        method: "POST",
        body: JSON.stringify({ candidateId }),
      });
      setDetail(data);
      await loadTasks();
    } catch (err) {
      toast({ title: "Could not start call", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (!activeId) return;
    setBusy(true);
    try {
      const data = await api<TaskDetail>(`/api/agent-tasks/${activeId}/cancel`, { method: "POST", body: "{}" });
      setDetail(data);
      await loadTasks();
    } catch (err) {
      toast({ title: "Cancel failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const selectedAgent = useMemo(
    () => agents.find((a) => String(a.id) === agentId),
    [agents, agentId],
  );

  return (
    <div className="flex h-[calc(100vh-4rem)] min-h-[520px] gap-0 overflow-hidden">
      {/* Left: task list + composer */}
      <aside className="w-[320px] shrink-0 border-r border-border flex flex-col bg-muted/20">
        <div className="p-4 border-b border-border space-y-3">
          <div className="flex items-center gap-2">
            <ListTodo className="h-4 w-4 text-primary" />
            <h1 className="text-sm font-semibold tracking-tight">Agent Tasks</h1>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Chat with your outbound agent to find public business numbers and book by phone.
          </p>

          {agents.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground space-y-2">
              <p>Create an outbound agent in Vibe Build first, then come back here.</p>
              <Button size="sm" variant="secondary" className="w-full" onClick={() => setLocation("/app/vibe")}>
                <Sparkles className="h-3.5 w-3.5 mr-1.5" /> Open Vibe Build
              </Button>
            </div>
          ) : (
            <>
              <div className="space-y-1.5">
                <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Agent</label>
                <Select value={agentId} onValueChange={setAgentId}>
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue placeholder="Select agent" />
                  </SelectTrigger>
                  <SelectContent>
                    {agents.map((a) => (
                      <SelectItem key={a.id} value={String(a.id)}>
                        {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedAgent?.outboundNumber && (
                  <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                    <Phone className="h-3 w-3" /> {selectedAgent.outboundNumber}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Dial policy</label>
                <Select value={dialPolicy} onValueChange={(v) => setDialPolicy(v as "approval" | "auto")}>
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="approval">Ask me before calling</SelectItem>
                    <SelectItem value="auto">Auto-call top match</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <Textarea
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                placeholder='e.g. Find a salon near T Nagar and book Saturday after 4pm'
                className="min-h-[88px] text-sm resize-none"
              />
              <Button className="w-full" disabled={busy || !goal.trim()} onClick={() => void createTask()}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
                Start task
              </Button>
            </>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          <div className="flex items-center justify-between px-2 py-1">
            <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Recent</span>
            <button type="button" className="p-1 rounded hover:bg-muted" onClick={() => void loadTasks()}>
              <RefreshCw className={cn("h-3.5 w-3.5 text-muted-foreground", loadingList && "animate-spin")} />
            </button>
          </div>
          {tasks.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => void loadDetail(t.id)}
              className={cn(
                "w-full text-left rounded-lg px-3 py-2.5 transition-colors",
                activeId === t.id ? "bg-primary/10 border border-primary/20" : "hover:bg-muted/60 border border-transparent",
              )}
            >
              <div className="text-sm font-medium truncate">{t.title}</div>
              <div className="text-[11px] text-muted-foreground mt-0.5">
                {STATUS_LABEL[t.status] ?? t.status} · {t.dialPolicy}
              </div>
            </button>
          ))}
          {!loadingList && tasks.length === 0 && (
            <p className="text-xs text-muted-foreground px-3 py-6 text-center">No tasks yet.</p>
          )}
        </div>
      </aside>

      {/* Main: chat + candidates */}
      <main className="flex-1 flex flex-col min-w-0 bg-background">
        {!detail ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center p-8">
            <Bot className="h-10 w-10 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground max-w-sm">
              Start a task or select one from the list. Your agent will look up public listings, then call after you approve (or automatically if you chose auto-dial).
            </p>
          </div>
        ) : (
          <>
            <header className="border-b border-border px-5 py-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold truncate">{detail.task.title}</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {STATUS_LABEL[detail.task.status] ?? detail.task.status}
                  {detail.task.resultSummary ? ` · ${detail.task.resultSummary.slice(0, 80)}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {detail.calls[0]?.callId && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setLocation(`/app/calls/${detail.calls[0]!.callId}`)}
                  >
                    <ExternalLink className="h-3.5 w-3.5 mr-1.5" /> Call log
                  </Button>
                )}
                {!["completed", "cancelled", "failed"].includes(detail.task.status) && (
                  <Button variant="ghost" size="sm" disabled={busy} onClick={() => void cancel()}>
                    <XCircle className="h-3.5 w-3.5 mr-1.5" /> Cancel
                  </Button>
                )}
              </div>
            </header>

            {detail.candidates.filter((c) => c.phone).length > 0 && (
              <div className="border-b border-border px-5 py-3 bg-muted/15">
                <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-2">Listings</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {detail.candidates.filter((c) => c.phone).map((c) => (
                    <div
                      key={c.id}
                      className={cn(
                        "rounded-lg border px-3 py-2.5 text-sm",
                        c.selected ? "border-primary/40 bg-primary/5" : "border-border bg-background",
                      )}
                    >
                      <div className="font-medium">{c.rank}. {c.name}</div>
                      <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                        <Phone className="h-3 w-3" /> {c.phone}
                      </div>
                      {c.address && (
                        <div className="text-xs text-muted-foreground mt-0.5 flex items-start gap-1">
                          <MapPin className="h-3 w-3 mt-0.5 shrink-0" /> <span>{c.address}</span>
                        </div>
                      )}
                      {detail.task.status === "awaiting_approval" && (
                        <Button
                          size="sm"
                          className="mt-2 w-full"
                          disabled={busy}
                          onClick={() => void approve(c.id)}
                        >
                          <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" /> Call this one
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
              {detail.messages
                .filter((m) => m.role !== "system")
                .map((m) => (
                  <div
                    key={m.id}
                    className={cn(
                      "max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm whitespace-pre-wrap",
                      m.role === "user"
                        ? "ml-auto bg-primary text-primary-foreground"
                        : "mr-auto bg-muted text-foreground",
                    )}
                  >
                    {m.content}
                  </div>
                ))}
              <div ref={chatEndRef} />
            </div>

            <div className="border-t border-border p-4 flex gap-2">
              <Textarea
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder={
                  detail.task.status === "awaiting_approval"
                    ? "Reply with 1, 2, … or refine the search"
                    : "Send a message…"
                }
                className="min-h-[44px] max-h-28 text-sm resize-none"
                disabled={["completed", "cancelled", "failed"].includes(detail.task.status) || busy}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void sendChat();
                  }
                }}
              />
              <Button
                size="icon"
                className="h-11 w-11 shrink-0"
                disabled={busy || !chatInput.trim() || ["completed", "cancelled", "failed"].includes(detail.task.status)}
                onClick={() => void sendChat()}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
