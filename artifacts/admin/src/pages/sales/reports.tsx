import { useState } from "react";
import { Link } from "wouter";
import { AlertTriangle, Download, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  DataTable,
  EmptyBlock,
  ErrorBlock,
  Field,
  FounderOnlyNote,
  KindLabel,
  LoadingBlock,
  Meter,
  MoneyInput,
  RateText,
  SalesPageHeader,
  SectionCard,
  SimpleSelect,
  StageBadge,
  touch,
  useSalesToast,
} from "@/components/sales/sales-ui";
import { FormDialog } from "@/components/sales/form-dialog";
import { useSalesPrefs } from "@/components/sales/sales-context";
import { useCreateExpense, useDeleteExpense, useExpenses, useReports, useSalesSettings, useUpdateExpense } from "@/hooks/use-sales-api";
import { salesDownload } from "@/lib/sales-api";
import { formatCount, formatDateOnly, formatDateTimeIST, formatPaise, formatPercent, humanize, paiseToRupeesInput, rupeesToPaise, todayIST } from "@/lib/sales-format";
import { EXPENSE_CATEGORIES, EXPORT_KINDS, type Expense, type ReportsView } from "@/lib/sales-types";

export default function ReportsPage() {
  const settings = useSalesSettings();
  const sprint = settings.data?.config.sprint;
  const today = todayIST();
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const effFrom = from ?? (sprint && today >= sprint.start ? sprint.start : today);
  const effTo = to ?? (sprint && today > sprint.end ? sprint.end : today);
  const [groupBy, setGroupBy] = useState<"" | "city" | "sector" | "owner" | "source">("");
  const [cohort, setCohort] = useState<"week" | "month">("week");
  const report = useReports({ from: effFrom, to: effTo, groupBy: groupBy || undefined, cohort });
  const { demo } = useSalesPrefs();
  const toast = useSalesToast();

  return (
    <div className="space-y-4">
      <SalesPageHeader title="Reports" subtitle="Actuals are shown separately from targets and forecasts. Every rate shows its denominator." />

      <SectionCard>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="From">
            <Input type="date" value={effFrom} onChange={(e) => e.target.value && setFrom(e.target.value)} className={touch} />
          </Field>
          <Field label="To">
            <Input type="date" value={effTo} onChange={(e) => e.target.value && setTo(e.target.value)} className={touch} />
          </Field>
          <Field label="Group activity by">
            <SimpleSelect<"city" | "sector" | "owner" | "source"> value={groupBy} onChange={setGroupBy} options={["city", "sector", "owner", "source"]} allowAll allLabel="No grouping" />
          </Field>
          <Field label="Pilot cohorts by">
            <SimpleSelect value={cohort} onChange={(v) => v && setCohort(v)} options={["week", "month"]} />
          </Field>
          <div className="flex items-end">
            <Button
              variant="ghost"
              className={touch}
              onClick={() => {
                setFrom(null);
                setTo(null);
              }}
            >
              Sprint to date
            </Button>
          </div>
        </div>
        {effFrom > effTo && <p className="mt-2 text-xs text-red-500">"From" must be on or before "To".</p>}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Export CSV ({formatDateOnly(effFrom, "—", false)} – {formatDateOnly(effTo, "—", false)}):</span>
          {EXPORT_KINDS.map((k) => (
            <Button
              key={k}
              size="sm"
              variant="outline"
              className="min-h-11 md:min-h-8"
              onClick={() => salesDownload(`/exports/${k}.csv`, `sales-${k}-${effFrom}-to-${effTo}${demo ? "-demo" : ""}.csv`, { from: effFrom, to: effTo, demo }).catch((e) => toast.error(e, "Export failed"))}
            >
              <Download className="mr-1 h-3.5 w-3.5" /> {humanize(k)}
            </Button>
          ))}
        </div>
      </SectionCard>

      {report.isLoading && <LoadingBlock rows={8} />}
      {report.error && <ErrorBlock error={report.error} onRetry={() => report.refetch()} />}
      {report.data && <ReportBody r={report.data} />}

      <ExpensesSection from={effFrom} to={effTo} />
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-md border border-border p-3">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold tabular-nums">{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

function Rule({ children }: { children: string | undefined }) {
  if (!children) return null;
  return <p className="mt-2 text-[11px] text-muted-foreground">{children}</p>;
}

function ReportBody({ r }: { r: ReportsView }) {
  const t = r.activity.totals;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <KindLabel kind="actual" />
        <span className="text-xs text-muted-foreground">
          {formatDateOnly(r.from)} – {formatDateOnly(r.to)}
          {r.demo ? " · demo data" : ""}
        </span>
      </div>

      <SectionCard title="Activity">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Visits" value={formatCount(t.visits)} sub={`${formatCount(t.firstVisits)} first visits`} />
          <Stat label="Buyer conversations" value={formatCount(t.conversations)} />
          <Stat label="Demos given" value={formatCount(t.demos)} />
          <Stat label="Pilots started" value={formatCount(t.pilotsStarted)} />
          <Stat label="New paying clients" value={formatCount(t.newPaid)} />
          <Stat label="Revisits" value={formatCount(Math.max(0, t.visits - t.firstVisits))} />
        </div>
        {r.activity.groups && r.activity.groups.length > 0 && (
          <DataTable className="mt-3">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{humanize(r.groupBy)}</TableHead>
                  <TableHead className="text-right">Visits</TableHead>
                  <TableHead className="text-right">First visits</TableHead>
                  <TableHead className="text-right">Conversations</TableHead>
                  <TableHead className="text-right">Demos</TableHead>
                  <TableHead className="text-right">Pilots</TableHead>
                  <TableHead className="text-right">New paid</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {r.activity.groups.map((g) => (
                  <TableRow key={g.key}>
                    <TableCell className="text-xs">{g.key || "—"}</TableCell>
                    {[g.visits, g.firstVisits, g.conversations, g.demos, g.pilotsStarted, g.newPaid].map((v, i) => (
                      <TableCell key={i} className="text-right text-xs tabular-nums">
                        {formatCount(v)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </DataTable>
        )}
        <Rule>{r.activity.newPilotRule}</Rule>
      </SectionCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title="Funnel" description={r.funnel.note}>
          <ul className="space-y-2">
            {r.funnel.steps.map((s) => (
              <li key={s.stage} className="flex items-center justify-between gap-2 text-sm">
                <StageBadge stage={s.stage} />
                <span className="flex items-center gap-3">
                  <span className="font-medium tabular-nums">{formatCount(s.count)}</span>
                  <span className="w-36 text-right text-xs">{s.fromPrevious ? <RateText rate={s.fromPrevious} /> : <span className="text-muted-foreground">—</span>}</span>
                </span>
              </li>
            ))}
          </ul>
        </SectionCard>

        <SectionCard title="Stage ageing" description={`Open opportunities by days in current stage, as of ${formatDateTimeIST(r.stageAgeing.asOf)}`}>
          {r.stageAgeing.stages.length === 0 ? (
            <p className="text-xs text-muted-foreground">No open opportunities.</p>
          ) : (
            <DataTable>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Stage</TableHead>
                    {r.stageAgeing.buckets.map((b) => (
                      <TableHead key={b} className="text-right">
                        {b}
                      </TableHead>
                    ))}
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {r.stageAgeing.stages.map((s) => (
                    <TableRow key={s.stage}>
                      <TableCell>
                        <StageBadge stage={s.stage} />
                      </TableCell>
                      {r.stageAgeing.buckets.map((b) => (
                        <TableCell key={b} className="text-right text-xs tabular-nums">
                          {formatCount(s.buckets[b] ?? 0)}
                        </TableCell>
                      ))}
                      <TableCell className="text-right text-xs font-medium tabular-nums">{formatCount(s.total)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </DataTable>
          )}
        </SectionCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <SectionCard title="Cash collected">
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Fee (excl. GST)" value={formatPaise(r.cash.feePaise)} />
            <Stat label="GST" value={formatPaise(r.cash.taxPaise)} />
          </div>
          <p className="mt-2 text-xs">Total received: {formatPaise(r.cash.totalPaise)}</p>
          {Object.keys(r.cash.byKind).length > 0 && (
            <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
              {Object.entries(r.cash.byKind).map(([k, v]) => (
                <li key={k}>
                  {humanize(k)}: {formatPaise(v.feePaise)} + GST {formatPaise(v.taxPaise)}
                </li>
              ))}
            </ul>
          )}
          <Rule>{r.cash.rule}</Rule>
        </SectionCard>

        <SectionCard title="Monthly recurring revenue" description={`As of ${formatDateOnly(r.mrr.asOfDate)}`}>
          <Stat label="Active MRR" value={formatPaise(r.mrr.activeMrrPaise)} sub={`${formatCount(r.mrr.activeSubscriptions)} subscriptions`} />
          {r.mrr.overdueSubscriptions > 0 && (
            <p className="mt-2 flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
              <AlertTriangle className="h-3.5 w-3.5" /> {formatPaise(r.mrr.overdueMrrPaise)} across {r.mrr.overdueSubscriptions} overdue renewal(s)
            </p>
          )}
          <Rule>{r.mrr.mrrRule}</Rule>
        </SectionCard>

        <SectionCard title="New paying clients">
          <Stat label="In period" value={formatCount(r.newPaidClients.count)} />
          {r.newPaidClients.items.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-xs">
              {r.newPaidClients.items.map((c) => (
                <li key={c.companyId}>
                  <Link href={`/sales/companies/${c.companyId}`} className="hover:underline">
                    {c.name}
                  </Link>{" "}
                  <span className="text-muted-foreground">
                    · {formatDateTimeIST(c.firstPaidAt)}
                    {c.source ? ` · ${c.source}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <Rule>{r.newPaidClients.rule}</Rule>
          <div className="mt-3 border-t border-border pt-3">
            <Stat label="Went live in period" value={formatCount(r.newLive.count)} />
            {r.newLive.items.length > 0 && (
              <ul className="mt-2 space-y-0.5 text-xs">
                {r.newLive.items.map((s) => (
                  <li key={s.subscriptionId}>
                    <Link href={`/sales/companies/${s.companyId}`} className="hover:underline">
                      {s.name ?? `#${s.companyId}`}
                    </Link>{" "}
                    <span className="text-muted-foreground">· {formatDateTimeIST(s.liveAt)} · {s.status}</span>
                  </li>
                ))}
              </ul>
            )}
            <Rule>{r.newLive.rule}</Rule>
          </div>
        </SectionCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <SectionCard title="Renewals">
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Due in period" value={formatCount(r.renewals.dueInPeriod)} />
            <Stat label="Overdue" value={formatCount(r.renewals.overdue)} />
            <Stat label="Upcoming" value={formatCount(r.renewals.upcoming)} />
          </div>
          <p className="mt-2 text-xs">
            Verified renewal payments: {formatCount(r.renewals.verifiedRenewalPayments)} ({formatPaise(r.renewals.verifiedRenewalFeePaise)})
          </p>
          {r.renewals.items.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
              {r.renewals.items.slice(0, 10).map((i) => (
                <li key={`${i.subscriptionId}-${i.renewalDate}`}>
                  {i.companyName ?? `#${i.companyId}`} · {formatDateOnly(i.renewalDate, "—", false)} · {formatPaise(i.monthlyFeePaise)} · {i.status}
                </li>
              ))}
            </ul>
          )}
          <Rule>{r.renewals.rule}</Rule>
        </SectionCard>

        <SectionCard title="Pilot costs">
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Total" value={formatPaise(r.pilotCosts.totalPaise)} sub={`${formatCount(r.pilotCosts.pilotsStarted)} pilots started`} />
            <Stat label="Per pilot" value={r.pilotCosts.perPilotPaise == null ? "n/a" : formatPaise(r.pilotCosts.perPilotPaise)} />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Calling cost {formatPaise(r.pilotCosts.snapshotCostPaise)} + pilot expenses {formatPaise(r.pilotCosts.pilotCostExpensesPaise)}
          </p>
          <Rule>{r.pilotCosts.rule}</Rule>
        </SectionCard>

        <SectionCard title="Loss reasons">
          {r.lossReasons.length === 0 ? (
            <p className="text-xs text-muted-foreground">No lost opportunities in this period.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {r.lossReasons.map((l) => (
                <li key={l.reason} className="flex justify-between gap-2">
                  <span className="min-w-0 truncate">{l.reason}</span>
                  <span className="tabular-nums text-muted-foreground">{l.count}</span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <SectionCard title="Acquisition cost by source" description={r.acquisitionCost.label}>
        {r.acquisitionCost.bySource.length === 0 ? (
          <p className="text-xs text-muted-foreground">No acquisition spend or new clients in this period.</p>
        ) : (
          <DataTable>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Source</TableHead>
                  <TableHead className="text-right">Spend</TableHead>
                  <TableHead className="text-right">New paid</TableHead>
                  <TableHead className="text-right">Cost per new paid client</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {r.acquisitionCost.bySource.map((s) => (
                  <TableRow key={s.source}>
                    <TableCell className="text-xs">{s.source}</TableCell>
                    <TableCell className="text-right text-xs tabular-nums">{formatPaise(s.spendPaise)}</TableCell>
                    <TableCell className="text-right text-xs tabular-nums">{formatCount(s.newPaid)}</TableCell>
                    <TableCell className="text-right text-xs tabular-nums">{s.costPerNewPaidPaise == null ? "— (no new clients)" : formatPaise(s.costPerNewPaidPaise)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </DataTable>
        )}
        <Rule>{`Included expense categories: ${r.acquisitionCost.includedExpenseCategories.map(humanize).join(", ") || "none"}.`}</Rule>
      </SectionCard>

      <SectionCard title="Pilot cohorts" description={r.pilotCohorts.rule}>
        {r.pilotCohorts.cohorts.length === 0 ? (
          <p className="text-xs text-muted-foreground">No pilots started in this period.</p>
        ) : (
          <DataTable>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{r.pilotCohorts.kind === "week" ? "Week of" : "Month of"}</TableHead>
                  <TableHead className="text-right">Started</TableHead>
                  <TableHead className="text-right">Active</TableHead>
                  <TableHead className="text-right">Completed</TableHead>
                  <TableHead className="text-right">Cancelled</TableHead>
                  <TableHead className="text-right">Extensions</TableHead>
                  <TableHead className="text-right">Converted</TableHead>
                  <TableHead className="text-right">Pending</TableHead>
                  <TableHead className="text-right">Conversion</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {r.pilotCohorts.cohorts.map((c) => (
                  <TableRow key={c.cohortStart}>
                    <TableCell className="text-xs">
                      {formatDateOnly(c.cohortStart, "—", false)} <span className="text-muted-foreground">({c.cohortAgeDays}d old)</span>
                    </TableCell>
                    {[c.started, c.active, c.completed, c.cancelled, c.extensions, c.converted, c.pending].map((v, i) => (
                      <TableCell key={i} className="text-right text-xs tabular-nums">
                        {formatCount(v)}
                      </TableCell>
                    ))}
                    <TableCell className="text-right text-xs">
                      <RateText rate={c.conversionRate} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </DataTable>
        )}
      </SectionCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <TargetsPanel r={r} />
        <ForecastPanel r={r} />
      </div>
    </div>
  );
}

function TargetsPanel({ r }: { r: ReportsView }) {
  const rows = [
    ["Visits", r.targets.visits],
    ["Buyer conversations", r.targets.conversations],
    ["Demos", r.targets.demos],
    ["Pilots", r.targets.pilots],
  ] as const;
  return (
    <SectionCard title={<span className="flex items-center gap-2">Targets vs actual <KindLabel kind="target" /></span>} description={r.targets.note} className="border-dashed">
      <ul className="space-y-3">
        {rows.map(([label, m]) => (
          <li key={label}>
            <div className="flex justify-between text-sm">
              <span>{label}</span>
              <span className="tabular-nums">
                {formatCount(m.actual)} <span className="text-muted-foreground">actual / {formatCount(m.target)} target</span>
              </span>
            </div>
            <Meter value={m.progress.value == null ? null : Math.min(1, m.progress.value)} tone={m.progress.value != null && m.progress.value >= 1 ? "success" : "accent"} />
            <p className="text-[10px] text-muted-foreground">{m.progress.value == null ? "n/a" : formatPercent(m.progress.value)} · {m.progress.label}</p>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-muted-foreground">
        {r.targets.days} target day(s) in range. Sprint goals: operating {r.targets.goals.operatingNewPaid} new paying clients; stretch {r.targets.goals.stretchNewPaid} / {formatPaise(r.targets.goals.stretchMrrPaise)} MRR.
      </p>
    </SectionCard>
  );
}

function ForecastPanel({ r }: { r: ReportsView }) {
  const f = r.forecast;
  return (
    <SectionCard title={<span className="flex items-center gap-2">Forecast <KindLabel kind="forecast" /></span>} description={f.label} className="border-dashed">
      <p className="text-xs font-medium">Assumptions</p>
      <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
        {f.assumptions.map((a) => (
          <li key={a.key}>
            {a.label}: {formatPercent(a.value)}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted-foreground">
        Method: {f.inputs.method} From {formatDateOnly(f.inputs.remainingSprintFrom, "—", false)} to {formatDateOnly(f.inputs.sprintEnd, "—", false)} · {formatCount(f.inputs.remainingTargetVisits)} target visits remaining ·{" "}
        {formatCount(f.inputs.activePilotsNow)} active pilots now.
      </p>
      {f.missingAssumptions.length > 0 && (
        <p className="mt-2 flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
          <AlertTriangle className="h-3.5 w-3.5" /> Missing assumptions: {f.missingAssumptions.join(", ")} — set them in Settings.
        </p>
      )}
      {f.projected ? (
        <div className="mt-3 grid grid-cols-2 gap-2">
          {Object.entries(f.projected).map(([k, v]) => (
            <Stat key={k} label={`Projected ${humanize(k).toLowerCase()}`} value={formatCount(Math.round(v))} />
          ))}
        </div>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">No projection available.</p>
      )}
    </SectionCard>
  );
}

function ExpenseDialog({ expense, onClose }: { expense?: Expense; onClose: () => void }) {
  const settings = useSalesSettings();
  const create = useCreateExpense();
  const update = useUpdateExpense();
  const toast = useSalesToast();
  const [f, setF] = useState({
    date: expense?.date ?? todayIST(),
    category: expense?.category ?? ("ads" as Expense["category"]),
    isAcquisition: expense?.isAcquisition ?? true,
    source: expense?.source ?? "",
    sourceCampaign: expense?.sourceCampaign ?? "",
    amount: paiseToRupeesInput(expense?.amountPaise),
    description: expense?.description ?? "",
  });
  const amountPaise = rupeesToPaise(f.amount);
  const mut = expense ? update : create;
  const body = {
    date: f.date,
    category: f.category,
    isAcquisition: f.isAcquisition,
    source: f.source || null,
    sourceCampaign: f.sourceCampaign.trim() || null,
    amountPaise,
    description: f.description.trim() || null,
  };
  const done = () => {
    toast.success(expense ? "Expense updated" : "Expense added");
    onClose();
  };
  return (
    <FormDialog
      open
      onOpenChange={(v) => !v && onClose()}
      title={expense ? "Edit expense" : "Add expense"}
      pending={mut.isPending}
      error={mut.error}
      disabled={amountPaise == null || amountPaise < 1 || !f.date}
      onSubmit={() => (expense ? update.mutate({ id: expense.id, ...body }, { onSuccess: done }) : create.mutate(body, { onSuccess: done }))}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Date" required>
          <Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} className={touch} />
        </Field>
        <Field label="Amount" required>
          <MoneyInput value={f.amount} onChange={(v) => setF({ ...f, amount: v })} />
        </Field>
        <Field label="Category" required>
          <SimpleSelect value={f.category} onChange={(v) => v && setF({ ...f, category: v })} options={EXPENSE_CATEGORIES} />
        </Field>
        <Field label="Source">
          <SimpleSelect value={f.source} onChange={(v) => setF({ ...f, source: v })} options={settings.data?.config.sources ?? []} allowAll allLabel="None" />
        </Field>
        <Field label="Campaign">
          <Input value={f.sourceCampaign} onChange={(e) => setF({ ...f, sourceCampaign: e.target.value })} className={touch} />
        </Field>
        <label className="flex min-h-11 items-center gap-2 self-end text-sm">
          <Checkbox checked={f.isAcquisition} onCheckedChange={(v) => setF({ ...f, isAcquisition: v === true })} /> Counts as acquisition cost
        </label>
      </div>
      <Field label="Description">
        <Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} rows={2} />
      </Field>
    </FormDialog>
  );
}

function ExpensesSection({ from, to }: { from: string; to: string }) {
  const { isFounder } = useSalesPrefs();
  const [category, setCategory] = useState<"" | Expense["category"]>("");
  const expenses = useExpenses({ from, to, category: category || undefined });
  const del = useDeleteExpense();
  const toast = useSalesToast();
  const [editing, setEditing] = useState<Expense | "new" | null>(null);
  const [deleting, setDeleting] = useState<Expense | null>(null);

  return (
    <SectionCard
      title="Expenses"
      description={isFounder ? "Spend used for pilot cost and acquisition cost reports." : <FounderOnlyNote>Only founders add or edit expenses</FounderOnlyNote>}
      actions={
        <div className="flex gap-2">
          <SimpleSelect<Expense["category"]> value={category} onChange={setCategory} options={EXPENSE_CATEGORIES} allowAll allLabel="All categories" className="w-40" />
          {isFounder && (
            <Button size="sm" className={touch} onClick={() => setEditing("new")}>
              <Plus className="mr-1 h-4 w-4" /> Add
            </Button>
          )}
        </div>
      }
    >
      {expenses.isLoading && <LoadingBlock rows={3} />}
      {expenses.error && <ErrorBlock error={expenses.error} onRetry={() => expenses.refetch()} />}
      {expenses.data && expenses.data.items.length === 0 && <EmptyBlock title="No expenses in this range" />}
      {expenses.data && expenses.data.items.length > 0 && (
        <>
          <DataTable>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  {isFounder && <TableHead className="w-24" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {expenses.data.items.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="whitespace-nowrap text-xs">{formatDateOnly(e.date, "—", false)}</TableCell>
                    <TableCell className="text-xs">
                      {humanize(e.category)}
                      {e.isAcquisition && <span className="ml-1 text-[10px] text-muted-foreground">(acq.)</span>}
                    </TableCell>
                    <TableCell className="text-xs">
                      {e.source ?? "—"}
                      {e.sourceCampaign ? ` · ${e.sourceCampaign}` : ""}
                    </TableCell>
                    <TableCell className="max-w-64 truncate text-xs">{e.description ?? "—"}</TableCell>
                    <TableCell className="text-right text-xs tabular-nums">{formatPaise(e.amountPaise)}</TableCell>
                    {isFounder && (
                      <TableCell className="text-right">
                        <Button size="icon" variant="ghost" className="h-11 w-11 md:h-8 md:w-8" aria-label="Edit expense" onClick={() => setEditing(e)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-11 w-11 md:h-8 md:w-8" aria-label="Delete expense" onClick={() => setDeleting(e)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </DataTable>
          <p className={cn("mt-2 text-right text-sm font-medium")}>Total {formatPaise(expenses.data.totalPaise)}</p>
        </>
      )}
      {editing && <ExpenseDialog expense={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} />}
      {deleting && (
        <FormDialog
          open
          onOpenChange={(v) => !v && setDeleting(null)}
          title="Delete expense?"
          description={`${formatPaise(deleting.amountPaise)} · ${humanize(deleting.category)} on ${formatDateOnly(deleting.date)}`}
          submitLabel="Delete"
          pending={del.isPending}
          error={del.error}
          onSubmit={() =>
            del.mutate(deleting.id, {
              onSuccess: () => {
                toast.success("Expense deleted");
                setDeleting(null);
              },
            })
          }
        >
          <p className="text-xs text-muted-foreground">This removes it from cost reports.</p>
        </FormDialog>
      )}
    </SectionCard>
  );
}
