import { useMemo, useState } from "react";
import { Link } from "wouter";
import { Download, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  EmptyBlock,
  ErrorBlock,
  LoadingBlock,
  Pill,
  SalesPageHeader,
  SectionCard,
  SimpleSelect,
  StageBadge,
  touch,
  useSalesToast,
  useTeamNames,
} from "@/components/sales/sales-ui";
import { CreateSubscriptionDialog, PaymentsTable, ProposalList, RecordPaymentDialog, SubscriptionPanel } from "@/components/sales/billing";
import { TaskActions } from "@/components/sales/task-actions";
import { useSalesPrefs } from "@/components/sales/sales-context";
import { useCompanies, useCompanyIndex, usePayments, useProposals, useSubscriptions, useTasks, useToday } from "@/hooks/use-sales-api";
import { salesDownload } from "@/lib/sales-api";
import { addDaysToDate, formatDateOnly, formatDateTimeIST, formatPaise, humanize, todayIST } from "@/lib/sales-format";
import type { CompanyListItem, Subscription } from "@/lib/sales-types";

export default function CustomersPage() {
  return (
    <div className="space-y-4">
      <SalesPageHeader title="Customers" subtitle="Proposals, payments, subscriptions, renewals and onboarding." />
      <CustomerSummary />
      <Tabs defaultValue="proposals">
        <div className="overflow-x-auto">
          <TabsList>
            <TabsTrigger value="proposals">Proposals</TabsTrigger>
            <TabsTrigger value="payments">Payments</TabsTrigger>
            <TabsTrigger value="subscriptions">Subscriptions</TabsTrigger>
            <TabsTrigger value="renewals">Renewals</TabsTrigger>
            <TabsTrigger value="onboarding">Onboarding</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="proposals">
          <ProposalsTab />
        </TabsContent>
        <TabsContent value="payments">
          <PaymentsTab />
        </TabsContent>
        <TabsContent value="subscriptions">
          <SubscriptionsTab />
        </TabsContent>
        <TabsContent value="renewals">
          <RenewalsTab />
        </TabsContent>
        <TabsContent value="onboarding">
          <OnboardingTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/** Keeps paying, live, active and renewal counts apart so one is never read as another. */
function CustomerSummary() {
  const { scope } = useSalesPrefs();
  const today = useToday({ scope });
  const subs = useSubscriptions();
  const todayStr = todayIST();
  const list = subs.data?.subscriptions ?? [];
  const active = list.filter((s) => s.status === "active");
  const stats = [
    { label: "New paying (sprint to date)", value: today.data ? String(today.data.newPaying.sprintToDate) : "—", hint: "First verified payment" },
    { label: "Live", value: String(list.filter((s) => s.liveAt && s.status !== "cancelled").length), hint: "Switched on for the customer" },
    { label: "Active subscriptions", value: String(active.length), hint: `${list.filter((s) => s.status === "paused").length} paused` },
    { label: "Renewals overdue", value: String(active.filter((s) => s.renewalDate && s.renewalDate < todayStr).length), hint: "Renewal date passed, not yet paid" },
    { label: "Renewals next 30 days", value: String(active.filter((s) => s.renewalDate && s.renewalDate >= todayStr && s.renewalDate <= addDaysToDate(todayStr, 30)).length), hint: "Upcoming" },
  ];
  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
      {stats.map((s) => (
        <div key={s.label} className="rounded-lg border border-border bg-card p-3">
          <p className="text-[11px] font-medium text-muted-foreground">{s.label}</p>
          <p className="mt-0.5 text-xl font-semibold tabular-nums">{s.value}</p>
          <p className="text-[11px] text-muted-foreground">{s.hint}</p>
        </div>
      ))}
    </div>
  );
}

const PROPOSAL_STAGES = ["Results reviewed", "Proposal", "Paid"] as const;

function ProposalsTab() {
  const [stage, setStage] = useState<(typeof PROPOSAL_STAGES)[number]>("Proposal");
  const list = useCompanies({ stage, pageSize: 50 });
  return (
    <div className="mt-3 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <SimpleSelect value={stage} onChange={(v) => v && setStage(v)} options={PROPOSAL_STAGES} className="w-52" />
        <span className="text-xs text-muted-foreground">Companies in this stage and their proposals.</span>
      </div>
      {list.isLoading && <LoadingBlock rows={4} />}
      {list.error && <ErrorBlock error={list.error} onRetry={() => list.refetch()} />}
      {list.data && list.data.items.length === 0 && <EmptyBlock title={`No companies in ${stage}`} />}
      {list.data?.items.map((c) => <CompanyProposals key={c.id} company={c} />)}
    </div>
  );
}

function CompanyProposals({ company }: { company: CompanyListItem }) {
  const proposals = useProposals(company.id);
  return (
    <SectionCard
      title={
        <Link href={`/sales/companies/${company.id}`} className="hover:underline">
          {company.name}
        </Link>
      }
      description={`${company.ownerName ?? "Unassigned"}${company.city ? ` · ${company.city}` : ""}`}
      actions={<StageBadge stage={company.stage} />}
    >
      {proposals.isLoading ? <LoadingBlock rows={1} /> : proposals.error ? <ErrorBlock error={proposals.error} /> : <ProposalList proposals={proposals.data?.proposals ?? []} companyId={company.id} opportunityId={company.opportunityId} />}
    </SectionCard>
  );
}

function PaymentsTab() {
  const [status, setStatus] = useState<"" | "recorded" | "verified" | "rejected">("");
  const payments = usePayments({ status: status || undefined });
  const index = useCompanyIndex();
  const toast = useSalesToast();
  const { demo, isFounder } = useSalesPrefs();
  const [recording, setRecording] = useState(false);
  const pending = (payments.data?.payments ?? []).filter((p) => p.status === "recorded").length;
  return (
    <div className="mt-3 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <SimpleSelect<"recorded" | "verified" | "rejected"> value={status} onChange={setStatus} options={["recorded", "verified", "rejected"]} allowAll allLabel="All payments" className="w-44" />
          {isFounder && pending > 0 && status === "" && <Pill tone="warning">{pending} awaiting verification</Pill>}
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className={touch}
            onClick={() => salesDownload("/exports/payments.csv", `sales-payments${demo ? "-demo" : ""}.csv`, { demo }).catch((e) => toast.error(e, "Export failed"))}
          >
            <Download className="mr-1.5 h-4 w-4" /> CSV
          </Button>
          <Button size="sm" className={touch} onClick={() => setRecording(true)}>
            <Plus className="mr-1.5 h-4 w-4" /> Record payment
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">Fee and GST are tracked separately. Only verified payments count as cash collected; adjustments (corrections, refunds) are applied on top.</p>
      {payments.isLoading && <LoadingBlock rows={4} />}
      {payments.error && <ErrorBlock error={payments.error} onRetry={() => payments.refetch()} />}
      {payments.data && <PaymentsTable payments={payments.data.payments} companyName={(id) => index.data?.get(id)?.name} />}
      {recording && <RecordPaymentDialog open onOpenChange={setRecording} />}
    </div>
  );
}

function SubscriptionsTab() {
  const subs = useSubscriptions();
  const index = useCompanyIndex();
  const [status, setStatus] = useState<"" | "active" | "paused" | "cancelled">("active");
  const [creating, setCreating] = useState(false);
  const list = (subs.data?.subscriptions ?? []).filter((s) => !status || s.status === status);
  return (
    <div className="mt-3 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SimpleSelect<"active" | "paused" | "cancelled"> value={status} onChange={setStatus} options={["active", "paused", "cancelled"]} allowAll allLabel="All" className="w-44" />
        <Button size="sm" className={touch} onClick={() => setCreating(true)}>
          <Plus className="mr-1.5 h-4 w-4" /> Create subscription
        </Button>
      </div>
      {subs.isLoading && <LoadingBlock rows={4} />}
      {subs.error && <ErrorBlock error={subs.error} onRetry={() => subs.refetch()} />}
      {subs.data && list.length === 0 && <EmptyBlock title="No subscriptions" description="Create one after the proposal is accepted." />}
      <div className="grid gap-3 lg:grid-cols-2">
        {list.map((s) => (
          <SubscriptionPanel key={s.id} sub={s} companyName={index.data?.get(s.companyId)?.name ?? `Company #${s.companyId}`} />
        ))}
      </div>
      {creating && <CreateSubscriptionDialog open onOpenChange={setCreating} />}
    </div>
  );
}

function RenewalsTab() {
  const subs = useSubscriptions();
  const index = useCompanyIndex();
  const names = useTeamNames();
  const [paying, setPaying] = useState<{ id: number; name: string } | null>(null);
  const today = todayIST();
  const horizon = addDaysToDate(today, 30);
  const groups = useMemo(() => {
    const rows = (subs.data?.subscriptions ?? []).filter((s) => s.status === "active" && s.renewalDate).sort((a, b) => a.renewalDate!.localeCompare(b.renewalDate!));
    return {
      overdue: rows.filter((s) => s.renewalDate! < today),
      upcoming: rows.filter((s) => s.renewalDate! >= today && s.renewalDate! <= horizon),
      later: rows.filter((s) => s.renewalDate! > horizon),
    };
  }, [subs.data, today, horizon]);

  const row = (s: Subscription, tone: "danger" | "accent" | "muted") => {
    const name = index.data?.get(s.companyId)?.name ?? `Company #${s.companyId}`;
    return (
      <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
        <div className="min-w-0">
          <Link href={`/sales/companies/${s.companyId}`} className="text-sm font-medium hover:underline">
            {name}
          </Link>
          <p className="text-xs text-muted-foreground">
            {formatPaise(s.monthlyFeePaise)}/month · owner {names(s.customerOwnerId)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Pill tone={tone}>{formatDateOnly(s.renewalDate)}</Pill>
          <Button size="sm" variant="outline" className="min-h-11 md:min-h-8" onClick={() => setPaying({ id: s.companyId, name })}>
            Record renewal
          </Button>
        </div>
      </li>
    );
  };

  return (
    <div className="mt-3 space-y-3">
      <p className="text-xs text-muted-foreground">Active subscriptions by renewal date. A verified renewal payment moves the renewal date forward one month.</p>
      {subs.isLoading && <LoadingBlock rows={4} />}
      {subs.error && <ErrorBlock error={subs.error} onRetry={() => subs.refetch()} />}
      {subs.data && (
        <>
          <SectionCard title={`Overdue (${groups.overdue.length})`}>
            {groups.overdue.length ? <ul className="divide-y divide-border">{groups.overdue.map((s) => row(s, "danger"))}</ul> : <p className="text-xs text-muted-foreground">None overdue.</p>}
          </SectionCard>
          <SectionCard title={`Next 30 days (${groups.upcoming.length})`}>
            {groups.upcoming.length ? <ul className="divide-y divide-border">{groups.upcoming.map((s) => row(s, "accent"))}</ul> : <p className="text-xs text-muted-foreground">Nothing due in the next 30 days.</p>}
          </SectionCard>
          {groups.later.length > 0 && (
            <SectionCard title={`Later (${groups.later.length})`}>
              <ul className="divide-y divide-border">{groups.later.map((s) => row(s, "muted"))}</ul>
            </SectionCard>
          )}
        </>
      )}
      {paying && <RecordPaymentDialog open onOpenChange={(v) => !v && setPaying(null)} company={paying} />}
    </div>
  );
}

const CUSTOMER_TASK_KINDS = new Set(["onboarding", "service_review", "renewal"]);

function OnboardingTab() {
  const { scope } = useSalesPrefs();
  const tasks = useTasks({ scope, status: "open" });
  const names = useTeamNames();
  const items = (tasks.data?.items ?? []).filter((t) => CUSTOMER_TASK_KINDS.has(t.kind));
  return (
    <div className="mt-3 space-y-3">
      <p className="text-xs text-muted-foreground">Open onboarding, service-review and renewal tasks{scope === "mine" ? " assigned to you" : " for the team"}.</p>
      {tasks.isLoading && <LoadingBlock rows={4} />}
      {tasks.error && <ErrorBlock error={tasks.error} onRetry={() => tasks.refetch()} />}
      {tasks.data && items.length === 0 && <EmptyBlock title="No open customer tasks" />}
      {items.length > 0 && (
        <ul className="divide-y divide-border rounded-lg border border-border bg-card px-3">
          {items.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
              <div className="min-w-0">
                <p className="text-sm">{t.title}</p>
                <p className={cn("text-xs", t.overdue ? "font-medium text-red-500" : "text-muted-foreground")}>
                  {humanize(t.kind)}
                  {t.companyId && (
                    <>
                      {" · "}
                      <Link href={`/sales/companies/${t.companyId}`} className="hover:underline">
                        {t.companyName ?? `Company #${t.companyId}`}
                      </Link>
                    </>
                  )}
                  {" · "}
                  {t.dueAt ? formatDateTimeIST(t.dueAt) : "No due date"}
                  {t.overdue ? " · overdue" : ""} · {names(t.ownerId)}
                </p>
              </div>
              <TaskActions task={t} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
