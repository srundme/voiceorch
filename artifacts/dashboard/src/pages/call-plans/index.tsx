/**
 * Call plans — list + create (compose wizard or Build with AI).
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
  Loader2, Plus, ListOrdered, Play, Pause, FileText, Sparkles, ChevronLeft, ChevronRight,
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
import {
  CALL_PLAN_TEMPLATES,
  stepsForTemplate,
  templatesForLeadSource,
  type CallPlanTemplateId,
} from "./step-editor";
import { LEAD_SOURCES, leadSourceById, type LeadSourceId } from "./lead-sources";
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

type WizardStep = 0 | 1 | 2 | 3;

const WIZARD_LABELS = ["Agent", "Leads", "Steps", "Name"];

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
  const [vibeOpen, setVibeOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState<WizardStep>(0);
  const [name, setName] = useState("");
  const [agentId, setAgentId] = useState<string>("");
  const [leadSource, setLeadSource] = useState<LeadSourceId>("list");
  const [templateId, setTemplateId] = useState<CallPlanTemplateId>("lead_followup");
  const [sheetRunMode, setSheetRunMode] = useState<"once" | "live">("live");

  const agentsQ = useListAgents({
    query: { queryKey: getListAgentsQueryKey(), staleTime: 30_000 },
  });
  const agents = (Array.isArray(agentsQ.data) ? agentsQ.data : []) as Array<{ id: number; name: string }>;

  const plansQ = useQuery({
    queryKey: ["call-plans"],
    queryFn: () => customFetch<CallPlan[]>(`${DASH_API}/journeys`),
    staleTime: 10_000,
  });

  function pickLeadSource(id: LeadSourceId) {
    setLeadSource(id);
    const src = leadSourceById(id);
    setTemplateId(src.defaultTemplate);
    if (id === "sheet") setSheetRunMode("live");
  }

  function resetCompose() {
    setWizardStep(0);
    setName("");
    setLeadSource("list");
    setTemplateId("lead_followup");
    setSheetRunMode("live");
  }

  function ensureAgentThen(open: "compose" | "vibe") {
    if (agents.length === 0) {
      navigate("/app/agents?create=1");
      return;
    }
    if (!agentId && agents[0]) setAgentId(String(agents[0].id));
    if (open === "vibe") {
      setVibeOpen(true);
      return;
    }
    resetCompose();
    setCreateOpen(true);
  }

  const create = useMutation({
    mutationFn: async () => {
      const aid = Number(agentId);
      if (!Number.isFinite(aid) || aid <= 0) throw new Error("Pick an agent who will talk");
      const src = leadSourceById(leadSource);
      const tpl = CALL_PLAN_TEMPLATES.find((t) => t.id === templateId) ?? CALL_PLAN_TEMPLATES[0]!;
      const planName = name.trim() || `${src.title} plan`;
      return customFetch<CallPlan>(`${DASH_API}/journeys`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId: aid,
          presetId: "custom",
          name: planName,
          description: `${src.blurb} · ${tpl.blurb}`,
          trigger: { type: src.triggerType },
          steps: stepsForTemplate(templateId, aid),
          settings: {
            peopleSource: src.peopleSource,
            runMode: src.id === "sheet" ? sheetRunMode : src.runMode,
            leadSource: src.id,
          },
        }),
      });
    },
    onSuccess: (plan) => {
      qc.invalidateQueries({ queryKey: ["call-plans"] });
      setCreateOpen(false);
      resetCompose();
      navigate(`/app/call-plans/${plan.id}`);
    },
    onError: (err) => {
      toast({ title: "Could not create plan", description: formatApiError(err), variant: "destructive" });
    },
  });

  const plans = plansQ.data ?? [];
  const selectedSource = leadSourceById(leadSource);
  const canNext =
    wizardStep === 0 ? Boolean(agentId)
      : wizardStep === 1 ? Boolean(leadSource)
        : wizardStep === 2 ? Boolean(templateId)
          : true;

  return (
    <StripePage
      title="Call plans"
      description="Agent → Call plan → Leads → Start queue."
      back={{ href: "/app/home", label: "Home" }}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" className="h-9 gap-1.5" onClick={() => ensureAgentThen("vibe")}>
            <Sparkles className="size-4" />
            Build with AI
          </Button>
          <Button className="h-9 gap-1.5" onClick={() => ensureAgentThen("compose")}>
            <Plus className="size-4" />
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
            Default path: create an agent, make a plan, attach leads, Start queue.
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
              "Compose a plan or Build with AI",
              "Attach leads (list, sheet, or paste)",
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
                <Button className="gap-1.5" onClick={() => ensureAgentThen("vibe")}>
                  <Sparkles className="size-4" />
                  Build with AI
                </Button>
                <Button variant="outline" className="gap-1.5" onClick={() => ensureAgentThen("compose")}>
                  <Plus className="size-4" />
                  Compose manually
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

      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open) resetCompose();
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Compose call plan</DialogTitle>
            <DialogDescription>
              Step {wizardStep + 1} of 4 — {WIZARD_LABELS[wizardStep]}
            </DialogDescription>
          </DialogHeader>

          <div className="flex gap-1 pb-1">
            {WIZARD_LABELS.map((label, i) => (
              <div key={label} className="min-w-0 flex-1">
                <div
                  className={cn(
                    "h-1 rounded-full",
                    i <= wizardStep ? "bg-foreground/80" : "bg-border",
                  )}
                />
                <p className={cn(
                  "mt-1.5 truncate text-[10px]",
                  i === wizardStep ? "font-medium text-foreground" : "text-muted-foreground",
                )}
                >
                  {label}
                </p>
              </div>
            ))}
          </div>

          <div className="min-h-[220px] space-y-3 py-1">
            {wizardStep === 0 && (
              <div className="space-y-1.5">
                <Label>Who talks on the phone?</Label>
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
                <p className="text-[11px] text-muted-foreground">
                  Need a new agent?{" "}
                  <Link href="/app/vibe" className="underline underline-offset-2">Build with Vibe</Link>
                </p>
              </div>
            )}

            {wizardStep === 1 && (
              <div className="space-y-1.5">
                <Label>Where do leads come from?</Label>
                <div className="grid gap-1.5">
                  {LEAD_SOURCES.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => pickLeadSource(s.id)}
                      className={cn(
                        "flex items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
                        leadSource === s.id
                          ? "border-primary/40 bg-primary/5"
                          : "border-border/50 hover:bg-muted/30",
                      )}
                    >
                      <span className="mt-0.5 text-muted-foreground">{s.icon}</span>
                      <span className="min-w-0">
                        <span className="block text-[12px] font-medium">{s.title}</span>
                        <span className="block text-[10px] text-muted-foreground mt-0.5 leading-snug">{s.blurb}</span>
                      </span>
                    </button>
                  ))}
                </div>
                {leadSource === "sheet" && (
                  <div className="grid gap-1.5 sm:grid-cols-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setSheetRunMode("once")}
                      className={cn(
                        "rounded-lg border px-3 py-2.5 text-left transition-colors",
                        sheetRunMode === "once"
                          ? "border-primary/40 bg-primary/5"
                          : "border-border/50 hover:bg-muted/30",
                      )}
                    >
                      <p className="text-[12px] font-medium">Drain this list</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">Queue today’s rows once</p>
                    </button>
                    <button
                      type="button"
                      onClick={() => setSheetRunMode("live")}
                      className={cn(
                        "rounded-lg border px-3 py-2.5 text-left transition-colors",
                        sheetRunMode === "live"
                          ? "border-primary/40 bg-primary/5"
                          : "border-border/50 hover:bg-muted/30",
                      )}
                    >
                      <p className="text-[12px] font-medium">Drip new rows</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">Keep watching the sheet</p>
                    </button>
                  </div>
                )}
              </div>
            )}

            {wizardStep === 2 && (
              <div className="space-y-1.5">
                <Label>What happens next?</Label>
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {templatesForLeadSource(leadSource).map((t) => (
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
                {(selectedSource.triggerType === "form_lead" || selectedSource.triggerType === "instagram_lead") && (
                  <p className="text-[11px] text-muted-foreground">
                    After create, finish the{" "}
                    <Link
                      href={selectedSource.triggerType === "form_lead" ? "/app/connections?setup=website" : "/app/connections?setup=meta"}
                      className="underline underline-offset-2"
                    >
                      {selectedSource.triggerType === "form_lead" ? "Website" : "Meta"}
                    </Link>
                    {" "}connection if needed.
                  </p>
                )}
              </div>
            )}

            {wizardStep === 3 && (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="plan-name">Plan name</Label>
                  <Input
                    id="plan-name"
                    placeholder={`e.g. ${selectedSource.title}`}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && create.mutate()}
                  />
                </div>
                <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5 text-[11px] text-muted-foreground space-y-1">
                  <p>
                    <span className="font-medium text-foreground">Agent:</span>{" "}
                    {agents.find((a) => String(a.id) === agentId)?.name ?? "—"}
                  </p>
                  <p>
                    <span className="font-medium text-foreground">Leads:</span> {selectedSource.title}
                    {leadSource === "sheet"
                      ? ` · ${sheetRunMode === "live" ? "Drip" : "Drain"}`
                      : ""}
                  </p>
                  <p>
                    <span className="font-medium text-foreground">Steps:</span>{" "}
                    {CALL_PLAN_TEMPLATES.find((t) => t.id === templateId)?.title}
                  </p>
                  <p className="pt-1">Next: attach leads on the plan, then Start queue.</p>
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 sm:justify-between">
            <Button
              variant="ghost"
              className="gap-1"
              disabled={wizardStep === 0 || create.isPending}
              onClick={() => setWizardStep((s) => Math.max(0, s - 1) as WizardStep)}
            >
              <ChevronLeft className="size-4" />
              Back
            </Button>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={create.isPending}>
                Cancel
              </Button>
              {wizardStep < 3 ? (
                <Button
                  className="gap-1"
                  disabled={!canNext}
                  onClick={() => setWizardStep((s) => Math.min(3, s + 1) as WizardStep)}
                >
                  Next
                  <ChevronRight className="size-4" />
                </Button>
              ) : (
                <Button onClick={() => create.mutate()} disabled={create.isPending || !agentId}>
                  {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create plan"}
                </Button>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PlanVibeDialog
        open={vibeOpen}
        onOpenChange={setVibeOpen}
        agents={agents}
        defaultAgentId={agentId || (agents[0] ? String(agents[0].id) : undefined)}
        onCreated={(plan) => {
          qc.invalidateQueries({ queryKey: ["call-plans"] });
          navigate(`/app/call-plans/${plan.id}`);
        }}
      />
    </StripePage>
  );
}
