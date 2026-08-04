/**
 * Call plan detail — people + timeline + Start once + results.
 * Backed by journeys / workflow engine.
 */

import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useListAgents,
  useListCampaigns,
  getListAgentsQueryKey,
  getListCampaignsQueryKey,
  customFetch,
} from "@workspace/api-client-react";
import {
  Loader2, Play, Save, Trash2, ExternalLink, Users,
} from "lucide-react";
import { StripePage } from "@/components/stripe-page";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { formatApiError } from "@/lib/format-api-error";
import { cn } from "@/lib/utils";
import { CallPlanStepEditor, type CallPlanStep } from "./step-editor";

const _DASH_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const DASH_API = `${_DASH_BASE}/api`;

type CallPlan = {
  id: number;
  agentId: number;
  name: string;
  description: string | null;
  status: "draft" | "active" | "paused";
  steps: CallPlanStep[];
  settings: {
    peopleSource?: string;
    campaignId?: number | null;
    sheetPipelineId?: string | null;
    runMode?: "once" | "live";
    sheetCursorRow?: number;
  };
  totalRuns: number;
  lastRunAt: string | null;
};

type PlanRun = {
  id: number;
  status: string;
  context: Record<string, unknown> | null;
  currentStepIndex: number;
  error: string | null;
  triggeredBy: string | null;
  createdAt: string;
  updatedAt: string;
};

function statusClass(status: string) {
  if (status === "active" || status === "completed") {
    return "border-emerald-500/25 bg-emerald-500/10 text-emerald-400";
  }
  if (status === "paused" || status === "pending" || status === "waiting_call" || status === "waiting_delay" || status === "running") {
    return "border-amber-500/25 bg-amber-500/10 text-amber-400";
  }
  if (status === "failed" || status === "cancelled") {
    return "border-destructive/30 bg-destructive/10 text-destructive";
  }
  return "border-border/50 bg-muted/30 text-muted-foreground";
}

function personFromContext(ctx: Record<string, unknown> | null): string {
  if (!ctx) return "—";
  const phone = typeof ctx.phone === "string" ? ctx.phone : "";
  const name = typeof ctx.name === "string" ? ctx.name : "";
  if (name && phone) return `${name} · ${phone}`;
  return name || phone || "—";
}

