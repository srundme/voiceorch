import { useState, useEffect, useCallback, useRef } from "react";
import { CheckCircle2, Loader2, Calendar, X, ChevronRight, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { customFetch } from "@workspace/api-client-react";
import CalendarsPage from "@/pages/scheduling/Calendars";
import AvailabilityPage from "@/pages/scheduling/Availability";
import EventTypeDetailPage from "@/pages/scheduling/EventTypeDetail";
import EventTypesPage from "@/pages/scheduling/EventTypes";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const API  = `${BASE}/api`;

type Step = "google" | "calendar" | "availability" | "eventtype";
type StepState = "idle" | "open" | "verifying" | "done";

interface StepStatus {
  google:       StepState;
  calendar:     StepState;
  availability: StepState;
  eventtype:    StepState;
}

interface CalendarInfo {
  id: number;
  hostEmail: string | null;
  googleCalendarConnectionId: string | null;
}

type GoogleConnection = { id: string; email: string };

const STEPS: { id: Step; label: string; sub: string }[] = [
  { id: "google",       label: "Connect Google Account",  sub: "Required for Meet links and calendar sync"        },
  { id: "calendar",     label: "Create a Calendar",       sub: "Links this agent to a booking calendar"           },
  { id: "availability", label: "Set Availability",        sub: "When can callers book appointments?"             },
  { id: "eventtype",    label: "Configure Event Type",    sub: "Duration, name, and booking page for your event" },
];

const NEXT_STEP: Partial<Record<Step, Step>> = {
  google:       "calendar",
  calendar:     "availability",
  availability: "eventtype",
};

/** Poll `fn` up to `attempts` times with `delayMs` between tries until it returns a truthy value. */
async function poll<T>(fn: () => Promise<T>, attempts = 5, delayMs = 800): Promise<T | null> {
  for (let i = 0; i < attempts; i++) {
    const result = await fn();
    if (result) return result;
    if (i < attempts - 1) await new Promise(r => setTimeout(r, delayMs));
  }
  return null;
}

// ── Google Account Step ────────────────────────────────────────────────────

function GoogleAccountStep({
  calendarId,
  onLinked,
}: {
  calendarId: number | null;
  onLinked: () => void;
}) {
  const { toast } = useToast();
  const [connections, setConnections] = useState<GoogleConnection[]>([]);
  const [loading, setLoading]         = useState(true);
  const [linking, setLinking]         = useState<string | null>(null);
  const [connecting, setConnecting]   = useState(false);

  const load = useCallback(async () => {
    try {
      const conns = await customFetch<GoogleConnection[]>(`${API}/scheduling/google/connections`);
      setConnections(Array.isArray(conns) ? conns : []);
    } catch { /* non-fatal */ } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Listen for OAuth popup completing
  useEffect(() => {
    let ch: BroadcastChannel | null = null;
    try {
      ch = new BroadcastChannel("google-oauth");
      ch.onmessage = (e: MessageEvent<{ type: string }>) => {
        if (e.data?.type === "connected") {
          setConnecting(false);
          void load();
        }
      };
    } catch { /* noop */ }
    return () => { try { ch?.close(); } catch { /* noop */ } };
  }, [load]);

  async function handleAddAccount() {
    setConnecting(true);
    try {
      const { url } = await customFetch<{ url: string }>(
        `${API}/scheduling/google/connect-url?returnTo=calendar&returnOrigin=${encodeURIComponent(window.location.origin)}`
      );
      window.open(url, "_blank", "noopener,width=500,height=650");
    } catch {
      toast({ title: "Could not start Google sign-in", variant: "destructive" });
      setConnecting(false);
    }
  }

  async function handleSelect(connectionId: string) {
    if (!calendarId) {
      toast({ title: "Calendar not ready yet — try again in a moment", variant: "destructive" });
      return;
    }
    setLinking(connectionId);
    try {
      await customFetch(`${API}/scheduling/calendars/${calendarId}/google-connection`, {
        method: "PATCH",
        body: JSON.stringify({ connectionId }),
      });
      onLinked();
    } catch {
      toast({ title: "Failed to link Google account", variant: "destructive" });
    } finally {
      setLinking(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }

  return (
    <div className="space-y-4 py-2">
      <p className="text-sm text-muted-foreground">
        Select which Google account to use for this agent's calendar. Meet links and calendar events will be created under that account.
      </p>

      {connections.length > 0 ? (
        <div className="space-y-2">
          {connections.map(conn => (
            <div key={conn.id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg border bg-background">
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
                  <><Loader2 className="h-3 w-3 animate-spin mr-1.5" />Linking…</>
                ) : "Use this account"}
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
          No Google accounts connected yet.
        </div>
      )}

      <Button
        variant="outline"
        size="sm"
        className="gap-1.5 text-xs"
        disabled={connecting}
        onClick={() => void handleAddAccount()}
      >
        {connecting ? (
          <><Loader2 className="h-3 w-3 animate-spin" />Opening…</>
        ) : (
          <><Plus className="h-3 w-3" />Add a Google account</>
        )}
      </Button>
    </div>
  );
}

// ── Main Wizard ────────────────────────────────────────────────────────────

export default function VibeSchedulingWizard({
  agentId,
  timezone,
}: {
  agentId: number;
  timezone: string;
}) {
  const [stepStatus, setStepStatus] = useState<StepStatus>({
    google:       "idle",
    calendar:     "idle",
    availability: "idle",
    eventtype:    "idle",
  });
  const [activeStep,  setActiveStep]  = useState<Step | null>(null);
  const [calendarId,  setCalendarId]  = useState<number | null>(null);
  const [eventTypeId, setEventTypeId] = useState<number | null>(null);
  const [initDone,    setInitDone]    = useState(false);
  const autoOpenFiredRef = useRef(false);

  // ── helpers ──────────────────────────────────────────────────────────────

  const setStepDone = useCallback((step: Step) => {
    setStepStatus(prev => ({ ...prev, [step]: "done" }));
  }, []);

  const setStepVerifying = useCallback((step: Step) => {
    setStepStatus(prev => ({ ...prev, [step]: "verifying" }));
  }, []);

  /** Mark a step done, then (after a short pause) open the next uncompleted step */
  const completeStepAndAdvance = useCallback((completedStep: Step, currentStatus: StepStatus) => {
    const next = NEXT_STEP[completedStep];
    if (!next) return;
    if (currentStatus[next] !== "done") {
      setTimeout(() => {
        setActiveStep(next);
        setStepStatus(prev => ({ ...prev, [next]: "open" }));
      }, 350);
    }
  }, []);

  // ── API probes ────────────────────────────────────────────────────────────

  /** Returns the agent's calendar with hostEmail + googleCalendarConnectionId, or null. */
  const fetchCalendarInfo = useCallback(async (): Promise<CalendarInfo | null> => {
    try {
      const cals = await customFetch<(CalendarInfo & { agentId: number })[]>(`${API}/scheduling/calendars`);
      const cal = cals.find(c => c.agentId === agentId);
      if (!cal) return null;
      return { id: cal.id, hostEmail: cal.hostEmail ?? null, googleCalendarConnectionId: cal.googleCalendarConnectionId ?? null };
    } catch { return null; }
  }, [agentId]);

  const verifyAvailability = useCallback(async (calId: number): Promise<boolean> => {
    try {
      const rows = await customFetch<{ id: number; isActive: boolean }[]>(`${API}/scheduling/availability?calendarId=${calId}`);
      return Array.isArray(rows) && rows.some(r => r.isActive);
    } catch { return false; }
  }, []);

  const verifyEventType = useCallback(async (calId: number): Promise<number | null> => {
    try {
      const rows = await customFetch<{ id: number; name: string }[]>(`${API}/scheduling/event-types?calendarId=${calId}`);
      if (!Array.isArray(rows) || rows.length === 0) return null;
      return rows[0]!.id;
    } catch { return null; }
  }, []);

  // ── step completion handlers ──────────────────────────────────────────────

  /**
   * Called by GoogleAccountStep after successfully PATCHing the calendar's
   * googleCalendarConnectionId. Never auto-called — requires explicit user action.
   */
  const advanceAfterGoogle = useCallback(() => {
    setStepStatus(prev => {
      const next: StepStatus = { ...prev, google: "done" };
      completeStepAndAdvance("google", next);
      return next;
    });
    setActiveStep(null);
  }, [completeStepAndAdvance]);

  const advanceAfterCalendar = useCallback(async () => {
    setStepVerifying("calendar");
    // Poll until the calendar has a hostEmail (shell won't have one yet)
    const calInfo = await poll(async () => {
      const info = await fetchCalendarInfo();
      return info?.hostEmail ? info : null;
    }, 6, 600);
    if (!calInfo) {
      setStepStatus(prev => ({ ...prev, calendar: "idle" }));
      return;
    }
    setCalendarId(calInfo.id);
    setActiveStep(null);
    setStepStatus(prev => {
      const next: StepStatus = { ...prev, calendar: "done" };
      completeStepAndAdvance("calendar", next);
      return next;
    });
  }, [setStepVerifying, fetchCalendarInfo, completeStepAndAdvance]);

  const advanceAfterAvailability = useCallback(async () => {
    if (!calendarId) return;
    setStepVerifying("availability");
    const ok = await verifyAvailability(calendarId);
    if (!ok) {
      setStepStatus(prev => ({ ...prev, availability: "idle" }));
      return;
    }
    const etId = await poll(() => verifyEventType(calendarId), 3, 600);
    if (etId) setEventTypeId(etId);
    setActiveStep(null);
    setStepStatus(prev => {
      const next: StepStatus = { ...prev, availability: "done" };
      completeStepAndAdvance("availability", next);
      return next;
    });
  }, [calendarId, setStepVerifying, verifyAvailability, verifyEventType, completeStepAndAdvance]);

  const advanceAfterEventType = useCallback(async () => {
    if (!calendarId) return;
    setStepVerifying("eventtype");
    const etId = await poll(() => verifyEventType(calendarId), 5, 600);
    if (!etId) {
      setStepStatus(prev => ({ ...prev, eventtype: "idle" }));
      return;
    }
    setEventTypeId(etId);
    setStepDone("eventtype");
    setActiveStep(null);
  }, [calendarId, setStepVerifying, verifyEventType, setStepDone]);

  // ── on mount: resolve existing state ─────────────────────────────────────

  useEffect(() => {
    async function init() {
      const calInfo = await fetchCalendarInfo();
      const next: StepStatus = { google: "idle", calendar: "idle", availability: "idle", eventtype: "idle" };

      if (calInfo) {
        setCalendarId(calInfo.id);
        // Google step: done only if user has explicitly linked an account to this calendar
        if (calInfo.googleCalendarConnectionId) next.google = "done";
        // Calendar step: done only if BOTH hostEmail AND googleCalendarConnectionId are set
        // (shell calendar from vibe.ts has neither — both require explicit user action)
        if (calInfo.hostEmail && calInfo.googleCalendarConnectionId) next.calendar = "done";

        if (calInfo.hostEmail) {
          const [availOk, etId] = await Promise.all([
            verifyAvailability(calInfo.id),
            verifyEventType(calInfo.id),
          ]);
          if (availOk) next.availability = "done";
          if (etId) { next.eventtype = "done"; setEventTypeId(etId); }
        }
      }

      setStepStatus(next);
      setInitDone(true);
    }
    void init();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId]);

  // ── auto-open first incomplete step once init is done ────────────────────

  useEffect(() => {
    if (!initDone || autoOpenFiredRef.current) return;
    const allDone = STEPS.every(s => stepStatus[s.id] === "done");
    if (allDone) return;
    autoOpenFiredRef.current = true;
    const firstIncomplete = STEPS.find(s => stepStatus[s.id] !== "done");
    if (firstIncomplete) {
      setTimeout(() => {
        setActiveStep(firstIncomplete.id);
        setStepStatus(prev => ({ ...prev, [firstIncomplete.id]: "open" }));
      }, 200);
    }
  }, [initDone, stepStatus]);

  // ── eventtype polling when opened with null ID ─────────────────────────

  useEffect(() => {
    if (activeStep !== "eventtype" || eventTypeId !== null || !calendarId) return;
    let cancelled = false;
    (async () => {
      const etId = await poll(() => verifyEventType(calendarId), 10, 700);
      if (!cancelled && etId) setEventTypeId(etId);
    })();
    return () => { cancelled = true; };
  }, [activeStep, eventTypeId, calendarId, verifyEventType]);

  // ── derived state ─────────────────────────────────────────────────────────

  const allDone = STEPS.every(s => stepStatus[s.id] === "done");

  function isUnlocked(step: Step): boolean {
    const idx = STEPS.findIndex(s => s.id === step);
    if (idx === 0) return true;
    return STEPS.slice(0, idx).every(s => stepStatus[s.id] === "done");
  }

  function openStep(step: Step) {
    if (!isUnlocked(step)) return;
    if (stepStatus[step] === "verifying") return;
    setActiveStep(step);
    setStepStatus(prev => ({ ...prev, [step]: "open" }));
  }

  function closeDialog() {
    setActiveStep(null);
    setStepStatus(prev => {
      const next = { ...prev };
      for (const key of Object.keys(next) as Step[]) {
        if (next[key] === "open") next[key] = "idle";
      }
      return next;
    });
  }

  // ── render ────────────────────────────────────────────────────────────────

  if (!initDone) {
    return (
      <div className="rounded-xl border border-border/60 bg-background p-4 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin shrink-0" />
        Checking scheduling status…
      </div>
    );
  }

  if (allDone) {
    return (
      <div className="rounded-xl border border-green-500/30 bg-green-500/5 p-4">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
          <p className="text-xs font-semibold text-green-700 dark:text-green-400">
            Scheduling fully configured
          </p>
        </div>
        <p className="text-[10px] text-muted-foreground mt-1 ml-6">
          Calendar connected · Availability set · Event type ready
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-amber-500 shrink-0" />
          <p className="text-xs font-semibold text-amber-600 dark:text-amber-400">
            Complete scheduling setup
          </p>
        </div>
        <p className="text-[10px] text-muted-foreground">
          Timezone: <span className="font-medium text-foreground">{timezone}</span>
        </p>

        <div className="space-y-1.5">
          {STEPS.map((step, idx) => {
            const state    = stepStatus[step.id];
            const unlocked = isUnlocked(step.id);

            return (
              <button
                key={step.id}
                disabled={!unlocked || state === "verifying"}
                onClick={() => openStep(step.id)}
                className={[
                  "w-full flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors",
                  state === "done"
                    ? "border-green-500/30 bg-green-500/5 cursor-default"
                    : unlocked
                    ? "border-border/60 bg-background hover:bg-muted/50 cursor-pointer"
                    : "border-border/30 bg-muted/20 opacity-50 cursor-not-allowed",
                ].join(" ")}
              >
                <span className="shrink-0">
                  {state === "done" ? (
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                  ) : state === "verifying" ? (
                    <Loader2 className="h-4 w-4 animate-spin text-amber-500" />
                  ) : (
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-500/10 text-amber-500 text-[10px] font-bold">
                      {idx + 1}
                    </span>
                  )}
                </span>
                <div className="flex-1 min-w-0">
                  <p className={[
                    "text-xs font-medium",
                    state === "done" ? "text-green-700 dark:text-green-400" : "text-foreground",
                  ].join(" ")}>
                    {step.label}
                  </p>
                  <p className="text-[10px] text-muted-foreground truncate">{step.sub}</p>
                </div>
                {unlocked && state !== "done" && state !== "verifying" && (
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      <Dialog open={activeStep !== null} onOpenChange={open => { if (!open) closeDialog(); }}>
        <DialogContent className={[
          "flex flex-col overflow-hidden",
          activeStep === "google"       ? "max-w-lg max-h-[90vh]" :
          activeStep === "calendar"     ? "max-w-2xl max-h-[90vh]" :
          activeStep === "availability" ? "max-w-2xl max-h-[90vh]" :
          "max-w-3xl max-h-[90vh] w-full",
        ].join(" ")}>
          <DialogHeader className="px-6 pt-6 shrink-0">
            <div className="flex items-center justify-between">
              <DialogTitle className="text-base">
                {activeStep === "google"       && "Connect Google Account"}
                {activeStep === "calendar"     && "Create Calendar"}
                {activeStep === "availability" && "Set Availability"}
                {activeStep === "eventtype"    && "Configure Event Type"}
              </DialogTitle>
              <button
                onClick={closeDialog}
                className="rounded-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto px-6 pb-2">
            {activeStep === "google" && (
              <GoogleAccountStep
                calendarId={calendarId}
                onLinked={() => { advanceAfterGoogle(); }}
              />
            )}

            {activeStep === "calendar" && (
              <CalendarsPage
                embedded
                defaultAgentId={agentId}
                onCalendarSaved={() => { void advanceAfterCalendar(); }}
              />
            )}

            {activeStep === "availability" && calendarId && (
              <AvailabilityPage embedded calendarId={calendarId} />
            )}

            {activeStep === "eventtype" && eventTypeId !== null && (
              <EventTypeDetailPage
                id={eventTypeId}
                embedded
                onSaved={() => { void advanceAfterEventType(); }}
              />
            )}

            {activeStep === "eventtype" && eventTypeId === null && calendarId && (
              <EventTypesPage
                embedded
                embeddedCalendarId={calendarId}
                onEventTypeCreated={id => { setEventTypeId(id); }}
              />
            )}

            {activeStep === "eventtype" && eventTypeId === null && !calendarId && (
              <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading calendar…
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="border-t px-6 py-3 shrink-0 flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              {activeStep === "google"
                ? "Select a Google account above, or add a new one."
                : activeStep === "calendar"
                ? "Fill in the calendar details and click Save."
                : activeStep === "availability"
                ? "Add your weekly schedule above. Each row saves automatically."
                : activeStep === "eventtype"
                ? eventTypeId !== null ? "Edit the event type and click Save." : "Create an event type to continue."
                : ""}
            </p>
            <div className="flex items-center gap-2 shrink-0">
              {activeStep === "availability" && (
                <Button
                  size="sm"
                  className="h-7 px-3 text-xs"
                  onClick={() => void advanceAfterAvailability()}
                  disabled={stepStatus.availability === "verifying"}
                >
                  {stepStatus.availability === "verifying" ? (
                    <><Loader2 className="h-3 w-3 animate-spin mr-1.5" />Checking…</>
                  ) : "Done — I've set my availability"}
                </Button>
              )}
              <Button size="sm" variant="ghost" className="h-7 px-3 text-xs" onClick={closeDialog}>
                Close
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

    </>
  );
}
