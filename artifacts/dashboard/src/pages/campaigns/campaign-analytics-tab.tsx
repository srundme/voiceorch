/**
 * Campaign Analytics tab — sentiment trends, custom-question scorecard, hot leads.
 */
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  Loader2, Sparkles, Plus, Trash2, TrendingUp, Flame, HelpCircle,
} from "lucide-react";

type AnalyticsQuestion = {
  id: string;
  label: string;
  type: "boolean" | "enum" | "text";
  options?: string[];
  description?: string;
};

type Insights = {
  days: number;
  sentimentTrend: Array<{ date: string; positive: number; neutral: number; negative: number; total: number }>;
  intentTrend: Array<{ date: string; intent: string; count: number }>;
  questionScorecard: Array<{
    id: string;
    label: string;
    type: string;
    answered: number;
    breakdown: Array<{ value: string; count: number }>;
  }>;
  hotLeads: Array<{
    leadId: number;
    callId: number | null;
    name: string | null;
    phone: string;
    sentiment: string | null;
    intent: string | null;
    summary: string | null;
    topics: string[];
    at: string;
  }>;
  questions: AnalyticsQuestion[];
};

const QUESTION_PRESETS: AnalyticsQuestion[] = [
  { id: "competitor_mentioned", label: "Did they mention a competitor?", type: "boolean", description: "Any other brand/vendor named." },
  { id: "asked_pricing", label: "Did they ask about pricing?", type: "boolean" },
  { id: "decision_maker", label: "Are they the decision maker?", type: "enum", options: ["yes", "no", "unclear"] },
  { id: "demo_interest", label: "Demo / meeting interest", type: "enum", options: ["yes", "no", "maybe"] },
  { id: "will_pay", label: "Will they pay / commit this week?", type: "boolean", description: "Collections / payment commitment." },
  { id: "issue_resolved", label: "Was the issue resolved on the call?", type: "boolean" },
];

function SentimentSparkline({
  trend,
}: {
  trend: Insights["sentimentTrend"];
}) {
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
            <div
              key={d.date}
              className="flex-1 min-w-0 flex flex-col justify-end"
              style={{ height: "100%" }}
              title={`${d.date}: +${d.positive} ~${d.neutral} -${d.negative}`}
            >
              <div
                className="w-full rounded-sm overflow-hidden flex flex-col-reverse bg-muted/40"
                style={{ height: `${Math.max(h, d.total ? 8 : 2)}%` }}
              >
                <div className="bg-emerald-500" style={{ height: `${p}%` }} />
                <div className="bg-zinc-400" style={{ height: `${n}%` }} />
                <div className="bg-rose-500" style={{ height: `${g}%` }} />
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground tabular-nums">
        <span>{trend[0]?.date?.slice(5) ?? ""}</span>
        <span>{trend[trend.length - 1]?.date?.slice(5) ?? ""}</span>
      </div>
      <div className="flex gap-3 text-[11px] text-muted-foreground">
        <span><span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 mr-1" />positive</span>
        <span><span className="inline-block h-1.5 w-1.5 rounded-full bg-zinc-400 mr-1" />neutral</span>
        <span><span className="inline-block h-1.5 w-1.5 rounded-full bg-rose-500 mr-1" />negative</span>
      </div>
    </div>
  );
}

