/**
 * Global Search — ⌘K / Ctrl+K command palette
 * Searches across Leads, Campaigns, Batches, Bookings, Callbacks.
 */
import React, { useState, useEffect, useCallback, useRef } from "react";
export { useGlobalSearchTrigger } from "@/hooks/useGlobalSearch";
import { useLocation } from "wouter";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Users, Zap, Layers, CalendarCheck, PhoneCall, Search,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

/* ── Types ──────────────────────────────────────────────────────────────── */
type ResultType = "campaign" | "lead" | "batch" | "booking" | "callback";

interface SearchResult {
  id:       string;
  title:    string;
  subtitle: string;
  badge?:   string | null;
  url:      string;
  type:     ResultType;
}

interface SearchResponse {
  campaigns: SearchResult[];
  leads:     SearchResult[];
  batches:   SearchResult[];
  bookings:  SearchResult[];
  callbacks: SearchResult[];
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */
const ICONS: Record<ResultType, React.ElementType> = {
  campaign: Zap,
  lead:     Users,
  batch:    Layers,
  booking:  CalendarCheck,
  callback: PhoneCall,
};

const LABELS: Record<ResultType, string> = {
  campaign: "Campaigns",
  lead:     "Leads",
  batch:    "Batches",
  booking:  "Bookings",
  callback: "Callbacks",
};

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

async function apiFetch<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(await r.text());
  return r.json() as Promise<T>;
}

const BADGE_COLORS: Record<string, string> = {
  pending:         "bg-muted text-muted-foreground",
  no_pickup:       "bg-amber-500/10 text-amber-600",
  failed:          "bg-destructive/10 text-destructive",
  dnc:             "bg-red-700/10 text-red-700",
  connected:       "bg-blue-500/10 text-blue-600",
  interested:      "bg-indigo-500/10 text-indigo-600",
  callback:        "bg-orange-500/10 text-orange-600",
  booked:          "bg-green-500/10 text-green-700",
  transferred:     "bg-purple-500/10 text-purple-600",
  incoming_call:   "bg-teal-500/10 text-teal-600",
  pending_callback:"bg-orange-500/10 text-orange-600",
  completed:       "bg-green-500/10 text-green-700",
  missed:          "bg-red-500/10 text-red-600",
};

/* ── ResultItem ─────────────────────────────────────────────────────────── */
function ResultItem({ result, onSelect }: { result: SearchResult; onSelect: (url: string) => void }) {
  const Icon = ICONS[result.type];
  const badgeClass = result.badge ? (BADGE_COLORS[result.badge] ?? "bg-muted text-muted-foreground") : null;

  return (
    <CommandItem
      key={result.id}
      value={`${result.type}-${result.id}-${result.title}`}
      onSelect={() => onSelect(result.url)}
      className="flex items-center gap-3 py-2"
    >
      <div className="w-7 h-7 rounded-md bg-accent flex items-center justify-center shrink-0">
        <Icon className="w-3.5 h-3.5 text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate leading-none">{result.title}</p>
        <p className="text-xs text-muted-foreground truncate mt-0.5 leading-none">{result.subtitle}</p>
      </div>
      {result.badge && badgeClass && (
        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-sm capitalize whitespace-nowrap ${badgeClass}`}>
          {result.badge.replace(/_/g, " ")}
        </span>
      )}
    </CommandItem>
  );
}

/* ── GlobalSearch ────────────────────────────────────────────────────────── */
interface GlobalSearchProps {
  open:    boolean;
  onClose: () => void;
}

export function GlobalSearch({ open, onClose }: GlobalSearchProps) {
  const [, navigate] = useLocation();
  const [query,     setQuery]   = useState("");
  const [results,   setResults] = useState<SearchResponse | null>(null);
  const [loading,   setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.length < 2) { setResults(null); setLoading(false); return; }

    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const data = await apiFetch<SearchResponse>(
          `${BASE}/api/search?q=${encodeURIComponent(query)}`
        );
        setResults(data);
      } catch {
        setResults(null);
      } finally {
        setLoading(false);
      }
    }, 280);

    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  // Reset on close
  useEffect(() => {
    if (!open) { setQuery(""); setResults(null); setLoading(false); }
  }, [open]);

  const handleSelect = useCallback((url: string) => {
    navigate(url);
    onClose();
  }, [navigate, onClose]);

  const totalResults = results
    ? results.campaigns.length + results.leads.length + results.batches.length +
      results.bookings.length + results.callbacks.length
    : 0;

  const groups: Array<{ key: keyof SearchResponse; items: SearchResult[] }> = results
    ? (
        [
          { key: "campaigns" as const, items: results.campaigns },
          { key: "leads"     as const, items: results.leads },
          { key: "batches"   as const, items: results.batches },
          { key: "bookings"  as const, items: results.bookings },
          { key: "callbacks" as const, items: results.callbacks },
        ] as Array<{ key: keyof SearchResponse; items: SearchResult[] }>
      ).filter(g => g.items.length > 0)
    : [];

  return (
    <CommandDialog open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <CommandInput
        placeholder="Search campaigns, leads, batches, bookings…"
        value={query}
        onValueChange={setQuery}
      />
      <CommandList className="max-h-[420px]">
        {query.length < 2 && (
          <div className="py-10 text-center">
            <Search className="w-8 h-8 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">Type at least 2 characters to search</p>
            <p className="text-xs text-muted-foreground/60 mt-1">
              Search across campaigns, leads, batches, bookings, and callbacks
            </p>
          </div>
        )}

        {query.length >= 2 && loading && (
          <div className="py-10 text-center">
            <div className="w-5 h-5 rounded-full border-2 border-muted border-t-foreground/50 animate-spin mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">Searching…</p>
          </div>
        )}

        {query.length >= 2 && !loading && totalResults === 0 && (
          <CommandEmpty>No results found for "{query}"</CommandEmpty>
        )}

        {!loading && groups.map((group, idx) => {
          const type = (group.key === "campaigns" ? "campaign"
            : group.key === "leads"     ? "lead"
            : group.key === "batches"   ? "batch"
            : group.key === "bookings"  ? "booking"
            : "callback") as ResultType;

          return (
            <React.Fragment key={group.key}>
              {idx > 0 && <CommandSeparator />}
              <CommandGroup heading={LABELS[type]}>
                {group.items.map(result => (
                  <ResultItem key={result.id} result={result} onSelect={handleSelect} />
                ))}
              </CommandGroup>
            </React.Fragment>
          );
        })}

        {!loading && totalResults > 0 && (
          <div className="px-4 py-2 border-t border-border">
            <p className="text-[10.5px] text-muted-foreground/50 text-center">
              {totalResults} result{totalResults !== 1 ? "s" : ""} · press ↵ to navigate · Esc to close
            </p>
          </div>
        )}
      </CommandList>
    </CommandDialog>
  );
}

