import { useState, useMemo } from "react";
import { Brain, Phone, User, Clock, ChevronRight, Search, Sparkles, X, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery, useQueries, useMutation, useQueryClient } from "@tanstack/react-query";
import { useListAgents, getListAgentsQueryKey } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";

/* ─── Types ──────────────────────────────────────────────────────────────── */
interface CallerMemory {
  phone: string;
  name?: string;
  callCount: number;
  lastSeen: string;
  agentName: string;
  agentId: number;
  factCount: number;
}

interface CallerFact {
  id: number;
  key: string;
  value: string;
  confidence: number;
  createdAt: string;
  history: Array<{ id: number; value: string; confidence: number; createdAt: string }>;
}

interface CallerSentence {
  id: number;
  sequenceNum: number;
  speaker: string;
  text: string;
}

interface CallerEpisode {
  id: number;
  callId: number | null;
  summary: string | null;
  durationSeconds: number | null;
  createdAt: string;
  insightFactIds: number[];
  sentences: CallerSentence[];
}

interface CallerDetail {
  facts: CallerFact[];
  episodes: CallerEpisode[];
}

interface ApiCallerRow {
  phoneNumber: string;
  name: string | null;
  callCount: number;
  factCount: number;
  lastCalledAt: string | null;
}

/* ─── Helpers ────────────────────────────────────────────────────────────── */
function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1)  return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function sentimentEmoji(summary: string | null): string {
  if (!summary) return "";
  const s = summary.toLowerCase();
  if (s.includes("angry") || s.includes("frustrat") || s.includes("upset")) return "angry";
  if (s.includes("happy") || s.includes("satisf") || s.includes("great")) return "happy";
  if (s.includes("neutral") || s.includes("inquir")) return "neutral";
  return "";
}

/* ─── Hooks ──────────────────────────────────────────────────────────────── */
function useAuthHeaders() {
  const { getToken } = useAuth();
  return async (): Promise<HeadersInit> => {
    const token = await getToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  };
}

function callerListKey(agentId: number) {
  return ["caller-memory", "list", agentId];
}

function callerDetailKey(agentId: number, phone: string) {
  return ["caller-memory", "detail", agentId, phone];
}

function useCallerDetail(agentId: number | null, phone: string | null) {
  const getHeaders = useAuthHeaders();
  return useQuery<CallerDetail>({
    queryKey: callerDetailKey(agentId ?? 0, phone ?? ""),
    enabled: agentId !== null && phone !== null,
    queryFn: async () => {
      const headers = await getHeaders();
      const r = await fetch(`/api/agents/${agentId}/caller-memory/${encodeURIComponent(phone!)}`, { headers });
      if (!r.ok) throw new Error("Failed to load caller detail");
      return r.json();
    },
  });
}

/* ─── Empty state ─────────────────────────────────────────────────────────── */
function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center px-4">
      <div className="w-14 h-14 rounded-2xl bg-elevated border border-border flex items-center justify-center mb-5">
        <Brain className="w-6 h-6 text-muted-foreground/40" />
      </div>
      <h3 className="font-semibold text-foreground text-[15px] mb-2">No caller memory yet</h3>
      <p className="text-sm text-muted-foreground max-w-[340px] leading-relaxed mb-5">
        Once your agents start taking calls, SnapServe will automatically extract facts, episodes,
        and verbatim quotes from each conversation and build a persistent memory profile per caller.
      </p>
      <div className="flex flex-col gap-2 text-left max-w-xs w-full">
        {[
          { icon: "F", label: "Facts", desc: "Structured data extracted per call" },
          { icon: "E", label: "Episodes", desc: "AI-written summaries of each call" },
          { icon: "Q", label: "Sentences", desc: "Verbatim notable quotes preserved" },
        ].map(item => (
          <div key={item.label} className="flex items-start gap-3 px-3 py-2.5 rounded-lg border border-border bg-card">
            <span className="text-base mt-0.5">{item.icon}</span>
            <div>
              <p className="text-[12.5px] font-semibold text-foreground">{item.label}</p>
              <p className="text-[11.5px] text-muted-foreground mt-0.5">{item.desc}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Skeleton rows ───────────────────────────────────────────────────────── */
function SkeletonRows() {
  return (
    <>
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-5 py-3.5 border-b border-border">
          <Skeleton className="w-8 h-8 rounded-full shrink-0" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-2.5 w-24" />
          </div>
          <Skeleton className="hidden sm:block h-3 w-8" />
          <Skeleton className="hidden md:block h-3 w-16" />
          <Skeleton className="hidden lg:block h-5 w-20 rounded-full" />
        </div>
      ))}
    </>
  );
}

