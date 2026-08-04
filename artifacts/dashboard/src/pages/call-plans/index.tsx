/**
 * Call plans — list of ordered step recipes (journeys under the hood).
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
  Loader2, Plus, ListOrdered, Play, Pause, FileText,
} from "lucide-react";
import { StripePage } from "@/components/stripe-page";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { formatApiError } from "@/lib/format-api-error";
import { cn } from "@/lib/utils";
import { CALL_PLAN_TEMPLATES, stepsForTemplate, type CallPlanTemplateId } from "./step-editor";

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
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [agentId, setAgentId] = useState<string>("");
  const [templateId, setTemplateId] = useState<CallPlanTemplateId>("lead_followup");

  const agentsQ = useListAgents({
    query: { queryKey: getListAgentsQueryKey(), staleTime: 30_000 },
  });
  const agents = (Array.isArray(agentsQ.data) ? agentsQ.data : []) as Array<{ id: number; name: string }>;

  const plansQ = useQuery({
    queryKey: ["call-plans"],
    queryFn: () => customFetch<CallPlan[]>(`${DASH_API}/journeys`),
    staleTime: 10_000,
  });

  const create = useMutation({
    mutationFn: async () => {
      const aid = Number(agentId);
      if (!Number.isFinite(aid) || aid <= 0) throw new Error("Pick an agent who will talk");
      const tpl = CALL_PLAN_TEMPLATES.find((t) => t.id === templateId) ?? CALL_PLAN_TEMPLATES[0]!;
      const planName = name.trim() || tpl.title;
      return customFetch<CallPlan>(`${DASH_API}/journeys`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId: aid,
          presetId: "custom",
          name: planName,
          description: tpl.blurb,
          trigger: { type: "manual" },
          steps: stepsForTemplate(templateId, aid),
          settings: {
            peopleSource: tpl.peopleHint,
            ...(tpl.runMode ? { runMode: tpl.runMode } : { runMode: "once" }),
          },
        }),
      });
    },
    onSuccess: (plan) => {
      qc.invalidateQueries({ queryKey: ["call-plans"] });
      setCreateOpen(false);
      setName("");
      setTemplateId("lead_followup");
      navigate(`/app/call-plans/${plan.id}`);
    },
    onError: (err) => {
      toast({ title: "Could not create plan", description: formatApiError(err), variant: "destructive" });
    },
  });

  const plans = plansQ.data ?? [];

  return (
    <StripePage
      title="Call plans"
      description="Who to reach, what happens next, then Start. Ordered steps — not a flowchart."
      back={{ href: "/app/home", label: "Home" }}
      actions={
        <Button
          className="h-9 gap-1.5"
          onClick={() => {
            if (agents.length === 0) {
              navigate("/app/agents?create=1");
              return;
            }
            if (!agentId && agents[0]) setAgentId(String(agents[0].id));
            setCreateOpen(true);
          }}
        >
          <Plus className="size-4" />
          New call plan
        </Button>
      }
    >
      {plansQ.isLoading ? (
        <div className="flex justify-center py-16 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : plans.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <ListOrdered className="mb-3 size-5 text-muted-foreground" />
          <p className="text-sm font-medium">No call plans yet</p>
          <p className="mt-1 max-w-sm text-[13px] text-muted-foreground">
            Four steps to your first run:
          </p>
          <ol className="mt-4 max-w-sm space-y-2 text-left">
            {[
              agents.length === 0 ? (
                <>
                  Create an agent —{" "}
                  <Link href="/app/agents?create=1" className="underline underline-offset-2 text-foreground/80 hover:text-foreground">
                    Agents
                  </Link>
                </>
              ) : (
                "Create an agent (you already have one)"
              ),
              "New call plan — pick a template",
              "Attach people (list, paste, or sheet)",
              "Start once",
            ].map((step, i) => (
              <li key={i} className="flex items-start gap-2.5 text-[12px] text-muted-foreground">
                <span className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border/60 bg-muted/30 text-[10px] font-semibold text-muted-foreground">
                  {i + 1}
                </span>
                <span className="leading-snug pt-0.5">{step}</span>
              </li>
            ))}
          </ol>
          <Button
            className="mt-5 gap-1.5"
            onClick={() => {
              if (agents.length === 0) {
                navigate("/app/agents?create=1");
                return;
              }
              if (!agentId && agents[0]) setAgentId(String(agents[0].id));
              setCreateOpen(true);
            }}
          >
            <Plus className="size-4" />
            {agents.length === 0 ? "Create an agent" : "Create call plan"}
          </Button>
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

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New call plan</DialogTitle>
            <DialogDescription>
              Pick a template, name it, and choose who talks. You’ll attach people next.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="space-y-1.5">
              <Label>Template</Label>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {CALL_PLAN_TEMPLATES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTemplateId(t.id)}
                    className={cn(
                      "rounded-lg border px-3 py-2.5 text-left transition-colors",
                      templateId === t.id
                        ? "border-primary/40 bg-primary/5"
                        : "border-border/50 hover:bg-muted/30",
                    )}
                  >
                    <p className="text-[12px] font-medium">{t.title}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5 leading-snug">{t.blurb}</p>
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="plan-name">Name</Label>
              <Input
                id="plan-name"
                placeholder="e.g. Follow up after form"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && create.mutate()}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Agent who talks</Label>
              <Select value={agentId || undefined} onValueChange={setAgentId}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Choose agent…" />
                </SelectTrigger>
                <SelectContent>
                  {agents.map((a) => (
                    <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={create.isPending}>Cancel</Button>
            <Button onClick={() => create.mutate()} disabled={create.isPending || !agentId}>
              {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </StripePage>
  );
}
