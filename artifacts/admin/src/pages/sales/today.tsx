import { useState, type ReactNode } from "react";
import { Link } from "wouter";
import { AlertTriangle, CalendarClock, ChevronLeft, ChevronRight, Clock, Inbox, RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  EmptyBlock,
  ErrorBlock,
  KindLabel,
  LoadingBlock,
  Meter,
  OwnerSelect,
  Pill,
  RatioText,
  SalesPageHeader,
  SectionCard,
  touch,
  useSalesToast,
  useTeamNames,
} from "@/components/sales/sales-ui";
import { QUICK_ACTIONS, useQuickActions } from "@/components/sales/quick-actions";
import { TaskActions } from "@/components/sales/task-actions";
import { useSalesPrefs } from "@/components/sales/sales-context";
import { useAssignOwner, useToday } from "@/hooks/use-sales-api";
import {
  addDaysToDate,
  formatCount,
  formatDateOnly,
  formatDateTimeIST,
  formatMinutes,
  formatPaise,
  formatRelative,
  formatTimeIST,
  humanize,
  todayIST,
} from "@/lib/sales-format";
import type { GoalProgress, Ratio, TodayView } from "@/lib/sales-types";

function GoalCard({ title, goal, hint, children }: { title: string; goal: GoalProgress; hint?: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground">{title}</p>
        <KindLabel kind="actual" />
      </div>
      <p className="mt-1 text-2xl font-semibold tabular-nums">
        {goal.actual}
        <span className="text-base font-normal text-muted-foreground"> / {goal.target}</span>
      </p>
      <Meter value={goal.progress.value} className="mt-2" />
      <p className="mt-1.5 text-[11px] text-muted-foreground">
        <RatioText ratio={goal.progress} /> · {goal.remaining} to go{hint ? ` · ${hint}` : ""}
      </p>
      {children}
    </div>
  );
}

function TargetRow({ label, actual, target, ratio, range, extra }: { label: string; actual: number; target: number | null; ratio: Ratio; range?: { min: number; max: number }; extra?: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums">
          <span className="font-semibold">{actual}</span>
          <span className="text-muted-foreground"> / {target ?? "—"} target</span>
        </span>
      </div>
      <Meter value={ratio.value} tone={ratio.value != null && ratio.value >= 1 ? "success" : "accent"} />
      <p className="text-[11px] text-muted-foreground">
        {target == null ? "No target set for this day" : <RatioText ratio={ratio} />}
        {range ? ` · healthy range ${range.min}–${range.max}` : ""}
        {extra}
      </p>
    </div>
  );
}

function SprintStatus({ data }: { data: TodayView }) {
  const m = data.newPaying.milestone;
  return (
    <div className="grid gap-3 md:grid-cols-3">
      <GoalCard title="New paying vs operating goal" goal={data.newPaying.operating} hint={`sprint ${formatDateOnly(data.sprint.start, "", false)} – ${formatDateOnly(data.sprint.end, "", false)}`}>
        {m && (
          <div className="mt-3 rounded-md border border-dashed border-border p-2 text-[11px]">
            <div className="flex items-center justify-between">
              <span className="font-medium">Milestone {formatDateOnly(m.date, "", false)}</span>
              <KindLabel kind="target" />
            </div>
            <p className="mt-0.5 text-muted-foreground">
              Operating {m.operatingPaid} (<RatioText ratio={m.operatingProgress} />) · stretch {m.stretchPaid} (<RatioText ratio={m.stretchProgress} />)
            </p>
          </div>
        )}
      </GoalCard>
      <GoalCard title="New paying vs stretch goal" goal={data.newPaying.stretch} hint={`${data.newPaying.selectedDay} on ${formatDateOnly(data.date, "", false)}`} />
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium text-muted-foreground">Active MRR</p>
          <KindLabel kind="actual" />
        </div>
        <p className="mt-1 text-2xl font-semibold tabular-nums">{formatPaise(data.revenue.activeMrrPaise)}</p>
        <Meter value={data.revenue.stretchMrr.progress.value} className="mt-2" />
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          {data.revenue.activeSubscriptions} active · stretch {formatPaise(data.revenue.stretchMrr.target)} (<RatioText ratio={data.revenue.stretchMrr.progress} />)
        </p>
        {data.revenue.overdueSubscriptions > 0 && (
          <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
            {formatPaise(data.revenue.overdueMrrPaise)} from {data.revenue.overdueSubscriptions} overdue renewal(s) — still in MRR
          </p>
        )}
      </div>
    </div>
  );
}

