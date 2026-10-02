import { useEffect, useMemo, useState } from "react";
import { Link, useSearch } from "wouter";
import { ArrowRightLeft, ChevronLeft, ChevronRight, Download, MapPin, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  ContactActions,
  DataTable,
  DemoTag,
  EmptyBlock,
  ErrorBlock,
  LoadingBlock,
  MapsAction,
  OwnerSelect,
  Pill,
  PriorityBadge,
  SalesPageHeader,
  SimpleSelect,
  StageBadge,
  touch,
  useSalesToast,
  useTeamNames,
} from "@/components/sales/sales-ui";
import { StageChangeDialog } from "@/components/sales/stage-change-dialog";
import { useQuickActions } from "@/components/sales/quick-actions";
import { useSalesPrefs } from "@/components/sales/sales-context";
import { useActivities, useCompanies, useCompany, useCompanyIndex, useSalesSettings } from "@/hooks/use-sales-api";
import { useDebounce } from "@/hooks/use-debounce";
import { salesDownload } from "@/lib/sales-api";
import { formatDateOnly, formatDateTimeIST, formatTimeIST, humanize, todayIST } from "@/lib/sales-format";
import { ALL_STAGES, ORDERED_STAGES, SIDE_STAGES, type CompanyListItem, type Stage } from "@/lib/sales-types";

type Filters = {
  q: string;
  ownerId: number | null;
  city: string;
  area: string;
  sector: string;
  source: string;
  stage: string;
  priority: string;
  overdueNextAction: boolean;
  missingNextAction: boolean;
  unassigned: boolean;
  needsDedupeReview: boolean;
};

function initialFilters(search: string): Filters {
  const p = new URLSearchParams(search);
  return {
    q: p.get("q") ?? "",
    ownerId: p.get("ownerId") ? Number(p.get("ownerId")) : null,
    city: p.get("city") ?? "",
    area: "",
    sector: "",
    source: p.get("source") ?? "",
    stage: p.get("stage") ?? "",
    priority: "",
    overdueNextAction: p.get("overdue") === "1",
    missingNextAction: p.get("missing") === "1",
    unassigned: p.get("unassigned") === "1",
    needsDedupeReview: p.get("dedupe") === "1",
  };
}

function toQuery(f: Filters, q: string) {
  return {
    q: q.trim() || undefined,
    ownerId: f.ownerId ?? undefined,
    city: f.city || undefined,
    area: f.area.trim() || undefined,
    sector: f.sector || undefined,
    source: f.source || undefined,
    stage: f.stage || undefined,
    priority: f.priority || undefined,
    overdueNextAction: f.overdueNextAction,
    missingNextAction: f.missingNextAction,
    unassigned: f.unassigned,
    needsDedupeReview: f.needsDedupeReview,
  };
}

