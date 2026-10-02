import { useMemo, useState } from "react";
import { Link } from "wouter";
import { ChevronLeft, ChevronRight, Flag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { EmptyBlock, ErrorBlock, LoadingBlock, Pill, SalesPageHeader, touch, useTeamNames } from "@/components/sales/sales-ui";
import { useSalesPrefs } from "@/components/sales/sales-context";
import { useCalendar, useSalesSettings, useTargets } from "@/hooks/use-sales-api";
import { addDaysToDate, formatDateOnly, formatTimeIST, humanize, istDateString, isoWeekdayOf, todayIST } from "@/lib/sales-format";
import { CALENDAR_TYPES, type CalendarEvent, type CalendarType, type Target } from "@/lib/sales-types";

type View = "day" | "week" | "month";

const TYPE_LABEL: Record<CalendarType, string> = {
  activity: "Visits & meetings",
  pilot_review: "Pilot reviews",
  extension_review: "Extension reviews",
  task: "Tasks",
  renewal: "Renewals",
  target: "Daily targets",
};

const TYPE_DOT: Record<CalendarType, string> = {
  activity: "bg-[hsl(var(--sales-accent))]",
  pilot_review: "bg-emerald-500",
  extension_review: "bg-amber-500",
  task: "bg-zinc-400",
  renewal: "bg-violet-500",
  target: "bg-transparent",
};

/** Sprint milestones used only when no cumulative targets are stored on the server. */
const FALLBACK_MILESTONES = [
  { date: "2026-10-09", operatingPaid: 2, stretchPaid: 5 },
  { date: "2026-10-16", operatingPaid: 6, stretchPaid: 15 },
  { date: "2026-10-23", operatingPaid: 12, stretchPaid: 30 },
  { date: "2026-11-01", operatingPaid: 20, stretchPaid: 50 },
];

function rangeFor(view: View, anchor: string): { from: string; to: string } {
  if (view === "day") return { from: anchor, to: anchor };
  if (view === "week") {
    const from = addDaysToDate(anchor, 1 - isoWeekdayOf(anchor));
    return { from, to: addDaysToDate(from, 6) };
  }
  const first = `${anchor.slice(0, 8)}01`;
  const [y, m] = anchor.split("-").map(Number) as [number, number];
  const last = istDateString(new Date(Date.UTC(y, m, 0, 12)));
  const from = addDaysToDate(first, 1 - isoWeekdayOf(first));
  const to = addDaysToDate(last, 7 - isoWeekdayOf(last));
  return { from, to };
}

function shift(view: View, anchor: string, dir: 1 | -1): string {
  if (view === "day") return addDaysToDate(anchor, dir);
  if (view === "week") return addDaysToDate(anchor, 7 * dir);
  const [y, m] = anchor.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + dir, 1, 12));
  return istDateString(d);
}

function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDaysToDate(d, 1)) out.push(d);
  return out;
}

const eventDate = (e: CalendarEvent) => e.date ?? istDateString(e.start);

function eventHref(e: CalendarEvent): string | null {
  if (e.pilotId) return `/sales/pilots/${e.pilotId}`;
  if (e.companyId) return `/sales/companies/${e.companyId}`;
  return null;
}

