/**
 * Connections → Bookings calendar — plain-language setup wizard.
 * Creates calendar + Google link + bookable meeting without "event type" jargon.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getListCalendarsQueryKey,
  getListEventTypesQueryKey,
  useListCalendars,
  useListEventTypes,
} from "@workspace/api-client-react";
import { StripePage } from "@/components/stripe-page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import {
  computeBookingSetupReadiness,
  createMeeting,
  createOrUpdateCalendar,
  defaultWeeklyAvailability,
  getBrowserTimezone,
  linkGoogleToCalendar,
  listCalendarAvailability,
  listGoogleConnections,
  mergeWeeklyAvailability,
  replaceCalendarAvailability,
  MEETING_DURATION_OPTIONS,
  CALENDAR_TIMEZONES,
  WEEKDAY_SHORT,
  openGoogleConnectPopup,
  slugifyMeetingName,
  type MeetingInfo,
  type SchedulingCalendarInfo,
  type WeeklyAvailabilitySlot,
} from "@/lib/scheduling-setup";
import {
  Check,
  CheckCircle2,
  Globe,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type WizardStepId = "calendar" | "google" | "meeting";

/** One control height / radius / label scale across every panel on this page. */
const FIELD_LABEL = "text-[11.5px] font-medium text-foreground";
const FIELD_HINT = "text-[11px] leading-relaxed text-muted-foreground";
const FIELD_CONTROL = "h-10 w-full rounded-xl text-[13px]";
const TIME_INPUT =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-background px-2 text-[11.5px] tabular-nums text-foreground transition-colors focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-40";

const STEPS: { id: WizardStepId; title: string; blurb: string }[] = [
  {
    id: "calendar",
    title: "Your calendar",
    blurb: "Name, timezone, hosts, and weekly hours.",
  },
  {
    id: "google",
    title: "Connect Google (bookings)",
    blurb: "Bookings appear on Google Calendar with a Meet link on the invite.",
  },
  {
    id: "meeting",
    title: "What can callers book?",
    blurb: "Name and length. Meet link is included on every invite by default.",
  },
];

function mapCalFromQuery(c: {
  id: number;
  name: string;
  description?: string | null;
  hostEmail?: string | null;
  additionalHosts?: string[] | null;
  connectedGoogleEmail?: string | null;
  timezone?: string;
}): SchedulingCalendarInfo {
  return {
    id: c.id,
    name: c.name,
    description: c.description ?? null,
    hostEmail: c.hostEmail ?? null,
    additionalHosts: c.additionalHosts ?? null,
    connectedGoogleEmail: c.connectedGoogleEmail ?? null,
    timezone: c.timezone || "UTC",
  };
}

function mapMeetingFromQuery(e: {
  id: number;
  calendarId: number;
  name?: string;
  title?: string;
  slug: string;
  durationMinutes: number;
}): MeetingInfo {
  return {
    id: e.id,
    calendarId: e.calendarId,
    name: e.name || e.title || "Meeting",
    slug: e.slug,
    durationMinutes: e.durationMinutes,
  };
}

function CalendarShell({
  embedded,
  backHref,
  backLabel,
  children,
}: {
  embedded: boolean;
  backHref: string;
  backLabel: string;
  children: ReactNode;
}) {
  if (embedded) return <div className="space-y-4">{children}</div>;
  return (
    <StripePage
      title="Bookings calendar"
      description="Keep calendar, Google Meet, and the meeting type on this page — nothing is hidden in an accordion."
      back={{ href: backHref, label: backLabel }}
      actions={
        <Button asChild size="sm" className="h-9">
          <Link href={`${BASE}/app/scheduling`}>Open Bookings</Link>
        </Button>
      }
    >
      {children}
    </StripePage>
  );
}

