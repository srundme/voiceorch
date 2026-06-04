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
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ArrowLeft, Phone, PhoneCall, PhoneIncoming, Clock, User, Mail,
  RotateCcw, CheckCircle2, XCircle, PlayCircle, PauseCircle, Mic,
  Calendar, AlertCircle, ChevronDown, ChevronRight, Play, Info,
  MessageSquare, Activity, Bell, History, FileText, Tag, ExternalLink
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

// ── Timeline event icons ──────────────────────────────────────────────────────

function TimelineIcon({ type }: { type: string }) {
  const map: Record<string, { icon: React.ReactNode; bg: string }> = {
    imported:           { icon: <FileText className="h-3.5 w-3.5" />,    bg: "bg-muted" },
    call_started:       { icon: <PhoneCall className="h-3.5 w-3.5" />,   bg: "bg-blue-500/20 text-blue-500" },
    call_ended:         { icon: <CheckCircle2 className="h-3.5 w-3.5" />, bg: "bg-emerald-500/20 text-emerald-500" },
    call_failed:        { icon: <XCircle className="h-3.5 w-3.5" />,     bg: "bg-red-500/20 text-red-500" },
    retry_scheduled:    { icon: <Clock className="h-3.5 w-3.5" />,       bg: "bg-amber-500/20 text-amber-500" },
    retry_fired:        { icon: <RotateCcw className="h-3.5 w-3.5" />,   bg: "bg-blue-500/20 text-blue-500" },
    callback_detected:  { icon: <Bell className="h-3.5 w-3.5" />,        bg: "bg-purple-500/20 text-purple-500" },
    callback_completed: { icon: <CheckCircle2 className="h-3.5 w-3.5" />, bg: "bg-emerald-500/20 text-emerald-500" },
    incoming_call:      { icon: <PhoneIncoming className="h-3.5 w-3.5" />, bg: "bg-indigo-500/20 text-indigo-500" },
    disposition_set:    { icon: <Tag className="h-3.5 w-3.5" />,          bg: "bg-zinc-500/20 text-zinc-500" },
    dnc_blocked:        { icon: <XCircle className="h-3.5 w-3.5" />,      bg: "bg-red-500/20 text-red-500" },
    manual_retry:       { icon: <RotateCcw className="h-3.5 w-3.5" />,    bg: "bg-blue-500/20 text-blue-500" },
  };
  const cfg = map[type] ?? { icon: <Activity className="h-3.5 w-3.5" />, bg: "bg-muted" };
  return (
    <div className={cn("flex items-center justify-center h-7 w-7 rounded-full shrink-0", cfg.bg)}>
      {cfg.icon}
    </div>
  );
}