export default function CalendarPage() {
  const { scope } = useSalesPrefs();
  const [view, setView] = useState<View>("week");
  const [anchor, setAnchor] = useState(todayIST());
  const [types, setTypes] = useState<CalendarType[]>([...CALENDAR_TYPES]);
  const range = rangeFor(view, anchor);
  const cal = useCalendar({ ...range, scope, types: types.join(",") });
  const milestonesQ = useTargets({ kind: "cumulative_paid" });
  const settings = useSalesSettings();
  const sundayIsReview = settings.data?.config.sundayIsReview ?? true;
  const today = todayIST();

  const milestones = useMemo(() => {
    const rows = (milestonesQ.data?.targets ?? []) as Target[];
    const list = rows.length ? rows.map((t) => ({ date: t.date, operatingPaid: t.operatingPaid, stretchPaid: t.stretchPaid })) : milestonesQ.data ? FALLBACK_MILESTONES : [];
    return new Map(list.map((m) => [m.date, m]));
  }, [milestonesQ.data]);

  const byDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of cal.data?.events ?? []) {
      const d = eventDate(e);
      (map.get(d) ?? map.set(d, []).get(d)!).push(e);
    }
    return map;
  }, [cal.data]);

  const days = daysBetween(range.from, range.to);
  const title =
    view === "day"
      ? formatDateOnly(anchor)
      : view === "week"
        ? `${formatDateOnly(range.from, "—", false)} – ${formatDateOnly(range.to, "—", false)}`
        : new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${anchor.slice(0, 8)}15T00:00:00Z`));

  return (
    <div className="space-y-4">
      <SalesPageHeader title="Calendar" subtitle="Visits, demos, pilot reviews, tasks, renewals and daily targets. Times in IST." />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" className="h-11 w-11 md:h-9 md:w-9" aria-label="Previous" onClick={() => setAnchor(shift(view, anchor, -1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" className={touch} onClick={() => setAnchor(today)}>
            Today
          </Button>
          <Button variant="outline" size="icon" className="h-11 w-11 md:h-9 md:w-9" aria-label="Next" onClick={() => setAnchor(shift(view, anchor, 1))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <span className="ml-2 text-sm font-medium">{title}</span>
        </div>
        <Tabs value={view} onValueChange={(v) => setView(v as View)}>
          <TabsList>
            <TabsTrigger value="day">Day</TabsTrigger>
            <TabsTrigger value="week">Week</TabsTrigger>
            <TabsTrigger value="month">Month</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {CALENDAR_TYPES.map((t) => (
          <label key={t} className="flex min-h-11 items-center gap-1.5 text-xs md:min-h-8">
            <Checkbox checked={types.includes(t)} onCheckedChange={(v) => setTypes(v === true ? [...types, t] : types.filter((x) => x !== t))} />
            <span className={cn("h-2 w-2 rounded-full", TYPE_DOT[t], t === "target" && "border border-muted-foreground")} />
            {TYPE_LABEL[t]}
          </label>
        ))}
      </div>

      {cal.isLoading && <LoadingBlock rows={6} />}
      {cal.error && <ErrorBlock error={cal.error} onRetry={() => cal.refetch()} />}
      {cal.data && (
        <>
          {view === "month" && (
            <div className="hidden md:block">
              <MonthGrid days={days} anchor={anchor} byDay={byDay} milestones={milestones} sundayIsReview={sundayIsReview} today={today} onPick={(d) => (setAnchor(d), setView("day"))} />
            </div>
          )}
          {view === "week" && (
            <div className="hidden gap-2 md:grid md:grid-cols-7">
              {days.map((d) => (
                <DayColumn key={d} day={d} events={byDay.get(d) ?? []} milestone={milestones.get(d)} sundayIsReview={sundayIsReview} today={today} onPick={() => (setAnchor(d), setView("day"))} />
              ))}
            </div>
          )}
          <div className={cn(view === "day" ? "" : "md:hidden")}>
            <Agenda days={view === "month" ? days.filter((d) => d.slice(0, 7) === anchor.slice(0, 7)) : days} byDay={byDay} milestones={milestones} sundayIsReview={sundayIsReview} today={today} />
          </div>
        </>
      )}
    </div>
  );
}

function DayMarkers({ day, events, milestone, sundayIsReview }: { day: string; events: CalendarEvent[]; milestone?: { operatingPaid: number; stretchPaid: number }; sundayIsReview: boolean }) {
  const target = events.find((e) => e.type === "target");
  const reviewDay = target ? target.status === "review" : sundayIsReview && isoWeekdayOf(day) === 7;
  return (
    <div className="flex flex-wrap gap-1">
      {reviewDay && <Pill tone="warning">Review day</Pill>}
      {target && target.status === "delivery" && <Pill tone="muted">Delivery day</Pill>}
      {milestone && (
        <Pill tone="accent" title="Cumulative new paying clients by this date">
          <Flag className="mr-0.5 h-3 w-3" />
          {milestone.operatingPaid} / {milestone.stretchPaid} paid
        </Pill>
      )}
    </div>
  );
}

function TargetLine({ e }: { e?: CalendarEvent }) {
  if (!e || e.status === "review") return null;
  const d = (e.details ?? {}) as { visits?: number; conversations?: number; demos?: number; pilots?: number };
  return (
    <p className="text-[10px] text-muted-foreground">
      Target {d.visits ?? 0}v · {d.conversations ?? 0}c · {d.demos ?? 0}d · {d.pilots ?? 0}p
    </p>
  );
}

function EventRow({ e, compact }: { e: CalendarEvent; compact?: boolean }) {
  const names = useTeamNames();
  const href = eventHref(e);
  const body = (
    <span className="flex min-w-0 items-start gap-1.5">
      <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", TYPE_DOT[e.type])} />
      <span className="min-w-0">
        <span className={cn("block", compact ? "truncate text-[11px]" : "text-sm")}>
          {!e.allDay && <span className="tabular-nums text-muted-foreground">{formatTimeIST(e.start)} </span>}
          {e.title}
        </span>
        {!compact && (
          <span className="block text-xs text-muted-foreground">
            {humanize(e.type)}
            {e.status ? ` · ${humanize(e.status)}` : ""}
            {e.ownerId ? ` · ${names(e.ownerId)}` : ""}
          </span>
        )}
      </span>
    </span>
  );
  return href ? (
    <Link href={href} className={cn("block rounded px-1 hover:bg-muted", !compact && "min-h-11 py-1.5 md:min-h-0")}>
      {body}
    </Link>
  ) : (
    <div className="px-1 py-0.5">{body}</div>
  );
}

function MonthGrid({
  days,
  anchor,
  byDay,
  milestones,
  sundayIsReview,
  today,
  onPick,
}: {
  days: string[];
  anchor: string;
  byDay: Map<string, CalendarEvent[]>;
  milestones: Map<string, { operatingPaid: number; stretchPaid: number }>;
  sundayIsReview: boolean;
  today: string;
  onPick: (d: string) => void;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <div className="grid grid-cols-7 border-b border-border bg-muted/40 text-center text-[11px] font-medium text-muted-foreground">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d} className="py-1.5">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((d) => {
          const events = byDay.get(d) ?? [];
          const visible = events.filter((e) => e.type !== "target");
          const inMonth = d.slice(0, 7) === anchor.slice(0, 7);
          return (
            <div key={d} className={cn("min-h-28 space-y-1 border-b border-r border-border p-1.5", !inMonth && "bg-muted/20 opacity-60")}>
              <button type="button" onClick={() => onPick(d)} className={cn("rounded px-1 text-xs font-medium hover:bg-muted", d === today && "bg-[hsl(var(--sales-accent))] text-white")}>
                {Number(d.slice(8))}
              </button>
              <DayMarkers day={d} events={events} milestone={milestones.get(d)} sundayIsReview={sundayIsReview} />
              <TargetLine e={events.find((e) => e.type === "target")} />
              {visible.slice(0, 3).map((e) => (
                <EventRow key={e.key} e={e} compact />
              ))}
              {visible.length > 3 && (
                <button type="button" className="px-1 text-[11px] text-muted-foreground hover:underline" onClick={() => onPick(d)}>
                  +{visible.length - 3} more
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DayColumn({
  day,
  events,
  milestone,
  sundayIsReview,
  today,
  onPick,
}: {
  day: string;
  events: CalendarEvent[];
  milestone?: { operatingPaid: number; stretchPaid: number };
  sundayIsReview: boolean;
  today: string;
  onPick: () => void;
}) {
  const visible = events.filter((e) => e.type !== "target");
  return (
    <div className={cn("min-h-64 space-y-1 rounded-lg border border-border bg-card p-2", day === today && "border-[hsl(var(--sales-accent))]")}>
      <button type="button" onClick={onPick} className="text-left text-xs font-medium hover:underline">
        {formatDateOnly(day, "—", true)}
      </button>
      <DayMarkers day={day} events={events} milestone={milestone} sundayIsReview={sundayIsReview} />
      <TargetLine e={events.find((e) => e.type === "target")} />
      {visible.length === 0 ? <p className="text-[11px] text-muted-foreground">—</p> : visible.map((e) => <EventRow key={e.key} e={e} compact />)}
    </div>
  );
}

function Agenda({
  days,
  byDay,
  milestones,
  sundayIsReview,
  today,
}: {
  days: string[];
  byDay: Map<string, CalendarEvent[]>;
  milestones: Map<string, { operatingPaid: number; stretchPaid: number }>;
  sundayIsReview: boolean;
  today: string;
}) {
  const withContent = days.filter((d) => (byDay.get(d) ?? []).length || milestones.has(d) || (sundayIsReview && isoWeekdayOf(d) === 7));
  if (withContent.length === 0) return <EmptyBlock title="Nothing scheduled" description="No events in this range for the selected types." />;
  return (
    <div className="space-y-3">
      {withContent.map((d) => {
        const events = byDay.get(d) ?? [];
        const visible = events.filter((e) => e.type !== "target");
        return (
          <section key={d} className={cn("rounded-lg border border-border bg-card p-3", d === today && "border-[hsl(var(--sales-accent))]")}>
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">
                {formatDateOnly(d)}
                {d === today && <span className="ml-1.5 text-xs font-normal text-[hsl(var(--sales-accent))]">Today</span>}
              </h3>
              <DayMarkers day={d} events={events} milestone={milestones.get(d)} sundayIsReview={sundayIsReview} />
            </div>
            <TargetLine e={events.find((e) => e.type === "target")} />
            {visible.length === 0 ? <p className="text-xs text-muted-foreground">No events.</p> : visible.map((e) => <EventRow key={e.key} e={e} />)}
          </section>
        );
      })}
    </div>
  );
}
