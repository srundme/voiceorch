import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { SchedulingTabNav } from "@/components/scheduling-tab-nav";
import {
  useListEventTypes,
  useCreateEventType,
  useListCalendars,
  getListEventTypesQueryKey,
  customFetch,
} from "@workspace/api-client-react";
import type { EventType } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { formatApiError } from "@/lib/format-api-error";
import {
  Plus, Clock, Copy, Check, LinkIcon, ChevronRight,
  Pencil, Trash2, Calendar, ArrowLeft,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const API  = `${BASE}/api`;

function toSlug(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function SlugCopy({ slug }: { slug: string }) {
  const [copied, setCopied] = useState(false);
  const url = `${window.location.origin}${BASE}/book/${slug}`;
  return (
    <button
      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      onClick={e => { e.preventDefault(); void navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
    >
      {copied ? <Check className="h-3 w-3 text-zinc-500" /> : <LinkIcon className="h-3 w-3" />}
      <span className="font-mono">/book/{slug}</span>
    </button>
  );
}

export function QuickCreateDialog({
  open,
  onClose,
  defaultCalendarId,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  defaultCalendarId: number | null;
  onCreated?: (id: number) => void;
}) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const createMut = useCreateEventType();
  const { data: calendars } = useListCalendars();

  const [name, setName]               = useState("");
  const [slugEdited, setSlugEdited]   = useState(false);
  const [slug, setSlug]               = useState("");
  const [description, setDescription] = useState("");
  const [duration, setDuration]       = useState(30);
  const [calendarId, setCalendarId]   = useState<number | null>(defaultCalendarId);

  useEffect(() => {
    if (calendarId === null && defaultCalendarId !== null) setCalendarId(defaultCalendarId);
  }, [defaultCalendarId]);

  function handleNameChange(v: string) {
    setName(v);
    if (!slugEdited) setSlug(toSlug(v));
  }

  function handleSlugChange(v: string) {
    setSlugEdited(true);
    setSlug(toSlug(v));
  }

  function reset() {
    setName(""); setSlug(""); setSlugEdited(false);
    setDescription(""); setDuration(30);
  }

  function handleClose() { reset(); onClose(); }

  async function handleContinue() {
    if (!name.trim())       { toast({ title: "Title is required",    variant: "destructive" }); return; }
    if (!slug.trim())       { toast({ title: "URL slug is required", variant: "destructive" }); return; }
    if (!calendarId)        { toast({ title: "Select a calendar",    variant: "destructive" }); return; }

    try {
      const created = await createMut.mutateAsync({
        data: {
          calendarId,
          name: name.trim(),
          slug: slug.trim(),
          description: description.trim() || undefined,
          durationMinutes: duration,
        },
      });
      await qc.invalidateQueries({ queryKey: getListEventTypesQueryKey({}) });
      handleClose();
      if (onCreated) {
        onCreated(created.id);
      } else {
        navigate(`${BASE}/app/scheduling/event-types/${created.id}`);
      }
    } catch (e) {
      toast({ title: "Error creating event type", description: formatApiError(e), variant: "destructive" });
    }
  }

  const previewUrl = `${window.location.origin}${BASE}/book/${slug || "…"}`;
  const busy = createMut.isPending;

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-md w-[calc(100vw-2rem)] overflow-hidden">
        <DialogHeader className="min-w-0">
          <DialogTitle className="text-xl font-bold">Add a new event type</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            Set up event types to offer different types of meetings.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1 min-w-0">
          {/* Calendar selector (only when user has multiple) */}
          {calendars && calendars.length > 1 && (
            <div className="space-y-1.5">
              <Label>Calendar</Label>
              <select
                className="w-full border border-input bg-background rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                value={calendarId ?? ""}
                onChange={e => setCalendarId(parseInt(e.target.value))}
              >
                {calendars.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Title */}
          <div className="space-y-1.5">
            <Label>Title</Label>
            <Input
              value={name}
              onChange={e => handleNameChange(e.target.value)}
              placeholder="Quick chat"
              autoFocus
              onKeyDown={e => { if (e.key === "Enter") void handleContinue(); }}
            />
          </div>

          {/* URL */}
          <div className="space-y-1.5 min-w-0">
            <Label>URL</Label>
            <div className="flex items-center rounded-md border border-input overflow-hidden bg-background focus-within:ring-1 focus-within:ring-ring min-w-0">
              <span className="px-2.5 py-2 text-xs text-muted-foreground bg-muted border-r border-input shrink-0">
                /book/
              </span>
              <input
                className="flex-1 min-w-0 px-3 py-2 text-sm font-mono bg-transparent outline-none"
                value={slug}
                onChange={e => handleSlugChange(e.target.value)}
                placeholder="quick-chat"
              />
            </div>
            {slug && (
              <p className="text-[11px] text-muted-foreground truncate">{previewUrl}</p>
            )}
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <Label>Description</Label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="For one to one booking"
              rows={3}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
            />
          </div>

          {/* Duration */}
          <div className="space-y-1.5">
            <Label>Duration</Label>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={5}
                max={1440}
                value={duration}
                onChange={e => setDuration(parseInt(e.target.value) || 30)}
                className="w-28"
              />
              <span className="text-sm text-muted-foreground">minutes</span>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 mt-2">
          <Button variant="outline" onClick={handleClose} disabled={busy}>Close</Button>
          <Button onClick={() => void handleContinue()} disabled={busy || !name || !slug || !calendarId}>
            {busy ? "Creating…" : "Continue"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EventTypeRow({ et, onDelete }: { et: EventType; onDelete: (id: number) => void }) {
  const [, navigate] = useLocation();

  return (
    <div
      className="group flex items-center gap-4 px-4 py-3.5 border-b last:border-0 hover:bg-muted/40 transition-colors cursor-pointer"
      onClick={() => navigate(`${BASE}/app/scheduling/event-types/${et.id}`)}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm">{et.name}</span>
          <SlugCopy slug={et.slug} />
        </div>
        <div className="flex items-center gap-1.5 mt-1">
          <Clock className="h-3 w-3 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">{et.durationMinutes}m</span>
          {!et.isActive && (
            <Badge variant="outline" className="text-[10px] ml-1">Hidden</Badge>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        <Button
          variant="ghost" size="icon" className="h-7 w-7"
          onClick={e => { e.stopPropagation(); navigate(`${BASE}/app/scheduling/event-types/${et.id}`); }}
          title="Edit"
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive"
          onClick={e => { e.stopPropagation(); onDelete(et.id); }}
          title="Delete"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
    </div>
  );
}

export default function EventTypesPage({
  embedded = false,
  embeddedCalendarId,
  onEventTypeCreated,
}: {
  embedded?: boolean;
  embeddedCalendarId?: number;
  onEventTypeCreated?: (id: number) => void;
  params?: Record<string, string | undefined>;
} = {}) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: calendars } = useListCalendars();
  const { data: allEventTypes, isLoading } = useListEventTypes({}, { query: { queryKey: getListEventTypesQueryKey({}) } });

  // When embedded with a specific calendarId, scope event types to that calendar
  const eventTypes = embeddedCalendarId != null
    ? allEventTypes?.filter(et => et.calendarId === embeddedCalendarId)
    : allEventTypes;

  const [createOpen, setCreateOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [forceDeleteId, setForceDeleteId] = useState<number | null>(null);
  const [bookingCount, setBookingCount] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const deleteTarget = eventTypes?.find(et => et.id === deleteId);
  const forceDeleteTarget = eventTypes?.find(et => et.id === forceDeleteId);

  const defaultCalendarId = embeddedCalendarId ?? calendars?.[0]?.id ?? null;

  // When embedded and no event type exists yet, auto-open the create dialog
  useEffect(() => {
    if (embedded && !isLoading && eventTypes?.length === 0) {
      setCreateOpen(true);
    }
  }, [embedded, isLoading, eventTypes?.length]);

  async function handleDelete(id: number) {
    setDeleting(true);
    try {
      await customFetch(`${API}/scheduling/event-types/${id}`, { method: "DELETE" });
      await qc.invalidateQueries({ queryKey: getListEventTypesQueryKey({}) });
      setDeleteId(null);
      toast({ title: "Event type deleted" });
    } catch (e: any) {
      if (e?.status === 409) {
        const count = (e?.data as any)?.bookingCount ?? 0;
        setBookingCount(count);
        setDeleteId(null);
        setForceDeleteId(id);
      } else {
        toast({ title: "Error", description: formatApiError(e), variant: "destructive" });
      }
    } finally {
      setDeleting(false);
    }
  }

  async function handleForceDelete(id: number) {
    setDeleting(true);
    try {
      await customFetch(`${API}/scheduling/event-types/${id}?force=true`, { method: "DELETE" });
      await qc.invalidateQueries({ queryKey: getListEventTypesQueryKey({}) });
      setForceDeleteId(null);
      toast({ title: "Event type deleted" });
    } catch (e) {
      toast({ title: "Error", description: formatApiError(e), variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <SchedulingTabNav />
      {/* Toolbar — SchedulingTabNav labels the page; skip duplicate h1 */}
      <div className="border-b px-4 sm:px-6 py-4 shrink-0">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">Configure different events for people to book on your calendar.</p>
          {(calendars?.length ?? 0) > 0 && (
            <Button size="sm" onClick={() => setCreateOpen(true)} className="gap-1.5 shrink-0">
              <Plus className="h-3.5 w-3.5" /> New
            </Button>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="p-4 sm:p-6 space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-14 rounded-lg bg-muted animate-pulse" />
            ))}
          </div>
        ) : !calendars?.length ? (
          <div className="flex flex-col items-center justify-center py-24 text-center px-6">
            <div className="p-4 rounded-2xl bg-muted mb-4">
              <Calendar className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="text-base font-semibold text-foreground mb-1">No calendar set up</h3>
            <p className="text-sm text-muted-foreground max-w-sm mb-5">
              Create a calendar first, then you can add event types to it.
            </p>
            <Link href={`${BASE}/app/scheduling/calendars`}>
              <Button variant="outline" className="gap-1.5">
                <Calendar className="h-4 w-4" /> Go to Calendars
              </Button>
            </Link>
          </div>
        ) : !eventTypes?.length ? (
          <div className="flex flex-col items-center justify-center py-24 text-center px-6">
            <div className="p-4 rounded-2xl bg-muted mb-4">
              <Clock className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="text-base font-semibold text-foreground mb-1">No event types yet</h3>
            <p className="text-sm text-muted-foreground max-w-sm mb-5">
              Create your first event type so people can start booking time with you.
            </p>
            <Button onClick={() => setCreateOpen(true)} className="gap-1.5">
              <Plus className="h-4 w-4" /> New event type
            </Button>
          </div>
        ) : (
          <div className="divide-y border-0">
            {eventTypes.map(et => (
              <EventTypeRow key={et.id} et={et} onDelete={id => setDeleteId(id)} />
            ))}
          </div>
        )}
      </div>

      {/* Quick-create dialog */}
      <QuickCreateDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        defaultCalendarId={defaultCalendarId}
        onCreated={onEventTypeCreated}
      />

      {/* Delete confirm */}
      <AlertDialog open={deleteId !== null} onOpenChange={v => !v && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{deleteTarget?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this event type and its booking page at <code className="font-mono">/book/{deleteTarget?.slug}</code>. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={() => deleteId && void handleDelete(deleteId)}
              disabled={deleting}
            >
              {deleting ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Force-delete confirm (shown when event type has existing bookings) */}
      <AlertDialog open={forceDeleteId !== null} onOpenChange={v => !v && setForceDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Event type has existing bookings</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  <strong className="text-foreground">{forceDeleteTarget?.name}</strong> has{" "}
                  <strong className="text-foreground">{bookingCount} booking{bookingCount !== 1 ? "s" : ""}</strong>{" "}
                  associated with it.
                </p>
                <p>
                  Deleting this event type will <strong className="text-foreground">preserve all past booking records</strong> — they will remain in your history but will no longer be linked to this event type.
                </p>
                <p>Are you sure you want to proceed?</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={() => forceDeleteId && void handleForceDelete(forceDeleteId)}
              disabled={deleting}
            >
              {deleting ? "Deleting…" : "Yes, delete event type"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
