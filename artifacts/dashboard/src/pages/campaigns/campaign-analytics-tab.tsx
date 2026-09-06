/**
 * Campaign Analytics — Ask / Reports / Results.
 * Deep signals (purchase intent, emotion, agent performance) + user report builder + email.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { customFetch } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  Loader2, Sparkles, Plus, Trash2, TrendingUp, Flame, HelpCircle,
  FileText, Mail, BarChart3, Check,
} from "lucide-react";

type AnalyticsQuestion = {
  id: string;
  label: string;
  type: "boolean" | "enum" | "text";
  options?: string[];
  description?: string;
};

type ReportBlock = {
  type: string;
  metrics?: string[];
  questionIds?: string[];
  filter?: { minPurchaseScore?: number };
  prompt?: string;
};

type ReportDef = {
  id: number;
  name: string;
  scope: string;
  blocks: ReportBlock[];
  email: {
    enabled: boolean;
    recipients: string[];
    trigger: "manual" | "batch_complete" | "schedule";
    cron?: string | null;
  };
  isDefault: boolean;
};

type Insights = {
  days: number;
  batchId: number | null;
  analysed: number;
  connected: number;
  purchaseIntent: { avg: number | null; high: number; medium: number; low: number; none: number };
  urgency: Array<{ label: string; count: number }>;
  emotion: Array<{ label: string; count: number }>;
  sentiment: Array<{ label: string; count: number }>;
  sentimentTrend: Array<{ date: string; positive: number; neutral: number; negative: number; total: number }>;
  topObjections: Array<{ label: string; count: number }>;
  topBuyingSignals: Array<{ label: string; count: number }>;
  agentPerformance: {
    talkListenBalance: number | null;
    empathy: number | null;
    objectionHandling: number | null;
    scriptAdherence: number | null;
    clarity: number | null;
    sampleSize: number;
  };
  questionScorecard: Array<{
    id: string;
    label: string;
    type: string;
    answered: number;
    breakdown: Array<{ value: string; count: number }>;
  }>;
  hotLeads: Array<{
    leadId: number;
    campaignId?: number;
    callId: number | null;
    name: string | null;
    phone: string;
    sentiment: string | null;
    intent: string | null;
    summary: string | null;
    topics: string[];
    purchaseIntentScore?: number | null;
    urgency?: string | null;
    emotion?: string | null;
    nextBestAction?: string | null;
    at: string;
  }>;
  questions: AnalyticsQuestion[];
};

type Preset = { id: string; name: string; description: string; scope: string; blocks: ReportBlock[] };

type RenderedReport = {
  name: string;
  generatedAt: string;
  blocks: Array<Record<string, unknown> & { type: string; title: string }>;
  snapshot: Insights;
};

const QUESTION_PRESETS: AnalyticsQuestion[] = [
  { id: "competitor_mentioned", label: "Did they mention a competitor?", type: "boolean" },
  { id: "asked_pricing", label: "Did they ask about pricing?", type: "boolean" },
  { id: "decision_maker", label: "Are they the decision maker?", type: "enum", options: ["yes", "no", "unclear"] },
  { id: "demo_interest", label: "Demo / meeting interest", type: "enum", options: ["yes", "no", "maybe"] },
  { id: "will_pay", label: "Will they pay / commit this week?", type: "boolean" },
  { id: "issue_resolved", label: "Was the issue resolved on the call?", type: "boolean" },
];

const BLOCK_OPTIONS: Array<{ type: string; label: string }> = [
  { type: "kpis", label: "Key metrics" },
  { type: "purchase_funnel", label: "Willingness to pay" },
  { type: "deep_sentiment", label: "Deep sentiment" },
  { type: "objections", label: "Objections & buying signals" },
  { type: "agent_performance", label: "AI agent performance" },
  { type: "custom_questions", label: "Research questions" },
  { type: "hot_leads", label: "Hot leads" },
  { type: "nl_insight", label: "Ask in plain English" },
  { type: "narrative", label: "Executive summary" },
  { type: "dispositions", label: "Dispositions note" },
];

function SentimentSparkline({ trend }: { trend: Insights["sentimentTrend"] }) {
  const max = Math.max(1, ...trend.map((d) => d.total));
  return (
    <div className="space-y-2">
      <div className="flex items-end gap-0.5 h-24">
        {trend.map((d) => {
          const h = (d.total / max) * 100;
          const p = d.total ? (d.positive / d.total) * 100 : 0;
          const n = d.total ? (d.neutral / d.total) * 100 : 0;
          const g = d.total ? (d.negative / d.total) * 100 : 0;
          return (
            <div key={d.date} className="flex-1 min-w-0 flex flex-col justify-end" style={{ height: "100%" }}
              title={`${d.date}: +${d.positive} ~${d.neutral} -${d.negative}`}>
              <div className="w-full rounded-sm overflow-hidden flex flex-col-reverse bg-muted/40"
                style={{ height: `${Math.max(h, d.total ? 8 : 2)}%` }}>
                <div className="bg-emerald-500" style={{ height: `${p}%` }} />
                <div className="bg-zinc-400" style={{ height: `${n}%` }} />
                <div className="bg-rose-500" style={{ height: `${g}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatChip({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums mt-0.5">{value}</p>
    </div>
  );
}

export default function CampaignAnalyticsTab({
  campaignId,
  batchId,
  onAnalysed,
}: {
  campaignId: number;
  batchId?: number | null;
  onAnalysed?: () => void;
}) {
  const { toast } = useToast();
  const [tab, setTab] = useState<"results" | "ask" | "reports">("results");
  const [days, setDays] = useState(14);
  const [questions, setQuestions] = useState<AnalyticsQuestion[]>([]);
  const [savingQ, setSavingQ] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [draftLabel, setDraftLabel] = useState("");
  const [draftType, setDraftType] = useState<"boolean" | "enum" | "text">("boolean");
  const [draftOptions, setDraftOptions] = useState("yes, no, maybe");

  const [reports, setReports] = useState<ReportDef[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [selectedReportId, setSelectedReportId] = useState<number | null>(null);
  const [rendered, setRendered] = useState<RenderedReport | null>(null);
  const [rendering, setRendering] = useState(false);
  const [sending, setSending] = useState(false);
  const [editName, setEditName] = useState("");
  const [editBlocks, setEditBlocks] = useState<ReportBlock[]>([]);
  const [editRecipients, setEditRecipients] = useState("");
  const [editTrigger, setEditTrigger] = useState<"manual" | "batch_complete" | "schedule">("manual");
  const [editEmailEnabled, setEditEmailEnabled] = useState(false);
  const [editDefault, setEditDefault] = useState(false);
  const [nlPrompt, setNlPrompt] = useState("How many leads seem ready to pay for my service?");

  const insightsUrl = useMemo(() => {
    const q = new URLSearchParams({ days: String(days) });
    if (batchId != null) q.set("batchId", String(batchId));
    return `/api/campaigns/${campaignId}/analytics/insights?${q}`;
  }, [campaignId, batchId, days]);

  const {
    data: insights = null,
    isLoading: loading,
    refetch: refetchInsights,
  } = useQuery({
    queryKey: ["campaign-insights", campaignId, batchId ?? null, days],
    queryFn: () => customFetch<Insights>(insightsUrl),
    refetchInterval: 30_000,
  });

  async function loadInsights() {
    await refetchInsights();
  }

  async function loadReports() {
    try {
      const [r, p] = await Promise.all([
        customFetch<{ reports: ReportDef[] }>(`/api/campaigns/${campaignId}/reports`),
        customFetch<{ presets: Preset[] }>(`/api/campaigns/${campaignId}/report-presets`),
      ]);
      setReports(r.reports ?? []);
      setPresets(p.presets ?? []);
      if (!selectedReportId && r.reports?.[0]) {
        selectReport(r.reports[0]);
      }
    } catch {
      /* ignore */
    }
  }

  function selectReport(r: ReportDef) {
    setSelectedReportId(r.id);
    setEditName(r.name);
    setEditBlocks(r.blocks ?? []);
    setEditRecipients((r.email?.recipients ?? []).join(", "));
    setEditTrigger(r.email?.trigger ?? "manual");
    setEditEmailEnabled(!!r.email?.enabled);
    setEditDefault(!!r.isDefault);
    setRendered(null);
  }

  useEffect(() => {
    void loadReports();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId, days, batchId]);

  useEffect(() => {
    if (insights) setQuestions(insights.questions ?? []);
  }, [insights]);

  async function saveQuestions(next: AnalyticsQuestion[]) {
    setSavingQ(true);
    try {
      const result = await customFetch<{ questions: AnalyticsQuestion[] }>(
        `/api/campaigns/${campaignId}/analytics-questions`,
        { method: "PUT", body: JSON.stringify({ questions: next }) },
      );
      setQuestions(result.questions);
      toast({ title: "Questions saved" });
      await loadInsights();
    } catch {
      toast({ title: "Could not save questions", variant: "destructive" });
    } finally {
      setSavingQ(false);
    }
  }

  async function handleBackfill() {
    setBackfilling(true);
    try {
      const result = await customFetch<{
        scanned: number; analysed: number; skipped: number; failed: number; error?: string;
      }>(`/api/campaigns/${campaignId}/intelligence/backfill`, {
        method: "POST",
        body: JSON.stringify({ limit: 500, force: false }),
      });
      if (result.error && result.analysed === 0) {
        toast({ title: "Analysis model unavailable", description: result.error, variant: "destructive" });
      } else {
        toast({
          title: "Analysis updated",
          description: `${result.analysed} analysed · ${result.skipped} skipped · ${result.failed} failed`,
        });
      }
      await loadInsights();
      onAnalysed?.();
    } catch {
      toast({ title: "Backfill failed", variant: "destructive" });
    } finally {
      setBackfilling(false);
    }
  }

  async function createFromPreset(presetId: string) {
    try {
      const row = await customFetch<ReportDef>(`/api/campaigns/${campaignId}/reports`, {
        method: "POST",
        body: JSON.stringify({ presetId }),
      });
      await loadReports();
      selectReport(row);
      setTab("reports");
      toast({ title: "Report created" });
    } catch {
      toast({ title: "Could not create report", variant: "destructive" });
    }
  }

  async function saveReport() {
    if (!selectedReportId) return;
    try {
      const recipients = editRecipients.split(/[,;\s]+/).map((s) => s.trim()).filter((s) => s.includes("@"));
      const row = await customFetch<ReportDef>(`/api/campaigns/${campaignId}/reports/${selectedReportId}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: editName,
          blocks: editBlocks,
          isDefault: editDefault,
          email: {
            enabled: editEmailEnabled,
            recipients,
            trigger: editTrigger,
            cron: editTrigger === "schedule" ? "weekly_monday" : null,
          },
        }),
      });
      await loadReports();
      selectReport(row);
      toast({ title: "Report saved" });
    } catch {
      toast({ title: "Could not save report", variant: "destructive" });
    }
  }

  async function renderReport() {
    if (!selectedReportId) return;
    setRendering(true);
    try {
      const data = await customFetch<RenderedReport>(
        `/api/campaigns/${campaignId}/reports/${selectedReportId}/render`,
        {
          method: "POST",
          body: JSON.stringify({ batchId: batchId ?? null, days }),
        },
      );
      setRendered(data);
      setTab("results");
      toast({ title: "Report ready" });
    } catch {
      toast({ title: "Render failed", variant: "destructive" });
    } finally {
      setRendering(false);
    }
  }

  async function sendReport() {
    if (!selectedReportId) return;
    setSending(true);
    try {
      const recipients = editRecipients.split(/[,;\s]+/).map((s) => s.trim()).filter((s) => s.includes("@"));
      await customFetch(`/api/campaigns/${campaignId}/reports/${selectedReportId}/send`, {
        method: "POST",
        body: JSON.stringify({ recipients, batchId: batchId ?? null }),
      });
      toast({ title: "Report emailed", description: `Sent to ${recipients.length} recipient(s)` });
    } catch (err) {
      toast({
        title: "Send failed",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  }

  function addQuestion() {
    const label = draftLabel.trim();
    if (!label) return;
    const id = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || `q_${Date.now()}`;
    const options = draftType === "enum"
      ? draftOptions.split(",").map((s) => s.trim()).filter(Boolean)
      : undefined;
    if (draftType === "enum" && (!options || options.length < 2)) {
      toast({ title: "Enum needs at least 2 options", variant: "destructive" });
      return;
    }
    if (questions.length >= 20) {
      toast({ title: "Maximum 20 questions", variant: "destructive" });
      return;
    }
    void saveQuestions([...questions, { id, label, type: draftType, options }]);
    setDraftLabel("");
  }

  if (loading && !insights) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const snap = rendered?.snapshot ?? insights;
  const tabs = [
    { id: "results" as const, label: "Results", icon: BarChart3 },
    { id: "ask" as const, label: "Ask", icon: HelpCircle },
    { id: "reports" as const, label: "Reports", icon: FileText },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-foreground">
            {batchId != null ? "Batch insights" : "Campaign analytics"}
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Deep sentiment, willingness to pay, AI call quality — powered by Sarvam 105B.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            className="h-7 rounded-md border border-border bg-background px-2 text-xs"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          >
            <option value={7}>7 days</option>
            <option value={14}>14 days</option>
            <option value={30}>30 days</option>
            <option value={60}>60 days</option>
          </select>
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" disabled={backfilling}
            onClick={() => void handleBackfill()}>
            {backfilling ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
            Analyse calls
          </Button>
        </div>
      </div>

      <div className="flex gap-1 border-b border-border">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              "inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors",
              tab === t.id
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <t.icon className="h-3.5 w-3.5" />
            {t.label}
          </button>
        ))}
      </div>

      {tab === "results" && snap && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <StatChip label="Analysed" value={snap.analysed} />
            <StatChip label="Connected" value={snap.connected} />
            <StatChip label="High purchase intent" value={snap.purchaseIntent?.high ?? 0} />
            <StatChip label="Avg purchase score" value={snap.purchaseIntent?.avg ?? "—"} />
          </div>

          <div className="grid md:grid-cols-2 gap-3">
            <div className="bg-card border border-border rounded-xl p-4 space-y-3">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
                <p className="text-xs font-semibold uppercase tracking-wider text-foreground/70">Sentiment</p>
              </div>
              {(snap.sentimentTrend?.length ?? 0) > 0 ? (
                <SentimentSparkline trend={snap.sentimentTrend} />
              ) : (
                <p className="text-xs text-muted-foreground">No analysed calls yet.</p>
              )}
              <p className="text-[11px] text-muted-foreground">
                Emotion: {(snap.emotion ?? []).map((e) => `${e.label} ${e.count}`).join(" · ") || "—"}
              </p>
            </div>

            <div className="bg-card border border-border rounded-xl p-4 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-foreground/70">Willingness to pay</p>
              <ul className="text-sm space-y-1.5">
                <li className="flex justify-between"><span>High (≥70)</span><strong className="tabular-nums">{snap.purchaseIntent?.high ?? 0}</strong></li>
                <li className="flex justify-between"><span>Medium (40–69)</span><strong className="tabular-nums">{snap.purchaseIntent?.medium ?? 0}</strong></li>
                <li className="flex justify-between"><span>Low (1–39)</span><strong className="tabular-nums">{snap.purchaseIntent?.low ?? 0}</strong></li>
                <li className="flex justify-between text-muted-foreground"><span>None / unknown</span><strong className="tabular-nums">{snap.purchaseIntent?.none ?? 0}</strong></li>
              </ul>
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-3">
            <div className="bg-card border border-border rounded-xl p-4 space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-foreground/70">Objections</p>
              {(snap.topObjections ?? []).length === 0 ? (
                <p className="text-xs text-muted-foreground">None captured yet — run Analyse calls.</p>
              ) : (
                <ul className="text-sm space-y-1">
                  {snap.topObjections.slice(0, 8).map((o) => (
                    <li key={o.label} className="flex justify-between gap-2">
                      <span className="truncate">{o.label}</span>
                      <span className="tabular-nums text-muted-foreground">{o.count}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="bg-card border border-border rounded-xl p-4 space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-foreground/70">AI agent performance</p>
              {snap.agentPerformance?.sampleSize ? (
                <ul className="text-sm space-y-1">
                  {([
                    ["Talk / listen", snap.agentPerformance.talkListenBalance],
                    ["Empathy", snap.agentPerformance.empathy],
                    ["Objection handling", snap.agentPerformance.objectionHandling],
                    ["Script adherence", snap.agentPerformance.scriptAdherence],
                    ["Clarity", snap.agentPerformance.clarity],
                  ] as const).map(([label, v]) => (
                    <li key={label} className="flex justify-between">
                      <span>{label}</span>
                      <strong className="tabular-nums">{v ?? "—"}/5</strong>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">No agent scores yet.</p>
              )}
            </div>
          </div>

          {(snap.questionScorecard?.length ?? 0) > 0 && (
            <div className="bg-card border border-border rounded-xl p-4 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-foreground/70">Research questions</p>
              {snap.questionScorecard.map((q) => (
                <div key={q.id}>
                  <p className="text-sm font-medium">{q.label} <span className="text-muted-foreground font-normal">({q.answered})</span></p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {q.breakdown.slice(0, 6).map((b) => `${b.value}: ${b.count}`).join(" · ") || "No answers"}
                  </p>
                </div>
              ))}
            </div>
          )}

          <div className="bg-card border border-border rounded-xl p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Flame className="h-3.5 w-3.5 text-orange-500" />
              <p className="text-xs font-semibold uppercase tracking-wider text-foreground/70">Hot leads</p>
            </div>
            {(snap.hotLeads ?? []).length === 0 ? (
              <p className="text-xs text-muted-foreground">No hot leads yet.</p>
            ) : (
              <div className="divide-y divide-border">
                {snap.hotLeads.slice(0, 12).map((h) => (
                  <Link
                    key={`${h.leadId}-${h.callId}`}
                    href={`/app/campaigns/${h.campaignId ?? campaignId}/leads/${h.leadId}`}
                    className="flex items-start justify-between gap-3 py-2.5 hover:bg-muted/30 -mx-1 px-1 rounded"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{h.name || h.phone}</p>
                      <p className="text-[11px] text-muted-foreground truncate">{h.summary || h.intent || "—"}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-semibold tabular-nums">{h.purchaseIntentScore ?? "—"}</p>
                      <p className="text-[10px] text-muted-foreground">{h.emotion || h.sentiment}</p>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {rendered && (
            <div className="bg-card border border-border rounded-xl p-4 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-foreground/70">
                Rendered report · {rendered.name}
              </p>
              {rendered.blocks.map((b, i) => (
                <div key={i} className="border-t border-border pt-3 first:border-0 first:pt-0">
                  <p className="text-sm font-medium mb-1">{b.title}</p>
                  {b.type === "nl_insight" || b.type === "narrative" ? (
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                      {String((b as { answer?: string; text?: string }).answer ?? (b as { text?: string }).text ?? "")}
                    </p>
                  ) : (
                    <p className="text-[11px] text-muted-foreground">Included in email HTML · see sections above for live data.</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "ask" && (
        <div className="space-y-4">
          <div className="bg-card border border-border rounded-xl p-4 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-foreground/70">
              Research questions (extracted per call)
            </p>
            <p className="text-[11px] text-muted-foreground">
              Deep signals (purchase intent, emotion, objections, AI performance) are always extracted.
              Add custom questions for your specific use case.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {QUESTION_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  disabled={questions.some((q) => q.id === p.id) || savingQ}
                  onClick={() => void saveQuestions([...questions, p])}
                  className="text-[11px] rounded-full border border-border px-2.5 py-1 hover:bg-muted disabled:opacity-40"
                >
                  + {p.label}
                </button>
              ))}
            </div>
            <div className="space-y-2">
              {questions.map((q) => (
                <div key={q.id} className="flex items-center justify-between gap-2 text-sm">
                  <span>{q.label} <span className="text-muted-foreground text-[11px]">({q.type})</span></span>
                  <button type="button" className="text-muted-foreground hover:text-destructive"
                    onClick={() => void saveQuestions(questions.filter((x) => x.id !== q.id))}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
            <div className="grid sm:grid-cols-[1fr_auto_auto] gap-2 items-end pt-2 border-t border-border">
              <div>
                <Label className="text-[11px]">Custom question</Label>
                <Input value={draftLabel} onChange={(e) => setDraftLabel(e.target.value)} placeholder="e.g. Budget confirmed?" className="h-8 text-sm" />
              </div>
              <div>
                <Label className="text-[11px]">Type</Label>
                <select className="h-8 rounded-md border border-border bg-background px-2 text-xs w-full"
                  value={draftType} onChange={(e) => setDraftType(e.target.value as typeof draftType)}>
                  <option value="boolean">Yes / No</option>
                  <option value="enum">Enum</option>
                  <option value="text">Text</option>
                </select>
              </div>
              <Button size="sm" className="h-8 gap-1" disabled={savingQ} onClick={addQuestion}>
                <Plus className="h-3.5 w-3.5" /> Add
              </Button>
            </div>
            {draftType === "enum" && (
              <Input value={draftOptions} onChange={(e) => setDraftOptions(e.target.value)}
                placeholder="option1, option2, option3" className="h-8 text-sm" />
            )}
          </div>
        </div>
      )}

      {tab === "reports" && (
        <div className="space-y-4">
          <div className="bg-card border border-border rounded-xl p-4 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-foreground/70">Start from a template</p>
            <div className="grid sm:grid-cols-2 gap-2">
              {presets.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => void createFromPreset(p.id)}
                  className="text-left rounded-lg border border-border p-3 hover:bg-muted/40 transition-colors"
                >
                  <p className="text-sm font-medium">{p.name}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{p.description}</p>
                </button>
              ))}
            </div>
          </div>

          {reports.length > 0 && (
            <div className="bg-card border border-border rounded-xl p-4 space-y-4">
              <div className="flex flex-wrap gap-2">
                {reports.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => selectReport(r)}
                    className={cn(
                      "text-xs rounded-full border px-3 py-1",
                      selectedReportId === r.id ? "border-foreground bg-foreground text-background" : "border-border",
                    )}
                  >
                    {r.name}{r.isDefault ? " ★" : ""}
                  </button>
                ))}
              </div>

              {selectedReportId && (
                <div className="space-y-3 border-t border-border pt-3">
                  <div>
                    <Label className="text-[11px]">Report name</Label>
                    <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="h-8 text-sm" />
                  </div>
                  <div>
                    <Label className="text-[11px]">Blocks</Label>
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {BLOCK_OPTIONS.map((b) => {
                        const on = editBlocks.some((x) => x.type === b.type);
                        return (
                          <button
                            key={b.type}
                            type="button"
                            onClick={() => {
                              if (on) setEditBlocks(editBlocks.filter((x) => x.type !== b.type));
                              else {
                                const next: ReportBlock = { type: b.type };
                                if (b.type === "nl_insight") next.prompt = nlPrompt;
                                if (b.type === "hot_leads") next.filter = { minPurchaseScore: 70 };
                                if (b.type === "kpis") next.metrics = ["connected", "analysed", "purchase_intent_high", "purchase_intent_avg"];
                                setEditBlocks([...editBlocks, next]);
                              }
                            }}
                            className={cn(
                              "text-[11px] rounded-full border px-2.5 py-1 inline-flex items-center gap-1",
                              on ? "border-emerald-600/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300" : "border-border",
                            )}
                          >
                            {on && <Check className="h-3 w-3" />}
                            {b.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  {editBlocks.some((b) => b.type === "nl_insight") && (
                    <div>
                      <Label className="text-[11px]">Plain-English question</Label>
                      <Input
                        value={nlPrompt}
                        onChange={(e) => {
                          setNlPrompt(e.target.value);
                          setEditBlocks(editBlocks.map((b) =>
                            b.type === "nl_insight" ? { ...b, prompt: e.target.value } : b,
                          ));
                        }}
                        className="h-8 text-sm"
                      />
                    </div>
                  )}
                  <div className="grid sm:grid-cols-2 gap-3">
                    <div>
                      <Label className="text-[11px]">Email recipients</Label>
                      <Input
                        value={editRecipients}
                        onChange={(e) => setEditRecipients(e.target.value)}
                        placeholder="client@company.com, you@…"
                        className="h-8 text-sm"
                      />
                    </div>
                    <div>
                      <Label className="text-[11px]">Email trigger</Label>
                      <select
                        className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs"
                        value={editTrigger}
                        onChange={(e) => setEditTrigger(e.target.value as typeof editTrigger)}
                      >
                        <option value="manual">Manual only</option>
                        <option value="batch_complete">When batch completes</option>
                        <option value="schedule">Weekly (Monday)</option>
                      </select>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-4 text-xs">
                    <label className="inline-flex items-center gap-2">
                      <input type="checkbox" checked={editEmailEnabled} onChange={(e) => setEditEmailEnabled(e.target.checked)} />
                      Enable email delivery
                    </label>
                    <label className="inline-flex items-center gap-2">
                      <input type="checkbox" checked={editDefault} onChange={(e) => setEditDefault(e.target.checked)} />
                      Default for batch-complete
                    </label>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" className="h-8" onClick={() => void saveReport()}>Save</Button>
                    <Button size="sm" variant="outline" className="h-8 gap-1.5" disabled={rendering}
                      onClick={() => void renderReport()}>
                      {rendering ? <Loader2 className="h-3 w-3 animate-spin" /> : <BarChart3 className="h-3 w-3" />}
                      Preview
                    </Button>
                    <Button size="sm" variant="outline" className="h-8 gap-1.5" disabled={sending}
                      onClick={() => void sendReport()}>
                      {sending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Mail className="h-3 w-3" />}
                      Email now
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 text-destructive"
                      onClick={async () => {
                        await customFetch(`/api/campaigns/${campaignId}/reports/${selectedReportId}`, { method: "DELETE" });
                        setSelectedReportId(null);
                        setRendered(null);
                        await loadReports();
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