export default function CampaignAnalyticsTab({
  campaignId,
  onAnalysed,
}: {
  campaignId: number;
  onAnalysed?: () => void;
}) {
  const { toast } = useToast();
  const [insights, setInsights] = useState<Insights | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(14);
  const [questions, setQuestions] = useState<AnalyticsQuestion[]>([]);
  const [savingQ, setSavingQ] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [draftLabel, setDraftLabel] = useState("");
  const [draftType, setDraftType] = useState<"boolean" | "enum" | "text">("boolean");
  const [draftOptions, setDraftOptions] = useState("yes, no, maybe");

  async function loadInsights(d = days) {
    setLoading(true);
    try {
      const data = await customFetch<Insights>(
        `/api/campaigns/${campaignId}/analytics/insights?days=${d}`,
      );
      setInsights(data);
      setQuestions(data.questions ?? []);
    } catch {
      toast({ title: "Could not load analytics", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadInsights(days);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId, days]);

  async function saveQuestions(next: AnalyticsQuestion[]) {
    setSavingQ(true);
    try {
      const result = await customFetch<{ questions: AnalyticsQuestion[] }>(
        `/api/campaigns/${campaignId}/analytics-questions`,
        { method: "PUT", body: JSON.stringify({ questions: next }) },
      );
      setQuestions(result.questions);
      toast({ title: "Questions saved", description: "Re-analyse calls to fill answers for older transcripts." });
      await loadInsights(days);
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
        scanned: number; analysed: number; skipped: number; failed: number;
      }>(`/api/campaigns/${campaignId}/intelligence/backfill`, {
        method: "POST",
        body: JSON.stringify({ limit: 500, force: false }),
      });
      toast({
        title: "Analysis updated",
        description: `${result.analysed} analysed · ${result.skipped} skipped · ${result.failed} failed`,
      });
      await loadInsights(days);
      onAnalysed?.();
    } catch {
      toast({ title: "Backfill failed", variant: "destructive" });
    } finally {
      setBackfilling(false);
    }
  }

  function addQuestion() {
    const label = draftLabel.trim();
    if (!label) return;
    const id = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || `q_${Date.now()}`;
    const options =
      draftType === "enum"
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

  function addPreset(p: AnalyticsQuestion) {
    if (questions.some((q) => q.id === p.id)) {
      toast({ title: "Already added" });
      return;
    }
    void saveQuestions([...questions, p]);
  }

  if (loading && !insights) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const trend = insights?.sentimentTrend ?? [];
  const totalAnalysed = trend.reduce((s, d) => s + d.total, 0);
  const pos = trend.reduce((s, d) => s + d.positive, 0);
  const posPct = totalAnalysed ? Math.round((pos / totalAnalysed) * 100) : 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-foreground">Campaign analytics</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Sentiment trends, custom research questions, and hot leads from call transcripts.
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
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs gap-1.5"
            disabled={backfilling}
            onClick={() => void handleBackfill()}
          >
            {backfilling ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
            Analyse calls
          </Button>
        </div>
      </div>

      {/* Trend */}
      <div className="bg-card border border-border rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
          <p className="text-xs font-semibold text-foreground/70 uppercase tracking-wider">
            Sentiment over time
          </p>
          <span className="text-[11px] text-muted-foreground ml-auto tabular-nums">
            {posPct}% positive · {totalAnalysed} analysed
          </span>
        </div>
        {totalAnalysed === 0 ? (
          <p className="text-xs text-muted-foreground py-6 text-center">
            No analysed calls in this window. Run Analyse calls after transcripts exist.
          </p>
        ) : (
          <SentimentSparkline trend={trend} />
        )}
      </div>

      {/* Question scorecard */}
      <div className="bg-card border border-border rounded-xl p-4 space-y-4">
        <div className="flex items-start gap-2">
          <HelpCircle className="h-3.5 w-3.5 text-muted-foreground mt-0.5" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-foreground/70 uppercase tracking-wider">
              Custom research questions
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Use-case specific — answered from each transcript (separate from dispositions).
            </p>
          </div>
        </div>

        {(insights?.questionScorecard?.length ?? 0) > 0 && (
          <div className="grid gap-3 sm:grid-cols-2">
            {insights!.questionScorecard.map((q) => {
              const top = q.breakdown[0];
              const yesCount = q.breakdown
                .filter((b) => ["true", "yes"].includes(b.value.toLowerCase()))
                .reduce((s, b) => s + b.count, 0);
              const yesPct = q.answered ? Math.round((yesCount / q.answered) * 100) : 0;
              return (
                <div key={q.id} className="rounded-lg border border-border/60 px-3 py-2.5 space-y-1.5">
                  <p className="text-sm font-medium text-foreground leading-snug">{q.label}</p>
                  <p className="text-[11px] text-muted-foreground tabular-nums">
                    {q.answered} answered
                    {q.type === "boolean" && q.answered > 0 ? ` · ${yesPct}% yes` : ""}
                    {q.type !== "boolean" && top ? ` · top: ${top.value} (${top.count})` : ""}
                  </p>
                  {q.breakdown.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-0.5">
                      {q.breakdown.slice(0, 4).map((b) => (
                        <span
                          key={b.value}
                          className="rounded-md border border-border/50 bg-muted/30 px-1.5 py-0.5 text-[10px] text-foreground/80"
                        >
                          {b.value} <span className="text-muted-foreground">{b.count}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Manage questions */}
        <div className="border-t border-border/60 pt-3 space-y-3">
          <p className="text-[11px] font-medium text-foreground/80">Questions for this campaign</p>
          {questions.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">None yet — add a preset or create your own.</p>
          ) : (
            <ul className="space-y-1.5">
              {questions.map((q) => (
                <li
                  key={q.id}
                  className="flex items-center gap-2 rounded-md border border-border/50 px-2.5 py-1.5 text-xs"
                >
                  <span className="min-w-0 flex-1 truncate">{q.label}</span>
                  <span className="text-[10px] text-muted-foreground shrink-0">{q.type}</span>
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => void saveQuestions(questions.filter((x) => x.id !== q.id))}
                    disabled={savingQ}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-wrap gap-1.5">
            {QUESTION_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                disabled={savingQ || questions.some((q) => q.id === p.id)}
                onClick={() => addPreset(p)}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-[10px] transition-colors",
                  questions.some((q) => q.id === p.id)
                    ? "border-border/40 text-muted-foreground/50"
                    : "border-border hover:border-foreground/30 text-foreground/80",
                )}
              >
                + {p.label}
              </button>
            ))}
          </div>

          <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto] items-end">
            <div className="space-y-1">
              <Label className="text-[10px]">New question</Label>
              <Input
                className="h-8 text-xs"
                placeholder="e.g. Did they ask for a demo?"
                value={draftLabel}
                onChange={(e) => setDraftLabel(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addQuestion(); } }}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px]">Type</Label>
              <select
                className="h-8 rounded-md border border-border bg-background px-2 text-xs"
                value={draftType}
                onChange={(e) => setDraftType(e.target.value as typeof draftType)}
              >
                <option value="boolean">Yes / No</option>
                <option value="enum">Choices</option>
                <option value="text">Short text</option>
              </select>
            </div>
            <Button size="sm" className="h-8 gap-1 text-xs" disabled={savingQ || !draftLabel.trim()} onClick={addQuestion}>
              {savingQ ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
              Add
            </Button>
          </div>
          {draftType === "enum" && (
            <Input
              className="h-8 text-xs"
              placeholder="Options, comma-separated"
              value={draftOptions}
              onChange={(e) => setDraftOptions(e.target.value)}
            />
          )}
        </div>
      </div>

      {/* Hot leads */}
      <div className="bg-card border border-border rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Flame className="h-3.5 w-3.5 text-orange-500" />
          <p className="text-xs font-semibold text-foreground/70 uppercase tracking-wider">
            Hot leads
          </p>
          <span className="text-[11px] text-muted-foreground ml-auto">
            Positive + interested / callback / booked
          </span>
        </div>
        {(insights?.hotLeads?.length ?? 0) === 0 ? (
          <p className="text-xs text-muted-foreground py-4 text-center">
            No hot leads yet — appears after positive interested calls are analysed.
          </p>
        ) : (
          <div className="divide-y divide-border/50">
            {insights!.hotLeads.slice(0, 20).map((h) => (
              <div key={`${h.leadId}-${h.callId}`} className="py-2.5 flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/app/campaigns/${campaignId}/leads/${h.leadId}`}
                      className="text-sm font-medium text-foreground hover:underline truncate"
                    >
                      {h.name || h.phone}
                    </Link>
                    <span className="text-[10px] rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 px-1.5 py-0.5 capitalize">
                      {(h.intent ?? "").replace(/_/g, " ")}
                    </span>
                  </div>
                  {h.summary && (
                    <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{h.summary}</p>
                  )}
                  {h.topics.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {h.topics.slice(0, 4).map((t) => (
                        <span key={t} className="text-[10px] text-muted-foreground border border-border/50 rounded px-1">
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
                  {h.at.slice(0, 10)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
