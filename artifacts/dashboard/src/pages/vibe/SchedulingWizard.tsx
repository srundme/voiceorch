import { useState, useEffect, useCallback, useRef } from "react";
import { CheckCircle2, Loader2, Calendar, X, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { customFetch } from "@workspace/api-client-react";
import ConferencingPage from "@/pages/settings/Conferencing";
import CalendarsPage from "@/pages/scheduling/Calendars";
import AvailabilityPage from "@/pages/scheduling/Availability";
import EventTypeDetailPage from "@/pages/scheduling/EventTypeDetail";

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

const STEPS: { id: Step; label: string; sub: string }[] = [
  { id: "google",       label: "Connect Google Account",  sub: "Required for Meet links and calendar sync"        },
  { id: "calendar",     label: "Create a Calendar",       sub: "Links this agent to a booking calendar"           },
  { id: "availability", label: "Set Availability",        sub: "When can callers book appointments?"             },
  { id: "eventtype",    label: "Configure Event Type",    sub: "Duration, name, and booking page for Quick Chat" },
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
  const [activeStep,   setActiveStep]   = useState<Step | null>(null);
  const [calendarId,   setCalendarId]   = useState<number | null>(null);
  const [eventTypeId,  setEventTypeId]  = useState<number | null>(null);
  const [initDone,     setInitDone]     = useState(false);
  const broadcastRef   = useRef<BroadcastChannel | null>(null);

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
    if (!next) return; // eventtype is last
    // Only auto-open if next step is not already done
    if (currentStatus[next] !== "done") {
      setTimeout(() => {
        setActiveStep(next);
        setStepStatus(prev => ({ ...prev, [next]: "open" }));
      }, 350);
    }
  }, []);

  // ── API probes ────────────────────────────────────────────────────────────

  const verifyGoogle = useCallback(async (): Promise<boolean> => {
    try {
      const conns = await customFetch<{ id: string }[]>(`${API}/scheduling/google/connections`);
      return Array.isArray(conns) && conns.length > 0;
    } catch { return false; }
  }, []);

  const verifyCalendar = useCallback(async (): Promise<number | null> => {
    try {
      const cals = await customFetch<{ id: number; agentId: number }[]>(`${API}/scheduling/calendars`);
      const cal = cals.find(c => c.agentId === agentId);
      return cal?.id ?? null;
    } catch { return null; }
  }, [agentId]);

  const verifyAvailability = useCallback(async (calId: number): Promise<boolean> => {
    try {
      const rows = await customFetch<{ id: number; isActive: boolean }[]>(`${API}/scheduling/availability?calendarId=${calId}`);
      return Array.isArray(rows) && rows.some(r => r.isActive);
    } catch { return false; }
  }, []);

  /** Prefer the auto-created "Quick Chat"; fall back to first in list. */
  const verifyEventType = useCallback(async (calId: number): Promise<number | null> => {
    try {
      const rows = await customFetch<{ id: number; name: string }[]>(`${API}/scheduling/event-types?calendarId=${calId}`);
      if (!Array.isArray(rows) || rows.length === 0) return null;
      const quickChat = rows.find(r => r.name === "Quick Chat");
      return (quickChat ?? rows[0])!.id;
    } catch { return null; }
  }, []);

  // ── step completion handlers ──────────────────────────────────────────────

  const advanceAfterGoogle = useCallback(async () => {
    setStepVerifying("google");
    const ok = await verifyGoogle();
    if (!ok) {
      setStepStatus(prev => ({ ...prev, google: "idle" }));
      return;
    }
    // Pre-check how far ahead we already are (calendar may have been created already)
    const calId = await verifyCalendar();
    const status: StepStatus = {
      google:       "done",
      calendar:     calId ? "done" : "idle",
      availability: "idle",
      eventtype:    "idle",
    };
    if (calId) {
      setCalendarId(calId);
      const [availOk, etId] = await Promise.all([verifyAvailability(calId), verifyEventType(calId)]);
      if (availOk) { status.availability = "done"; }
      if (etId)    { status.eventtype    = "done"; setEventTypeId(etId); }
    }
    setActiveStep(null);
    setStepStatus(status);
    completeStepAndAdvance("google", status);
  }, [setStepVerifying, verifyGoogle, verifyCalendar, verifyAvailability, verifyEventType, completeStepAndAdvance]);

  const advanceAfterCalendar = useCallback(async () => {
    setStepVerifying("calendar");
    // Poll — the calendar row may take a moment after CalendarFormDialog submission
    const calId = await poll(verifyCalendar, 5, 600);
    if (!calId) {
      setStepStatus(prev => ({ ...prev, calendar: "idle" }));
      return;
    }
    setCalendarId(calId);
    setActiveStep(null);
    setStepStatus(prev => {
      const next: StepStatus = { ...prev, calendar: "done" };
      completeStepAndAdvance("calendar", next);
      return next;
    });
  }, [setStepVerifying, verifyCalendar, completeStepAndAdvance]);

  const advanceAfterAvailability = useCallback(async () => {
    if (!calendarId) return;
    setStepVerifying("availability");
    const ok = await verifyAvailability(calendarId);
    if (!ok) {
      setStepStatus(prev => ({ ...prev, availability: "idle" }));
      return;
    }
    // Pre-fetch event type (created by vibe.ts; may not exist yet if user skipped)
    const etId = await poll(() => verifyEventType(calendarId), 5, 800);
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
    // eventtype is the last step — no further advance
  }, [calendarId, setStepVerifying, verifyEventType, setStepDone]);

  // ── eventtype step polling: if opened with null ID, retry until resolved ──

  useEffect(() => {
    if (activeStep !== "eventtype" || eventTypeId !== null || !calendarId) return;
    let cancelled = false;
    (async () => {
      const etId = await poll(() => verifyEventType(calendarId), 10, 700);
      if (!cancelled && etId) setEventTypeId(etId);
    })();
    return () => { cancelled = true; };
  }, [activeStep, eventTypeId, calendarId, verifyEventType]);

  // ── Google OAuth BroadcastChannel listener ────────────────────────────────

  useEffect(() => {
    if (activeStep !== "google") return;
    let ch: BroadcastChannel | null = null;
    try {
      ch = new BroadcastChannel("google-oauth");
      broadcastRef.current = ch;
      ch.onmessage = (e: MessageEvent<{ type: string }>) => {
        if (e.data?.type === "connected") {
          void advanceAfterGoogle();
        }
      };
    } catch { /* BroadcastChannel not available */ }
    return () => {
      try { ch?.close(); } catch { /* noop */ }
      broadcastRef.current = null;
    };
  }, [activeStep, advanceAfterGoogle]);

  // ── on mount: resolve existing state ─────────────────────────────────────

  useEffect(() => {
    async function init() {
      const [googleOk, calId] = await Promise.all([verifyGoogle(), verifyCalendar()]);
      const next: StepStatus = { google: "idle", calendar: "idle", availability: "idle", eventtype: "idle" };
      if (googleOk) next.google = "done";
      if (calId) {
        next.calendar = "done";
        setCalendarId(calId);
        const [availOk, etId] = await Promise.all([verifyAvailability(calId), verifyEventType(calId)]);
        if (availOk) next.availability = "done";
        if (etId) { next.eventtype = "done"; setEventTypeId(etId); }
      }
      setStepStatus(next);
      setInitDone(true);
    }
    void init();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId]);

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
              <ConferencingPage embedded returnPath="vibe" />
            )}

            {activeStep === "calendar" && (
              <CalendarsPage
                embedded
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

            {activeStep === "eventtype" && eventTypeId === null && (
              <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading event type…
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="border-t px-6 py-3 shrink-0 flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              {activeStep === "google"
                ? "Click \"Add account\", sign in with Google, then close that window."
                : activeStep === "calendar"
                ? "Fill in the calendar details and click Save."
                : activeStep === "availability"
                ? "Add your weekly schedule above. Each row saves automatically."
                : activeStep === "eventtype"
                ? "Edit the event type and click Save."
                : ""}
            </p>
            <div className="flex items-center gap-2 shrink-0">
              {activeStep === "google" && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-3 text-xs"
                  onClick={() => void advanceAfterGoogle()}
                  disabled={stepStatus.google === "verifying"}
                >
                  {stepStatus.google === "verifying" ? (
                    <><Loader2 className="h-3 w-3 animate-spin mr-1.5" />Checking…</>
                  ) : "I've connected — continue"}
                </Button>
              )}
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
