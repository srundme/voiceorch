import { useState } from "react";
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
import {
  ArrowLeft, Copy, Check, Clock, Calendar, Settings, Zap, AlertTriangle,
  Link2, Layers, ExternalLink, Trash2,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

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
    } catch (e: any) {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    await deleteMut.mutateAsync({ id });
    await qc.invalidateQueries({ queryKey: getListEventTypesQueryKey({}) });
    navigate(`${BASE}/app/scheduling/event-types`);
    toast({ title: "Event type deleted" });
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

              <div className="space-y-1.5">
                <Label>Add to calendar</Label>
                {calendar ? (
                  <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg border bg-muted/20">
                    <Calendar className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{calendar.name}</p>
                      {(calendar as any).googleConnectionId && (
                        <p className="text-xs text-muted-foreground">Google Calendar connected</p>
                      )}
                    </div>
                    <Badge variant="outline" className="text-[10px]">Default</Badge>
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground italic">No calendar assigned.</div>
                )}
                <p className="text-xs text-muted-foreground">
                  To change the calendar, re-create this event type.{" "}
                  <Link href={`${BASE}/app/scheduling/calendars`} className="underline text-foreground">
                    Manage calendars →
                  </Link>
                </p>
              </div>

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
