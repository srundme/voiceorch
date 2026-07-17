import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { useRoute, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  Send, Loader2, ArrowLeft, Workflow as WorkflowIcon, Phone, Plus, Pencil,
  GitBranch, Timer, Webhook, Sheet as SheetIcon, Copy, Check, Sparkles, PlayCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useListAgents } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import {
  useWorkflow, useWorkflowRuns, useSetWorkflowStatus, useUpdateWorkflow,
  useSheetsConnections, getSheetsConnectUrl, listSpreadsheets, listSheetTabs,
  getToken, type Workflow, type WorkflowStep, type WorkflowTriggerType,
} from "./api";

interface ChatMsg { id: string; role: "user" | "ai"; content: string; streaming?: boolean; }
function uid() { return Math.random().toString(36).slice(2); }

const TRIGGER_LABEL: Record<WorkflowTriggerType, string> = {
  form_lead: "When a website / form lead arrives",
  instagram_lead: "When an Instagram lead arrives",
  sheet_row: "When a new row is added to a Google Sheet",
  manual: "When triggered manually",
};

const STARTERS = [
  "When a lead comes in from my website form, call them with my Sales agent and save the result to my Google Sheet.",
  "For every new row in my Google Sheet, call the number and write back whether they were interested.",
  "When an Instagram lead comes in, call them, and if they book a meeting add them to my sheet.",
];

/* ── Step rendering ──────────────────────────────────────────────────────────── */

function stepIcon(type: string) {
  switch (type) {
    case "make_call": return Phone;
    case "sheet_append": return Plus;
    case "sheet_update": return Pencil;
    case "condition": return GitBranch;
    case "delay": return Timer;
    case "send_webhook": return Webhook;
    default: return WorkflowIcon;
  }
}

function stepLabel(step: WorkflowStep, agentName: (id?: number) => string): string {
  switch (step.type) {
    case "make_call": return `Call the lead with “${agentName(step.agentId)}”`;
    case "sheet_append": return "Add a new row to the Google Sheet with the call results";
    case "sheet_update": return `Update the matching row (by ${step.matchColumn ?? "phone"}) in the Google Sheet`;
    case "condition": return `Continue only if ${step.field ?? "value"} ${step.op ?? "exists"} ${step.value ?? ""}`.trim();
    case "delay": return `Wait ${step.delaySeconds ?? 0} seconds`;
    case "send_webhook": return `Send the data to ${step.url ?? "a webhook"}`;
    default: return step.type;
  }
}

function workflowNeedsSheet(wf: Workflow | undefined): boolean {
  if (!wf) return false;
  if (wf.trigger?.type === "sheet_row") return true;
  return (wf.steps ?? []).some((s) => s.type === "sheet_append" || s.type === "sheet_update");
}

/* ── Google Sheet binder ─────────────────────────────────────────────────────── */

function SheetBinder({ wf }: { wf: Workflow }) {
  const { data: connections } = useSheetsConnections();
  const update = useUpdateWorkflow();
  const { toast } = useToast();
  const conn = connections?.[0] ?? null;

  const [spreadsheets, setSpreadsheets] = useState<Array<{ id: string; name: string }>>([]);
  const [tabs, setTabs] = useState<string[]>([]);
  const [spreadsheetId, setSpreadsheetId] = useState(wf.trigger?.spreadsheetId ?? "");
  const [sheetName, setSheetName] = useState(wf.trigger?.sheetName ?? "");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!conn) return;
    listSpreadsheets(conn.id).then(setSpreadsheets).catch(() => setSpreadsheets([]));
  }, [conn?.id]);

  useEffect(() => {
    if (!conn || !spreadsheetId) { setTabs([]); return; }
    listSheetTabs(conn.id, spreadsheetId).then(setTabs).catch(() => setTabs([]));
  }, [conn?.id, spreadsheetId]);

  const connect = async () => {
    try { window.location.href = await getSheetsConnectUrl(); }
    catch { toast({ title: "Google isn't configured on this platform.", variant: "destructive" }); }
  };

  const save = async () => {
    if (!conn || !spreadsheetId || !sheetName) return;
    setLoading(true);
    const spreadsheetName = spreadsheets.find((s) => s.id === spreadsheetId)?.name;
    const trigger = wf.trigger?.type === "sheet_row"
      ? { ...wf.trigger, connectionId: conn.id, spreadsheetId, spreadsheetName, sheetName }
      : wf.trigger;
    const steps = (wf.steps ?? []).map((s) =>
      s.type === "sheet_append" || s.type === "sheet_update"
        ? { ...s, connectionId: conn.id, spreadsheetId, sheetName }
        : s);
    try {
      await update.mutateAsync({ id: wf.id, body: { trigger, steps } });
      toast({ title: "Google Sheet connected to this workflow." });
    } catch (e) {
      toast({ title: "Couldn't save", description: String((e as Error).message), variant: "destructive" });
    } finally { setLoading(false); }
  };

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <SheetIcon size={16} className="text-emerald-500" /> Google Sheet
      </div>
      {!conn ? (
        <div className="mt-3">
          <p className="text-sm text-muted-foreground">Connect a Google account to read from and write to your sheets.</p>
          <Button size="sm" className="mt-3" onClick={connect}>Connect Google Sheets</Button>
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <p className="text-xs text-muted-foreground">Connected as {conn.email}</p>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Spreadsheet</label>
            <Select value={spreadsheetId} onValueChange={setSpreadsheetId}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Choose a spreadsheet" /></SelectTrigger>
              <SelectContent>
                {spreadsheets.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Tab</label>
            <Select value={sheetName} onValueChange={setSheetName} disabled={!spreadsheetId}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Choose a tab" /></SelectTrigger>
              <SelectContent>
                {tabs.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button size="sm" onClick={save} disabled={loading || !spreadsheetId || !sheetName}>
            {loading ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : null} Save sheet
          </Button>
        </div>
      )}
    </div>
  );
}

