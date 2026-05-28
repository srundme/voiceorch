import { useState, useEffect, useCallback } from "react";
import { useRoute, Link, useLocation } from "wouter";
import {
  useGetEventType,
  useUpdateEventType,
  useDeleteEventType,
  useListCalendars,
  useListAvailability,
  getListEventTypesQueryKey,
  getListAvailabilityQueryKey,
  getGetEventTypeQueryKey,
  customFetch,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { formatApiError } from "@/lib/format-api-error";
import {
  ArrowLeft, Copy, Check, Clock, Calendar, Settings, Zap, AlertTriangle,
  Link2, Layers, ExternalLink, Trash2, Plus, Loader2, CheckCircle2,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const API  = `${BASE}/api`;
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

type GoogleConnection = { id: string; email: string };

type Section = "basics" | "availability" | "limits" | "advanced";

const NAV: { id: Section; label: string; sub: string; icon: React.ElementType }[] = [
  { id: "basics",       label: "Basics",       sub: "Title, URL & duration",        icon: Layers },
  { id: "availability", label: "Availability",  sub: "Working hours",                icon: Calendar },
  { id: "limits",       label: "Limits",        sub: "How often you can be booked",  icon: Clock },
  { id: "advanced",     label: "Advanced",      sub: "Calendar settings & more",     icon: Settings },
];

function SlugCopyBox({ slug }: { slug: string }) {
  const [copied, setCopied] = useState(false);
  const url = `${window.location.origin}${BASE}/book/${slug}`;
  function copy() {
    void navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-muted/60 rounded-lg border text-sm font-mono text-muted-foreground">
      <span className="flex-1 truncate">{window.location.origin}{BASE}/book/<strong className="text-foreground">{slug}</strong></span>
      <button onClick={copy} className="shrink-0 text-muted-foreground hover:text-foreground transition-colors">
        {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
      <a href={`${BASE}/book/${slug}`} target="_blank" rel="noopener noreferrer"
        className="shrink-0 text-muted-foreground hover:text-foreground transition-colors">
        <ExternalLink className="h-3.5 w-3.5" />
      </a>
    </div>
  );
}

export default function EventTypeDetailPage() {
  const [, params] = useRoute("/app/scheduling/event-types/:id");
  const [, navigate] = useLocation();
  const id = parseInt(params?.id ?? "0", 10);
  const qc = useQueryClient();
  const { toast } = useToast();

  const [section, setSection] = useState<Section>("basics");
  const [dirty, setDirty]     = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [saving, setSaving]   = useState(false);

  // Google Calendar connection state
  const [googleConnections,  setGoogleConnections]  = useState<GoogleConnection[]>([]);
  const [calendarLinks,      setCalendarLinks]      = useState<Record<number, string | null>>({});
  const [gcalLoading,        setGcalLoading]        = useState(true);
  const [connecting,         setConnecting]         = useState(false);
  const [linkingGcal,        setLinkingGcal]        = useState(false);

  const { data: et, isLoading } = useGetEventType(id, {
    query: { enabled: !!id, queryKey: getGetEventTypeQueryKey(id) },
  });
  const { data: calendars } = useListCalendars();
  const { data: schedules } = useListAvailability(
    { calendarId: et?.calendarId ?? 0 },
    { query: { enabled: !!et?.calendarId, queryKey: getListAvailabilityQueryKey({ calendarId: et?.calendarId ?? 0 }) } }
  );

  const updateMut = useUpdateEventType();
  const deleteMut = useDeleteEventType();

  // Load Google connections + calendar → connection mapping
  const loadGoogleData = useCallback(async () => {
    try {
      const [conns, links] = await Promise.all([
        customFetch<GoogleConnection[]>(`${API}/scheduling/google/connections`),
        customFetch<Record<number, string | null>>(`${API}/scheduling/google/calendar-links`),
      ]);
      setGoogleConnections(conns);
      setCalendarLinks(links);
    } catch { /* non-fatal */ } finally {
      setGcalLoading(false);
    }
  }, []);

  useEffect(() => { void loadGoogleData(); }, [loadGoogleData]);

  // Handle OAuth return (?gcal=connected) in this tab (popup flow)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const gcal  = params.get("gcal");
    const email = params.get("email");
    if (gcal === "connected") {
      window.history.replaceState({}, "", window.location.pathname);
      toast({ title: "Google account connected!", description: email ? `${email} is now linked.` : undefined });
      setTimeout(() => void loadGoogleData(), 600);
      setConnecting(false);
    } else if (gcal === "error") {
      window.history.replaceState({}, "", window.location.pathname);
      toast({ title: "Connection failed", description: "Google sign-in failed. Please try again.", variant: "destructive" });
      setConnecting(false);
    }
  }, [toast, loadGoogleData]);

  // Receive broadcast from OAuth popup → reload in opener tab
  useEffect(() => {
    let ch: BroadcastChannel;
    try {
      ch = new BroadcastChannel("google-oauth");
      ch.onmessage = (e: MessageEvent<{ type: string; email?: string }>) => {
        if (e.data?.type === "connected") {
          toast({ title: "Google account connected!", description: e.data.email ?? undefined });
          setTimeout(() => void loadGoogleData(), 600);
          setConnecting(false);
        } else if (e.data?.type === "error") {
          toast({ title: "Connection failed", description: "Google sign-in failed. Please try again.", variant: "destructive" });
          setConnecting(false);
        }
      };
    } catch { /* BroadcastChannel not available */ }
    return () => { try { ch?.close(); } catch { /* noop */ } };
  }, [toast, loadGoogleData]);

  async function handleConnectGoogle() {
    setConnecting(true);
    try {
      const { url } = await customFetch<{ url: string }>(
        `${API}/scheduling/google/connect-url?returnTo=calendar&returnOrigin=${encodeURIComponent(window.location.origin)}`
      );
      const popup = window.open(url, "_blank", "noopener,width=500,height=650");
      if (!popup) {
        // Fallback: redirect in same tab
        window.location.href = url;
      }
    } catch {
      toast({ title: "Could not start Google sign-in", variant: "destructive" });
      setConnecting(false);
    }
  }

  async function handleGcalChange(calendarId: number, value: string) {
    const connectionId = value === "__none__" ? null : value;
    setLinkingGcal(true);
    try {
      await customFetch(`${API}/scheduling/calendars/${calendarId}/google-connection`, {
        method: "PATCH",
        body: JSON.stringify({ connectionId }),
      });
      setCalendarLinks(prev => ({ ...prev, [calendarId]: connectionId }));
      toast({ title: connectionId ? "Google account linked" : "Google account unlinked" });
    } catch {
      toast({ title: "Failed to update Google account", variant: "destructive" });
    } finally {
      setLinkingGcal(false);
    }
  }

  const [form, setForm] = useState<{
    name: string;
    description: string;
    durationMinutes: number;
    bufferBeforeMins: number;
    bufferAfterMins: number;
    confirmationMode: "instant" | "manual";
    maxBookingsPerSlot: number;
    isActive: boolean;
  } | null>(null);

  if (!form && et) {
    setForm({
      name: et.name,
      description: et.description ?? "",
      durationMinutes: et.durationMinutes,
      bufferBeforeMins: et.bufferBeforeMins,
      bufferAfterMins: et.bufferAfterMins,
      confirmationMode: et.confirmationMode,
      maxBookingsPerSlot: et.maxBookingsPerSlot,
      isActive: et.isActive,
    });
  }

  function setField<K extends keyof NonNullable<typeof form>>(k: K, v: NonNullable<typeof form>[K]) {
    setForm(f => f ? { ...f, [k]: v } : f);
    setDirty(true);
  }

  async function save() {
    if (!form) return;
    setSaving(true);
    try {
      await updateMut.mutateAsync({ id, data: { ...form } });
      await qc.invalidateQueries({ queryKey: getListEventTypesQueryKey({}) });
      setDirty(false);
      toast({ title: "Saved" });
    } catch (e) {
      toast({ title: "Save failed", description: formatApiError(e), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    try {
      await deleteMut.mutateAsync({ id });
      await qc.invalidateQueries({ queryKey: getListEventTypesQueryKey({}) });
      navigate(`${BASE}/app/scheduling/event-types`);
      toast({ title: "Event type deleted" });
    } catch (e) {
      toast({ title: "Delete failed", description: formatApiError(e), variant: "destructive" });
    }
  }

  const calendar = calendars?.find(c => c.id === et?.calendarId);

  if (isLoading || !form) {
    return (
      <div className="flex flex-col h-full">
        <div className="border-b px-6 py-3 flex items-center gap-4">
          <Skeleton className="h-8 w-8 rounded" />
          <Skeleton className="h-5 w-48" />
        </div>
        <div className="flex-1 flex">
          <div className="w-64 border-r p-4 space-y-2">
            {[1,2,3,4].map(i => <Skeleton key={i} className="h-12 rounded-lg" />)}
          </div>
          <div className="flex-1 p-8 space-y-4">
            {[1,2,3].map(i => <Skeleton key={i} className="h-10 rounded" />)}
          </div>
        </div>
      </div>
    );
  }

  if (!et) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-muted-foreground">
        <AlertTriangle className="h-8 w-8" />
        <p>Event type not found.</p>
        <Link href={`${BASE}/app/scheduling/event-types`}>
          <Button variant="outline">Back to Event Types</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Top bar */}
      <div className="border-b bg-background px-4 py-2.5 flex items-center gap-3 shrink-0">
        <Link href={`${BASE}/app/scheduling/event-types`}>
          <Button variant="ghost" size="icon" className="h-7 w-7">
            <ArrowLeft className="h-3.5 w-3.5" />
          </Button>
        </Link>
        <h1 className="font-semibold text-sm text-foreground truncate flex-1">{et.name}</h1>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Switch
            checked={form.isActive}
            onCheckedChange={v => { setField("isActive", v); }}
            className="scale-90"
          />
          <span>{form.isActive ? "Active" : "Inactive"}</span>
        </div>
        <a href={`${BASE}/book/${et.slug}`} target="_blank" rel="noopener noreferrer">
          <Button variant="ghost" size="icon" className="h-7 w-7">
            <Link2 className="h-3.5 w-3.5" />
          </Button>
        </a>
        <Button
          variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive"
          onClick={() => setDeleteOpen(true)}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="sm"
          onClick={save}
          disabled={!dirty || saving}
          className="h-7 px-3 text-xs"
        >
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar */}
        <nav className="w-56 shrink-0 border-r bg-muted/20 overflow-y-auto py-3 px-2 space-y-0.5">
          {NAV.map(({ id: navId, label, sub, icon: Icon }) => (
            <button
              key={navId}
              onClick={() => setSection(navId)}
              className={`w-full flex items-start gap-2.5 px-3 py-2.5 rounded-lg text-left transition-colors ${
                section === navId
                  ? "bg-background border border-border/60 shadow-sm"
                  : "hover:bg-background/60"
              }`}
            >
              <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${section === navId ? "text-foreground" : "text-muted-foreground"}`} />
              <div>
                <p className={`text-sm font-medium leading-tight ${section === navId ? "text-foreground" : "text-muted-foreground"}`}>{label}</p>
                <p className="text-[11px] text-muted-foreground leading-tight mt-0.5">{sub}</p>
              </div>
              {section === navId && (
                <span className="ml-auto text-muted-foreground">›</span>
              )}
            </button>
          ))}

          <div className="pt-3 px-2">
            <div className="h-px bg-border mb-3" />
            {[
              { icon: Zap, label: "Workflows", sub: "0 active" },
            ].map(({ icon: Icon, label, sub }) => (
              <div key={label} className="flex items-start gap-2.5 px-1 py-2 opacity-40 cursor-not-allowed rounded-lg">
                <Icon className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium leading-tight text-muted-foreground">{label}</p>
                  <p className="text-[11px] text-muted-foreground leading-tight mt-0.5">{sub}</p>
                </div>
              </div>
            ))}
          </div>
        </nav>

        {/* Main content */}
        <main className="flex-1 overflow-y-auto p-6 md:p-8 max-w-2xl">
          {section === "basics" && (
            <div className="space-y-6">
              <div>
                <h2 className="text-base font-semibold mb-4">Basics</h2>
              </div>

              <div className="space-y-1.5">
                <Label>Title</Label>
                <Input
                  value={form.name}
                  onChange={e => setField("name", e.target.value)}
                  className="text-base"
                />
              </div>

              <div className="space-y-1.5">
                <Label>Description</Label>
                <textarea
                  value={form.description}
                  onChange={e => setField("description", e.target.value)}
                  placeholder="Describe what this event type is about…"
                  rows={4}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
                />
              </div>

              <div className="space-y-1.5">
                <Label>URL</Label>
                <SlugCopyBox slug={et.slug} />
                <p className="text-[11px] text-muted-foreground">Slug is fixed after creation.</p>
              </div>

              <div className="space-y-1.5">
                <Label>Duration</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={5}
                    max={1440}
                    value={form.durationMinutes}
                    onChange={e => setField("durationMinutes", parseInt(e.target.value) || 30)}
                    className="w-28"
                  />
                  <span className="text-sm text-muted-foreground">minutes</span>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Confirmation</Label>
                <Select
                  value={form.confirmationMode}
                  onValueChange={v => setField("confirmationMode", v as "instant" | "manual")}
                >
                  <SelectTrigger className="w-56">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="instant">Instant — confirm automatically</SelectItem>
                    <SelectItem value="manual">Manual — you approve each booking</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {section === "availability" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold">Availability</h2>
                <Link href={`${BASE}/app/scheduling/availability`}>
                  <Button variant="outline" size="sm" className="gap-1.5 text-xs">
                    <ExternalLink className="h-3 w-3" /> Edit availability
                  </Button>
                </Link>
              </div>

              <div className="rounded-lg border bg-background overflow-hidden">
                <div className="px-4 py-3 border-b bg-muted/30 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px] bg-background">working days</Badge>
                    <Badge variant="secondary" className="text-[10px]">Default</Badge>
                  </div>
                  {calendar && (
                    <span className="text-xs text-muted-foreground">{calendar.name}</span>
                  )}
                </div>

                {!schedules || schedules.length === 0 ? (
                  <div className="p-6 text-center text-sm text-muted-foreground">
                    No availability schedule set up yet.{" "}
                    <Link href={`${BASE}/app/scheduling/availability`} className="underline text-foreground">
                      Add availability →
                    </Link>
                  </div>
                ) : (
                  <div className="divide-y">
                    {DAYS.map((day, idx) => {
                      const slots = schedules.filter(s => s.dayOfWeek === idx && s.isActive);
                      return (
                        <div key={day} className="flex items-center gap-4 px-4 py-3">
                          <span className="w-28 text-sm text-muted-foreground">{day}</span>
                          {slots.length === 0 ? (
                            <span className="text-sm text-muted-foreground italic">Unavailable</span>
                          ) : (
                            <div className="flex flex-wrap gap-2">
                              {slots.map(s => (
                                <span key={s.id} className="text-sm font-medium">
                                  {s.startTime} – {s.endTime}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {section === "limits" && (
            <div className="space-y-6">
              <h2 className="text-base font-semibold">Limits</h2>

              <div className="space-y-1.5">
                <Label>Max bookings per slot</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={1}
                    max={100}
                    value={form.maxBookingsPerSlot}
                    onChange={e => setField("maxBookingsPerSlot", parseInt(e.target.value) || 1)}
                    className="w-24"
                  />
                  <span className="text-xs text-muted-foreground">attendees per time slot</span>
                </div>
              </div>

              <div className="space-y-3">
                <Label>Buffer time</Label>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <p className="text-xs text-muted-foreground">Before event</p>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min={0}
                        max={120}
                        value={form.bufferBeforeMins}
                        onChange={e => setField("bufferBeforeMins", parseInt(e.target.value) || 0)}
                        className="w-20"
                      />
                      <span className="text-xs text-muted-foreground">min</span>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <p className="text-xs text-muted-foreground">After event</p>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min={0}
                        max={120}
                        value={form.bufferAfterMins}
                        onChange={e => setField("bufferAfterMins", parseInt(e.target.value) || 0)}
                        className="w-20"
                      />
                      <span className="text-xs text-muted-foreground">min</span>
                    </div>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Buffer time prevents back-to-back bookings and gives you preparation/follow-up time.
                </p>
              </div>
            </div>
          )}

          {section === "advanced" && (
            <div className="space-y-6">
              <h2 className="text-base font-semibold">Advanced</h2>

              {/* Add to calendar */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>Add to calendar</Label>
                  {googleConnections.length > 0 && (
                    <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-xs font-normal">
                      <CheckCircle2 className="h-3 w-3 mr-1" />
                      {googleConnections.length === 1 ? "1 account" : `${googleConnections.length} accounts`} connected
                    </Badge>
                  )}
                </div>

                {/* Google Calendar card */}
                <div className="rounded-xl border bg-card">
                  <div className="flex items-center justify-between gap-4 px-4 py-3 border-b">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center border shrink-0">
                        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none">
                          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                          <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                        </svg>
                      </div>
                      <div>
                        <p className="text-sm font-medium">Google Calendar</p>
                        <p className="text-xs text-muted-foreground">Auto-generates Google Meet links for every booking</p>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant={googleConnections.length > 0 ? "outline" : "default"}
                      onClick={handleConnectGoogle}
                      disabled={connecting || gcalLoading}
                      className="shrink-0 gap-1.5 text-xs"
                    >
                      {connecting
                        ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Redirecting…</>
                        : <><Plus className="h-3.5 w-3.5" /> {googleConnections.length > 0 ? "Add account" : "Connect Google"}</>
                      }
                    </Button>
                  </div>

                  <div className="p-3 space-y-2">
                    {gcalLoading ? (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground py-1 px-1">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading connected accounts…
                      </div>
                    ) : googleConnections.length === 0 ? (
                      <div className="flex items-center gap-2 px-1 py-1 text-xs text-muted-foreground">
                        <Link2 className="h-3.5 w-3.5 shrink-0" />
                        No Google account connected — click <strong className="mx-1">Connect Google</strong> to sign in and enable Meet links
                      </div>
                    ) : (
                      <>
                        <p className="text-[11px] text-muted-foreground px-1 pb-0.5">
                          Select which account to use for <strong>{calendar?.name ?? "this calendar"}</strong>:
                        </p>
                        {calendar && (
                          <Select
                            value={calendarLinks[calendar.id] ?? "__none__"}
                            onValueChange={v => void handleGcalChange(calendar.id, v)}
                            disabled={linkingGcal}
                          >
                            <SelectTrigger className="text-sm">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none__" className="text-sm text-muted-foreground">
                                — No Google account (use platform default)
                              </SelectItem>
                              {googleConnections.map(conn => (
                                <SelectItem key={conn.id} value={conn.id} className="text-sm">
                                  <div className="flex items-center gap-2">
                                    <div className="w-5 h-5 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
                                      <span className="text-[10px] font-semibold text-blue-700">
                                        {conn.email[0]?.toUpperCase()}
                                      </span>
                                    </div>
                                    <span>Google ({conn.email})</span>
                                  </div>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          {googleConnections.map(conn => (
                            <div key={conn.id} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs transition-colors ${
                              calendar && calendarLinks[calendar.id] === conn.id
                                ? "bg-blue-50 border-blue-200 text-blue-700"
                                : "bg-muted/40 text-muted-foreground"
                            }`}>
                              <div className="w-4 h-4 rounded-full bg-white flex items-center justify-center border text-[9px] font-bold text-blue-600">
                                {conn.email[0]?.toUpperCase()}
                              </div>
                              {conn.email}
                              {calendar && calendarLinks[calendar.id] === conn.id && (
                                <CheckCircle2 className="h-3 w-3" />
                              )}
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                </div>

                <p className="text-[11px] text-muted-foreground">
                  This setting applies to the calendar <strong>{calendar?.name ?? "(unknown)"}</strong> linked to this event type.{" "}
                  <Link href={`${BASE}/app/scheduling/calendars`} className="underline text-foreground">
                    Manage all calendars →
                  </Link>
                </p>
              </div>

              {/* Webhooks */}
              <div className="rounded-lg border bg-muted/10 p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <Zap className="h-4 w-4 text-amber-500" />
                  <p className="text-sm font-medium">Webhooks</p>
                </div>
                <p className="text-xs text-muted-foreground">
                  Receive HTTP POST events when a booking is created, confirmed, or cancelled on this event type.
                </p>
                <Link href={`${BASE}/app/webhooks`}>
                  <Button variant="outline" size="sm" className="text-xs gap-1.5 mt-1">
                    <ExternalLink className="h-3 w-3" /> Manage webhooks
                  </Button>
                </Link>
              </div>
            </div>
          )}
        </main>
      </div>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{et.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this event type and remove the booking page at <code className="font-mono">/book/{et.slug}</code>. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={handleDelete}
              disabled={deleteMut.isPending}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
