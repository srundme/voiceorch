import { useState, useEffect, useCallback } from "react";
import { Link } from "wouter";
import { Plus, Pencil, Trash2, MoreHorizontal, Calendar, ArrowLeft, Globe, Mail, Video } from "lucide-react";
import {
  useListCalendars,
  useCreateCalendar,
  useUpdateCalendar,
  useDeleteCalendar,
  useListAgents,
  getListCalendarsQueryKey,
} from "@workspace/api-client-react";
import type { SchedulingCalendar } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const API  = `${BASE}/api`;

type GoogleConnection = { id: string; email: string };

const TIMEZONES = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Phoenix",
  "America/Anchorage",
  "America/Honolulu",
  "America/Toronto",
  "America/Vancouver",
  "America/Sao_Paulo",
  "America/Buenos_Aires",
  "America/Mexico_City",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Madrid",
  "Europe/Rome",
  "Europe/Amsterdam",
  "Europe/Stockholm",
  "Europe/Moscow",
  "Europe/Istanbul",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Dhaka",
  "Asia/Bangkok",
  "Asia/Singapore",
  "Asia/Hong_Kong",
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Australia/Sydney",
  "Australia/Melbourne",
  "Australia/Perth",
  "Pacific/Auckland",
  "Africa/Cairo",
  "Africa/Lagos",
  "Africa/Johannesburg",
];

type FormState = {
  agentId: string;
  name: string;
  timezone: string;
  hostEmail: string;
  isActive: boolean;
};

function defaultForm(): FormState {
  return { agentId: "", name: "My Calendar", timezone: "UTC", hostEmail: "", isActive: true };
}

