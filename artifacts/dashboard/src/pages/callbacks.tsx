import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { format, formatDistanceToNow, isPast } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Tabs, TabsList, TabsTrigger, TabsContent,
} from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import {
  PhoneMissed, PhoneCall, Clock, Calendar, RefreshCw, X, AlertTriangle,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const API  = `${BASE}/api`;

// ── Types ────────────────────────────────────────────────────────────────────

interface CallbackItem {
  id: number;
  agentId: number;
  agentName: string;
  toNumber: string;
  scheduledAt: string | null;
  status: "pending" | "triggering" | "triggered" | "cancelled" | "failed";
  reason: "callback_requested" | "no_answer";
  attemptCount: number | null;
  maxAttempts: number | null;
  redialIntervalMinutes: number | null;
  notes: string | null;
  triggeredAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  minutesUntilDue: number | null;
}

interface CallbackListResponse {
  items: CallbackItem[];
  total: number;
  page: number;
  limit: number;
}

interface CallbackStats {
  pendingCallbacks: number;
  pendingRedials: number;
  dueNow: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function reasonLabel(reason: CallbackItem["reason"]) {
  return reason === "callback_requested" ? "Callback" : "Auto-Redial";
}

function reasonColor(reason: CallbackItem["reason"]) {
  return reason === "callback_requested"
    ? "bg-blue-500/10 text-blue-400 border-blue-500/20"
    : "bg-orange-500/10 text-orange-400 border-orange-500/20";
}

function statusColor(status: CallbackItem["status"]) {
  switch (status) {
    case "pending":    return "bg-yellow-500/10 text-yellow-400 border-yellow-500/20";
    case "triggering":
    case "triggered":  return "bg-green-500/10  text-green-400  border-green-500/20";
    case "failed":     return "bg-red-500/10    text-red-400    border-red-500/20";
    case "cancelled":  return "bg-muted         text-muted-foreground border-border";
  }
}

function formatScheduled(at: string | null) {
  if (!at) return "—";
  const d = new Date(at);
  return isPast(d)
    ? `${format(d, "MMM d, h:mm a")} (overdue)`
    : format(d, "MMM d, h:mm a");
}

// ── Stats banner ─────────────────────────────────────────────────────────────

function StatsBanner({ stats }: { stats?: CallbackStats }) {
  return (
    <div className="grid grid-cols-3 gap-4 mb-6">
      {[
        { label: "Pending Callbacks",  value: stats?.pendingCallbacks ?? "—", icon: <PhoneCall className="w-4 h-4 text-blue-400" /> },
        { label: "Pending Auto-Redials", value: stats?.pendingRedials ?? "—",   icon: <PhoneMissed className="w-4 h-4 text-orange-400" /> },
        { label: "Due Now",            value: stats?.dueNow ?? "—",            icon: <Clock className="w-4 h-4 text-yellow-400" /> },
      ].map(({ label, value, icon }) => (
        <div key={label} className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-2 mb-1">{icon}<span className="text-xs text-muted-foreground">{label}</span></div>
          <p className="text-2xl font-semibold text-foreground">{value}</p>
        </div>
      ))}
    </div>
  );
}

// ── Reschedule dialog ────────────────────────────────────────────────────────

function RescheduleDialog({
  cb,
  open,
  onClose,
}: {
  cb: CallbackItem | null;
  open: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [value, setValue] = useState("");

  const mutation = useMutation({
    mutationFn: async (scheduledAt: string) => {
      await customFetch(`${API}/callbacks/${cb!.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduledAt }),
      });
    },
    onSuccess: () => {
      toast({ title: "Callback rescheduled" });
      void qc.invalidateQueries({ queryKey: ["callbacks"] });
      onClose();
    },
    onError: () => {
      toast({ title: "Failed to reschedule", variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Reschedule Callback</DialogTitle>
          <DialogDescription>
            Set a new date and time for calling <strong>{cb?.toNumber}</strong>.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <Label>New scheduled time</Label>
          <Input
            type="datetime-local"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            disabled={!value || mutation.isPending}
            onClick={() => mutation.mutate(new Date(value).toISOString())}
          >
            {mutation.isPending ? "Saving…" : "Reschedule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Callback row ─────────────────────────────────────────────────────────────

function CallbackRow({
  cb,
  onCancel,
  onReschedule,
}: {
  cb: CallbackItem;
  onCancel: (cb: CallbackItem) => void;
  onReschedule: (cb: CallbackItem) => void;
}) {
  const isDue = cb.minutesUntilDue !== null && cb.minutesUntilDue <= 0;

  return (
    <div className="flex items-start gap-4 rounded-lg border border-border bg-card px-4 py-3 transition-colors hover:bg-muted/30">
      {/* icon */}
      <div className="mt-0.5 flex-none">
        {cb.reason === "callback_requested"
          ? <PhoneCall className="w-5 h-5 text-blue-400" />
          : <PhoneMissed className="w-5 h-5 text-orange-400" />
        }
      </div>

      {/* content */}
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2 mb-1">
          <span className="font-mono text-sm text-foreground">{cb.toNumber}</span>
          <Badge className={`text-[10px] border ${reasonColor(cb.reason)}`}>{reasonLabel(cb.reason)}</Badge>
          <Badge className={`text-[10px] border ${statusColor(cb.status)}`}>{cb.status}</Badge>
          {isDue && cb.status === "pending" && (
            <Badge className="text-[10px] border bg-red-500/10 text-red-400 border-red-500/20 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" /> Overdue
            </Badge>
          )}
        </div>

        <div className="text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-0.5">
          <span>Agent: <span className="text-foreground/80">{cb.agentName}</span></span>
          {cb.scheduledAt && (
            <span className="flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              {formatScheduled(cb.scheduledAt)}
            </span>
          )}
          {cb.reason === "no_answer" && cb.attemptCount !== null && (
            <span className="flex items-center gap-1">
              <RefreshCw className="w-3 h-3" />
              Attempt {cb.attemptCount}/{cb.maxAttempts}
              {cb.redialIntervalMinutes ? ` · every ${cb.redialIntervalMinutes} min` : ""}
            </span>
          )}
        </div>

        {cb.notes && (
          <p className="mt-1 text-xs text-muted-foreground italic">"{cb.notes}"</p>
        )}

        {cb.triggeredAt && (
          <p className="text-xs text-muted-foreground mt-0.5">
            Dialed {formatDistanceToNow(new Date(cb.triggeredAt), { addSuffix: true })}
          </p>
        )}
        {cb.cancelledAt && (
          <p className="text-xs text-muted-foreground mt-0.5">
            Cancelled {formatDistanceToNow(new Date(cb.cancelledAt), { addSuffix: true })}
          </p>
        )}
      </div>

      {/* actions */}
      {cb.status === "pending" && (
        <div className="flex gap-2 flex-none">
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs"
            onClick={() => onReschedule(cb)}
          >
            <Calendar className="w-3 h-3 mr-1" />
            Reschedule
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs text-destructive hover:text-destructive"
            onClick={() => onCancel(cb)}
          >
            <X className="w-3 h-3 mr-1" />
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Tab panel ─────────────────────────────────────────────────────────────────

function CallbackList({
  status,
  reason,
  onCancel,
  onReschedule,
}: {
  status: string;
  reason: string;
  onCancel: (cb: CallbackItem) => void;
  onReschedule: (cb: CallbackItem) => void;
}) {
  const { data, isLoading } = useQuery<CallbackListResponse>({
    queryKey: ["callbacks", status, reason],
    queryFn: () =>
      customFetch<CallbackListResponse>(
        `${API}/callbacks?status=${status}&reason=${reason}&limit=100`,
      ),
    refetchInterval: 30_000,
  });

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (!data?.items.length) {
    return (
      <div className="flex flex-col items-center gap-2 py-16 text-muted-foreground">
        {status === "pending"
          ? <PhoneCall className="w-8 h-8 opacity-40" />
          : <PhoneMissed className="w-8 h-8 opacity-40" />
        }
        <p className="text-sm">No {status} callbacks</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {data.items.map((cb) => (
        <CallbackRow key={cb.id} cb={cb} onCancel={onCancel} onReschedule={onReschedule} />
      ))}
      {data.total > data.items.length && (
        <p className="text-xs text-center text-muted-foreground pt-2">
          Showing {data.items.length} of {data.total}
        </p>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function CallbacksPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState("pending");
  const [reasonFilter, setReasonFilter] = useState("all");
  const [toCancel, setToCancel] = useState<CallbackItem | null>(null);
  const [toReschedule, setToReschedule] = useState<CallbackItem | null>(null);

  const { data: stats } = useQuery<CallbackStats>({
    queryKey: ["callbacks", "stats"],
    queryFn: () => customFetch<CallbackStats>(`${API}/callbacks/stats`),
    refetchInterval: 30_000,
  });

  const cancelMutation = useMutation({
    mutationFn: async (id: number) => {
      await customFetch(`${API}/callbacks/${id}`, { method: "DELETE" });
    },
    onSuccess: () => {
      toast({ title: "Callback cancelled" });
      void qc.invalidateQueries({ queryKey: ["callbacks"] });
      setToCancel(null);
    },
    onError: () => {
      toast({ title: "Failed to cancel callback", variant: "destructive" });
    },
  });

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-4">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Callbacks & Auto-Redials</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage scheduled callbacks requested by callers, and automatic redial retries for missed calls.
        </p>
      </div>

      {/* Stats */}
      <StatsBanner stats={stats} />

      {/* Filter row */}
      <div className="flex items-center gap-3">
        <span className="text-xs text-muted-foreground">Filter by type:</span>
        {(["all", "callback_requested", "no_answer"] as const).map((r) => (
          <Button
            key={r}
            size="sm"
            variant={reasonFilter === r ? "secondary" : "ghost"}
            className="h-7 text-xs"
            onClick={() => setReasonFilter(r)}
          >
            {r === "all" ? "All" : r === "callback_requested" ? "Callbacks" : "Auto-Redials"}
          </Button>
        ))}
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="pending">Pending</TabsTrigger>
          <TabsTrigger value="triggered">Triggered</TabsTrigger>
          <TabsTrigger value="cancelled">Cancelled / Failed</TabsTrigger>
        </TabsList>

        <TabsContent value="pending">
          <CallbackList
            status="pending"
            reason={reasonFilter}
            onCancel={(cb) => setToCancel(cb)}
            onReschedule={(cb) => setToReschedule(cb)}
          />
        </TabsContent>

        <TabsContent value="triggered">
          <CallbackList
            status="triggered"
            reason={reasonFilter}
            onCancel={(cb) => setToCancel(cb)}
            onReschedule={(cb) => setToReschedule(cb)}
          />
        </TabsContent>

        <TabsContent value="cancelled">
          <CallbackList
            status="cancelled"
            reason={reasonFilter}
            onCancel={(cb) => setToCancel(cb)}
            onReschedule={(cb) => setToReschedule(cb)}
          />
        </TabsContent>
      </Tabs>

      {/* Cancel confirm dialog */}
      <Dialog open={!!toCancel} onOpenChange={() => setToCancel(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Cancel callback?</DialogTitle>
            <DialogDescription>
              This will cancel the scheduled callback for <strong>{toCancel?.toNumber}</strong>. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setToCancel(null)}>Keep</Button>
            <Button
              variant="destructive"
              disabled={cancelMutation.isPending}
              onClick={() => toCancel && cancelMutation.mutate(toCancel.id)}
            >
              {cancelMutation.isPending ? "Cancelling…" : "Yes, cancel it"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reschedule dialog */}
      <RescheduleDialog
        cb={toReschedule}
        open={!!toReschedule}
        onClose={() => setToReschedule(null)}
      />
    </div>
  );
}
