import { useState, useMemo } from "react";
import { Link } from "wouter";
import {
  Brain, Search, Phone, FileText, Layers, Clock, MoreVertical, Plus, Bot,
  Loader2, ChevronRight, Pencil, Calendar, Cpu, Mic, Volume2, PhoneCall,
  ArrowDownLeft, ArrowUpRight, Globe, Sparkles,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListAgentMemorySummaries, getListAgentMemorySummariesQueryKey,
  useListAgentMemoryFacts,
  useListAgentMemoryEpisodes,
  useListCalls,
  useListAgents, getListAgentsQueryKey,
  useUpdateAgent,
} from "@workspace/api-client-react";
import type {
  AgentMemorySummary, AgentMemoryFact, AgentMemoryEpisode, Agent, Call,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";

/* ─── Helpers ────────────────────────────────────────────────────────────── */
function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "Never";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1)  return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function formatDuration(seconds?: number | null): string {
  if (!seconds) return "—";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

type Direction = "Inbound" | "Outbound" | "Web";
function callDirection(call: Call): Direction {
  let meta: Record<string, unknown> = {};
  if (call.metadata) {
    try { meta = JSON.parse(call.metadata) as Record<string, unknown>; } catch { /* ignore */ }
  }
  if (call.toNumber === "webcall" || call.fromNumber === "browser" || meta["channel"] === "webcall") return "Web";
  if (meta["providerCallId"]) return "Outbound";
  return "Inbound";
}

/* ─── Avatar ─────────────────────────────────────────────────────────────── */
function AgentAvatar({ name, size = "md" }: { name: string; size?: "sm" | "md" | "lg" }) {
  const dims = size === "lg" ? "w-12 h-12 text-[15px]" : size === "sm" ? "w-8 h-8 text-[11px]" : "w-10 h-10 text-[13px]";
  return (
    <div className={`${dims} rounded-xl bg-blue-500/15 border border-blue-500/30 flex items-center justify-center shrink-0`}>
      <span className="font-semibold text-blue-400 tracking-tight">{initials(name)}</span>
    </div>
  );
}

/* ─── Left panel: agent card ─────────────────────────────────────────────── */
function AgentCard({ agent, selected, onClick }: { agent: AgentMemorySummary; selected: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left rounded-xl border p-3 transition-colors ${
        selected
          ? "border-blue-500/50 bg-blue-500/10"
          : "border-border bg-card hover:bg-accent/30"
      }`}
    >
      <div className="flex items-center gap-3 mb-3">
        <AgentAvatar name={agent.agentName} size="sm" />
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold text-foreground truncate">{agent.agentName}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1">
            <Clock className="w-2.5 h-2.5" />
            {timeAgo(agent.lastActiveAt)}
          </p>
        </div>
        <ChevronRight className={`w-3.5 h-3.5 shrink-0 ${selected ? "text-blue-400" : "text-muted-foreground/30"}`} />
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {[
          { label: "Calls", value: agent.totalCalls },
          { label: "Facts", value: agent.totalFacts },
          { label: "Episodes", value: agent.totalEpisodes },
        ].map(s => (
          <div key={s.label} className="rounded-lg bg-elevated border border-border px-2 py-1.5 text-center">
            <p className="text-[13px] font-semibold text-foreground tabular-nums leading-none">{s.value}</p>
            <p className="text-[9.5px] text-muted-foreground mt-1 uppercase tracking-wide">{s.label}</p>
          </div>
        ))}
      </div>
    </button>
  );
}

/* ─── Right panel: stat card ─────────────────────────────────────────────── */
function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-muted-foreground mb-2">
        {icon}
        <span className="text-[11px] uppercase tracking-wide font-medium">{label}</span>
      </div>
      <p className="text-[20px] font-semibold text-foreground tabular-nums leading-none">{value}</p>
    </div>
  );
}

/* ─── Add Note dialog ────────────────────────────────────────────────────── */
function AddNoteDialog({
  open, onOpenChange, agentId, agentName, currentNote,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  agentId: number;
  agentName: string;
  currentNote: string;
}) {
  const [note, setNote] = useState(currentNote);
  const qc = useQueryClient();
  const { toast } = useToast();

  // Reset local state whenever the dialog is (re)opened for an agent
  useMemo(() => { if (open) setNote(currentNote); }, [open, currentNote]);

  const updateAgent = useUpdateAgent({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListAgentsQueryKey() });
        toast({ title: "Note saved", description: `Updated note for ${agentName}.` });
        onOpenChange(false);
      },
      onError: (e: unknown) => {
        const msg = e instanceof Error ? e.message : "Failed to save note";
        toast({ title: "Error", description: msg, variant: "destructive" });
      },
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Agent Note</DialogTitle>
          <DialogDescription>
            Add a free-form note for <span className="text-foreground font-medium">{agentName}</span>. Stored on the agent and visible in its details.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder="e.g. Handles after-hours overflow for the support line…"
          className="min-h-[120px] text-[13px]"
        />
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={updateAgent.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => updateAgent.mutate({ id: agentId, data: { description: note } })}
            disabled={updateAgent.isPending}
          >
            {updateAgent.isPending && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
            Save Note
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Right panel: Overview tab ──────────────────────────────────────────── */
function OverviewTab({ agent, summary }: { agent: Agent | undefined; summary: AgentMemorySummary }) {
  const rows: Array<{ icon: React.ReactNode; label: string; value: React.ReactNode }> = [
    { icon: <Bot className="w-3.5 h-3.5" />, label: "Status", value: agent
        ? <Badge variant="outline" className="text-[10.5px] capitalize">{agent.status}</Badge>
        : "—" },
    { icon: <Cpu className="w-3.5 h-3.5" />, label: "LLM Provider", value: agent?.llmProvider ?? "—" },
    { icon: <Mic className="w-3.5 h-3.5" />, label: "ASR Provider", value: agent?.asrProvider ?? "—" },
    { icon: <Volume2 className="w-3.5 h-3.5" />, label: "TTS Provider", value: agent?.ttsProvider ?? "—" },
    { icon: <Calendar className="w-3.5 h-3.5" />, label: "Created", value: formatDate(summary.createdAt) },
    { icon: <Clock className="w-3.5 h-3.5" />, label: "Last Active", value: timeAgo(summary.lastActiveAt) },
  ];

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border bg-elevated">
          <h3 className="text-[12px] font-semibold text-foreground">Agent Information</h3>
        </div>
        <div className="divide-y divide-border">
          {rows.map(r => (
            <div key={r.label} className="flex items-center gap-3 px-4 py-2.5">
              <div className="text-muted-foreground/60">{r.icon}</div>
              <span className="text-[12px] text-muted-foreground flex-1">{r.label}</span>
              <span className="text-[12px] font-medium text-foreground capitalize">{r.value}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border bg-elevated">
          <h3 className="text-[12px] font-semibold text-foreground">Note</h3>
        </div>
        <div className="px-4 py-3">
          {agent?.description ? (
            <p className="text-[12.5px] text-foreground leading-relaxed whitespace-pre-wrap">{agent.description}</p>
          ) : (
            <p className="text-[12px] text-muted-foreground italic">No note yet. Use “Add Note” to add context for this agent.</p>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Right panel: Facts tab ─────────────────────────────────────────────── */
function FactsTab({ agentId }: { agentId: number }) {
  const { data, isLoading } = useListAgentMemoryFacts(agentId);
  const facts = (data ?? []) as AgentMemoryFact[];

  if (isLoading) {
    return (
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-7 w-32 rounded-lg" />)}
      </div>
    );
  }
  if (facts.length === 0) {
    return <p className="text-[12.5px] text-muted-foreground py-8 text-center">No facts extracted across this agent’s conversations yet.</p>;
  }
  return (
    <div className="flex flex-wrap gap-2">
      {facts.map(f => (
        <div key={f.id} className="rounded-lg bg-elevated border border-border px-3 py-2">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground/70 mb-0.5">{f.key}</p>
          <p className="text-[12.5px] text-foreground font-medium">{f.value}</p>
        </div>
      ))}
    </div>
  );
}

/* ─── Right panel: Episodes tab ──────────────────────────────────────────── */
function EpisodesTab({ agentId }: { agentId: number }) {
  const { data, isLoading } = useListAgentMemoryEpisodes(agentId);
  const episodes = (data ?? []) as AgentMemoryEpisode[];

  if (isLoading) {
    return (
      <div className="space-y-2.5">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-border bg-card p-4 space-y-2">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-4/5" />
          </div>
        ))}
      </div>
    );
  }
  if (episodes.length === 0) {
    return <p className="text-[12.5px] text-muted-foreground py-8 text-center">No conversation episodes recorded for this agent yet.</p>;
  }
  return (
    <div className="space-y-2.5">
      {episodes.map(ep => (
        <div key={ep.id} className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground/70 mb-2">
            <Layers className="w-3 h-3" />
            <span>{timeAgo(ep.createdAt)}</span>
            {ep.durationSeconds != null && <span>· {formatDuration(ep.durationSeconds)}</span>}
            {ep.callId != null && (
              <Link href={`/app/calls/${ep.callId}`} className="ml-auto text-blue-400 hover:text-blue-300 flex items-center gap-1">
                View call <ChevronRight className="w-3 h-3" />
              </Link>
            )}
          </div>
          {ep.summary ? (
            <p className="text-[12.5px] text-foreground leading-relaxed">{ep.summary}</p>
          ) : (
            <p className="text-[12px] text-muted-foreground italic">No summary available.</p>
          )}
        </div>
      ))}
    </div>
  );
}

/* ─── Right panel: Call History tab ──────────────────────────────────────── */
function DirectionBadge({ direction }: { direction: Direction }) {
  const cfg: Record<Direction, { icon: React.ReactNode; cls: string }> = {
    Inbound:  { icon: <ArrowDownLeft className="w-3 h-3" />, cls: "text-emerald-400" },
    Outbound: { icon: <ArrowUpRight className="w-3 h-3" />,  cls: "text-blue-400" },
    Web:      { icon: <Globe className="w-3 h-3" />,         cls: "text-violet-400" },
  };
  const c = cfg[direction];
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] ${c.cls}`}>
      {c.icon}{direction}
    </span>
  );
}

