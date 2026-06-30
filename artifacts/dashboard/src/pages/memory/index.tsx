import { useState, useMemo, useEffect, useRef } from "react";
import { Link, useLocation } from "wouter";
import { useScrollRestoration } from "@/lib/use-scroll-restoration";
import {
  Brain, Search, Phone, FileText, Layers, Clock, MoreVertical, Plus,
  Loader2, ChevronRight, Pencil,
  ArrowDownLeft, ArrowUpRight, Globe, ArrowRight, ExternalLink,
  MapPin, DollarSign, Bell, HelpCircle, User, Tag, BarChart3, Hash, MessageSquare,
  Trash2, CalendarClock,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { DetailNav } from "@/components/detail-nav";
import { canGoBackInApp } from "@/lib/nav-history";
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

/* ─── Deterministic fact icon mapping (icons stay, colors are neutral) ────── */
type FactIcon = typeof FileText;

const FACT_KEYWORDS: Array<{ test: RegExp; Icon: FactIcon }> = [
  { test: /(location|address|city|area|region|place)/i, Icon: MapPin },
  { test: /(budget|price|cost|range|amount|payment|salary|income)/i, Icon: DollarSign },
  { test: /(follow|reminder|next step|action)/i, Icon: Bell },
  { test: /(time|schedule|when|date|appointment|preference)/i, Icon: Clock },
  { test: /(concern|question|issue|problem|objection)/i, Icon: HelpCircle },
  { test: /(interest|policy|product|plan|service|offer)/i, Icon: FileText },
  { test: /(name|contact|person|customer|client|caller)/i, Icon: User },
  { test: /(email|phone|number|mobile)/i, Icon: Hash },
  { test: /(note|comment|message|detail|summary)/i, Icon: MessageSquare },
];

function factIcon(key: string): FactIcon {
  for (const { test, Icon } of FACT_KEYWORDS) {
    if (test.test(key)) return Icon;
  }
  return Tag;
}

/* ─── Avatar ─────────────────────────────────────────────────────────────── */
function AgentAvatar({ name, size = "md" }: { name: string; size?: "sm" | "md" | "lg" }) {
  const dims = size === "lg" ? "w-12 h-12 text-[15px]" : size === "sm" ? "w-8 h-8 text-[11px]" : "w-10 h-10 text-[13px]";
  return (
    <div className={`${dims} rounded-xl bg-muted/50 border border-border/60 flex items-center justify-center shrink-0`}>
      <span className="font-semibold text-muted-foreground tracking-tight">{initials(name)}</span>
    </div>
  );
}

/* ─── Left rail: compact agent row ───────────────────────────────────────── */
function AgentRow({
  agent, selected, onClick, onNote,
}: {
  agent: AgentMemorySummary;
  selected: boolean;
  onClick: () => void;
  onNote: () => void;
}) {
  return (
    <div
      className={`group relative rounded-lg transition-colors ${
        selected
          ? "bg-muted/40"
          : "hover:bg-muted/20"
      }`}
    >
      {selected && (
        <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-primary/70" />
      )}
      <button onClick={onClick} className="w-full text-left px-2.5 py-2.5 flex items-center gap-2.5">
        <AgentAvatar name={agent.agentName} size="sm" />
        <div className="flex-1 min-w-0 pr-5">
          <p className={`text-[12.5px] font-semibold truncate ${selected ? "text-foreground" : "text-foreground/90"}`}>
            {agent.agentName}
          </p>
          <p className="text-[10px] text-muted-foreground/70 truncate mt-1 tabular-nums">
            {agent.totalCalls} calls · {agent.totalFacts} facts · {agent.totalEpisodes} ep
          </p>
        </div>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground/60 opacity-0 transition-opacity hover:text-foreground hover:bg-accent group-hover:opacity-100 data-[state=open]:opacity-100"
            title="Agent actions"
          >
            <MoreVertical className="w-3.5 h-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={onNote}>
            <Pencil className="w-3.5 h-3.5 mr-2" /> Add / edit note
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href={`/app/analytics/agents/${agent.agentId}`}>
              <Layers className="w-3.5 h-3.5 mr-2" /> View analytics
            </Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/* ─── Section card (consistent premium container) ────────────────────────── */
function SectionCard({
  icon: Icon, title, count, action, children, bodyClassName = "p-4",
}: {
  icon: FactIcon;
  title: string;
  count?: number;
  action?: React.ReactNode;
  children: React.ReactNode;
  bodyClassName?: string;
}) {
  return (
    <section className="rounded-xl border border-border/50 bg-card overflow-hidden">
      <header className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border/40">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-muted/40 flex items-center justify-center shrink-0">
            <Icon className="w-3.5 h-3.5 text-muted-foreground/70" />
          </div>
          <h3 className="text-[13px] font-semibold text-foreground truncate">{title}</h3>
          {count != null && (
            <span className="text-[11px] font-medium text-muted-foreground tabular-nums rounded-md bg-muted/40 px-1.5 py-0.5 shrink-0">
              {count}
            </span>
          )}
        </div>
        {action}
      </header>
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

function ViewAllLink({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1 text-[12px] font-medium text-muted-foreground hover:text-foreground transition-colors shrink-0"
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
  const Icon = factIcon(fact.key);
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
    <div className="group rounded-xl border border-border/40 bg-muted/20 hover:bg-muted/40 transition-colors p-3.5 flex items-start gap-3 relative">
      <div className="w-8 h-8 rounded-lg bg-muted/50 border border-border/50 flex items-center justify-center shrink-0 text-muted-foreground/70">
        <Icon className="w-4 h-4" />
      </div>
      <div className="min-w-0 flex-1 pr-6">
        <p className="text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground/70 truncate">{humanize(fact.key)}</p>
        <p className="text-[12.5px] font-medium text-foreground break-words leading-snug mt-1">{fact.value}</p>
      </div>
      <button
        onClick={handleDelete}
        disabled={deleteFact.isPending}
        title={confirming ? "Click again to confirm deletion" : "Delete this fact"}
        className={`absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity rounded-md p-1 ${
          confirming
            ? "text-destructive bg-destructive/10 opacity-100"
            : "text-muted-foreground hover:text-destructive hover:bg-destructive/10"
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
  facts, agentId, onDeleted, columns = 2,
}: {
  facts: Array<{ id: number; key: string; value: string; phoneNumber?: string }>;
  agentId: number;
  onDeleted?: () => void;
  columns?: 2 | 3;
}) {
  const cls = columns === 3
    ? "grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2.5"
    : "grid grid-cols-1 sm:grid-cols-2 gap-2.5";
  return (
    <div className={cls}>
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
          <span className="absolute left-0 top-1.5 w-2 h-2 rounded-full bg-muted-foreground ring-4 ring-muted-foreground/10" />
          <p className="text-[12px] font-semibold text-foreground">{episodeTime(ep.createdAt)}</p>
          {ep.summary ? (
            <p className="text-[12px] text-muted-foreground leading-relaxed mt-1">{ep.summary}</p>
          ) : (
            <p className="text-[12px] text-muted-foreground/70 italic mt-1">No summary available.</p>
          )}
          {ep.callId != null && (
            <Link
              href={`/app/calls/${ep.callId}`}
              className="text-[11px] text-foreground/80 hover:text-foreground inline-flex items-center gap-1 mt-1.5"
            >
              View call <ChevronRight className="w-3 h-3" />
            </Link>
          )}
        </li>
      ))}
    </ol>
  );
}

/* ─── Unified Timeline (facts + episodes, chronological) ─────────────────── */
type TimelineItem =
  | { kind: "fact"; id: string; createdAt: string; fact: CallerDetailFact }
  | { kind: "episode"; id: string; createdAt: string; episode: AgentMemoryEpisode };

function TimelineFeed({
  facts, episodes,
}: {
  facts: CallerDetailFact[];
  episodes: AgentMemoryEpisode[];
}) {
  const items = useMemo<TimelineItem[]>(() => {
    const f: TimelineItem[] = facts.map(x => ({ kind: "fact", id: `f${x.id}`, createdAt: x.createdAt, fact: x }));
    const e: TimelineItem[] = episodes.map(x => ({ kind: "episode", id: `e${x.id}`, createdAt: x.createdAt, episode: x }));
    return [...f, ...e].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [facts, episodes]);

  if (items.length === 0) {
    return <p className="text-[12.5px] text-muted-foreground py-8 text-center">No timeline activity for this caller yet.</p>;
  }

  return (
    <ol className="relative">
      {items.map((it, i) => {
        const isFact = it.kind === "fact";
        const dotCls = isFact ? "bg-muted-foreground ring-muted-foreground/10" : "bg-foreground ring-foreground/10";
        return (
          <li key={it.id} className="relative pl-6 pb-5 last:pb-0">
            {i < items.length - 1 && (
              <span className="absolute left-[3.5px] top-3 bottom-0 w-px bg-border" />
            )}
            <span className={`absolute left-0 top-1.5 w-2 h-2 rounded-full ring-4 ${dotCls}`} />
            <div className="flex items-center gap-2">
              <p className="text-[12px] font-semibold text-foreground">{episodeTime(it.createdAt)}</p>
              <span className="text-[9px] font-medium rounded-md border px-1.5 py-0.5 text-muted-foreground border-border/50 bg-muted/40">
                {isFact ? "Fact" : "Episode"}
              </span>
            </div>
            {it.kind === "fact" ? (
              <p className="text-[12px] text-muted-foreground leading-relaxed mt-1">
                <span className="text-foreground/80 font-medium">{humanize(it.fact.key)}:</span> {it.fact.value}
              </p>
            ) : (
              <>
                {it.episode.summary ? (
                  <p className="text-[12px] text-muted-foreground leading-relaxed mt-1">{it.episode.summary}</p>
                ) : (
                  <p className="text-[12px] text-muted-foreground/70 italic mt-1">No summary available.</p>
                )}
                {it.episode.callId != null && (
                  <Link
                    href={`/app/calls/${it.episode.callId}`}
                    className="text-[11px] text-foreground/80 hover:text-foreground inline-flex items-center gap-1 mt-1.5"
                  >
                    View call <ChevronRight className="w-3 h-3" />
                  </Link>
                )}
              </>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/* ─── Call History ───────────────────────────────────────────────────────── */
function DirectionBadge({ direction }: { direction: Direction }) {
  const cfg: Record<Direction, { label: string; icon: React.ReactNode }> = {
    Inbound:  { label: "Incoming", icon: <ArrowDownLeft className="w-2.5 h-2.5" /> },
    Outbound: { label: "Outgoing", icon: <ArrowUpRight className="w-2.5 h-2.5" /> },
    Web:      { label: "Web",      icon: <Globe className="w-2.5 h-2.5" /> },
  };
  const c = cfg[direction];
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-medium rounded-md border border-border/50 bg-muted/40 px-1.5 py-0.5 text-muted-foreground">
      {c.icon}{c.label}
    </span>
  );
}

/* Outcome carries real meaning → use semantic status colors only here */
function OutcomeBadge({ status }: { status: Call["status"] }) {
  const cfg: Record<string, { label: string; cls: string }> = {
    completed:   { label: "Completed",   cls: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" },
    in_progress: { label: "In progress", cls: "text-foreground bg-muted/40 border-border/50" },
    pending:     { label: "Pending",     cls: "text-muted-foreground bg-muted/40 border-border/50" },
    transferred: { label: "Transferred", cls: "text-foreground bg-muted/40 border-border/50" },
    failed:      { label: "Failed",      cls: "text-red-400 bg-red-500/10 border-red-500/20" },
    cancelled:   { label: "Cancelled",   cls: "text-amber-400 bg-amber-500/10 border-amber-500/20" },
  };
  const c = cfg[status] ?? { label: humanize(status), cls: "text-muted-foreground bg-muted/40 border-border/50" };
  return (
    <span className={`inline-flex items-center text-[10px] font-medium rounded-md border px-1.5 py-0.5 ${c.cls}`}>
      {c.label}
    </span>
  );
}

/* Full-width, scannable call-history table (matches the reference). */
function CallList({ calls }: { calls: Call[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
            <th className="font-semibold px-3 pb-2.5">Date &amp; time</th>
            <th className="font-semibold px-3 pb-2.5">Duration</th>
            <th className="font-semibold px-3 pb-2.5">Type</th>
            <th className="font-semibold px-3 pb-2.5">Outcome</th>
            <th className="font-semibold px-3 pb-2.5">Agent</th>
            <th className="font-semibold px-3 pb-2.5 text-right">Details</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/40">
          {calls.map(call => (
            <tr key={call.id} className="text-[12px] hover:bg-accent/30 transition-colors">
              <td className="px-3 py-3 text-foreground whitespace-nowrap rounded-l-lg">{formatDateTime(call.createdAt)}</td>
              <td className="px-3 py-3 text-muted-foreground tabular-nums whitespace-nowrap">{formatDuration(call.durationSeconds)}</td>
              <td className="px-3 py-3"><DirectionBadge direction={callDirection(call)} /></td>
              <td className="px-3 py-3"><OutcomeBadge status={call.status} /></td>
              <td className="px-3 py-3 text-muted-foreground truncate max-w-[140px]">{call.agentName}</td>
              <td className="px-3 py-3 text-right rounded-r-lg">
                <Link
                  href={`/app/calls/${call.id}`}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  View
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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

/* ─── Caller helpers ─────────────────────────────────────────────────────── */
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

function CallerAvatar({ contact, size = "md" }: { contact: CallerContact; size?: "md" | "lg" }) {
  const dims = size === "lg" ? "w-11 h-11 rounded-2xl" : "w-9 h-9 rounded-xl";
  const iconDim = size === "lg" ? "w-5 h-5" : "w-4 h-4";
  const txt = size === "lg" ? "text-[13px]" : "text-[11px]";
  if (isWebCaller(contact.phoneNumber)) {
    return (
      <div className={`${dims} bg-muted/50 border border-border/60 flex items-center justify-center shrink-0`}>
        <Globe className={`${iconDim} text-muted-foreground`} />
      </div>
    );
  }
  const label = contact.name
    ? initials(contact.name)
    : contact.phoneNumber.slice(-2).toUpperCase();
  return (
    <div className={`${dims} bg-muted/50 border border-border/60 flex items-center justify-center shrink-0`}>
      <span className={`${txt} font-semibold text-muted-foreground`}>{label}</span>
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
      className={`relative w-full text-left rounded-xl px-2.5 py-2.5 flex items-center gap-3 transition-colors ${
        selected
          ? "bg-muted/40"
          : "hover:bg-muted/20"
      }`}
    >
      {selected && (
        <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-primary/70" />
      )}
      <CallerAvatar contact={contact} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-[12.5px] font-semibold text-foreground truncate">
            {callerDisplayName(contact)}
          </span>
          {web && (
            <span className="text-[9px] font-medium border rounded px-1 py-0.5 text-muted-foreground border-border/50 bg-muted/40 shrink-0">
              Web
            </span>
          )}
        </div>
        {callerSubLabel(contact) && (
          <p className="text-[11px] text-muted-foreground/80 truncate mt-0.5">{callerSubLabel(contact)}</p>
        )}
        <div className="flex items-center gap-3 mt-1.5">
          <span className="text-[10px] text-muted-foreground/70 flex items-center gap-1 tabular-nums">
            <Phone className="w-2.5 h-2.5" />{contact.callCount}
          </span>
          <span className="text-[10px] text-muted-foreground/70 flex items-center gap-1 tabular-nums">
            <BarChart3 className="w-2.5 h-2.5" />{contact.factCount}
          </span>
          <span className="text-[10px] text-muted-foreground/50 ml-auto">{timeAgo(contact.lastCalledAt)}</span>
        </div>
      </div>
    </button>
  );
}

/* ─── Caller list column ─────────────────────────────────────────────────── */
function CallerListColumn({
  callers, isLoading, selectedPhone, onSelect,
}: {
  callers: CallerContact[];
  isLoading: boolean;
  selectedPhone: string | null;
  onSelect: (phone: string) => void;
}) {
  const [search, setSearch] = useState("");
  const listScrollRef = useScrollRestoration<HTMLDivElement>("memory-callers", !isLoading);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return callers;
    return callers.filter(c =>
      c.phoneNumber.toLowerCase().includes(q) ||
      (c.name ?? "").toLowerCase().includes(q)
    );
  }, [callers, search]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-3 pt-3 pb-2.5 shrink-0">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/40" />
          <Input
            type="search"
            placeholder="Search callers…"
            className="pl-9 h-9 text-xs bg-muted/30 border-border/50"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60 tabular-nums px-0.5 mt-2.5">
          {isLoading ? "Loading…" : `${filtered.length} caller${filtered.length !== 1 ? "s" : ""}`}
        </p>
      </div>

      <div ref={listScrollRef} className="flex-1 min-h-0 overflow-y-auto px-2.5 pb-2.5 space-y-1">
        {isLoading ? (
          Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center px-3">
            <User className="w-8 h-8 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-[12px] text-muted-foreground">
              {search ? "No callers match your search." : "No callers yet — start taking calls to build memory."}
            </p>
          </div>
        ) : (
          filtered.map(c => (
            <CallerListRow
              key={c.phoneNumber}
              contact={c}
              selected={c.phoneNumber === selectedPhone}
              onClick={() => onSelect(c.phoneNumber)}
            />
          ))
        )}
      </div>
    </div>
  );
}

/* ─── Caller detail (dominant column) ────────────────────────────────────── */
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

  // Reset to overview whenever a different caller is selected
  useEffect(() => { setTab("overview"); }, [contact.phoneNumber]);

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

  // First-seen = earliest episode timestamp for this caller (derived, no new data)
  const firstSeen = useMemo(() => {
    if (episodes.length === 0) return null;
    return episodes.reduce((min, ep) =>
      new Date(ep.createdAt).getTime() < new Date(min).getTime() ? ep.createdAt : min,
      episodes[0]!.createdAt);
  }, [episodes]);

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

  const web = isWebCaller(contact.phoneNumber);
  const previewFacts    = facts.slice(0, 6);
  const previewEpisodes = displayEpisodes.slice(0, 3);
  const previewCalls    = callerCalls.slice(0, 3);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* caller header — the primary focus of the page */}
      <div className="px-6 pt-6 pb-5 shrink-0">
        <DetailNav className="mb-4" backTo="/app/memory" backLabel="Back" onBack={onBack} preferOnBack />
        <div className="flex items-start gap-4">
          <CallerAvatar contact={contact} size="lg" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-[22px] font-semibold tracking-tight text-foreground truncate leading-none">{callerDisplayName(contact)}</h2>
              {web && (
                <span className="text-[10px] font-medium rounded-md px-1.5 py-0.5 text-muted-foreground bg-muted/40 border border-border/50">
                  Web
                </span>
              )}
            </div>
            <div className="flex items-center gap-4 mt-2 text-[12px] text-muted-foreground flex-wrap">
              {callerSubLabel(contact) && (
                <span className="inline-flex items-center gap-1.5">
                  <Phone className="w-3 h-3 text-muted-foreground/60" />{callerSubLabel(contact)}
                </span>
              )}
              <span className="inline-flex items-center gap-1.5">
                <CalendarClock className="w-3 h-3 text-muted-foreground/60" />First seen {formatDate(firstSeen)}
              </span>
            </div>
          </div>
        </div>

        {/* Per-caller stat band — clean spaced cells, hierarchy via type weight */}
        <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Total Calls", value: String(contact.callCount) },
            { label: "Facts",       value: String(contact.factCount) },
            { label: "Episodes",    value: String(contact.archiveCount) },
            { label: "Last Active", value: timeAgo(contact.lastCalledAt) },
          ].map(s => (
            <div key={s.label} className="rounded-xl border border-border/50 bg-card px-4 py-3 min-w-0">
              <p className="text-[10px] font-medium text-muted-foreground/50 uppercase tracking-wider">{s.label}</p>
              <p className="text-[20px] font-semibold text-foreground tabular-nums leading-none mt-2 truncate">{s.value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* per-caller tabs */}
      <Tabs value={tab} onValueChange={setTab} className="flex-1 min-h-0 flex flex-col">
        <TabsList className="shrink-0 h-auto w-full justify-start gap-1 rounded-none border-b border-border/50 bg-transparent px-6 pt-0 pb-0">
          {[
            { value: "overview", label: "Overview" },
            { value: "facts",    label: `Facts (${facts.length})` },
            { value: "episodes", label: `Episodes (${displayEpisodes.length})` },
            { value: "timeline", label: "Timeline" },
            { value: "calls",    label: `Call History (${callerCalls.length})` },
          ].map(t => (
            <TabsTrigger
              key={t.value}
              value={t.value}
              className="relative rounded-none border-b-2 border-transparent bg-transparent px-3 pb-3 pt-3 text-[13px] font-medium text-muted-foreground shadow-none transition-colors hover:text-foreground data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none"
            >
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5">
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}
            </div>
          ) : (
            <>
              {/* Overview: Memory Summary up top, then previews that deep-link into the tabs */}
              <TabsContent value="overview" className="mt-0 space-y-5">
                <SectionCard icon={Brain} title="Memory Summary">
                  {contact.summary ? (
                    <p className="text-[13px] text-muted-foreground leading-relaxed">{contact.summary}</p>
                  ) : (
                    <p className="text-[12.5px] text-muted-foreground/70 italic">
                      No summary yet — SnapServe will build one as this caller's conversations accumulate.
                    </p>
                  )}
                </SectionCard>

                <SectionCard
                  icon={FileText}
                  title="What the agent knows"
                  count={facts.length}
                  action={facts.length > previewFacts.length
                    ? <ViewAllLink label="View all" onClick={() => setTab("facts")} />
                    : undefined}
                >
                  {previewFacts.length === 0 ? (
                    <p className="text-[12.5px] text-muted-foreground py-6 text-center">No facts extracted yet.</p>
                  ) : (
                    <FactsGrid
                      facts={previewFacts.map(f => ({ ...f, phoneNumber: contact.phoneNumber }))}
                      agentId={agentId}
                      onDeleted={invalidateCallerDetail}
                      columns={2}
                    />
                  )}
                </SectionCard>

                <SectionCard
                  icon={Layers}
                  title="Recent episodes"
                  count={episodes.length}
                  action={displayEpisodes.length > previewEpisodes.length
                    ? <ViewAllLink label="View all" onClick={() => setTab("episodes")} />
                    : undefined}
                >
                  {previewEpisodes.length === 0 ? (
                    <p className="text-[12.5px] text-muted-foreground py-6 text-center">No episodes recorded yet.</p>
                  ) : (
                    <EpisodeTimeline episodes={previewEpisodes} />
                  )}
                </SectionCard>

                <SectionCard
                  icon={Phone}
                  title="Call history"
                  count={callerCalls.length}
                  action={callerCalls.length > previewCalls.length
                    ? <ViewAllLink label="View all" onClick={() => setTab("calls")} />
                    : undefined}
                  bodyClassName="p-2"
                >
                  {callsLoading ? (
                    <div className="space-y-2 p-2">
                      {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}
                    </div>
                  ) : previewCalls.length === 0 ? (
                    <p className="text-[12.5px] text-muted-foreground py-6 text-center">No calls linked to this caller yet.</p>
                  ) : (
                    <CallList calls={previewCalls} />
                  )}
                </SectionCard>
              </TabsContent>

              {/* Facts */}
              <TabsContent value="facts" className="mt-0">
                {facts.length === 0 ? (
                  <SectionCard icon={FileText} title="What the agent knows">
                    <p className="text-[12.5px] text-muted-foreground py-6 text-center">No facts extracted for this caller yet.</p>
                  </SectionCard>
                ) : (
                  <SectionCard icon={FileText} title="What the agent knows" count={facts.length}>
                    <FactsGrid
                      facts={facts.map(f => ({ ...f, phoneNumber: contact.phoneNumber }))}
                      agentId={agentId}
                      onDeleted={invalidateCallerDetail}
                      columns={3}
                    />
                  </SectionCard>
                )}
              </TabsContent>

              {/* Episodes */}
              <TabsContent value="episodes" className="mt-0">
                <SectionCard icon={Layers} title="Conversation episodes" count={displayEpisodes.length || undefined}>
                  {displayEpisodes.length === 0 ? (
                    <p className="text-[12.5px] text-muted-foreground py-6 text-center">No conversation episodes recorded for this caller yet.</p>
                  ) : (
                    <EpisodeTimeline episodes={displayEpisodes} />
                  )}
                </SectionCard>
              </TabsContent>

              {/* Timeline */}
              <TabsContent value="timeline" className="mt-0">
                <SectionCard icon={Clock} title="Activity timeline">
                  <TimelineFeed facts={facts} episodes={displayEpisodes} />
                </SectionCard>
              </TabsContent>

              {/* Call History */}
              <TabsContent value="calls" className="mt-0">
                <SectionCard icon={Phone} title="Call history" count={callerCalls.length || undefined} bodyClassName="p-2">
                  {callsLoading ? (
                    <div className="space-y-2 p-2">
                      {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}
                    </div>
                  ) : callerCalls.length === 0 ? (
                    <p className="text-[12.5px] text-muted-foreground py-6 text-center">No calls linked to this caller yet.</p>
                  ) : (
                    <CallList calls={callerCalls} />
                  )}
                </SectionCard>
              </TabsContent>
            </>
          )}
        </div>
      </Tabs>
    </div>
  );
}

/* ─── Empty states ───────────────────────────────────────────────────────── */
function NoAgentsState() {
  return (
    <div className="flex flex-col items-center justify-center flex-1 py-24 text-center px-4">
      <div className="w-14 h-14 rounded-2xl bg-muted/40 border border-border/50 flex items-center justify-center mb-5">
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

  const [agentSearch, setAgentSearch]   = useState("");
  const [selectedId, setSelectedId]     = useState<number | null>(deepLink.agentId);
  const [selectedPhone, setSelectedPhone] = useState<string | null>(deepLink.caller);
  const [noteAgentId, setNoteAgentId]   = useState<number | null>(null);
  // When the user explicitly backs out of a caller, suppress the auto-select
  // until they pick another caller so the empty detail state can show.
  const autoSelectSuppressed = useRef(false);

  const [, navigate] = useLocation();
  const { toast } = useToast();

  const selectCaller = (phone: string) => {
    autoSelectSuppressed.current = false;
    setSelectedPhone(phone);
  };

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
      if (agentSearch.trim() && !s.agentName.toLowerCase().includes(agentSearch.trim().toLowerCase())) return false;
      return true;
    });
  }, [summaries, agentSearch]);

  // Keep a valid agent selection
  const selected = useMemo(() => {
    if (filtered.length === 0) return null;
    const found = filtered.find(s => s.agentId === selectedId);
    return found ?? filtered[0]!;
  }, [filtered, selectedId]);

  // Callers for the selected agent (page-level so the list + detail share state)
  const { data: callersData, isLoading: callersLoading } =
    useListAgentCallers(selected?.agentId ?? 0, {
      query: {
        queryKey: getListAgentCallersQueryKey(selected?.agentId ?? 0),
        enabled: selected != null,
      },
    });
  const callers = (callersData ?? []) as CallerContact[];

  const selectedContact = useMemo(
    () => callers.find(c => c.phoneNumber === selectedPhone) ?? null,
    [callers, selectedPhone],
  );

  // Auto-select the first caller so the detail pane is always the focal point.
  useEffect(() => {
    if (callersLoading) return;
    if (autoSelectSuppressed.current) return;
    if (selectedContact) return;
    if (callers.length > 0) setSelectedPhone(callers[0]!.phoneNumber);
  }, [callersLoading, selectedContact, callers]);

  // Mirror the agent + caller selection into the URL so returning restores it.
  useEffect(() => {
    const params = new URLSearchParams();
    if (selected?.agentId != null) params.set("agentId", String(selected.agentId));
    if (selectedPhone) params.set("caller", selectedPhone);
    const qs = params.toString();
    const next = qs ? `/app/memory?${qs}` : "/app/memory";
    const current = `/app/memory${window.location.search}`;
    if (next !== current) navigate(next, { replace: true });
  }, [selected?.agentId, selectedPhone, navigate]);

  const noteAgent = noteAgentId != null ? summaries.find(s => s.agentId === noteAgentId) : undefined;

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden animate-fade-in">
      {/* Header */}
      <div className="px-6 pt-6 pb-5 border-b border-border/40 shrink-0">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-muted/40 border border-border/50 flex items-center justify-center shrink-0">
            <Brain className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/50 mb-1">
              Customer Intelligence
            </p>
            <h1 className="text-xl font-semibold tracking-tight text-foreground leading-none">
              Memory / CRM
            </h1>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {isLoading ? (
          <div className="flex-1 min-h-0 flex overflow-hidden">
            <div className="w-[180px] xl:w-[210px] shrink-0 border-r border-border/40 p-3 space-y-2">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}
            </div>
            <div className="w-[270px] xl:w-[310px] shrink-0 border-r border-border/40 p-3 space-y-2">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}
            </div>
            <div className="flex-1 min-w-0 p-6 space-y-5">
              <Skeleton className="h-12 w-64 rounded-xl" />
              <Skeleton className="h-16 w-full rounded-xl" />
              <Skeleton className="h-64 w-full rounded-xl" />
            </div>
          </div>
        ) : summaries.length === 0 ? (
          <NoAgentsState />
        ) : (
          <>
            {/* Body: agents · callers · caller detail */}
            <div className="flex-1 min-h-0 flex overflow-hidden">
              {/* Agents rail */}
              <div className="w-[180px] xl:w-[210px] shrink-0 border-r border-border/40 flex flex-col min-h-0">
                <div className="px-3 pt-3 pb-2.5 shrink-0">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/40" />
                    <Input
                      type="search"
                      placeholder="Search agents…"
                      className="pl-9 h-9 text-xs bg-muted/30 border-border/50"
                      value={agentSearch}
                      onChange={e => setAgentSearch(e.target.value)}
                    />
                  </div>
                  <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60 tabular-nums px-0.5 mt-2.5">
                    {filtered.length} {filtered.length === 1 ? "agent" : "agents"}
                  </p>
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto px-2.5 pb-2.5 space-y-0.5">
                  {filtered.length === 0 ? (
                    <p className="text-[12px] text-muted-foreground text-center py-8">No agents match your search.</p>
                  ) : (
                    filtered.map(agent => (
                      <AgentRow
                        key={agent.agentId}
                        agent={agent}
                        selected={selected?.agentId === agent.agentId}
                        onClick={() => { autoSelectSuppressed.current = false; setSelectedId(agent.agentId); setSelectedPhone(null); }}
                        onNote={() => setNoteAgentId(agent.agentId)}
                      />
                    ))
                  )}
                </div>
              </div>

              {/* Callers list */}
              <div className="w-[270px] xl:w-[310px] shrink-0 border-r border-border/40 flex flex-col min-h-0">
                {selected ? (
                  <CallerListColumn
                    callers={callers}
                    isLoading={callersLoading}
                    selectedPhone={selectedPhone}
                    onSelect={selectCaller}
                  />
                ) : (
                  <div className="flex items-center justify-center h-full text-[12.5px] text-muted-foreground px-4 text-center">
                    Select an agent to view its callers.
                  </div>
                )}
              </div>

              {/* Caller detail (dominant) */}
              <div className="flex-1 min-w-0 overflow-hidden">
                {selected && selectedContact ? (
                  <CallerDetailView
                    key={`${selected.agentId}:${selectedContact.phoneNumber}`}
                    agentId={selected.agentId}
                    contact={selectedContact}
                    onBack={() => { autoSelectSuppressed.current = true; setSelectedPhone(null); }}
                  />
                ) : callersLoading ? (
                  <div className="p-6 space-y-4">
                    <Skeleton className="h-16 w-72 rounded-xl" />
                    <Skeleton className="h-72 w-full rounded-xl" />
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-full text-center px-6">
                    <div className="w-12 h-12 rounded-2xl bg-muted/40 border border-border/50 flex items-center justify-center mb-4">
                      <User className="w-5 h-5 text-muted-foreground/40" />
                    </div>
                    <p className="text-[13px] text-muted-foreground">
                      {selected ? "Select a caller to view their memory profile." : "Select an agent to begin."}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {noteAgent && (
        <AddNoteDialog
          open={noteAgentId != null}
          onOpenChange={v => { if (!v) setNoteAgentId(null); }}
          agentId={noteAgent.agentId}
          agentName={noteAgent.agentName}
          currentNote={agentById.get(noteAgent.agentId)?.description ?? ""}
        />
      )}
    </div>
  );
}
