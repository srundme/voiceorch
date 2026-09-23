import { useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { TablePagination } from "@/components/table-pagination";
import { EmptyState } from "@/components/empty-state";
import {
  DEFAULT_LEAD_COLUMNS,
  LeadReportingTable,
  type LeadTableColumns,
} from "@/components/campaign-ops/lead-table";
import { useToast } from "@/hooks/use-toast";
import {
  humanizeSnakeLabel,
  parseLeadsSearch,
  reportingLeadsQuery,
  type CampaignReportingFilter,
  type CampaignReportingLead,
  type CampaignReportingPayload,
  type CampaignReportingView,
} from "@/lib/campaign-lead-reporting";
import { cn } from "@/lib/utils";
import { useLocation, useSearch } from "wouter";
import { useEffect, useMemo, useState } from "react";
import { Columns3, Download, Filter, Search } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type LeadsPage = {
  items: CampaignReportingLead[];
  total: number;
  page: number;
  limit: number;
  filter: CampaignReportingFilter;
};

function Stat({
  label,
  value,
  hint,
  hintAction,
  onClick,
  active,
}: {
  label: string;
  value: number;
  hint?: string;
  hintAction?: string;
  onClick?: () => void;
  active?: boolean;
}) {
  const body = (
    <>
      <p className="text-[12px] text-muted-foreground">{label}</p>
      <p className="mt-1 text-[28px] leading-none font-semibold tabular-nums tracking-tight text-foreground">
        {value.toLocaleString()}
      </p>
      {hint ? <p className="mt-1.5 text-[12px] text-muted-foreground">{hint}</p> : null}
      {hintAction ? (
        <p className="mt-1.5 text-[12px] font-medium text-orange-700 dark:text-orange-300">{hintAction}</p>
      ) : null}
    </>
  );
  if (!onClick) return <div className="min-w-[8.5rem] px-4 first:pl-0">{body}</div>;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "min-w-[8.5rem] px-4 first:pl-0 text-left rounded-md",
        active && "bg-muted/60",
      )}
    >
      {body}
    </button>
  );
}

