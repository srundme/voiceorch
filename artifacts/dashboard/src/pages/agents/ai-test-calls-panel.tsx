/**
 * AI Test Calls — an AI caller persona phones this agent's inbound number over
 * a REAL call, then an LLM grades the agent. Both legs are billed normally.
 */

import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch, getClientContext } from "@workspace/api-client-react";
import {
  AlertCircle,
  Archive,
  Bot,
  CheckCircle2,
  ChevronDown,
  Clock,
  FileText,
  Loader2,
  Pencil,
  Phone,
  PhoneCall,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  User,
  Wallet,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { formatApiError } from "@/lib/format-api-error";
import { cn } from "@/lib/utils";
import {
  MAX_GENERATE,
  MAX_RUN_SELECTION,
  briefCounts,
  emptyTestCase,
  targetChipLabel,
  testCaseFieldsFrom,
  type AgentBrief,
  type TestCaseCallerFact,
  type TestCaseTarget,
  estimateRunCostCents,
  formatDurationShort,
  formatRupees,
  isActiveRun,
  runStatusMeta,
  scoreTone,
  testCasePayload,
  testTranscriptLines,
  validateTestCase,
  type TestCallsSetup,
  type TestCase,
  type TestCaseFields,
  type TestRunDetail,
  type TestRunLeg,
  type TestRunSummary,
} from "@/lib/ai-test-calls";

const _DASH_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const DASH_API = `${_DASH_BASE}/api`;
const JSON_HEADERS = { "Content-Type": "application/json" };

const TONE_CLASS: Record<string, string> = {
  good: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  bad: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300",
  warn: "border-amber-500/35 bg-amber-500/10 text-amber-800 dark:text-amber-300",
  progress: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  muted: "border-border bg-muted/40 text-muted-foreground",
};

const qk = {
  setup: (agentId: number) => ["ai-test-calls", agentId, "setup"] as const,
  cases: (agentId: number) => ["ai-test-calls", agentId, "cases"] as const,
  runs: (agentId: number) => ["ai-test-calls", agentId, "runs"] as const,
  run: (runId: number) => ["ai-test-calls", "run", runId] as const,
  brief: (agentId: number) => ["ai-test-calls", agentId, "brief"] as const,
};

export function AiTestCallsPanel({ agentId, onOpenCalling }: { agentId: number; onOpenCalling?: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();

  const setupQ = useQuery({
    queryKey: qk.setup(agentId),
    queryFn: () => customFetch<TestCallsSetup>(`${DASH_API}/agents/${agentId}/test-calls/setup`),
    enabled: agentId > 0,
    staleTime: 15_000,
  });
  const casesQ = useQuery({
    queryKey: qk.cases(agentId),
    queryFn: () => customFetch<{ testCases: TestCase[] }>(`${DASH_API}/agents/${agentId}/test-cases`),
    enabled: agentId > 0,
  });
  const runsQ = useQuery({
    queryKey: qk.runs(agentId),
    queryFn: () => customFetch<{ runs: TestRunSummary[] }>(`${DASH_API}/agents/${agentId}/test-runs`),
    enabled: agentId > 0,
    refetchInterval: (q) => (q.state.data?.runs.some((r) => isActiveRun(r.status)) ? 4_000 : false),
  });

  const briefQ = useQuery({
    queryKey: qk.brief(agentId),
    queryFn: () => customFetch<{ brief: AgentBrief | null; updatedAt: string | null }>(`${DASH_API}/agents/${agentId}/test-calls/brief`),
    enabled: agentId > 0,
    staleTime: 60_000,
  });

  const setup = setupQ.data;
  const brief = briefQ.data?.brief ?? null;
  const testCases = casesQ.data?.testCases ?? [];
  const runs = runsQ.data?.runs ?? [];
  const hasActiveRuns = runs.some((r) => isActiveRun(r.status));

  // Wallet + active-call slots change while runs progress.
  useEffect(() => {
    if (!hasActiveRuns) void queryClient.invalidateQueries({ queryKey: qk.setup(agentId) });
  }, [hasActiveRuns, agentId, queryClient]);

  const [drafts, setDrafts] = useState<TestCaseFields[]>([]);
  const [generateCount, setGenerateCount] = useState(5);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [editing, setEditing] = useState<TestCase | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<TestCase | null>(null);
  const [confirmRunOpen, setConfirmRunOpen] = useState(false);
  const [openRunId, setOpenRunId] = useState<number | null>(null);

  useEffect(() => {
    setSelected((prev) => {
      const ids = new Set(testCases.map((t) => t.id));
      const next = new Set([...prev].filter((id) => ids.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [testCases]);

  const generate = useMutation({
    mutationFn: (count: number) => customFetch<{ drafts: TestCaseFields[]; brief: AgentBrief }>(
      `${DASH_API}/agents/${agentId}/test-cases/generate`,
      { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ count }) },
    ),
    onSuccess: (data) => {
      queryClient.setQueryData(qk.brief(agentId), { brief: data.brief, updatedAt: new Date().toISOString() });
      setDrafts((prev) => [...prev, ...data.drafts.map(testCaseFieldsFrom)]);
      if (data.drafts.length === 0) toast({ title: "No personas generated", description: "Try again, or add one manually." });
    },
    onError: (err) => toast({ title: "Couldn't generate personas", description: formatApiError(err), variant: "destructive" }),
  });

  const saveDrafts = useMutation({
    mutationFn: (items: TestCaseFields[]) => customFetch<{ testCases: TestCase[] }>(
      `${DASH_API}/agents/${agentId}/test-cases`,
      { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ testCases: items.map(testCasePayload) }) },
    ),
    onSuccess: (data) => {
      setDrafts([]);
      void queryClient.invalidateQueries({ queryKey: qk.cases(agentId) });
      toast({ title: `Saved ${data.testCases.length} test ${data.testCases.length === 1 ? "case" : "cases"}` });
    },
    onError: (err) => toast({ title: "Couldn't save test cases", description: formatApiError(err), variant: "destructive" }),
  });

  const updateCase = useMutation({
    mutationFn: ({ id, fields }: { id: number; fields: TestCaseFields }) => customFetch(
      `${DASH_API}/test-cases/${id}`,
      { method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify(testCasePayload(fields)) },
    ),
    onSuccess: () => {
      setEditing(null);
      void queryClient.invalidateQueries({ queryKey: qk.cases(agentId) });
      toast({ title: "Test case updated" });
    },
    onError: (err) => toast({ title: "Couldn't update test case", description: formatApiError(err), variant: "destructive" }),
  });

  const archiveCase = useMutation({
    mutationFn: (id: number) => customFetch(`${DASH_API}/test-cases/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      setArchiveTarget(null);
      void queryClient.invalidateQueries({ queryKey: qk.cases(agentId) });
    },
    onError: (err) => toast({ title: "Couldn't archive test case", description: formatApiError(err), variant: "destructive" }),
  });

  const startRuns = useMutation({
    mutationFn: (testCaseIds: number[]) => customFetch<{ runs: TestRunSummary[]; estimatedCostCents: number }>(
      `${DASH_API}/agents/${agentId}/test-runs`,
      { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ testCaseIds }) },
    ),
    onSuccess: (data) => {
      setConfirmRunOpen(false);
      setSelected(new Set());
      void queryClient.invalidateQueries({ queryKey: qk.runs(agentId) });
      void queryClient.invalidateQueries({ queryKey: qk.setup(agentId) });
      toast({ title: `Started ${data.runs.length} test ${data.runs.length === 1 ? "call" : "calls"}`, description: "Calls run one at a time. Results appear below." });
    },
    onError: (err) => {
      setConfirmRunOpen(false);
      toast({ title: "Couldn't start test calls", description: formatApiError(err), variant: "destructive" });
    },
  });

  const cancelRun = useMutation({
    mutationFn: (runId: number) => customFetch(`${DASH_API}/test-runs/${runId}/cancel`, { method: "POST" }),
    onSuccess: (_d, runId) => {
      void queryClient.invalidateQueries({ queryKey: qk.runs(agentId) });
      void queryClient.invalidateQueries({ queryKey: qk.run(runId) });
    },
    onError: (err) => toast({ title: "Couldn't cancel", description: formatApiError(err), variant: "destructive" }),
  });

  const selectedCases = testCases.filter((t) => selected.has(t.id));
  const selectedEstimate = setup
    ? selectedCases.reduce((sum, tc) => sum + estimateRunCostCents(tc.maxDurationSeconds, setup), 0)
    : 0;
  const blocked = Boolean(setup?.blocker);
  const lowBalance = setup ? setup.walletBalanceCents < selectedEstimate : false;

  const toggleSelected = (id: number, on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) {
        if (next.size >= MAX_RUN_SELECTION) {
          toast({ title: `Pick up to ${MAX_RUN_SELECTION} test cases per run` });
          return prev;
        }
        next.add(id);
      } else next.delete(id);
      return next;
    });
  };

  const draftErrors = drafts.map(validateTestCase);

  return (
    <div className="flex flex-col gap-5">
      <BillingCard setup={setup} loading={setupQ.isLoading} error={setupQ.error} onRetry={() => setupQ.refetch()} />

      {setup?.blocker && (
        <div className="flex flex-col gap-3 rounded-xl border border-amber-500/35 bg-amber-500/10 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-2.5">
            <Phone className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-300" />
            <div>
              <p className="text-[13px] font-medium text-foreground">This agent needs its own inbound number</p>
              <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
                {setup.blocker.message} The AI caller phones that number, so it must be a number you own that rings this agent directly.
              </p>
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            {onOpenCalling && (
              <Button type="button" size="sm" onClick={onOpenCalling}>Assign inbound number</Button>
            )}
            <Button type="button" size="sm" variant="outline" onClick={() => navigate("/app/phone-numbers")}>Phone numbers</Button>
          </div>
        </div>
      )}

      {/* ── Personas / test cases ───────────────────────────────────────── */}
      <section className="rounded-xl border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div>
            <h3 className="text-[14px] font-semibold text-foreground">Test cases</h3>
            <p className="text-[12px] text-muted-foreground">Callers are written from this agent's prompt — each one tests specific facts, rules and steps it was given.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={String(generateCount)} onValueChange={(v) => setGenerateCount(Number(v))}>
              <SelectTrigger className="h-8 w-[92px] text-[12px]" aria-label="How many personas"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Array.from({ length: MAX_GENERATE }, (_, i) => i + 1).map((n) => (
                  <SelectItem key={n} value={String(n)}>{n} {n === 1 ? "persona" : "personas"}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="button" size="sm" variant="outline" disabled={generate.isPending} onClick={() => generate.mutate(generateCount)}>
              {generate.isPending ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <Sparkles className="mr-1.5 size-3.5" />}
              {generate.isPending ? "Reading your prompt…" : "Generate from prompt"}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setDrafts((d) => [...d, emptyTestCase(setup?.defaultMaxDurationSeconds)])}>
              <Plus className="mr-1 size-3.5" /> Add manually
            </Button>
          </div>
        </div>

        {brief && <BriefSummary brief={brief} defaultOpen={drafts.length > 0} />}

        {drafts.length > 0 && (
          <div className="border-b border-border bg-muted/20 px-4 py-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-[12px] font-medium text-foreground">
                {drafts.length} draft{drafts.length === 1 ? "" : "s"} — review and edit before saving
              </p>
              <div className="flex gap-2">
                <Button type="button" size="sm" variant="ghost" onClick={() => setDrafts([])}>Discard all</Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={saveDrafts.isPending || draftErrors.some(Boolean)}
                  onClick={() => saveDrafts.mutate(drafts)}
                >
                  {saveDrafts.isPending && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
                  Save {drafts.length === 1 ? "draft" : `${drafts.length} drafts`}
                </Button>
              </div>
            </div>
            <div className="flex flex-col gap-3">
              {drafts.map((d, i) => (
                <div key={i} className="rounded-lg border border-border bg-background p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Draft {i + 1}</span>
                    <Button type="button" size="icon" variant="ghost" className="size-7" aria-label="Remove draft"
                      onClick={() => setDrafts((prev) => prev.filter((_, j) => j !== i))}>
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                  <GroundingDetails targets={d.targets} callerFacts={d.callerFacts} expectedOutcome={d.expectedOutcome} className="mb-3" />
                  <TestCaseEditor value={d} onChange={(next) => setDrafts((prev) => prev.map((x, j) => (j === i ? next : x)))} />
                  {draftErrors[i] && <p className="mt-2 text-[12px] text-destructive">{draftErrors[i]}</p>}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="px-4 py-3">
          {casesQ.isLoading ? (
            <div className="flex flex-col gap-2">
              {[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 w-full" />)}
            </div>
          ) : casesQ.error ? (
            <ErrorRow message={formatApiError(casesQ.error)} onRetry={() => casesQ.refetch()} />
          ) : testCases.length === 0 ? (
            drafts.length === 0 && (
              <div className="flex flex-col items-center gap-2 py-8 text-center">
                <Bot className="size-6 text-muted-foreground" />
                <p className="text-[13px] font-medium text-foreground">No test cases yet</p>
                <p className="max-w-sm text-[12px] text-muted-foreground">
                  We read this agent's prompt, tools and knowledge base, then write callers who test its actual facts, rules and steps. Edit and save the ones you want.
                </p>
              </div>
            )
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {testCases.map((tc) => (
                <li key={tc.id} className="flex items-start gap-3 py-3">
                  <Checkbox
                    className="mt-1"
                    checked={selected.has(tc.id)}
                    onCheckedChange={(v) => toggleSelected(tc.id, v === true)}
                    aria-label={`Select ${tc.name}`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[13px] font-medium text-foreground">{tc.name}</span>
                      {tc.scenario && <Badge variant="outline" className="text-[10px] font-normal">{tc.scenario.replace(/_/g, " ")}</Badge>}
                      {tc.difficulty && <Badge variant="outline" className="text-[10px] font-normal">{tc.difficulty}</Badge>}
                      {tc.language && <Badge variant="outline" className="text-[10px] font-normal">{tc.language}</Badge>}
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-[12px] text-muted-foreground">{tc.callerRole ? `${tc.callerRole} — ` : ""}{tc.goal}</p>
                    <GroundingDetails targets={tc.targets ?? []} callerFacts={tc.callerFacts ?? []} expectedOutcome={tc.expectedOutcome} compact className="mt-1.5" />
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {tc.successCriteria.length} check{tc.successCriteria.length === 1 ? "" : "s"} · up to {formatDurationShort(tc.maxDurationSeconds)}
                      {setup && <> · max {formatRupees(estimateRunCostCents(tc.maxDurationSeconds, setup))}</>}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button type="button" size="icon" variant="ghost" className="size-7" aria-label="Edit" onClick={() => setEditing(tc)}>
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button type="button" size="icon" variant="ghost" className="size-7" aria-label="Archive" onClick={() => setArchiveTarget(tc)}>
                      <Archive className="size-3.5" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {testCases.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
            <p className="text-[12px] text-muted-foreground">
              {selected.size === 0
                ? `Select up to ${MAX_RUN_SELECTION} test cases to run`
                : <>{selected.size} selected · estimated max <span className="font-medium text-foreground">{formatRupees(selectedEstimate)}</span></>}
            </p>
            <Button
              type="button"
              size="sm"
              disabled={selected.size === 0 || blocked || !setup || startRuns.isPending}
              onClick={() => setConfirmRunOpen(true)}
            >
              <PhoneCall className="mr-1.5 size-3.5" /> Run {selected.size > 0 ? selected.size : ""} test call{selected.size === 1 ? "" : "s"}
            </Button>
          </div>
        )}
      </section>

      {/* ── Runs ─────────────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div>
            <h3 className="text-[14px] font-semibold text-foreground">Test runs</h3>
            <p className="text-[12px] text-muted-foreground">
              {hasActiveRuns ? "Live — refreshing every few seconds." : "Latest 100 runs for this agent."}
            </p>
          </div>
          <Button type="button" size="icon" variant="ghost" className="size-8" aria-label="Refresh runs" onClick={() => runsQ.refetch()}>
            <RefreshCw className={cn("size-3.5", runsQ.isFetching && "animate-spin")} />
          </Button>
        </div>
        <div className="px-4 py-2">
          {runsQ.isLoading ? (
            <div className="flex flex-col gap-2 py-2">
              {[0, 1].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : runsQ.error ? (
            <ErrorRow message={formatApiError(runsQ.error)} onRetry={() => runsQ.refetch()} />
          ) : runs.length === 0 ? (
            <p className="py-8 text-center text-[12px] text-muted-foreground">No test calls yet. Select test cases above and press Run.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {runs.map((run) => (
                <li key={run.id} className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setOpenRunId(run.id)}
                    className="flex min-w-0 flex-1 items-center gap-3 py-3 text-left transition-colors hover:bg-muted/30"
                  >
                    <ScoreBadge score={run.score} status={run.status} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium text-foreground">{run.testCaseName ?? `Test #${run.testCaseId ?? run.id}`}</p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {new Date(run.createdAt).toLocaleString()} · {formatDurationShort(run.durationSeconds)} · {formatRupees(run.costCents)}
                        {run.error && <> · <span className="text-amber-700 dark:text-amber-300">{run.error}</span></>}
                      </p>
                    </div>
                    <StatusPill status={run.status} />
                  </button>
                  {isActiveRun(run.status) && (
                    <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-[11px]"
                      disabled={cancelRun.isPending} onClick={() => cancelRun.mutate(run.id)}>
                      Cancel
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* ── Dialogs ──────────────────────────────────────────────────────── */}
      <EditTestCaseDialog
        testCase={editing}
        saving={updateCase.isPending}
        onClose={() => setEditing(null)}
        onSave={(fields) => editing && updateCase.mutate({ id: editing.id, fields })}
      />

      <AlertDialog open={archiveTarget != null} onOpenChange={(o) => !o && setArchiveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive “{archiveTarget?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>It disappears from this list. Past runs and their recordings stay available.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep</AlertDialogCancel>
            <AlertDialogAction onClick={() => archiveTarget && archiveCase.mutate(archiveTarget.id)}>Archive</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmRunOpen} onOpenChange={setConfirmRunOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Place {selectedCases.length} real test call{selectedCases.length === 1 ? "" : "s"}?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-[13px]">
                <p>
                  An AI caller will phone <span className="font-medium text-foreground">{setup?.inboundNumber ?? "this agent's number"}</span>.
                  Both sides of every call — the AI caller and your agent — are billed at your normal per-minute rate.
                </p>
                <p>
                  Estimated maximum: <span className="font-semibold text-foreground">{formatRupees(selectedEstimate)}</span>
                  {" "}(if every call runs to its time limit; most finish sooner). Wallet: {formatRupees(setup?.walletBalanceCents)}.
                </p>
                {lowBalance && (
                  <p className="text-destructive">Your wallet is below the estimated maximum. Top up before running.</p>
                )}
                <p>Calls run one at a time and use {setup?.slotsPerRun ?? 2} concurrent call slots each.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={startRuns.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={startRuns.isPending || lowBalance}
              onClick={(e) => { e.preventDefault(); startRuns.mutate(selectedCases.map((t) => t.id)); }}
            >
              {startRuns.isPending && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
              Place calls
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <RunDetailSheet
        runId={openRunId}
        onClose={() => setOpenRunId(null)}
        onCancel={(id) => cancelRun.mutate(id)}
        cancelling={cancelRun.isPending}
      />
    </div>
  );
}

/* ── Billing ──────────────────────────────────────────────────────────────── */

function BillingCard({ setup, loading, error, onRetry }: {
  setup: TestCallsSetup | undefined;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
}) {
  if (loading) return <Skeleton className="h-[104px] w-full rounded-xl" />;
  if (error || !setup) return <ErrorRow message={error ? formatApiError(error) : "Couldn't load test call setup"} onRetry={onRetry} />;
  const minutes = Math.round(setup.defaultMaxDurationSeconds / 60);
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start gap-2.5">
        <Wallet className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="text-[13px] font-medium text-foreground">Real phone calls, billed normally</p>
          <p className="text-[12px] leading-relaxed text-muted-foreground">
            Each test is a real call from an AI caller to {setup.inboundNumber ?? "this agent's inbound number"}. Both legs are billed
            at your normal rates — the AI caller at {formatRupees(setup.callerRateCentsPerMin)}/min and this agent at {formatRupees(setup.targetRateCentsPerMin)}/min.
            A {minutes}-minute test costs at most <span className="font-medium text-foreground">{formatRupees(setup.estimatedCostCentsDefault)}</span>.
            Test calls appear in Call History but are left out of analytics, webhooks, CRM pushes and caller memory.
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 pt-0.5 text-[11px] text-muted-foreground">
            <span>Wallet {formatRupees(setup.walletBalanceCents)}</span>
            <span>Call slots in use {setup.activeCalls}/{setup.concurrentLimit} (each test uses {setup.slotsPerRun})</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function ErrorRow({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5">
      <span className="flex items-center gap-2 text-[12px] text-destructive"><AlertCircle className="size-3.5" /> {message}</span>
      <Button type="button" size="sm" variant="outline" onClick={onRetry}>Retry</Button>
    </div>
  );
}

/* ── Badges ───────────────────────────────────────────────────────────────── */

function StatusPill({ status }: { status: string }) {
  const meta = runStatusMeta(status);
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium", TONE_CLASS[meta.tone])}>
      {isActiveRun(status) && <Loader2 className="size-3 animate-spin" />}
      {meta.label}
    </span>
  );
}

function ScoreBadge({ score, status }: { score: number | null; status: string }) {
  if (score == null) {
    const Icon = isActiveRun(status) ? Clock : status === "error" ? AlertCircle : XCircle;
    return (
      <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-lg border", TONE_CLASS.muted)}>
        <Icon className="size-4" />
      </span>
    );
  }
  return (
    <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-lg border text-[14px] font-semibold tabular-nums", TONE_CLASS[scoreTone(score)])}>
      {Math.round(score)}
    </span>
  );
}

/* ── Grounding (what the tests are based on) ──────────────────────────────── */

function BriefSummary({ brief, defaultOpen }: { brief: AgentBrief; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => { if (defaultOpen) setOpen(true); }, [defaultOpen]);
  const counts = briefCounts(brief);
  return (
    <div className="border-b border-border px-4 py-3">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 text-left" aria-expanded={open}>
        <FileText className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="text-[12px] font-medium text-foreground">What we understood from your prompt</span>
        <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
          {counts.map((c) => `${c.count} ${c.label}`).join(" · ")}
        </span>
        <ChevronDown className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="mt-3 grid gap-3 text-[12px] sm:grid-cols-2">
          <BriefBlock title="Business">{brief.business || "—"}</BriefBlock>
          <BriefBlock title="Offering">{brief.offerings.length ? brief.offerings.join(", ") : "—"}</BriefBlock>
          <BriefBlock title="Who the agent talks to">
            {brief.counterpart.who || "—"}{brief.counterpart.situation ? ` — ${brief.counterpart.situation}` : ""}
            {brief.agentDirection !== "unknown" && (
              <span className="text-muted-foreground"> ({brief.agentDirection === "outbound" ? "agent calls them" : brief.agentDirection === "inbound" ? "they call the agent" : "both directions"})</span>
            )}
          </BriefBlock>
          <BriefBlock title="Goal of the call">{brief.callObjective || "—"}</BriefBlock>
          {brief.flowSteps.length > 0 && (
            <BriefBlock title="Flow steps">
              <ol className="list-decimal space-y-0.5 pl-4">{brief.flowSteps.map((s) => <li key={s.id}>{s.text}</li>)}</ol>
            </BriefBlock>
          )}
          {brief.requiredInfo.length > 0 && (
            <BriefBlock title="Information to collect">
              <ul className="space-y-0.5">
                {brief.requiredInfo.map((f) => (
                  <li key={f.id}>{f.field}{f.validation && <span className="text-muted-foreground"> — {f.validation}</span>}</li>
                ))}
              </ul>
            </BriefBlock>
          )}
          {brief.facts.length > 0 && (
            <BriefBlock title={`Facts (${brief.facts.length})`}>
              <ul className="list-disc space-y-0.5 pl-4">{brief.facts.slice(0, 8).map((f) => <li key={f.id}>{f.text}</li>)}</ul>
              {brief.facts.length > 8 && <p className="mt-0.5 text-muted-foreground">+{brief.facts.length - 8} more</p>}
            </BriefBlock>
          )}
          {brief.rules.length > 0 && (
            <BriefBlock title={`Rules (${brief.rules.length})`}>
              <ul className="list-disc space-y-0.5 pl-4">{brief.rules.slice(0, 8).map((r) => <li key={r.id}>{r.text}</li>)}</ul>
              {brief.rules.length > 8 && <p className="mt-0.5 text-muted-foreground">+{brief.rules.length - 8} more</p>}
            </BriefBlock>
          )}
          {brief.outOfScope.length > 0 && (
            <BriefBlock title="Not covered by your prompt">
              <p className="text-muted-foreground">{brief.outOfScope.map((x) => x.text).join(" · ")}</p>
            </BriefBlock>
          )}
          <p className="text-[11px] text-muted-foreground sm:col-span-2">
            Looks wrong? Update the agent's prompt — this is re-read automatically next time you generate.
          </p>
        </div>
      )}
    </div>
  );
}

function BriefBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      <div className="text-foreground">{children}</div>
    </div>
  );
}

function GroundingDetails({ targets, callerFacts, expectedOutcome, compact, className }: {
  targets: TestCaseTarget[];
  callerFacts: TestCaseCallerFact[];
  expectedOutcome: string | null;
  compact?: boolean;
  className?: string;
}) {
  if (targets.length === 0 && callerFacts.length === 0 && !expectedOutcome) return null;
  const shownTargets = compact ? targets.slice(0, 3) : targets;
  return (
    <div className={cn("space-y-1.5", className)}>
      {targets.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Tests from your prompt</span>
          {shownTargets.map((t) => (
            <span key={t.id} title={t.label} className="max-w-[260px] truncate rounded-md border border-sky-500/25 bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-medium text-sky-800 dark:text-sky-300">
              {targetChipLabel(t)}
            </span>
          ))}
          {compact && targets.length > 3 && <span className="text-[10px] text-muted-foreground">+{targets.length - 3}</span>}
        </div>
      )}
      {!compact && callerFacts.length > 0 && (
        <div className="text-[11px] text-muted-foreground">
          <span className="font-semibold uppercase tracking-wide text-[10px]">Caller will say </span>
          {callerFacts.map((f, i) => (
            <span key={i}>{i > 0 && " · "}<span className="text-foreground">{f.label}:</span> {f.value}</span>
          ))}
        </div>
      )}
      {!compact && expectedOutcome && (
        <p className="text-[11px] text-muted-foreground">
          <span className="font-semibold uppercase tracking-wide text-[10px]">Expected outcome </span>
          <span className="text-foreground">{expectedOutcome}</span>
        </p>
      )}
    </div>
  );
}

/* ── Test case editor ─────────────────────────────────────────────────────── */

function TestCaseEditor({ value, onChange }: { value: TestCaseFields; onChange: (next: TestCaseFields) => void }) {
  const set = <K extends keyof TestCaseFields>(key: K, v: TestCaseFields[K]) => onChange({ ...value, [key]: v });
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1 sm:col-span-2">
        <Label className="text-[11px] text-muted-foreground">Name</Label>
        <Input className="h-8 text-[13px]" value={value.name} maxLength={120} onChange={(e) => set("name", e.target.value)} />
      </div>
      <div className="space-y-1 sm:col-span-2">
        <Label className="text-[11px] text-muted-foreground">Caller's role (relative to this business)</Label>
        <Input className="h-8 text-[13px]" placeholder="e.g. Parent registering a 9-year-old for the science fair" value={value.callerRole ?? ""} maxLength={300}
          onChange={(e) => set("callerRole", e.target.value || null)} />
      </div>
      <div className="space-y-1 sm:col-span-2">
        <Label className="text-[11px] text-muted-foreground">Who is calling (persona)</Label>
        <Textarea rows={3} className="text-[13px]" value={value.personaPrompt} maxLength={2000} onChange={(e) => set("personaPrompt", e.target.value)} />
      </div>
      <div className="space-y-1 sm:col-span-2">
        <Label className="text-[11px] text-muted-foreground">Caller's goal</Label>
        <Input className="h-8 text-[13px]" value={value.goal} maxLength={500} onChange={(e) => set("goal", e.target.value)} />
      </div>
      <div className="space-y-1.5 sm:col-span-2">
        <Label className="text-[11px] text-muted-foreground">Success criteria (what the agent must do)</Label>
        {value.successCriteria.map((c, i) => (
          <div key={i} className="flex gap-1.5">
            <Input
              className="h-8 text-[13px]"
              value={c}
              maxLength={300}
              onChange={(e) => set("successCriteria", value.successCriteria.map((x, j) => (j === i ? e.target.value : x)))}
            />
            <Button type="button" size="icon" variant="ghost" className="size-8 shrink-0" aria-label="Remove criterion"
              disabled={value.successCriteria.length <= 1}
              onClick={() => set("successCriteria", value.successCriteria.filter((_, j) => j !== i))}>
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        ))}
        {value.successCriteria.length < 8 && (
          <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-[12px]"
            onClick={() => set("successCriteria", [...value.successCriteria, ""])}>
            <Plus className="mr-1 size-3" /> Add criterion
          </Button>
        )}
      </div>
      <div className="space-y-1 sm:col-span-2">
        <Label className="text-[11px] text-muted-foreground">Expected outcome</Label>
        <Input className="h-8 text-[13px]" placeholder="e.g. Registration captured with name, age and mobile" value={value.expectedOutcome ?? ""} maxLength={500}
          onChange={(e) => set("expectedOutcome", e.target.value || null)} />
      </div>
      <div className="space-y-1.5 sm:col-span-2">
        <Label className="text-[11px] text-muted-foreground">Caller will say (details given when asked)</Label>
        {value.callerFacts.map((f, i) => (
          <div key={i} className="flex gap-1.5">
            <Input className="h-8 w-[38%] text-[13px]" placeholder="Detail" value={f.label} maxLength={60}
              onChange={(e) => set("callerFacts", value.callerFacts.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
            <Input className="h-8 text-[13px]" placeholder="What they say" value={f.value} maxLength={200}
              onChange={(e) => set("callerFacts", value.callerFacts.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
            <Button type="button" size="icon" variant="ghost" className="size-8 shrink-0" aria-label="Remove detail"
              onClick={() => set("callerFacts", value.callerFacts.filter((_, j) => j !== i))}>
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        ))}
        {value.callerFacts.length < 12 && (
          <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-[12px]"
            onClick={() => set("callerFacts", [...value.callerFacts, { label: "", value: "" }])}>
            <Plus className="mr-1 size-3" /> Add detail
          </Button>
        )}
      </div>
      <div className="space-y-1">
        <Label className="text-[11px] text-muted-foreground">Difficulty</Label>
        <Select value={value.difficulty ?? "medium"} onValueChange={(v) => set("difficulty", v as TestCaseFields["difficulty"])}>
          <SelectTrigger className="h-8 text-[13px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="easy">Easy</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="hard">Hard</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label className="text-[11px] text-muted-foreground">Caller voice</Label>
        <Select value={value.callerGender ?? "female"} onValueChange={(v) => set("callerGender", v as TestCaseFields["callerGender"])}>
          <SelectTrigger className="h-8 text-[13px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="female">Female</SelectItem>
            <SelectItem value="male">Male</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label className="text-[11px] text-muted-foreground">Language code (optional)</Label>
        <Input className="h-8 text-[13px]" placeholder="e.g. en-IN, hi-IN" value={value.language ?? ""} maxLength={10}
          onChange={(e) => set("language", e.target.value.trim() || null)} />
      </div>
      <div className="space-y-1">
        <Label className="text-[11px] text-muted-foreground">Time limit</Label>
        <Select value={String(value.maxDurationSeconds)} onValueChange={(v) => set("maxDurationSeconds", Number(v))}>
          <SelectTrigger className="h-8 text-[13px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {[60, 120, 180, 300, 600, 900].map((s) => (
              <SelectItem key={s} value={String(s)}>{s / 60} min</SelectItem>
            ))}
            {![60, 120, 180, 300, 600, 900].includes(value.maxDurationSeconds) && (
              <SelectItem value={String(value.maxDurationSeconds)}>{formatDurationShort(value.maxDurationSeconds)}</SelectItem>
            )}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

function EditTestCaseDialog({ testCase, saving, onClose, onSave }: {
  testCase: TestCase | null;
  saving: boolean;
  onClose: () => void;
  onSave: (fields: TestCaseFields) => void;
}) {
  const [draft, setDraft] = useState<TestCaseFields | null>(null);
  useEffect(() => {
    setDraft(testCase ? testCaseFieldsFrom(testCase) : null);
  }, [testCase]);
  const error = draft ? validateTestCase(draft) : null;
  return (
    <Dialog open={testCase != null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[620px]">
        <DialogHeader>
          <DialogTitle>Edit test case</DialogTitle>
          <DialogDescription>Changes apply to future runs. Past runs keep the version they used.</DialogDescription>
        </DialogHeader>
        {draft && <GroundingDetails targets={draft.targets} callerFacts={[]} expectedOutcome={null} />}
        {draft && <TestCaseEditor value={draft} onChange={setDraft} />}
        {error && <p className="text-[12px] text-destructive">{error}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="button" disabled={!draft || Boolean(error) || saving} onClick={() => draft && onSave(draft)}>
            {saving && <Loader2 className="mr-1.5 size-3.5 animate-spin" />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── Run detail ───────────────────────────────────────────────────────────── */

function RunDetailSheet({ runId, onClose, onCancel, cancelling }: {
  runId: number | null;
  onClose: () => void;
  onCancel: (id: number) => void;
  cancelling: boolean;
}) {
  const runQ = useQuery({
    queryKey: qk.run(runId ?? 0),
    queryFn: () => customFetch<{ run: TestRunDetail }>(`${DASH_API}/test-runs/${runId}`),
    enabled: runId != null,
    refetchInterval: (q) => (q.state.data && isActiveRun(q.state.data.run.status) ? 4_000 : false),
  });
  const run = runQ.data?.run;
  const transcriptLeg: { leg: TestRunLeg; side: "target" | "caller" } | null = run?.targetLeg?.transcript
    ? { leg: run.targetLeg, side: "target" }
    : run?.callerLeg?.transcript ? { leg: run.callerLeg, side: "caller" } : null;
  const lines = useMemo(
    () => (transcriptLeg ? testTranscriptLines(transcriptLeg.leg.transcript, transcriptLeg.side) : []),
    [transcriptLeg?.leg.transcript, transcriptLeg?.side],
  );
  const recordingPath = run?.targetLeg?.recordingPath ?? run?.callerLeg?.recordingPath ?? null;
  const evaluation = run?.evaluation;

  return (
    <Sheet open={runId != null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-[560px]">
        <SheetHeader>
          <SheetTitle>{run?.testCaseName ?? "Test run"}</SheetTitle>
          <SheetDescription>
            {run ? <>Run #{run.id} · {new Date(run.createdAt).toLocaleString()}</> : "Loading…"}
          </SheetDescription>
        </SheetHeader>

        {runQ.isLoading ? (
          <div className="mt-6 flex flex-col gap-3">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : runQ.error ? (
          <div className="mt-6"><ErrorRow message={formatApiError(runQ.error)} onRetry={() => runQ.refetch()} /></div>
        ) : run ? (
          <div className="mt-5 flex flex-col gap-5">
            <div className="flex items-center gap-3">
              <ScoreBadge score={run.score} status={run.status} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill status={run.status} />
                  {run.verdict && <span className="text-[12px] text-muted-foreground">Verdict: {run.verdict}</span>}
                </div>
                {run.error && <p className="mt-1 text-[12px] text-amber-700 dark:text-amber-300">{run.error}</p>}
              </div>
              {isActiveRun(run.status) && (
                <Button type="button" size="sm" variant="outline" disabled={cancelling} onClick={() => onCancel(run.id)}>Cancel</Button>
              )}
            </div>

            <dl className="grid grid-cols-2 gap-3 text-[12px] sm:grid-cols-4">
              <Stat label="Duration" value={formatDurationShort(run.durationSeconds)} />
              <Stat label="Total cost" value={formatRupees(run.costCents)} />
              <Stat label="Agent leg" value={formatRupees(run.targetLeg?.costCents)} />
              <Stat label="AI caller leg" value={formatRupees(run.callerLeg?.costCents)} />
            </dl>

            {run.targetLeg && (
              <div>
                <SectionTitle>Agent latency</SectionTitle>
                <dl className="grid grid-cols-3 gap-3 text-[12px]">
                  <Stat label="Speech-to-text" value={ms(run.targetLeg.latency.sttMs)} />
                  <Stat label="LLM" value={ms(run.targetLeg.latency.llmMs)} />
                  <Stat label="TTS first audio" value={ms(run.targetLeg.latency.ttsFirstChunkMs)} />
                </dl>
              </div>
            )}

            {evaluation ? (
              <div>
                <SectionTitle>Evaluation</SectionTitle>
                {evaluation.summary && <p className="mb-3 text-[13px] leading-relaxed text-foreground">{evaluation.summary}</p>}
                <ul className="flex flex-col gap-2">
                  {evaluation.criteria.map((c, i) => (
                    <li key={i} className="rounded-lg border border-border p-2.5">
                      <div className="flex items-start gap-2">
                        {c.pass
                          ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                          : <XCircle className="mt-0.5 size-4 shrink-0 text-red-600" />}
                        <div className="min-w-0">
                          <p className="text-[13px] font-medium text-foreground">{c.criterion}</p>
                          {c.reason && <p className="mt-0.5 text-[12px] text-muted-foreground">{c.reason}</p>}
                          {c.evidence && <p className="mt-1 border-l-2 border-border pl-2 text-[12px] italic text-muted-foreground">“{c.evidence}”</p>}
                          {c.refs && c.refs.length > 0 && (
                            <div className="mt-1.5 flex flex-wrap gap-1">
                              {c.refs.map((ref) => {
                                const target = run.testCase?.targets?.find((t) => t.id === ref);
                                return (
                                  <span key={ref} title={target?.label} className="rounded border border-border bg-muted/40 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                                    {target ? targetChipLabel(target) : `From prompt · ${ref}`}
                                  </span>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
                {evaluation.issues.length > 0 && (
                  <div className="mt-3">
                    <p className="mb-1 text-[12px] font-medium text-foreground">Issues found</p>
                    <ul className="list-disc space-y-0.5 pl-5 text-[12px] text-muted-foreground">
                      {evaluation.issues.map((issue, i) => <li key={i}>{issue}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            ) : !isActiveRun(run.status) && run.status !== "cancelled" ? (
              <p className="text-[12px] text-muted-foreground">No evaluation was stored for this run.</p>
            ) : null}

            {recordingPath && (
              <div>
                <SectionTitle>Recording</SectionTitle>
                <AuthedAudio path={recordingPath} />
              </div>
            )}

            <div>
              <SectionTitle>
                Transcript
                {transcriptLeg?.side === "caller" && <span className="ml-1 font-normal text-muted-foreground">(from the AI caller's side)</span>}
              </SectionTitle>
              {lines.length === 0 ? (
                <p className="text-[12px] text-muted-foreground">
                  {isActiveRun(run.status) ? "The transcript appears when the call ends." : "No transcript was captured."}
                </p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {lines.map((l, i) => (
                    <li key={i} className={cn("flex gap-2", l.speaker === "agent" ? "" : "flex-row-reverse text-right")}>
                      <span className={cn("mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full", l.speaker === "agent" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
                        {l.speaker === "agent" ? <Bot className="size-3.5" /> : <User className="size-3.5" />}
                      </span>
                      <p className={cn("max-w-[85%] rounded-lg px-2.5 py-1.5 text-[12px] leading-relaxed", l.speaker === "agent" ? "bg-primary/5" : "bg-muted/60")}>
                        {l.text}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {run.testCase && (
              <div>
                <SectionTitle>Test case used</SectionTitle>
                <div className="space-y-1.5 rounded-lg border border-border p-3 text-[12px] text-muted-foreground">
                  {run.testCase.callerRole && <p><span className="font-medium text-foreground">Caller:</span> {run.testCase.callerRole}</p>}
                  {run.testCase.personaPrompt && <p><span className="font-medium text-foreground">Persona:</span> {run.testCase.personaPrompt}</p>}
                  {run.testCase.expectedOutcome && <p><span className="font-medium text-foreground">Expected outcome:</span> {run.testCase.expectedOutcome}</p>}
                  {(run.testCase.targets?.length ?? 0) > 0 && <GroundingDetails targets={run.testCase.targets ?? []} callerFacts={run.testCase.callerFacts ?? []} expectedOutcome={null} />}
                  {run.testCase.goal && <p><span className="font-medium text-foreground">Goal:</span> {run.testCase.goal}</p>}
                  {run.callerFromNumber && <p><span className="font-medium text-foreground">Called from:</span> {run.callerFromNumber} → {run.targetNumber}</p>}
                </div>
              </div>
            )}
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function ms(v: number | null | undefined): string {
  return v == null ? "—" : `${Math.round(v)} ms`;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border px-2.5 py-2">
      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-medium tabular-nums text-foreground">{value}</dd>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h4 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">{children}</h4>;
}

/** Recording endpoint needs auth headers, so stream it into a blob URL. */
function AuthedAudio({ path }: { path: string }) {
  const { getToken } = useAuth();
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    (async () => {
      try {
        setError(null);
        const token = await getToken();
        const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
        const ctx = getClientContext();
        if (ctx) headers["x-client-context"] = ctx;
        const r = await fetch(`${_DASH_BASE}${path}`, { headers, credentials: "include" });
        if (!r.ok) throw new Error(`Couldn't load recording (${r.status})`);
        const blob = await r.blob();
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Couldn't load recording");
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path, getToken]);
  if (error) return <p className="text-[12px] text-destructive">{error}</p>;
  if (!url) return <Skeleton className="h-9 w-full" />;
  return <audio controls src={url} className="h-9 w-full" />;
}
