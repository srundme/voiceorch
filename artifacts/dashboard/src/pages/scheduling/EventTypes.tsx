import { useState } from "react";
import { format } from "date-fns";
import { Plus, Pencil, Trash2, Copy, Check, LinkIcon, Clock, MoreHorizontal } from "lucide-react";
import {
  useListEventTypes,
  useCreateEventType,
  useUpdateEventType,
  useDeleteEventType,
  useListCalendars,
  getListEventTypesQueryKey,
} from "@workspace/api-client-react";
import type { EventType, EventTypeInput } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function SlugCopy({ slug }: { slug: string }) {
  const [copied, setCopied] = useState(false);
  const url = `${window.location.origin}${BASE}/book/${slug}`;
  return (
    <button
      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      onClick={() => { void navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
    >
      {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <LinkIcon className="h-3 w-3" />}
      <span className="font-mono">{slug}</span>
    </button>
  );
}

type FormState = {
  calendarId: number | null;
  name: string;
  slug: string;
  description: string;
  durationMinutes: number;
  bufferBeforeMins: number;
  bufferAfterMins: number;
  confirmationMode: "instant" | "manual";
  maxBookingsPerSlot: number;
  isActive: boolean;
};

const defaultForm: FormState = {
  calendarId: null, name: "", slug: "", description: "",
  durationMinutes: 30, bufferBeforeMins: 0, bufferAfterMins: 0,
  confirmationMode: "instant", maxBookingsPerSlot: 1, isActive: true,
};

export default function EventTypesPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: calendars } = useListCalendars();
  const { data: eventTypes, isLoading } = useListEventTypes({}, { query: { queryKey: getListEventTypesQueryKey({}) } });
  const createMut = useCreateEventType();
  const updateMut = useUpdateEventType();
  const deleteMut = useDeleteEventType();

  const [showDialog, setShowDialog] = useState(false);
  const [editing, setEditing] = useState<EventType | null>(null);
  const [form, setForm] = useState<FormState>(defaultForm);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  function openCreate() {
    setEditing(null);
    setForm({ ...defaultForm, calendarId: calendars?.[0]?.id ?? null });
    setShowDialog(true);
  }

  function openEdit(et: EventType) {
    setEditing(et);
    setForm({
      calendarId: et.calendarId,
      name: et.name,
      slug: et.slug,
      description: et.description ?? "",
      durationMinutes: et.durationMinutes,
      bufferBeforeMins: et.bufferBeforeMins,
      bufferAfterMins: et.bufferAfterMins,
      confirmationMode: et.confirmationMode,
      maxBookingsPerSlot: et.maxBookingsPerSlot,
      isActive: et.isActive,
    });
    setShowDialog(true);
  }

  async function handleSave() {
    if (!form.calendarId || !form.name || !form.slug) {
      toast({ title: "Missing fields", description: "Calendar, name, and slug are required.", variant: "destructive" });
      return;
    }
    try {
      if (editing) {
        await updateMut.mutateAsync({ id: editing.id, data: {
          name: form.name, description: form.description || undefined,
          durationMinutes: form.durationMinutes, bufferBeforeMins: form.bufferBeforeMins,
          bufferAfterMins: form.bufferAfterMins, confirmationMode: form.confirmationMode,
          maxBookingsPerSlot: form.maxBookingsPerSlot, isActive: form.isActive,
        }});
      } else {
        await createMut.mutateAsync({ data: {
          calendarId: form.calendarId,
          name: form.name,
          slug: form.slug,
          description: form.description || undefined,
          durationMinutes: form.durationMinutes,
          bufferBeforeMins: form.bufferBeforeMins,
          bufferAfterMins: form.bufferAfterMins,
          confirmationMode: form.confirmationMode,
          maxBookingsPerSlot: form.maxBookingsPerSlot,
          isActive: form.isActive,
        }});
      }
      await qc.invalidateQueries({ queryKey: getListEventTypesQueryKey({}) });
      setShowDialog(false);
      toast({ title: editing ? "Event type updated" : "Event type created" });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  }

  async function handleDelete(id: number) {
    try {
      await deleteMut.mutateAsync({ id });
      await qc.invalidateQueries({ queryKey: getListEventTypesQueryKey({}) });
      setDeleteId(null);
      toast({ title: "Event type deleted" });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Event Types</h1>
          <p className="text-sm text-muted-foreground">Define meeting types that can be booked</p>
        </div>
        <Button size="sm" onClick={openCreate}>
          <Plus className="h-4 w-4 mr-1" /> New Event Type
        </Button>
      </div>

      <div className="grid gap-4">
        {isLoading && <div className="text-muted-foreground text-sm animate-pulse">Loading...</div>}
        {!isLoading && (!eventTypes || eventTypes.length === 0) && (
          <Card><CardContent className="py-12 text-center text-muted-foreground">No event types yet. Create one to start accepting bookings.</CardContent></Card>
        )}
        {eventTypes?.map(et => (
          <Card key={et.id} className="transition-all hover:shadow-sm">
            <CardContent className="flex items-center gap-4 py-4">
              <div className="p-2 rounded-lg bg-muted">
                <Clock className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">{et.name}</span>
                  {!et.isActive && <Badge variant="outline" className="text-xs">Inactive</Badge>}
                  <Badge variant="outline" className="text-xs">{et.durationMinutes} min</Badge>
                  <Badge variant="outline" className="text-xs capitalize">{et.confirmationMode}</Badge>
                </div>
                <SlugCopy slug={et.slug} />
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => openEdit(et)}><Pencil className="h-3.5 w-3.5 mr-2" />Edit</DropdownMenuItem>
                  <DropdownMenuItem className="text-destructive" onClick={() => setDeleteId(et.id)}>
                    <Trash2 className="h-3.5 w-3.5 mr-2" />Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Event Type" : "New Event Type"}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-2">
            {!editing && (
              <div className="flex flex-col gap-1.5">
                <Label>Calendar</Label>
                <Select value={String(form.calendarId ?? "")} onValueChange={v => setForm(f => ({ ...f, calendarId: parseInt(v) }))}>
                  <SelectTrigger><SelectValue placeholder="Select calendar" /></SelectTrigger>
                  <SelectContent>
                    {calendars?.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label>Name</Label>
                <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="30-min Demo" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Slug</Label>
                <Input value={form.slug} onChange={e => setForm(f => ({ ...f, slug: e.target.value.toLowerCase().replace(/\s+/g, "-") }))} placeholder="30-min-demo" disabled={!!editing} />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Description</Label>
              <Input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Optional description" />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label>Duration (min)</Label>
                <Input type="number" value={form.durationMinutes} onChange={e => setForm(f => ({ ...f, durationMinutes: parseInt(e.target.value) || 30 }))} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Buffer before</Label>
                <Input type="number" value={form.bufferBeforeMins} onChange={e => setForm(f => ({ ...f, bufferBeforeMins: parseInt(e.target.value) || 0 }))} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Buffer after</Label>
                <Input type="number" value={form.bufferAfterMins} onChange={e => setForm(f => ({ ...f, bufferAfterMins: parseInt(e.target.value) || 0 }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label>Confirmation</Label>
                <Select value={form.confirmationMode} onValueChange={v => setForm(f => ({ ...f, confirmationMode: v as "instant" | "manual" }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="instant">Instant</SelectItem>
                    <SelectItem value="manual">Manual approval</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Max per slot</Label>
                <Input type="number" value={form.maxBookingsPerSlot} onChange={e => setForm(f => ({ ...f, maxBookingsPerSlot: parseInt(e.target.value) || 1 }))} />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={form.isActive} onCheckedChange={v => setForm(f => ({ ...f, isActive: v }))} />
              <Label>Active</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={createMut.isPending || updateMut.isPending}>
              {editing ? "Save changes" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteId !== null} onOpenChange={v => !v && setDeleteId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete event type?</DialogTitle>
            <DialogDescription>This will permanently delete the event type and cannot be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteId(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => deleteId && handleDelete(deleteId)} disabled={deleteMut.isPending}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