export function CampaignLeadsWorkspace({
  campaignId,
  lockedBatchId,
}: {
  campaignId: number;
  lockedBatchId?: number;
}) {
  const search = useSearch();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [page, setPage] = useState(0);
  const [columns, setColumns] = useState<LeadTableColumns>(DEFAULT_LEAD_COLUMNS);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [exporting, setExporting] = useState(false);
  const filter = useMemo(() => {
    const parsed = parseLeadsSearch(search);
    return lockedBatchId ? { ...parsed, batchId: lockedBatchId } : parsed;
  }, [search, lockedBatchId]);
  const [searchDraft, setSearchDraft] = useState(filter.search ?? "");

  useEffect(() => {
    setPage(0);
    setSelectedIds(new Set());
  }, [search]);

  useEffect(() => {
    setSearchDraft(filter.search ?? "");
  }, [filter.search]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      const next = searchDraft.trim() || null;
      if (next === (filter.search || null)) return;
      patchFilter({ search: next });
    }, 250);
    return () => window.clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchDraft]);

  const qs = reportingLeadsQuery(filter, page, 50);
  const query = useQuery({
    queryKey: ["campaign-lead-reporting-leads", campaignId, qs],
    queryFn: () => customFetch<LeadsPage>(`/api/campaigns/${campaignId}/lead-reporting/leads?${qs}`),
    enabled: campaignId > 0,
    refetchInterval: 8000,
  });
  const summary = useQuery({
    queryKey: ["campaign-lead-reporting", campaignId, lockedBatchId ?? "all"],
    queryFn: () =>
      customFetch<CampaignReportingPayload>(
        lockedBatchId
          ? `/api/campaigns/${campaignId}/batches/${lockedBatchId}/lead-reporting`
          : `/api/campaigns/${campaignId}/lead-reporting`,
      ),
    enabled: campaignId > 0,
    refetchInterval: 8000,
  });

  function patchFilter(next: Partial<CampaignReportingFilter>, resetView?: boolean) {
    const merged: CampaignReportingFilter = { ...filter, ...next };
    if (resetView) merged.view = null;
    const sp = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
    if (lockedBatchId) {
      sp.delete("tab");
      sp.delete("batchId");
    } else {
      sp.delete("tab");
    }
    const keys = [
      "view",
      "disposition",
      "dispositionBucket",
      "operationalOutcome",
      "answeredEver",
      "lifecycleStatus",
      "lastAttemptStatus",
      "retryPending",
      "batchId",
      "source",
      "search",
    ] as const;
    for (const key of keys) {
      if (lockedBatchId && key === "batchId") continue;
      const val = merged[key];
      if (val == null || val === "" || (val === false && key !== "answeredEver" && key !== "retryPending")) {
        if (key === "answeredEver" && merged.answeredEver === false) sp.set(key, "false");
        else if (key === "retryPending" && merged.retryPending === false) sp.set(key, "false");
        else sp.delete(key);
      } else {
        sp.set(key, String(val));
      }
    }
    setPage(0);
    setLocation(`${window.location.pathname}?${sp.toString()}`);
  }

  async function retryLead(leadId: number) {
    try {
      await customFetch(`/api/campaigns/${campaignId}/leads/${leadId}/retry`, { method: "POST" });
      toast({ title: "Retry queued" });
      await qc.invalidateQueries({ queryKey: ["campaign-lead-reporting-leads", campaignId] });
    } catch {
      toast({ title: "Retry failed", variant: "destructive" });
    }
  }

  async function cancelRetry(leadId: number) {
    try {
      await customFetch(`/api/campaigns/${campaignId}/leads/${leadId}/retries/cancel`, { method: "POST" });
      toast({ title: "Retry cancelled" });
      await qc.invalidateQueries({ queryKey: ["campaign-lead-reporting-leads", campaignId] });
    } catch {
      toast({ title: "Could not cancel retry", variant: "destructive" });
    }
  }

  async function exportLeads() {
    setExporting(true);
    try {
      const rows: CampaignReportingLead[] = [];
      const pageSize = 100;
      let pageIndex = 0;
      let total = Infinity;
      while (rows.length < total && pageIndex < 40) {
        const pageQs = reportingLeadsQuery(filter, pageIndex, pageSize);
        const data = await customFetch<LeadsPage>(`/api/campaigns/${campaignId}/lead-reporting/leads?${pageQs}`);
        total = data.total;
        rows.push(...data.items);
        if (data.items.length < pageSize) break;
        pageIndex += 1;
      }
      const header = ["Name", "Phone", "Call result", "Outcome", "Duration seconds", "Attempts", "Next"];
      const lines = [header.join(",")];
      for (const lead of rows) {
        const cells = [
          lead.name ?? "",
          lead.phone ?? "",
          lead.lastAttemptStatus ?? "",
          lead.disposition ?? "",
          lead.latestAnsweredDuration ?? "",
          lead.callAttempts,
          lead.retryScheduledAt ?? "",
        ].map((v) => `"${String(v).replace(/"/g, '""')}"`);
        lines.push(cells.join(","));
      }
      const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `campaign-${campaignId}-leads.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast({ title: "Export failed", variant: "destructive" });
    } finally {
      setExporting(false);
    }
  }

  const reporting = summary.data;
  const answered = reporting?.funnel.answered ?? 0;
  const called = reporting?.funnel.attempted ?? 0;
  const answerPct = called > 0 ? Math.round((answered / called) * 100) : (reporting?.rates.answerRatePct ?? 0);
  const needsReview = reporting?.classification.needsClassification ?? 0;
  const live = (reporting?.liveFloor.calling ?? 0) + (reporting?.liveFloor.talking ?? 0) > 0;
  const view = filter.view ?? null;
  const outcomeActive = filter.disposition ?? (filter.dispositionBucket === "needs_classification" ? "needs_classification" : null);

  const filterLabel =
    view === "answered" ? "Human answered"
    : view === "voicemail" ? "Voicemail"
    : view === "busy" ? "Busy"
    : view === "no_pickup" ? "No answer"
    : view === "technical_failed" ? "Couldn't reach"
    : view === "retry" ? "Retrying"
    : view === "callback" ? "Callbacks"
    : outcomeActive === "needs_classification" ? "Needs review"
    : outcomeActive ? humanizeSnakeLabel(outcomeActive) : "All leads";

  const statusTabs: Array<{ id: CampaignReportingView | "all"; label: string; count: number }> = [
    { id: "all", label: "All leads", count: reporting?.funnel.imported ?? 0 },
    { id: "answered", label: "Human answered", count: answered },
    { id: "voicemail", label: "Voicemail", count: reporting?.workTechnical.voicemail ?? 0 },
    { id: "busy", label: "Busy", count: reporting?.workTechnical.busy ?? 0 },
  ];

  const extraViews: Array<{ id: CampaignReportingView; label: string; count: number }> = [
    { id: "no_pickup", label: "No answer", count: reporting?.workTechnical.noPickup ?? 0 },
    { id: "technical_failed", label: "Couldn't reach", count: reporting?.workTechnical.technicalFailed ?? 0 },
    { id: "retry", label: "Retrying", count: reporting?.workTechnical.retryPending ?? 0 },
    { id: "callback", label: "Callbacks", count: reporting?.workTechnical.callbacks ?? 0 },
  ];

  const updatedLabel = (() => {
    const at = summary.dataUpdatedAt;
    if (!at) return "Updated just now";
    const sec = Math.max(0, Math.round((Date.now() - at) / 1000));
    if (sec < 15) return "Updated just now";
    if (sec < 60) return `Updated ${sec}s ago`;
    return `Updated ${Math.round(sec / 60)}m ago`;
  })();

  const showOutcomes = outcomesConfigured(reporting?.dispositions);

  return (
    <div className="flex flex-col min-h-0 flex-1 h-full overflow-hidden">
      <div className="shrink-0 flex flex-wrap items-start gap-y-4 divide-x divide-border pb-4">
        <Stat label="Total leads" value={reporting?.funnel.imported ?? 0} />
        <Stat label="Completed calls" value={called} />
        <Stat
          label="Human answered"
          value={answered}
          hint={called > 0 ? `${answerPct}% of completed calls` : undefined}
          active={view === "answered" && !outcomeActive}
          onClick={() => patchFilter({ view: "answered", disposition: null, dispositionBucket: null })}
        />
        <Stat
          label="Callbacks requested"
          value={reporting?.workTechnical.callbacks ?? 0}
          active={view === "callback"}
          onClick={() => patchFilter({ view: "callback", disposition: null, dispositionBucket: null })}
        />
        <Stat
          label="Needs review"
          value={needsReview}
          hintAction={needsReview > 0 ? "Review calls →" : undefined}
          active={outcomeActive === "needs_classification"}
          onClick={() =>
            patchFilter({
              view: null,
              disposition: null,
              dispositionBucket: outcomeActive === "needs_classification" ? null : "needs_classification",
            })
          }
        />
      </div>

      <div className="shrink-0 flex flex-wrap items-center gap-x-4 gap-y-2 border-y border-border py-2.5 text-[13px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5 text-foreground font-medium">
          <span className={cn("h-2 w-2 rounded-full", live ? "bg-emerald-500" : "bg-muted-foreground/40")} />
          {live ? "Live" : "Idle"}
        </span>
        <span className="text-border">|</span>
        <span>Ringing <span className="text-foreground font-medium tabular-nums">{reporting?.liveFloor.calling ?? 0}</span></span>
        <span>Talking <span className="text-foreground font-medium tabular-nums">{reporting?.liveFloor.talking ?? 0}</span></span>
        <span>
          Slots{" "}
          <span className="text-foreground font-medium tabular-nums">
            {reporting?.liveFloor.slotsUsed ?? 0}/{reporting?.liveFloor.concurrencyLimit ?? 0}
          </span>
        </span>
        <span>
          Retries scheduled{" "}
          <span className="text-foreground font-medium tabular-nums">{reporting?.workTechnical.retryPending ?? 0}</span>
        </span>
        <span className="ml-auto text-[12px]">{updatedLabel}</span>
      </div>

      <div className="shrink-0 pt-4 pb-3 flex items-center gap-3">
        <h2 className="text-base font-semibold">Leads</h2>
        <div className="ml-auto flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
                <Columns3 className="h-3.5 w-3.5" />
                Columns
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuCheckboxItem
                checked={columns.outcome}
                onCheckedChange={(on) => setColumns((c) => ({ ...c, outcome: !!on }))}
              >
                Outcome
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={columns.duration}
                onCheckedChange={(on) => setColumns((c) => ({ ...c, duration: !!on }))}
              >
                Duration
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={columns.attempts}
                onCheckedChange={(on) => setColumns((c) => ({ ...c, attempts: !!on }))}
              >
                Attempts
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={columns.next}
                onCheckedChange={(on) => setColumns((c) => ({ ...c, next: !!on }))}
              >
                Next action
              </DropdownMenuCheckboxItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            disabled={exporting}
            onClick={() => void exportLeads()}
          >
            <Download className="h-3.5 w-3.5" />
            {exporting ? "Exporting…" : "Export"}
          </Button>
        </div>
      </div>

      <div className="shrink-0 flex flex-wrap items-center gap-2 pb-3">
        <div className="flex items-center gap-1 overflow-x-auto">
          {statusTabs.map((tab) => {
            const selected = tab.id === "all"
              ? !view && !outcomeActive
              : view === tab.id && !outcomeActive;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() =>
                  patchFilter({
                    view: tab.id === "all" ? null : tab.id,
                    disposition: null,
                    dispositionBucket: null,
                  })
                }
                className={cn(
                  "shrink-0 px-2.5 py-1.5 text-[13px] border-b-2 -mb-px",
                  selected
                    ? "border-foreground text-foreground font-medium"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {tab.label}
                <span className="ml-1.5 tabular-nums text-muted-foreground">{tab.count.toLocaleString()}</span>
              </button>
            );
          })}
        </div>
        <span className="hidden sm:inline h-4 w-px bg-border" />
        <label className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground">
          Outcome
          <select
            value={outcomeActive ?? ""}
            onChange={(e) => {
              const key = e.target.value;
              if (!key) {
                patchFilter({ disposition: null, dispositionBucket: null });
                return;
              }
              if (key === "needs_classification") {
                patchFilter({ view: null, disposition: null, dispositionBucket: "needs_classification" });
                return;
              }
              patchFilter({ view: null, disposition: key, dispositionBucket: null });
            }}
            className="h-8 rounded-md border border-border bg-background px-2 text-[13px] text-foreground"
          >
            <option value="">All</option>
            {showOutcomes &&
              reporting?.dispositions?.map((d) => (
                <option key={d.key} value={d.key}>
                  {d.key === "needs_classification" ? "Needs review" : humanizeSnakeLabel(d.label || d.key)} ({d.count})
                </option>
              ))}
            {!showOutcomes && <option value="needs_classification">Needs review ({needsReview})</option>}
          </select>
        </label>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="outline" size="icon" className="h-8 w-8" aria-label="More filters">
              <Filter className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {extraViews.map((item) => (
              <DropdownMenuCheckboxItem
                key={item.id}
                checked={view === item.id}
                onCheckedChange={() =>
                  patchFilter({
                    view: view === item.id ? null : item.id,
                    disposition: null,
                    dispositionBucket: null,
                  })
                }
              >
                {item.label} ({item.count.toLocaleString()})
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <div className="relative ml-auto">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            placeholder="Search name or phone"
            className="h-8 w-56 pl-8 text-[13px]"
          />
        </div>
      </div>

      {query.isError && !query.data ? (
        <EmptyState
          variant="panel"
          title="Couldn’t load leads"
          action={{ label: "Retry", onClick: () => void query.refetch() }}
        />
      ) : (
        <>
          <div className="min-h-0 flex-1 overflow-auto border-t border-border">
            <LeadReportingTable
              campaignId={campaignId}
              items={query.data?.items ?? []}
              total={query.data?.total ?? 0}
              loading={query.isLoading}
              error={query.isError ? "The reporting API could not be reached." : null}
              emptyView={filter.view}
              columns={columns}
              selectedIds={selectedIds}
              onToggle={(id) =>
                setSelectedIds((prev) => {
                  const next = new Set(prev);
                  if (next.has(id)) next.delete(id);
                  else next.add(id);
                  return next;
                })
              }
              onTogglePage={(ids, on) =>
                setSelectedIds((prev) => {
                  const next = new Set(prev);
                  for (const id of ids) {
                    if (on) next.add(id);
                    else next.delete(id);
                  }
                  return next;
                })
              }
              onRetry={retryLead}
              onCancelRetry={cancelRetry}
              onRefresh={() => void query.refetch()}
            />
          </div>
          <div className="shrink-0 border-t border-border px-1 py-2 flex items-center gap-3">
            <p className="text-[12px] text-muted-foreground">
              {(query.data?.total ?? 0).toLocaleString()} leads · {filterLabel}
              {selectedIds.size > 0 ? ` · ${selectedIds.size} selected` : ""}
            </p>
            {(query.data?.total ?? 0) > 50 && (
              <div className="ml-auto overflow-x-auto">
                <TablePagination
                  page={page + 1}
                  totalPages={Math.max(1, Math.ceil((query.data?.total ?? 0) / 50))}
                  pageSize={50}
                  totalItems={query.data?.total ?? 0}
                  onPageChange={(p) => setPage(Math.max(0, p - 1))}
                  onPageSizeChange={() => undefined}
                />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function outcomesConfigured(items: CampaignReportingPayload["dispositions"]): boolean {
  return (items ?? []).some((d) => d.kind === "configured");
}
