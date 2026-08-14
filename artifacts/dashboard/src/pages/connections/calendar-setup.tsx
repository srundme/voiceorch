/**
 * Connections → Bookings calendar — plain-language setup wizard.
 * Creates calendar + Google link + bookable meeting without "event type" jargon.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
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
import { useToast } from "@/hooks/use-toast";
import {
  computeBookingSetupReadiness,
  createMeeting,
  createOrUpdateCalendar,
  getBrowserTimezone,
  linkGoogleToCalendar,
  listGoogleConnections,
  MEETING_DURATION_OPTIONS,
  openGoogleConnectPopup,
  slugifyMeetingName,
  type MeetingInfo,
  type SchedulingCalendarInfo,
} from "@/lib/scheduling-setup";
import {
  Check,
  CheckCircle2,
  ChevronRight,
  Loader2,
  Plus,
} from "lucide-react";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type WizardStepId = "calendar" | "google" | "meeting";

const STEPS: { id: WizardStepId; title: string; blurb: string }[] = [
  {
    id: "calendar",
    title: "Your calendar",
    blurb: "Name it and the email where bookings should go.",
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
  hostEmail?: string | null;
  connectedGoogleEmail?: string | null;
  timezone?: string;
}): SchedulingCalendarInfo {
  return {
    id: c.id,
    name: c.name,
    hostEmail: c.hostEmail ?? null,
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

export function ConnectionsCalendarSetup() {
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

  const readiness = computeBookingSetupReadiness(calendars, meetings);
  const { calendar, meeting, requiredReadyCount, ready } = readiness;
  const doneFlags: Record<WizardStepId, boolean> = {
    calendar: Boolean(calendar),
    google: readiness.googleLinked,
    meeting: Boolean(meeting),
  };

  const firstIncomplete = STEPS.find((s) => !doneFlags[s.id])?.id ?? null;
  const [activeStep, setActiveStep] = useState<WizardStepId | null>(null);
  const [editingReady, setEditingReady] = useState(false);

  useEffect(() => {
    if (ready && !editingReady) {
      setActiveStep(null);
      return;
    }
    if (!activeStep || doneFlags[activeStep]) {
      if (firstIncomplete) setActiveStep(firstIncomplete);
    }
    // Only re-pick when readiness / first incomplete changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, firstIncomplete, editingReady]);

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
      <StripePage
        title="Bookings calendar"
        description="Set up booking in a few simple steps. Day-to-day appointments live under Bookings."
        back={{ href: "/app/connections", label: "Connections" }}
      >
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-8">
          <Loader2 className="h-4 w-4 animate-spin" /> Checking your setup…
        </div>
      </StripePage>
    );
  }

  if (ready && !editingReady) {
    return (
      <StripePage
        title="Bookings calendar"
        description="Set up booking in a few simple steps. Day-to-day appointments live under Bookings."
        back={{ href: "/app/connections", label: "Connections" }}
      >
        <div className="max-w-lg space-y-4">
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-[12px] text-emerald-600 dark:text-emerald-400">
            <p className="font-medium flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4" />
              3 of 3 ready
            </p>
            <p className="mt-1 leading-relaxed text-emerald-600 dark:text-emerald-400/90">
              On your agent → Tools → turn on Booking and pick this meeting, then watch appointments under Bookings.
            </p>
          </div>

          <div className="rounded-xl border border-border/60 bg-card/40 px-4 py-3 space-y-2">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Your meeting</p>
            <p className="text-[14px] font-medium">{meeting?.name}</p>
            <p className="text-[12px] text-muted-foreground">
              {meeting?.durationMinutes} minutes
              {calendar?.connectedGoogleEmail ? ` · ${calendar.connectedGoogleEmail}` : ""}
              {meeting?.slug ? (
                <>
                  {" · "}
                  <span className="font-mono text-[11px]">/book/{meeting.slug}</span>
                </>
              ) : null}
            </p>
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            <Button asChild size="sm" className="h-9">
              <Link href={`${BASE}/app/scheduling`}>Open Bookings</Link>
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-9"
              onClick={() => {
                setEditingReady(true);
                setActiveStep("meeting");
              }}
            >
              Change meeting
            </Button>
            <Button asChild size="sm" variant="ghost" className="h-9 text-muted-foreground">
              <Link href={`${BASE}/app/scheduling/availability`}>Adjust hours</Link>
            </Button>
            <Button asChild size="sm" variant="ghost" className="h-9 text-muted-foreground">
              <Link href={`${BASE}/app/scheduling/calendars`}>Advanced</Link>
            </Button>
          </div>
        </div>
      </StripePage>
    );
  }

  return (
    <StripePage
      title="Bookings calendar"
      description="Set up booking in a few simple steps. Day-to-day appointments live under Bookings."
      back={{ href: "/app/connections", label: "Connections" }}
    >
      <div className="max-w-lg space-y-4">
        <div
          className={cn(
            "rounded-xl border px-4 py-3 text-[12px]",
            ready
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              : "border-border/60 bg-muted/20 text-muted-foreground",
          )}
        >
          <p className="font-medium text-[12px]">
            {ready ? "3 of 3 ready" : `${requiredReadyCount} of 3 ready`}
          </p>
          <p className="mt-0.5 leading-relaxed">
            {ready
              ? "You're set — turn on Booking on an agent and pick this meeting."
              : "Follow the steps below. We’ll create everything agents need to book calls."}
          </p>
        </div>

        <ol className="space-y-2">
          {STEPS.map((step, i) => {
            const done = doneFlags[step.id];
            const unlocked =
              i === 0 || STEPS.slice(0, i).every((s) => doneFlags[s.id]);
            const open = activeStep === step.id;
            return (
              <li key={step.id} className="rounded-xl border border-border/60 bg-card/40 overflow-hidden">
                <button
                  type="button"
                  disabled={!unlocked}
                  onClick={() => unlocked && setActiveStep(open ? null : step.id)}
                  className={cn(
                    "flex w-full items-start gap-3 px-3.5 py-3 text-left transition-colors",
                    unlocked ? "hover:bg-muted/30" : "opacity-40 cursor-not-allowed",
                  )}
                >
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/50 bg-background/50">
                    {done ? (
                      <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                    ) : (
                      <span className="text-[12px] font-semibold text-muted-foreground">{i + 1}</span>
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium">
                      {step.title}
                      {done && !open ? (
                        <span className="ml-2 text-[11px] font-normal text-emerald-600 dark:text-emerald-400/80">Done</span>
                      ) : null}
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground leading-relaxed">{step.blurb}</p>
                  </div>
                  {unlocked && (
                    <ChevronRight
                      className={cn(
                        "mt-2 h-3.5 w-3.5 shrink-0 text-muted-foreground/50 transition-transform",
                        open && "rotate-90",
                      )}
                    />
                  )}
                </button>

                {open && unlocked && (
                  <div className="border-t border-border/40 px-3.5 pb-4 pt-3">
                    {step.id === "calendar" && (
                      <CalendarPanel
                        existing={calendar}
                        onDone={async () => {
                          await refresh();
                          setActiveStep("google");
                        }}
                      />
                    )}
                    {step.id === "google" && calendar && (
                      <GooglePanel
                        calendarId={calendar.id}
                        linkedEmail={calendar.connectedGoogleEmail}
                        onDone={async () => {
                          await refresh();
                          setActiveStep("meeting");
                        }}
                      />
                    )}
                    {step.id === "meeting" && calendar && (
                      <MeetingPanel
                        calendarId={calendar.id}
                        existing={meeting}
                        onDone={async () => {
                          await refresh();
                          setEditingReady(false);
                          setActiveStep(null);
                          toast({
                            title: "Booking setup complete",
                            description: "Turn on Booking on an agent and pick this meeting.",
                          });
                        }}
                      />
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ol>

        <div className="flex flex-wrap gap-2 pt-1">
          <Button asChild size="sm" className="h-9">
            <Link href={`${BASE}/app/scheduling`}>Open Bookings</Link>
          </Button>
          <Button asChild size="sm" variant="ghost" className="h-9 text-muted-foreground">
            <Link href={`${BASE}/app/scheduling/availability`}>Adjust hours later</Link>
          </Button>
          <Button asChild size="sm" variant="ghost" className="h-9 text-muted-foreground">
            <Link href={`${BASE}/app/scheduling/event-types`}>Meetings</Link>
          </Button>
          <Button asChild size="sm" variant="ghost" className="h-9 text-muted-foreground">
            <Link href={`${BASE}/app/scheduling/calendars`}>Advanced</Link>
          </Button>
        </div>
      </div>
    </StripePage>
  );
}

// ── Step panels ───────────────────────────────────────────────────────────────

function CalendarPanel({
  existing,
  onDone,
}: {
  existing: SchedulingCalendarInfo | null;
  onDone: () => Promise<void>;
}) {
  const { toast } = useToast();
  const [name, setName] = useState(existing?.name ?? "My Calendar");
  const [hostEmail, setHostEmail] = useState(existing?.hostEmail ?? "");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!name.trim()) {
      toast({ title: "Give your calendar a name", variant: "destructive" });
      return;
    }
    if (!hostEmail.trim() || !hostEmail.includes("@")) {
      toast({ title: "Enter the email where bookings should go", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await createOrUpdateCalendar({
        id: existing?.id,
        name,
        hostEmail,
        timezone: existing?.timezone || getBrowserTimezone(),
      });
      await onDone();
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
        <Label className="text-xs font-medium">Calendar name</Label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Clinic bookings"
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs font-medium">Email where bookings should go</Label>
        <Input
          type="email"
          value={hostEmail}
          onChange={(e) => setHostEmail(e.target.value)}
          placeholder="you@company.com"
        />
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          Use the inbox you check every day. You’ll get booking emails here — ideally the same Google account you’ll connect next.
        </p>
      </div>
      <Button className="w-full" disabled={saving} onClick={() => void handleSave()}>
        {saving ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin mr-2" /> Saving…
          </>
        ) : existing ? (
          "Save & continue"
        ) : (
          "Create calendar & continue"
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
        <p className="text-sm text-muted-foreground">
          Connected as <span className="font-medium text-foreground">{linkedEmail}</span>
        </p>
        <Button className="w-full" onClick={() => void onDone()}>
          Continue
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
      <p className="text-[12px] text-muted-foreground leading-relaxed">
        Connect the Google account that matches your booking email. Callers get a Meet link and events land on your calendar.
      </p>

      {connections.length > 0 ? (
        <div className="space-y-2">
          {connections.map((conn) => (
            <div
              key={conn.id}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg border bg-background"
            >
              <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center shrink-0">
                <span className="text-xs font-semibold">{conn.email[0]?.toUpperCase()}</span>
              </div>
              <span className="flex-1 text-sm truncate">{conn.email}</span>
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
            </div>
          ))}
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
        <p className="text-sm text-muted-foreground leading-relaxed">
          Callers can book <span className="font-medium text-foreground">{existing.name}</span>
          {" "}({existing.durationMinutes} min).
        </p>
        <p className="text-[11px] text-muted-foreground">
          Public link: <span className="font-mono">/book/{existing.slug}</span>
          {" · "}
          <Link href={`${BASE}/app/scheduling/event-types/${existing.id}`} className="underline underline-offset-2">
            Edit details
          </Link>
        </p>
        <Button className="w-full" onClick={() => void onDone()}>
          Looks good — finish
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
            Booking link: <span className="font-mono bg-muted rounded px-1">/book/{slug}</span>
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
          "Create meeting & finish"
        )}
      </Button>
    </div>
  );
}