export default function PipelinePage() {
  const search = useSearch();
  const params = new URLSearchParams(search);
  const [filters, setFilters] = useState<Filters>(() => initialFilters(search));
  const [view, setView] = useState(params.get("view") ?? "table");
  const debouncedQ = useDebounce(filters.q, 300);
  const toast = useSalesToast();
  const { demo } = useSalesPrefs();

  return (
    <div className="space-y-4">
      <SalesPageHeader
        title="Pipeline"
        subtitle="Companies by stage. Stage changes ask for the evidence each stage needs."
        actions={
          <Button
            variant="outline"
            size="sm"
            className={touch}
            onClick={() => salesDownload("/exports/companies.csv", `sales-companies${demo ? "-demo" : ""}.csv`, { demo }).catch((e) => toast.error(e, "Export failed"))}
          >
            <Download className="mr-1.5 h-4 w-4" /> Export CSV
          </Button>
        }
      />
      <Tabs value={view} onValueChange={setView}>
        <TabsList className="grid w-full grid-cols-3 md:inline-grid md:w-auto">
          <TabsTrigger value="table">Table</TabsTrigger>
          <TabsTrigger value="board">Board</TabsTrigger>
          <TabsTrigger value="route">Today's route</TabsTrigger>
        </TabsList>
        {view !== "route" && <FilterBar filters={filters} setFilters={setFilters} hideStage={view === "board"} />}
        <TabsContent value="table">
          <CompanyTable filters={filters} q={debouncedQ} />
        </TabsContent>
        <TabsContent value="board">
          <Board filters={filters} q={debouncedQ} />
        </TabsContent>
        <TabsContent value="route">
          <RouteList />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function FilterBar({ filters, setFilters, hideStage }: { filters: Filters; setFilters: (f: Filters) => void; hideStage?: boolean }) {
  const settings = useSalesSettings();
  const cfg = settings.data?.config;
  const [open, setOpen] = useState(false);
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setFilters({ ...filters, [k]: v });
  const activeCount = [filters.ownerId, filters.city, filters.area, filters.sector, filters.source, hideStage ? "" : filters.stage, filters.priority, filters.overdueNextAction, filters.missingNextAction, filters.unassigned, filters.needsDedupeReview].filter(Boolean).length;

  return (
    <div className="mt-3 space-y-2">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={filters.q} onChange={(e) => set("q", e.target.value)} placeholder="Search name, area, phone or email…" className={cn("pl-8", touch)} aria-label="Search companies" />
        </div>
        <Button variant="outline" className={cn(touch, "md:hidden")} onClick={() => setOpen((v) => !v)}>
          Filters{activeCount ? ` (${activeCount})` : ""}
        </Button>
      </div>
      <div className={cn("grid gap-2 sm:grid-cols-2 md:grid md:grid-cols-4 lg:grid-cols-8", open ? "grid" : "hidden")}>
        <OwnerSelect value={filters.ownerId} onChange={(v) => setFilters({ ...filters, ownerId: v, unassigned: false })} placeholder="Any owner" allowUnassigned={false} aria-label="Filter by owner" />
        <SimpleSelect value={filters.city} onChange={(v) => set("city", v)} options={[...(cfg?.cities.field ?? []), ...(cfg?.cities.remote ?? [])]} allowAll allLabel="Any city" placeholder="City" aria-label="Filter by city" />
        <Input value={filters.area} onChange={(e) => set("area", e.target.value)} placeholder="Area" className={touch} aria-label="Filter by area" />
        <SimpleSelect value={filters.sector} onChange={(v) => set("sector", v)} options={cfg?.sectors ?? []} allowAll allLabel="Any sector" placeholder="Sector" aria-label="Filter by sector" />
        <SimpleSelect value={filters.source} onChange={(v) => set("source", v)} options={cfg?.sources ?? []} allowAll allLabel="Any source" placeholder="Source" aria-label="Filter by source" />
        {!hideStage && <SimpleSelect value={filters.stage} onChange={(v) => set("stage", v)} options={ALL_STAGES} allowAll allLabel="Any stage" placeholder="Stage" aria-label="Filter by stage" />}
        <SimpleSelect value={filters.priority} onChange={(v) => set("priority", v)} options={["high", "medium", "low"]} allowAll allLabel="Any priority" placeholder="Priority" aria-label="Filter by priority" />
        <Button variant="ghost" className={touch} onClick={() => setFilters({ ...initialFilters(""), q: filters.q })} disabled={!activeCount}>
          Clear
        </Button>
      </div>
      <div className={cn("flex-wrap gap-x-4 gap-y-1 md:flex", open ? "flex" : "hidden")}>
        {(
          [
            ["overdueNextAction", "Overdue next action"],
            ["missingNextAction", "Missing next action"],
            ["unassigned", "Unassigned"],
            ["needsDedupeReview", "Dedupe review"],
          ] as const
        ).map(([k, label]) => (
          <label key={k} className="flex min-h-11 items-center gap-2 text-xs md:min-h-8">
            <Checkbox checked={filters[k]} onCheckedChange={(v) => setFilters({ ...filters, [k]: v === true, ...(k === "unassigned" && v ? { ownerId: null } : {}) })} /> {label}
          </label>
        ))}
      </div>
    </div>
  );
}

function NextAction({ c }: { c: CompanyListItem }) {
  if (!c.nextAction) return <span className="text-xs text-amber-600 dark:text-amber-400">No next action</span>;
  return (
    <span className="block min-w-0">
      <span className="block truncate text-xs">{c.nextAction}</span>
      {c.nextActionDueAt ? (
        <span className={cn("text-[11px]", c.nextActionOverdue ? "font-medium text-red-500" : "text-muted-foreground")}>{c.nextActionOverdue ? "Overdue · " : ""}{formatDateTimeIST(c.nextActionDueAt)}</span>
      ) : (
        <span className="text-[11px] text-amber-600 dark:text-amber-400">No due date</span>
      )}
    </span>
  );
}

function CompanyTable({ filters, q }: { filters: Filters; q: string }) {
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const query = { ...toQuery(filters, q), page, pageSize };
  const list = useCompanies(query);
  const total = list.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const filterKey = JSON.stringify(toQuery(filters, q));
  const [lastKey, setLastKey] = useState(filterKey);
  if (lastKey !== filterKey) {
    setLastKey(filterKey);
    setPage(1);
  }

  return (
    <div className="mt-3 space-y-3">
      {list.isLoading && <LoadingBlock rows={8} />}
      {list.error && <ErrorBlock error={list.error} onRetry={() => list.refetch()} />}
      {list.data && list.data.items.length === 0 && <EmptyBlock title="No companies match" description="Try clearing filters, or add a company with Quick add." />}
      {list.data && list.data.items.length > 0 && (
        <>
          <ul className="space-y-2 md:hidden">
            {list.data.items.map((c) => (
              <li key={c.id}>
                <Link href={`/sales/companies/${c.id}`} className="block rounded-lg border border-border bg-card p-3 active:bg-muted">
                  <div className="flex items-start justify-between gap-2">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{c.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">{[c.area, c.city, c.sector].filter(Boolean).join(" · ") || "—"}</span>
                    </span>
                    <StageBadge stage={c.stage} />
                  </div>
                  <div className="mt-2 flex items-end justify-between gap-2">
                    <NextAction c={c} />
                    <span className="shrink-0 text-[11px] text-muted-foreground">{c.ownerName ?? "Unassigned"}</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          <DataTable className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Company</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead className="w-64">Next action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.data.items.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <Link href={`/sales/companies/${c.id}`} className="font-medium hover:underline">
                        {c.name}
                      </Link>
                      <div className="mt-0.5 flex gap-1">
                        {c.isDemo && <DemoTag />}
                        {c.needsDedupeReview && <Pill tone="warning">Dedupe review</Pill>}
                        {c.isInbound && <Pill tone="muted">Inbound</Pill>}
                      </div>
                    </TableCell>
                    <TableCell>
                      <StageBadge stage={c.stage} />
                    </TableCell>
                    <TableCell className="text-xs">{c.ownerName ?? <span className="text-amber-600 dark:text-amber-400">Unassigned</span>}</TableCell>
                    <TableCell className="text-xs">{[c.area, c.city].filter(Boolean).join(", ") || "—"}</TableCell>
                    <TableCell className="text-xs">{c.source ?? "—"}</TableCell>
                    <TableCell>
                      <PriorityBadge priority={c.priority} />
                    </TableCell>
                    <TableCell className="max-w-64">
                      <NextAction c={c} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </DataTable>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {total} compan{total === 1 ? "y" : "ies"} · page {page} of {pages}
            </span>
            <div className="flex gap-1">
              <Button variant="outline" size="icon" className="h-11 w-11 md:h-8 md:w-8" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Previous page">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="icon" className="h-11 w-11 md:h-8 md:w-8" disabled={page >= pages} onClick={() => setPage(page + 1)} aria-label="Next page">
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** Loads the full company so the stage dialog can prefill evidence and offer its contacts. */
export function StageChangeLauncher({ companyId, initialTo, onClose }: { companyId: number; initialTo?: Stage; onClose: () => void }) {
  const detail = useCompany(companyId);
  const toast = useSalesToast();
  const opp = detail.data?.opportunity;
  const unusable = Boolean(detail.error) || (detail.data != null && (!opp || opp.stage === "Lost" || opp.stage === "Live"));
  useEffect(() => {
    if (!unusable) return;
    if (detail.error) toast.error(detail.error, "Could not load company");
    onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unusable]);
  if (!detail.data || !opp || unusable) return null;
  return (
    <StageChangeDialog
      open
      onOpenChange={(v) => !v && onClose()}
      opportunity={opp}
      company={detail.data.company}
      contacts={detail.data.contacts}
      initialTo={initialTo}
    />
  );
}

function BoardCard({ c, onMove }: { c: CompanyListItem; onMove: () => void }) {
  const closed = c.stage === "Lost" || c.stage === "Live";
  return (
    <div className="rounded-md border border-border bg-background p-2.5 shadow-sm">
      <Link href={`/sales/companies/${c.id}`} className="block truncate text-sm font-medium hover:underline">
        {c.name}
      </Link>
      <p className="truncate text-[11px] text-muted-foreground">{[c.area, c.city].filter(Boolean).join(", ") || "—"} · {c.ownerName ?? "Unassigned"}</p>
      <div className="mt-1.5">
        <NextAction c={c} />
      </div>
      {!closed && c.opportunityId && (
        <Button variant="ghost" size="sm" className="mt-1 h-9 w-full justify-center text-xs md:h-7" onClick={onMove}>
          <ArrowRightLeft className="mr-1 h-3.5 w-3.5" /> Move stage
        </Button>
      )}
    </div>
  );
}

function Board({ filters, q }: { filters: Filters; q: string }) {
  const query = { ...toQuery({ ...filters, stage: "" }, q), page: 1, pageSize: 100 };
  const list = useCompanies(query);
  const [moving, setMoving] = useState<number | null>(null);
  const grouped = useMemo(() => {
    const map = new Map<string, CompanyListItem[]>();
    for (const c of list.data?.items ?? []) {
      const key = c.stage ?? "No opportunity";
      (map.get(key) ?? map.set(key, []).get(key)!).push(c);
    }
    return map;
  }, [list.data]);

  if (list.isLoading) return <LoadingBlock rows={6} className="mt-3" />;
  if (list.error) return <ErrorBlock error={list.error} onRetry={() => list.refetch()} className="mt-3" />;

  const column = (stage: string, side = false) => {
    const items = grouped.get(stage) ?? [];
    return (
      <div key={stage} className={cn("flex w-64 shrink-0 flex-col rounded-lg border border-border", side ? "bg-muted/30" : "bg-card")}>
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <StageBadge stage={stage} />
          <span className="text-xs tabular-nums text-muted-foreground">{items.length}</span>
        </div>
        <div className="max-h-[60dvh] space-y-2 overflow-y-auto p-2">
          {items.length === 0 ? <p className="py-4 text-center text-[11px] text-muted-foreground">Empty</p> : items.map((c) => <BoardCard key={c.id} c={c} onMove={() => setMoving(c.id)} />)}
        </div>
      </div>
    );
  };

  return (
    <div className="mt-3 space-y-2">
      {(list.data?.total ?? 0) > 100 && <p className="text-xs text-amber-600 dark:text-amber-400">Showing the first 100 of {list.data?.total} companies — narrow with filters.</p>}
      <div className="flex gap-3 overflow-x-auto pb-3">
        {ORDERED_STAGES.map((s) => column(s))}
        <div className="flex shrink-0 gap-3 border-l border-dashed border-border pl-3">{SIDE_STAGES.map((s) => column(s, true))}</div>
        {grouped.has("No opportunity") && column("No opportunity", true)}
      </div>
      {moving && <StageChangeLauncher companyId={moving} onClose={() => setMoving(null)} />}
    </div>
  );
}

function RouteStop({ companyId, title, at, activityType }: { companyId: number; title: string; at: string | null; activityType: string }) {
  const detail = useCompany(companyId);
  const { user } = useSalesPrefs();
  const qa = useQuickActions();
  const c = detail.data?.company;
  const contact = detail.data?.contacts.find((x) => x.isDecisionMaker && x.phone) ?? detail.data?.contacts.find((x) => x.phone) ?? detail.data?.contacts[0];
  return (
    <li className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Link href={`/sales/companies/${companyId}`} className="block truncate font-medium hover:underline">
            {title}
          </Link>
          <p className="truncate text-xs text-muted-foreground">
            {formatTimeIST(at)} · {humanize(activityType)}
            {c?.address ? ` · ${c.address}` : ""}
          </p>
          {contact && <p className="truncate text-xs text-muted-foreground">{contact.name || "Contact"}{contact.role ? ` — ${contact.role}` : ""}</p>}
        </div>
        <Button size="sm" className="min-h-11 shrink-0 md:min-h-8" onClick={() => qa.open("visit", { company: { id: companyId, name: title } })}>
          Log visit
        </Button>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {c && <MapsAction company={c} />}
        {detail.isLoading ? <span className="text-xs text-muted-foreground">Loading contacts…</span> : <ContactActions phone={contact?.phone} email={contact?.email} contactName={contact?.name} senderName={user.name} />}
      </div>
    </li>
  );
}

function RouteList() {
  const { scope } = useSalesPrefs();
  const [date, setDate] = useState(todayIST());
  const acts = useActivities({ from: date, to: date, status: "scheduled", scope });
  const index = useCompanyIndex();
  const names = useTeamNames();
  const stops = (acts.data?.activities ?? []).filter((a) => a.type === "visit" || a.type === "meeting" || a.type === "demo");
  const groups = useMemo(() => {
    const map = new Map<string, typeof stops>();
    for (const a of stops) {
      const area = index.data?.get(a.companyId)?.area?.trim() || "No area set";
      (map.get(area) ?? map.set(area, []).get(area)!).push(a);
    }
    return [...map.entries()].sort(([a], [b]) => (a === "No area set" ? 1 : b === "No area set" ? -1 : a.localeCompare(b)));
  }, [stops, index.data]);

  return (
    <div className="mt-3 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className={cn("w-44", touch)} aria-label="Route date" />
        <span className="text-xs text-muted-foreground">
          Scheduled visits, meetings and demos for {formatDateOnly(date)}, grouped by area. Map and WhatsApp links open external apps.
        </span>
      </div>
      {acts.isLoading && <LoadingBlock rows={4} />}
      {acts.error && <ErrorBlock error={acts.error} onRetry={() => acts.refetch()} />}
      {acts.data && stops.length === 0 && <EmptyBlock title="No planned visits" description="Schedule visits from a company page, or log walk-ins with Log visit." />}
      {groups.map(([area, items]) => (
        <section key={area} className="space-y-2">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold">
            <MapPin className="h-4 w-4 text-[hsl(var(--sales-accent))]" /> {area} <span className="font-normal text-muted-foreground">({items.length})</span>
          </h3>
          <ul className="space-y-2">
            {items.map((a) => (
              <RouteStop key={a.id} companyId={a.companyId} title={a.companyName ?? `Company #${a.companyId}`} at={a.scheduledAt} activityType={`${a.type} · ${names(a.ownerId)}`} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
