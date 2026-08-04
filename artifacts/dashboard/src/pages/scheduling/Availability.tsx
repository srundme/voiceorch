import { useState, useEffect } from "react";
import { Link } from "wouter";
import { Plus, Trash2, ArrowLeft, Pencil, Check, X, Copy } from "lucide-react";
import { SchedulingTabNav } from "@/components/scheduling-tab-nav";
import {
  useListCalendars,
  useListAvailability,
  useCreateAvailability,
  useUpdateAvailability,
  useDeleteAvailability,
  useListAvailabilityOverrides,
  useCreateAvailabilityOverride,
  useDeleteAvailabilityOverride,
  getListAvailabilityQueryKey,
  getListAvailabilityOverridesQueryKey,
} from "@workspace/api-client-react";
import type { AvailabilitySchedule } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { formatApiError } from "@/lib/format-api-error";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function ScheduleRow({
  schedule,
  onToggle,
  onUpdate,
  onDelete,
}: {
  schedule: AvailabilitySchedule;
  onToggle: (id: number, active: boolean) => void;
  onUpdate: (id: number, startTime: string, endTime: string) => Promise<void>;
  onDelete: (id: number) => void;
}) {
  const [editing, setEditing]   = useState(false);
  const [start, setStart]       = useState(schedule.startTime);
  const [end, setEnd]           = useState(schedule.endTime);
  const [saving, setSaving]     = useState(false);

  // Reset local state when the upstream value changes (after save)
  useEffect(() => { setStart(schedule.startTime); setEnd(schedule.endTime); }, [schedule.startTime, schedule.endTime]);

  async function save() {
    if (start === schedule.startTime && end === schedule.endTime) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onUpdate(schedule.id, start, end);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    setStart(schedule.startTime);
    setEnd(schedule.endTime);
    setEditing(false);
  }

  return (
    <div className="group flex items-center gap-4 px-4 py-3 rounded-lg border bg-card hover:border-border/80 transition-colors">
      <Switch
        checked={schedule.isActive}
        onCheckedChange={v => onToggle(schedule.id, v)}
      />
      <span className="w-24 text-sm font-medium">{DAYS[schedule.dayOfWeek]}</span>

      {editing ? (
        <div className="flex items-center gap-2 flex-1">
          <Input
            type="time"
            value={start}
            onChange={e => setStart(e.target.value)}
            className="w-28 h-8"
          />
          <span className="text-xs text-muted-foreground">–</span>
          <Input
            type="time"
            value={end}
            onChange={e => setEnd(e.target.value)}
            className="w-28 h-8"
          />
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 text-zinc-600 hover:text-zinc-700"
            onClick={() => void save()}
            disabled={saving}
          >
            <Check className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 text-muted-foreground"
            onClick={cancel}
            disabled={saving}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2 flex-1">
          <button
            onClick={() => setEditing(true)}
            className="text-sm text-muted-foreground hover:text-foreground hover:bg-muted px-2 py-0.5 rounded transition-colors"
            title="Click to edit"
          >
            {schedule.startTime} – {schedule.endTime}
          </button>
        </div>
      )}

      {!editing && (
        <>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={() => setEditing(true)}
            title="Edit time"
          >
            <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={() => onDelete(schedule.id)}
            title="Delete slot"
          >
            <Trash2 className="h-3.5 w-3.5 text-destructive" />
          </Button>
        </>
      )}
    </div>
  );
}

