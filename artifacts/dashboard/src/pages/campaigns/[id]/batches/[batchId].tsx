/**
 * Batch workspace: header + disposition/leads split (transcript on the right).
 */

import { useState, useEffect, useRef } from "react";
import { useRoute } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useUpdateCampaignBatch, useRedialBatchNoPickup,
  useGetBatchAnalytics,
  getListCampaignBatchesQueryKey,
  getListBatchLeadsQueryKey,
  customFetch,
  ApiError,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DetailNav } from "@/components/detail-nav";
import {
  Play, Pause, Square, RotateCcw,
  Phone, Database, User, CheckCircle2, Clock, Pencil, FileDown,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { getIrdaiBlockedError } from "@/lib/irdai-block";
import { cn } from "@/lib/utils";
import { BATCH_STATUS_MAP } from "@/lib/campaign-status";
import { CampaignLeadsWorkspace } from "@/components/campaign-ops/leads-workspace";
import { CampaignExecutionStrip } from "@/components/campaign-ops/campaign-header";
import { type CampaignReportingPayload } from "@/lib/campaign-lead-reporting";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

// ── useCountdown ──────────────────────────────────────────────────────────────
// Returns live { days, hours, minutes, seconds, expired } ticking every second.
// Returns null when targetIso is null/undefined or already in the past on mount.

type Countdown = { days: number; hours: number; minutes: number; seconds: number; expired: boolean };

function useCountdown(targetIso: string | null | undefined): Countdown | null {
  const [tick, setTick] = useState(0);
  const ref = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!targetIso) return;
    ref.current = setInterval(() => setTick(t => t + 1), 1000);
    return () => { if (ref.current) clearInterval(ref.current); };
  }, [targetIso]);

  if (!targetIso) return null;
  const diff = new Date(targetIso).getTime() - Date.now();
  if (diff <= 0) return { days: 0, hours: 0, minutes: 0, seconds: 0, expired: true };
  const totalSec = Math.floor(diff / 1000);
  const days    = Math.floor(totalSec / 86400);
  const hours   = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  // tick is read to force re-render each second
  void tick;
  return { days, hours, minutes, seconds, expired: false };
}

// ── Timezone helpers ──────────────────────────────────────────────────────────

/** Format a UTC ISO string as a human-readable local time in the given IANA timezone. */
function formatInTz(isoString: string, tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "short",
      month:   "short",
      day:     "numeric",
      hour:    "numeric",
      minute:  "2-digit",
      hour12:  true,
      timeZoneName: "short",
    }).format(new Date(isoString));
  } catch {
    return new Date(isoString).toLocaleString();
  }
}