/* ── Hook URL box (form/instagram triggers) ──────────────────────────────────── */

function HookUrlBox({ hookUrl }: { hookUrl: string }) {
  const [copied, setCopied] = useState(false);
  const full = `${window.location.origin}${hookUrl}`;
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="text-sm font-semibold text-foreground">Webhook URL</div>
      <p className="mt-1 text-xs text-muted-foreground">Paste this into your form / lead tool. Each new lead starts this workflow.</p>
      <div className="mt-2 flex items-center gap-2">
        <code className="flex-1 truncate rounded-md bg-muted px-2 py-1.5 text-xs">{full}</code>
        <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(full); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </Button>
      </div>
    </div>
  );
}

/* ── Main page ───────────────────────────────────────────────────────────────── */

export default function WorkflowDetailPage() {
  const [, params] = useRoute("/app/workflows/:id");
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();

  const rawId = params?.id ?? "new";
  const isNew = rawId === "new";
  const [workflowId, setWorkflowId] = useState<number | null>(isNew ? null : Number(rawId));
  useEffect(() => { setWorkflowId(isNew ? null : Number(rawId)); }, [rawId, isNew]);

  const { data: workflow } = useWorkflow(workflowId);
  const { data: runs } = useWorkflowRuns(workflowId);
  const { data: agentsResp } = useListAgents({});
  const setStatus = useSetWorkflowStatus();

  const agents = useMemo(() => {
    const list = Array.isArray(agentsResp) ? agentsResp : (agentsResp as any)?.agents ?? [];
    return list as Array<{ id: number; name: string }>;
  }, [agentsResp]);
  const agentName = useCallback((id?: number) => agents.find((a) => a.id === id)?.name ?? (id ? `Agent #${id}` : "your agent"), [agents]);

  const [messages, setMessages] = useState<ChatMsg[]>([{
    id: uid(), role: "ai",
    content: "Hi! Tell me what you'd like to automate. For example: “When a lead comes from my website, call them and save the result to my Google Sheet.”",
  }]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, [messages]);

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setInput("");
    const history: ChatMsg[] = [...messages, { id: uid(), role: "user", content: trimmed }];
    const aiId = uid();
    setMessages([...history, { id: aiId, role: "ai", content: "", streaming: true }]);
    setBusy(true);

    try {
      const token = getToken();
      const resp = await fetch("/api/workflows/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          messages: history.map((m) => ({ role: m.role === "ai" ? "assistant" : "user", content: m.content })),
          ...(workflowId ? { workflowId } : {}),
        }),
      });
      if (!resp.body) throw new Error("No response stream");

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const appendAi = (delta: string) =>
        setMessages((prev) => prev.map((m) => m.id === aiId ? { ...m, content: m.content + delta } : m));

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          const line = part.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          let evt: any;
          try { evt = JSON.parse(line.slice(6)); } catch { continue; }
          if (evt.type === "text") appendAi(evt.delta ?? "");
          else if (evt.type === "created" && evt.workflow?.id) {
            const newId = evt.workflow.id as number;
            qc.invalidateQueries({ queryKey: ["workflows"] });
            qc.invalidateQueries({ queryKey: ["workflow", newId] });
            if (!workflowId) { setWorkflowId(newId); navigate(`/app/workflows/${newId}`, { replace: true }); }
          } else if (evt.type === "error") {
            appendAi(evt.message ?? "Something went wrong.");
          }
        }
      }
    } catch (e) {
      setMessages((prev) => prev.map((m) => m.id === aiId ? { ...m, content: m.content || "Sorry — the builder had trouble. Please try again." } : m));
      toast({ title: "Builder error", description: String((e as Error).message), variant: "destructive" });
    } finally {
      setMessages((prev) => prev.map((m) => m.id === aiId ? { ...m, streaming: false } : m));
      setBusy(false);
    }
  };

  const needsSheet = workflowNeedsSheet(workflow);

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] flex-col lg:flex-row">
      {/* Chat panel */}
      <div className="flex min-h-0 flex-1 flex-col border-b border-border lg:border-b-0 lg:border-r">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Button variant="ghost" size="sm" onClick={() => navigate("/app/workflows")}><ArrowLeft size={16} /></Button>
          <Sparkles size={16} className="text-primary" />
          <span className="font-semibold text-foreground">{workflow?.name ?? "New workflow"}</span>
        </div>

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {messages.map((m) => (
            <div key={m.id} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
              <div className={cn(
                "max-w-[85%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap",
                m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted text-foreground",
              )}>
                {m.content}
                {m.streaming && !m.content && <Loader2 size={14} className="animate-spin" />}
              </div>
            </div>
          ))}
          {messages.length <= 1 && (
            <div className="space-y-2 pt-2">
              {STARTERS.map((s) => (
                <button key={s} onClick={() => send(s)}
                  className="block w-full rounded-lg border border-border bg-card px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground">
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="border-t border-border p-3">
          <div className="flex items-end gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
              placeholder="Describe your automation…"
              rows={1}
              className="max-h-32 min-h-[44px] resize-none"
            />
            <Button size="icon" disabled={busy || !input.trim()} onClick={() => send(input)}>
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            </Button>
          </div>
        </div>
      </div>

      {/* Summary panel */}
      <div className="min-h-0 w-full overflow-y-auto bg-muted/30 p-4 lg:w-[420px]">
        {!workflow ? (
          <div className="flex h-full flex-col items-center justify-center text-center text-sm text-muted-foreground">
            <WorkflowIcon size={36} className="mb-3 opacity-50" />
            Your workflow will appear here as you describe it.
          </div>
        ) : (
          <div className="space-y-4">
            {/* Status + activate */}
            <div className="flex items-center justify-between rounded-xl border border-border bg-card p-4">
              <div>
                <div className="text-xs text-muted-foreground">Status</div>
                <div className="font-semibold capitalize text-foreground">{workflow.status}</div>
              </div>
              {workflow.status === "active" ? (
                <Button size="sm" variant="outline" disabled={setStatus.isPending}
                  onClick={() => setStatus.mutate({ id: workflow.id, action: "pause" })}>Pause</Button>
              ) : (
                <Button size="sm" disabled={setStatus.isPending}
                  onClick={() => setStatus.mutate({ id: workflow.id, action: "activate" }, {
                    onError: (e) => toast({ title: "Couldn't activate", description: String((e as Error).message), variant: "destructive" }),
                  })}>Activate</Button>
              )}
            </div>

            {/* Trigger */}
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Trigger</div>
              <div className="mt-1 font-medium text-foreground">{TRIGGER_LABEL[workflow.trigger?.type] ?? "Trigger"}</div>
            </div>

            {/* Steps */}
            <div className="space-y-2">
              {(workflow.steps ?? []).map((step, i) => {
                const Icon = stepIcon(step.type);
                return (
                  <div key={step.id ?? i} className="flex items-start gap-3 rounded-xl border border-border bg-card p-3">
                    <div className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-primary/10 text-primary">
                      <Icon size={15} />
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs text-muted-foreground">Step {i + 1}</div>
                      <div className="text-sm text-foreground">{stepLabel(step, agentName)}</div>
                    </div>
                  </div>
                );
              })}
              {(workflow.steps ?? []).length === 0 && (
                <p className="text-sm text-muted-foreground">No steps yet — keep chatting to add them.</p>
              )}
            </div>

            {needsSheet && <SheetBinder wf={workflow} />}
            {workflow.hookUrl && (workflow.trigger?.type === "form_lead" || workflow.trigger?.type === "instagram_lead") && (
              <HookUrlBox hookUrl={workflow.hookUrl} />
            )}

            {/* Runs */}
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <PlayCircle size={16} className="text-primary" /> Recent runs
              </div>
              {(runs?.length ?? 0) === 0 ? (
                <p className="mt-2 text-xs text-muted-foreground">No runs yet.</p>
              ) : (
                <div className="mt-3 space-y-2">
                  {runs!.slice(0, 12).map((r) => (
                    <div key={r.id} className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-muted-foreground">
                        {new Date(r.createdAt).toLocaleString()} · {r.triggeredBy ?? "manual"}
                      </span>
                      <Badge variant="outline" className={cn(
                        r.status === "completed" && "border-emerald-500/30 text-emerald-500",
                        r.status === "failed" && "border-red-500/30 text-red-500",
                        (r.status === "waiting_call" || r.status === "waiting_delay" || r.status === "running") && "border-amber-500/30 text-amber-600",
                      )}>{r.status.replace("_", " ")}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