/* ─── Caller row ──────────────────────────────────────────────────────────── */
function CallerRow({ caller, onClick }: { caller: CallerMemory; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      className="flex items-center gap-4 px-5 py-3.5 border-b border-border hover:bg-accent/30 cursor-pointer transition-colors group"
    >
      <div className="w-8 h-8 rounded-full bg-elevated border border-border flex items-center justify-center shrink-0">
        <User className="w-3.5 h-3.5 text-muted-foreground/50" />
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-medium text-foreground tabular-nums">{caller.phone}</p>
        {caller.name && (
          <p className="text-[11.5px] text-muted-foreground mt-0.5 truncate">{caller.name}</p>
        )}
      </div>

      <div className="hidden sm:flex flex-col items-center gap-0.5 min-w-[48px]">
        <Phone className="w-3 h-3 text-muted-foreground/40" />
        <span className="text-[11px] tabular-nums text-muted-foreground">{caller.callCount}</span>
      </div>

      <div className="hidden md:flex flex-col items-end gap-0.5 min-w-[80px]">
        <Clock className="w-3 h-3 text-muted-foreground/40" />
        <span className="text-[11px] text-muted-foreground">{caller.lastSeen}</span>
      </div>

      <div className="hidden lg:block min-w-[100px]">
        <Badge variant="outline" className="text-[10.5px] font-medium max-w-[100px] truncate">
          {caller.agentName}
        </Badge>
      </div>

      <div className="hidden xl:flex items-center gap-1 min-w-[80px]">
        {caller.factCount > 0 ? (
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-elevated border border-border text-muted-foreground">
            {caller.factCount} {caller.factCount === 1 ? "fact" : "facts"}
          </span>
        ) : (
          <span className="text-[11px] text-muted-foreground/40">No facts</span>
        )}
      </div>

      <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/30 shrink-0 group-hover:text-muted-foreground/60 transition-colors" />
    </div>
  );
}

