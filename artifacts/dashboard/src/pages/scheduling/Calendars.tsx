import { useState, useEffect, useCallback } from "react";
import { Link } from "wouter";
import { Plus, Pencil, Trash2, MoreHorizontal, Calendar, ArrowLeft, Globe, Mail, Video, Loader2, CheckCircle2, Link2 } from "lucide-react";
import {
  useListCalendars,
  useCreateCalendar,
  useUpdateCalendar,
  useDeleteCalendar,
  useListAgents,
  getListCalendarsQueryKey,
  customFetch,
} from "@workspace/api-client-react";
import type { SchedulingCalendar } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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
import { formatApiError } from "@/lib/format-api-error";
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
    } catch (e) {
      toast({ title: "Error", description: formatApiError(e), variant: "destructive" });
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
              <Label>Agent <span className="text-foreground">*</span></Label>
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
            <Label>Calendar name <span className="text-foreground">*</span></Label>
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
    } catch (e) {
      toast({ title: "Delete failed", description: formatApiError(e), variant: "destructive" });
    }
  }

  async function handleGcalChange(value: string) {
    const connectionId = value === "__none__" ? null : value;
    setLinkingGcal(true);
    try {
      await customFetch(`${API}/scheduling/calendars/${calendar.id}/google-connection`, {
        method: "PATCH",
        body: JSON.stringify({ connectionId }),
      });
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
          <div className="p-2.5 rounded-xl bg-muted text-foreground shrink-0">
            <Calendar className="h-4 w-4" />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-sm">{calendar.name}</span>
              {!calendar.isActive && (
                <Badge variant="outline" className="text-xs text-muted-foreground">Inactive</Badge>
              )}
              {calendar.isActive && (
                <Badge variant="outline" className="text-xs bg-muted text-foreground border-border">Active</Badge>
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

export default function CalendarsPage({ embedded = false }: { embedded?: boolean }) {
  const [createOpen, setCreateOpen] = useState(false);
  const { data: calendars, isLoading } = useListCalendars();
  const { data: agents } = useListAgents();
  const { toast } = useToast();

  const [googleConnections, setGoogleConnections] = useState<GoogleConnection[]>([]);
  const [calendarLinks, setCalendarLinks] = useState<Record<number, string | null>>({});
  const [gcalLoading,  setGcalLoading]  = useState(true);
  const [connecting,   setConnecting]   = useState(false);
  const [removingId,   setRemovingId]   = useState<string | null>(null);

  const agentMap = new Map(agents?.map(a => [a.id, a.name]) ?? []);

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

  // Handle OAuth return in THIS tab (?gcal=connected / ?gcal=error)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const gcal  = params.get("gcal");
    const email = params.get("email");
    if (gcal === "connected") {
      window.history.replaceState({}, "", window.location.pathname);
      try {
        const ch = new BroadcastChannel("google-oauth");
        ch.postMessage({ type: "connected", email: email ?? "" });
        ch.close();
      } catch { /* noop */ }
      toast({
        title: "Google account connected!",
        description: email ? `${email} is now linked.` : "Google Calendar connected.",
      });
      setTimeout(() => void loadGoogleData(), 600);
      setTimeout(() => { try { window.close(); } catch { /* noop */ } }, 1800);
    } else if (gcal === "error") {
      window.history.replaceState({}, "", window.location.pathname);
      try {
        const ch = new BroadcastChannel("google-oauth");
        ch.postMessage({ type: "error" });
        ch.close();
      } catch { /* noop */ }
      toast({ title: "Connection failed", description: "Google sign-in failed. Please try again.", variant: "destructive" });
      setTimeout(() => { try { window.close(); } catch { /* noop */ } }, 1800);
    }
  }, [toast, loadGoogleData]);

  // Receive broadcast from OAuth popup → reload Google data in original tab
  useEffect(() => {
    let ch: BroadcastChannel;
    try {
      ch = new BroadcastChannel("google-oauth");
      ch.onmessage = (e: MessageEvent<{ type: string; email?: string }>) => {
        if (e.data?.type === "connected") {
          toast({
            title: "Google account connected!",
            description: e.data.email ? `${e.data.email} is now linked.` : "Google Calendar connected.",
          });
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

  async function handleConnect() {
    setConnecting(true);
    try {
      const { url } = await customFetch<{ url: string }>(`${API}/scheduling/google/connect-url?returnTo=calendar&returnOrigin=${encodeURIComponent(window.location.origin)}`);
      window.open(url, "_blank", "noopener");
    } catch {
      toast({ title: "Could not start Google sign-in", variant: "destructive" });
      setConnecting(false);
    }
  }

  async function handleRemoveGoogle(id: string) {
    setRemovingId(id);
    try {
      await customFetch<void>(`${API}/scheduling/google/connections/${id}`, { method: "DELETE" });
      setGoogleConnections(prev => prev.filter(c => c.id !== id));
      toast({ title: "Google account disconnected" });
    } catch {
      toast({ title: "Failed to disconnect", variant: "destructive" });
    } finally {
      setRemovingId(null);
    }
  }

  function handleLinkChange(calendarId: number, connectionId: string | null) {
    setCalendarLinks(prev => ({ ...prev, [calendarId]: connectionId }));
  }

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      {/* Back + header — hidden when embedded inside Settings tabs */}
      {!embedded && (
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
      )}

      {embedded && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">One calendar per agent — links the agent to bookable event types</p>
          <Button size="sm" onClick={() => setCreateOpen(true)} className="gap-1.5">
            <Plus className="h-4 w-4" /> New Calendar
          </Button>
        </div>
      )}

      {/* Google Calendar connection panel */}
      <Card className={googleConnections.length > 0 ? "border-zinc-300 bg-muted/20" : ""}>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-card flex items-center justify-center shrink-0 border">
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#a1a1aa"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#a1a1aa"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#a1a1aa"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#c45454"/>
                </svg>
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <CardTitle className="text-sm font-semibold">Google Calendar</CardTitle>
                  {googleConnections.length > 0 && (
                    <Badge className="bg-muted text-foreground border-border text-xs">
                      <CheckCircle2 className="h-3 w-3 mr-1" />
                      {googleConnections.length === 1 ? "1 account" : `${googleConnections.length} accounts`}
                    </Badge>
                  )}
                </div>
                <CardDescription className="text-xs mt-0.5">
                  Connect to auto-generate Google Meet links for every booking
                </CardDescription>
              </div>
            </div>
            <Button
              size="sm"
              onClick={handleConnect}
              disabled={connecting || gcalLoading}
              variant={googleConnections.length > 0 ? "outline" : "default"}
              className="shrink-0 gap-1.5"
            >
              {connecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              {connecting ? "Redirecting…" : googleConnections.length > 0 ? "Add account" : "Connect Google"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {gcalLoading ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
            </div>
          ) : googleConnections.length > 0 ? (
            <div className="space-y-2">
              {googleConnections.map(conn => (
                <div key={conn.id} className="flex items-center justify-between px-3 py-2 bg-background border rounded-lg">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center shrink-0">
                      <span className="text-xs font-semibold text-foreground">{conn.email[0]?.toUpperCase()}</span>
                    </div>
                    <span className="text-sm truncate">{conn.email}</span>
                  </div>
                  <Button
                    variant="ghost" size="sm"
                    disabled={removingId === conn.id}
                    onClick={() => handleRemoveGoogle(conn.id)}
                    className="h-7 px-2 text-muted-foreground hover:text-destructive shrink-0"
                  >
                    {removingId === conn.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-3 py-2 text-xs text-muted-foreground">
              <Link2 className="h-4 w-4 shrink-0" />
              No Google account connected — click <strong className="mx-1">Connect Google</strong> to sign in and enable Meet links
            </div>
          )}
        </CardContent>
      </Card>

      {/* Setup guide (only shown when empty) */}
      {!isLoading && (!calendars || calendars.length === 0) && (
        <div className="bg-muted/60 border border-border rounded-xl p-5 space-y-3">
          <p className="text-sm font-semibold text-zinc-800">Get started in 3 steps</p>
          <ol className="space-y-1.5 text-sm text-foreground list-decimal list-inside">
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