function CallHistoryTab({ agentId }: { agentId: number }) {
  const { data, isLoading } = useListCalls({ agentId });
  const calls = (data ?? []) as Call[];

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}
      </div>
    );
  }
  if (calls.length === 0) {
    return <p className="text-[12.5px] text-muted-foreground py-8 text-center">No calls recorded for this agent yet.</p>;
  }
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden divide-y divide-border">
      {calls.map(call => (
        <Link
          key={call.id}
          href={`/app/calls/${call.id}`}
          className="flex items-center gap-3 px-4 py-3 hover:bg-accent/30 transition-colors group"
        >
          <PhoneCall className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0" />
          <div className="flex-1 min-w-0">
            <DirectionBadge direction={callDirection(call)} />
            <p className="text-[11px] text-muted-foreground mt-0.5">{timeAgo(call.createdAt)}</p>
          </div>
          <div className="hidden sm:block text-right">
            <Badge variant="outline" className="text-[10px] capitalize">{call.status.replace("_", " ")}</Badge>
          </div>
          <div className="text-[11px] text-muted-foreground tabular-nums w-14 text-right">
            {formatDuration(call.durationSeconds)}
          </div>
          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/30 shrink-0 group-hover:text-muted-foreground/60" />
        </Link>
      ))}
    </div>
  );
}

