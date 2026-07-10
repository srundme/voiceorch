import { useState, useEffect, useCallback, useRef } from "react";
import { CheckCircle2, Loader2, Calendar, X, ChevronRight, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { customFetch } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const API  = `${BASE}/api`;

// ── Types ────────────────────────────────────────────────────────────────────

type Step = "calendar" | "google" | "eventtype" | "availability";
type StepState = "idle" | "open" | "saving" | "verifying" | "done";

interface StepStatus {
  calendar:     StepState;
  google:       StepState;
  eventtype:    StepState;
  availability: StepState;
}

interface GoogleConnection { id: string; email: string; }
interface CalendarInfo {
  id: number;
  name: string;
  hostEmail: string | null;
  connectedGoogleEmail: string | null;
}

const STEPS: { id: Step; label: string; sub: string }[] = [
  { id: "calendar",     label: "Create Calendar",         sub: "Name it and add your organizer email"        },
  { id: "google",       label: "Connect Google Account",  sub: "For Meet links and automatic calendar events" },
  { id: "eventtype",    label: "Create Event Type",       sub: "Meeting name, duration, and booking link"    },
  { id: "availability", label: "Set Availability",        sub: "Days and hours when callers can book"        },
];

const NEXT_STEP: Partial<Record<Step, Step>> = {
  calendar:     "google",
  google:       "eventtype",
  eventtype:    "availability",
};

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "meeting";
}

// ── Step 1: Create / update Calendar ────────────────────────────────────────