export default function CallPlanDetailPage() {
  const params = useParams<{ id: string }>();
  const planId = Number(params.id);
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [name, setName] = useState("");
  const [agentId, setAgentId] = useState<number | null>(null);
  const [steps, setSteps] = useState<CallPlanStep[]>([]);
  const [campaignId, setCampaignId] = useState<string>("");
  const [sheetPipelineId, setSheetPipelineId] = useState<string>("");
  const [manualPhones, setManualPhones] = useState("");
  const [peopleMode, setPeopleMode] = useState<"campaign" | "sheet" | "manual">("campaign");
  const [runMode, setRunMode] = useState<"once" | "live">("once");
  const [dirty, setDirty] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const agentsQ = useListAgents({
    query: { queryKey: getListAgentsQueryKey(), staleTime: 30_000 },
  });
  const agents = (Array.isArray(agentsQ.data) ? agentsQ.data : []) as Array<{ id: number; name: string }>;

  const campaignsQ = useListCampaigns({
    query: { queryKey: getListCampaignsQueryKey(), staleTime: 30_000 },
  });
  const campaigns = useMemo(() => {
    const raw = Array.isArray(campaignsQ.data) ? campaignsQ.data : [];
    return (raw as Array<{ id: number; name: string; totalLeads?: number; leadSource?: string }>)
      .filter((c) => c.leadSource !== "workflow");
  }, [campaignsQ.data]);

  const sheetsQ = useQuery({
    queryKey: ["automatic-calls"],
    queryFn: () => customFetch<Array<{ id: string; name: string; status: string; spreadsheetTitle?: string | null }>>(
      `${DASH_API}/automatic-calls`,
    ),
    staleTime: 30_000,
  });
  const sheetPipelines = sheetsQ.data ?? [];

  const planQ = useQuery({
    queryKey: ["call-plans", planId],
    queryFn: () => customFetch<CallPlan>(`${DASH_API}/journeys/${planId}`),
    enabled: Number.isFinite(planId) && planId > 0,
  });

  const runsQ = useQuery({
    queryKey: ["call-plans", planId, "runs"],
    queryFn: () => customFetch<PlanRun[]>(`${DASH_API}/journeys/${planId}/runs`),
    enabled: Number.isFinite(planId) && planId > 0,
    refetchInterval: 8_000,
  });

  useEffect(() => {
    const plan = planQ.data;
    if (!plan) return;
    setName(plan.name);
    setAgentId(plan.agentId);
    setSteps(Array.isArray(plan.steps) ? plan.steps : []);
    const cid = plan.settings?.campaignId;
    const sid = plan.settings?.sheetPipelineId;
    if (sid) {
      setSheetPipelineId(String(sid));
      setPeopleMode("sheet");
    } else if (cid != null && Number(cid) > 0) {
      setCampaignId(String(cid));
      setPeopleMode("campaign");
    }
    setRunMode(plan.settings?.runMode === "live" ? "live" : "once");
    setDirty(false);
  }, [planQ.data]);

  const save = useMutation({
    mutationFn: async () => {
      if (agentId == null) throw new Error("Agent required");
      return customFetch<CallPlan>(`${DASH_API}/journeys/${planId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim() || "Call plan",
          agentId,
          steps: steps.map((s) =>
            s.type === "make_call" || s.type === "send_whatsapp"
              ? { ...s, agentId }
              : s,
          ),
          settings: {
            ...(planQ.data?.settings ?? {}),
            peopleSource: peopleMode,
            campaignId: peopleMode === "campaign" && campaignId
              ? Number(campaignId)
              : null,
            sheetPipelineId: peopleMode === "sheet" && sheetPipelineId
              ? sheetPipelineId
              : null,
            runMode: peopleMode === "sheet" ? runMode : "once",
          },
        }),
      });
    },
    onSuccess: (plan) => {
      qc.setQueryData(["call-plans", planId], plan);
      qc.invalidateQueries({ queryKey: ["call-plans"] });
      setDirty(false);
      toast({ title: "Plan saved" });
    },
    onError: (err) => {
      toast({ title: "Could not save", description: formatApiError(err), variant: "destructive" });
    },
  });

  const startOnce = useMutation({
    mutationFn: async () => {
      if (dirty) await save.mutateAsync();
      const body: Record<string, unknown> = {
        runMode: peopleMode === "sheet" ? runMode : "once",
      };
      if (peopleMode === "manual") {
        const phones = manualPhones
          .split(/[\n,;]+/)
          .map((p) => p.trim())
          .filter(Boolean);
        if (phones.length === 0) throw new Error("Paste at least one phone number");
        body.phones = phones;
      } else if (peopleMode === "sheet") {
        if (!sheetPipelineId) throw new Error("Pick a Sheet list");
        body.sheetPipelineId = sheetPipelineId;
      } else {
        if (!campaignId) throw new Error("Pick a people list");
        body.campaignId = Number(campaignId);
      }
      return customFetch<{ started: number; keepLive?: boolean }>(`${DASH_API}/journeys/${planId}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["call-plans", planId] });
      qc.invalidateQueries({ queryKey: ["call-plans", planId, "runs"] });
      toast({
        title: res.keepLive ? "Live" : "Started",
        description: res.keepLive
          ? `${res.started} started now — new sheet rows will keep entering.`
          : `${res.started} ${res.started === 1 ? "person" : "people"} walking this plan.`,
      });
    },
    onError: (err) => {
      toast({ title: "Could not start", description: formatApiError(err), variant: "destructive" });
    },
  });

  const remove = useMutation({
    mutationFn: async () => {
      await customFetch(`${DASH_API}/journeys/${planId}`, { method: "DELETE" });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["call-plans"] });
      navigate("/app/call-plans");
    },
    onError: (err) => {
      toast({ title: "Could not delete", description: formatApiError(err), variant: "destructive" });
    },
  });

  if (!Number.isFinite(planId) || planId <= 0) {
    return (
      <StripePage title="Call plan" description="Invalid plan.">
        <Button asChild variant="outline"><Link href="/app/call-plans">Back</Link></Button>
      </StripePage>
    );
  }

  if (planQ.isLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  if (planQ.isError || !planQ.data) {
    return (
      <StripePage title="Call plan" description="Not found." back={{ href: "/app/call-plans", label: "Call plans" }}>
        <p className="text-sm text-muted-foreground">This plan doesn’t exist or you don’t have access.</p>
      </StripePage>
    );
  }

  const plan = planQ.data;
  const runs = runsQ.data ?? [];
  const selectedCampaign = campaigns.find((c) => String(c.id) === campaignId);

  return (
    <StripePage
      title={name || plan.name}
      description="People → what happens next → Start. Missed calls use the agent’s settings."
      back={{ href: "/app/call-plans", label: "Call plans" }}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className={cn("text-[10px] h-5 px-1.5 capitalize", statusClass(plan.status))}>
            {plan.status}
          </Badge>
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-1.5"
            disabled={!dirty || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
            Save
          </Button>
          <Button
            size="sm"
            className="h-9 gap-1.5"
            disabled={startOnce.isPending || steps.length === 0}
            onClick={() => startOnce.mutate()}
          >
            {startOnce.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
            {peopleMode === "sheet" && runMode === "live" ? "Start live" : "Start once"}
          </Button>
        </div>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        {/* Left: meta + people */}
        <div className="space-y-5">
          <section className="space-y-3 rounded-xl border border-border/60 bg-card/30 p-4">
            <div className="space-y-1.5">
              <Label className="text-[11px]">Plan name</Label>
              <Input
                className="h-9"
                value={name}
                onChange={(e) => { setName(e.target.value); setDirty(true); }}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px]">Agent who talks</Label>
              <Select
                value={agentId != null ? String(agentId) : undefined}
                onValueChange={(v) => {
                  setAgentId(Number(v));
                  setDirty(true);
                }}
              >
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Choose agent…" />
                </SelectTrigger>
                <SelectContent>
                  {agents.map((a) => (
                    <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {agentId != null && (
                <Link
                  href={`/app/agents/${agentId}`}
                  className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                >
                  Edit agent <ExternalLink className="h-3 w-3" />
                </Link>
              )}
            </div>
          </section>

          <section className="space-y-3 rounded-xl border border-border/60 bg-card/30 p-4">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">People</h2>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => { setPeopleMode("campaign"); setRunMode("once"); setDirty(true); }}
                className={cn(
                  "rounded-lg border px-2.5 py-2.5 text-left text-[11px]",
                  peopleMode === "campaign"
                    ? "border-primary/40 bg-primary/5 font-medium"
                    : "border-border/50 hover:bg-muted/30",
                )}
              >
                List / CSV
              </button>
              <button
                type="button"
                onClick={() => { setPeopleMode("sheet"); setDirty(true); }}
                className={cn(
                  "rounded-lg border px-2.5 py-2.5 text-left text-[11px]",
                  peopleMode === "sheet"
                    ? "border-primary/40 bg-primary/5 font-medium"
                    : "border-border/50 hover:bg-muted/30",
                )}
              >
                Google Sheet
              </button>
              <button
                type="button"
                onClick={() => { setPeopleMode("manual"); setRunMode("once"); setDirty(true); }}
                className={cn(
                  "rounded-lg border px-2.5 py-2.5 text-left text-[11px]",
                  peopleMode === "manual"
                    ? "border-primary/40 bg-primary/5 font-medium"
                    : "border-border/50 hover:bg-muted/30",
                )}
              >
                Paste phones
              </button>
            </div>

            {peopleMode === "campaign" ? (
              <div className="space-y-2">
                <Select
                  value={campaignId || undefined}
                  onValueChange={(v) => { setCampaignId(v); setDirty(true); }}
                >
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue placeholder={campaigns.length ? "Choose a list…" : "Upload a list in People first"} />
                  </SelectTrigger>
                  <SelectContent>
                    {campaigns.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)} className="text-xs">
                        {c.name}
                        {typeof c.totalLeads === "number" ? ` · ${c.totalLeads}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-muted-foreground">
                  {selectedCampaign
                    ? `Start once walks up to 100 people from this list.`
                    : (
                      <>
                        No list yet?{" "}
                        <Link href="/app/people" className="underline underline-offset-2">
                          Upload CSV under People
                        </Link>
                        .
                      </>
                    )}
                </p>
              </div>
            ) : peopleMode === "sheet" ? (
              <div className="space-y-3">
                <Select
                  value={sheetPipelineId || undefined}
                  onValueChange={(v) => { setSheetPipelineId(v); setDirty(true); }}
                >
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue placeholder={sheetPipelines.length ? "Choose a sheet…" : "Connect a sheet first"} />
                  </SelectTrigger>
                  <SelectContent>
                    {sheetPipelines.map((p) => (
                      <SelectItem key={p.id} value={p.id} className="text-xs">
                        {p.name}
                        {p.spreadsheetTitle ? ` · ${p.spreadsheetTitle}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => { setRunMode("once"); setDirty(true); }}
                    className={cn(
                      "rounded-lg border px-3 py-2 text-left text-[11px]",
                      runMode === "once"
                        ? "border-primary/40 bg-primary/5 font-medium"
                        : "border-border/50 hover:bg-muted/30",
                    )}
                  >
                    <p className="font-medium">Start once</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">Current rows only</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => { setRunMode("live"); setDirty(true); }}
                    className={cn(
                      "rounded-lg border px-3 py-2 text-left text-[11px]",
                      runMode === "live"
                        ? "border-primary/40 bg-primary/5 font-medium"
                        : "border-border/50 hover:bg-muted/30",
                    )}
                  >
                    <p className="font-medium">Keep live</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">New rows keep entering</p>
                  </button>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  {sheetPipelines.length === 0 ? (
                    <>
                      No sheet yet?{" "}
                      <Link href="/app/people?tab=scheduled" className="underline underline-offset-2">
                        Connect Google Sheets
                      </Link>
                      .
                    </>
                  ) : runMode === "live"
                    ? "Press Start to arm — new sheet rows walk this plan from step 1."
                    : "Start once walks up to 100 current rows."}
                </p>
              </div>
            ) : (
              <div className="space-y-1.5">
                <Textarea
                  rows={4}
                  className="text-xs font-mono"
                  placeholder={"+9198…\n+9180…"}
                  value={manualPhones}
                  onChange={(e) => setManualPhones(e.target.value)}
                />
                <p className="text-[10px] text-muted-foreground">
                  One phone per line. Used only for this Start — not saved as a list.
                </p>
              </div>
            )}
          </section>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 text-xs text-destructive gap-1.5"
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete plan
          </Button>
        </div>

        {/* Right: steps + results */}
        <div className="space-y-5">
          <section className="space-y-3 rounded-xl border border-border/60 bg-card/30 p-4">
            <div>
              <h2 className="text-sm font-semibold">What happens next</h2>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Ordered steps. Drag with the arrows. No flowchart.
              </p>
            </div>
            {agentId != null ? (
              <CallPlanStepEditor
                steps={steps}
                agentId={agentId}
                onChange={(next) => { setSteps(next); setDirty(true); }}
              />
            ) : (
              <p className="text-[12px] text-muted-foreground">Pick an agent first.</p>
            )}
          </section>

          <section className="space-y-3 rounded-xl border border-border/60 bg-card/30 p-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold">Results</h2>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Per person — step progress and outcomes.
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-[11px]"
                onClick={() => runsQ.refetch()}
              >
                Refresh
              </Button>
            </div>
            {runsQ.isLoading ? (
              <div className="h-16 animate-pulse rounded-md bg-muted/40" />
            ) : runs.length === 0 ? (
              <p className="text-[12px] text-muted-foreground py-2">
                Nothing started yet. Press Start once.
              </p>
            ) : (
              <ul className="divide-y divide-border/60 rounded-lg border border-border/40 overflow-hidden">
                {runs.map((run) => (
                  <li key={run.id} className="flex items-center gap-3 px-3 py-2.5 text-[12px]">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium truncate">{personFromContext(run.context)}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        Step {Math.min(run.currentStepIndex + 1, Math.max(steps.length, 1))}
                        {run.error ? ` · ${run.error}` : ""}
                      </p>
                    </div>
                    <Badge variant="outline" className={cn("text-[10px] h-5 px-1.5 capitalize shrink-0", statusClass(run.status))}>
                      {run.status.replace(/_/g, " ")}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-[10px] text-muted-foreground">
              Call recordings and transcripts stay in{" "}
              <Link href="/app/history" className="underline underline-offset-2">History</Link>.
            </p>
          </section>
        </div>
      </div>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this call plan?</AlertDialogTitle>
            <AlertDialogDescription>
              Stops future starts. Past runs and calls are kept in History.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => remove.mutate()}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </StripePage>
  );
}
