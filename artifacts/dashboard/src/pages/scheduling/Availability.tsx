import { useState } from "react";
import { Plus, Trash2, Clock } from "lucide-react";
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

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default function AvailabilityPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: calendars } = useListCalendars();
  const [selectedCalendarId, setSelectedCalendarId] = useState<number | null>(null);

  const calendarId = selectedCalendarId ?? calendars?.[0]?.id ?? null;

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

  const [newDay, setNewDay] = useState("1");
  const [newStart, setNewStart] = useState("09:00");
  const [newEnd, setNewEnd] = useState("17:00");
  const [overrideDate, setOverrideDate] = useState("");
  const [overrideBlocked, setOverrideBlocked] = useState(true);
  const [overrideStart, setOverrideStart] = useState("09:00");
  const [overrideEnd, setOverrideEnd] = useState("17:00");

  async function addSchedule() {
    if (!calendarId) return;
    try {
      await createMut.mutateAsync({ data: { calendarId, dayOfWeek: parseInt(newDay), startTime: newStart, endTime: newEnd } });
      await qc.invalidateQueries({ queryKey: getListAvailabilityQueryKey({ calendarId }) });
      toast({ title: "Availability added" });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  }

  async function toggleSchedule(id: number, isActive: boolean) {
    try {
      await updateMut.mutateAsync({ id, data: { isActive } });
      await qc.invalidateQueries({ queryKey: getListAvailabilityQueryKey({ calendarId: calendarId! }) });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  }

  async function removeSchedule(id: number) {
    try {
      await deleteMut.mutateAsync({ id });
      await qc.invalidateQueries({ queryKey: getListAvailabilityQueryKey({ calendarId: calendarId! }) });
      toast({ title: "Removed" });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
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
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  }

  async function removeOverride(id: number) {
    try {
      await deleteOverrideMut.mutateAsync({ id });
      await qc.invalidateQueries({ queryKey: getListAvailabilityOverridesQueryKey({ calendarId: calendarId! }) });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Availability</h1>
          <p className="text-sm text-muted-foreground">Set when you're available to be booked</p>
        </div>
        {calendars && calendars.length > 1 && (
          <Select value={String(calendarId ?? "")} onValueChange={v => setSelectedCalendarId(parseInt(v))}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Select calendar" /></SelectTrigger>
            <SelectContent>
              {calendars.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </div>

      {!calendarId && (
        <p className="text-muted-foreground text-sm">No calendar found. Create an agent to get started.</p>
      )}

      {calendarId && (
        <>
          <Card>
            <CardHeader><CardTitle className="text-base">Weekly Schedule</CardTitle></CardHeader>
            <CardContent className="flex flex-col gap-3">
              {isLoading && <div className="text-muted-foreground text-sm animate-pulse">Loading...</div>}
              {schedules?.map(s => (
                <div key={s.id} className="flex items-center gap-3 p-3 rounded-lg border bg-card">
                  <Switch checked={s.isActive} onCheckedChange={v => toggleSchedule(s.id, v)} />
                  <span className="w-24 text-sm font-medium">{DAYS[s.dayOfWeek]}</span>
                  <span className="text-sm text-muted-foreground">{s.startTime} – {s.endTime}</span>
                  <Button variant="ghost" size="icon" className="h-7 w-7 ml-auto" onClick={() => removeSchedule(s.id)}>
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
              ))}
              <div className="flex items-end gap-3 pt-2 border-t">
                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs">Day</Label>
                  <Select value={newDay} onValueChange={setNewDay}>
                    <SelectTrigger className="w-32 h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {DAYS.map((d, i) => <SelectItem key={i} value={String(i)}>{d}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs">Start</Label>
                  <Input className="w-24 h-8" type="time" value={newStart} onChange={e => setNewStart(e.target.value)} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs">End</Label>
                  <Input className="w-24 h-8" type="time" value={newEnd} onChange={e => setNewEnd(e.target.value)} />
                </div>
                <Button size="sm" className="h-8" onClick={addSchedule} disabled={createMut.isPending}>
                  <Plus className="h-3.5 w-3.5 mr-1" />Add
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Date Overrides</CardTitle></CardHeader>
            <CardContent className="flex flex-col gap-3">
              {overrides?.map(ov => (
                <div key={ov.id} className="flex items-center gap-3 p-3 rounded-lg border bg-card">
                  <span className="text-sm font-medium w-28">{ov.date}</span>
                  {ov.isBlocked
                    ? <Badge variant="destructive" className="text-xs">Blocked</Badge>
                    : <span className="text-sm text-muted-foreground">{ov.startTime} – {ov.endTime}</span>
                  }
                  {ov.reason && <span className="text-xs text-muted-foreground">{ov.reason}</span>}
                  <Button variant="ghost" size="icon" className="h-7 w-7 ml-auto" onClick={() => removeOverride(ov.id)}>
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
              ))}
              {(!overrides || overrides.length === 0) && (
                <p className="text-xs text-muted-foreground">No overrides yet</p>
              )}
              <div className="flex items-end gap-3 pt-2 border-t flex-wrap">
                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs">Date</Label>
                  <Input className="w-36 h-8" type="date" value={overrideDate} onChange={e => setOverrideDate(e.target.value)} />
                </div>
                <div className="flex items-center gap-2 mt-4">
                  <Switch checked={overrideBlocked} onCheckedChange={setOverrideBlocked} />
                  <Label className="text-xs">{overrideBlocked ? "Block day" : "Custom hours"}</Label>
                </div>
                {!overrideBlocked && (
                  <>
                    <div className="flex flex-col gap-1.5">
                      <Label className="text-xs">Start</Label>
                      <Input className="w-24 h-8" type="time" value={overrideStart} onChange={e => setOverrideStart(e.target.value)} />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label className="text-xs">End</Label>
                      <Input className="w-24 h-8" type="time" value={overrideEnd} onChange={e => setOverrideEnd(e.target.value)} />
                    </div>
                  </>
                )}
                <Button size="sm" className="h-8" onClick={addOverride} disabled={createOverrideMut.isPending || !overrideDate}>
                  <Plus className="h-3.5 w-3.5 mr-1" />Add Override
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