function CalendarStep({
  agentId,
  agentName,
  timezone,
  existingCalendar,
  onDone,
}: {
  agentId: number;
  agentName: string;
  timezone: string;
  existingCalendar: CalendarInfo | null;
  onDone: (calendarId: number) => void;
}) {
  const { toast } = useToast();
  const [name, setName]               = useState(existingCalendar?.name ?? `${agentName} Calendar`);
  const [hostEmail, setHostEmail]     = useState(existingCalendar?.hostEmail ?? "");
  const [addHosts, setAddHosts]       = useState<string[]>([]);
  const [newHost, setNewHost]         = useState("");
  const [saving, setSaving]           = useState(false);

  async function handleSave() {
    if (!name.trim()) {
      toast({ title: "Calendar name is required", variant: "destructive" }); return;
    }
    if (!hostEmail.trim() || !hostEmail.includes("@")) {
      toast({ title: "Enter a valid organizer email address", variant: "destructive" }); return;
    }
    setSaving(true);
    try {
      const body = {
        name: name.trim(),
        hostEmail: hostEmail.trim(),
        additionalHosts: addHosts.filter(Boolean),
        isActive: true,
      };
      let id: number;
      if (existingCalendar) {
        const r = await customFetch<{ id: number }>(
          `${API}/scheduling/calendars/${existingCalendar.id}`,
          { method: "PATCH", body: JSON.stringify(body) },
        );
        id = r.id;
      } else {
        const r = await customFetch<{ id: number }>(
          `${API}/scheduling/calendars`,
          { method: "POST", body: JSON.stringify({ ...body, agentId, timezone }) },
        );
        id = r.id;
      }
      onDone(id);
    } catch (e: unknown) {
      toast({
        title: "Failed to save calendar",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  function addHost() {
    const h = newHost.trim();
    if (!h || !h.includes("@")) {
      toast({ title: "Enter a valid email address", variant: "destructive" }); return;
    }
    setAddHosts(prev => [...prev, h]);
    setNewHost("");
  }

  return (
    <div className="space-y-5 py-1">

      {/* Name */}
      <div className="space-y-1.5">
        <Label className="text-xs font-medium">Calendar name <span className="text-destructive">*</span></Label>
        <Input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="e.g. Demo Booking Calendar"
        />
      </div>

      {/* Host email */}
      <div className="space-y-1.5">
        <Label className="text-xs font-medium">Organizer / host email <span className="text-destructive">*</span></Label>
        <Input
          type="email"
          value={hostEmail}
          onChange={e => setHostEmail(e.target.value)}
          placeholder="your@email.com"
        />
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          Use <strong>your own email address</strong> — the one you check every day.
          You will receive a notification on every booking, cancellation, and reschedule.
          It will also appear as the organizer on Google Calendar invitations sent to attendees.
          Make sure this matches the Google account you'll connect in the next step.
        </p>
      </div>

      {/* Additional hosts */}
      <div className="space-y-2">
        <Label className="text-xs font-medium">
          Additional hosts <span className="text-muted-foreground font-normal">(optional)</span>
        </Label>
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          Add teammates who should also be notified and appear as attendees on every booking.
        </p>
        {addHosts.length > 0 && (
          <div className="space-y-1">
            {addHosts.map((h, i) => (
              <div key={i} className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-1.5 text-sm">
                <span className="flex-1 truncate text-xs">{h}</span>
                <button
                  onClick={() => setAddHosts(prev => prev.filter((_, j) => j !== i))}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <Input
            type="email"
            value={newHost}
            onChange={e => setNewHost(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addHost(); } }}
            placeholder="teammate@email.com"
            className="h-8 text-xs"
          />
          <Button size="sm" variant="outline" onClick={addHost} className="h-8 px-3 text-xs shrink-0">
            <Plus className="h-3 w-3 mr-1" />Add
          </Button>
        </div>
      </div>

      {/* Timezone (read-only) */}
      <div className="rounded-lg border bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground">
        <span className="font-medium text-foreground">Timezone:</span> {timezone}
        &nbsp;·&nbsp;Inherited from your agent settings.
      </div>

      <Button className="w-full" disabled={saving} onClick={() => void handleSave()}>
        {saving
          ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Saving calendar…</>
          : existingCalendar ? "Save Calendar →" : "Create Calendar →"}
      </Button>
    </div>
  );
}

// ── Step 2: Connect Google Account ───────────────────────────────────────────

function GoogleStep({
  calendarId,
  onLinked,
  onSkip,
}: {
  calendarId: number;
  onLinked: () => void;
  onSkip: () => void;
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
    } catch { /**/ } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    let ch: BroadcastChannel | null = null;
    try {
      ch = new BroadcastChannel("google-oauth");
      ch.onmessage = (e: MessageEvent<{ type: string }>) => {
        if (e.data?.type === "connected") { setConnecting(false); void load(); }
      };
    } catch { /**/ }
    return () => { try { ch?.close(); } catch { /**/ } };
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
    setLinking(connectionId);
    try {
      await customFetch(`${API}/scheduling/calendars/${calendarId}/google-connection`, {
        method: "PATCH",
        body: JSON.stringify({ connectionId }),
      });
      onLinked();
    } catch {
      toast({ title: "Failed to link Google account", variant: "destructive" });
    } finally { setLinking(null); }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading accounts…
      </div>
    );
  }

  return (
    <div className="space-y-4 py-2">
      <p className="text-sm text-muted-foreground leading-relaxed">
        Connect the Google account that <strong>matches your organizer email</strong>.
        This enables automatic Google Calendar events and Meet links for every booking.
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
                {linking === conn.id
                  ? <><Loader2 className="h-3 w-3 animate-spin mr-1.5" />Linking…</>
                  : "Use this account"}
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
          No Google accounts connected yet.
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 text-xs"
          disabled={connecting}
          onClick={() => void handleAddAccount()}
        >
          {connecting
            ? <><Loader2 className="h-3 w-3 animate-spin" />Opening…</>
            : <><Plus className="h-3 w-3" />Add Google account</>}
        </Button>
        <button
          className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
          onClick={onSkip}
        >
          Skip for now
        </button>
      </div>
    </div>
  );
}

// ── Step 3: Create Event Type ─────────────────────────────────────────────────

const DURATION_OPTIONS = [
  { label: "15 minutes", value: 15 },
  { label: "30 minutes", value: 30 },
  { label: "45 minutes", value: 45 },
  { label: "60 minutes (1 hour)", value: 60 },
  { label: "90 minutes", value: 90 },
  { label: "120 minutes (2 hours)", value: 120 },
];

function EventTypeStep({
  calendarId,
  onCreated,
}: {
  calendarId: number;
  onCreated: (eventTypeId: number) => void;
}) {
  const { toast } = useToast();
  const [name, setName]             = useState("");
  const [duration, setDuration]     = useState(30);
  const [description, setDescription] = useState("");
  const [saving, setSaving]         = useState(false);

  const slug = slugify(name);

  async function handleSave() {
    if (!name.trim()) {
      toast({ title: "Meeting name is required", variant: "destructive" }); return;
    }
    setSaving(true);
    try {
      const r = await customFetch<{ id: number }>(`${API}/scheduling/event-types`, {
        method: "POST",
        body: JSON.stringify({
          calendarId,
          name: name.trim(),
          slug,
          description: description.trim() || undefined,
          durationMinutes: duration,
          isActive: true,
        }),
      });
      onCreated(r.id);
    } catch (e: unknown) {
      toast({
        title: "Failed to create event type",
        description: e instanceof Error ? e.message : "Try a different meeting name if the URL slug is already taken.",
        variant: "destructive",
      });
    } finally { setSaving(false); }
  }

  return (
    <div className="space-y-5 py-1">

      <div className="space-y-1.5">
        <Label className="text-xs font-medium">Meeting name <span className="text-destructive">*</span></Label>
        <Input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="e.g. 30-minute Product Demo"
          autoFocus
        />
        {name.trim() && (
          <p className="text-[11px] text-muted-foreground">
            Public booking URL: <span className="font-mono bg-muted rounded px-1">/book/{slug}</span>
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs font-medium">Duration <span className="text-destructive">*</span></Label>
        <Select value={String(duration)} onValueChange={v => setDuration(Number(v))}>
          <SelectTrigger className="h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DURATION_OPTIONS.map(o => (
              <SelectItem key={o.value} value={String(o.value)}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs font-medium">
          Description <span className="text-muted-foreground font-normal">(optional)</span>
        </Label>
        <Input
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="e.g. A quick product demo for interested leads"
        />
      </div>

      <Button className="w-full" disabled={saving} onClick={() => void handleSave()}>
        {saving
          ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Creating…</>
          : "Create Event Type →"}
      </Button>
    </div>
  );
}

// ── Step 4: Set Availability ──────────────────────────────────────────────────

interface DaySlot { dayOfWeek: number; startTime: string; endTime: string; }

const DEFAULT_SLOTS: DaySlot[] = [1, 2, 3, 4, 5].map(d => ({
  dayOfWeek: d, startTime: "09:00", endTime: "17:00",
}));

function AvailabilityStep({
  calendarId,
  onSaved,
}: {
  calendarId: number;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [slots, setSlots]   = useState<DaySlot[]>(DEFAULT_SLOTS);
  const [saving, setSaving] = useState(false);

  function toggleDay(day: number) {
    setSlots(prev => {
      const exists = prev.some(s => s.dayOfWeek === day);
      if (exists) return prev.filter(s => s.dayOfWeek !== day);
      return [...prev, { dayOfWeek: day, startTime: "09:00", endTime: "17:00" }]
        .sort((a, b) => a.dayOfWeek - b.dayOfWeek);
    });
  }

  function updateSlot(day: number, field: "startTime" | "endTime", val: string) {
    setSlots(prev => prev.map(s => s.dayOfWeek === day ? { ...s, [field]: val } : s));
  }

  async function handleSave() {
    if (slots.length === 0) {
      toast({ title: "Select at least one day", variant: "destructive" }); return;
    }
    const invalid = slots.find(s => s.startTime >= s.endTime);
    if (invalid) {
      toast({ title: `End time must be after start time for ${DAYS[invalid.dayOfWeek]}`, variant: "destructive" }); return;
    }
    setSaving(true);
    try {
      await Promise.all(slots.map(slot =>
        customFetch(`${API}/scheduling/availability`, {
          method: "POST",
          body: JSON.stringify({ calendarId, ...slot, isActive: true }),
        })
      ));
      onSaved();
    } catch (e: unknown) {
      toast({
        title: "Failed to save availability",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally { setSaving(false); }
  }

  return (
    <div className="space-y-4 py-1">
      <p className="text-xs text-muted-foreground leading-relaxed">
        Select the days and hours when callers can book appointments.
        Monday–Friday 9am–5pm is pre-selected — click any day to toggle it on or off.
      </p>

      {/* Day toggles */}
      <div className="flex flex-wrap gap-2">
        {DAYS.map((day, i) => {
          const active = slots.some(s => s.dayOfWeek === i);
          return (
            <button
              key={i}
              onClick={() => toggleDay(i)}
              className={[
                "px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-background text-muted-foreground hover:border-foreground/40",
              ].join(" ")}
            >
              {day.slice(0, 3)}
            </button>
          );
        })}
      </div>

      {/* Time inputs per selected day */}
      {slots.length > 0 ? (
        <div className="space-y-2">
          {slots.map(slot => (
            <div key={slot.dayOfWeek} className="flex items-center gap-3 rounded-lg border bg-background px-3 py-2">
              <span className="w-9 text-xs font-medium shrink-0">{DAYS[slot.dayOfWeek]?.slice(0, 3)}</span>
              <input
                type="time"
                value={slot.startTime}
                onChange={e => updateSlot(slot.dayOfWeek, "startTime", e.target.value)}
                className="h-7 w-28 rounded border border-border bg-muted/30 px-2 text-xs"
              />
              <span className="text-xs text-muted-foreground">to</span>
              <input
                type="time"
                value={slot.endTime}
                onChange={e => updateSlot(slot.dayOfWeek, "endTime", e.target.value)}
                className="h-7 w-28 rounded border border-border bg-muted/30 px-2 text-xs"
              />
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground text-center py-2">
          No days selected — click the day buttons above to add them.
        </p>
      )}

      <Button
        className="w-full"
        disabled={saving || slots.length === 0}
        onClick={() => void handleSave()}
      >
        {saving
          ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Saving…</>
          : "Save Availability →"}
      </Button>
    </div>
  );
}

// ── Main Wizard ───────────────────────────────────────────────────────────────

export default function VibeSchedulingWizard({
  agentId,
  timezone,
  agentName = "Agent",
}: {
  agentId: number;
  timezone: string;
  agentName?: string;
}) {
  const [stepStatus, setStepStatus] = useState<StepStatus>({
    calendar: "idle", google: "idle", eventtype: "idle", availability: "idle",
  });
  const [activeStep,      setActiveStep]      = useState<Step | null>(null);
  const [calendarId,      setCalendarId]      = useState<number | null>(null);
  const [existingCal,     setExistingCal]     = useState<CalendarInfo | null>(null);
  const [eventTypeId,     setEventTypeId]     = useState<number | null>(null);
  const [initDone,        setInitDone]        = useState(false);
  const autoOpenFiredRef = useRef(false);

  // ── helpers ─────────────────────────────────────────────────────────────────

  const openNext = useCallback((completedStep: Step, currentStatus: StepStatus) => {
    const next = NEXT_STEP[completedStep];
    if (!next || currentStatus[next] === "done") return;
    setTimeout(() => {
      setActiveStep(next);
      setStepStatus(prev => ({ ...prev, [next]: "open" }));
    }, 300);
  }, []);

  function closeDialog() {
    setActiveStep(null);
    setStepStatus(prev => {
      const next = { ...prev };
      (Object.keys(next) as Step[]).forEach(k => { if (next[k] === "open") next[k] = "idle"; });
      return next;
    });
  }

  function isUnlocked(step: Step): boolean {
    const idx = STEPS.findIndex(s => s.id === step);
    if (idx === 0) return true;
    return STEPS.slice(0, idx).every(s => stepStatus[s.id] === "done");
  }

  function openStep(step: Step) {
    if (!isUnlocked(step) || stepStatus[step] === "verifying" || stepStatus[step] === "saving") return;
    setActiveStep(step);
    setStepStatus(prev => ({ ...prev, [step]: "open" }));
  }

  // ── API probes ───────────────────────────────────────────────────────────────

  const fetchCalendarForAgent = useCallback(async (): Promise<CalendarInfo | null> => {
    try {
      const cals = await customFetch<{
        id: number; agentId: number; name: string;
        hostEmail?: string | null; connectedGoogleEmail?: string | null;
      }[]>(`${API}/scheduling/calendars`);
      const cal = Array.isArray(cals) ? cals.find(c => c.agentId === agentId) : undefined;
      if (!cal) return null;
      return {
        id: cal.id,
        name: cal.name,
        hostEmail: cal.hostEmail ?? null,
        connectedGoogleEmail: cal.connectedGoogleEmail ?? null,
      };
    } catch { return null; }
  }, [agentId]);

  const checkAvailability = useCallback(async (calId: number): Promise<boolean> => {
    try {
      const rows = await customFetch<{ id: number; isActive: boolean }[]>(`${API}/scheduling/availability?calendarId=${calId}`);
      return Array.isArray(rows) && rows.some(r => r.isActive);
    } catch { return false; }
  }, []);

  const checkEventType = useCallback(async (calId: number): Promise<number | null> => {
    try {
      const rows = await customFetch<{ id: number }[]>(`${API}/scheduling/event-types?calendarId=${calId}`);
      return Array.isArray(rows) && rows.length > 0 ? (rows[0]?.id ?? null) : null;
    } catch { return null; }
  }, []);

  // ── on mount: resolve existing state ─────────────────────────────────────────

  useEffect(() => {
    async function init() {
      const cal = await fetchCalendarForAgent();
      const next: StepStatus = { calendar: "idle", google: "idle", eventtype: "idle", availability: "idle" };

      if (cal) {
        setCalendarId(cal.id);
        setExistingCal(cal);
        if (cal.hostEmail) {
          next.calendar = "done";
          if (cal.connectedGoogleEmail) next.google = "done";
          const [avail, etId] = await Promise.all([
            checkAvailability(cal.id),
            checkEventType(cal.id),
          ]);
          if (etId) { next.eventtype = "done"; setEventTypeId(etId); }
          if (avail) next.availability = "done";
        }
      }

      setStepStatus(next);
      setInitDone(true);
    }
    void init();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId]);

  // ── auto-open first incomplete step once init is done ─────────────────────────

  useEffect(() => {
    if (!initDone || autoOpenFiredRef.current) return;
    const allDone = STEPS.every(s => stepStatus[s.id] === "done");
    if (allDone) return;
    autoOpenFiredRef.current = true;
    const first = STEPS.find(s => stepStatus[s.id] !== "done");
    if (first) {
      setTimeout(() => {
        setActiveStep(first.id);
        setStepStatus(prev => ({ ...prev, [first.id]: "open" }));
      }, 250);
    }
  }, [initDone, stepStatus]);

  // ── step completion handlers ───────────────────────────────────────────────────

  function handleCalendarDone(id: number) {
    setCalendarId(id);
    setActiveStep(null);
    setStepStatus(prev => {
      const next = { ...prev, calendar: "done" as StepState };
      openNext("calendar", next);
      return next;
    });
  }

  function handleGoogleDone() {
    setActiveStep(null);
    setStepStatus(prev => {
      const next = { ...prev, google: "done" as StepState };
      openNext("google", next);
      return next;
    });
  }

  function handleEventTypeDone(id: number) {
    setEventTypeId(id);
    setActiveStep(null);
    setStepStatus(prev => {
      const next = { ...prev, eventtype: "done" as StepState };
      openNext("eventtype", next);
      return next;
    });
  }

  function handleAvailabilityDone() {
    setActiveStep(null);
    setStepStatus(prev => ({ ...prev, availability: "done" }));
  }

  // ── derived ─────────────────────────────────────────────────────────────────

  const allDone = STEPS.every(s => stepStatus[s.id] === "done");

  // ── init loading ─────────────────────────────────────────────────────────────

  if (!initDone) {
    return (
      <div className="rounded-xl border border-border/60 bg-background p-4 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin shrink-0" />
        Checking scheduling status…
      </div>
    );
  }

  // ── all done ─────────────────────────────────────────────────────────────────

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
          Calendar ready · Google connected · Availability set · Event type live
        </p>
      </div>
    );
  }

  // ── wizard card ──────────────────────────────────────────────────────────────

  return (
    <>
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-amber-500 shrink-0" />
          <p className="text-xs font-semibold text-amber-600 dark:text-amber-400">
            Set up scheduling — {STEPS.filter(s => stepStatus[s.id] === "done").length} of {STEPS.length} steps done
          </p>
        </div>

        <div className="space-y-1.5">
          {STEPS.map((step, idx) => {
            const state    = stepStatus[step.id];
            const unlocked = isUnlocked(step.id);
            return (
              <button
                key={step.id}
                disabled={!unlocked || state === "verifying" || state === "saving"}
                onClick={() => openStep(step.id)}
                className={[
                  "w-full flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors",
                  state === "done"
                    ? "border-green-500/30 bg-green-500/5 cursor-default"
                    : unlocked
                    ? "border-border/60 bg-background hover:bg-muted/50 cursor-pointer"
                    : "border-border/30 bg-muted/20 opacity-40 cursor-not-allowed",
                ].join(" ")}
              >
                <span className="shrink-0">
                  {state === "done" ? (
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                  ) : state === "verifying" || state === "saving" ? (
                    <Loader2 className="h-4 w-4 animate-spin text-amber-500" />
                  ) : (
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-500/10 text-amber-600 text-[10px] font-bold">
                      {idx + 1}
                    </span>
                  )}
                </span>
                <div className="flex-1 min-w-0">
                  <p className={["text-xs font-medium", state === "done" ? "text-green-700 dark:text-green-400" : "text-foreground"].join(" ")}>
                    {step.label}
                  </p>
                  <p className="text-[10px] text-muted-foreground truncate">{step.sub}</p>
                </div>
                {unlocked && state !== "done" && state !== "verifying" && state !== "saving" && (
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Step Dialog ── */}
      <Dialog open={activeStep !== null} onOpenChange={open => { if (!open) closeDialog(); }}>
        <DialogContent className="max-w-lg max-h-[90vh] flex flex-col overflow-hidden">
          <DialogHeader className="px-6 pt-6 shrink-0">
            <div className="flex items-center justify-between">
              <DialogTitle className="text-base">
                {activeStep === "calendar"     && (existingCal?.hostEmail ? "Update Calendar" : "Create Calendar")}
                {activeStep === "google"       && "Connect Google Account"}
                {activeStep === "eventtype"    && "Create Event Type"}
                {activeStep === "availability" && "Set Availability"}
              </DialogTitle>
              <button onClick={closeDialog} className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
            {/* Step indicator */}
            <div className="flex items-center gap-1 mt-2">
              {STEPS.map((s, i) => (
                <div
                  key={s.id}
                  className={[
                    "h-1 rounded-full flex-1 transition-colors",
                    stepStatus[s.id] === "done" ? "bg-green-500" :
                    activeStep === s.id          ? "bg-primary" :
                                                   "bg-border/40",
                  ].join(" ")}
                  title={`Step ${i + 1}: ${s.label}`}
                />
              ))}
            </div>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto px-6 pb-6">

            {activeStep === "calendar" && (
              <CalendarStep
                agentId={agentId}
                agentName={agentName}
                timezone={timezone}
                existingCalendar={existingCal}
                onDone={handleCalendarDone}
              />
            )}

            {activeStep === "google" && calendarId !== null && (
              <GoogleStep
                calendarId={calendarId}
                onLinked={handleGoogleDone}
                onSkip={() => {
                  closeDialog();
                  setStepStatus(prev => {
                    const next = { ...prev, google: "done" as StepState };
                    openNext("google", next);
                    return next;
                  });
                }}
              />
            )}

            {activeStep === "google" && calendarId === null && (
              <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading calendar…
              </div>
            )}

            {activeStep === "eventtype" && calendarId !== null && (
              <EventTypeStep
                calendarId={calendarId}
                onCreated={handleEventTypeDone}
              />
            )}

            {activeStep === "availability" && calendarId !== null && (
              <AvailabilityStep
                calendarId={calendarId}
                onSaved={handleAvailabilityDone}
              />
            )}

          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ──────────────────────────────────────────────────────────────────────────── */
/*  Standalone wizard used in the Scheduling page for existing agents           */
/* ──────────────────────────────────────────────────────────────────────────── */

export function SchedulingSetupPage({
  agentId,
  timezone,
  agentName,
}: {
  agentId: number;
  timezone: string;
  agentName?: string;
}) {
  return (
    <div className="max-w-lg mx-auto py-8 px-4">
      <div className="mb-6">
        <h2 className="text-lg font-semibold">Set up scheduling</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Complete these steps to enable appointment booking for your agent.
        </p>
      </div>
      <VibeSchedulingWizard agentId={agentId} timezone={timezone} agentName={agentName} />
    </div>
  );
}