function CalendarFormDialog({
  open,
  onClose,
  editing,
}: {
  open: boolean;
  onClose: () => void;
  editing: SchedulingCalendar | null;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: agents } = useListAgents();
  const create = useCreateCalendar();
  const update = useUpdateCalendar();

  const [form, setForm] = useState<FormState>(() =>
    editing
      ? { agentId: String(editing.agentId), name: editing.name, timezone: editing.timezone, hostEmail: editing.hostEmail ?? "", isActive: editing.isActive }
      : defaultForm()
  );

  function set<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm(f => ({ ...f, [k]: v }));
  }

  async function submit() {
    if (!editing && !form.agentId) {
      toast({ title: "Select an agent", variant: "destructive" }); return;
    }
    if (!form.name.trim()) {
      toast({ title: "Name is required", variant: "destructive" }); return;
    }
    try {
      const hostEmail = form.hostEmail.trim() || null;
      if (editing) {
        await update.mutateAsync({ id: editing.id, data: { name: form.name, timezone: form.timezone, hostEmail, isActive: form.isActive } });
        toast({ title: "Calendar updated" });
      } else {
        await create.mutateAsync({ data: { agentId: parseInt(form.agentId), name: form.name, timezone: form.timezone, hostEmail, isActive: form.isActive } });
        toast({ title: "Calendar created" });
      }
      await qc.invalidateQueries({ queryKey: getListCalendarsQueryKey() });
      onClose();
    } catch (e: any) {
      toast({ title: "Error", description: e?.message ?? "Something went wrong", variant: "destructive" });
    }
  }

  const busy = create.isPending || update.isPending;

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit Calendar" : "New Calendar"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "Update this calendar's name, timezone, or active status."
              : "Create a calendar linked to one of your agents. Each agent can have one calendar."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {!editing && (
            <div className="space-y-1.5">
              <Label>Agent <span className="text-red-500">*</span></Label>
              <Select value={form.agentId} onValueChange={v => set("agentId", v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select an agent…" />
                </SelectTrigger>
                <SelectContent>
                  {agents?.map(a => (
                    <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                One calendar per agent. Choose the agent that will handle bookings.
              </p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Calendar name <span className="text-red-500">*</span></Label>
            <Input
              value={form.name}
              onChange={e => set("name", e.target.value)}
              placeholder="e.g. Sales Calls, Demo Bookings"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Timezone</Label>
            <Select value={form.timezone} onValueChange={v => set("timezone", v)}>
              <SelectTrigger>
                <Globe className="h-3.5 w-3.5 mr-2 text-muted-foreground" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-64">
                {TIMEZONES.map(tz => (
                  <SelectItem key={tz} value={tz}>{tz.replace(/_/g, " ")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Availability windows and booking slots will use this timezone.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>Host / organizer email</Label>
            <Input
              type="email"
              value={form.hostEmail}
              onChange={e => set("hostEmail", e.target.value)}
              placeholder="you@example.com"
            />
            <p className="text-xs text-muted-foreground">
              When set, a separate notification email is sent to this address on every booking, cancellation, and reschedule.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Switch checked={form.isActive} onCheckedChange={v => set("isActive", v)} />
            <Label>Active</Label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={busy}>
            {busy ? "Saving…" : editing ? "Save changes" : "Create calendar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CalendarCard({
  calendar,
  agentName,
  googleConnections,
  linkedConnectionId,
  onLinkChange,
}: {
  calendar: SchedulingCalendar;
  agentName?: string;
  googleConnections: GoogleConnection[];
  linkedConnectionId: string | null;
  onLinkChange: (calendarId: number, connectionId: string | null) => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const del = useDeleteCalendar();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [linkingGcal, setLinkingGcal] = useState(false);

  async function confirmDelete() {
    try {
      await del.mutateAsync({ id: calendar.id });
      await qc.invalidateQueries({ queryKey: getListCalendarsQueryKey() });
      toast({ title: "Calendar deleted" });
    } catch {
      toast({ title: "Delete failed", variant: "destructive" });
    }
  }

  async function handleGcalChange(value: string) {
    const connectionId = value === "__none__" ? null : value;
    setLinkingGcal(true);
    try {
      const r = await fetch(`${API}/scheduling/calendars/${calendar.id}/google-connection`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ connectionId }),
      });
      if (!r.ok) throw new Error("Failed");
      onLinkChange(calendar.id, connectionId);
      toast({ title: connectionId ? "Google account linked" : "Google account unlinked" });
    } catch {
      toast({ title: "Failed to update Google account", variant: "destructive" });
    } finally {
      setLinkingGcal(false);
    }
  }

  return (
    <>
      <Card className="hover:shadow-sm transition-all">
        <CardContent className="flex items-center gap-4 py-4">
          <div className="p-2.5 rounded-xl bg-emerald-50 text-emerald-600 shrink-0">
            <Calendar className="h-4 w-4" />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-sm">{calendar.name}</span>
              {!calendar.isActive && (
                <Badge variant="outline" className="text-xs text-gray-400">Inactive</Badge>
              )}
              {calendar.isActive && (
                <Badge variant="outline" className="text-xs bg-emerald-50 text-emerald-700 border-emerald-200">Active</Badge>
              )}
            </div>
            <div className="flex items-center gap-3 mt-0.5 flex-wrap">
              {agentName && (
                <span className="text-xs text-muted-foreground">Agent: {agentName}</span>
              )}
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Globe className="h-3 w-3" />
                {calendar.timezone.replace(/_/g, " ")}
              </span>
              {calendar.hostEmail && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Mail className="h-3 w-3" />
                  {calendar.hostEmail}
                </span>
              )}
              <span className="text-xs text-muted-foreground">
                Created {formatDistanceToNow(new Date(calendar.createdAt), { addSuffix: true })}
              </span>
            </div>

            {/* Google account assignment */}
            {googleConnections.length > 0 && (
              <div className="flex items-center gap-2 mt-2">
                <Video className="h-3 w-3 text-muted-foreground shrink-0" />
                <Select
                  value={linkedConnectionId ?? "__none__"}
                  onValueChange={handleGcalChange}
                  disabled={linkingGcal}
                >
                  <SelectTrigger className="h-6 text-xs border-dashed w-auto min-w-[200px] gap-1 px-2">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__" className="text-xs text-muted-foreground">
                      — Use default Google account
                    </SelectItem>
                    {googleConnections.map(c => (
                      <SelectItem key={c.id} value={c.id} className="text-xs">
                        {c.email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setEditOpen(true)}>
                <Pencil className="h-3.5 w-3.5 mr-2" /> Edit
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </CardContent>
      </Card>

      <CalendarFormDialog open={editOpen} onClose={() => setEditOpen(false)} editing={calendar} />

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete calendar?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>{calendar.name}</strong> and all its event types, availability schedules, and bookings. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmDelete()} className="bg-destructive hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default function CalendarsPage() {
  const [createOpen, setCreateOpen] = useState(false);
  const { data: calendars, isLoading } = useListCalendars();
  const { data: agents } = useListAgents();

  const [googleConnections, setGoogleConnections] = useState<GoogleConnection[]>([]);
  // calendarId → connectionId (or null)
  const [calendarLinks, setCalendarLinks] = useState<Record<number, string | null>>({});

  const agentMap = new Map(agents?.map(a => [a.id, a.name]) ?? []);

  const loadGoogleData = useCallback(async () => {
    try {
      const [connsRes, linksRes] = await Promise.all([
        fetch(`${API}/scheduling/google/connections`, { credentials: "include" }),
        fetch(`${API}/scheduling/google/calendar-links`, { credentials: "include" }),
      ]);
      if (connsRes.ok) setGoogleConnections(await connsRes.json());
      if (linksRes.ok) setCalendarLinks(await linksRes.json());
    } catch { /* non-fatal */ }
  }, []);

  useEffect(() => { void loadGoogleData(); }, [loadGoogleData]);

  function handleLinkChange(calendarId: number, connectionId: string | null) {
    setCalendarLinks(prev => ({ ...prev, [calendarId]: connectionId }));
  }

  return (
    <div className="flex flex-col gap-6 p-6 max-w-3xl mx-auto">
      {/* Back + header */}
      <div>
        <Link href={`${BASE}/app/scheduling`}>
          <button className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4 transition-colors">
            <ArrowLeft className="h-3.5 w-3.5" /> Scheduling
          </button>
        </Link>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">Calendars</h1>
            <p className="text-sm text-muted-foreground">One calendar per agent — links the agent to bookable event types</p>
          </div>
          <Button size="sm" onClick={() => setCreateOpen(true)} className="gap-1.5">
            <Plus className="h-4 w-4" /> New Calendar
          </Button>
        </div>
      </div>

      {/* Google Meet prompt (only if no connections) */}
      {googleConnections.length === 0 && (calendars?.length ?? 0) > 0 && (
        <div className="flex items-center justify-between bg-blue-50 border border-blue-200 rounded-xl px-4 py-3">
          <p className="text-sm text-blue-800">
            <strong>Connect Google Calendar</strong> to auto-generate Meet links for bookings
          </p>
          <Link href={`${BASE}/app/settings/conferencing`}>
            <Button size="sm" variant="outline" className="border-blue-300 text-blue-700 hover:bg-blue-100 gap-1.5">
              <Video className="h-3.5 w-3.5" /> Connect
            </Button>
          </Link>
        </div>
      )}

      {/* Setup guide (only shown when empty) */}
      {!isLoading && (!calendars || calendars.length === 0) && (
        <div className="bg-emerald-50/60 border border-emerald-200 rounded-xl p-5 space-y-3">
          <p className="text-sm font-semibold text-emerald-800">Get started in 3 steps</p>
          <ol className="space-y-1.5 text-sm text-emerald-700 list-decimal list-inside">
            <li><strong>Create a calendar</strong> — pick an agent and set your timezone</li>
            <li>Go to <strong>Event Types</strong> — define meeting types (30-min demo, 60-min onboarding, etc.)</li>
            <li>Go to <strong>Availability</strong> — set weekly hours so slots are generated</li>
          </ol>
          <Button size="sm" onClick={() => setCreateOpen(true)} className="gap-1.5 mt-1">
            <Plus className="h-4 w-4" /> Create your first calendar
          </Button>
        </div>
      )}

      {/* Calendar list */}
      <div className="space-y-3">
        {isLoading && [1, 2].map(i => (
          <div key={i} className="h-20 bg-muted/40 rounded-xl animate-pulse" />
        ))}
        {calendars?.map(cal => (
          <CalendarCard
            key={cal.id}
            calendar={cal}
            agentName={agentMap.get(cal.agentId)}
            googleConnections={googleConnections}
            linkedConnectionId={calendarLinks[cal.id] ?? null}
            onLinkChange={handleLinkChange}
          />
        ))}
      </div>

      <CalendarFormDialog open={createOpen} onClose={() => setCreateOpen(false)} editing={null} />
    </div>
  );
}
