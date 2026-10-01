/**
 * Flows — visual automations (trigger → steps → branches). Backed by /api/journeys.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useParams } from "wouter";
import { Loader2, MoreHorizontal, Plus, Trash2 } from "lucide-react";
import { FlowsIcon } from "@workspace/brand-icons";
import { useListAgents, getListAgentsQueryKey } from "@workspace/api-client-react";
import { StripePage } from "@/components/stripe-page";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { errorMessage, flowsApi, type Flow } from "./api";
import { TRIGGER_LABEL } from "./nodes";
import FlowBuilderPage from "./builder";

export default function FlowsPage() {
  const params = useParams<{ id?: string }>();
  const id = params.id ? Number(params.id) : NaN;
  if (Number.isFinite(id) && id > 0) return <FlowBuilderPage key={id} flowId={id} />;
  return <FlowListPage />;
}

function timeAgo(iso: string | null): string {
  if (!iso) return "Never";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function FlowListPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const flowsQ = useQuery({ queryKey: ["flows"], queryFn: flowsApi.list });
  const agentsQ = useListAgents({ query: { queryKey: getListAgentsQueryKey(), staleTime: 30_000 } });
  const agents = useMemo(() => (Array.isArray(agentsQ.data) ? agentsQ.data : []), [agentsQ.data]);
  const [createOpen, setCreateOpen] = useState(false);
  const [toDelete, setToDelete] = useState<Flow | null>(null);

  const remove = useMutation({
    mutationFn: (id: number) => flowsApi.remove(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["flows"] });
      toast({ title: "Flow deleted" });
    },
    onError: (err) => toast({ title: "Couldn't delete", description: errorMessage(err), variant: "destructive" }),
  });

  const flows = flowsQ.data ?? [];
  const agentName = (id: number) => agents.find((a) => a.id === id)?.name || `Agent ${id}`;

  return (
    <StripePage
      title="Flows"
      description="Decide exactly what happens to every lead — calls, messages, waits and branches on one canvas."
      actions={
        <Button size="sm" className="h-8 gap-1.5" onClick={() => setCreateOpen(true)} disabled={agents.length === 0}>
          <Plus className="size-4" /> New flow
        </Button>
      }
    >
      {flowsQ.isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
      ) : agents.length === 0 && !agentsQ.isLoading ? (
        <EmptyState
          icon={<FlowsIcon className="size-5" />}
          title="Create an agent first"
          description="Flows call people with your agents."
          action={{ label: "Create agent", onClick: () => navigate("/app/agents?create=1") }}
        />
      ) : flows.length === 0 ? (
        <EmptyState
          icon={<FlowsIcon className="size-5" />}
          title="No flows yet"
          description="Start blank or from a template, then shape it on the canvas."
          action={{ label: "New flow", onClick: () => setCreateOpen(true) }}
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          {flows.map((f, i) => (
            <div
              key={f.id}
              className={cn("flex items-center gap-4 px-4 py-3 transition-colors hover:bg-muted/40", i > 0 && "border-t border-border")}
            >
              <Link href={`/app/flows/${f.id}`} className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{f.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {TRIGGER_LABEL[f.trigger.type] ?? f.trigger.type} · {f.steps.length} step{f.steps.length === 1 ? "" : "s"} · {agentName(f.agentId)}
                </p>
              </Link>
              <div className="hidden text-right sm:block">
                <p className="text-sm tabular-nums">{f.totalRuns}</p>
                <p className="text-[11px] text-muted-foreground">people · {timeAgo(f.lastRunAt)}</p>
              </div>
              <Badge
                variant="outline"
                className={cn(
                  "w-[64px] justify-center capitalize",
                  f.status === "active" && "border-emerald-500/40 text-emerald-700 dark:text-emerald-300",
                  f.status === "paused" && "border-amber-500/40 text-amber-700 dark:text-amber-300",
                )}
              >
                {f.status}
              </Badge>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="size-8"><MoreHorizontal className="size-4" /></Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => navigate(`/app/flows/${f.id}`)}>Open</DropdownMenuItem>
                  <DropdownMenuItem className="text-destructive" onClick={() => setToDelete(f)}>
                    <Trash2 className="mr-2 size-3.5" /> Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))}
        </div>
      )}

      <CreateFlowDialog open={createOpen} onOpenChange={setCreateOpen} agents={agents} onCreated={(f) => navigate(`/app/flows/${f.id}`)} />

      <AlertDialog open={!!toDelete} onOpenChange={(v) => !v && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{toDelete?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The flow and its run history are removed. Calls already placed stay in Call logs.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { if (toDelete) remove.mutate(toDelete.id); setToDelete(null); }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </StripePage>
  );
}

function CreateFlowDialog({ open, onOpenChange, agents, onCreated }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  agents: Array<{ id: number; name: string }>;
  onCreated: (f: Flow) => void;
}) {
  const { toast } = useToast();
  const presetsQ = useQuery({ queryKey: ["flow-presets"], queryFn: flowsApi.presets, enabled: open });
  const [name, setName] = useState("");
  const [agentId, setAgentId] = useState<string>("");
  const [presetId, setPresetId] = useState("custom");
  const effectiveAgent = agentId || (agents[0] ? String(agents[0].id) : "");

  const create = useMutation({
    mutationFn: () => flowsApi.create({
      agentId: Number(effectiveAgent),
      presetId,
      ...(name.trim() ? { name: name.trim() } : presetId === "custom" ? { name: "Untitled flow" } : {}),
      ...(presetId === "custom" ? { trigger: { type: "manual" as const, entryStepId: null }, steps: [] } : {}),
    }),
    onSuccess: (f) => {
      onOpenChange(false);
      setName("");
      setPresetId("custom");
      onCreated(f);
    },
    onError: (err) => toast({ title: "Couldn't create flow", description: errorMessage(err), variant: "destructive" }),
  });

  const options = [
    { id: "custom", label: "Blank canvas", hint: "Start from nothing" },
    ...(presetsQ.data ?? []).map((p) => ({ id: p.id, label: p.label, hint: p.firstContact })),
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New flow</DialogTitle>
          <DialogDescription>Templates are just a starting point — every step stays editable.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-2">
            {options.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => setPresetId(o.id)}
                className={cn(
                  "rounded-lg border px-3 py-2.5 text-left transition-colors",
                  presetId === o.id ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50",
                )}
              >
                <p className="text-[13px] font-medium">{o.label}</p>
                <p className="line-clamp-1 text-[11px] text-muted-foreground">{o.hint}</p>
              </button>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={presetId === "custom" ? "Untitled flow" : "Template name"} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Agent</Label>
              <Select value={effectiveAgent || undefined} onValueChange={setAgentId}>
                <SelectTrigger><SelectValue placeholder="Pick an agent" /></SelectTrigger>
                <SelectContent>
                  {agents.map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.name || `Agent ${a.id}`}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!effectiveAgent || create.isPending} onClick={() => create.mutate()}>
            {create.isPending && <Loader2 className="mr-1.5 size-4 animate-spin" />}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
