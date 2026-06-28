import { useState, useMemo } from "react";
import { Link } from "wouter";
import {
  Brain, Search, Phone, FileText, Layers, Clock, MoreVertical, Plus,
  Loader2, ChevronRight, Pencil,
  ArrowDownLeft, ArrowUpRight, Globe, Star, ArrowRight, ExternalLink,
  MapPin, DollarSign, Bell, HelpCircle, User, Tag, BarChart3, Hash, MessageSquare,
  Trash2,
} from "lucide-react";
import { Input } from "@/components/ui/input";
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
  getListAgentMemoryFactsQueryKey,
  useListCalls,
  useListAgents, getListAgentsQueryKey,
  useUpdateAgent,
  useDeleteCallerFact,
  useListAgentCallers, getListAgentCallersQueryKey,
  useGetCallerDetail, getGetCallerDetailQueryKey,
} from "@workspace/api-client-react";
import type {
  AgentMemorySummary, AgentMemoryEpisode, Agent, Call,
  CallerContact, CallerDetailFact, CallerDetailEpisode,
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

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const date = d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${date} · ${time}`;
}

function episodeTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const now = new Date();
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (d.toDateString() === now.toDateString()) return `Today, ${time}`;
  const yest = new Date(now);
  yest.setDate(now.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return `Yesterday, ${time}`;
  return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ${time}`;
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

function humanize(key: string): string {
  return key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, c => c.toUpperCase());
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

/* ─── Deterministic fact icon mapping ────────────────────────────────────── */
type FactStyle = { Icon: typeof FileText; cls: string };
const FACT_PALETTE: FactStyle[] = [
  { Icon: FileText,        cls: "text-rose-400 bg-rose-500/10 border-rose-500/20" },
  { Icon: MapPin,          cls: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" },
  { Icon: HelpCircle,      cls: "text-blue-400 bg-blue-500/10 border-blue-500/20" },
  { Icon: DollarSign,      cls: "text-amber-400 bg-amber-500/10 border-amber-500/20" },
  { Icon: Bell,            cls: "text-violet-400 bg-violet-500/10 border-violet-500/20" },
  { Icon: Clock,           cls: "text-teal-400 bg-teal-500/10 border-teal-500/20" },
  { Icon: User,            cls: "text-cyan-400 bg-cyan-500/10 border-cyan-500/20" },
  { Icon: Tag,             cls: "text-fuchsia-400 bg-fuchsia-500/10 border-fuchsia-500/20" },
];

const FACT_KEYWORDS: Array<{ test: RegExp; style: FactStyle }> = [
  { test: /(location|address|city|area|region|place)/i, style: { Icon: MapPin,      cls: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" } },
  { test: /(budget|price|cost|range|amount|payment|salary|income)/i, style: { Icon: DollarSign, cls: "text-amber-400 bg-amber-500/10 border-amber-500/20" } },
  { test: /(follow|reminder|next step|action)/i, style: { Icon: Bell,        cls: "text-violet-400 bg-violet-500/10 border-violet-500/20" } },
  { test: /(time|schedule|when|date|appointment|preference)/i, style: { Icon: Clock,       cls: "text-teal-400 bg-teal-500/10 border-teal-500/20" } },
  { test: /(concern|question|issue|problem|objection)/i, style: { Icon: HelpCircle,  cls: "text-blue-400 bg-blue-500/10 border-blue-500/20" } },
  { test: /(interest|policy|product|plan|service|offer)/i, style: { Icon: FileText,    cls: "text-rose-400 bg-rose-500/10 border-rose-500/20" } },
  { test: /(name|contact|person|customer|client|caller)/i, style: { Icon: User,        cls: "text-cyan-400 bg-cyan-500/10 border-cyan-500/20" } },
  { test: /(email|phone|number|mobile)/i, style: { Icon: Hash,        cls: "text-sky-400 bg-sky-500/10 border-sky-500/20" } },
  { test: /(note|comment|message|detail|summary)/i, style: { Icon: MessageSquare, cls: "text-indigo-400 bg-indigo-500/10 border-indigo-500/20" } },
];

function factStyle(key: string): FactStyle {
  for (const { test, style } of FACT_KEYWORDS) {
    if (test.test(key)) return style;
  }
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return FACT_PALETTE[hash % FACT_PALETTE.length]!;
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
function StatCard({
  icon, iconCls, label, value,
}: {
  icon: React.ReactNode;
  iconCls: string;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 flex items-center gap-3.5">
      <div className={`w-11 h-11 rounded-xl border flex items-center justify-center shrink-0 ${iconCls}`}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-[22px] font-semibold text-foreground tabular-nums leading-none">{value}</p>
        <p className="text-[11.5px] text-muted-foreground mt-1.5">{label}</p>
      </div>
    </div>
  );
}

/* ─── Panel header (section title + count) ───────────────────────────────── */
function PanelHeader({ title, count }: { title: string; count?: number }) {
  return (
    <div className="flex items-center justify-between mb-3.5">
      <h3 className="text-[13.5px] font-semibold text-foreground">{title}</h3>
      {count != null && (
        <span className="text-[11px] text-muted-foreground tabular-nums">{count}</span>
      )}
    </div>
  );
}

function ViewAllLink({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="mt-4 inline-flex items-center gap-1 text-[12px] font-medium text-blue-400 hover:text-blue-300 transition-colors"
    >
      {label}
      <ArrowRight className="w-3.5 h-3.5" />
    </button>
  );
}

/* ─── Facts ──────────────────────────────────────────────────────────────── */
function FactCard({
  fact, agentId, onDeleted,
}: {
  fact: { id: number; key: string; value: string; phoneNumber?: string };
  agentId: number;
  onDeleted?: () => void;
}) {
  const { Icon, cls } = factStyle(fact.key);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const deleteFact = useDeleteCallerFact();
  const [confirming, setConfirming] = useState(false);

  function handleDelete() {
    if (!confirming) { setConfirming(true); return; }
    const phone = fact.phoneNumber ?? "";
    deleteFact.mutate(
      { id: agentId, phone: encodeURIComponent(phone), factId: fact.id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListAgentMemoryFactsQueryKey(agentId) });
          if (onDeleted) onDeleted();
          toast({ title: "Fact deleted" });
          setConfirming(false);
        },
        onError: () => {
          toast({ title: "Failed to delete fact", variant: "destructive" });
          setConfirming(false);
        },
      }
    );
  }

  return (
    <div className="group rounded-xl border border-border bg-elevated/40 p-3 flex items-start gap-3 relative">
      <div className={`w-8 h-8 rounded-lg border flex items-center justify-center shrink-0 ${cls}`}>
        <Icon className="w-4 h-4" />
      </div>
      <div className="min-w-0 flex-1 pr-6">
        <p className="text-[11px] text-muted-foreground truncate">{humanize(fact.key)}</p>
        <p className="text-[12.5px] font-medium text-foreground break-words leading-snug mt-0.5">{fact.value}</p>
      </div>
      <button
        onClick={handleDelete}
        disabled={deleteFact.isPending}
        title={confirming ? "Click again to confirm deletion" : "Delete this fact"}
        className={`absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity rounded-md p-1 ${
          confirming
            ? "text-red-400 bg-red-500/10 opacity-100"
            : "text-muted-foreground hover:text-red-400 hover:bg-red-500/10"
        }`}
      >
        {deleteFact.isPending
          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
          : <Trash2 className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
}

function FactsGrid({
  facts, agentId, onDeleted,
}: {
  facts: Array<{ id: number; key: string; value: string; phoneNumber?: string }>;
  agentId: number;
  onDeleted?: () => void;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
      {facts.map(f => <FactCard key={f.id} fact={f} agentId={agentId} onDeleted={onDeleted} />)}
    </div>
  );
}

/* ─── Episodes ───────────────────────────────────────────────────────────── */
function EpisodeTimeline({ episodes }: { episodes: AgentMemoryEpisode[] }) {
  return (
    <ol className="relative">
      {episodes.map((ep, i) => (
        <li key={ep.id} className="relative pl-6 pb-5 last:pb-0">
          {i < episodes.length - 1 && (
            <span className="absolute left-[3.5px] top-3 bottom-0 w-px bg-border" />
          )}
          <span className="absolute left-0 top-1.5 w-2 h-2 rounded-full bg-blue-400 ring-4 ring-blue-500/10" />
          <p className="text-[12px] font-semibold text-foreground">{episodeTime(ep.createdAt)}</p>
          {ep.summary ? (
            <p className="text-[12px] text-muted-foreground leading-relaxed mt-1">{ep.summary}</p>
          ) : (
            <p className="text-[12px] text-muted-foreground/70 italic mt-1">No summary available.</p>
          )}
          {ep.callId != null && (
            <Link
              href={`/app/calls/${ep.callId}`}
              className="text-[11px] text-blue-400 hover:text-blue-300 inline-flex items-center gap-1 mt-1.5"
            >
              View call <ChevronRight className="w-3 h-3" />
            </Link>
          )}
        </li>
      ))}
    </ol>
  );
}

/* ─── Call History ───────────────────────────────────────────────────────── */
function DirectionBadge({ direction }: { direction: Direction }) {
  const cfg: Record<Direction, { label: string; icon: React.ReactNode; cls: string }> = {
    Inbound:  { label: "Incoming", icon: <ArrowDownLeft className="w-2.5 h-2.5" />, cls: "text-blue-400 bg-blue-500/10 border-blue-500/20" },
    Outbound: { label: "Outgoing", icon: <ArrowUpRight className="w-2.5 h-2.5" />,  cls: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" },
    Web:      { label: "Web",      icon: <Globe className="w-2.5 h-2.5" />,         cls: "text-violet-400 bg-violet-500/10 border-violet-500/20" },
  };
  const c = cfg[direction];
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-medium rounded-md border px-1.5 py-0.5 ${c.cls}`}>
      {c.icon}{c.label}
    </span>
  );
}

function CallRow({ call }: { call: Call }) {
  return (
    <div className="flex items-center gap-3 py-3">
      <div className="flex-1 min-w-0">
        <p className="text-[11px] text-muted-foreground">{formatDateTime(call.createdAt)}</p>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-[12.5px] font-semibold text-foreground">Call #{call.id}</span>
          <DirectionBadge direction={callDirection(call)} />
        </div>
        <p className="text-[11px] text-muted-foreground mt-1 truncate">
          Duration: {formatDuration(call.durationSeconds)} · Agent: {call.agentName}
        </p>
      </div>
      <Button variant="outline" size="sm" asChild className="shrink-0">
        <Link href={`/app/calls/${call.id}`}>
          <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
          View details
        </Link>
      </Button>
    </div>
  );
}

function CallList({ calls }: { calls: Call[] }) {
  return (
    <div className="divide-y divide-border">
      {calls.map(call => <CallRow key={call.id} call={call} />)}
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

/* ─── Callers tab ─────────────────────────────────────────────────────────── */

function isWebCaller(phone: string): boolean {
  return phone.startsWith("webcall:");
}

function callerDisplayName(contact: CallerContact): string {
  if (contact.name) return contact.name;
  if (isWebCaller(contact.phoneNumber)) return "Web visitor";
  return contact.phoneNumber;
}

function callerSubLabel(contact: CallerContact): string {
  if (isWebCaller(contact.phoneNumber)) return contact.phoneNumber;
  if (contact.name) return contact.phoneNumber;
  return "";
}

function CallerAvatar({ contact }: { contact: CallerContact }) {
  if (isWebCaller(contact.phoneNumber)) {
    return (
      <div className="w-9 h-9 rounded-xl bg-violet-500/15 border border-violet-500/30 flex items-center justify-center shrink-0">
        <Globe className="w-4 h-4 text-violet-400" />
      </div>
    );
  }
  const label = contact.name
    ? initials(contact.name)
    : contact.phoneNumber.slice(-2).toUpperCase();
  return (
    <div className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center shrink-0">
      <span className="text-[11px] font-semibold text-emerald-400">{label}</span>
    </div>
  );
}

function CallerListRow({
  contact, selected, onClick,
}: {
  contact: CallerContact;
  selected: boolean;
  onClick: () => void;
}) {
  const web = isWebCaller(contact.phoneNumber);
  return (
    <button
      onClick={onClick}
      className={`w-full text-left rounded-xl border px-3 py-2.5 flex items-center gap-3 transition-colors ${
        selected
          ? "border-blue-500/50 bg-blue-500/10"
          : "border-border bg-card hover:bg-accent/30"
      }`}
    >
      <CallerAvatar contact={contact} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-[12.5px] font-semibold text-foreground truncate">
            {callerDisplayName(contact)}
          </span>
          {web && (
            <span className="text-[9px] font-medium border rounded px-1 py-0.5 text-violet-400 border-violet-500/30 bg-violet-500/10 shrink-0">
              Web
            </span>
          )}
          {contact.lastCallDropped && (
            <span className="text-[9px] font-medium border rounded px-1 py-0.5 text-amber-400 border-amber-500/30 bg-amber-500/10 shrink-0">
              Dropped
            </span>
          )}
        </div>
        {callerSubLabel(contact) && (
          <p className="text-[11px] text-muted-foreground truncate mt-0.5">{callerSubLabel(contact)}</p>
        )}
      </div>
      <div className="flex flex-col items-end gap-1 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
            <Phone className="w-2.5 h-2.5" />{contact.callCount}
          </span>
          <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
            <BarChart3 className="w-2.5 h-2.5" />{contact.factCount}
          </span>
        </div>
        <p className="text-[10px] text-muted-foreground">{timeAgo(contact.lastCalledAt)}</p>
      </div>
    </button>
  );
}

function CallerDetailView({
  agentId, contact, onBack,
}: {
  agentId: number;
  contact: CallerContact;
  onBack: () => void;
}) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState("overview");
  const { data, isLoading } = useGetCallerDetail(agentId, encodeURIComponent(contact.phoneNumber));
  const callerData = data as { facts: CallerDetailFact[]; episodes: CallerDetailEpisode[] } | undefined;
  const facts    = callerData?.facts    ?? [];
  const episodes = callerData?.episodes ?? [];

  function invalidateCallerDetail() {
    queryClient.invalidateQueries({
      queryKey: getGetCallerDetailQueryKey(agentId, encodeURIComponent(contact.phoneNumber)),
    });
  }

  const displayEpisodes: AgentMemoryEpisode[] = useMemo(
    () => episodes
      .map(ep => ({
        id:              ep.id,
        callId:          ep.callId ?? null,
        summary:         ep.summary ?? null,
        durationSeconds: ep.durationSeconds ?? null,
        createdAt:       ep.createdAt,
      }))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [episodes],
  );

  // Per-caller call history: derive from this caller's episode callIds, then
  // resolve the real Call records from the agent's call list (client-side filter,
  // no extra endpoint). Keyed strictly to this caller — never the agent rollup.
  const callerCallIds = useMemo(
    () => new Set(episodes.map(ep => ep.callId).filter((id): id is number => id != null)),
    [episodes],
  );
  const { data: callsData, isLoading: callsLoading } = useListCalls({ agentId });
  const callerCalls = useMemo(
    () => ((callsData ?? []) as Call[])
      .filter(c => callerCallIds.has(c.id))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [callsData, callerCallIds],
  );

  const previewFacts    = facts.slice(0, 6);
  const previewEpisodes = displayEpisodes.slice(0, 3);
  const previewCalls    = callerCalls.slice(0, 3);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* back bar */}
      <div className="flex items-center gap-2 mb-4 shrink-0">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronRight className="w-3.5 h-3.5 rotate-180" />
          All callers
        </button>
      </div>

      {/* caller header */}
      <div className="flex items-center gap-3 p-4 rounded-xl border border-border bg-card mb-4 shrink-0">
        <CallerAvatar contact={contact} />
        <div className="flex-1 min-w-0">
          <p className="text-[14px] font-semibold text-foreground truncate">{callerDisplayName(contact)}</p>
          {callerSubLabel(contact) && (
            <p className="text-[11px] text-muted-foreground truncate">{callerSubLabel(contact)}</p>
          )}
        </div>
        <div className="flex gap-3 shrink-0">
          {[
            { label: "Calls", value: contact.callCount },
            { label: "Facts", value: contact.factCount },
            { label: "Episodes", value: contact.archiveCount },
          ].map(s => (
            <div key={s.label} className="text-center">
              <p className="text-[15px] font-semibold text-foreground tabular-nums">{s.value}</p>
              <p className="text-[9.5px] text-muted-foreground uppercase tracking-wide">{s.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* per-caller tabs */}
      <Tabs value={tab} onValueChange={setTab} className="flex-1 min-h-0 flex flex-col">
        <TabsList className="shrink-0 h-auto w-full justify-start gap-6 rounded-none border-b border-border bg-transparent p-0">
          {[
            { value: "overview", label: "Overview" },
            { value: "facts",    label: "Facts" },
            { value: "episodes", label: "Episodes" },
            { value: "calls",    label: "Call History" },
          ].map(t => (
            <TabsTrigger
              key={t.value}
              value={t.value}
              className="rounded-none border-b-2 border-transparent bg-transparent px-0 pb-2.5 pt-0 text-[13px] font-medium text-muted-foreground shadow-none data-[state=active]:border-blue-500 data-[state=active]:bg-transparent data-[state=active]:text-blue-400 data-[state=active]:shadow-none"
            >
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <div className="flex-1 min-h-0 overflow-y-auto mt-5">
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}
            </div>
          ) : (
            <>
              {/* Overview: compact previews that deep-link into the other tabs */}
              <TabsContent value="overview" className="mt-0 space-y-6">
                <div>
                  <PanelHeader title="What the agent knows" count={facts.length} />
                  {previewFacts.length === 0 ? (
                    <p className="text-[12.5px] text-muted-foreground py-4 text-center">No facts extracted yet.</p>
                  ) : (
                    <>
                      <FactsGrid
                        facts={previewFacts.map(f => ({ ...f, phoneNumber: contact.phoneNumber }))}
                        agentId={agentId}
                        onDeleted={invalidateCallerDetail}
                      />
                      {facts.length > previewFacts.length && (
                        <ViewAllLink label="View all facts" onClick={() => setTab("facts")} />
                      )}
                    </>
                  )}
                </div>

                <div>
                  <PanelHeader title="Conversation history" count={episodes.length} />
                  {previewEpisodes.length === 0 ? (
                    <p className="text-[12.5px] text-muted-foreground py-4 text-center">No episodes recorded yet.</p>
                  ) : (
                    <>
                      <EpisodeTimeline episodes={previewEpisodes} />
                      {displayEpisodes.length > previewEpisodes.length && (
                        <ViewAllLink label="View all episodes" onClick={() => setTab("episodes")} />
                      )}
                    </>
                  )}
                </div>

                <div>
                  <PanelHeader title="Call history" count={callerCalls.length} />
                  {callsLoading ? (
                    <div className="space-y-2">
                      {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}
                    </div>
                  ) : previewCalls.length === 0 ? (
                    <p className="text-[12.5px] text-muted-foreground py-4 text-center">No calls linked to this caller yet.</p>
                  ) : (
                    <>
                      <CallList calls={previewCalls} />
                      {callerCalls.length > previewCalls.length && (
                        <ViewAllLink label="View all calls" onClick={() => setTab("calls")} />
                      )}
                    </>
                  )}
                </div>
              </TabsContent>

              {/* Facts */}
              <TabsContent value="facts" className="mt-0">
                {facts.length === 0 ? (
                  <p className="text-[12.5px] text-muted-foreground py-8 text-center">No facts extracted for this caller yet.</p>
                ) : (
                  <FactsGrid
                    facts={facts.map(f => ({ ...f, phoneNumber: contact.phoneNumber }))}
                    agentId={agentId}
                    onDeleted={invalidateCallerDetail}
                  />
                )}
              </TabsContent>

              {/* Episodes */}
              <TabsContent value="episodes" className="mt-0">
                {displayEpisodes.length === 0 ? (
                  <p className="text-[12.5px] text-muted-foreground py-8 text-center">No conversation episodes recorded for this caller yet.</p>
                ) : (
                  <EpisodeTimeline episodes={displayEpisodes} />
                )}
              </TabsContent>

              {/* Call History */}
              <TabsContent value="calls" className="mt-0">
                {callsLoading ? (
                  <div className="space-y-2">
                    {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}
                  </div>
                ) : callerCalls.length === 0 ? (
                  <p className="text-[12.5px] text-muted-foreground py-8 text-center">No calls linked to this caller yet.</p>
                ) : (
                  <CallList calls={callerCalls} />
                )}
              </TabsContent>
            </>
          )}
        </div>
      </Tabs>
    </div>
  );
}

function CallersTab({ agentId, initialCaller }: { agentId: number; initialCaller?: string | null }) {
  const [search, setSearch] = useState("");
  const [selectedPhone, setSelectedPhone] = useState<string | null>(initialCaller ?? null);

  const { data, isLoading } = useListAgentCallers(agentId);
  const allCallers = (data ?? []) as CallerContact[];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allCallers;
    return allCallers.filter(c =>
      c.phoneNumber.toLowerCase().includes(q) ||
      (c.name ?? "").toLowerCase().includes(q)
    );
  }, [allCallers, search]);

  const selectedContact = useMemo(
    () => allCallers.find(c => c.phoneNumber === selectedPhone) ?? null,
    [allCallers, selectedPhone],
  );

  if (selectedContact) {
    return (
      <CallerDetailView
        agentId={agentId}
        contact={selectedContact}
        onBack={() => setSelectedPhone(null)}
      />
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* search */}
      <div className="relative mb-3 shrink-0">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/40" />
        <Input
          type="search"
          placeholder="Search by phone or name…"
          className="pl-9 h-8 text-xs"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>
      <p className="text-[11px] text-muted-foreground mb-3 shrink-0 tabular-nums">
        {isLoading ? "Loading…" : `${filtered.length} caller${filtered.length !== 1 ? "s" : ""}`}
      </p>

      {/* list */}
      <div className="flex-1 min-h-0 overflow-y-auto space-y-1.5">
        {isLoading ? (
          Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-xl" />)
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center">
            <User className="w-8 h-8 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-[12.5px] text-muted-foreground">
              {search ? "No callers match your search." : "No callers yet — start taking calls to build memory."}
            </p>
          </div>
        ) : (
          filtered.map(c => (
            <CallerListRow
              key={c.phoneNumber}
              contact={c}
              selected={c.phoneNumber === selectedPhone}
              onClick={() => setSelectedPhone(c.phoneNumber)}
            />
          ))
        )}
      </div>
    </div>
  );
}

/* ─── Right panel ────────────────────────────────────────────────────────── */
function AgentDetailPanel({ summary, agent, initialCaller }: { summary: AgentMemorySummary; agent: Agent | undefined; initialCaller?: string | null }) {
  const [noteOpen, setNoteOpen] = useState(false);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-start gap-4 px-6 py-5 border-b border-border shrink-0">
        <AgentAvatar name={summary.agentName} size="lg" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-[18px] font-semibold text-foreground truncate">{summary.agentName}</h2>
            <Star className="w-4 h-4 text-muted-foreground/40" />
          </div>
          <p className="text-[12.5px] text-blue-400 mt-0.5">Agent</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={() => setNoteOpen(true)}>
            <Pencil className="w-3.5 h-3.5 mr-1.5" />
            Add note
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
        <StatCard
          icon={<Phone className="w-5 h-5" />}
          iconCls="text-blue-400 bg-blue-500/10 border-blue-500/20"
          label="Total Calls" value={summary.totalCalls}
        />
        <StatCard
          icon={<BarChart3 className="w-5 h-5" />}
          iconCls="text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
          label="Facts" value={summary.totalFacts}
        />
        <StatCard
          icon={<Layers className="w-5 h-5" />}
          iconCls="text-violet-400 bg-violet-500/10 border-violet-500/20"
          label="Episodes" value={summary.totalEpisodes}
        />
        <StatCard
          icon={<Clock className="w-5 h-5" />}
          iconCls="text-amber-400 bg-amber-500/10 border-amber-500/20"
          label="Last Active" value={<span className="text-[15px]">{timeAgo(summary.lastActiveAt)}</span>}
        />
      </div>

      {/* Callers (primary axis) — select a caller to drill into their own
          Overview / Facts / Episodes / Call History. */}
      <div className="flex-1 min-h-0 px-6 pb-6 overflow-hidden flex flex-col">
        <CallersTab agentId={summary.agentId} initialCaller={initialCaller} />
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
  // Deep-link support: /app/memory?agentId=<id>&caller=<canonicalPhone>
  const deepLink = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    const rawAgent = params.get("agentId");
    const agentId = rawAgent != null && rawAgent !== "" ? Number(rawAgent) : null;
    const caller = params.get("caller");
    return {
      agentId: agentId != null && Number.isFinite(agentId) ? agentId : null,
      caller: caller && caller !== "" ? caller : null,
    };
  }, []);

  const [search, setSearch]           = useState("");
  const [selectedId, setSelectedId]   = useState<number | null>(deepLink.agentId);

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
      if (search.trim() && !s.agentName.toLowerCase().includes(search.trim().toLowerCase())) return false;
      return true;
    });
  }, [summaries, search]);

  // Keep a valid selection
  const selected = useMemo(() => {
    if (filtered.length === 0) return null;
    const found = filtered.find(s => s.agentId === selectedId);
    return found ?? filtered[0]!;
  }, [filtered, selectedId]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center px-5 py-4 border-b border-border shrink-0 gap-3">
        <Brain className="w-4 h-4 text-muted-foreground/60" />
        <h1 className="font-semibold text-foreground text-[14px]">Memory / CRM</h1>
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
            <AgentDetailPanel
              key={selected.agentId}
              summary={selected}
              agent={agentById.get(selected.agentId)}
              initialCaller={deepLink.agentId === selected.agentId ? deepLink.caller : null}
            />
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
