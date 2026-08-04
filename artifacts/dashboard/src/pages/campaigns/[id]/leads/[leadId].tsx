/**
 * Lead CRM Workspace — Phase 5
 * ─────────────────────────────────────────────────────────────────────────────
 * Three-zone layout: Header | Center Panel (tabbed) | Right Sidebar
 * Single workspace endpoint loads everything; mutations use direct fetch.
 */

import { useState, useEffect } from "react";
import { useRoute, Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useUpdateLeadCallback, useRetryCampaignLead } from "@workspace/api-client-react";
import type { UpdateLeadCallbackBodyStatus } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { DetailNav } from "@/components/detail-nav";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  ArrowLeft, Phone, PhoneCall, PhoneIncoming, Clock, User, Mail,
  RotateCcw, CheckCircle2, XCircle, PauseCircle,
  Calendar, AlertCircle, ChevronDown, ChevronRight,
  Activity, Bell, History, FileText, Tag, Star, StarOff,
  Sparkles, Target, Hash, MessageSquare, ListTodo, Trash2,
  Plus, Check, X, ArrowRightLeft, TrendingUp, ChevronLeft,
  Database, RefreshCw,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";

/**
 * Plays a call recording served from the authenticated
 * `/api/storage/recordings/:callId` endpoint. The endpoint requires a Bearer
 * token, so we fetch it as a blob and play it via an object URL.
 */
function RecordingAudio({ src, className }: { src: string; className?: string }) {
  const { getToken } = useAuth();
  const [objUrl, setObjUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let revoked: string | null = null;
    let cancelled = false;
    (async () => {
      try {
        setError(null);
        const token = await getToken();
        const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
        const r = await fetch(src, { headers });
        if (!r.ok) throw new Error(`Failed to load recording (${r.status})`);
        const blob = await r.blob();
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        revoked = url;
        setObjUrl(url);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load recording");
      }
    })();
    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [src, getToken]);

  if (error) return <p className="text-xs text-destructive">{error}</p>;
  return <audio controls src={objUrl ?? undefined} className={className} />;
}

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

// ── Types ─────────────────────────────────────────────────────────────────────

type LeadWorkspace = {
  lead: {
    id: number; campaignId: number; batchId: number | null;
    phone: string; normalizedPhone: string | null; name: string | null;
    email: string | null; leadData: Record<string, unknown> | null;
    callStatus: string; callAttempts: number;
    disposition: string | null;
    operationalOutcome: string | null; leadScore: number | null;
    source: string; notes: string | null; lastAttemptAt: string | null; createdAt: string;
  };
  campaign: { id: number; name: string; agentName: string | null; fromNumber: string | null };
  batch:    { id: number; name: string; status: string } | null;
  source:   { name: string | null; type: string | null } | null;
  executions: ExecutionItem[];
  callbacks: CallbackItem[];
  pendingRetries: RetryItem[];
  bookings:  BookingItem[];
  transfers: TransferItem[];
  tags:      TagItem[];
  notes:     NoteItem[];
  tasks:     TaskItem[];
  interactionSummary: InteractionSummary | null;
};

type ExecutionItem = {
  id: number; callId: number | null; attemptNumber: number;
  outcome: string | null; callSummary: string | null;
  sentiment: string | null; detectedIntent: string | null;
  keyTopics: string[]; createdAt: string;
  call: {
    id: number; status: string; durationSeconds: number | null;
    transcript: string | null; recordingUrl: string | null;
    callSummary: string | null; dispositionResult: Record<string, unknown> | null;
    createdAt: string;
  } | null;
};

type CallbackItem = { id: number; status: string; reason: string | null; rawExtract: string | null; callbackAt: string | null; createdAt: string };
type RetryItem    = { id: number; attemptNumber: number; scheduledAt: string; reason: string | null; status: string };
type BookingItem  = { id: number; meetingTime: string | null; meetingStatus: string; meetingLink: string | null; bookingSource: string | null; bookedBy: string | null; createdAt: string };
type TransferItem = { id: number; transferredTo: string; outcome: string | null; durationSeconds: number | null; transferTime: string | null };
type TagItem      = { id: number; tag: string; createdAt: string };
type NoteItem     = { id: number; body: string; createdBy: string; createdAt: string };
type TaskItem     = { id: number; title: string; dueAt: string | null; status: string; assignedToId: string | null; createdAt: string; completedAt: string | null };
type TimelineEvent = { id: number; leadId: number; eventType: string; data: Record<string, unknown> | null; createdAt: string };
type InteractionSummary = { latestSummary: string | null; latestSentiment: string | null; latestIntent: string | null; latestTopics: string[]; interactionCount: number; lastContactAt: string | null };

// ── Helpers ───────────────────────────────────────────────────────────────────

async function apiFetch<T>(url: string, opts?: RequestInit): Promise<T> {
  const r = await fetch(url, { headers: { "Content-Type": "application/json" }, ...opts });
  if (!r.ok) throw new Error(await r.text());
  return r.json() as Promise<T>;
}

function fmtDuration(secs: number | null | undefined) {
  if (!secs) return "—";
  const m = Math.floor(secs / 60);
  return m > 0 ? `${m}m ${secs % 60}s` : `${secs}s`;
}
function fmtDate(iso: string) { return format(new Date(iso), "MMM d, yyyy · h:mm a"); }
function fmtRelative(iso: string) { return formatDistanceToNow(new Date(iso), { addSuffix: true }); }

// ── Status maps ───────────────────────────────────────────────────────────────

