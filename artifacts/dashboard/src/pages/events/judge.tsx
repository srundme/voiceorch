import { useEffect, useState } from "react";
import { useRoute } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { BrandMark } from "@/components/logo";
import { AlertCircle, CheckCircle, ExternalLink, Loader2 } from "lucide-react";

type Assignment = {
  submissionId: number;
  teamName: string;
  teamReference: string;
  projectTitle: string | null;
  projectSummary: string | null;
  agentName: string | null;
  demoUrl: string | null;
  score: {
    id: number;
    criteriaScores: Array<{ criterionId: string; score: number; note?: string }>;
    totalScore: number;
    privateFeedback: string | null;
    status: string;
  } | null;
};

type JudgePayload = {
  judge: { name: string; email: string };
  event: {
    title: string;
    slug: string;
    rubric: Array<{ id: string; label: string; description?: string; maxScore: number; weight: number }>;
    judgingOpen: boolean;
  };
  assignments: Assignment[];
};

export default function JudgePortalPage() {
  const [, params] = useRoute("/events/judge/:token");
  const token = params?.token ?? "";
  const [data, setData] = useState<JudgePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [scores, setScores] = useState<Record<string, number>>({});
  const [feedback, setFeedback] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    fetch(`/api/voiceathon/judge/${encodeURIComponent(token)}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setError(body?.error ?? "Invalid judge link");
          return;
        }
        const json: JudgePayload = await res.json();
        setData(json);
        if (json.assignments[0]) setActiveId(json.assignments[0].submissionId);
      })
      .catch(() => setError("Network error"))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [token]);

  useEffect(() => {
    if (!data || activeId == null) return;
    const a = data.assignments.find((x) => x.submissionId === activeId);
    const next: Record<string, number> = {};
    for (const c of data.event.rubric) {
      const existing = a?.score?.criteriaScores.find((s) => s.criterionId === c.id);
      next[c.id] = existing?.score ?? 0;
    }
    setScores(next);
    setFeedback(a?.score?.privateFeedback ?? "");
    setSaveMsg(null);
  }, [data, activeId]);

  const active = data?.assignments.find((a) => a.submissionId === activeId);

  const save = async (finalize: boolean) => {
    if (!data || activeId == null) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      const res = await fetch(`/api/voiceathon/judge/${encodeURIComponent(token)}/scores`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          submissionId: activeId,
          criteriaScores: Object.entries(scores).map(([criterionId, score]) => ({ criterionId, score })),
          privateFeedback: feedback.trim() || null,
          finalize,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSaveMsg(body?.error ?? "Save failed");
        return;
      }
      setSaveMsg(finalize ? "Finalized" : "Draft saved");
      load();
    } catch {
      setSaveMsg("Network error");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-muted/30">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center gap-3 bg-muted/30 px-6 text-center">
        <AlertCircle className="h-10 w-10 text-muted-foreground" />
        <h1 className="text-xl font-semibold">{error ?? "Unavailable"}</h1>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-muted/30 pb-safe">
      <div className="border-b border-border bg-card">
        <div className="mx-auto max-w-5xl px-4 py-5">
          <BrandMark className="mb-3" />
          <h1 className="text-xl font-bold">{data.event.title} — Judging</h1>
          <p className="text-xs text-muted-foreground mt-1">
            Signed in as {data.judge.name} ({data.judge.email})
            {!data.event.judgingOpen ? " · Judging window closed" : ""}
          </p>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-4 py-6 grid gap-6 lg:grid-cols-[240px_1fr]">
        <aside className="space-y-1">
          {data.assignments.map((a) => (
            <button
              key={a.submissionId}
              type="button"
              onClick={() => setActiveId(a.submissionId)}
              className={`w-full text-left rounded-md border px-3 py-2 text-xs ${
                activeId === a.submissionId ? "border-foreground/30 bg-muted/50" : "border-border/50"
              }`}
            >
              <div className="font-medium truncate">{a.teamName}</div>
              <div className="text-muted-foreground">
                {a.score?.status === "final" ? (
                  <span className="inline-flex items-center gap-1 text-emerald-600"><CheckCircle className="w-3 h-3" /> {a.score.totalScore}</span>
                ) : a.score ? `Draft ${a.score.totalScore}` : "Not scored"}
              </div>
            </button>
          ))}
          {data.assignments.length === 0 && (
            <p className="text-xs text-muted-foreground">No submissions assigned yet.</p>
          )}
        </aside>

        {active && (
          <section className="space-y-4 rounded-xl border border-border bg-card p-4 sm:p-6">
            <div>
              <h2 className="text-lg font-semibold">{active.projectTitle || active.teamName}</h2>
              <p className="text-xs text-muted-foreground">
                {active.teamName} · {active.teamReference} · {active.agentName || "agent"}
              </p>
              {active.projectSummary && (
                <p className="text-sm text-muted-foreground mt-2 whitespace-pre-wrap">{active.projectSummary}</p>
              )}
              {active.demoUrl && (
                <a
                  href={active.demoUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-sm underline mt-2"
                >
                  Open live demo <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
            </div>

            <div className="space-y-3">
              {data.event.rubric.map((c) => (
                <div key={c.id} className="grid sm:grid-cols-[1fr_100px] gap-2 items-end">
                  <div>
                    <Label className="text-sm">{c.label} <span className="text-muted-foreground">(max {c.maxScore})</span></Label>
                    {c.description && <p className="text-[11px] text-muted-foreground">{c.description}</p>}
                  </div>
                  <Input
                    type="number"
                    min={0}
                    max={c.maxScore}
                    value={scores[c.id] ?? 0}
                    disabled={active.score?.status === "final" || !data.event.judgingOpen}
                    onChange={(e) => setScores((prev) => ({ ...prev, [c.id]: Number(e.target.value) }))}
                  />
                </div>
              ))}
            </div>

            <div>
              <Label>Private feedback (organizer only)</Label>
              <Textarea
                value={feedback}
                disabled={active.score?.status === "final" || !data.event.judgingOpen}
                onChange={(e) => setFeedback(e.target.value)}
                rows={3}
              />
            </div>

            {saveMsg && <p className="text-xs text-muted-foreground">{saveMsg}</p>}

            {active.score?.status !== "final" && data.event.judgingOpen && (
              <div className="flex gap-2">
                <Button variant="outline" disabled={saving} onClick={() => void save(false)}>
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save draft"}
                </Button>
                <Button disabled={saving} onClick={() => void save(true)}>Finalize score</Button>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