/** Convert a UTC ISO string to a "YYYY-MM-DDTHH:MM" value for a datetime-local input, in the given timezone. */
function utcToTzInput(isoString: string, tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(new Date(isoString));
    const g = (t: string) => parts.find(p => p.type === t)?.value ?? "00";
    return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}`;
  } catch {
    return "";
  }
}

/** Convert a "YYYY-MM-DDTHH:MM" string (entered as local time in `tz`) to a UTC ISO string. */
function tzInputToUtc(localStr: string, tz: string): string {
  try {
    // Treat localStr as UTC first to get a reference Date
    const approx = new Date(localStr + ":00Z");
    // Find what UTC offset the target timezone has at that moment
    const tzParts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, timeZoneName: "shortOffset",
    }).formatToParts(approx);
    const offsetStr = tzParts.find(p => p.type === "timeZoneName")?.value ?? "+00:00";
    const m = offsetStr.match(/GMT([+-])(\d+)(?::(\d+))?/);
    if (!m) return approx.toISOString();
    const sign = m[1] === "+" ? 1 : -1;
    const offsetMs = sign * (parseInt(m[2]!) * 60 + parseInt(m[3] ?? "0")) * 60_000;
    return new Date(approx.getTime() - offsetMs).toISOString();
  } catch {
    return new Date(localStr).toISOString();
  }
}

// ── EditScheduleDialog ────────────────────────────────────────────────────────

function EditScheduleDialog({
  open,
  onOpenChange,
  scheduledStartAt,
  timezone,
  onSave,
  saving,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  scheduledStartAt: string;
  timezone: string;
  onSave: (isoUtc: string) => void;
  saving: boolean;
}) {
  const [value, setValue] = useState(() => utcToTzInput(scheduledStartAt, timezone));
  // Re-sync if the scheduled time changes externally
  useEffect(() => {
    setValue(utcToTzInput(scheduledStartAt, timezone));
  }, [scheduledStartAt, timezone]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[340px]">
        <DialogHeader>
          <DialogTitle className="text-sm">Edit Scheduled Time</DialogTitle>
          <DialogDescription className="text-xs">
            Choose when this batch should start dialing, in the agent timezone.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div className="space-y-1.5">
            <Label className="text-xs">Launch time</Label>
            <Input
              type="datetime-local"
              className="h-9 text-xs"
              value={value}
              onChange={e => setValue(e.target.value)}
            />
            <p className="text-[10px] text-muted-foreground">
              Times are in <span className="font-medium text-foreground">{timezone}</span> (agent timezone)
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            size="sm"
            disabled={!value || saving}
            onClick={() => onSave(tzInputToUtc(value, timezone))}
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── ScheduledInlineChip ───────────────────────────────────────────────────────

function ScheduledInlineChip({
  scheduledStartAt,
  timezone,
  onEdit,
  onExpired,
}: {
  scheduledStartAt: string;
  timezone: string;
  onEdit: () => void;
  onExpired: () => void;
}) {
  const cd = useCountdown(scheduledStartAt);
  const expiredRef = useRef(false);

  useEffect(() => {
    if (cd?.expired && !expiredRef.current) {
      expiredRef.current = true;
      onExpired();
    }
  }, [cd?.expired, onExpired]);

  if (!cd || cd.expired) return null;

  const pad = (n: number) => String(n).padStart(2, "0");
  const countdownStr = cd.days > 0
    ? `${cd.days}d ${pad(cd.hours)}:${pad(cd.minutes)}:${pad(cd.seconds)}`
    : `${pad(cd.hours)}:${pad(cd.minutes)}:${pad(cd.seconds)}`;

  return (
    <span className="inline-flex items-center gap-1.5 h-7 pl-2 pr-1 rounded-md border border-amber-500/30 bg-amber-500/8 text-amber-600 text-[11px] font-medium whitespace-nowrap">
      <Clock className="h-3 w-3 shrink-0" />
      <span className="font-mono tabular-nums">{countdownStr}</span>
      <span className="text-muted-foreground/60 font-normal hidden sm:inline">
        · {formatInTz(scheduledStartAt, timezone)}
      </span>
      <button
        type="button"
        onClick={e => { e.stopPropagation(); onEdit(); }}
        className="ml-0.5 h-5 w-5 rounded flex items-center justify-center hover:bg-amber-500/15 transition-colors shrink-0"
        title="Edit schedule"
      >
        <Pencil className="h-2.5 w-2.5" />
      </button>
    </span>
  );
}

// ── Types ─────────────────────────────────────────────────────────────────────

type BatchHeader = {
  batch: {
    id: number; name: string; status: string; leadSource: string;
    totalLeads: number; calledLeads: number; createdAt: string;
    scheduledStartAt: string | null;
    timezone: string | null;
    maxAttempts: number; retryDelayMinutes: number;
  };
  campaign: { id: number; name: string; agentId: number | null; agentName: string | null; fromNumber: string | null };
  source: { name: string; type: string } | null;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function BatchStatusBadge({ status }: { status: string }) {
  const cfg = BATCH_STATUS_MAP[status] ?? { label: status, cls: "bg-muted/50 text-muted-foreground border-border" };
  return (
    <span className={cn("inline-flex items-center text-xs font-semibold px-2.5 py-1 rounded-md border", cfg.cls)}>
      {cfg.label}
    </span>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function BatchWorkspacePage() {
  const [, params] = useRoute("/app/campaigns/:id/batches/:batchId");
  const campaignId = parseInt(params?.id      ?? "0", 10);
  const batchId    = parseInt(params?.batchId ?? "0", 10);

  const { toast } = useToast();
  const qc = useQueryClient();

  const update = useUpdateCampaignBatch();
  const redial = useRedialBatchNoPickup();
  const [isStarting, setIsStarting] = useState(false);
  const [editScheduleOpen, setEditScheduleOpen] = useState(false);
  const [isSavingSchedule, setIsSavingSchedule] = useState(false);

  // Header data (light, kept in sync with polling)
  const { data: header } = useQuery<BatchHeader>({
    queryKey: ["batch-ws-header", campaignId, batchId],
    queryFn: () => customFetch(`${BASE}/api/campaigns/${campaignId}/batches/${batchId}/workspace/header`),
    refetchInterval: 10000,
    enabled: campaignId > 0 && batchId > 0,
  });

  // KPIs — Call Outcomes strip. Never fire with id=0 (route params still
  // hydrating) or a failed response will stick as "—" while leads load fine.
  const reportingQuery = useQuery<CampaignReportingPayload>({
    queryKey: ["campaign-lead-reporting", campaignId, batchId],
    queryFn: () => customFetch(`${BASE}/api/campaigns/${campaignId}/batches/${batchId}/lead-reporting`),
    refetchInterval: 10000,
    enabled: campaignId > 0 && batchId > 0,
  });
  const reporting = reportingQuery.data;

  const batchStatus = header?.batch.status ?? "draft";
  // A terminal batch (completed / stopped / cancelled) has no more work, so it
  // must not present Running-only actions. Start is also blocked for completed /
  // cancelled (the backend 409s), while a stopped batch can still be restarted.
  const canStart     = !(batchStatus === "running" || batchStatus === "completed" || batchStatus === "cancelled");
  const canStopPause = batchStatus === "running" || batchStatus === "paused";

  // Batch analytics — used to know whether any scheduled retries are still pending.
  const { data: batchAnalytics } = useGetBatchAnalytics(campaignId, batchId, {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query: { refetchInterval: 10000 } as any,
  });

  // "Finished" = backend marked the batch completed AND no scheduled retries remain.
  // Only then are the Start/Pause/Stop/Redial controls pointless → show a badge instead.
  const finished =
    batchStatus === "completed" &&
    batchAnalytics != null &&
    (batchAnalytics.stats.pendingRetries ?? 0) === 0;

  async function handleStart() {
    setIsStarting(true);
    try {
      await customFetch(`${BASE}/api/campaigns/${campaignId}/batches/${batchId}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      await qc.invalidateQueries({ queryKey: getListCampaignBatchesQueryKey(campaignId) });
      await qc.invalidateQueries({ queryKey: ["batch-ws-header", campaignId, batchId] });
      toast({ title: "Batch started" });
    } catch (err) {
      const irdai = getIrdaiBlockedError(err);
      if (irdai) {
        toast({ title: "Call blocked", description: irdai.message, variant: "destructive" });
      } else if (err instanceof ApiError) {
        const body = err.data as { error?: string; code?: string } | null;
        if (body?.code === "IRDAI_BLOCKED") {
          toast({ title: "Call blocked", description: body.error, variant: "destructive" });
        } else {
          toast({ title: body?.error ?? "Action failed", variant: "destructive" });
        }
      } else {
        toast({ title: "Action failed", variant: "destructive" });
      }
    } finally {
      setIsStarting(false);
    }
  }

  async function handleControl(status: "paused" | "stopped") {
    try {
      await update.mutateAsync({ id: campaignId, batchId, data: { status } });
      await qc.invalidateQueries({ queryKey: getListCampaignBatchesQueryKey(campaignId) });
      await qc.invalidateQueries({ queryKey: ["batch-ws-header", campaignId, batchId] });
      toast({ title: status === "paused" ? "Batch paused" : "Batch stopped" });
    } catch (err) {
      const irdai = getIrdaiBlockedError(err);
      if (irdai) {
        toast({ title: "Call blocked", description: irdai.message, variant: "destructive" });
      } else {
        toast({ title: "Action failed", variant: "destructive" });
      }
    }
  }

  async function handleSaveSchedule(isoUtc: string) {
    setIsSavingSchedule(true);
    try {
      await update.mutateAsync({ id: campaignId, batchId, data: { scheduledStartAt: isoUtc } });
      await qc.invalidateQueries({ queryKey: ["batch-ws-header", campaignId, batchId] });
      setEditScheduleOpen(false);
      toast({ title: "Schedule updated" });
    } catch {
      toast({ title: "Failed to update schedule", variant: "destructive" });
    } finally {
      setIsSavingSchedule(false);
    }
  }

  async function handleRedialAll() {
    try {
      const r = await redial.mutateAsync({ id: campaignId, batchId });
      await qc.invalidateQueries({ queryKey: getListBatchLeadsQueryKey(campaignId, batchId) });
      toast({ title: "Redial queued", description: `${(r as { queued?: number })?.queued ?? 0} leads scheduled` });
    } catch {
      toast({ title: "Redial failed", variant: "destructive" });
    }
  }

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden min-w-0">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="px-4 sm:px-6 pt-5 pb-3 border-b border-border/40 shrink-0">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div>
              {/* Breadcrumb */}
              <DetailNav
                className="mb-0.5"
                backTo={`/app/campaigns/${campaignId}`}
                backLabel="Back to Campaign"
                crumbs={[
                  { label: "Campaigns", href: "/app/campaigns" },
                  { label: header?.campaign.name ?? "…", href: `/app/campaigns/${campaignId}` },
                  { label: header?.batch.name ?? "Batch" },
                ]}
              />

              {/* Title + status */}
              <div className="flex items-center gap-2.5 flex-wrap">
                <h2 className="text-lg font-semibold tracking-tight">{header?.batch.name ?? "Batch Workspace"}</h2>
                {header && <BatchStatusBadge status={batchStatus} />}
                {batchStatus === "draft" && header?.batch.scheduledStartAt && (
                  <ScheduledInlineChip
                    scheduledStartAt={header.batch.scheduledStartAt}
                    timezone={header.batch.timezone ?? "UTC"}
                    onEdit={() => setEditScheduleOpen(true)}
                    onExpired={() => void qc.invalidateQueries({ queryKey: ["batch-ws-header", campaignId, batchId] })}
                  />
                )}
                {header?.campaign.agentName && (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground/50">
                    <User className="h-2.5 w-2.5" />
                    {header.campaign.agentName}
                  </span>
                )}
                {header?.campaign.fromNumber && (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground/50">
                    <Phone className="h-2.5 w-2.5" />
                    {header.campaign.fromNumber}
                  </span>
                )}
                {header?.source && (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground/50">
                    <Database className="h-2.5 w-2.5" />
                    {header.source.name}
                  </span>
                )}
              </div>
              {((reporting?.liveFloor.calling ?? 0) > 0 || (reporting?.liveFloor.talking ?? 0) > 0) && (
                <CampaignExecutionStrip
                  calling={reporting?.liveFloor.calling ?? 0}
                  talking={reporting?.liveFloor.talking ?? 0}
                  slotsUsed={reporting?.liveFloor.slotsUsed ?? 0}
                  concurrencyLimit={reporting?.liveFloor.concurrencyLimit ?? "—"}
                />
              )}
            </div>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-2 ml-auto">
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs gap-1.5"
              onClick={() => {
                const url = `${BASE}/api/campaigns/${campaignId}/batches/${batchId}/export.csv`;
                window.open(url, "_blank");
              }}
            >
              <FileDown className="h-3.5 w-3.5" /> Export
            </Button>
            {finished ? (
              <span className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-semibold rounded-md border bg-emerald-500/10 text-emerald-600 border-emerald-500/30 select-none">
                <CheckCircle2 className="h-3.5 w-3.5" /> Batch Completed
              </span>
            ) : (
              <>
                <Button size="sm" className="h-8 text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
                  disabled={!canStart || update.isPending || isStarting}
                  onClick={() => void handleStart()}>
                  <Play className="h-3.5 w-3.5" /> Start
                </Button>
                <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5"
                  disabled={batchStatus !== "running" || update.isPending}
                  onClick={() => void handleControl("paused")}>
                  <Pause className="h-3.5 w-3.5" /> Pause
                </Button>
                <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5 border-red-500/20 text-red-600 hover:bg-red-500/5"
                  disabled={!canStopPause || update.isPending}
                  onClick={() => void handleControl("stopped")}>
                  <Square className="h-3.5 w-3.5" /> Stop
                </Button>
                <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5"
                  disabled={batchStatus === "running" || redial.isPending}
                  onClick={() => void handleRedialAll()}>
                  <RotateCcw className="h-3.5 w-3.5" /> Redial
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Edit schedule dialog ────────────────────────────────────────────── */}
      {header?.batch.scheduledStartAt && (
        <EditScheduleDialog
          open={editScheduleOpen}
          onOpenChange={setEditScheduleOpen}
          scheduledStartAt={header.batch.scheduledStartAt}
          timezone={header.batch.timezone ?? "UTC"}
          onSave={(iso) => void handleSaveSchedule(iso)}
          saving={isSavingSchedule}
        />
      )}

      <div className="flex-1 overflow-hidden min-h-0 min-w-0 px-4 sm:px-6 py-3 flex flex-col">
        <CampaignLeadsWorkspace campaignId={campaignId} lockedBatchId={batchId} />
      </div>

    </div>
  );
}