function SetupCard({
  step,
  title,
  blurb,
  done,
  locked,
  children,
}: {
  step: number;
  title: string;
  blurb: string;
  done: boolean;
  locked?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="flex min-h-[320px] max-h-[min(80vh,720px)] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <header className="flex items-start gap-3 border-b border-border/70 px-5 py-4">
        <span
          className={cn(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11.5px] font-semibold tabular-nums ring-1",
            done
              ? "bg-emerald-500/10 text-emerald-600 ring-emerald-500/30 dark:text-emerald-400"
              : "bg-muted text-muted-foreground ring-border",
          )}
        >
          {done ? <Check className="h-3.5 w-3.5" /> : step}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-semibold leading-5 tracking-[-0.01em] text-foreground">
            {title}
          </p>
          <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">{blurb}</p>
        </div>
      </header>
      <div className="relative min-h-0 flex-1">
        <div className="h-full overflow-y-auto px-5 py-4">
          {locked ? (
            <p className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-[12.5px] text-muted-foreground">
              Save a calendar on the left first.
            </p>
          ) : (
            children
          )}
        </div>
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-card to-transparent"
        />
      </div>
    </section>
  );
}

export function ConnectionsCalendarSetup({
  backHref = "/app/connections",
  backLabel = "Connections",
  embedded = false,
}: {
  backHref?: string;
  backLabel?: string;
  /** Render inside Agent Builder without the Connections page chrome. */
  embedded?: boolean;
} = {}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const calendarsQ = useListCalendars();
  const eventTypesQ = useListEventTypes();

  const calendars = useMemo(
    () => (Array.isArray(calendarsQ.data) ? calendarsQ.data.map(mapCalFromQuery) : []),
    [calendarsQ.data],
  );
  const meetings = useMemo(
    () => (Array.isArray(eventTypesQ.data) ? eventTypesQ.data.map(mapMeetingFromQuery) : []),
    [eventTypesQ.data],
  );

  const [userWantsNew, setUserWantsNew] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  useEffect(() => {
    if (userWantsNew) return;
    if (calendars.length === 0) {
      setSelectedId(null);
      return;
    }
    if (selectedId == null || !calendars.some((c) => c.id === selectedId)) {
      setSelectedId(calendars[0]!.id);
    }
  }, [calendars, selectedId, userWantsNew]);

  const composingNew = userWantsNew || calendars.length === 0;

  const readiness = computeBookingSetupReadiness(
    calendars,
    meetings,
    composingNew ? null : selectedId,
  );
  const { calendar, meeting, requiredReadyCount, ready } = readiness;
  const doneFlags: Record<WizardStepId, boolean> = {
    calendar: Boolean(calendar),
    google: readiness.googleLinked,
    meeting: Boolean(meeting),
  };

  const refresh = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getListCalendarsQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getListEventTypesQueryKey() }),
      calendarsQ.refetch(),
      eventTypesQ.refetch(),
    ]);
  }, [queryClient, calendarsQ, eventTypesQ]);

  const loading = calendarsQ.isLoading || eventTypesQ.isLoading;

  if (loading) {
    return (
      <CalendarShell embedded={embedded} backHref={backHref} backLabel={backLabel}>
        <div className="flex items-center gap-2 rounded-2xl border border-border bg-card px-4 py-5 text-[13px] text-muted-foreground shadow-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> Checking your setup…
        </div>
      </CalendarShell>
    );
  }

  return (
    <CalendarShell embedded={embedded} backHref={backHref} backLabel={backLabel}>
      <div className="space-y-5">
        <div
          className={cn(
            "flex items-start gap-3 rounded-2xl border px-4 py-3.5 sm:px-5",
            ready
              ? "border-emerald-500/30 bg-emerald-500/[0.07]"
              : "border-border bg-muted/25",
          )}
        >
          <span
            className={cn(
              "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
              ready
                ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                : "bg-background text-muted-foreground ring-1 ring-border",
            )}
          >
            {ready ? (
              <CheckCircle2 className="h-3.5 w-3.5" />
            ) : (
              <span className="text-[10.5px] font-semibold tabular-nums">{requiredReadyCount}</span>
            )}
          </span>
          <div className="min-w-0 flex-1">
            <p
              className={cn(
                "text-[13.5px] font-semibold leading-5 tracking-[-0.01em]",
                ready ? "text-emerald-700 dark:text-emerald-400" : "text-foreground",
              )}
            >
              {ready ? "Ready — you can still change anything below" : `${requiredReadyCount} of 3 set up`}
            </p>
            <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
              {embedded
                ? "Save the agent after you pick this calendar on Actions → Bookings."
                : "Agent → Actions → Bookings → pick this calendar. Appointments show under Bookings."}
            </p>
          </div>
          <div aria-hidden className="hidden shrink-0 items-center gap-1 pt-1.5 sm:flex">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className={cn(
                  "h-1 w-6 rounded-full",
                  i < requiredReadyCount
                    ? ready
                      ? "bg-emerald-500"
                      : "bg-foreground/70"
                    : "bg-border",
                )}
              />
            ))}
          </div>
        </div>

        {calendars.length > 0 ? (
          <div className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5">
            <Label className={FIELD_LABEL}>Which calendar</Label>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
              <Select
                value={composingNew ? "__new__" : selectedId != null ? String(selectedId) : undefined}
                onValueChange={(value) => {
                  if (value === "__new__") {
                    setUserWantsNew(true);
                    setSelectedId(null);
                    return;
                  }
                  setUserWantsNew(false);
                  setSelectedId(Number(value));
                }}
              >
                <SelectTrigger className="h-10 min-w-0 flex-1 rounded-xl">
                  <SelectValue placeholder="Select a calendar" />
                </SelectTrigger>
                <SelectContent>
                  {calendars.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.name}
                    </SelectItem>
                  ))}
                  <SelectItem value="__new__">Create new calendar</SelectItem>
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-10 w-full shrink-0 gap-1.5 rounded-xl text-[13px] sm:w-auto"
                onClick={() => {
                  setUserWantsNew(true);
                  setSelectedId(null);
                }}
              >
                <Plus className="h-3.5 w-3.5" /> New calendar
              </Button>
            </div>
            <p className="mt-2 text-[11.5px] leading-relaxed text-muted-foreground">
              {calendars.length === 1
                ? "You already have a calendar. Open it here, or create another."
                : `${calendars.length} calendars in this workspace. Google and meeting setup follow the one you pick.`}
            </p>
          </div>
        ) : null}

        <div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
          <SetupCard step={1} title={STEPS[0]!.title} blurb={STEPS[0]!.blurb} done={doneFlags.calendar}>
            <CalendarPanel
              key={calendar?.id ?? "new"}
              existing={calendar}
              onDone={async (saved) => {
                await refresh();
                if (saved) {
                  setUserWantsNew(false);
                  setSelectedId(saved.id);
                }
              }}
            />
          </SetupCard>
          <SetupCard
            step={2}
            title={STEPS[1]!.title}
            blurb={STEPS[1]!.blurb}
            done={doneFlags.google}
            locked={!calendar}
          >
            {calendar ? (
              <GooglePanel
                calendarId={calendar.id}
                linkedEmail={calendar.connectedGoogleEmail}
                onDone={refresh}
              />
            ) : null}
          </SetupCard>
          <SetupCard
            step={3}
            title={STEPS[2]!.title}
            blurb={STEPS[2]!.blurb}
            done={doneFlags.meeting}
            locked={!calendar}
          >
            {calendar ? (
              <MeetingPanel
                calendarId={calendar.id}
                existing={meeting}
                onDone={async () => {
                  await refresh();
                  toast({
                    title: "Meeting saved",
                    description: embedded
                      ? "Pick this calendar on the agent Bookings toggle, then save."
                      : "Turn on Bookings on the agent and pick this calendar.",
                  });
                }}
              />
            ) : null}
          </SetupCard>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
          <Button asChild size="sm" variant="outline" className="h-9 rounded-lg px-3.5 text-[13px]">
            <Link href={`${BASE}/app/scheduling/availability`}>Hours</Link>
          </Button>
          <Button asChild size="sm" variant="ghost" className="h-9 rounded-lg px-3 text-[13px] text-muted-foreground">
            <Link href={`${BASE}/app/scheduling/event-types`}>All meetings</Link>
          </Button>
          <Button asChild size="sm" variant="ghost" className="h-9 rounded-lg px-3 text-[13px] text-muted-foreground">
            <Link href={`${BASE}/app/scheduling/calendars`}>All calendars</Link>
          </Button>
        </div>
      </div>
    </CalendarShell>
  );
}

