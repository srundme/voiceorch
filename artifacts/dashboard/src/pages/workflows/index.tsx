import { useLocation } from "wouter";
import { Workflow as WorkflowIcon, Plus, Zap, FileInput, Instagram, Sheet, Hand, Trash2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  useWorkflows, useDeleteWorkflow, useSetWorkflowStatus,
  type Workflow, type WorkflowTriggerType,
} from "./api";

const TRIGGER_META: Record<WorkflowTriggerType, { label: string; icon: React.ElementType }> = {
  form_lead: { label: "Website / form lead", icon: FileInput },
  instagram_lead: { label: "Instagram lead", icon: Instagram },
  sheet_row: { label: "New Google Sheet row", icon: Sheet },
  manual: { label: "Manual", icon: Hand },
};

const STATUS_STYLE: Record<string, string> = {
  active: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30",
  paused: "bg-amber-500/15 text-amber-600 border-amber-500/30",
  draft: "bg-muted text-muted-foreground border-border",
};

function WorkflowCard({ wf }: { wf: Workflow }) {
  const [, navigate] = useLocation();
  const del = useDeleteWorkflow();
  const setStatus = useSetWorkflowStatus();
  const { toast } = useToast();
  const meta = TRIGGER_META[wf.trigger?.type] ?? TRIGGER_META.manual;
  const TriggerIcon = meta.icon;

  return (
    <div
      onClick={() => navigate(`/app/workflows/${wf.id}`)}
      className="group cursor-pointer rounded-xl border border-border bg-card p-5 transition-all hover:border-primary/40 hover:shadow-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold text-foreground truncate">{wf.name}</h3>
          {wf.description && <p className="mt-0.5 text-sm text-muted-foreground line-clamp-2">{wf.description}</p>}
        </div>
        <Badge variant="outline" className={STATUS_STYLE[wf.status] ?? STATUS_STYLE.draft}>{wf.status}</Badge>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-1">
          <TriggerIcon size={13} /> {meta.label}
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-1">
          <Zap size={13} /> {wf.steps?.length ?? 0} step{(wf.steps?.length ?? 0) === 1 ? "" : "s"}
        </span>
        <span className="rounded-md bg-muted px-2 py-1">{wf.totalRuns} run{wf.totalRuns === 1 ? "" : "s"}</span>
      </div>

      <div className="mt-4 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
        {wf.status === "active" ? (
          <Button size="sm" variant="outline" disabled={setStatus.isPending}
            onClick={() => setStatus.mutate({ id: wf.id, action: "pause" })}>
            Pause
          </Button>
        ) : (
          <Button size="sm" variant="outline" disabled={setStatus.isPending}
            onClick={() => setStatus.mutate({ id: wf.id, action: "activate" }, {
              onError: (e) => toast({ title: "Couldn't activate", description: String((e as Error).message), variant: "destructive" }),
            })}>
            Activate
          </Button>
        )}
        <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive ml-auto"
          disabled={del.isPending}
          onClick={() => {
            if (confirm(`Delete workflow "${wf.name}"?`)) del.mutate(wf.id);
          }}>
          <Trash2 size={15} />
        </Button>
      </div>
    </div>
  );
}

export default function WorkflowsPage() {
  const [, navigate] = useLocation();
  const { data: workflows, isLoading } = useWorkflows();

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-foreground">
            <WorkflowIcon className="text-primary" /> Workflows
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Describe an automation in plain language — SnapServe wires the calls, data, and Google Sheets for you.
          </p>
        </div>
        <Button onClick={() => navigate("/app/workflows/new")} className="w-full sm:w-auto">
          <Plus size={16} className="mr-1.5" /> New workflow
        </Button>
      </div>

      {isLoading ? (
        <div className="mt-16 flex justify-center"><Loader2 className="animate-spin text-muted-foreground" /></div>
      ) : (workflows?.length ?? 0) === 0 ? (
        <div className="mt-12 rounded-2xl border border-dashed border-border p-10 text-center">
          <WorkflowIcon className="mx-auto mb-3 text-muted-foreground/60" size={40} />
          <h2 className="text-lg font-semibold text-foreground">No workflows yet</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Example: “When a lead comes in from my website form, call them with my Sales agent and
            save the result to my Google Sheet.”
          </p>
          <Button className="mt-5" onClick={() => navigate("/app/workflows/new")}>
            <Plus size={16} className="mr-1.5" /> Build your first workflow
          </Button>
        </div>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {workflows!.map((wf) => <WorkflowCard key={wf.id} wf={wf} />)}
        </div>
      )}
    </div>
  );
}