function TimelineLabel(type: string): string {
  const labels: Record<string, string> = {
    imported:           "Lead Imported",
    call_started:       "Call Started",
    call_ended:         "Call Ended",
    call_failed:        "Call Failed",
    retry_scheduled:    "Retry Scheduled",
    retry_fired:        "Retry Fired",
    callback_detected:  "Callback Intent Detected",
    callback_completed: "Callback Completed",
    incoming_call:      "Incoming Call",
    disposition_set:    "Disposition Set",
    dnc_blocked:        "Blocked — DNC",
    manual_retry:       "Manual Retry",
  };
  return labels[type] ?? type.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

// ── Call execution card ───────────────────────────────────────────────────────

function ExecutionCard({ exec, attemptNum }: { exec: { id: number; callId: number | null; attemptNumber: number; outcome: string | null; createdAt: string; call: Record<string, unknown> | null }; attemptNum: number }) {
  const [open, setOpen] = useState(attemptNum === 1);
  const call = exec.call as (Record<string, unknown> & { transcript?: string; recordingUrl?: string; callSummary?: string; status?: string; durationSeconds?: number; dispositionResult?: Record<string, unknown> }) | null;

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <button
        className="w-full flex items-center gap-3 px-4 py-3 bg-muted/30 hover:bg-muted/50 transition-colors text-left"
        onClick={() => setOpen(o => !o)}
      >
        <div className="flex items-center justify-center h-6 w-6 rounded-full bg-primary/10 text-primary shrink-0 text-xs font-bold">
          {exec.attemptNumber}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium">Attempt #{exec.attemptNumber}</div>
          <div className="text-xs text-muted-foreground">{fmtDate(exec.createdAt)}</div>
        </div>
        {call?.status && <StatusBadge status={String(call.status)} />}
        {call?.durationSeconds != null && (
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <Clock className="h-3 w-3" />{fmtDuration(Number(call.durationSeconds))}
          </span>
        )}
        {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
      </button>

      {open && call && (
        <div className="p-4 space-y-4 border-t border-border">
          {call.recordingUrl && (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground uppercase tracking-widest">Recording</p>
              <audio controls src={String(call.recordingUrl)} className="w-full h-9" />
            </div>
          )}
          {call.callSummary && (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground uppercase tracking-widest">AI Summary</p>
              <p className="text-sm text-foreground bg-muted/40 rounded-lg p-3 leading-relaxed">{String(call.callSummary)}</p>
            </div>
          )}
          {call.dispositionResult && Object.keys(call.dispositionResult as Record<string, unknown>).length > 0 && (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground uppercase tracking-widest">Disposition</p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(call.dispositionResult as Record<string, unknown>).map(([k, v]) => (
                  <span key={k} className="px-2 py-0.5 rounded-full bg-muted border border-border text-xs">
                    <span className="text-muted-foreground">{k}:</span> <span className="font-medium">{String(v)}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
          {call.transcript && (
            <details className="group">
              <summary className="cursor-pointer text-xs text-muted-foreground uppercase tracking-widest list-none flex items-center gap-1.5 hover:text-foreground">
                <ChevronRight className="h-3 w-3 group-open:rotate-90 transition-transform" /> Transcript
              </summary>
              <pre className="mt-2 text-xs text-foreground bg-muted/40 rounded-lg p-3 whitespace-pre-wrap font-mono max-h-64 overflow-y-auto">
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
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
        </div>
        <Skeleton className="h-96 rounded-xl" />
      </div>
    );
  }

  if (!lead) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-16 text-center">
        <AlertCircle className="h-10 w-10 text-muted-foreground mx-auto mb-4" />
        <p className="text-muted-foreground">Lead not found</p>
        <Button variant="outline" className="mt-4" onClick={() => setLocation(`${BASE}/app/campaigns/${campaignId}`)}>
          Back to Campaign
        </Button>
      </div>
    );
  }

  const latestCall = data?.latestCall;
  const canRetry = lead.callStatus !== "calling";

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <Link href={`${BASE}/app/campaigns/${campaignId}`}>
          <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground hover:text-foreground -ml-2">
            <ArrowLeft className="h-4 w-4" /> {campaign?.name ?? "Campaign"}
          </Button>
        </Link>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center shrink-0 border border-border">
            <User className="h-6 w-6 text-muted-foreground" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-foreground">{lead.name ?? "Unknown"}</h1>
            <div className="flex items-center gap-3 mt-1 flex-wrap">
              <span className="text-sm text-muted-foreground flex items-center gap-1.5">
                <Phone className="h-3.5 w-3.5" />{lead.phone}
                {lead.normalizedPhone && lead.normalizedPhone !== lead.phone && (
                  <span className="text-xs opacity-60">({lead.normalizedPhone})</span>
                )}
              </span>
              {lead.email && (
                <span className="text-sm text-muted-foreground flex items-center gap-1.5">
                  <Mail className="h-3.5 w-3.5" />{lead.email}
                </span>
              )}
              <StatusBadge status={lead.callStatus} />
              {lead.disposition && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border bg-muted/60 text-xs font-medium text-foreground">
                  <Tag className="h-3 w-3" />{lead.disposition}
                </span>
              )}
            </div>
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={!canRetry || retry.isPending}
          onClick={handleRetry}
          className="gap-2 shrink-0"
        >
          <RotateCcw className={cn("h-4 w-4", retry.isPending && "animate-spin")} />
          Retry
        </Button>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Attempts",      value: lead.callAttempts,                                icon: <RotateCcw className="h-4 w-4" /> },
          { label: "Duration",      value: fmtDuration(latestCall?.durationSeconds),         icon: <Clock className="h-4 w-4" /> },
          { label: "Source",        value: lead.source.replace(/_/g, " "),                   icon: <Activity className="h-4 w-4" /> },
          { label: "Callbacks",     value: data?.callbacks.length ?? 0,                      icon: <Bell className="h-4 w-4" /> },
        ].map(stat => (
          <div key={stat.label} className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              {stat.icon}
              <span className="text-xs uppercase tracking-widest">{stat.label}</span>
            </div>
            <p className="text-2xl font-semibold text-foreground capitalize">{stat.value}</p>
          </div>
        ))}
      </div>

      {/* Lead data */}
      {lead.leadData && Object.keys(lead.leadData).length > 0 && (
        <div className="rounded-xl border border-border bg-card p-4">
          <h3 className="text-xs uppercase tracking-widest text-muted-foreground mb-3">Lead Data</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-2">
            {Object.entries(lead.leadData).map(([k, v]) => (
              <div key={k}>
                <p className="text-xs text-muted-foreground capitalize">{k.replace(/_/g, " ")}</p>
                <p className="text-sm font-medium text-foreground truncate">{String(v)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tabs */}
      <Tabs defaultValue="calls">
        <TabsList className="border-b border-border rounded-none bg-transparent w-full justify-start gap-4 h-auto p-0">
          {[
            { value: "calls",     label: "Call History",  icon: <History className="h-3.5 w-3.5" />,    count: data?.executions.length },
            { value: "callbacks", label: "Callbacks",     icon: <Bell className="h-3.5 w-3.5" />,       count: data?.callbacks.length },
            { value: "retries",   label: "Retries",       icon: <RotateCcw className="h-3.5 w-3.5" />,  count: data?.pendingRetries.length },
            { value: "timeline",  label: "Timeline",      icon: <Activity className="h-3.5 w-3.5" />,   count: timeline?.length },
          ].map(tab => (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              className="flex items-center gap-1.5 px-0 pb-3 rounded-none border-b-2 border-transparent data-[state=active]:border-foreground data-[state=active]:bg-transparent text-muted-foreground data-[state=active]:text-foreground text-sm"
            >
              {tab.icon}{tab.label}
              {(tab.count ?? 0) > 0 && (
                <span className="ml-1 px-1.5 py-0.5 rounded-full bg-muted text-xs">{tab.count}</span>
              )}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* Call History */}
        <TabsContent value="calls" className="pt-4 space-y-3">
          {(data?.executions.length ?? 0) === 0 && !latestCall ? (
            <div className="text-center py-10 text-muted-foreground">
              <Phone className="h-8 w-8 mx-auto mb-3 opacity-30" />
              <p>No call executions recorded yet</p>
            </div>
          ) : (
            <>
              {/* If no executions but there's a latestCall (pre-CRM), show it */}
              {(data?.executions.length ?? 0) === 0 && latestCall && (
                <ExecutionCard
                  exec={{ id: 0, callId: latestCall.id ?? null, attemptNumber: 1, outcome: null, createdAt: latestCall.createdAt ?? new Date().toISOString(), call: latestCall as Record<string, unknown> }}
                  attemptNum={1}
                />
              )}
              {(data?.executions ?? []).map((exec, i) => (
                <ExecutionCard key={exec.id} exec={exec as { id: number; callId: number | null; attemptNumber: number; outcome: string | null; createdAt: string; call: Record<string, unknown> | null }} attemptNum={i + 1} />
              ))}
            </>
          )}
        </TabsContent>

        {/* Callbacks */}
        <TabsContent value="callbacks" className="pt-4 space-y-3">
          {(data?.callbacks.length ?? 0) === 0 ? (
            <div className="text-center py-10 text-muted-foreground">
              <Bell className="h-8 w-8 mx-auto mb-3 opacity-30" />
              <p>No callbacks detected</p>
              <p className="text-xs mt-1">The AI will auto-detect callback requests in the call</p>
            </div>
          ) : (
            (data?.callbacks ?? []).map(cb => (
              <div key={cb.id} className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <p className="text-sm font-medium">{cb.reason ?? "Callback requested"}</p>
                    {cb.rawExtract && (
                      <p className="text-xs text-muted-foreground italic">"{cb.rawExtract}"</p>
                    )}
                    {cb.callbackAt && (
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <Calendar className="h-3 w-3" />Scheduled: {fmtDate(cb.callbackAt)}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">{cb.createdAt ? fmtRelative(cb.createdAt) : ""}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      "px-2 py-0.5 rounded-full border text-xs",
                      cb.status === "completed" ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
                      : cb.status === "cancelled" ? "bg-muted text-muted-foreground border-border"
                      : "bg-amber-500/10 text-amber-600 border-amber-500/20"
                    )}>{cb.status}</span>
                    {cb.status === "pending" && cb.id != null && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={() => handleCallbackStatus(cb.id!, "completed")}
                      >
                        Mark Done
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </TabsContent>

        {/* Retries */}
        <TabsContent value="retries" className="pt-4 space-y-3">
          {(data?.pendingRetries.length ?? 0) === 0 ? (
            <div className="text-center py-10 text-muted-foreground">
              <Clock className="h-8 w-8 mx-auto mb-3 opacity-30" />
              <p>No pending retries scheduled</p>
            </div>
          ) : (
            (data?.pendingRetries ?? []).map(r => (
              <div key={r.id} className="rounded-xl border border-border bg-card p-4 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Attempt #{r.attemptNumber}</p>
                  <p className="text-xs text-muted-foreground">
                    Scheduled {r.scheduledAt ? fmtDate(r.scheduledAt) : "—"} · Reason: {r.reason ?? "—"}
                  </p>
                </div>
                <span className="px-2 py-0.5 rounded-full border border-amber-500/20 bg-amber-500/10 text-amber-600 text-xs">Pending</span>
              </div>
            ))
          )}
        </TabsContent>

        {/* Timeline */}
        <TabsContent value="timeline" className="pt-4">
          {tlLoading ? (
            <div className="space-y-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-12 rounded-xl" />)}</div>
          ) : (timeline?.length ?? 0) === 0 ? (
            <div className="text-center py-10 text-muted-foreground">
              <Activity className="h-8 w-8 mx-auto mb-3 opacity-30" />
              <p>No timeline events yet</p>
            </div>
          ) : (
            <div className="relative">
              <div className="absolute left-3.5 top-0 bottom-0 w-px bg-border" />
              <div className="space-y-1">
                {(timeline ?? []).map(event => (
                  <div key={event.id} className="flex items-start gap-3 py-2 pl-1">
                    <TimelineIcon type={event.eventType} />
                    <div className="flex-1 min-w-0 pt-0.5">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium text-foreground">{TimelineLabel(event.eventType)}</p>
                        <span className="text-xs text-muted-foreground shrink-0">{fmtRelative(event.createdAt)}</span>
                      </div>
                      {event.data && Object.keys(event.data).length > 0 && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {Object.entries(event.data).map(([k, v]) => `${k}: ${String(v)}`).join(" · ")}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
