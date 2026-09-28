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
import {
  Columns3,
  Download,
  Filter,
  Search,
  PhoneCall,
  PhoneForwarded,
  User,
  UserCheck,
  Users,
  BookOpen,
  Clock,
  Timer,
  Calendar,
  FileText,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Maximize2,
  Minimize2,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type LeadsPage = {
  items: CampaignReportingLead[];
  total: number;
  page: number;
  limit: number;
  filter: CampaignReportingFilter;
};

function MetricCard({
  icon: Icon,
  label,
  value,
  hint,
  hintAction,
  onClick,
  active,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
  hint?: string;
  hintAction?: { label: string; onClick?: () => void };
  onClick?: () => void;
  active?: boolean;
}) {
  const content = (
    <div
      className={cn(
        "bg-card border border-border/80 rounded-xl p-3.5 flex items-center gap-3.5 transition-all text-left w-full h-[84px] shadow-sm",
        onClick && "cursor-pointer hover:border-foreground/20 hover:bg-muted/20",
        active && "border-foreground/30 bg-foreground/[0.05] ring-1 ring-foreground/20 shadow-xs",
      )}
    >
      <div className="h-9 w-9 rounded-lg border border-border/70 bg-muted/40 text-foreground/80 flex items-center justify-center shrink-0">
        <Icon className="h-4.5 w-4.5" />
      </div>
      <div className="min-w-0 flex-1 flex flex-col justify-center">
        <p className="text-xs font-normal text-muted-foreground truncate">{label}</p>
        <p className="text-xl font-bold tabular-nums tracking-tight text-foreground leading-tight mt-0.5">
          {typeof value === "number" ? value.toLocaleString() : value}
        </p>
        <div className="min-h-[16px] flex items-center mt-0.5">
          {hint ? (
            <p className="text-[11px] text-muted-foreground truncate leading-tight">{hint}</p>
          ) : hintAction ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                hintAction.onClick?.();
              }}
              className="text-[11px] font-medium text-orange-600 hover:text-orange-700 dark:text-orange-400 inline-block leading-tight"
            >
              {hintAction.label}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );

  if (!onClick) return content;
  return (
    <button type="button" onClick={onClick} className="w-full h-full text-left flex flex-col">
      {content}
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
  const [isMaximized, setIsMaximized] = useState(false);
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
    view === "attempted" ? "Completed calls"
    : view === "answered" ? "Human answered"
    : view === "voicemail" ? "Voicemail"
    : view === "busy" ? "Busy"
    : view === "no_pickup" ? "No answer"
    : view === "technical_failed" ? "Couldn't reach"
    : view === "retry" ? "Retrying"
    : view === "callback" ? "Callbacks"
    : outcomeActive === "needs_classification" ? "Needs review"
    : outcomeActive ? humanizeSnakeLabel(outcomeActive) : "All leads";

  const statusTabs: Array<{ id: "all" | "voicemail" | "busy"; label: string; count: number }> = [
    { id: "all", label: "All", count: reporting?.funnel.imported ?? 0 },
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
  const totalPages = Math.max(1, Math.ceil((query.data?.total ?? 0) / 50));

  return (
    <div className="flex flex-col min-h-0 flex-1 space-y-6 pb-6">
      {/* ── Section 1: Live status ────────────────────────────────────────── */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold tracking-tight text-foreground">Live status</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5">
          <MetricCard
            icon={PhoneCall}
            label="Calling"
            value={reporting?.liveFloor.calling ?? 0}
          />
          <MetricCard
            icon={User}
            label="Talking"
            value={reporting?.liveFloor.talking ?? 0}
          />
          <MetricCard
            icon={BookOpen}
            label="Slots in use"
            value={`${reporting?.liveFloor.slotsUsed ?? 0} / ${reporting?.liveFloor.concurrencyLimit ?? 10}`}
          />
          <MetricCard
            icon={Clock}
            label="Retries scheduled"
            value={reporting?.workTechnical.retryPending ?? 0}
            active={view === "retry"}
            onClick={() => patchFilter({ view: view === "retry" ? null : "retry", disposition: null, dispositionBucket: null })}
          />
          <MetricCard
            icon={Timer}
            label="Uptime"
            value="2h 24m"
          />
        </div>
      </div>

      {/* ── Section 2: Campaign results ────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5">
        <MetricCard
          icon={Users}
          label="Total leads"
          value={reporting?.funnel.imported ?? 0}
          active={!view && !outcomeActive}
          onClick={() => patchFilter({ view: null, disposition: null, dispositionBucket: null })}
        />
        <MetricCard
          icon={PhoneForwarded}
          label="Completed calls"
          value={called}
          active={view === "attempted" && !outcomeActive}
          onClick={() => patchFilter({ view: view === "attempted" ? null : "attempted", disposition: null, dispositionBucket: null })}
        />
          <MetricCard
            icon={UserCheck}
            label="Human answered"
            value={answered}
            hint={called > 0 ? `${answerPct}% of completed calls` : undefined}
            active={view === "answered" && !outcomeActive}
            onClick={() => patchFilter({ view: "answered", disposition: null, dispositionBucket: null })}
          />
          <MetricCard
            icon={Calendar}
            label="Callbacks requested"
            value={reporting?.workTechnical.callbacks ?? 0}
            active={view === "callback"}
            onClick={() => patchFilter({ view: "callback", disposition: null, dispositionBucket: null })}
          />
          <MetricCard
            icon={FileText}
            label="Needs review"
            value={needsReview}
            hintAction={
              needsReview > 0
                ? {
                    label: "Review calls →",
                    onClick: () =>
                      patchFilter({
                        view: null,
                        disposition: null,
                        dispositionBucket: "needs_classification",
                      }),
                  }
                : undefined
            }
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

      {/* ── Section 3: Leads Table & Controls ─────────────────────────────── */}
      <div
        className={cn(
          "bg-card border border-border/80 rounded-2xl overflow-hidden shadow-sm flex flex-col min-h-[420px] transition-all",
          isMaximized && "fixed inset-4 z-50 shadow-2xl bg-background border-border flex flex-col h-[calc(100vh-2rem)]",
        )}
      >
        {/* Table Toolbar */}
        <div className="px-4 py-3 border-b border-border/80 flex items-center justify-between gap-4 bg-muted/20 flex-wrap">
          {/* Status Segmented Tabs: All, Voicemail, Busy */}
          <div className="inline-flex items-center gap-1 p-1 bg-muted/70 rounded-xl border border-border/60">
            {statusTabs.map((tab) => {
              const selected =
                tab.id === "all"
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
                    "flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
                    selected
                      ? "bg-card text-foreground shadow-xs font-semibold border border-border/80"
                      : "text-muted-foreground hover:text-foreground hover:bg-card/50",
                  )}
                >
                  <span>{tab.label}</span>
                  <span
                    className={cn(
                      "px-1.5 py-0.5 rounded-md text-[10px] font-bold tabular-nums leading-none",
                      selected
                        ? "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    {tab.count.toLocaleString()}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Right Action Tools */}
          <div className="flex items-center gap-2 ml-auto flex-wrap">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={searchDraft}
                onChange={(e) => setSearchDraft(e.target.value)}
                placeholder="Search name or phone..."
                className="h-8 w-52 pl-8 text-xs rounded-lg border-border bg-background"
              />
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline" size="sm" className="h-8 text-xs gap-1.5 rounded-lg">
                  Outcome <ChevronDown className="h-3.5 w-3.5 opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onClick={() => patchFilter({ disposition: null, dispositionBucket: null })}>
                  All outcomes
                </DropdownMenuItem>
                {showOutcomes &&
                  reporting?.dispositions?.map((d) => (
                    <DropdownMenuItem
                      key={d.key}
                      onClick={() =>
                        d.key === "needs_classification"
                          ? patchFilter({ view: null, disposition: null, dispositionBucket: "needs_classification" })
                          : patchFilter({ view: null, disposition: d.key, dispositionBucket: null })
                      }
                    >
                      {d.key === "needs_classification" ? "Needs review" : humanizeSnakeLabel(d.label || d.key)} ({d.count})
                    </DropdownMenuItem>
                  ))}
                {!showOutcomes && (
                  <DropdownMenuItem
                    onClick={() => patchFilter({ view: null, disposition: null, dispositionBucket: "needs_classification" })}
                  >
                    Needs review ({needsReview})
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 text-xs rounded-lg">
                  <Filter className="h-3.5 w-3.5 text-muted-foreground" />
                  Filter
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
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

            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs rounded-lg"
              disabled={exporting}
              onClick={() => void exportLeads()}
            >
              <Download className="h-3.5 w-3.5 text-muted-foreground" />
              {exporting ? "Exporting…" : "Export"}
            </Button>

            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground"
              title={isMaximized ? "Exit fullscreen" : "Maximize view"}
              onClick={() => setIsMaximized((prev) => !prev)}
            >
              {isMaximized ? (
                <Minimize2 className="h-3.5 w-3.5" />
              ) : (
                <Maximize2 className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>
        </div>

        {/* Table Body */}
        {query.isError && !query.data ? (
          <EmptyState
            variant="panel"
            title="Couldn’t load leads"
            action={{ label: "Retry", onClick: () => void query.refetch() }}
          />
        ) : (
          <div className="flex-1 overflow-x-auto min-h-[300px]">
            <LeadReportingTable
              campaignId={campaignId}
              items={query.data?.items ?? []}
              total={query.data?.total ?? 0}
              loading={query.isLoading}
              error={query.isError ? "The reporting API could not be reached." : null}
              emptyView={filter.view}
              columns={columns}
              selectedIds={selectedIds}
              page={page}
              pageSize={50}
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
        )}

        {/* Footer / Pagination */}
        <div className="p-3.5 border-t border-border flex items-center justify-between text-xs text-muted-foreground bg-card/40">
          <div>
            <span className="font-medium text-foreground">
              {(query.data?.total ?? 0).toLocaleString()} leads
            </span>
            {selectedIds.size > 0 ? ` · ${selectedIds.size} selected` : ""}
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <span>Rows per page</span>
              <select
                aria-label="Rows per page"
                className="h-7 rounded border border-border bg-background px-1.5 text-xs text-foreground"
                value="50"
                disabled
              >
                <option value="50">50</option>
              </select>
            </div>

            <div className="flex items-center gap-1.5">
              <Button
                variant="outline"
                size="icon"
                className="h-7 w-7 rounded"
                disabled={page <= 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <span className="text-xs text-foreground px-1">
                Page {page + 1} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="icon"
                className="h-7 w-7 rounded"
                disabled={page + 1 >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function outcomesConfigured(items: CampaignReportingPayload["dispositions"]): boolean {
  return (items ?? []).some((d) => d.kind === "configured");
}
