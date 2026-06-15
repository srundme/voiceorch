import { useState } from "react";
import { Brain, Phone, User, Clock, ChevronRight, Filter, Search, Sparkles } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useListAgents, getListAgentsQueryKey } from "@workspace/api-client-react";

/* ─── Types ──────────────────────────────────────────────────────────────── */
interface CallerMemory {
  phone: string;
  name?: string;
  callCount: number;
  lastSeen: string;
  agentName: string;
  agentId: string;
  keyFacts: string[];
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
          { icon: "🗂️", label: "Facts", desc: "Structured data extracted per call" },
          { icon: "📖", label: "Episodes", desc: "AI-written summaries of each call" },
          { icon: "💬", label: "Sentences", desc: "Verbatim notable quotes preserved" },
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

/* ─── Caller row (placeholder data until real API exists) ─────────────────── */
function CallerRow({ caller, onClick }: { caller: CallerMemory; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      className="flex items-center gap-4 px-5 py-3.5 border-b border-border hover:bg-accent/30 cursor-pointer transition-colors group"
    >
      {/* Avatar */}
      <div className="w-8 h-8 rounded-full bg-elevated border border-border flex items-center justify-center shrink-0">
        <User className="w-3.5 h-3.5 text-muted-foreground/50" />
      </div>

      {/* Phone + name */}
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-medium text-foreground tabular-nums">{caller.phone}</p>
        {caller.name && (
          <p className="text-[11.5px] text-muted-foreground mt-0.5 truncate">{caller.name}</p>
        )}
      </div>

      {/* Call count */}
      <div className="hidden sm:flex flex-col items-center gap-0.5 min-w-[48px]">
        <Phone className="w-3 h-3 text-muted-foreground/40" />
        <span className="text-[11px] tabular-nums text-muted-foreground">{caller.callCount}</span>
      </div>

      {/* Last seen */}
      <div className="hidden md:flex flex-col items-end gap-0.5 min-w-[80px]">
        <Clock className="w-3 h-3 text-muted-foreground/40" />
        <span className="text-[11px] text-muted-foreground">{caller.lastSeen}</span>
      </div>

      {/* Agent */}
      <div className="hidden lg:block min-w-[100px]">
        <Badge variant="outline" className="text-[10.5px] font-medium max-w-[100px] truncate">
          {caller.agentName}
        </Badge>
      </div>

      {/* Key facts preview */}
      <div className="hidden xl:flex items-center gap-1.5 flex-1 min-w-0 max-w-[260px]">
        {caller.keyFacts.slice(0, 2).map(fact => (
          <span key={fact} className="text-[11px] px-2 py-0.5 rounded-full bg-elevated border border-border text-muted-foreground truncate max-w-[120px]">
            {fact}
          </span>
        ))}
        {caller.keyFacts.length > 2 && (
          <span className="text-[11px] text-muted-foreground/50">+{caller.keyFacts.length - 2}</span>
        )}
      </div>

      <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/30 shrink-0 group-hover:text-muted-foreground/60 transition-colors" />
    </div>
  );
}

/* ─── Memory graph drawer (placeholder) ──────────────────────────────────── */
function MemoryDrawer({ caller, onClose }: { caller: CallerMemory; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="fixed inset-0 bg-background/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md bg-background border-l border-border flex flex-col shadow-2xl overflow-hidden">
        {/* Drawer header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div>
            <p className="font-semibold text-foreground text-[14px] tabular-nums">{caller.phone}</p>
            {caller.name && <p className="text-[12px] text-muted-foreground mt-0.5">{caller.name}</p>}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-accent transition-colors text-muted-foreground hover:text-foreground">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-px bg-border shrink-0">
          {[
            { label: "Calls",    value: String(caller.callCount) },
            { label: "Agent",    value: caller.agentName },
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
          {/* Facts */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-base">🗂️</span>
              <h3 className="text-[12.5px] font-semibold text-foreground">Facts</h3>
              <Badge variant="outline" className="text-[9.5px] ml-auto">{caller.keyFacts.length}</Badge>
            </div>
            <div className="flex flex-wrap gap-2">
              {caller.keyFacts.length > 0 ? caller.keyFacts.map(fact => (
                <span key={fact} className="text-[11.5px] px-2.5 py-1 rounded-full bg-elevated border border-border text-muted-foreground">
                  {fact}
                </span>
              )) : (
                <p className="text-[12px] text-muted-foreground">No facts extracted yet.</p>
              )}
            </div>
          </div>

          {/* Episodes */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-base">📖</span>
              <h3 className="text-[12.5px] font-semibold text-foreground">Episodes</h3>
            </div>
            <div className="space-y-2">
              {Array.from({ length: caller.callCount }).slice(0, 3).map((_, i) => (
                <div key={i} className="rounded-lg border border-border bg-card p-3">
                  <p className="text-[11px] text-muted-foreground/60 mb-1">Call {caller.callCount - i} · {caller.lastSeen}</p>
                  <Skeleton className="h-3 w-full mb-1.5" />
                  <Skeleton className="h-3 w-4/5" />
                </div>
              ))}
            </div>
          </div>

          {/* Sentences */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-base">💬</span>
              <h3 className="text-[12.5px] font-semibold text-foreground">Verbatim Quotes</h3>
            </div>
            <p className="text-[12px] text-muted-foreground italic">No verbatim quotes captured yet.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Page ────────────────────────────────────────────────────────────────── */
export default function MemoryPage() {
  const [search, setSearch]         = useState("");
  const [agentFilter, setAgentFilter] = useState("all");
  const [selected, setSelected]     = useState<CallerMemory | null>(null);

  const { data: agents } = useListAgents({ query: { queryKey: getListAgentsQueryKey() } });

  // Placeholder callers — will be replaced by real API (GET /api/caller-memory) in Phase 4
  const placeholderCallers: CallerMemory[] = [];

  const filtered = placeholderCallers.filter(c =>
    (agentFilter === "all" || c.agentId === agentFilter) &&
    (search === "" || c.phone.includes(search) || c.name?.toLowerCase().includes(search.toLowerCase()))
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
          {/* Differentiator badge */}
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
          onChange={e => setAgentFilter(e.target.value)}
        >
          <option value="all">All agents</option>
          {agents?.map(a => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>

        <div className="ml-auto text-[11px] text-muted-foreground tabular-nums">
          {filtered.length} callers
        </div>
      </div>

      {/* Table header */}
      {filtered.length > 0 && (
        <div className="flex items-center gap-4 px-5 py-2 border-b border-border bg-card shrink-0 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground/50">
          <div className="w-8 shrink-0" />
          <div className="flex-1">Phone / Name</div>
          <div className="hidden sm:block w-12 text-center">Calls</div>
          <div className="hidden md:block w-20 text-right">Last seen</div>
          <div className="hidden lg:block w-24">Agent</div>
          <div className="hidden xl:flex flex-1 max-w-[260px]">Key facts</div>
          <div className="w-4" />
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {filtered.length === 0 ? (
          <EmptyState />
        ) : (
          filtered.map(caller => (
            <CallerRow
              key={caller.phone}
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
