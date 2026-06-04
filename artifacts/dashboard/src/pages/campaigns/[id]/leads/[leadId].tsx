import { useState } from "react";
import { useRoute, Link, useLocation } from "wouter";
import {
  useGetCampaignLeadProfile,
  useGetCampaignLeadTimeline,
  useRetryCampaignLead,
  useUpdateLeadCallback,
  getGetCampaignLeadProfileQueryKey,
} from "@workspace/api-client-react";
import type { UpdateLeadCallbackBodyStatus } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft, Phone, PhoneCall, PhoneIncoming, Clock, User, Mail,
  RotateCcw, CheckCircle2, XCircle, PauseCircle,
  Calendar, AlertCircle, ChevronDown, ChevronRight,
  Activity, Bell, History, FileText, Tag,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDuration(secs: number | null | undefined): string {
  if (!secs) return "—";
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function fmtDate(iso: string): string {
  return format(new Date(iso), "MMM d, yyyy · h:mm a");
}

function fmtRelative(iso: string): string {
  return formatDistanceToNow(new Date(iso), { addSuffix: true });
}

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; icon: React.ReactNode; cls: string }> = {
    pending:   { label: "Pending",   icon: <PauseCircle className="h-3 w-3" />,   cls: "bg-muted/60 text-muted-foreground border-border" },
    calling:   { label: "Calling",   icon: <PhoneCall className="h-3 w-3" />,     cls: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20" },
    completed: { label: "Completed", icon: <CheckCircle2 className="h-3 w-3" />,  cls: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20" },
    failed:    { label: "Failed",    icon: <XCircle className="h-3 w-3" />,       cls: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20" },
    skipped:   { label: "Skipped",   icon: <AlertCircle className="h-3 w-3" />,   cls: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20" },
  };
  const cfg = map[status] ?? { label: status, icon: null, cls: "bg-muted text-foreground border-border" };
  return (
    <span className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium", cfg.cls)}>
      {cfg.icon}{cfg.label}
    </span>
  );
}

// ── Timeline ──────────────────────────────────────────────────────────────────

function TimelineIcon({ type }: { type: string }) {
  const map: Record<string, { icon: React.ReactNode; bg: string }> = {
    imported:           { icon: <FileText className="h-3 w-3" />,     bg: "bg-muted text-muted-foreground" },
    call_started:       { icon: <PhoneCall className="h-3 w-3" />,    bg: "bg-blue-500/20 text-blue-500" },
    call_ended:         { icon: <CheckCircle2 className="h-3 w-3" />, bg: "bg-emerald-500/20 text-emerald-500" },
    call_failed:        { icon: <XCircle className="h-3 w-3" />,      bg: "bg-red-500/20 text-red-500" },
    retry_scheduled:    { icon: <Clock className="h-3 w-3" />,        bg: "bg-amber-500/20 text-amber-500" },
    retry_fired:        { icon: <RotateCcw className="h-3 w-3" />,    bg: "bg-blue-500/20 text-blue-500" },
    callback_detected:  { icon: <Bell className="h-3 w-3" />,         bg: "bg-purple-500/20 text-purple-500" },
    callback_completed: { icon: <CheckCircle2 className="h-3 w-3" />, bg: "bg-emerald-500/20 text-emerald-500" },
    incoming_call:      { icon: <PhoneIncoming className="h-3 w-3" />, bg: "bg-indigo-500/20 text-indigo-500" },
    disposition_set:    { icon: <Tag className="h-3 w-3" />,           bg: "bg-zinc-500/20 text-zinc-500" },
    dnc_blocked:        { icon: <XCircle className="h-3 w-3" />,       bg: "bg-red-500/20 text-red-500" },
    manual_retry:       { icon: <RotateCcw className="h-3 w-3" />,     bg: "bg-blue-500/20 text-blue-500" },
  };
  const cfg = map[type] ?? { icon: <Activity className="h-3 w-3" />, bg: "bg-muted text-muted-foreground" };
  return (
    <div className={cn("flex items-center justify-center h-6 w-6 rounded-full shrink-0", cfg.bg)}>
      {cfg.icon}
    </div>
  );
}

function tlLabel(type: string): string {
  const labels: Record<string, string> = {
    imported: "Imported", call_started: "Call Started", call_ended: "Call Ended",
    call_failed: "Call Failed", retry_scheduled: "Retry Scheduled", retry_fired: "Retry Fired",
    callback_detected: "Callback Detected", callback_completed: "Callback Completed",
    incoming_call: "Incoming Call", disposition_set: "Disposition Set",
    dnc_blocked: "DNC Blocked", manual_retry: "Manual Retry",
  };
  return labels[type] ?? type.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

// ── Execution card ────────────────────────────────────────────────────────────

function ExecutionCard({ exec, attemptNum }: {
  exec: { id: number; callId: number | null; attemptNumber: number; outcome: string | null; createdAt: string; call: Record<string, unknown> | null };
  attemptNum: number;
}) {
  const [open, setOpen] = useState(attemptNum === 1);
  const call = exec.call as (Record<string, unknown> & {
    transcript?: string; recordingUrl?: string; callSummary?: string;
    status?: string; durationSeconds?: number; dispositionResult?: Record<string, unknown>;
  }) | null;

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <button
        className="w-full flex items-center gap-3 px-4 py-3 bg-muted/20 hover:bg-muted/40 transition-colors text-left"
        onClick={() => setOpen(o => !o)}
      >
        <div className="h-6 w-6 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0 text-xs font-bold">
          {exec.attemptNumber}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">Attempt #{exec.attemptNumber}</p>
          <p className="text-xs text-muted-foreground">{fmtDate(exec.createdAt)}</p>
        </div>
        {call?.status && <StatusBadge status={String(call.status)} />}
        {call?.durationSeconds != null && (
          <span className="text-xs text-muted-foreground flex items-center gap-1 shrink-0">
            <Clock className="h-3 w-3" />{fmtDuration(Number(call.durationSeconds))}
          </span>
        )}
        {open ? <ChevronDown className="h-4 w-4 text-muted-foreground/50 shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground/50 shrink-0" />}
      </button>

      {open && call && (
        <div className="p-4 space-y-4 border-t border-border">
          {call.recordingUrl && (
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-widest mb-1.5">Recording</p>
              <audio controls src={String(call.recordingUrl)} className="w-full h-8" />
            </div>
          )}
          {call.callSummary && (
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-widest mb-1.5">AI Summary</p>
              <p className="text-sm text-foreground bg-muted/40 rounded-lg px-3 py-2.5 leading-relaxed">{String(call.callSummary)}</p>
            </div>
          )}
          {call.dispositionResult && Object.keys(call.dispositionResult).length > 0 && (
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-widest mb-1.5">Disposition</p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(call.dispositionResult).map(([k, v]) => (
                  <span key={k} className="px-2 py-0.5 rounded-full bg-muted border border-border text-xs">
                    <span className="text-muted-foreground">{k}:</span> <span className="font-medium">{String(v)}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
          {call.transcript && (
            <details className="group">
              <summary className="cursor-pointer text-[10px] text-muted-foreground uppercase tracking-widest list-none flex items-center gap-1.5 hover:text-foreground">
                <ChevronRight className="h-3 w-3 group-open:rotate-90 transition-transform" /> Transcript
              </summary>
              <pre className="mt-2 text-xs text-foreground bg-muted/40 rounded-lg p-3 whitespace-pre-wrap font-mono max-h-56 overflow-y-auto">
                {String(call.transcript)}
              </pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function CampaignLeadProfilePage() {
  const [, params] = useRoute("/app/campaigns/:id/leads/:leadId");
  const campaignId = parseInt(params?.id ?? "0", 10);
  const leadId     = parseInt(params?.leadId ?? "0", 10);

  const { toast } = useToast();
  const qc = useQueryClient();
  const [, setLocation] = useLocation();

  const { data, isLoading } = useGetCampaignLeadProfile(campaignId, leadId);
  const { data: timeline, isLoading: tlLoading } = useGetCampaignLeadTimeline(campaignId, leadId);
  const retry = useRetryCampaignLead();
  const updateCallback = useUpdateLeadCallback();

  const lead     = data?.lead;
  const campaign = data?.campaign;
  const latestCall = data?.latestCall;

  function handleRetry() {
    retry.mutate({ id: campaignId, leadId }, {
      onSuccess: () => {
        toast({ title: "Retry queued", description: "Lead will be called shortly." });
        void qc.invalidateQueries({ queryKey: getGetCampaignLeadProfileQueryKey(campaignId, leadId) });
      },
      onError: () => toast({ title: "Retry failed", variant: "destructive" }),
    });
  }

  function handleCallbackStatus(callbackId: number, status: string) {
    updateCallback.mutate({ id: campaignId, leadId, callbackId, data: { status: status as UpdateLeadCallbackBodyStatus } }, {
      onSuccess: () => {
        toast({ title: "Callback updated" });
        void qc.invalidateQueries({ queryKey: getGetCampaignLeadProfileQueryKey(campaignId, leadId) });
      },
    });
  }

  if (isLoading) {
    return (
      <div className="flex-1 flex flex-col h-full overflow-hidden animate-pulse">
        <div className="px-6 py-5 border-b border-border space-y-3">
          <Skeleton className="h-4 w-32 rounded" />
          <Skeleton className="h-7 w-56 rounded" />
        </div>
        <div className="flex-1 flex overflow-hidden">
          <div className="flex-1 p-6 space-y-4">
            <div className="grid grid-cols-4 gap-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>
            <Skeleton className="h-48 rounded-xl" />
          </div>
          <div className="w-72 border-l border-border p-4 space-y-4">
            {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-16 rounded-lg" />)}
          </div>
        </div>
      </div>
    );
  }

  if (!lead) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center h-full text-center">
        <AlertCircle className="h-10 w-10 text-muted-foreground/30 mb-4" />
        <p className="text-sm text-muted-foreground">Lead not found</p>
        <Button variant="outline" size="sm" className="mt-4 gap-1.5"
          onClick={() => setLocation(`${BASE}/app/campaigns/${campaignId}`)}>
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Campaign
        </Button>
      </div>
    );
  }

  const canRetry = lead.callStatus !== "calling";
  const callbacks = data?.callbacks ?? [];
  const executions = data?.executions ?? [];
  const pendingRetries = data?.pendingRetries ?? [];

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="px-6 pt-4 pb-4 border-b border-border shrink-0">
        <Link href={`${BASE}/app/campaigns/${campaignId}`}>
          <button className="flex items-center gap-1.5 text-xs text-muted-foreground/60 hover:text-foreground transition-colors mb-3">
            <ArrowLeft className="h-3.5 w-3.5" />
            {campaign?.name ?? "Campaign"}
          </button>
        </Link>
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="h-11 w-11 rounded-full bg-muted border border-border flex items-center justify-center shrink-0">
              <User className="h-5 w-5 text-muted-foreground/50" />
            </div>
            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <h1 className="text-xl font-semibold text-foreground leading-tight">{lead.name ?? "Unknown Lead"}</h1>
                <StatusBadge status={lead.callStatus} />
                {lead.disposition && (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border bg-muted/60 text-xs font-medium text-foreground">
                    <Tag className="h-3 w-3" />{lead.disposition}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-4 mt-1 flex-wrap">
                <span className="text-sm text-muted-foreground flex items-center gap-1.5">
                  <Phone className="h-3.5 w-3.5 shrink-0" />
                  <span className="font-mono">{lead.phone}</span>
                  {lead.normalizedPhone && lead.normalizedPhone !== lead.phone && (
                    <span className="text-xs text-muted-foreground/50">({lead.normalizedPhone})</span>
                  )}
                </span>
                {lead.email && (
                  <span className="text-sm text-muted-foreground flex items-center gap-1.5">
                    <Mail className="h-3.5 w-3.5 shrink-0" />{lead.email}
                  </span>
                )}
              </div>
            </div>
          </div>
          <Button size="sm" variant="outline" disabled={!canRetry || retry.isPending} onClick={handleRetry}
            className="shrink-0 h-8 text-xs gap-1.5">
            <RotateCcw className={cn("h-3.5 w-3.5", retry.isPending && "animate-spin")} /> Retry
          </Button>
        </div>
      </div>

      {/* ── Body: two-column ───────────────────────────────────────────────── */}
      <div className="flex-1 flex overflow-hidden">

        {/* ── Left: main content ─────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">

          {/* Stats strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Attempts",  value: lead.callAttempts,                                         icon: <RotateCcw className="h-4 w-4 text-muted-foreground/50" /> },
              { label: "Duration",  value: fmtDuration(latestCall?.durationSeconds as number | null), icon: <Clock className="h-4 w-4 text-muted-foreground/50" /> },
              { label: "Source",    value: lead.source.replace(/_/g, " "),                            icon: <Activity className="h-4 w-4 text-muted-foreground/50" /> },
              { label: "Callbacks", value: callbacks.length,                                           icon: <Bell className="h-4 w-4 text-muted-foreground/50" /> },
            ].map(s => (
              <div key={s.label} className="bg-card border border-border rounded-xl p-4">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">{s.icon}<span className="text-xs capitalize">{s.label}</span></div>
                <p className="text-2xl font-semibold text-foreground capitalize">{s.value}</p>
              </div>
            ))}
          </div>

          {/* Lead data fields */}
          {lead.leadData && Object.keys(lead.leadData).length > 0 && (
            <div className="bg-card border border-border rounded-xl p-5">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-4">Lead Data</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-8 gap-y-3">
                {Object.entries(lead.leadData).map(([k, v]) => (
                  <div key={k}>
                    <p className="text-[10px] text-muted-foreground/50 uppercase tracking-wider capitalize mb-0.5">{k.replace(/_/g, " ")}</p>
                    <p className="text-sm font-medium text-foreground truncate">{String(v)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Call history */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <History className="h-4 w-4 text-muted-foreground/50" />
              <h2 className="text-sm font-semibold text-foreground">Call History</h2>
              {executions.length > 0 && (
                <span className="text-xs text-muted-foreground/50">({executions.length} attempts)</span>
              )}
            </div>

            {executions.length === 0 && !latestCall ? (
              <div className="text-center py-10 bg-card border border-border rounded-xl text-muted-foreground/40">
                <PhoneCall className="h-8 w-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm">No call executions recorded yet</p>
              </div>
            ) : (
              <div className="space-y-3">
                {executions.length === 0 && latestCall && (
                  <ExecutionCard
                    exec={{ id: 0, callId: latestCall.id ?? null, attemptNumber: 1, outcome: null, createdAt: latestCall.createdAt ?? new Date().toISOString(), call: latestCall as Record<string, unknown> }}
                    attemptNum={1}
                  />
                )}
                {executions.map((exec, i) => (
                  <ExecutionCard key={exec.id}
                    exec={exec as { id: number; callId: number | null; attemptNumber: number; outcome: string | null; createdAt: string; call: Record<string, unknown> | null }}
                    attemptNum={i + 1}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Right: sidebar ─────────────────────────────────────────────── */}
        <div className="w-72 xl:w-80 border-l border-border overflow-y-auto shrink-0 bg-muted/5">

          {/* Callbacks */}
          <div className="p-4 border-b border-border">
            <div className="flex items-center gap-2 mb-3">
              <Bell className="h-4 w-4 text-muted-foreground/50" />
              <h3 className="text-xs font-semibold text-foreground">Callbacks</h3>
              {callbacks.length > 0 && <span className="ml-auto text-xs text-muted-foreground/40">{callbacks.length}</span>}
            </div>
            {callbacks.length === 0 ? (
              <p className="text-xs text-muted-foreground/40 text-center py-4">No callbacks detected</p>
            ) : (
              <div className="space-y-2.5">
                {callbacks.map(cb => (
                  <div key={cb.id} className="bg-card border border-border rounded-lg p-3">
                    <div className="flex items-start justify-between gap-2 mb-1.5">
                      <p className="text-xs font-medium text-foreground leading-snug">{cb.reason ?? "Callback requested"}</p>
                      <span className={cn(
                        "text-[10px] font-medium px-1.5 py-0.5 rounded border shrink-0",
                        cb.status === "completed" ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
                        : cb.status === "cancelled" ? "bg-muted text-muted-foreground border-border"
                        : "bg-amber-500/10 text-amber-600 border-amber-500/20"
                      )}>{cb.status}</span>
                    </div>
                    {cb.rawExtract && (
                      <p className="text-[11px] text-muted-foreground/60 italic mb-1.5">"{cb.rawExtract}"</p>
                    )}
                    {cb.callbackAt && (
                      <p className="text-[11px] text-muted-foreground/50 flex items-center gap-1 mb-1.5">
                        <Calendar className="h-3 w-3" />{format(new Date(cb.callbackAt), "MMM d, h:mm a")}
                      </p>
                    )}
                    {cb.status === "pending" && cb.id != null && (
                      <Button size="sm" variant="outline" className="w-full h-6 text-[10px] mt-1"
                        onClick={() => handleCallbackStatus(cb.id!, "completed")}>
                        Mark Done
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Pending retries */}
          {pendingRetries.length > 0 && (
            <div className="p-4 border-b border-border">
              <div className="flex items-center gap-2 mb-3">
                <Clock className="h-4 w-4 text-muted-foreground/50" />
                <h3 className="text-xs font-semibold text-foreground">Pending Retries</h3>
                <span className="ml-auto text-xs text-muted-foreground/40">{pendingRetries.length}</span>
              </div>
              <div className="space-y-2">
                {pendingRetries.map(r => (
                  <div key={r.id} className="bg-card border border-border rounded-lg p-3">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-xs font-medium text-foreground">Attempt #{r.attemptNumber}</p>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 border border-amber-500/20">Pending</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground/50">
                      {r.scheduledAt ? format(new Date(r.scheduledAt), "MMM d, h:mm a") : "—"}
                      {r.reason ? ` · ${r.reason}` : ""}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Timeline */}
          <div className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <Activity className="h-4 w-4 text-muted-foreground/50" />
              <h3 className="text-xs font-semibold text-foreground">Timeline</h3>
              {timeline && timeline.length > 0 && <span className="ml-auto text-xs text-muted-foreground/40">{timeline.length}</span>}
            </div>
            {tlLoading ? (
              <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-10 rounded-lg" />)}</div>
            ) : !timeline?.length ? (
              <p className="text-xs text-muted-foreground/40 text-center py-4">No events yet</p>
            ) : (
              <div className="relative">
                <div className="absolute left-3 top-0 bottom-0 w-px bg-border/60" />
                <div className="space-y-0.5">
                  {timeline.map(event => (
                    <div key={event.id} className="flex items-start gap-2.5 py-1.5 pl-1">
                      <TimelineIcon type={event.eventType} />
                      <div className="flex-1 min-w-0 pt-0.5">
                        <p className="text-xs font-medium text-foreground leading-snug">{tlLabel(event.eventType)}</p>
                        <p className="text-[10px] text-muted-foreground/50 mt-0.5">{fmtRelative(event.createdAt)}</p>
                        {event.data && Object.keys(event.data).length > 0 && (
                          <p className="text-[10px] text-muted-foreground/40 mt-0.5 truncate">
                            {Object.entries(event.data).slice(0, 2).map(([k, v]) => `${k}: ${String(v)}`).join(" · ")}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
