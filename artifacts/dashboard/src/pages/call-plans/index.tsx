/**
 * Call plans list — Compose opens the single-screen builder; Suggest a starter drafts from a sentence.
 */

import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useListAgents,
  getListAgentsQueryKey,
  customFetch,
} from "@workspace/api-client-react";
import {
  Loader2, Plus, ListOrdered, Play, Pause, FileText, Sparkles,
} from "lucide-react";
import { StripePage } from "@/components/stripe-page";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { formatApiError } from "@/lib/format-api-error";
import { cn } from "@/lib/utils";
import { PlanVibeDialog } from "./plan-vibe-dialog";

const _DASH_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const DASH_API = `${_DASH_BASE}/api`;

type CallPlan = {
  id: number;
  agentId: number;
  name: string;
  description: string | null;
  status: "draft" | "active" | "paused";
  steps: unknown[];
  totalRuns: number;
  lastRunAt: string | null;
  updatedAt: string;
};

function statusClass(status: string) {
  if (status === "active") return "border-emerald-500/25 bg-emerald-500/10 text-emerald-400";
  if (status === "paused") return "border-amber-500/25 bg-amber-500/10 text-amber-400";
  return "border-border/50 bg-muted/30 text-muted-foreground";
}

export default function CallPlansPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [vibeOpen, setVibeOpen] = useState(false);

  const agentsQ = useListAgents({
    query: { queryKey: getListAgentsQueryKey(), staleTime: 30_000 },
  });
  const agents = (Array.isArray(agentsQ.data) ? agentsQ.data : []) as Array<{ id: number; name: string }>;

  const plansQ = useQuery({
    queryKey: ["call-plans"],
    queryFn: () => customFetch<CallPlan[]>(`${DASH_API}/journeys`),
    staleTime: 10_000,
  });

  const compose = useMutation({
    mutationFn: async () => {
      const aid = agents[0]?.id;
      if (!aid) throw new Error("Create an agent first");
      return customFetch<CallPlan>(`${DASH_API}/journeys`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId: aid,
          presetId: "custom",
          name: "Untitled plan",
          description: null,
          trigger: { type: "manual" },
          steps: [],
          settings: {
            peopleSource: "campaign",
            runMode: "once",
            leadSource: "list",
          },
        }),
      });
    },
    onSuccess: (plan) => {
      qc.invalidateQueries({ queryKey: ["call-plans"] });
      navigate(`/app/call-plans/${plan.id}`);
    },
    onError: (err) => {
      toast({ title: "Could not create plan", description: formatApiError(err), variant: "destructive" });
    },
  });

  function ensureAgentThen(open: "compose" | "vibe") {
    if (agents.length === 0) {
      navigate("/app/agents?create=1");
      return;
    }
    if (open === "vibe") {
      setVibeOpen(true);
      return;
    }
    compose.mutate();
  }

  const plans = plansQ.data ?? [];

  return (
    <StripePage
      title="Call plans"
      description="Agent → Call plan → Leads → Start queue."
      back={{ href: "/app/home", label: "Home" }}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" className="h-9 gap-1.5" onClick={() => ensureAgentThen("vibe")}>
            <Sparkles className="size-4" />
            Suggest a starter
          </Button>
          <Button
            className="h-9 gap-1.5"
            disabled={compose.isPending}
            onClick={() => ensureAgentThen("compose")}
          >
            {compose.isPending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            Compose
          </Button>
        </div>
      }
    >
      {plansQ.isLoading ? (
        <div className="flex justify-center py-16 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : plans.length === 0 ? (
        <div className="mx-auto flex max-w-lg flex-col items-center py-14 text-center">
          <ListOrdered className="mb-3 size-5 text-muted-foreground" />
          <p className="text-sm font-medium">No call plans yet</p>
          <p className="mt-1.5 max-w-sm text-[13px] text-muted-foreground leading-relaxed">
            One screen: pick who talks, who to reach, what happens next — then Start queue.
          </p>
          <ol className="mt-5 w-full max-w-sm space-y-2 text-left">
            {[
              agents.length === 0 ? (
                <>
                  Create an agent —{" "}
                  <Link href="/app/agents?create=1" className="underline underline-offset-2 text-foreground/80">
                    Agents
                  </Link>
                  {" "}or{" "}
                  <Link href="/app/vibe" className="underline underline-offset-2 text-foreground/80">
                    Vibe
                  </Link>
                </>
              ) : (
                "Agent ready"
              ),
              "Compose a plan (or Suggest a starter)",
              "Attach leads on the same screen",
              "Start queue",
            ].map((step, i) => (
              <li key={i} className="flex items-start gap-2.5 text-[12px] text-muted-foreground">
                <span className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border/60 bg-muted/30 text-[10px] font-semibold">
                  {i + 1}
                </span>
                <span className="leading-snug pt-0.5">{step}</span>
              </li>
            ))}
          </ol>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            {agents.length === 0 ? (
              <Button className="gap-1.5" onClick={() => navigate("/app/agents?create=1")}>
                <Plus className="size-4" />
                Create an agent
              </Button>
            ) : (
              <>
                <Button className="gap-1.5" disabled={compose.isPending} onClick={() => ensureAgentThen("compose")}>
                  {compose.isPending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                  Compose
                </Button>
                <Button variant="outline" className="gap-1.5" onClick={() => ensureAgentThen("vibe")}>
                  <Sparkles className="size-4" />
                  Suggest a starter
                </Button>
              </>
            )}
          </div>
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border/60 overflow-hidden bg-card/30">
          {plans.map((plan) => {
            const agentName = agents.find((a) => a.id === plan.agentId)?.name ?? `Agent ${plan.agentId}`;
            const stepCount = Array.isArray(plan.steps) ? plan.steps.length : 0;
            return (
              <li key={plan.id}>
                <Link
                  href={`/app/call-plans/${plan.id}`}
                  className="flex items-center gap-3 px-4 py-3.5 hover:bg-muted/30 transition-colors"
                >
                  <div className="h-9 w-9 rounded-lg border border-border/50 bg-muted/30 flex items-center justify-center shrink-0">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium truncate">{plan.name}</p>
                      <Badge variant="outline" className={cn("text-[10px] h-5 px-1.5 capitalize", statusClass(plan.status))}>
                        {plan.status}
                      </Badge>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                      {agentName} · {stepCount} step{stepCount === 1 ? "" : "s"}
                      {plan.totalRuns > 0 ? ` · ${plan.totalRuns} run${plan.totalRuns === 1 ? "" : "s"}` : ""}
                    </p>
                  </div>
                  {plan.status === "active" ? (
                    <Play className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                  ) : plan.status === "paused" ? (
                    <Pause className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <PlanVibeDialog
        open={vibeOpen}
        onOpenChange={setVibeOpen}
        agents={agents}
        defaultAgentId={agents[0] ? String(agents[0].id) : undefined}
        onCreated={(plan) => {
          qc.invalidateQueries({ queryKey: ["call-plans"] });
          navigate(`/app/call-plans/${plan.id}`);
        }}
      />
    </StripePage>
  );
}