function CashCard({ data }: { data: TodayView }) {
  const c = data.revenue.cashCollected;
  const row = (label: string, t: typeof c.sprintToDate) => (
    <div className="flex items-baseline justify-between gap-2 border-b border-border py-2 last:border-0">
      <span className="text-sm">{label}</span>
      <span className="text-right">
        <span className="block font-semibold tabular-nums">{formatPaise(t.feePaise)}</span>
        <span className="block text-[11px] text-muted-foreground">+ {formatPaise(t.taxPaise)} GST = {formatPaise(t.totalPaise)}</span>
      </span>
    </div>
  );
  return (
    <SectionCard title="Cash collected" description="Verified payments only; fee and GST kept separate. Not the same as MRR." actions={<KindLabel kind="actual" />}>
      {row("Sprint to date", c.sprintToDate)}
      {row(formatDateOnly(data.date), c.selectedDay)}
    </SectionCard>
  );
}

function NextActionHealth({ data }: { data: TodayView }) {
  const { missing, overdue, rule } = data.nextActions;
  const owner = data.ownerId ? `&ownerId=${data.ownerId}` : "";
  return (
    <SectionCard title="Next actions" description={rule}>
      <div className="grid grid-cols-2 gap-3">
        <Link href={`/sales/pipeline?overdue=1${owner}`} className="rounded-md border border-border p-3 hover:bg-muted">
          <p className={cn("text-2xl font-semibold tabular-nums", overdue > 0 && "text-red-500")}>{overdue}</p>
          <p className="text-[11px] text-muted-foreground">Overdue</p>
        </Link>
        <Link href={`/sales/pipeline?missing=1${owner}`} className="rounded-md border border-border p-3 hover:bg-muted">
          <p className={cn("text-2xl font-semibold tabular-nums", missing > 0 && "text-amber-600 dark:text-amber-400")}>{missing}</p>
          <p className="text-[11px] text-muted-foreground">Missing or undated</p>
        </Link>
      </div>
    </SectionCard>
  );
}

export default function TodayPage() {
  const { scope } = useSalesPrefs();
  const [date, setDate] = useState(todayIST());
  const [ownerId, setOwnerId] = useState<number | null>(null);
  const filterOwner = scope === "team" ? ownerId ?? undefined : undefined;
  const today = useToday({ date, scope, ownerId: filterOwner });
  const qa = useQuickActions();
  const names = useTeamNames();
  const isToday = date === todayIST();

  return (
    <div className="space-y-5">
      <SalesPageHeader
        title="Today"
        subtitle={`${formatDateOnly(date)} · ${scope === "team" ? (filterOwner ? names(filterOwner) : "Team view") : "My work"}`}
        actions={
          <div className="flex flex-wrap items-center gap-1">
            {scope === "team" && (
              <OwnerSelect value={ownerId} onChange={setOwnerId} allowUnassigned={false} placeholder="Whole team" className="w-40" aria-label="Show work for owner" />
            )}
            {scope === "team" && ownerId != null && (
              <Button variant="ghost" size="sm" className={touch} onClick={() => setOwnerId(null)}>
                Whole team
              </Button>
            )}
            <Button variant="outline" size="icon" className="h-11 w-11 md:h-9 md:w-9" onClick={() => setDate(addDaysToDate(date, -1))} aria-label="Previous day">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className={cn("w-40", touch)} aria-label="Date" />
            <Button variant="outline" size="icon" className="h-11 w-11 md:h-9 md:w-9" onClick={() => setDate(addDaysToDate(date, 1))} aria-label="Next day">
              <ChevronRight className="h-4 w-4" />
            </Button>
            {!isToday && (
              <Button variant="ghost" size="sm" className={touch} onClick={() => setDate(todayIST())}>
                Today
              </Button>
            )}
          </div>
        }
      />

      <div className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1 [scrollbar-width:none] md:mx-0 md:flex-wrap md:px-0">
        {QUICK_ACTIONS.map((a) => (
          <Button key={a.kind} variant={a.kind === "visit" ? "default" : "outline"} className={cn("shrink-0", touch)} onClick={() => qa.open(a.kind)}>
            {a.label}
          </Button>
        ))}
      </div>

      {today.isLoading && <LoadingBlock rows={6} />}
      {today.error && <ErrorBlock error={today.error} onRetry={() => today.refetch()} />}
      {today.data && <TodayBody data={today.data} names={names} />}
    </div>
  );
}