// ── Step panels ───────────────────────────────────────────────────────────────

function CalendarPanel({
  existing,
  onDone,
}: {
  existing: SchedulingCalendarInfo | null;
  onDone: (saved: SchedulingCalendarInfo) => Promise<void>;
}) {
  const { toast } = useToast();
  const [name, setName] = useState(existing?.name ?? "My Calendar");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [timezone, setTimezone] = useState(existing?.timezone || getBrowserTimezone() || "Asia/Kolkata");
  const [hostEmail, setHostEmail] = useState(existing?.hostEmail ?? "");
  const [additionalHosts, setAdditionalHosts] = useState<string[]>(existing?.additionalHosts?.length ? [...existing.additionalHosts] : []);
  const [slots, setSlots] = useState<WeeklyAvailabilitySlot[]>(() => defaultWeeklyAvailability());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!existing?.id) {
      setSlots(defaultWeeklyAvailability());
      return;
    }
    let cancelled = false;
    void listCalendarAvailability(existing.id)
      .then((rows) => {
        if (!cancelled) setSlots(mergeWeeklyAvailability(rows));
      })
      .catch(() => {
        if (!cancelled) setSlots(defaultWeeklyAvailability());
      });
    return () => {
      cancelled = true;
    };
  }, [existing?.id]);

  const tzOptions = CALENDAR_TIMEZONES.includes(timezone as (typeof CALENDAR_TIMEZONES)[number])
    ? CALENDAR_TIMEZONES
    : [timezone, ...CALENDAR_TIMEZONES];

  async function handleSave() {
    if (!name.trim()) {
      toast({ title: "Give your calendar a name", variant: "destructive" });
      return;
    }
    if (!hostEmail.trim() || !hostEmail.includes("@")) {
      toast({ title: "Enter the host / organizer email", variant: "destructive" });
      return;
    }
    const invalid = slots.find((s) => s.isActive && s.startTime >= s.endTime);
    if (invalid) {
      toast({
        title: `End time must be after start on ${WEEKDAY_SHORT[invalid.dayOfWeek]}`,
        variant: "destructive",
      });
      return;
    }
    if (!slots.some((s) => s.isActive)) {
      toast({ title: "Turn on at least one day for bookings", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const saved = await createOrUpdateCalendar({
        id: existing?.id,
        name,
        description,
        timezone,
        hostEmail,
        additionalHosts,
      });
      await replaceCalendarAvailability(saved.id, slots);
      await onDone(saved);
    } catch (e: unknown) {
      toast({
        title: "Couldn’t save calendar",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label className={FIELD_LABEL}>Calendar name *</Label>
        <Input
          className={FIELD_CONTROL}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Clinic bookings"
        />
      </div>
      <div className="space-y-1.5">
        <Label className={FIELD_LABEL}>Description</Label>
        <Input
          className={FIELD_CONTROL}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="e.g. Handles inbound demo booking requests"
        />
        <p className={FIELD_HINT}>Optional. Shown on the calendar card.</p>
      </div>
      <div className="space-y-1.5">
        <Label className={FIELD_LABEL}>Timezone *</Label>
        <Select value={timezone} onValueChange={setTimezone}>
          <SelectTrigger className={FIELD_CONTROL}>
            <Globe className="mr-2 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-64">
            {tzOptions.map((tz) => (
              <SelectItem key={tz} value={tz}>{tz.replace(/_/g, " ")}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className={FIELD_HINT}>Slots and availability use this timezone.</p>
      </div>
      <div className="space-y-1.5">
        <Label className={FIELD_LABEL}>Host / organizer email *</Label>
        <Input
          className={FIELD_CONTROL}
          type="email"
          value={hostEmail}
          onChange={(e) => setHostEmail(e.target.value)}
          placeholder="you@company.com"
        />
        <p className={FIELD_HINT}>
          Organizer on Google invites. Use the same Google account you connect next.
        </p>
      </div>
      <div className="space-y-1.5">
        <Label className={FIELD_LABEL}>Additional hosts</Label>
        <div className="space-y-2">
          {additionalHosts.map((host, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input
                className={FIELD_CONTROL}
                type="email"
                value={host}
                onChange={(e) => {
                  const next = [...additionalHosts];
                  next[i] = e.target.value;
                  setAdditionalHosts(next);
                }}
                placeholder="cohost@example.com"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-10 w-10 shrink-0 rounded-xl text-muted-foreground hover:text-destructive"
                onClick={() => setAdditionalHosts(additionalHosts.filter((_, j) => j !== i))}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 gap-1.5 rounded-lg text-[12px]"
            onClick={() => setAdditionalHosts([...additionalHosts, ""])}
          >
            <Plus className="h-3.5 w-3.5" /> Add host
          </Button>
        </div>
        <p className={FIELD_HINT}>Extra people get the Meet link on every booking.</p>
      </div>
      <div className="space-y-2.5 border-t border-border pt-4">
        <div>
          <p className="text-[12.5px] font-semibold text-foreground">Weekly hours</p>
          <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
            Days and times callers can book. Uses the timezone above.
          </p>
        </div>
        <div className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border">
          {slots.map((slot) => (
            <div
              key={slot.dayOfWeek}
              className={cn(
                "grid grid-cols-[auto_2rem_1fr_auto_1fr] items-center gap-2 px-2.5 py-1.5 transition-colors",
                slot.isActive ? "bg-background" : "bg-muted/30",
              )}
            >
              <Switch
                checked={slot.isActive}
                onCheckedChange={() =>
                  setSlots((prev) =>
                    prev.map((s) =>
                      s.dayOfWeek === slot.dayOfWeek ? { ...s, isActive: !s.isActive } : s,
                    ),
                  )
                }
                className="scale-75 origin-left"
              />
              <span
                className={cn(
                  "text-[11.5px] font-medium",
                  slot.isActive ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {WEEKDAY_SHORT[slot.dayOfWeek]}
              </span>
              <input
                type="time"
                value={slot.startTime}
                disabled={!slot.isActive}
                onChange={(e) =>
                  setSlots((prev) =>
                    prev.map((s) =>
                      s.dayOfWeek === slot.dayOfWeek ? { ...s, startTime: e.target.value } : s,
                    ),
                  )
                }
                className={TIME_INPUT}
              />
              <span className="text-[11px] text-muted-foreground">–</span>
              <input
                type="time"
                value={slot.endTime}
                disabled={!slot.isActive}
                onChange={(e) =>
                  setSlots((prev) =>
                    prev.map((s) =>
                      s.dayOfWeek === slot.dayOfWeek ? { ...s, endTime: e.target.value } : s,
                    ),
                  )
                }
                className={TIME_INPUT}
              />
            </div>
          ))}
        </div>
      </div>
      <Button
        className="h-10 w-full rounded-xl"
        disabled={saving}
        onClick={() => void handleSave()}
      >
        {saving ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin mr-2" /> Saving…
          </>
        ) : existing ? (
          "Save calendar"
        ) : (
          "Create calendar"
        )}
      </Button>
    </div>
  );
}

function GooglePanel({
  calendarId,
  linkedEmail,
  onDone,
}: {
  calendarId: number;
  linkedEmail: string | null;
  onDone: () => Promise<void>;
}) {
  const { toast } = useToast();
  const googleQ = useQuery({
    queryKey: ["scheduling-google-connections"],
    queryFn: () => listGoogleConnections(),
    staleTime: 15_000,
  });
  const [linking, setLinking] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    let ch: BroadcastChannel | null = null;
    try {
      ch = new BroadcastChannel("google-oauth");
      ch.onmessage = (e: MessageEvent<{ type: string }>) => {
        if (e.data?.type === "connected") {
          setConnecting(false);
          void googleQ.refetch();
        }
      };
    } catch {
      /* BroadcastChannel unavailable */
    }
    return () => {
      try {
        ch?.close();
      } catch {
        /* ignore */
      }
    };
  }, [googleQ]);

  async function handleAddAccount() {
    setConnecting(true);
    try {
      await openGoogleConnectPopup();
    } catch {
      toast({ title: "Couldn’t start Google sign-in", variant: "destructive" });
      setConnecting(false);
    }
  }

  async function handleSelect(connectionId: string) {
    setLinking(connectionId);
    try {
      await linkGoogleToCalendar(calendarId, connectionId);
      await onDone();
    } catch {
      toast({ title: "Couldn’t link Google account", variant: "destructive" });
    } finally {
      setLinking(null);
    }
  }

  if (linkedEmail) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/25 px-3 py-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-background text-[12px] font-semibold ring-1 ring-border">
            {linkedEmail[0]?.toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium text-foreground">{linkedEmail}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">Connected</p>
          </div>
        </div>
        <p className={FIELD_HINT}>Each booking gets a Google Meet link on the invite.</p>
        <Button
          variant="outline"
          size="sm"
          className="h-9 gap-1.5 rounded-lg text-[12.5px]"
          disabled={connecting}
          onClick={() => void handleAddAccount()}
        >
          {connecting ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" /> Opening Google…
            </>
          ) : (
            <>
              <Plus className="h-3 w-3" /> Use a different Google account
            </>
          )}
        </Button>
      </div>
    );
  }

  if (googleQ.isLoading) {
    return (
      <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading Google accounts…
      </div>
    );
  }

  const connections = googleQ.data ?? [];

  return (
    <div className="space-y-4">
      <p className="text-[12px] leading-relaxed text-muted-foreground">
        Connect the Google account that matches your booking email. Callers get a Meet link and events land on your calendar.
      </p>

      {connections.length > 0 ? (
        <div className="space-y-2">
          {connections.map((conn) => (
            <div
              key={conn.id}
              className="flex items-center gap-3 rounded-xl border border-border bg-background px-3 py-2.5"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-[12px] font-semibold">
                {conn.email[0]?.toUpperCase()}
              </span>
              <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">{conn.email}</span>
              <Button
                size="sm"
                className="h-8 shrink-0 rounded-lg px-3 text-[12px]"
                disabled={linking !== null}
                onClick={() => void handleSelect(conn.id)}
              >
                {linking === conn.id ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin mr-1.5" /> Linking…
                  </>
                ) : (
                  "Use this"
                )}
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-[12.5px] text-muted-foreground">
          No Google account connected yet.
        </div>
      )}

      <Button
        variant="outline"
        size="sm"
        className="h-9 gap-1.5 rounded-lg text-[12.5px]"
        disabled={connecting}
        onClick={() => void handleAddAccount()}
      >
        {connecting ? (
          <>
            <Loader2 className="h-3 w-3 animate-spin" /> Opening Google…
          </>
        ) : (
          <>
            <Plus className="h-3 w-3" /> Add Google account
          </>
        )}
      </Button>
    </div>
  );
}

function MeetingPanel({
  calendarId,
  existing,
  onDone,
}: {
  calendarId: number;
  existing: MeetingInfo | null;
  onDone: () => Promise<void>;
}) {
  const { toast } = useToast();
  const [name, setName] = useState(existing?.name ?? "");
  const [duration, setDuration] = useState(existing?.durationMinutes ?? 30);
  const [saving, setSaving] = useState(false);
  const slug = slugifyMeetingName(name);

  async function handleSave() {
    if (existing) {
      await onDone();
      return;
    }
    if (!name.trim()) {
      toast({ title: "Give the meeting a name", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await createMeeting({ calendarId, name, durationMinutes: duration });
      await onDone();
    } catch (e: unknown) {
      toast({
        title: "Couldn’t create meeting",
        description:
          e instanceof Error
            ? e.message
            : "Try a slightly different name if that one is already used.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  if (existing) {
    return (
      <div className="space-y-3">
        <div className="rounded-xl border border-border bg-muted/25 px-3 py-2.5">
          <p className="flex items-baseline gap-1.5 text-[13px] text-foreground">
            <span className="min-w-0 truncate font-medium">{existing.name}</span>
            <span className="shrink-0 text-muted-foreground">· {existing.durationMinutes} min</span>
          </p>
          <p className="mt-1 truncate text-[11px] text-muted-foreground">
            Public link: <span className="font-mono">/book/{existing.slug}</span>
          </p>
        </div>
        <Button asChild variant="outline" size="sm" className="h-9 rounded-lg text-[12.5px]">
          <Link href={`${BASE}/app/scheduling/event-types/${existing.id}`}>Change name or length</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label className={FIELD_LABEL}>Meeting name</Label>
        <Input
          className={FIELD_CONTROL}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Consultation"
          autoFocus
        />
        {name.trim() && (
          <p className={FIELD_HINT}>
            Booking link: <span className="rounded bg-muted px-1 font-mono">/book/{slug}</span>
          </p>
        )}
      </div>
      <div className="space-y-1.5">
        <Label className={FIELD_LABEL}>How long?</Label>
        <Select value={String(duration)} onValueChange={(v) => setDuration(Number(v))}>
          <SelectTrigger className={FIELD_CONTROL}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MEETING_DURATION_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={String(o.value)}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button
        className="h-10 w-full rounded-xl"
        disabled={saving}
        onClick={() => void handleSave()}
      >
        {saving ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin mr-2" /> Creating…
          </>
        ) : (
          "Create meeting"
        )}
      </Button>
    </div>
  );
}
