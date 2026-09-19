import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch, getGetAgentQueryKey } from "@workspace/api-client-react";
import { formatDistanceToNow } from "date-fns";
import {
  Check, Dumbbell, Loader2, Megaphone, PhoneCall, Sparkles,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

const DASH_API = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api`;
const PAD = "px-5 py-6 sm:px-8";

type GymPersona = {
  id: string;
  name: string;
  goal: string;
  interrupt: boolean;
  testCaseId: number | null;
};

type GymRun = {
  id: number;
  status: string;
  score: number | null;
  source: "gym" | "campaign";
  personaId: string | null;
  personaName: string | null;
  suiteId: string | null;
  interruptCount: number;
  scores: Record<string, number> | null;
  pass: boolean | null;
  failures: string[];
  lessons: string[];
  suggestedPromptAddendum: string;
  callId: number | null;
  approvedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
};

type GymState = {
  personas: GymPersona[];
  runs: GymRun[];
  canWrite: boolean;
};

type GymMessage = {
  id: number;
  role: string;
  content: string;
  metadata: { interrupted?: boolean; speaker?: string } | null;
};

function scoreTone(score: number | null): string {
  if (score == null) return "text-muted-foreground";
  if (score >= 80) return "text-emerald-600";
  if (score >= 60) return "text-amber-600";
  return "text-rose-600";
}

export function GymTab({ agentId }: { agentId: number }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);

  const gymQuery = useQuery({
    queryKey: ["agent-gym", agentId],
    queryFn: () => customFetch<GymState>(`${DASH_API}/agents/${agentId}/gym`),
  });

  const selected = gymQuery.data?.runs.find((r) => r.id === selectedId) ?? gymQuery.data?.runs[0] ?? null;
  const activeId = selected?.id ?? null;

  const detailQuery = useQuery({
    queryKey: ["agent-gym-run", agentId, activeId],
    enabled: activeId != null,
    queryFn: () => customFetch<{ run: GymRun; messages: GymMessage[] }>(
      `${DASH_API}/agents/${agentId}/gym/runs/${activeId}`,
    ),
  });

  const runOne = useMutation({
    mutationFn: async ({ personaId, suiteId }: { personaId: string; suiteId?: string }) =>
      customFetch<{ run: GymRun; suiteId: string }>(`${DASH_API}/agents/${agentId}/gym/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personaId, suiteId }),
        timeoutMs: 180_000,
      }),
    onSuccess: async (data) => {
      setSelectedId(data.run.id);
      await queryClient.invalidateQueries({ queryKey: ["agent-gym", agentId] });
    },
  });

  const learn = useMutation({
    mutationFn: () =>
      customFetch<{ scored: number; runs: GymRun[] }>(`${DASH_API}/agents/${agentId}/gym/learn`, {
        method: "POST",
        timeoutMs: 180_000,
      }),
    onSuccess: async (data) => {
      if (data.runs[0]) setSelectedId(data.runs[0].id);
      await queryClient.invalidateQueries({ queryKey: ["agent-gym", agentId] });
      toast({
        title: data.scored ? `Scored ${data.scored} campaign call${data.scored === 1 ? "" : "s"}` : "No new campaign calls to learn from",
      });
    },
    onError: (err) => {
      toast({
        title: "Couldn’t learn from campaigns",
        description: err instanceof Error ? err.message : "Learn failed",
        variant: "destructive",
      });
    },
  });

  const apply = useMutation({
    mutationFn: (runId: number) =>
      customFetch<{ applied: boolean }>(`${DASH_API}/agents/${agentId}/gym/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId }),
      }),
    onSuccess: async (data) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["agent-gym", agentId] }),
        queryClient.invalidateQueries({ queryKey: getGetAgentQueryKey(agentId) }),
        activeId != null
          ? queryClient.invalidateQueries({ queryKey: ["agent-gym-run", agentId, activeId] })
          : Promise.resolve(),
      ]);
      toast({
        title: data.applied ? "Lesson added to the script" : "That lesson is already in the script",
        description: data.applied ? "Publish a version when you want production to use it." : undefined,
      });
    },
    onError: (err) => {
      toast({
        title: "Couldn’t apply lesson",
        description: err instanceof Error ? err.message : "Apply failed",
        variant: "destructive",
      });
    },
  });

  const busy = runOne.isPending || learn.isPending || runningId != null;

  async function runAll() {
    const personas = gymQuery.data?.personas ?? [];
    if (personas.length === 0) return;
    const suiteId = crypto.randomUUID();
    try {
      for (const persona of personas) {
        setRunningId(persona.id);
        const data = await runOne.mutateAsync({ personaId: persona.id, suiteId });
        setSelectedId(data.run.id);
      }
    } catch (err) {
      toast({
        title: "Gym run stopped",
        description: err instanceof Error ? err.message : "A tester failed",
        variant: "destructive",
      });
    } finally {
      setRunningId(null);
    }
  }

  const messages = detailQuery.data?.messages ?? [];
  const detail = detailQuery.data?.run ?? selected;
  const scoreRows = useMemo(() => {
    const scores = detail?.scores;
    if (!scores) return [];
    return [
      ["Interrupt recovery", scores.interruptRecovery],
      ["Stayed on goal", scores.stayedOnGoal],
      ["Answered questions", scores.answeredQuestions],
      ["Did not invent facts", scores.didNotHallucinate],
      ["Turn-taking", scores.naturalTurnTaking],
    ] as Array<[string, number]>;
  }, [detail?.scores]);

  return (
    <div className={cn("flex flex-col gap-6", PAD)}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
        <div className="min-w-0 max-w-[68ch]">
          <h2 className="text-[17px] font-semibold tracking-[-0.03em] text-foreground">Gym</h2>
          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
            Customer testers talk to this agent, interrupt it, and score the call. Lessons from gym runs and campaign calls stay off production until you approve them.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-[11px]"
            disabled={busy || gymQuery.data?.canWrite === false}
            onClick={() => learn.mutate()}
          >
            {learn.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <PhoneCall className="size-3.5" />}
            Learn from campaigns
          </Button>
          <Button
            type="button"
            size="sm"
            className="h-8 gap-1.5 text-[11px]"
            disabled={busy || gymQuery.data?.canWrite === false}
            onClick={() => void runAll()}
          >
            {runningId ? <Loader2 className="size-3.5 animate-spin" /> : <Dumbbell className="size-3.5" />}
            {runningId ? "Testing…" : "Run all testers"}
          </Button>
        </div>
      </div>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Customer testers</h3>
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-5">
          {(gymQuery.data?.personas ?? []).map((persona) => {
            const active = runningId === persona.id;
            return (
              <button
                key={persona.id}
                type="button"
                disabled={busy || gymQuery.data?.canWrite === false}
                onClick={() => {
                  setRunningId(persona.id);
                  runOne.mutate(
                    { personaId: persona.id },
                    {
                      onSettled: () => setRunningId(null),
                      onError: (err) => {
                        toast({
                          title: "Tester failed",
                          description: err instanceof Error ? err.message : "A tester failed",
                          variant: "destructive",
                        });
                      },
                    },
                  );
                }}
                className={cn(
                  "rounded-xl border px-3 py-2.5 text-left transition-colors",
                  active ? "border-foreground bg-foreground text-background" : "border-border bg-card hover:bg-muted/40",
                  busy && !active && "opacity-60",
                )}
              >
                <p className={cn("text-[12px] font-medium truncate", active ? "text-background" : "text-foreground")}>
                  {persona.name}
                </p>
                <p className={cn("mt-1 line-clamp-2 text-[11px] leading-snug", active ? "text-background/70" : "text-muted-foreground")}>
                  {persona.goal}
                </p>
                {persona.interrupt ? (
                  <Badge variant={active ? "secondary" : "outline"} className="mt-2 h-5 px-1.5 text-[10px]">
                    Interrupts
                  </Badge>
                ) : null}
              </button>
            );
          })}
        </div>
      </section>

      <div className="grid min-h-[28rem] grid-cols-1 gap-3 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
        <section className="min-w-0 overflow-hidden rounded-xl border bg-card">
          <div className="border-b px-3 py-2">
            <h3 className="text-sm font-semibold">Runs</h3>
          </div>
          <div className="max-h-[32rem] overflow-y-auto">
            {(gymQuery.data?.runs ?? []).length === 0 ? (
              <p className="px-3 py-8 text-[13px] text-muted-foreground">
                No tests yet. Run a customer tester or learn from campaign calls.
              </p>
            ) : (
              (gymQuery.data?.runs ?? []).map((run) => {
                const on = run.id === activeId;
                return (
                  <button
                    key={run.id}
                    type="button"
                    onClick={() => setSelectedId(run.id)}
                    className={cn(
                      "flex w-full items-start justify-between gap-2 border-b px-3 py-2.5 text-left last:border-b-0",
                      on ? "bg-muted/60" : "hover:bg-muted/30",
                    )}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium">
                        {run.source === "campaign" ? `Campaign call ${run.callId ?? ""}` : (run.personaName ?? "Customer tester")}
                      </p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {run.completedAt
                          ? formatDistanceToNow(new Date(run.completedAt), { addSuffix: true })
                          : run.status}
                        {run.interruptCount > 0 ? ` · ${run.interruptCount} interrupt${run.interruptCount === 1 ? "" : "s"}` : ""}
                      </p>
                    </div>
                    <span className={cn("tabular-nums text-[13px] font-semibold", scoreTone(run.score))}>
                      {run.score ?? "—"}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </section>

        <section className="min-w-0 overflow-hidden rounded-xl border bg-card">
          {!detail ? (
            <p className="px-4 py-10 text-[13px] text-muted-foreground">Pick a run to see the transcript and scorecard.</p>
          ) : (
            <div className="grid min-h-full grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(16rem,18rem)]">
              <div className="min-w-0 border-b xl:border-b-0 xl:border-r">
                <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
                  <h3 className="text-sm font-semibold">Transcript</h3>
                  {detail.source === "campaign" && detail.callId ? (
                    <Badge variant="outline" className="text-[10px]">Call {detail.callId}</Badge>
                  ) : null}
                </div>
                <div className="max-h-[32rem] space-y-3 overflow-y-auto p-3">
                  {detailQuery.isLoading ? (
                    <p className="text-[13px] text-muted-foreground">Loading transcript…</p>
                  ) : messages.length === 0 ? (
                    <p className="text-[13px] text-muted-foreground">No transcript stored for this run.</p>
                  ) : (
                    messages.map((msg) => {
                      const agent = msg.role === "assistant" || msg.metadata?.speaker === "agent";
                      return (
                        <div key={msg.id} className={cn("max-w-[92%] rounded-lg px-3 py-2", agent ? "bg-muted/60" : "ml-auto bg-foreground text-background")}>
                          <p className={cn("text-[10px] font-medium uppercase tracking-wide", agent ? "text-muted-foreground" : "text-background/70")}>
                            {agent ? "Agent" : "Customer"}
                            {msg.metadata?.interrupted ? " · interrupted" : ""}
                          </p>
                          <p className="mt-0.5 whitespace-pre-wrap text-[13px] leading-relaxed">{msg.content}</p>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
              <div className="min-w-0 p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="text-sm font-semibold">Scorecard</h3>
                  <span className={cn("text-2xl font-semibold tabular-nums", scoreTone(detail.score))}>
                    {detail.score ?? "—"}
                  </span>
                </div>
                {detail.pass != null ? (
                  <p className="mt-1 text-[12px] text-muted-foreground">{detail.pass ? "Pass" : "Needs work"}</p>
                ) : null}
                <div className="mt-3 space-y-1.5">
                  {scoreRows.map(([label, value]) => (
                    <div key={label} className="flex items-center justify-between gap-2 text-[12px]">
                      <span className="text-muted-foreground">{label}</span>
                      <span className="tabular-nums font-medium">{value}/5</span>
                    </div>
                  ))}
                </div>
                {detail.failures.length > 0 ? (
                  <div className="mt-4">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Failures</p>
                    <ul className="mt-1 list-disc space-y-1 pl-4 text-[12px] text-rose-700">
                      {detail.failures.map((item) => <li key={item}>{item}</li>)}
                    </ul>
                  </div>
                ) : null}
                {detail.lessons.length > 0 ? (
                  <div className="mt-4">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Lessons</p>
                    <ul className="mt-1 list-disc space-y-1 pl-4 text-[12px]">
                      {detail.lessons.map((item) => <li key={item}>{item}</li>)}
                    </ul>
                  </div>
                ) : null}
                {detail.suggestedPromptAddendum ? (
                  <div className="mt-4 rounded-lg border bg-muted/30 p-2.5">
                    <p className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      <Sparkles className="size-3" /> Suggested script add
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-[12px] leading-relaxed">{detail.suggestedPromptAddendum}</p>
                    <Button
                      type="button"
                      size="sm"
                      className="mt-2 h-8 gap-1.5 text-[11px]"
                      disabled={apply.isPending || Boolean(detail.approvedAt) || gymQuery.data?.canWrite === false}
                      onClick={() => apply.mutate(detail.id)}
                    >
                      {detail.approvedAt ? <Check className="size-3.5" /> : apply.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Megaphone className="size-3.5" />}
                      {detail.approvedAt ? "Already in script" : "Approve into script"}
                    </Button>
                  </div>
                ) : (
                  <p className="mt-4 text-[12px] text-muted-foreground">No prompt change suggested.</p>
                )}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