function TodayBody({ data, names }: { data: TodayView; names: (id: number | null | undefined) => string }) {
  const { user } = useSalesPrefs();
  const assign = useAssignOwner();
  const toast = useSalesToast();
  const a = data.activity;
  const pilots = data.activePilots;

  return (
    <>
      <SprintStatus data={data} />

      <div className="grid gap-4 lg:grid-cols-3">
        <SectionCard
          className="lg:col-span-2"
          title="Field activity vs targets"
          description={a.isReviewDay ? "Review day — no selling targets." : a.dayType ? `${humanize(a.dayType)} day` : undefined}
          actions={<Pill tone="muted">actual vs target</Pill>}
        >
          {a.isReviewDay && <p className="mb-3 rounded-md bg-muted p-2 text-xs">Sunday review: look back at the week, update targets and pilot reviews.</p>}
          <div className="grid gap-4 sm:grid-cols-2">
            <TargetRow label="Visits" actual={a.actual.visits} target={a.target?.visits ?? null} ratio={a.progress.visits} extra={` · ${a.actual.firstVisits} first visit(s), ${a.actual.visits - a.actual.firstVisits} revisit(s)`} />
            <TargetRow label="Buyer conversations" actual={a.actual.conversations} target={a.target?.conversations ?? null} ratio={a.progress.conversations} range={a.ranges.conversations} />
            <TargetRow label="Demos" actual={a.actual.demos} target={a.target?.demos ?? null} ratio={a.progress.demos} range={a.ranges.demos} />
            <TargetRow label="New pilots" actual={a.actual.pilots} target={a.target?.pilots ?? null} ratio={a.progress.pilots} />
          </div>
        </SectionCard>
        <div className="space-y-4">
          <SectionCard title="Active pilots" actions={pilots.atCapacity ? <Pill tone="warning">At capacity</Pill> : null}>
            <p className="text-2xl font-semibold tabular-nums">
              {pilots.teamCount}
              <span className="text-base font-normal text-muted-foreground"> / {pilots.capacity} capacity</span>
            </p>
            <Meter value={pilots.utilization.value} tone={pilots.atCapacity ? "warning" : "accent"} className="mt-2" />
            {data.scope === "mine" && <p className="mt-1.5 text-[11px] text-muted-foreground">{pilots.count} owned by you</p>}
            <Link href="/sales/pilots" className="mt-2 inline-block text-xs underline">
              View pilots
            </Link>
          </SectionCard>
          <NextActionHealth data={data} />
          <CashCard data={data} />
        </div>
      </div>

      <SectionCard title="Do next" description="Overdue follow-ups first, then today's appointments, then new enquiries waiting for a response.">
        {data.actions.length === 0 ? (
          <EmptyBlock title="Nothing urgent" description="No overdue tasks, appointments or waiting enquiries." />
        ) : (
          <ol className="divide-y divide-border">
            {data.actions.slice(0, 15).map((act, i) => (
              <li key={`${act.kind}-${act.taskId ?? act.activityId ?? act.pilotId ?? act.companyId}-${i}`} className="flex items-center gap-3 py-2.5">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold">{i + 1}</span>
                <span className="shrink-0">
                  {act.kind === "overdue_task" ? <AlertTriangle className="h-4 w-4 text-red-500" /> : act.kind === "appointment" ? <CalendarClock className="h-4 w-4 text-[hsl(var(--sales-accent))]" /> : <Inbox className="h-4 w-4 text-amber-500" />}
                </span>
                <div className="min-w-0 flex-1">
                  {act.companyId ? (
                    <Link href={act.pilotId && act.kind === "appointment" ? `/sales/pilots/${act.pilotId}` : `/sales/companies/${act.companyId}`} className="block truncate text-sm font-medium hover:underline">
                      {act.title}
                    </Link>
                  ) : (
                    <span className="block truncate text-sm font-medium">{act.title}</span>
                  )}
                  <span className="text-[11px] text-muted-foreground">
                    {act.kind === "overdue_task" && `Overdue ${formatMinutes(act.ageMinutes)}`}
                    {act.kind === "appointment" && `At ${formatTimeIST(act.at)}`}
                    {act.kind === "inbound_lead" && `Enquired ${formatRelative(act.at)}`}
                  </span>
                </div>
                {act.kind === "overdue_task" && act.taskId && (
                  <TaskActions task={data.overdueFollowUps.find((t) => t.id === act.taskId) ?? { id: act.taskId, title: act.title, dueAt: act.at, ownerId: null }} compact />
                )}
              </li>
            ))}
          </ol>
        )}
      </SectionCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title={`Overdue follow-ups (${data.overdueFollowUps.length})`}>
          {data.overdueFollowUps.length === 0 ? (
            <EmptyBlock title="No overdue follow-ups" />
          ) : (
            <ul className="divide-y divide-border">
              {data.overdueFollowUps.map((t) => (
                <li key={t.id} className="flex items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{t.title}</p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {t.companyId ? (
                        <Link href={`/sales/companies/${t.companyId}`} className="hover:underline">
                          {t.companyName}
                        </Link>
                      ) : (
                        "No company"
                      )}{" "}
                      · due {formatDateTimeIST(t.dueAt)} · <span className="text-red-500">{formatMinutes(t.overdueMinutes)} overdue</span> · {names(t.ownerId)}
                    </p>
                  </div>
                  <TaskActions task={t} compact />
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard title={`Today's appointments (${data.todaysAppointments.length})`}>
          {data.todaysAppointments.length === 0 ? (
            <EmptyBlock title="No appointments today" />
          ) : (
            <ul className="divide-y divide-border">
              {data.todaysAppointments.map((ap, i) => (
                <li key={`${ap.kind}-${ap.activityId ?? ap.pilotId}-${i}`} className="flex items-center gap-3 py-2.5">
                  <span className="w-16 shrink-0 text-sm font-semibold tabular-nums">{formatTimeIST(ap.at)}</span>
                  <div className="min-w-0 flex-1">
                    <Link href={ap.pilotId ? `/sales/pilots/${ap.pilotId}` : `/sales/companies/${ap.companyId}`} className="block truncate text-sm font-medium hover:underline">
                      {ap.companyName}
                    </Link>
                    <p className="text-[11px] text-muted-foreground">
                      {humanize(ap.kind)} · {names(ap.ownerId)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard title={`Unassigned inbound (${data.unassignedInbound.length})`} description="New enquiries with no owner and no activity yet. Response target counts business minutes only.">
          {data.unassignedInbound.length === 0 ? (
            <EmptyBlock title="No waiting enquiries" />
          ) : (
            <ul className="divide-y divide-border">
              {data.unassignedInbound.map((l) => (
                <li key={l.id} className="flex items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <Link href={`/sales/companies/${l.id}`} className="block truncate text-sm font-medium hover:underline">
                      {l.name}
                    </Link>
                    <p className="flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
                      <span>{[l.source, l.sourceCampaign, l.city].filter(Boolean).join(" · ") || "—"}</span>
                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-3 w-3" /> {formatMinutes(l.ageMinutes)} since enquiry ({formatMinutes(l.businessAgeMinutes)} business)
                      </span>
                    </p>
                  </div>
                  {l.breachedResponseTarget ? <Pill tone="danger">Breached</Pill> : <Pill tone="warning">Due {formatTimeIST(l.responseDueAt)}</Pill>}
                  <Button
                    size="sm"
                    variant="outline"
                    className="min-h-11 md:min-h-8"
                    disabled={assign.isPending}
                    onClick={() => assign.mutate({ id: l.id, ownerId: user.id }, { onSuccess: () => toast.success(`${l.name} assigned to you`), onError: (e) => toast.error(e) })}
                  >
                    Claim
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard title={`Upcoming renewals (${data.upcomingRenewals.length})`} description="Next 14 days.">
          {data.upcomingRenewals.length === 0 ? (
            <EmptyBlock title="No renewals in the next 14 days" />
          ) : (
            <ul className="divide-y divide-border">
              {data.upcomingRenewals.map((r) => (
                <li key={r.subscriptionId} className="flex items-center gap-3 py-2.5">
                  <RefreshCcw className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <Link href={`/sales/companies/${r.companyId}`} className="block truncate text-sm font-medium hover:underline">
                      {r.companyName}
                    </Link>
                    <p className="text-[11px] text-muted-foreground">
                      {formatDateOnly(r.renewalDate)} · {names(r.customerOwnerId)}
                    </p>
                  </div>
                  <span className="text-sm font-medium tabular-nums">{formatPaise(r.monthlyFeePaise)}</span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>
      <p className="text-[11px] text-muted-foreground">{data.revenue.mrrRule} Counts: {formatCount(data.newPaying.sprintToDate)} new paying in sprint to date.</p>
    </>
  );
}