export default function AvailabilityPage({ embedded = false, calendarId: calendarIdProp }: { embedded?: boolean; calendarId?: number; params?: Record<string, string | undefined> } = {}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: calendars } = useListCalendars();
  const [selectedCalendarId, setSelectedCalendarId] = useState<number | null>(null);

  const calendarId = calendarIdProp ?? selectedCalendarId ?? calendars?.[0]?.id ?? null;

  const { data: schedules, isLoading } = useListAvailability(
    { calendarId: calendarId! },
    { query: { enabled: calendarId !== null, queryKey: getListAvailabilityQueryKey({ calendarId: calendarId! }) } }
  );
  const { data: overrides } = useListAvailabilityOverrides(
    { calendarId: calendarId! },
    { query: { enabled: calendarId !== null, queryKey: getListAvailabilityOverridesQueryKey({ calendarId: calendarId! }) } }
  );

  const createMut = useCreateAvailability();
  const updateMut = useUpdateAvailability();
  const deleteMut = useDeleteAvailability();
  const createOverrideMut = useCreateAvailabilityOverride();
  const deleteOverrideMut = useDeleteAvailabilityOverride();

  const [newDay, setNewDay]     = useState("1");
  const [newStart, setNewStart] = useState("09:00");
  const [newEnd, setNewEnd]     = useState("17:00");
  const [overrideDate, setOverrideDate]       = useState("");
  const [overrideBlocked, setOverrideBlocked] = useState(true);
  const [overrideStart, setOverrideStart]     = useState("09:00");
  const [overrideEnd, setOverrideEnd]         = useState("17:00");

  async function addSchedule() {
    if (!calendarId) return;
    try {
      await createMut.mutateAsync({ data: { calendarId, dayOfWeek: parseInt(newDay), startTime: newStart, endTime: newEnd } });
      await qc.invalidateQueries({ queryKey: getListAvailabilityQueryKey({ calendarId }) });
      toast({ title: "Availability added" });
    } catch (e) {
      toast({ title: "Error", description: formatApiError(e), variant: "destructive" });
    }
  }

  async function toggleSchedule(id: number, isActive: boolean) {
    try {
      await updateMut.mutateAsync({ id, data: { isActive } });
      await qc.invalidateQueries({ queryKey: getListAvailabilityQueryKey({ calendarId: calendarId! }) });
    } catch (e) {
      toast({ title: "Error", description: formatApiError(e), variant: "destructive" });
    }
  }

  async function updateSchedule(id: number, startTime: string, endTime: string) {
    try {
      await updateMut.mutateAsync({ id, data: { startTime, endTime } });
      await qc.invalidateQueries({ queryKey: getListAvailabilityQueryKey({ calendarId: calendarId! }) });
      toast({ title: "Time updated" });
    } catch (e) {
      toast({ title: "Update failed", description: formatApiError(e), variant: "destructive" });
      throw e;
    }
  }

  async function removeSchedule(id: number) {
    try {
      await deleteMut.mutateAsync({ id });
      await qc.invalidateQueries({ queryKey: getListAvailabilityQueryKey({ calendarId: calendarId! }) });
      toast({ title: "Removed" });
    } catch (e) {
      toast({ title: "Error", description: formatApiError(e), variant: "destructive" });
    }
  }

  async function copyToAllDays() {
    if (!calendarId || !schedules || schedules.length === 0) return;
    const first = schedules[0];
    try {
      const existingDays = new Set(schedules.map(s => s.dayOfWeek));
      const missing = [0, 1, 2, 3, 4, 5, 6].filter(d => !existingDays.has(d));
      for (const day of missing) {
        await createMut.mutateAsync({ data: { calendarId, dayOfWeek: day, startTime: first.startTime, endTime: first.endTime } });
      }
      await qc.invalidateQueries({ queryKey: getListAvailabilityQueryKey({ calendarId }) });
      toast({ title: `Applied to ${missing.length} more day${missing.length === 1 ? "" : "s"}` });
    } catch (e) {
      toast({ title: "Error", description: formatApiError(e), variant: "destructive" });
    }
  }

  async function addOverride() {
    if (!calendarId || !overrideDate) return;
    try {
      await createOverrideMut.mutateAsync({ data: {
        calendarId,
        date: overrideDate,
        isBlocked: overrideBlocked,
        ...(overrideBlocked ? {} : { startTime: overrideStart, endTime: overrideEnd }),
      }});
      await qc.invalidateQueries({ queryKey: getListAvailabilityOverridesQueryKey({ calendarId }) });
      setOverrideDate("");
      toast({ title: "Override added" });
    } catch (e) {
      toast({ title: "Error", description: formatApiError(e), variant: "destructive" });
    }
  }

  async function removeOverride(id: number) {
    try {
      await deleteOverrideMut.mutateAsync({ id });
      await qc.invalidateQueries({ queryKey: getListAvailabilityOverridesQueryKey({ calendarId: calendarId! }) });
    } catch (e) {
      toast({ title: "Error", description: formatApiError(e), variant: "destructive" });
    }
  }

  return (
    <div className={embedded ? "flex flex-col gap-6 max-w-3xl" : "flex flex-col h-full overflow-hidden"}>
      {!embedded && <SchedulingTabNav />}
    <div className={embedded ? "contents" : "flex flex-col gap-6 p-4 sm:p-6 max-w-3xl mx-auto w-full flex-1 overflow-y-auto"}>

      {/* Toolbar — SchedulingTabNav labels the page; skip duplicate h1 */}
      {!embedded && (
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">Set when you're available to be booked</p>
        {calendars && calendars.length > 1 && !calendarIdProp && (
          <Select value={String(calendarId ?? "")} onValueChange={v => setSelectedCalendarId(parseInt(v))}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Select calendar" /></SelectTrigger>
            <SelectContent>
              {calendars.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </div>
      )}

      {!calendarId && (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-sm text-muted-foreground">No calendar found.</p>
            <Link href={`${BASE}/app/scheduling/calendars`}>
              <Button size="sm" className="mt-3">Create a calendar</Button>
            </Link>
          </CardContent>
        </Card>
      )}

      {calendarId && (
        <>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between py-4">
              <CardTitle className="text-base">Weekly Schedule</CardTitle>
              {schedules && schedules.length > 0 && schedules.length < 7 && (
                <Button variant="ghost" size="sm" onClick={() => void copyToAllDays()} className="h-7 text-xs gap-1.5 text-muted-foreground hover:text-foreground">
                  <Copy className="h-3 w-3" /> Apply to all days
                </Button>
              )}
            </CardHeader>
            <CardContent className="flex flex-col gap-2.5">
              {isLoading && <div className="text-muted-foreground text-sm animate-pulse">Loading…</div>}
              {!isLoading && schedules && schedules.length === 0 && (
                <p className="text-xs text-muted-foreground py-3">No time slots yet — add your first one below.</p>
              )}
              {schedules?.map(s => (
                <ScheduleRow
                  key={s.id}
                  schedule={s}
                  onToggle={toggleSchedule}
                  onUpdate={updateSchedule}
                  onDelete={removeSchedule}
                />
              ))}

              {/* Add new slot — clean inline form */}
              <div className="mt-3 pt-4 border-t flex items-end gap-2.5 flex-wrap">
                <div className="flex flex-col gap-1">
                  <Label className="text-[11px] text-muted-foreground">Day</Label>
                  <Select value={newDay} onValueChange={setNewDay}>
                    <SelectTrigger className="w-32 h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {DAYS.map((d, i) => <SelectItem key={i} value={String(i)}>{d}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1">
                  <Label className="text-[11px] text-muted-foreground">Start</Label>
                  <Input className="w-28 h-9" type="time" value={newStart} onChange={e => setNewStart(e.target.value)} />
                </div>
                <div className="flex flex-col gap-1">
                  <Label className="text-[11px] text-muted-foreground">End</Label>
                  <Input className="w-28 h-9" type="time" value={newEnd} onChange={e => setNewEnd(e.target.value)} />
                </div>
                <Button size="sm" className="h-9 gap-1.5" onClick={addSchedule} disabled={createMut.isPending}>
                  <Plus className="h-3.5 w-3.5" /> Add
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="py-4"><CardTitle className="text-base">Date Overrides</CardTitle></CardHeader>
            <CardContent className="flex flex-col gap-2.5">
              {overrides?.map(ov => (
                <div key={ov.id} className="group flex items-center gap-3 px-4 py-3 rounded-lg border bg-card">
                  <span className="text-sm font-medium w-28">{ov.date}</span>
                  {ov.isBlocked
                    ? <Badge variant="destructive" className="text-xs">Blocked</Badge>
                    : <span className="text-sm text-muted-foreground">{ov.startTime} – {ov.endTime}</span>
                  }
                  {ov.reason && <span className="text-xs text-muted-foreground">{ov.reason}</span>}
                  <Button variant="ghost" size="icon" className="h-7 w-7 ml-auto opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => removeOverride(ov.id)}>
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
              ))}
              {(!overrides || overrides.length === 0) && (
                <p className="text-xs text-muted-foreground py-2">No overrides yet — use these to block holidays or set special hours for specific dates.</p>
              )}

              <div className="mt-3 pt-4 border-t flex items-end gap-2.5 flex-wrap">
                <div className="flex flex-col gap-1">
                  <Label className="text-[11px] text-muted-foreground">Date</Label>
                  <Input className="w-36 h-9" type="date" value={overrideDate} onChange={e => setOverrideDate(e.target.value)} />
                </div>
                <div className="flex items-center gap-2 pb-2">
                  <Switch checked={overrideBlocked} onCheckedChange={setOverrideBlocked} />
                  <Label className="text-xs">{overrideBlocked ? "Block day" : "Custom hours"}</Label>
                </div>
                {!overrideBlocked && (
                  <>
                    <div className="flex flex-col gap-1">
                      <Label className="text-[11px] text-muted-foreground">Start</Label>
                      <Input className="w-28 h-9" type="time" value={overrideStart} onChange={e => setOverrideStart(e.target.value)} />
                    </div>
                    <div className="flex flex-col gap-1">
                      <Label className="text-[11px] text-muted-foreground">End</Label>
                      <Input className="w-28 h-9" type="time" value={overrideEnd} onChange={e => setOverrideEnd(e.target.value)} />
                    </div>
                  </>
                )}
                <Button size="sm" className="h-9 gap-1.5" onClick={addOverride} disabled={createOverrideMut.isPending || !overrideDate}>
                  <Plus className="h-3.5 w-3.5" /> Add Override
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
    </div>
  );
}