/* ─── Right panel ────────────────────────────────────────────────────────── */
function AgentDetailPanel({ summary, agent }: { summary: AgentMemorySummary; agent: Agent | undefined }) {
  const [noteOpen, setNoteOpen] = useState(false);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-start gap-4 px-6 py-5 border-b border-border shrink-0">
        <AgentAvatar name={summary.agentName} size="lg" />
        <div className="flex-1 min-w-0">
          <h2 className="text-[16px] font-semibold text-foreground truncate">{summary.agentName}</h2>
          <p className="text-[12px] text-muted-foreground mt-0.5 flex items-center gap-1.5">
            <Clock className="w-3 h-3" />
            Last active {timeAgo(summary.lastActiveAt)}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button size="sm" onClick={() => setNoteOpen(true)}>
            <Plus className="w-3.5 h-3.5 mr-1.5" />
            Add Note
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" className="h-8 w-8">
                <MoreVertical className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setNoteOpen(true)}>
                <Plus className="w-3.5 h-3.5 mr-2" /> Add / edit note
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href={`/app/agents/${summary.agentId}/edit`}>
                  <Pencil className="w-3.5 h-3.5 mr-2" /> Edit agent
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href={`/app/analytics/agents/${summary.agentId}`}>
                  <Layers className="w-3.5 h-3.5 mr-2" /> View analytics
                </Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 px-6 py-4 shrink-0">
        <StatCard icon={<Phone className="w-3.5 h-3.5" />}    label="Total Calls"    value={summary.totalCalls} />
        <StatCard icon={<FileText className="w-3.5 h-3.5" />} label="Total Facts"    value={summary.totalFacts} />
        <StatCard icon={<Layers className="w-3.5 h-3.5" />}   label="Total Episodes" value={summary.totalEpisodes} />
        <StatCard icon={<Clock className="w-3.5 h-3.5" />}    label="Last Active"    value={<span className="text-[14px]">{timeAgo(summary.lastActiveAt)}</span>} />
      </div>

      {/* Tabs */}
      <div className="flex-1 min-h-0 px-6 pb-6 overflow-hidden flex flex-col">
        <Tabs defaultValue="overview" className="flex flex-col h-full min-h-0">
          <TabsList className="shrink-0">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="facts">Facts</TabsTrigger>
            <TabsTrigger value="episodes">Episodes</TabsTrigger>
            <TabsTrigger value="calls">Call History</TabsTrigger>
          </TabsList>
          <div className="flex-1 min-h-0 overflow-y-auto mt-4">
            <TabsContent value="overview" className="mt-0"><OverviewTab agent={agent} summary={summary} /></TabsContent>
            <TabsContent value="facts" className="mt-0"><FactsTab agentId={summary.agentId} /></TabsContent>
            <TabsContent value="episodes" className="mt-0"><EpisodesTab agentId={summary.agentId} /></TabsContent>
            <TabsContent value="calls" className="mt-0"><CallHistoryTab agentId={summary.agentId} /></TabsContent>
          </div>
        </Tabs>
      </div>

      <AddNoteDialog
        open={noteOpen}
        onOpenChange={setNoteOpen}
        agentId={summary.agentId}
        agentName={summary.agentName}
        currentNote={agent?.description ?? ""}
      />
    </div>
  );
}

