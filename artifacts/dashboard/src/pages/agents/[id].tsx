import React, { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "@/lib/auth";
import { Link, useParams, useLocation } from "wouter";
import { format, parseISO } from "date-fns";
import {
  ArrowLeft, Settings2, Activity, Phone, BarChart2, Clock,
  Mic, MicOff, PhoneOff, Copy, Check, Loader2, Volume2, PhoneOutgoing, Pencil,
  Brain, Trash2, ChevronDown, ChevronRight, User, Calendar, Archive,
  ArrowRight, MessageSquare, History, GitBranch, Fingerprint, ShieldCheck,
  ShieldAlert, Clock3, AlertCircle,
} from "lucide-react";
import {
  useGetAgent,
  getGetAgentQueryKey,
  useListCalls,
  getListCallsQueryKey,
  useInitiateOutboundCall,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { formatApiError, isKycError, isDestinationUnverifiedError } from "@/lib/format-api-error";
import { DestinationOtpDialog } from "@/components/destination-otp-dialog";
import { WebCallPanel } from "@/components/webcall-panel";

/* ── Caller Memory Tab ────────────────────────────────────────────────────── */

interface CallerRow {
  phoneNumber: string;
  name: string | null;
  summary: string | null;
  callCount: number;
  factCount: number;
  archiveCount: number;
  lastCalledAt: string | null;
  lastCallDropped: boolean;
}

// ── Graph memory types (Graphiti-style L0/L1/L2) ─────────────────────────────

interface FactHistory {
  id: number;
  value: string;
  confidence: number;
  createdAt: string;
}

interface FactRow {
  id: number;
  key: string;
  value: string;
  confidence: number;
  sourceCallId: number | null;
  sourceSentenceIds: number[];
  createdAt: string;
  /** Older versions of this fact, oldest-first (superseded_by chain) */
  history: FactHistory[];
}

interface SentenceNode {
  id: number;
  sequenceNum: number;
  speaker: string;   // 'caller' | 'agent'
  text: string;
}

interface EpisodeRow {
  id: number;
  callId: number | null;
  summary: string | null;
  durationSeconds: number | null;
  createdAt: string;
  /** L0 fact IDs extracted from this episode (insight_facts edges) */
  insightFactIds: number[];
  /** L2 sentence nodes in NEXT-edge order */
  sentences: SentenceNode[];
}

interface CallerDetail {
  facts: FactRow[];
  episodes: EpisodeRow[];
}

function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return format(new Date(iso), "MMM d");
}

function fmtDur(s: number | null): string {
  if (!s) return "0s";
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return m > 0 ? `${m}m ${r}s` : `${r}s`;
}

function CallerMemoryTab({ agentId }: { agentId: number }) {
  const { getToken } = useAuth();
  const [callers, setCallers]             = useState<CallerRow[] | null>(null);
  const [loading, setLoading]             = useState(true);
  const [expanded, setExpanded]           = useState<string | null>(null);
  const [detail, setDetail]               = useState<Record<string, CallerDetail>>({});
  const [detailLoading, setDL]            = useState<string | null>(null);
  const [deleting, setDeleting]           = useState<number | null>(null);
  const [openSentences, setOpenSentences] = useState<Set<number>>(new Set());
  const [openHistory, setOpenHistory]     = useState<Set<number>>(new Set());
  const { toast } = useToast();

  const authHeaders = useCallback(async (): Promise<Record<string, string>> => {
    const token = await getToken();
    return token ? { "Authorization": `Bearer ${token}` } : {};
  }, [getToken]);

  useEffect(() => {
    void (async () => {
      try {
        const h = await authHeaders();
        const r = await fetch(`/api/agents/${agentId}/caller-memory`, { headers: h });
        if (r.ok) setCallers(await r.json() as CallerRow[]);
      } catch { /* ignore */ } finally { setLoading(false); }
    })();
  }, [agentId, authHeaders]);

  const loadDetail = useCallback(async (phone: string) => {
    if (detail[phone]) return;
    setDL(phone);
    try {
      const h = await authHeaders();
      const r = await fetch(`/api/agents/${agentId}/caller-memory/${encodeURIComponent(phone)}`, { headers: h });
      if (r.ok) {
        const body = await r.json() as CallerDetail;
        setDetail(prev => ({ ...prev, [phone]: body }));
      }
    } catch { /* ignore */ } finally { setDL(null); }
  }, [agentId, authHeaders, detail]);

  const toggleExpand = (phone: string) => {
    if (expanded === phone) { setExpanded(null); return; }
    setExpanded(phone);
    void loadDetail(phone);
  };

  const toggleSentences = (epId: number) =>
    setOpenSentences(prev => { const s = new Set(prev); s.has(epId) ? s.delete(epId) : s.add(epId); return s; });

  const toggleHistory = (factId: number) =>
    setOpenHistory(prev => { const s = new Set(prev); s.has(factId) ? s.delete(factId) : s.add(factId); return s; });

  const deleteFact = async (phone: string, factId: number) => {
    setDeleting(factId);
    try {
      const h = await authHeaders();
      await fetch(`/api/agents/${agentId}/caller-memory/${encodeURIComponent(phone)}/facts/${factId}`, { method: "DELETE", headers: h });
      setDetail(prev => ({
        ...prev,
        [phone]: { ...prev[phone]!, facts: prev[phone]!.facts.filter(f => f.id !== factId) },
      }));
      setCallers(prev => prev?.map(c =>
        c.phoneNumber === phone ? { ...c, factCount: Math.max(0, c.factCount - 1) } : c
      ) ?? null);
      toast({ title: "Fact forgotten", description: "Entire revision chain deleted." });
    } catch {
      toast({ title: "Failed to delete fact", variant: "destructive" });
    } finally { setDeleting(null); }
  };

  if (loading) return (
    <div className="space-y-3 mt-2">
      {[1,2,3].map(i => <Skeleton key={i} className="h-14 w-full" />)}
    </div>
  );

  if (!callers || callers.length === 0) return (
    <div className="flex flex-col items-center justify-center py-24 text-center gap-3">
      <Brain className="h-12 w-12 text-muted-foreground/30" />
      <p className="text-muted-foreground font-medium">No caller memory yet</p>
      <p className="text-sm text-muted-foreground/70 max-w-xs">
        After the first call the system builds a graph memory: L0 facts, L1 episodes, and L2 sentences linked by NEXT edges.
      </p>
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Brain className="h-4 w-4" />
          <span><span className="font-semibold text-foreground">{callers.length}</span> caller{callers.length !== 1 ? "s" : ""} tracked</span>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1"><span className="font-mono bg-primary/10 text-primary px-1 rounded text-[10px]">L0</span>facts</span>
          <span className="flex items-center gap-1"><span className="font-mono bg-amber-500/10 text-amber-600 px-1 rounded text-[10px]">L1</span>episodes</span>
          <span className="flex items-center gap-1"><span className="font-mono bg-emerald-500/10 text-emerald-600 px-1 rounded text-[10px]">L2</span>sentences</span>
        </div>
      </div>

      <div className="rounded-lg border overflow-hidden">
        {callers.map((caller, idx) => {
          const isOpen = expanded === caller.phoneNumber;
          const d = detail[caller.phoneNumber];

          return (
            <div key={caller.phoneNumber} className={idx > 0 ? "border-t" : ""}>
              {/* Caller row */}
              <button
                className="w-full flex items-center gap-4 px-4 py-3 hover:bg-muted/40 transition-colors text-left"
                onClick={() => toggleExpand(caller.phoneNumber)}
              >
                <div className="text-muted-foreground">
                  {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm truncate">{caller.name ?? caller.phoneNumber}</span>
                    {caller.lastCallDropped && <Badge className="text-[10px] px-1.5 py-0 bg-amber-500/20 text-amber-500 border-transparent">dropped</Badge>}
                  </div>
                  {caller.name && <div className="text-xs text-muted-foreground font-mono">{caller.phoneNumber}</div>}
                </div>
                <div className="flex items-center gap-5 text-xs text-muted-foreground shrink-0">
                  <div className="flex items-center gap-1"><Phone className="h-3 w-3" />{caller.callCount}</div>
                  <div className="flex items-center gap-1"><Brain className="h-3 w-3" />{caller.factCount} facts</div>
                  <div className="flex items-center gap-1"><Archive className="h-3 w-3" />{caller.archiveCount} ep</div>
                  <div className="flex items-center gap-1"><Clock className="h-3 w-3" />{relativeTime(caller.lastCalledAt)}</div>
                </div>
              </button>

              {/* Expanded graph detail */}
              {isOpen && (
                <div className="border-t bg-muted/20 px-4 py-4 space-y-5">
                  {detailLoading === caller.phoneNumber && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                      <Loader2 className="h-4 w-4 animate-spin" />Loading memory graph…
                    </div>
                  )}

                  {/* LLM summary */}
                  {caller.summary && (
                    <div className="text-sm text-muted-foreground italic border-l-2 border-primary/30 pl-3">
                      {caller.summary}
                    </div>
                  )}

                  {/* ── L0 Facts ────────────────────────────────────────────── */}
                  {d && (
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-[11px] font-mono font-bold bg-primary/10 text-primary px-1.5 py-0.5 rounded">L0</span>
                        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Facts</span>
                        <span className="ml-auto text-[10px] text-muted-foreground/60 italic">vector search · superseded_by edges</span>
                      </div>
                      {d.facts.length === 0 ? (
                        <p className="text-xs text-muted-foreground">No facts extracted yet.</p>
                      ) : (
                        <div className="rounded-md border overflow-hidden">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b bg-muted/50">
                                <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground w-36">Key</th>
                                <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Current Value</th>
                                <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground w-24">Confidence</th>
                                <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground w-24">Revisions</th>
                                <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground w-24">Learned</th>
                                <th className="w-8" />
                              </tr>
                            </thead>
                            <tbody>
                              {d.facts.map(fact => (
                                <React.Fragment key={fact.id}>
                                  <tr className="border-b last:border-0 hover:bg-muted/30">
                                    <td className="px-3 py-2 font-mono text-xs text-primary">{fact.key}</td>
                                    <td className="px-3 py-2 font-medium">{fact.value}</td>
                                    <td className="px-3 py-2">
                                      <div className="flex items-center gap-1.5">
                                        <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden max-w-16">
                                          <div
                                            className={`h-full rounded-full ${fact.confidence >= 0.8 ? "bg-emerald-500" : fact.confidence >= 0.6 ? "bg-amber-500" : "bg-red-400"}`}
                                            style={{ width: `${Math.round(fact.confidence * 100)}%` }}
                                          />
                                        </div>
                                        <span className="text-xs text-muted-foreground">{Math.round(fact.confidence * 100)}%</span>
                                      </div>
                                    </td>
                                    <td className="px-3 py-2">
                                      {fact.history.length > 0 ? (
                                        <button
                                          onClick={() => toggleHistory(fact.id)}
                                          className="flex items-center gap-1 text-xs text-amber-600 hover:text-amber-700 transition-colors"
                                        >
                                          <History className="h-3 w-3" />
                                          {fact.history.length} rev
                                          {openHistory.has(fact.id) ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                                        </button>
                                      ) : (
                                        <span className="text-xs text-muted-foreground/50">—</span>
                                      )}
                                    </td>
                                    <td className="px-3 py-2 text-xs text-muted-foreground">{relativeTime(fact.createdAt)}</td>
                                    <td className="px-2 py-2">
                                      <button
                                        onClick={() => void deleteFact(caller.phoneNumber, fact.id)}
                                        disabled={deleting === fact.id}
                                        className="text-muted-foreground hover:text-destructive transition-colors disabled:opacity-40"
                                        title="Forget this fact (deletes entire revision chain)"
                                      >
                                        {deleting === fact.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                                      </button>
                                    </td>
                                  </tr>
                                  {/* Supersession chain (superseded_by edges) */}
                                  {openHistory.has(fact.id) && fact.history.length > 0 && (
                                    <tr className="border-b last:border-0 bg-amber-500/5">
                                      <td colSpan={6} className="px-4 py-2.5">
                                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                                          <GitBranch className="h-3 w-3 text-amber-500" />
                                          <span className="font-medium text-amber-600">superseded_by chain</span>
                                        </div>
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                          {fact.history.map((h, i) => (
                                            <React.Fragment key={h.id}>
                                              <span className="font-mono text-xs line-through text-muted-foreground/60 bg-muted px-1.5 py-0.5 rounded">
                                                {h.value}
                                              </span>
                                              <ArrowRight className="h-3 w-3 text-muted-foreground/40 shrink-0" />
                                            </React.Fragment>
                                          ))}
                                          <span className="font-mono text-xs font-semibold text-foreground bg-primary/10 px-1.5 py-0.5 rounded border border-primary/20">
                                            {fact.value} ← current
                                          </span>
                                        </div>
                                        <p className="text-[10px] text-muted-foreground/50 mt-1">
                                          {fact.history.map((h, i) => `${h.value} (${relativeTime(h.createdAt)})`).join(" → ")} → {fact.value} (current)
                                        </p>
                                      </td>
                                    </tr>
                                  )}
                                </React.Fragment>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── L1 Episodes ─────────────────────────────────────────── */}
                  {d && d.episodes.length > 0 && (
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-[11px] font-mono font-bold bg-amber-500/10 text-amber-600 px-1.5 py-0.5 rounded">L1</span>
                        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Episodes</span>
                        <span className="ml-auto text-[10px] text-muted-foreground/60 italic">graph traversal · insight_facts edges</span>
                      </div>
                      <div className="space-y-2">
                        {d.episodes.map(ep => {
                          const epFacts = d.facts.filter(f => ep.insightFactIds.includes(f.id));
                          const sentOpen = openSentences.has(ep.id);
                          return (
                            <div key={ep.id} className="rounded-md border bg-card overflow-hidden">
                              <div className="px-3 py-2.5 space-y-1.5">
                                {/* Episode header */}
                                <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                                  <Calendar className="h-3 w-3 shrink-0" />
                                  <span>{format(new Date(ep.createdAt), "MMM d, yyyy · HH:mm")}</span>
                                  {ep.durationSeconds && <span>· {fmtDur(ep.durationSeconds)}</span>}
                                  {/* insight_facts badges */}
                                  {epFacts.length > 0 && (
                                    <div className="flex items-center gap-1 ml-auto flex-wrap">
                                      <span className="text-[10px] text-muted-foreground/60">insight_facts:</span>
                                      {epFacts.map(f => (
                                        <Badge key={f.id} className="text-[10px] px-1.5 py-0 bg-primary/10 text-primary border-transparent font-mono">
                                          {f.key}
                                        </Badge>
                                      ))}
                                    </div>
                                  )}
                                  {ep.sentences.length > 0 && (
                                    <button
                                      onClick={() => toggleSentences(ep.id)}
                                      className={`flex items-center gap-1 text-[11px] transition-colors shrink-0 ${sentOpen ? "text-emerald-600" : "text-muted-foreground hover:text-foreground"}`}
                                    >
                                      <MessageSquare className="h-3 w-3" />
                                      {ep.sentences.length} sentences
                                      {sentOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                                    </button>
                                  )}
                                </div>
                                {ep.summary && <p className="text-sm">{ep.summary}</p>}
                              </div>

                              {/* L2 sentence timeline (NEXT edges) */}
                              {sentOpen && ep.sentences.length > 0 && (
                                <div className="border-t">
                                  <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-500/5 border-b">
                                    <span className="text-[11px] font-mono font-bold bg-emerald-500/10 text-emerald-600 px-1.5 py-0.5 rounded">L2</span>
                                    <span className="text-[11px] text-muted-foreground">Sentences — NEXT chain ({ep.sentences.length} nodes)</span>
                                  </div>
                                  <div className="divide-y">
                                    {ep.sentences.map((s, i) => {
                                      const isSource = d.facts.some(f => f.sourceSentenceIds.includes(s.id));
                                      return (
                                        <div key={s.id}>
                                          <div className={`flex items-start gap-2 px-3 py-2 ${isSource ? "bg-primary/5" : ""}`}>
                                            <span className="text-[10px] font-mono text-muted-foreground/50 pt-0.5 w-5 shrink-0 select-none">s{s.sequenceNum}</span>
                                            <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 mt-0.5 font-medium ${
                                              s.speaker === "caller"
                                                ? "bg-blue-500/10 text-blue-600"
                                                : "bg-muted text-muted-foreground"
                                            }`}>
                                              {s.speaker}
                                            </span>
                                            <span className="text-xs text-foreground/80 flex-1 leading-relaxed">{s.text}</span>
                                            {isSource && (
                                              <span className="text-[10px] text-primary/60 shrink-0 mt-0.5 font-mono">fact_source</span>
                                            )}
                                          </div>
                                          {i < ep.sentences.length - 1 && (
                                            <div className="flex items-center gap-1 px-3 py-0.5 bg-muted/20">
                                              <ArrowRight className="h-2.5 w-2.5 text-muted-foreground/30" />
                                              <span className="text-[9px] font-mono text-muted-foreground/25">NEXT</span>
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── Agent Detail Page ────────────────────────────────────────────────────── */

export default function AgentDetail() {
  const params = useParams();
  const id = parseInt(params.id || "0", 10);
  // Support ?tab=test&autostart=1&callbackId=X URL params so the incoming-call notification
  // can deep-link straight to the Test Call tab and instantly start a callback call.
  const searchParams = new URLSearchParams(window.location.search);
  const initialTab    = searchParams.get("tab") === "test" ? "test" : "overview";
  const isAutostart   = searchParams.get("autostart") === "1";
  const urlCallbackId = searchParams.get("callbackId") ? parseInt(searchParams.get("callbackId")!, 10) : undefined;
  const [activeTab, setActiveTab] = useState(initialTab);
  const [callDialogOpen, setCallDialogOpen] = useState(false);
  const [toNumber, setToNumber] = useState("");
  const { toast } = useToast();

  const { data: agent, isLoading: agentLoading } = useGetAgent(id, {
    query: { enabled: !!id, queryKey: getGetAgentQueryKey(id) }
  });

  const { data: calls, isLoading: callsLoading } = useListCalls({ agentId: id }, {
    query: { enabled: !!id && activeTab === "calls", queryKey: getListCallsQueryKey({ agentId: id }) }
  });

  const outboundCall = useInitiateOutboundCall();
  const [, navigate] = useLocation();
  const [otpDialogOpen, setOtpDialogOpen]       = useState(false);
  const [pendingCallNumber, setPendingCallNumber] = useState("");

  function handleMakeCall(overrideNumber?: string) {
    const dest = (overrideNumber ?? toNumber).trim();
    if (!dest) return;
    outboundCall.mutate(
      { data: { agentId: id, toNumber: dest, webhookBaseUrl: window.location.origin } },
      {
        onSuccess: () => {
          toast({ title: "Call initiated", description: `Dialing ${dest} — the agent will connect momentarily.` });
          setCallDialogOpen(false);
          setToNumber("");
        },
        onError: (err: unknown) => {
          if (isKycError(err)) {
            toast({ title: "Verification required", description: "Complete identity verification before making telephony calls.", variant: "destructive" });
            navigate("/app/kyc");
          } else if (isDestinationUnverifiedError(err)) {
            setPendingCallNumber(dest);
            setOtpDialogOpen(true);
          } else {
            toast({ title: "Call failed", description: formatApiError(err), variant: "destructive" });
          }
        },
      }
    );
  }

  const formatDuration = (seconds?: number | null) => {
    if (!seconds) return "0s";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "completed":  return <Badge className="bg-primary/20 text-primary border-transparent">Completed</Badge>;
      case "failed":     return <Badge className="bg-destructive/20 text-destructive border-transparent">Failed</Badge>;
      case "in_progress":return <Badge className="bg-muted text-zinc-400 border-transparent">In Progress</Badge>;
      case "pending":    return <Badge variant="outline" className="text-muted-foreground">Pending</Badge>;
      default:           return <Badge variant="outline">{status}</Badge>;
    }
  };

  const tabClass = "relative h-10 rounded-none border-b-2 border-transparent bg-transparent px-4 pb-3 pt-2 font-medium text-muted-foreground shadow-none transition-none data-[state=active]:border-primary data-[state=active]:text-foreground data-[state=active]:shadow-none";

  if (agentLoading) {
    return (
      <div className="p-8 space-y-6">
        <Skeleton className="h-10 w-[200px]" />
        <Skeleton className="h-[200px] w-full" />
      </div>
    );
  }

  if (!agent) {
    return <div className="p-8 text-center text-muted-foreground">Agent not found.</div>;
  }

  return (
    <div className="flex-1 space-y-6 p-6 md:p-8 pt-6 h-full flex flex-col">
      {/* Make a Call Dialog */}
      <Dialog open={callDialogOpen} onOpenChange={setCallDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PhoneOutgoing className="h-5 w-5 text-primary" />
              Make a Phone Call
            </DialogTitle>
            <DialogDescription>
              This will dial the number using your <span className="font-medium capitalize">{agent.telephonyProvider}</span> account.
              The agent <span className="font-medium">{agent.name}</span> will handle the conversation.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="toNumber">Destination number (E.164 format)</Label>
              <Input
                id="toNumber"
                placeholder="+1234567890"
                value={toNumber}
                onChange={e => setToNumber(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") handleMakeCall(); }}
              />
              <p className="text-xs text-muted-foreground">
                Include country code, e.g. <code className="font-mono bg-muted px-1 rounded">+14155552671</code>
              </p>
            </div>
            <div className="rounded-md bg-muted/50 border p-3 text-xs text-muted-foreground space-y-1">
              <p className="font-medium text-foreground">Before making a call, ensure:</p>
              <p>• Your <span className="font-medium capitalize">{agent.telephonyProvider}</span> provider key is configured on the <Link href="/providers" className="underline">Providers page</Link></p>
              {agent.telephonyProvider === "twilio" && <p>• Extra Config includes <code className="font-mono bg-muted px-1">accountSid</code> and <code className="font-mono bg-muted px-1">fromNumber</code></p>}
              {agent.telephonyProvider === "plivo"  && <p>• Extra Config includes <code className="font-mono bg-muted px-1">authId</code> and <code className="font-mono bg-muted px-1">fromNumber</code></p>}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCallDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={() => handleMakeCall()}
              disabled={!toNumber.trim() || outboundCall.isPending}
              className="gap-2"
            >
              {outboundCall.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <PhoneOutgoing className="h-4 w-4" />}
              {outboundCall.isPending ? "Dialing…" : "Call Now"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DestinationOtpDialog
        open={otpDialogOpen}
        phoneNumber={pendingCallNumber}
        onClose={() => setOtpDialogOpen(false)}
        onVerified={() => {
          setOtpDialogOpen(false);
          handleMakeCall(pendingCallNumber);
        }}
      />

      <div className="flex items-center gap-4">
        <Link href="/agents">
          <Button variant="outline" size="icon" className="h-8 w-8">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex items-center gap-3 flex-1">
          <h2 className="text-3xl font-bold tracking-tight">{agent.name}</h2>
          {agent.status === "active"   && <Badge className="bg-zinc-500 hover:bg-zinc-600">Active</Badge>}
          {agent.status === "inactive" && <Badge variant="secondary">Inactive</Badge>}
          {agent.status === "draft"    && <Badge variant="outline" className="text-zinc-500 border-zinc-500">Draft</Badge>}
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <Link href={`/app/agents/${id}/edit`}>
            <Button variant="outline" className="gap-2">
              <Pencil className="h-4 w-4" />
              Edit Agent
            </Button>
          </Link>
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => setCallDialogOpen(true)}
          >
            <PhoneOutgoing className="h-4 w-4" />
            Make a Call
          </Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
        <TabsList className="w-full justify-start rounded-none border-b bg-transparent p-0">
          <TabsTrigger value="overview"      className={tabClass}>Overview</TabsTrigger>
          <TabsTrigger value="test"          className={tabClass}>
            <Mic className="h-3.5 w-3.5 mr-1.5" />Test Call
          </TabsTrigger>
          <TabsTrigger value="configuration" className={tabClass}>Configuration</TabsTrigger>
          <TabsTrigger value="calls"         className={tabClass}>Call History</TabsTrigger>
          <TabsTrigger value="memory"        className={tabClass}>
            <Brain className="h-3.5 w-3.5 mr-1.5" />Caller Memory
          </TabsTrigger>
        </TabsList>

        <div className="mt-6 flex-1 overflow-auto">
          {/* ── Overview ── */}
          <TabsContent value="overview" className="m-0 h-full">
            <div className="grid gap-4 md:grid-cols-3 mb-6">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Total Calls</CardTitle>
                  <Phone className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{agent.totalCalls || 0}</div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Success Rate</CardTitle>
                  <BarChart2 className="h-4 w-4 text-primary" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {agent.totalCalls ? Math.round(((agent.successfulCalls || 0) / agent.totalCalls) * 100) : 0}%
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Avg Duration</CardTitle>
                  <Clock className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{formatDuration(agent.avgDurationSeconds)}</div>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Pipeline Map</CardTitle>
                <CardDescription>Current orchestration configuration for this agent</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col md:flex-row items-center justify-between gap-4 py-8">
                  {[
                    { label: "Telephony In", value: agent.telephonyProvider, sub: null, highlight: false },
                    { label: "ASR",          value: agent.asrProvider,       sub: agent.asrModel || "default", highlight: false },
                    { label: "LLM Core",     value: agent.llmProvider,       sub: agent.llmModel || "default", highlight: true  },
                    { label: "TTS",          value: agent.ttsProvider,       sub: agent.ttsVoice || "default", highlight: false },
                  ].map((stage, i) => (
                    <React.Fragment key={stage.label}>
                      <div className={`flex flex-col items-center gap-2 p-4 border rounded-lg w-full text-center ${
                        stage.highlight ? "bg-primary/10 border-primary/30" : "bg-card"
                      }`}>
                        <span className={`text-[10px] uppercase tracking-widest font-bold ${stage.highlight ? "text-primary" : "text-foreground/75"}`}>
                          {stage.label}
                        </span>
                        <span className="font-medium capitalize">{stage.value}</span>
                        {stage.sub && <span className="text-xs text-muted-foreground">{stage.sub}</span>}
                      </div>
                      {i < 3 && <ArrowLeft className="rotate-90 md:rotate-180 text-muted-foreground shrink-0" />}
                    </React.Fragment>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Test Call ── */}
          <TabsContent value="test" className="m-0">
            <WebCallPanel agentId={agent.id} agentName={agent.name} autostart={isAutostart} callbackId={urlCallbackId} />
          </TabsContent>

          {/* ── Configuration ── */}
          <TabsContent value="configuration" className="m-0">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Settings2 className="h-5 w-5 text-primary" />
                  System Prompt
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="bg-muted/50 p-4 rounded-md border border-border/50 font-mono text-sm whitespace-pre-wrap">
                  {agent.systemPrompt}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Call History ── */}
          <TabsContent value="calls" className="m-0 h-full flex flex-col">
            <Card className="flex-1 flex flex-col overflow-hidden">
              <CardContent className="p-0 flex-1 overflow-auto">
                <Table>
                  <TableHeader className="bg-muted/50 sticky top-0 z-10">
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>To / From</TableHead>
                      <TableHead>Duration</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {callsLoading ? (
                      Array.from({ length: 5 }).map((_, i) => (
                        <TableRow key={i}>
                          {Array.from({ length: 5 }).map((_, j) => (
                            <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                          ))}
                        </TableRow>
                      ))
                    ) : calls && calls.length > 0 ? (
                      calls.map((call) => (
                        <TableRow key={call.id} className="hover:bg-muted/50 transition-colors">
                          <TableCell className="whitespace-nowrap">
                            {format(parseISO(call.createdAt), "MMM d, HH:mm")}
                          </TableCell>
                          <TableCell>{getStatusBadge(call.status)}</TableCell>
                          <TableCell>
                            <div className="text-sm font-medium">{call.toNumber}</div>
                            <div className="text-xs text-muted-foreground">{call.fromNumber}</div>
                          </TableCell>
                          <TableCell className="font-mono text-sm">{formatDuration(call.durationSeconds)}</TableCell>
                          <TableCell className="text-right">
                            <Link href={`/app/calls/${call.id}`}>
                              <Button variant="ghost" size="sm" className="h-8 text-xs">Details</Button>
                            </Link>
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={5} className="h-48 text-center text-muted-foreground">
                          No calls found for this agent.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Caller Memory ── */}
          <TabsContent value="memory" className="m-0">
            <CallerMemoryTab agentId={agent.id} />
          </TabsContent>

        </div>
      </Tabs>
    </div>
  );
}