const CALL_STATUS_MAP: Record<string, { label: string; icon: React.ReactNode; cls: string }> = {
  pending:     { label: "Pending",     icon: <PauseCircle className="h-3 w-3" />,    cls: "bg-muted/60 text-muted-foreground border-border"          },
  calling:     { label: "Calling",     icon: <PhoneCall className="h-3 w-3" />,      cls: "bg-sky-500/10 text-sky-600 border-sky-500/20"             },
  connected:   { label: "Connected",   icon: <PhoneCall className="h-3 w-3" />,      cls: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20" },
  completed:   { label: "Completed",   icon: <CheckCircle2 className="h-3 w-3" />,   cls: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20" },
  transferred: { label: "Transferred", icon: <ArrowRightLeft className="h-3 w-3" />, cls: "bg-sky-500/10 text-sky-600 border-sky-500/20"             },
  failed:      { label: "Failed",      icon: <XCircle className="h-3 w-3" />,        cls: "bg-red-500/10 text-red-600 border-red-500/20"             },
  busy:        { label: "Busy",        icon: <XCircle className="h-3 w-3" />,        cls: "bg-amber-500/10 text-amber-600 border-amber-500/20"       },
  no_pickup:   { label: "No Answer",   icon: <XCircle className="h-3 w-3" />,        cls: "bg-amber-500/10 text-amber-600 border-amber-500/20"       },
  skipped:     { label: "Skipped",     icon: <AlertCircle className="h-3 w-3" />,    cls: "bg-amber-500/10 text-amber-600 border-amber-500/20"       },
};

const SENTIMENT_MAP: Record<string, { label: string; color: string; bg: string }> = {
  positive: { label: "Positive", color: "text-emerald-600", bg: "bg-emerald-500/10 border-emerald-500/20" },
  neutral:  { label: "Neutral",  color: "text-muted-foreground", bg: "bg-muted/50 border-border"         },
  negative: { label: "Negative", color: "text-red-600",    bg: "bg-red-500/10 border-red-500/20"         },
};

const TL_CFG: Record<string, { label: string; icon: React.ReactNode; bg: string }> = {
  imported:           { label: "Imported",          icon: <FileText className="h-3 w-3" />,       bg: "bg-muted text-muted-foreground"            },
  call_started:       { label: "Call Started",       icon: <PhoneCall className="h-3 w-3" />,      bg: "bg-sky-500/20 text-sky-500"               },
  call_ended:         { label: "Call Ended",         icon: <CheckCircle2 className="h-3 w-3" />,   bg: "bg-emerald-500/20 text-emerald-500"        },
  call_failed:        { label: "Call Failed",        icon: <XCircle className="h-3 w-3" />,        bg: "bg-red-500/20 text-red-500"               },
  retry_scheduled:    { label: "Retry Scheduled",    icon: <Clock className="h-3 w-3" />,          bg: "bg-amber-500/20 text-amber-500"            },
  retry_fired:        { label: "Retry Fired",        icon: <RotateCcw className="h-3 w-3" />,      bg: "bg-sky-500/20 text-sky-500"               },
  callback_detected:  { label: "Callback Detected",  icon: <Bell className="h-3 w-3" />,           bg: "bg-violet-500/20 text-violet-500"          },
  callback_completed: { label: "Callback Completed", icon: <CheckCircle2 className="h-3 w-3" />,   bg: "bg-emerald-500/20 text-emerald-500"        },
  incoming_call:      { label: "Incoming Call",      icon: <PhoneIncoming className="h-3 w-3" />,  bg: "bg-indigo-500/20 text-indigo-500"          },
  disposition_set:    { label: "Disposition Set",    icon: <Tag className="h-3 w-3" />,            bg: "bg-zinc-500/20 text-zinc-500"              },
  booking_created:    { label: "Booking Created",    icon: <Calendar className="h-3 w-3" />,       bg: "bg-emerald-500/20 text-emerald-500"        },
  transfer_completed: { label: "Transfer Completed", icon: <ArrowRightLeft className="h-3 w-3" />, bg: "bg-sky-500/20 text-sky-500"               },
  note_added:         { label: "Note Added",         icon: <MessageSquare className="h-3 w-3" />,  bg: "bg-amber-500/20 text-amber-500"           },
  task_created:       { label: "Task Created",       icon: <ListTodo className="h-3 w-3" />,       bg: "bg-violet-500/20 text-violet-500"          },
  task_completed:     { label: "Task Completed",     icon: <CheckCircle2 className="h-3 w-3" />,   bg: "bg-emerald-500/20 text-emerald-500"        },
  tag_added:          { label: "Tag Added",          icon: <Hash className="h-3 w-3" />,           bg: "bg-muted text-muted-foreground"            },
  score_updated:      { label: "Score Updated",      icon: <Star className="h-3 w-3" />,           bg: "bg-amber-500/20 text-amber-500"           },
  analysis_completed: { label: "Analysis Completed", icon: <Sparkles className="h-3 w-3" />,       bg: "bg-violet-500/20 text-violet-500"          },
};

// ── Execution Card ────────────────────────────────────────────────────────────

function ExecutionCard({ exec, idx }: { exec: ExecutionItem; idx: number }) {
  const [open, setOpen] = useState(idx === 0);
  const call = exec.call;
  const sc = CALL_STATUS_MAP[call?.status ?? ""] ?? CALL_STATUS_MAP["pending"]!;
  const sent = exec.sentiment ? SENTIMENT_MAP[exec.sentiment] : null;

  return (
    <div className="border border-border/50 rounded-xl overflow-hidden">
      <button
        className="w-full flex items-center gap-3 px-4 py-3 bg-muted/10 hover:bg-muted/30 transition-colors text-left"
        onClick={() => setOpen(o => !o)}
      >
        <div className="h-7 w-7 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0 text-xs font-bold">
          {exec.attemptNumber}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">Attempt #{exec.attemptNumber}</p>
          <p className="text-[11px] text-muted-foreground/60">{fmtDate(exec.createdAt)}</p>
        </div>
        <div className="flex items-center gap-2">
          {call?.status && (
            <span className={cn("inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border", sc.cls)}>
              {sc.icon}{sc.label}
            </span>
          )}
          {sent && (
            <span className={cn("hidden sm:inline-flex text-[10px] font-medium px-2 py-0.5 rounded-full border", sent.bg, sent.color)}>
              {sent.label}
            </span>
          )}
          {call?.durationSeconds != null && (
            <span className="hidden md:flex items-center gap-1 text-[11px] text-muted-foreground/60">
              <Clock className="h-3 w-3" />{fmtDuration(call.durationSeconds)}
            </span>
          )}
          {open ? <ChevronDown className="h-4 w-4 text-muted-foreground/40" /> : <ChevronRight className="h-4 w-4 text-muted-foreground/40" />}
        </div>
      </button>

      {open && (
        <div className="p-4 space-y-4 border-t border-border/30">
          {/* Intelligence row */}
          {(exec.detectedIntent || (exec.keyTopics?.length > 0)) && (
            <div className="flex flex-wrap gap-2">
              {exec.detectedIntent && (
                <div className="flex items-center gap-1.5 text-[11px] bg-violet-500/10 text-violet-600 border border-violet-500/20 px-2.5 py-1 rounded-full">
                  <Target className="h-3 w-3" /> {exec.detectedIntent}
                </div>
              )}
              {exec.keyTopics?.map((t, i) => (
                <span key={i} className="text-[11px] bg-muted/50 text-muted-foreground border border-border/50 px-2 py-0.5 rounded-full">
                  {t}
                </span>
              ))}
            </div>
          )}

          {/* AI Summary (execution-level, or call-level fallback) */}
          {(exec.callSummary ?? call?.callSummary) && (
            <div>
              <p className="text-[9px] text-muted-foreground/40 uppercase tracking-widest mb-1.5">AI Summary</p>
              <p className="text-sm text-foreground bg-muted/30 rounded-lg px-3 py-2.5 leading-relaxed">
                {exec.callSummary ?? call?.callSummary}
              </p>
            </div>
          )}

          {/* Recording */}
          {call?.recordingUrl && (
            <div>
              <p className="text-[9px] text-muted-foreground/40 uppercase tracking-widest mb-1.5">Recording</p>
              <RecordingAudio src={call.recordingUrl} className="w-full h-8" />
            </div>
          )}

          {/* Disposition result */}
          {call?.dispositionResult && Object.keys(call.dispositionResult).length > 0 && (
            <div>
              <p className="text-[9px] text-muted-foreground/40 uppercase tracking-widest mb-1.5">Disposition</p>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(call.dispositionResult).map(([k, v]) => (
                  <span key={k} className="px-2 py-0.5 rounded-full bg-muted/40 border border-border/50 text-[11px]">
                    <span className="text-muted-foreground/60">{k}:</span> <span className="font-medium">{String(v)}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Transcript */}
          {call?.transcript && (
            <details className="group">
              <summary className="cursor-pointer text-[9px] text-muted-foreground/40 uppercase tracking-widest list-none flex items-center gap-1.5 hover:text-foreground/70">
                <ChevronRight className="h-3 w-3 group-open:rotate-90 transition-transform" /> Transcript
              </summary>
              <pre className="mt-2 text-xs text-foreground bg-muted/30 rounded-lg p-3 whitespace-pre-wrap font-mono max-h-56 overflow-y-auto leading-relaxed">
                {call.transcript}
              </pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

// ── Overview Tab ──────────────────────────────────────────────────────────────

function OverviewTab({ ws }: { ws: LeadWorkspace }) {
  const { lead, interactionSummary, source } = ws;
  const sent = interactionSummary?.latestSentiment ? SENTIMENT_MAP[interactionSummary.latestSentiment] : null;

  return (
    <div className="p-5 space-y-4">
      {/* AI Intelligence Panel */}
      {interactionSummary && (interactionSummary.latestSummary || interactionSummary.latestIntent || (interactionSummary.latestTopics?.length > 0)) && (
        <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-3.5 w-3.5 text-violet-500" />
            <p className="text-[9px] font-semibold uppercase tracking-widest text-violet-500/70">AI Intelligence</p>
            <div className="ml-auto flex items-center gap-1.5 flex-wrap">
              {sent && (
                <span className={cn("text-[10px] font-medium px-2 py-0.5 rounded-full border", sent.bg, sent.color)}>
                  {sent.label}
                </span>
              )}
              {interactionSummary.latestIntent && (
                <span className="text-[10px] flex items-center gap-1 text-violet-600 bg-violet-500/10 border border-violet-500/20 px-2 py-0.5 rounded-full">
                  <Target className="h-2.5 w-2.5" /> {interactionSummary.latestIntent}
                </span>
              )}
            </div>
          </div>

          {interactionSummary.latestSummary && (
            <p className="text-sm leading-relaxed text-foreground/80">
              {interactionSummary.latestSummary}
            </p>
          )}

          {interactionSummary.latestTopics && interactionSummary.latestTopics.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {interactionSummary.latestTopics.map((t, i) => (
                <span key={i} className="text-[11px] bg-violet-500/10 text-violet-600/80 border border-violet-500/15 px-2 py-0.5 rounded-full">
                  {t}
                </span>
              ))}
            </div>
          )}

          {interactionSummary.lastContactAt && (
            <p className="text-[10px] text-muted-foreground/50">
              Last contact {fmtRelative(interactionSummary.lastContactAt)} · {interactionSummary.interactionCount} interaction{interactionSummary.interactionCount !== 1 ? "s" : ""}
            </p>
          )}
        </div>
      )}

      {/* Lead Data */}
      {lead.leadData && Object.keys(lead.leadData).length > 0 && (
        <div className="rounded-xl border border-border/40 bg-card p-4">
          <p className="text-[9px] uppercase tracking-widest font-semibold text-muted-foreground/40 mb-3">Lead Data</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-2.5">
            {Object.entries(lead.leadData).map(([k, v]) => (
              <div key={k}>
                <p className="text-[9px] text-muted-foreground/40 uppercase tracking-wider mb-0.5">{k.replace(/_/g, " ")}</p>
                <p className="text-xs font-medium truncate">{String(v)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Skip reason */}
      {lead.callStatus === "skipped" && lead.notes && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
          <p className="text-[9px] uppercase tracking-widest font-semibold text-amber-600/70 mb-1.5">Skip Reason</p>
          <p className="text-sm text-foreground/80">{lead.notes}</p>
        </div>
      )}

      {/* Quick facts */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Attempts",  value: lead.callAttempts,               icon: <RotateCcw className="h-3.5 w-3.5" /> },
          { label: "Outcome",   value: lead.operationalOutcome?.replace(/_/g, " ") ?? "—", icon: <TrendingUp className="h-3.5 w-3.5" /> },
          { label: "Score",     value: lead.leadScore != null ? `${lead.leadScore}/100` : "—", icon: <Star className="h-3.5 w-3.5" /> },
          { label: "Source",    value: source?.name ?? lead.source.replace(/_/g, " ") ?? "—", icon: <Database className="h-3.5 w-3.5" /> },
        ].map(s => (
          <div key={s.label} className="rounded-xl border border-border/40 bg-card p-3.5">
            <div className="flex items-center gap-1.5 text-muted-foreground/50 mb-1.5">
              {s.icon}<span className="text-[9px] uppercase tracking-widest">{s.label}</span>
            </div>
            <p className="text-base font-semibold capitalize truncate">{s.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Interactions Tab ──────────────────────────────────────────────────────────

function InteractionsTab({ executions }: { executions: ExecutionItem[] }) {
  return (
    <div className="p-5">
      {executions.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-2">
          <PhoneCall className="h-8 w-8 text-muted-foreground/20" />
          <p className="text-sm text-muted-foreground/40">No call attempts recorded yet</p>
        </div>
      ) : (
        <div className="space-y-3">
          {executions.map((e, i) => <ExecutionCard key={e.id} exec={e} idx={i} />)}
        </div>
      )}
    </div>
  );
}

// ── Timeline Tab ──────────────────────────────────────────────────────────────

function TimelineTab({ campaignId, leadId }: { campaignId: number; leadId: number }) {
  const { data: events = [], isFetching, refetch } = useQuery<TimelineEvent[]>({
    queryKey: ["lead-timeline-full", campaignId, leadId],
    queryFn: () => apiFetch(`${BASE}/api/campaigns/${campaignId}/leads/${leadId}/timeline`),
    refetchInterval: 15000,
  });

  return (
    <div className="p-5">
      <div className="flex items-center justify-between mb-4">
        <p className="text-[9px] uppercase tracking-widest font-semibold text-muted-foreground/40 flex items-center gap-2">
          <Activity className="h-3.5 w-3.5" /> Lead Timeline
        </p>
        <Button size="sm" variant="ghost" className={cn("h-7 gap-1.5 text-xs", isFetching && "opacity-60")}
          onClick={() => void refetch()}>
          <RefreshCw className={cn("h-3 w-3", isFetching && "animate-spin")} />
        </Button>
      </div>

      {events.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 gap-2">
          <Activity className="h-7 w-7 text-muted-foreground/20" />
          <p className="text-sm text-muted-foreground/40">No events recorded</p>
        </div>
      ) : (
        <div className="relative ml-3">
          <div className="absolute left-3 top-0 bottom-0 w-px bg-border/40" />
          <div className="space-y-0">
            {events.map(e => {
              const cfg = TL_CFG[e.eventType] ?? { label: e.eventType.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()), icon: <Activity className="h-3 w-3" />, bg: "bg-muted text-muted-foreground" };
              return (
                <div key={e.id} className="flex items-start gap-3 py-2 relative">
                  <div className={cn("flex items-center justify-center h-6 w-6 rounded-full shrink-0 z-10", cfg.bg)}>
                    {cfg.icon}
                  </div>
                  <div className="flex-1 min-w-0 pb-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-medium">{cfg.label}</span>
                      {e.data?.disposition != null && (
                        <span className="text-[10px] text-muted-foreground/60 italic">&ldquo;{String(e.data.disposition)}&rdquo;</span>
                      )}
                      {e.data?.tag != null && (
                        <span className="text-[10px] bg-muted/50 border border-border/50 px-1.5 py-0.5 rounded-full">#{String(e.data.tag)}</span>
                      )}
                      {typeof e.data?.score === "number" && (
                        <span className="text-[10px] text-amber-500">{e.data.score as number}/100</span>
                      )}
                      {e.data?.title != null && (
                        <span className="text-[10px] text-muted-foreground/60">&ldquo;{String(e.data.title)}&rdquo;</span>
                      )}
                    </div>
                    <p className="text-[10px] text-muted-foreground/40 mt-0.5">{fmtRelative(e.createdAt)}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Notes Tab ─────────────────────────────────────────────────────────────────

function NotesTab({ campaignId, leadId, initialNotes, onRefresh }: {
  campaignId: number; leadId: number;
  initialNotes: NoteItem[]; onRefresh: () => void;
}) {
  const [notes, setNotes] = useState<NoteItem[]>(initialNotes);
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  async function addNote() {
    if (!body.trim()) return;
    setSaving(true);
    try {
      const res = await apiFetch<{ note: NoteItem }>(
        `${BASE}/api/campaigns/${campaignId}/leads/${leadId}/notes`,
        { method: "POST", body: JSON.stringify({ body: body.trim() }) }
      );
      setNotes(prev => [res.note, ...prev]);
      setBody("");
      onRefresh();
    } catch { toast({ title: "Failed to save note", variant: "destructive" }); }
    finally { setSaving(false); }
  }

  async function deleteNote(noteId: number) {
    try {
      await apiFetch(`${BASE}/api/campaigns/${campaignId}/leads/${leadId}/notes/${noteId}`, { method: "DELETE" });
      setNotes(prev => prev.filter(n => n.id !== noteId));
      onRefresh();
    } catch { toast({ title: "Failed to delete note", variant: "destructive" }); }
  }

  return (
    <div className="p-5 space-y-4">
      {/* Add note */}
      <div className="rounded-xl border border-border/40 bg-card p-4 space-y-2.5">
        <p className="text-[9px] uppercase tracking-widest font-semibold text-muted-foreground/40">Add Note</p>
        <Textarea
          placeholder="Type a note about this lead…"
          value={body}
          onChange={e => setBody(e.target.value)}
          className="min-h-[80px] text-sm resize-none"
          onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void addNote(); }}
        />
        <div className="flex justify-end">
          <Button size="sm" className="h-7 text-xs gap-1.5" disabled={!body.trim() || saving} onClick={() => void addNote()}>
            <Plus className="h-3 w-3" /> {saving ? "Saving…" : "Add Note"}
          </Button>
        </div>
      </div>

      {/* Note list */}
      {notes.length === 0 ? (
        <div className="text-center py-8">
          <MessageSquare className="h-7 w-7 mx-auto text-muted-foreground/20 mb-2" />
          <p className="text-sm text-muted-foreground/40">No notes yet</p>
        </div>
      ) : (
        <div className="space-y-2">
          {notes.map(n => (
            <div key={n.id} className="rounded-xl border border-border/30 bg-card p-4 group">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm leading-relaxed flex-1">{n.body}</p>
                <Button size="icon" variant="ghost" className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                  onClick={() => void deleteNote(n.id)}>
                  <Trash2 className="h-3 w-3 text-destructive/60" />
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground/40 mt-2">{fmtRelative(n.createdAt)}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Tasks Tab ─────────────────────────────────────────────────────────────────

function TasksTab({ campaignId, leadId, initialTasks, onRefresh }: {
  campaignId: number; leadId: number;
  initialTasks: TaskItem[]; onRefresh: () => void;
}) {
  const [tasks, setTasks] = useState<TaskItem[]>(initialTasks);
  const [title, setTitle] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  async function addTask() {
    if (!title.trim()) return;
    setSaving(true);
    try {
      const res = await apiFetch<{ task: TaskItem }>(
        `${BASE}/api/campaigns/${campaignId}/leads/${leadId}/tasks`,
        { method: "POST", body: JSON.stringify({ title: title.trim(), dueAt: dueAt || undefined }) }
      );
      setTasks(prev => [res.task, ...prev]);
      setTitle(""); setDueAt("");
      onRefresh();
    } catch { toast({ title: "Failed to create task", variant: "destructive" }); }
    finally { setSaving(false); }
  }

  async function toggleTask(taskId: number, currentStatus: string) {
    const newStatus = currentStatus === "done" ? "open" : "done";
    try {
      await apiFetch(`${BASE}/api/campaigns/${campaignId}/leads/${leadId}/tasks/${taskId}`, {
        method: "PATCH", body: JSON.stringify({ status: newStatus }),
      });
      setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: newStatus, completedAt: newStatus === "done" ? new Date().toISOString() : null } : t));
      onRefresh();
    } catch { toast({ title: "Failed to update task", variant: "destructive" }); }
  }

  async function deleteTask(taskId: number) {
    try {
      await apiFetch(`${BASE}/api/campaigns/${campaignId}/leads/${leadId}/tasks/${taskId}`, { method: "DELETE" });
      setTasks(prev => prev.filter(t => t.id !== taskId));
      onRefresh();
    } catch { toast({ title: "Failed to delete task", variant: "destructive" }); }
  }

  const open = tasks.filter(t => t.status === "open");
  const done = tasks.filter(t => t.status === "done");

  return (
    <div className="p-5 space-y-4">
      {/* Add task */}
      <div className="rounded-xl border border-border/40 bg-card p-4 space-y-2.5">
        <p className="text-[9px] uppercase tracking-widest font-semibold text-muted-foreground/40">New Task</p>
        <div className="flex gap-2">
          <Input placeholder="Task title…" value={title} onChange={e => setTitle(e.target.value)} className="flex-1 h-8 text-sm"
            onKeyDown={e => { if (e.key === "Enter") void addTask(); }} />
          <Input type="datetime-local" value={dueAt} onChange={e => setDueAt(e.target.value)} className="w-40 h-8 text-xs" />
          <Button size="sm" className="h-8 gap-1.5 text-xs shrink-0" disabled={!title.trim() || saving} onClick={() => void addTask()}>
            <Plus className="h-3 w-3" /> Add
          </Button>
        </div>
      </div>

      {tasks.length === 0 ? (
        <div className="text-center py-8">
          <ListTodo className="h-7 w-7 mx-auto text-muted-foreground/20 mb-2" />
          <p className="text-sm text-muted-foreground/40">No tasks yet</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {[...open, ...done].map(t => (
            <div key={t.id} className={cn("flex items-start gap-3 rounded-xl border px-4 py-3 group transition-colors",
              t.status === "done" ? "border-border/20 bg-muted/10 opacity-60" : "border-border/40 bg-card"
            )}>
              <button className="mt-0.5 shrink-0" onClick={() => void toggleTask(t.id, t.status)}>
                <div className={cn("h-4 w-4 rounded border-2 flex items-center justify-center transition-colors",
                  t.status === "done" ? "bg-emerald-500 border-emerald-500" : "border-border hover:border-foreground/40"
                )}>
                  {t.status === "done" && <Check className="h-2.5 w-2.5 text-white" />}
                </div>
              </button>
              <div className="flex-1 min-w-0">
                <p className={cn("text-sm font-medium", t.status === "done" && "line-through text-muted-foreground/50")}>{t.title}</p>
                {t.dueAt && (
                  <p className={cn("text-[10px] flex items-center gap-1 mt-0.5",
                    new Date(t.dueAt) < new Date() && t.status === "open" ? "text-red-500" : "text-muted-foreground/50"
                  )}>
                    <Clock className="h-2.5 w-2.5" />Due {format(new Date(t.dueAt), "MMM d, h:mm a")}
                  </p>
                )}
                {t.completedAt && (
                  <p className="text-[10px] text-muted-foreground/40 mt-0.5">Completed {fmtRelative(t.completedAt)}</p>
                )}
              </div>
              <Button size="icon" variant="ghost" className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                onClick={() => void deleteTask(t.id)}>
                <Trash2 className="h-3 w-3 text-destructive/60" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Right Sidebar ─────────────────────────────────────────────────────────────

function RightSidebar({ ws, campaignId, leadId, onCallbackUpdate, onTagRefresh }: {
  ws: LeadWorkspace;
  campaignId: number; leadId: number;
  onCallbackUpdate: (callbackId: number, status: string) => void;
  onTagRefresh: () => void;
}) {
  const { callbacks, bookings, transfers, tags } = ws;
  const [newTag, setNewTag] = useState("");
  const [localTags, setLocalTags] = useState<TagItem[]>(tags);
  const { toast } = useToast();

  async function addTag() {
    const t = newTag.trim().toLowerCase();
    if (!t) return;
    try {
      const res = await apiFetch<{ tag: TagItem }>(
        `${BASE}/api/campaigns/${campaignId}/leads/${leadId}/tags`,
        { method: "POST", body: JSON.stringify({ tag: t }) }
      );
      setLocalTags(prev => [...prev, res.tag]);
      setNewTag("");
      onTagRefresh();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "";
      if (msg.includes("409") || msg.includes("already")) {
        toast({ title: "Tag already exists" });
      } else {
        toast({ title: "Failed to add tag", variant: "destructive" });
      }
    }
  }

  async function removeTag(tagId: number) {
    try {
      await apiFetch(`${BASE}/api/campaigns/${campaignId}/leads/${leadId}/tags/${tagId}`, { method: "DELETE" });
      setLocalTags(prev => prev.filter(t => t.id !== tagId));
      onTagRefresh();
    } catch { toast({ title: "Failed to remove tag", variant: "destructive" }); }
  }

  return (
    <div className="w-72 xl:w-80 border-l border-border/40 overflow-y-auto shrink-0 bg-muted/5">

      {/* Callbacks */}
      <div className="p-4 border-b border-border/30">
        <div className="flex items-center gap-2 mb-3">
          <Bell className="h-3.5 w-3.5 text-amber-500" />
          <h3 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">Callbacks</h3>
          {callbacks.length > 0 && <span className="ml-auto text-[10px] text-muted-foreground/40">{callbacks.length}</span>}
        </div>
        {callbacks.length === 0 ? (
          <p className="text-[11px] text-muted-foreground/30 text-center py-3">No callbacks</p>
        ) : (
          <div className="space-y-2">
            {callbacks.map(cb => (
              <div key={cb.id} className="bg-card border border-border/30 rounded-lg p-3">
                <div className="flex items-start justify-between gap-1.5 mb-1">
                  <p className="text-xs font-medium leading-snug">{cb.reason ?? "Callback requested"}</p>
                  <span className={cn(
                    "text-[9px] font-semibold px-1.5 py-0.5 rounded border shrink-0",
                    cb.status === "completed" ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
                    : cb.status === "cancelled" ? "bg-muted text-muted-foreground border-border"
                    : "bg-amber-500/10 text-amber-600 border-amber-500/20"
                  )}>{cb.status}</span>
                </div>
                {cb.rawExtract && <p className="text-[10px] text-muted-foreground/50 italic mb-1">&ldquo;{cb.rawExtract}&rdquo;</p>}
                {cb.callbackAt && (
                  <p className="text-[10px] text-muted-foreground/50 flex items-center gap-1 mb-1">
                    <Calendar className="h-2.5 w-2.5" />{format(new Date(cb.callbackAt), "MMM d, h:mm a")}
                  </p>
                )}
                {cb.status === "pending" && (
                  <Button size="sm" variant="outline" className="w-full h-6 text-[10px] mt-1"
                    onClick={() => onCallbackUpdate(cb.id, "completed")}>
                    Mark Done
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Bookings */}
      <div className="p-4 border-b border-border/30">
        <div className="flex items-center gap-2 mb-3">
          <Calendar className="h-3.5 w-3.5 text-emerald-500" />
          <h3 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">Bookings</h3>
          {bookings.length > 0 && <span className="ml-auto text-[10px] text-muted-foreground/40">{bookings.length}</span>}
        </div>
        {bookings.length === 0 ? (
          <p className="text-[11px] text-muted-foreground/30 text-center py-3">No bookings</p>
        ) : (
          <div className="space-y-2">
            {bookings.map(b => (
              <div key={b.id} className="bg-card border border-border/30 rounded-lg p-3">
                <div className="flex items-center justify-between gap-1.5 mb-1">
                  <span className={cn(
                    "text-[9px] font-semibold px-1.5 py-0.5 rounded border",
                    b.meetingStatus === "scheduled" ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
                    : b.meetingStatus === "cancelled" ? "bg-red-500/10 text-red-500 border-red-500/20"
                    : "bg-muted text-muted-foreground border-border"
                  )}>{b.meetingStatus}</span>
                  {b.bookingSource && <span className="text-[9px] text-muted-foreground/40">{b.bookingSource}</span>}
                </div>
                {b.meetingTime && (
                  <p className="text-xs font-medium">{format(new Date(b.meetingTime), "MMM d, h:mm a")}</p>
                )}
                {b.meetingLink && (
                  <a href={b.meetingLink} target="_blank" rel="noreferrer"
                    className="text-[10px] text-sky-500 hover:underline flex items-center gap-1 mt-1">
                    Join Meeting <ChevronRight className="h-2.5 w-2.5" />
                  </a>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Transfers */}
      <div className="p-4 border-b border-border/30">
        <div className="flex items-center gap-2 mb-3">
          <ArrowRightLeft className="h-3.5 w-3.5 text-sky-500" />
          <h3 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">Transfers</h3>
          {transfers.length > 0 && <span className="ml-auto text-[10px] text-muted-foreground/40">{transfers.length}</span>}
        </div>
        {transfers.length === 0 ? (
          <p className="text-[11px] text-muted-foreground/30 text-center py-3">No transfers</p>
        ) : (
          <div className="space-y-2">
            {transfers.map(t => (
              <div key={t.id} className="bg-card border border-border/30 rounded-lg p-3">
                <p className="text-xs font-medium font-mono">{t.transferredTo}</p>
                <div className="flex items-center gap-2 mt-1">
                  {t.outcome && (
                    <span className={cn(
                      "text-[9px] font-semibold px-1.5 py-0.5 rounded border",
                      t.outcome === "completed" ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
                      : "bg-muted text-muted-foreground border-border"
                    )}>{t.outcome}</span>
                  )}
                  {t.durationSeconds != null && (
                    <span className="text-[10px] text-muted-foreground/50">{fmtDuration(t.durationSeconds)}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Tags */}
      <div className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <Hash className="h-3.5 w-3.5 text-muted-foreground/50" />
          <h3 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">Tags</h3>
        </div>
        <div className="flex flex-wrap gap-1.5 mb-3 min-h-[24px]">
          {localTags.map(t => (
            <span key={t.id} className="group inline-flex items-center gap-1 text-[11px] bg-muted/50 border border-border/50 text-foreground/70 px-2 py-0.5 rounded-full">
              #{t.tag}
              <button className="opacity-0 group-hover:opacity-100 transition-opacity ml-0.5"
                onClick={() => void removeTag(t.id)}>
                <X className="h-2.5 w-2.5 text-destructive/60" />
              </button>
            </span>
          ))}
          {localTags.length === 0 && <p className="text-[11px] text-muted-foreground/30">No tags</p>}
        </div>
        <div className="flex gap-1.5">
          <Input
            placeholder="Add tag…" value={newTag} onChange={e => setNewTag(e.target.value)}
            className="h-7 text-xs flex-1"
            onKeyDown={e => { if (e.key === "Enter") void addTag(); }}
          />
          <Button size="sm" variant="outline" className="h-7 w-7 p-0" disabled={!newTag.trim()} onClick={() => void addTag()}>
            <Plus className="h-3 w-3" />
          </Button>
        </div>
      </div>

    </div>
  );
}

// ── Score Editor ──────────────────────────────────────────────────────────────

function ScoreEditor({ campaignId, leadId, initial, onSaved }: {
  campaignId: number; leadId: number; initial: number | null; onSaved: (s: number | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(String(initial ?? ""));
  const { toast } = useToast();

  async function save() {
    const score = val === "" ? null : parseInt(val, 10);
    if (val !== "" && (isNaN(score!) || score! < 0 || score! > 100)) {
      toast({ title: "Score must be 0–100", variant: "destructive" }); return;
    }
    try {
      await apiFetch(`${BASE}/api/campaigns/${campaignId}/leads/${leadId}`, {
        method: "PATCH", body: JSON.stringify({ score }),
      });
      onSaved(score);
      setEditing(false);
    } catch { toast({ title: "Failed to save score", variant: "destructive" }); }
  }

  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        className="flex items-center gap-1 text-[10px] text-muted-foreground/60 hover:text-foreground transition-colors px-2 py-1 rounded border border-transparent hover:border-border/40"
        title="Edit lead score"
      >
        {initial != null ? (
          <><Star className="h-2.5 w-2.5 text-amber-400" />{initial}<span className="text-muted-foreground/30">/100</span></>
        ) : (
          <><StarOff className="h-2.5 w-2.5" />Score</>
        )}
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <Input
        autoFocus type="number" min={0} max={100} value={val}
        onChange={e => setVal(e.target.value)}
        className="h-6 w-16 text-xs px-2"
        onKeyDown={e => { if (e.key === "Enter") void save(); if (e.key === "Escape") setEditing(false); }}
      />
      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => void save()}><Check className="h-3 w-3" /></Button>
      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setEditing(false)}><X className="h-3 w-3" /></Button>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

type CrmTab = "overview" | "interactions" | "timeline" | "notes" | "tasks";

export default function LeadCrmWorkspacePage() {
  const [, params] = useRoute("/app/campaigns/:id/leads/:leadId");
  const campaignId = parseInt(params?.id     ?? "0", 10);
  const leadId     = parseInt(params?.leadId ?? "0", 10);

  const [activeTab, setActiveTab] = useState<CrmTab>("overview");
  const [score, setScore] = useState<number | null>(null);
  const [scoreInit, setScoreInit] = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, navigate] = useLocation();

  const updateCallback = useUpdateLeadCallback();
  const retry = useRetryCampaignLead();

  const workspaceKey = ["lead-workspace", campaignId, leadId];

  const { data: ws, isLoading, refetch } = useQuery<LeadWorkspace>({
    queryKey: workspaceKey,
    queryFn: () => apiFetch<LeadWorkspace>(`${BASE}/api/campaigns/${campaignId}/leads/${leadId}/workspace`),
    refetchInterval: 30000,
  });

  useEffect(() => {
    if (ws && !scoreInit) { setScore(ws.lead.leadScore); setScoreInit(true); }
  }, [ws, scoreInit]);

  const lead     = ws?.lead;
  const campaign = ws?.campaign;

  function handleCallbackUpdate(callbackId: number, status: string) {
    updateCallback.mutate({ id: campaignId, leadId, callbackId, data: { status: status as UpdateLeadCallbackBodyStatus } }, {
      onSuccess: () => {
        toast({ title: "Callback updated" });
        void refetch();
      },
    });
  }

  function handleRetry() {
    retry.mutate({ id: campaignId, leadId }, {
      onSuccess: () => {
        toast({ title: "Retry queued", description: "Lead will be called shortly." });
        void refetch();
      },
      onError: () => toast({ title: "Retry failed", variant: "destructive" }),
    });
  }

  const TABS: { key: CrmTab; label: string; icon: React.ReactNode; badge?: number }[] = [
    { key: "overview",      label: "Overview",      icon: <Sparkles className="h-3 w-3"   /> },
    { key: "interactions",  label: "Interactions",  icon: <PhoneCall className="h-3 w-3"  />, badge: ws?.executions.length },
    { key: "timeline",      label: "Timeline",      icon: <Activity className="h-3 w-3"   /> },
    { key: "notes",         label: "Notes",         icon: <MessageSquare className="h-3 w-3" />, badge: ws?.notes.length },
    { key: "tasks",         label: "Tasks",         icon: <ListTodo className="h-3 w-3"   />, badge: ws?.tasks.filter(t => t.status === "open").length },
  ];

  // ── Loading skeleton ──────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        <div className="px-6 py-5 border-b border-border space-y-3">
          <Skeleton className="h-4 w-48" /><Skeleton className="h-8 w-64" />
        </div>
        <div className="flex-1 flex overflow-hidden">
          <div className="flex-1 p-5 space-y-4">
            <div className="flex gap-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-8 w-20 rounded-lg" />)}</div>
            <Skeleton className="h-36 rounded-xl" />
            <div className="grid grid-cols-4 gap-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>
          </div>
          <div className="w-72 border-l border-border p-4 space-y-4">
            {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-24 rounded-lg" />)}
          </div>
        </div>
      </div>
    );
  }

  if (!lead || !campaign) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center h-full text-center gap-3">
        <AlertCircle className="h-10 w-10 text-muted-foreground/30" />
        <p className="text-sm text-muted-foreground">Lead not found</p>
        <Button variant="outline" size="sm" className="gap-1.5"
          onClick={() => navigate(`/app/campaigns/${campaignId}`)}>
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Campaign
        </Button>
      </div>
    );
  }

  const sc = CALL_STATUS_MAP[lead.callStatus] ?? CALL_STATUS_MAP["pending"]!;

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="px-6 pt-4 pb-4 border-b border-border/40 shrink-0">
        {/* Breadcrumb */}
        <DetailNav
          className="mb-3"
          backTo={ws?.batch ? `/app/campaigns/${campaignId}/batches/${ws.batch.id}` : `/app/campaigns/${campaignId}`}
          backLabel="Back"
          crumbs={[
            { label: "Campaign Studios", href: "/app/campaigns" },
            { label: campaign.name, href: `/app/campaigns/${campaignId}` },
            ...(ws?.batch
              ? [{ label: ws.batch.name, href: `/app/campaigns/${campaignId}/batches/${ws.batch.id}` }]
              : []),
            { label: lead.name ?? lead.phone },
          ]}
        />

        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3.5">
            {/* Avatar */}
            <div className="h-11 w-11 rounded-full bg-gradient-to-br from-violet-500/20 to-sky-500/20 border border-border/50 flex items-center justify-center shrink-0">
              <User className="h-5 w-5 text-muted-foreground/50" />
            </div>

            {/* Identity */}
            <div>
              <div className="flex items-center gap-2.5 flex-wrap mb-1">
                <h1 className="text-xl font-semibold leading-tight">{lead.name ?? "Unknown Lead"}</h1>
                <span className={cn("inline-flex items-center gap-1 text-[10px] font-semibold px-2.5 py-1 rounded-full border", sc.cls)}>
                  {sc.icon}{sc.label}
                </span>
                {lead.disposition && (
                  <span className="inline-flex items-center gap-1 text-[10px] px-2.5 py-1 rounded-full border border-border/50 bg-muted/50">
                    <Tag className="h-2.5 w-2.5" />{lead.disposition}
                  </span>
                )}
                <ScoreEditor
                  campaignId={campaignId} leadId={leadId}
                  initial={score ?? lead.leadScore} onSaved={(s) => setScore(s)}
                />
              </div>

              <div className="flex items-center gap-4 flex-wrap">
                <span className="text-sm text-muted-foreground flex items-center gap-1.5">
                  <Phone className="h-3.5 w-3.5 shrink-0" />
                  <span className="font-mono">{lead.phone}</span>
                </span>
                {lead.email && (
                  <span className="text-sm text-muted-foreground flex items-center gap-1.5">
                    <Mail className="h-3.5 w-3.5 shrink-0" />{lead.email}
                  </span>
                )}
                {campaign.agentName && (
                  <span className="text-[11px] text-muted-foreground/50 flex items-center gap-1">
                    <User className="h-2.5 w-2.5" />{campaign.agentName}
                  </span>
                )}
                <span className="text-[11px] text-muted-foreground/40">
                  Imported {fmtRelative(lead.createdAt)}
                </span>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 shrink-0">
            <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5"
              onClick={() => navigate(`/app/campaigns/${campaignId}`)}>
              <ArrowLeft className="h-3.5 w-3.5" /> Campaign
            </Button>
            <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5"
              disabled={lead.callStatus === "calling" || retry.isPending}
              onClick={handleRetry}>
              <RotateCcw className={cn("h-3.5 w-3.5", retry.isPending && "animate-spin")} /> Retry
            </Button>
          </div>
        </div>
      </div>

      {/* ── Body: center + sidebar ─────────────────────────────────────────── */}
      <div className="flex-1 flex overflow-hidden min-h-0">

        {/* Center panel */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          {/* Tab bar */}
          <div className="flex items-center gap-0.5 px-5 py-2 border-b border-border/20 shrink-0">
            {TABS.map(t => (
              <button key={t.key} onClick={() => setActiveTab(t.key)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors",
                  activeTab === t.key
                    ? "bg-foreground/10 text-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/30",
                )}
              >
                {t.icon}{t.label}
                {t.badge != null && t.badge > 0 && (
                  <span className="text-[9px] bg-muted/60 px-1.5 py-0.5 rounded-full">{t.badge}</span>
                )}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-auto min-h-0">
            {activeTab === "overview"     && ws && <OverviewTab ws={ws} />}
            {activeTab === "interactions" && ws && <InteractionsTab executions={ws.executions} />}
            {activeTab === "timeline"     && <TimelineTab campaignId={campaignId} leadId={leadId} />}
            {activeTab === "notes"        && ws && (
              <NotesTab campaignId={campaignId} leadId={leadId}
                initialNotes={ws.notes} onRefresh={() => void refetch()} />
            )}
            {activeTab === "tasks"        && ws && (
              <TasksTab campaignId={campaignId} leadId={leadId}
                initialTasks={ws.tasks} onRefresh={() => void refetch()} />
            )}
          </div>
        </div>

        {/* Right sidebar */}
        {ws && (
          <RightSidebar
            ws={ws} campaignId={campaignId} leadId={leadId}
            onCallbackUpdate={handleCallbackUpdate}
            onTagRefresh={() => void refetch()}
          />
        )}
      </div>

    </div>
  );
}