/* ─── Memory drawer ───────────────────────────────────────────────────────── */
function MemoryDrawer({
  caller,
  onClose,
}: {
  caller: CallerMemory;
  onClose: () => void;
}) {
  const getHeaders = useAuthHeaders();
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: detail, isLoading: detailLoading } = useCallerDetail(caller.agentId, caller.phone);

  const deleteFact = useMutation({
    mutationFn: async (factId: number) => {
      const headers = await getHeaders();
      const r = await fetch(
        `/api/agents/${caller.agentId}/caller-memory/${encodeURIComponent(caller.phone)}/facts/${factId}`,
        { method: "DELETE", headers },
      );
      if (!r.ok && r.status !== 204) throw new Error("Failed to delete fact");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: callerListKey(caller.agentId) });
      qc.invalidateQueries({ queryKey: callerDetailKey(caller.agentId, caller.phone) });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="fixed inset-0 bg-background/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md bg-background border-l border-border flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div>
            <p className="font-semibold text-foreground text-[14px] tabular-nums">{caller.phone}</p>
            {caller.name && <p className="text-[12px] text-muted-foreground mt-0.5">{caller.name}</p>}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Stats bar */}
        <div className="grid grid-cols-3 gap-px bg-border shrink-0">
          {[
            { label: "Calls",     value: String(caller.callCount) },
            { label: "Agent",     value: caller.agentName },
            { label: "Last seen", value: caller.lastSeen },
          ].map(s => (
            <div key={s.label} className="bg-card px-4 py-3 text-center">
              <p className="text-[11px] text-muted-foreground uppercase tracking-wide mb-1">{s.label}</p>
              <p className="text-[13px] font-semibold text-foreground truncate">{s.value}</p>
            </div>
          ))}
        </div>

        {/* Memory layers */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* ── Facts ── */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-base text-muted-foreground">F</span>
              <h3 className="text-[12.5px] font-semibold text-foreground">Facts</h3>
              <Badge variant="outline" className="text-[9.5px] ml-auto">
                {detailLoading ? "…" : (detail?.facts.length ?? 0)}
              </Badge>
            </div>

            {detailLoading ? (
              <div className="flex flex-wrap gap-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-6 w-24 rounded-full" />
                ))}
              </div>
            ) : detail && detail.facts.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {detail.facts.map(fact => (
                  <span
                    key={fact.id}
                    className="group flex items-center gap-1.5 text-[11.5px] px-2.5 py-1 rounded-full bg-elevated border border-border text-muted-foreground"
                  >
                    <span className="font-medium text-foreground/70">{fact.key}:</span>
                    <span>{fact.value}</span>
                    {fact.history.length > 0 && (
                      <span className="text-[10px] text-muted-foreground/40" title={`Updated ${fact.history.length} time(s)`}>
                        ({fact.history.length}↑)
                      </span>
                    )}
                    <button
                      onClick={() => deleteFact.mutate(fact.id)}
                      disabled={deleteFact.isPending}
                      className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground/60 hover:text-destructive ml-0.5"
                      title="Delete fact"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-[12px] text-muted-foreground">No facts extracted yet.</p>
            )}
          </div>

          {/* ── Episodes ── */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-base text-muted-foreground">E</span>
              <h3 className="text-[12.5px] font-semibold text-foreground">Episodes</h3>
              <Badge variant="outline" className="text-[9.5px] ml-auto">
                {detailLoading ? "…" : (detail?.episodes.length ?? 0)}
              </Badge>
            </div>

            {detailLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="rounded-lg border border-border bg-card p-3 space-y-1.5">
                    <Skeleton className="h-2.5 w-24" />
                    <Skeleton className="h-3 w-full" />
                    <Skeleton className="h-3 w-4/5" />
                  </div>
                ))}
              </div>
            ) : detail && detail.episodes.length > 0 ? (
              <div className="space-y-2">
                {detail.episodes.map(ep => (
                  <div key={ep.id} className="rounded-lg border border-border bg-card p-3">
                    <p className="text-[11px] text-muted-foreground/60 mb-1.5 flex items-center gap-1.5">
                      <span>{sentimentEmoji(ep.summary)}</span>
                      <span>{timeAgo(ep.createdAt)}</span>
                      {ep.durationSeconds != null && (
                        <span>· {Math.floor(ep.durationSeconds / 60)}m {ep.durationSeconds % 60}s</span>
                      )}
                    </p>
                    {ep.summary ? (
                      <p className="text-[12px] text-foreground leading-relaxed">{ep.summary}</p>
                    ) : (
                      <p className="text-[12px] text-muted-foreground italic">No summary available.</p>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[12px] text-muted-foreground">No episodes recorded yet.</p>
            )}
          </div>

          {/* ── Verbatim quotes ── */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-base text-muted-foreground">Q</span>
              <h3 className="text-[12.5px] font-semibold text-foreground">Verbatim Quotes</h3>
            </div>

            {detailLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full rounded-lg" />
                ))}
              </div>
            ) : (() => {
              const allSentences = detail?.episodes.flatMap(ep =>
                ep.sentences.map(s => ({ ...s, episodeId: ep.id, episodeAt: ep.createdAt }))
              ) ?? [];
              return allSentences.length > 0 ? (
                <div className="space-y-2">
                  {allSentences.map(s => (
                    <div key={s.id} className="rounded-lg border border-border bg-card px-3 py-2.5">
                      <p className="text-[10px] text-muted-foreground/50 mb-1 uppercase tracking-wide">
                        {s.speaker === "agent" ? "Agent" : "Caller"}
                      </p>
                      <p className="text-[12px] text-foreground leading-relaxed">"{s.text}"</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[12px] text-muted-foreground italic">No verbatim quotes captured yet.</p>
              );
            })()}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Page ────────────────────────────────────────────────────────────────── */
export default function MemoryPage() {
  const [search, setSearch]           = useState("");
  const [agentFilter, setAgentFilter] = useState("all");
  const [selected, setSelected]       = useState<CallerMemory | null>(null);

  const { getToken } = useAuth();
  const { toast }    = useToast();

  const { data: agents } = useListAgents({ query: { queryKey: getListAgentsQueryKey() } });
  const agentList = agents ?? [];

  // Determine which agents to fetch
  const targetAgents = agentFilter === "all"
    ? agentList
    : agentList.filter(a => String(a.id) === agentFilter);

  // Parallel per-agent caller-list queries
  const callerQueries = useQueries({
    queries: targetAgents.map(agent => ({
      queryKey: callerListKey(agent.id),
      queryFn: async (): Promise<{ agentId: number; agentName: string; rows: ApiCallerRow[] }> => {
        const token = await getToken();
        const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
        const r = await fetch(`/api/agents/${agent.id}/caller-memory`, { headers });
        if (!r.ok) throw new Error(`Failed to load callers for agent ${agent.name}`);
        const rows: ApiCallerRow[] = await r.json();
        return { agentId: agent.id, agentName: agent.name, rows };
      },
      staleTime: 30_000,
    })),
  });

  const isLoading = callerQueries.some(q => q.isLoading);
  const hasError  = callerQueries.some(q => q.isError);

  // Show toast on first error
  useMemo(() => {
    if (hasError) {
      const errQ = callerQueries.find(q => q.isError);
      if (errQ?.error instanceof Error) {
        toast({ title: "Error loading callers", description: errQ.error.message, variant: "destructive" });
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasError]);

  // Merge all results into a flat list
  const allCallers: CallerMemory[] = useMemo(() => {
    const rows: CallerMemory[] = [];
    for (const q of callerQueries) {
      if (!q.data) continue;
      for (const r of q.data.rows) {
        rows.push({
          phone:     r.phoneNumber,
          name:      r.name ?? undefined,
          callCount: r.callCount,
          lastSeen:  timeAgo(r.lastCalledAt),
          agentName: q.data.agentName,
          agentId:   q.data.agentId,
          factCount: r.factCount,
        });
      }
    }
    // Sort by most recent (we sort by lastCalledAt desc on server but across agents merge by call count as proxy)
    return rows.sort((a, b) => b.callCount - a.callCount);
  }, [callerQueries]);

  const filtered = allCallers.filter(c =>
    search === "" ||
    c.phone.includes(search) ||
    c.name?.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0 gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Brain className="w-4 h-4 text-muted-foreground/60" />
          <div>
            <h1 className="font-semibold text-foreground text-[14px]">Memory / CRM</h1>
            <p className="text-[11.5px] text-muted-foreground mt-0.5">Cross-call caller profiles — facts, episodes, voice prints</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border bg-elevated">
            <Sparkles className="w-3 h-3 text-muted-foreground/50" />
            <span className="text-[10.5px] text-muted-foreground font-medium">Exclusive to SnapServe</span>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 px-5 py-3 border-b border-border shrink-0">
        <div className="relative flex-1 max-w-xs min-w-[160px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/40" />
          <Input
            type="search"
            placeholder="Search by phone or name…"
            className="pl-9 h-8 text-xs"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        <select
          className="h-8 text-xs px-2.5 rounded-md border border-input bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          value={agentFilter}
          onChange={e => { setAgentFilter(e.target.value); setSelected(null); }}
        >
          <option value="all">All agents</option>
          {agentList.map(a => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>

        <div className="ml-auto flex items-center gap-2 text-[11px] text-muted-foreground tabular-nums">
          {isLoading && <Loader2 className="w-3 h-3 animate-spin" />}
          {filtered.length} callers
        </div>
      </div>

      {/* Table header */}
      {(isLoading || filtered.length > 0) && (
        <div className="flex items-center gap-4 px-5 py-2 border-b border-border bg-card shrink-0 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground/50">
          <div className="w-8 shrink-0" />
          <div className="flex-1">Phone / Name</div>
          <div className="hidden sm:block w-12 text-center">Calls</div>
          <div className="hidden md:block w-20 text-right">Last seen</div>
          <div className="hidden lg:block w-24">Agent</div>
          <div className="hidden xl:flex flex-1 max-w-[120px]">Key facts</div>
          <div className="w-4" />
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {isLoading ? (
          <SkeletonRows />
        ) : filtered.length === 0 ? (
          <EmptyState />
        ) : (
          filtered.map(caller => (
            <CallerRow
              key={`${caller.agentId}-${caller.phone}`}
              caller={caller}
              onClick={() => setSelected(caller)}
            />
          ))
        )}
      </div>

      {/* Detail drawer */}
      {selected && (
        <MemoryDrawer caller={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
