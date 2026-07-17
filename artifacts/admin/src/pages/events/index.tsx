import { useState } from "react";
import { Link } from "wouter";
import {
  useWorkshopEvents,
  useCreateWorkshopEvent,
  useUpdateWorkshopEvent,
  useDeleteWorkshopEvent,
  type WorkshopEvent,
  type WorkshopEventInput,
  type WorkshopSession,
} from "@/hooks/use-admin-api";
import { formatAdminError } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Plus,
  Copy,
  Check,
  Trash2,
  Pencil,
  BarChart3,
  Lock,
  Unlock,
  X,
} from "lucide-react";

function emptyForm(): WorkshopEventInput {
  return {
    title: "",
    college: "",
    eventDate: "",
    mode: "offline",
    sessions: [],
    status: "open",
    registrationsCount: 0,
    attendeesCount: 0,
  };
}

function toForm(e: WorkshopEvent): WorkshopEventInput {
  return {
    title: e.title,
    college: e.college ?? "",
    eventDate: e.eventDate ? e.eventDate.slice(0, 10) : "",
    mode: e.mode,
    sessions: e.sessions ?? [],
    status: e.status,
    registrationsCount: e.registrationsCount,
    attendeesCount: e.attendeesCount,
  };
}

function EventDialog({
  open,
  onOpenChange,
  editing,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: WorkshopEvent | null;
}) {
  const { toast } = useToast();
  const create = useCreateWorkshopEvent();
  const update = useUpdateWorkshopEvent();
  const [form, setForm] = useState<WorkshopEventInput>(editing ? toForm(editing) : emptyForm());

  const pending = create.isPending || update.isPending;

  const addSession = () => {
    const next: WorkshopSession = { id: "", name: "" };
    setForm((f) => ({ ...f, sessions: [...(f.sessions ?? []), next] }));
  };
  const setSessionName = (idx: number, name: string) => {
    setForm((f) => ({
      ...f,
      sessions: (f.sessions ?? []).map((s, i) => (i === idx ? { ...s, name } : s)),
    }));
  };
  const removeSession = (idx: number) => {
    setForm((f) => ({ ...f, sessions: (f.sessions ?? []).filter((_, i) => i !== idx) }));
  };

  const submit = async () => {
    if (!form.title.trim()) {
      toast({ title: "Title required", variant: "destructive" });
      return;
    }
    const payload: WorkshopEventInput = {
      ...form,
      college: form.college?.trim() || null,
      eventDate: form.eventDate ? new Date(form.eventDate).toISOString() : null,
      sessions: (form.sessions ?? []).filter((s) => s.name.trim()),
    };
    try {
      if (editing) {
        await update.mutateAsync({ id: editing.id, data: payload });
        toast({ title: "Event updated" });
      } else {
        await create.mutateAsync(payload);
        toast({ title: "Event created" });
      }
      onOpenChange(false);
    } catch (err) {
      toast({ title: "Save failed", description: formatAdminError(err), variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit workshop event" : "New workshop event"}</DialogTitle>
          <DialogDescription>
            Sessions are the individual talks/labs attendees rate. The rest of the 12-section form is
            fixed.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Title</Label>
            <Input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="AI Voice Agents Workshop — College A"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>College / Org</Label>
              <Input
                value={form.college ?? ""}
                onChange={(e) => setForm({ ...form, college: e.target.value })}
                placeholder="College name"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Event date</Label>
              <Input
                type="date"
                value={form.eventDate ?? ""}
                onChange={(e) => setForm({ ...form, eventDate: e.target.value })}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Mode</Label>
              <Select
                value={form.mode}
                onValueChange={(v) => setForm({ ...form, mode: v as "online" | "offline" })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="offline">Offline</SelectItem>
                  <SelectItem value="online">Online</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select
                value={form.status}
                onValueChange={(v) => setForm({ ...form, status: v as "open" | "closed" })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="closed">Closed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Registrations</Label>
              <Input
                type="number"
                min={0}
                value={form.registrationsCount ?? 0}
                onChange={(e) =>
                  setForm({ ...form, registrationsCount: Math.max(0, Number(e.target.value)) })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label>Attendees</Label>
              <Input
                type="number"
                min={0}
                value={form.attendeesCount ?? 0}
                onChange={(e) =>
                  setForm({ ...form, attendeesCount: Math.max(0, Number(e.target.value)) })
                }
              />
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Sessions</Label>
              <Button type="button" variant="outline" size="sm" onClick={addSession}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Add session
              </Button>
            </div>
            {(form.sessions ?? []).length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No sessions yet. Add the talks/labs attendees should rate individually.
              </p>
            ) : (
              <div className="space-y-2">
                {(form.sessions ?? []).map((s, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input
                      value={s.name}
                      onChange={(e) => setSessionName(i, e.target.value)}
                      placeholder={`Session ${i + 1} name`}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeSession(i)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending ? "Saving…" : editing ? "Save changes" : "Create event"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ShareLink({ slug }: { slug: string }) {
  const [copied, setCopied] = useState(false);
  const url = `${window.location.origin}/workshop/${slug}`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };
  return (
    <Button variant="ghost" size="sm" onClick={copy} className="h-7 px-2 text-xs font-mono">
      {copied ? <Check className="h-3.5 w-3.5 mr-1 text-emerald-500" /> : <Copy className="h-3.5 w-3.5 mr-1" />}
      /workshop/{slug}
    </Button>
  );
}

export default function EventsPage() {
  const { toast } = useToast();
  const { data: events, isLoading, error } = useWorkshopEvents();
  const update = useUpdateWorkshopEvent();
  const del = useDeleteWorkshopEvent();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<WorkshopEvent | null>(null);

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };
  const openEdit = (e: WorkshopEvent) => {
    setEditing(e);
    setDialogOpen(true);
  };

  const toggleStatus = async (e: WorkshopEvent) => {
    try {
      await update.mutateAsync({
        id: e.id,
        data: { status: e.status === "open" ? "closed" : "open" },
      });
    } catch (err) {
      toast({ title: "Update failed", description: formatAdminError(err), variant: "destructive" });
    }
  };

  const remove = async (e: WorkshopEvent) => {
    if (!window.confirm(`Delete "${e.title}" and all ${e.responseCount} responses? This cannot be undone.`))
      return;
    try {
      await del.mutateAsync(e.id);
      toast({ title: "Event deleted" });
    } catch (err) {
      toast({ title: "Delete failed", description: formatAdminError(err), variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Workshops</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Create feedback forms for workshops, share the public link, and review analytics.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4 mr-1.5" /> New event
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Events</CardTitle>
          <CardDescription>
            Share <span className="font-mono">/workshop/&lt;slug&gt;</span> with attendees — no login required.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Event</TableHead>
                <TableHead>Share link</TableHead>
                <TableHead className="text-center">Status</TableHead>
                <TableHead className="text-right">Responses</TableHead>
                <TableHead className="text-right">Attendees</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : error ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-destructive py-8">
                    {formatAdminError(error)}
                  </TableCell>
                </TableRow>
              ) : (events ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    No events yet. Create one to get a shareable feedback form.
                  </TableCell>
                </TableRow>
              ) : (
                (events ?? []).map((e) => (
                  <TableRow key={e.id}>
                    <TableCell>
                      <Link href={`/events/${e.id}`} className="font-medium hover:underline">
                        {e.title}
                      </Link>
                      <div className="text-[11px] text-muted-foreground">
                        {e.college ? `${e.college} · ` : ""}
                        {e.eventDate ? new Date(e.eventDate).toLocaleDateString("en-IN") : "no date"} ·{" "}
                        {e.mode}
                      </div>
                    </TableCell>
                    <TableCell>
                      <ShareLink slug={e.slug} />
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant={e.status === "open" ? "default" : "secondary"}>{e.status}</Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono">{e.responseCount}</TableCell>
                    <TableCell className="text-right font-mono">{e.attendeesCount}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button asChild variant="ghost" size="icon" title="Analytics">
                          <Link href={`/events/${e.id}`}>
                            <BarChart3 className="h-4 w-4" />
                          </Link>
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          title={e.status === "open" ? "Close form" : "Reopen form"}
                          onClick={() => toggleStatus(e)}
                        >
                          {e.status === "open" ? (
                            <Lock className="h-4 w-4" />
                          ) : (
                            <Unlock className="h-4 w-4" />
                          )}
                        </Button>
                        <Button variant="ghost" size="icon" title="Edit" onClick={() => openEdit(e)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Delete"
                          onClick={() => remove(e)}
                          className="text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {dialogOpen && (
        <EventDialog
          key={editing?.id ?? "new"}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          editing={editing}
        />
      )}
    </div>
  );
}
