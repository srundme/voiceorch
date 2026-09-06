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
  Globe,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type WizardStepId = "calendar" | "google" | "meeting";

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
    title: "Create a meeting (with Google Meet)",
    blurb: "Give it a name and length. When a caller books, they get a Google Meet link on the calendar invite — you do not create that Meet URL yourself.",
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
    <section className="flex min-h-[320px] max-h-[min(80vh,720px)] flex-col rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="mb-4 flex items-start gap-2.5">
        <span
          className={cn(
            "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
            done
              ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
              : "bg-muted text-muted-foreground",
          )}
        >
          {done ? <Check className="h-3.5 w-3.5" /> : step}
        </span>
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-foreground">{title}</p>
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground">{blurb}</p>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pr-0.5">
        {locked ? (
          <p className="text-[13px] text-muted-foreground">Save a calendar on the left first.</p>
        ) : (
          children
        )}
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
  const { calendar, meeting } = readiness;
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
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
          <Loader2 className="h-4 w-4 animate-spin" /> Checking your setup…
        </div>
      </CalendarShell>
    );
  }

  return (
    <CalendarShell embedded={embedded} backHref={backHref} backLabel={backLabel}>
      <div className="space-y-6">
        {calendars.length > 0 ? (
          <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1 space-y-1.5">
              <Label className="text-xs font-medium">Which calendar</Label>
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
                <SelectTrigger className="h-9">
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
              <p className="text-[11px] text-muted-foreground">
                {calendars.length === 1
                  ? "You already have a calendar. Open it here, or create another."
                  : `${calendars.length} calendars in this workspace. Google and meeting setup follow the one you pick.`}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 shrink-0 gap-1.5"
              onClick={() => {
                setUserWantsNew(true);
                setSelectedId(null);
              }}
            >
              <Plus className="h-3.5 w-3.5" /> New calendar
            </Button>
          </div>
        ) : null}

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
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

        <div className="flex flex-wrap gap-2 border-t border-border pt-4">
          <Button asChild size="sm" variant="outline" className="h-9">
            <Link href={`${BASE}/app/scheduling/availability`}>Hours</Link>
          </Button>
          <Button asChild size="sm" variant="ghost" className="h-9 text-muted-foreground">
            <Link href={`${BASE}/app/scheduling/event-types`}>All meetings</Link>
          </Button>
          <Button asChild size="sm" variant="ghost" className="h-9 text-muted-foreground">
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
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label className="text-xs font-medium">Calendar name *</Label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Clinic bookings"
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs font-medium">Description</Label>
        <Input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="e.g. Handles inbound demo booking requests"
        />
        <p className="text-[11px] text-muted-foreground">Optional. Shown on the calendar card.</p>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs font-medium">Timezone *</Label>
        <Select value={timezone} onValueChange={setTimezone}>
          <SelectTrigger className="h-9">
            <Globe className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-64">
            {tzOptions.map((tz) => (
              <SelectItem key={tz} value={tz}>{tz.replace(/_/g, " ")}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-[11px] text-muted-foreground">Slots and availability use this timezone.</p>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs font-medium">Host / organizer email *</Label>
        <Input
          type="email"
          value={hostEmail}
          onChange={(e) => setHostEmail(e.target.value)}
          placeholder="you@company.com"
        />
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          Organizer on Google invites. Use the same Google account you connect next.
        </p>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs font-medium">Additional hosts</Label>
        <div className="space-y-2">
          {additionalHosts.map((host, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input
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
                className="h-9 w-9 shrink-0 text-muted-foreground hover:text-destructive"
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
            className="h-8 gap-1.5 text-[11px]"
            onClick={() => setAdditionalHosts([...additionalHosts, ""])}
          >
            <Plus className="h-3.5 w-3.5" /> Add host
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Extra people get the Meet link on every booking.
        </p>
      </div>
      <div className="space-y-2 border-t border-border pt-3">
        <p className="text-xs font-medium text-foreground">Weekly hours</p>
        <p className="text-[11px] text-muted-foreground">
          Days and times callers can book. Uses the timezone above.
        </p>
        <div className="space-y-1">
          {slots.map((slot) => (
            <div
              key={slot.dayOfWeek}
              className={cn(
                "flex items-center gap-2 rounded-md px-1.5 py-1",
                slot.isActive ? "bg-muted/40" : "opacity-50",
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
              <span className="w-8 shrink-0 text-[11px] font-medium">{WEEKDAY_SHORT[slot.dayOfWeek]}</span>
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
                className="h-7 w-[5.75rem] rounded border border-input bg-background px-1.5 text-[11px] text-foreground disabled:opacity-40 focus:outline-none focus:ring-1 focus:ring-ring"
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
                className="h-7 w-[5.75rem] rounded border border-input bg-background px-1.5 text-[11px] text-foreground disabled:opacity-40 focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          ))}
        </div>
      </div>
      <Button className="w-full" disabled={saving} onClick={() => void handleSave()}>
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
    staleTime: 5_000,
  });
  const [linking, setLinking] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  const finishOauthReturn = useCallback((ok: boolean, email?: string) => {
    setConnecting(false);
    void googleQ.refetch();
    if (ok) {
      toast({
        title: "Google account added",
        description: email
          ? `${email} is saved. Pick it below to use it on this calendar.`
          : "Pick the account below to use it on this calendar.",
      });
    } else {
      toast({
        title: "Google sign-in failed",
        description: "Try Add Google account again and choose the Gmail you want.",
        variant: "destructive",
      });
    }
  }, [googleQ, toast]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const gcal = params.get("gcal");
    const email = params.get("email") ?? undefined;
    if (gcal !== "connected" && gcal !== "error") return;
    params.delete("gcal");
    params.delete("email");
    const next = `${window.location.pathname}${params.toString() ? `?${params}` : ""}`;
    window.history.replaceState({}, "", next);
    try {
      const ch = new BroadcastChannel("google-oauth");
      ch.postMessage({ type: gcal === "connected" ? "connected" : "error", email });
      ch.close();
    } catch {
      /* BroadcastChannel unavailable */
    }
    if (window.name === "snapserve-google-oauth") {
      window.setTimeout(() => {
        try { window.close(); } catch { /* not a popup */ }
      }, 400);
      return;
    }
    finishOauthReturn(gcal === "connected", email);
  }, [finishOauthReturn]);

  useEffect(() => {
    let ch: BroadcastChannel | null = null;
    try {
      ch = new BroadcastChannel("google-oauth");
      ch.onmessage = (e: MessageEvent<{ type: string; email?: string }>) => {
        if (e.data?.type === "connected") {
          finishOauthReturn(true, e.data.email);
        } else if (e.data?.type === "error") {
          finishOauthReturn(false);
        }
      };
    } catch {
      /* BroadcastChannel unavailable */
    }
    return () => {
      try { ch?.close(); } catch { /* ignore */ }
    };
  }, [finishOauthReturn]);

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
      <p className="text-[12px] text-muted-foreground leading-relaxed">
        Connect every Google account you need, then pick which one this calendar uses. Calendar invites, Meet links, and booking mail are sent from that account — not the Google Cloud Console mailbox. Reconnect the account once so mail permission is granted.
      </p>

      {connections.length > 0 ? (
        <div className="space-y-2">
          {connections.map((conn) => {
            const isLinked = linkedEmail != null && conn.email.toLowerCase() === linkedEmail.toLowerCase();
            return (
              <div
                key={conn.id}
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg border bg-background"
              >
                <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center shrink-0">
                  <span className="text-xs font-semibold">{conn.email[0]?.toUpperCase()}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm truncate">{conn.email}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {isLinked ? "Used on this calendar" : "Saved — not used on this calendar yet"}
                  </p>
                </div>
                {isLinked ? (
                  <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400 shrink-0">Connected</span>
                ) : (
                  <Button
                    size="sm"
                    className="h-7 px-3 text-xs shrink-0"
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
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
          No Google account connected yet.
        </div>
      )}

      <Button
        variant="outline"
        size="sm"
        className="gap-1.5"
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
        <p className="text-sm text-foreground">
          <span className="font-medium">{existing.name}</span>
          <span className="text-muted-foreground"> · {existing.durationMinutes} min</span>
        </p>
        <p className="text-[11.5px] text-muted-foreground">
          Booking page (not the Meet link): <span className="font-mono">/book/{existing.slug}</span>
        </p>
        <p className="text-[11.5px] text-muted-foreground">
          After someone picks a time, Google Meet is added automatically on the invite.
        </p>
        <Button asChild variant="outline" size="sm" className="h-8">
          <Link href={`${BASE}/app/scheduling/event-types/${existing.id}`}>Edit this meeting</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label className="text-xs font-medium">Meeting name</Label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Consultation"
          autoFocus
        />
        {name.trim() && (
          <p className="text-[11px] text-muted-foreground">
            Callers open this page to pick a time:{" "}
            <span className="font-mono bg-muted rounded px-1">/book/{slug}</span>
            . The Google Meet URL is generated only after they book.
          </p>
        )}
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs font-medium">How long?</Label>
        <Select value={String(duration)} onValueChange={(v) => setDuration(Number(v))}>
          <SelectTrigger className="h-9">
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
      <Button className="w-full" disabled={saving} onClick={() => void handleSave()}>
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