/* ─── Empty states ───────────────────────────────────────────────────────── */
function NoAgentsState() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center px-4">
      <div className="w-14 h-14 rounded-2xl bg-elevated border border-border flex items-center justify-center mb-5">
        <Brain className="w-6 h-6 text-muted-foreground/40" />
      </div>
      <h3 className="font-semibold text-foreground text-[15px] mb-2">No agents yet</h3>
      <p className="text-sm text-muted-foreground max-w-[340px] leading-relaxed mb-5">
        Create a voice agent and start taking calls. SnapServe will automatically build a per-agent
        memory profile from facts, episodes, and call history.
      </p>
      <Button asChild>
        <Link href="/app/agents">Create an agent</Link>
      </Button>
    </div>
  );
}

/* ─── Page ───────────────────────────────────────────────────────────────── */
export default function MemoryPage() {
  const [search, setSearch]           = useState("");
  const [agentFilter, setAgentFilter] = useState("all");
  const [selectedId, setSelectedId]   = useState<number | null>(null);

  const { toast } = useToast();

  const { data: summaryData, isLoading, isError, error } =
    useListAgentMemorySummaries({ query: { queryKey: getListAgentMemorySummariesQueryKey() } });
  const { data: agentsData } = useListAgents({ query: { queryKey: getListAgentsQueryKey() } });

  const summaries = (summaryData ?? []) as AgentMemorySummary[];
  const agents = (agentsData ?? []) as Agent[];
  const agentById = useMemo(() => new Map(agents.map(a => [a.id, a])), [agents]);

  useMemo(() => {
    if (isError && error instanceof Error) {
      toast({ title: "Error loading agents", description: error.message, variant: "destructive" });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isError]);

  const filtered = useMemo(() => {
    return summaries.filter(s => {
      if (agentFilter !== "all" && String(s.agentId) !== agentFilter) return false;
      if (search.trim() && !s.agentName.toLowerCase().includes(search.trim().toLowerCase())) return false;
      return true;
    });
  }, [summaries, agentFilter, search]);

  // Keep a valid selection
  const selected = useMemo(() => {
    if (filtered.length === 0) return null;
    const found = filtered.find(s => s.agentId === selectedId);
    return found ?? filtered[0]!;
  }, [filtered, selectedId]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0 gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Brain className="w-4 h-4 text-muted-foreground/60" />
          <div>
            <h1 className="font-semibold text-foreground text-[14px]">Memory / CRM</h1>
            <p className="text-[11.5px] text-muted-foreground mt-0.5">Per-agent memory — facts, episodes & call history rolled up by AI agent</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border bg-elevated">
          <Sparkles className="w-3 h-3 text-muted-foreground/50" />
          <span className="text-[10.5px] text-muted-foreground font-medium">Exclusive to SnapServe</span>
        </div>
      </div>

      {/* Body: two panels */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* Left panel */}
        <div className="w-full max-w-[340px] border-r border-border flex flex-col shrink-0">
          {/* Filters */}
          <div className="p-3 border-b border-border space-y-2 shrink-0">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/40" />
              <Input
                type="search"
                placeholder="Search agents…"
                className="pl-9 h-8 text-xs"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            <select
              className="w-full h-8 text-xs px-2.5 rounded-md border border-input bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              value={agentFilter}
              onChange={e => setAgentFilter(e.target.value)}
            >
              <option value="all">All agents</option>
              {summaries.map(s => (
                <option key={s.agentId} value={s.agentId}>{s.agentName}</option>
              ))}
            </select>
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground tabular-nums px-0.5">
              {isLoading && <Loader2 className="w-3 h-3 animate-spin" />}
              {filtered.length} {filtered.length === 1 ? "agent" : "agents"}
            </div>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2 min-h-0">
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-[104px] w-full rounded-xl" />)
            ) : filtered.length === 0 ? (
              <p className="text-[12px] text-muted-foreground text-center py-8">No agents match your search.</p>
            ) : (
              filtered.map(agent => (
                <AgentCard
                  key={agent.agentId}
                  agent={agent}
                  selected={selected?.agentId === agent.agentId}
                  onClick={() => setSelectedId(agent.agentId)}
                />
              ))
            )}
          </div>
        </div>

        {/* Right panel */}
        <div className="flex-1 min-w-0 overflow-hidden">
          {isLoading ? (
            <div className="p-6 space-y-4">
              <Skeleton className="h-14 w-64 rounded-xl" />
              <div className="grid grid-cols-4 gap-3">
                {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
              </div>
              <Skeleton className="h-72 w-full rounded-xl" />
            </div>
          ) : summaries.length === 0 ? (
            <NoAgentsState />
          ) : selected ? (
            <AgentDetailPanel key={selected.agentId} summary={selected} agent={agentById.get(selected.agentId)} />
          ) : (
            <div className="flex items-center justify-center h-full text-[13px] text-muted-foreground">
              Select an agent to view its memory.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
