import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ChevronLeft, LayoutGrid, Loader2, Pause, Play, Rocket, Save, Users } from "lucide-react";
import { useListAgents, getListAgentsQueryKey } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/components/theme-provider";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { errorMessage, flowsApi, newStepId, type Flow, type FlowSettings, type FlowStep, type FlowTrigger, type StepType } from "./api";
import { STEP_META, nodeTypes, stepSummary, type StepNodeData, type TriggerNodeData } from "./nodes";
import { TRIGGER_NODE_ID, autoLayout, buildEdges, needsLayout, pointersOf, removeStep, setPointer } from "./graph";
import { FlowSettingsPanel, StepInspector, TriggerInspector } from "./inspector";
import { RunOnPeopleDialog, RunsSheet, TestRunDialog } from "./run-panels";

type Draft = {
  name: string;
  agentId: number;
  settings: FlowSettings;
  trigger: FlowTrigger;
  steps: FlowStep[];
};

type Selection = { kind: "trigger" } | { kind: "step"; id: string } | null;

const PALETTE: StepType[] = [
  "make_call", "send_whatsapp", "send_email", "send_webhook", "update_sheet", "schedule_callback", "join_meeting",
  "delay", "condition", "branch",
];

function draftFromFlow(f: Flow): Draft {
  const g = needsLayout(f.flow.steps) ? autoLayout(f.flow.trigger, f.flow.steps) : f.flow;
  return { name: f.name, agentId: f.agentId, settings: f.settings ?? {}, trigger: g.trigger, steps: g.steps };
}

function defaultStep(type: StepType, agentId: number): FlowStep {
  const base: FlowStep = { id: newStepId(type), type, next: null };
  switch (type) {
    case "make_call": return { ...base, agentId, phoneField: "phone" };
    case "delay": return { ...base, delaySeconds: 86400 };
    case "condition": return { ...base, field: "call.connected", op: "eq", value: "true", onTrue: null, onFalse: null };
    case "branch": return { ...base, cases: [] };
    case "schedule_callback": return { ...base, agentId, phoneField: "phone", callbackDelayDays: 1 };
    case "send_whatsapp": return { ...base, agentId, phoneField: "phone", whatsappHint: "call_summary" };
    case "send_email": return { ...base, emailField: "email" };
    case "update_sheet": return { ...base, sheetStatusColumn: "Status" };
    default: return base;
  }
}

export default function FlowBuilderPage({ flowId }: { flowId: number }) {
  return (
    <ReactFlowProvider>
      <Builder flowId={flowId} />
    </ReactFlowProvider>
  );
}

function Builder({ flowId }: { flowId: number }) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { theme } = useTheme();
  const qc = useQueryClient();

  const flowQ = useQuery({ queryKey: ["flow", flowId], queryFn: () => flowsApi.get(flowId) });
  const agentsQ = useListAgents({ query: { queryKey: getListAgentsQueryKey(), staleTime: 30_000 } });
  const agents = useMemo(() => (Array.isArray(agentsQ.data) ? agentsQ.data : []), [agentsQ.data]);
  const flow = flowQ.data;

  const statsQ = useQuery({
    queryKey: ["flow-step-stats", flowId],
    queryFn: () => flowsApi.stepStats(flowId),
    enabled: !!flow,
    refetchInterval: flow?.status === "active" ? 10_000 : false,
  });

  const [draft, setDraft] = useState<Draft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [selection, setSelection] = useState<Selection>(null);
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [testOpen, setTestOpen] = useState(false);
  const [runOpen, setRunOpen] = useState(false);
  const [runsOpen, setRunsOpen] = useState(false);

  // Seed the draft once per load; later refetches must not clobber edits.
  const seededFor = useRef<string | null>(null);
  useEffect(() => {
    if (!flow) return;
    const key = `${flow.id}`;
    if (seededFor.current === key) return;
    seededFor.current = key;
    setDraft(draftFromFlow(flow));
  }, [flow]);

  const edit = useCallback((fn: (d: Draft) => Draft) => {
    setDraft((d) => (d ? fn(d) : d));
    setDirty(true);
  }, []);

  const agentName = useCallback(
    (id?: number) => agents.find((a) => a.id === id)?.name || (id ? `Agent ${id}` : "agent"),
    [agents],
  );

  const issuesByStep = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const i of flow?.validation.issues ?? []) {
      if (i.stepId) m.set(i.stepId, [...(m.get(i.stepId) ?? []), i.message]);
    }
    return m;
  }, [flow?.validation.issues]);

  // ── Nodes (kept in state so React Flow can store measured sizes) ─────────
  const [nodes, setNodes] = useState<Node[]>([]);
  useEffect(() => {
    if (!draft) return;
    const counts = statsQ.data?.steps ?? {};
    const built: Node[] = [
      {
        id: TRIGGER_NODE_ID,
        type: "trigger",
        position: draft.trigger.position ?? { x: 0, y: 0 },
        deletable: false,
        data: { trigger: draft.trigger, connected: !!draft.trigger.entryStepId } satisfies TriggerNodeData,
      },
      ...draft.steps.map((s): Node => ({
        id: s.id,
        type: "step",
        position: s.position ?? { x: 0, y: 0 },
        data: {
          step: s,
          summary: stepSummary(s, agentName),
          issues: dirty ? [] : issuesByStep.get(s.id) ?? [],
          counts: counts[s.id],
          isEntry: draft.trigger.entryStepId === s.id,
        } satisfies StepNodeData,
      })),
    ];
    setNodes((prev) => {
      const byId = new Map(prev.map((n) => [n.id, n]));
      return built.map((n) => {
        const p = byId.get(n.id);
        if (!p) return n;
        return { ...p, data: n.data, position: p.dragging ? p.position : n.position };
      });
    });
  }, [draft, statsQ.data, issuesByStep, agentName, dirty]);

  const edges: Edge[] = useMemo(() => {
    if (!draft) return [];
    const counts = statsQ.data?.steps ?? {};
    return buildEdges(draft.trigger, draft.steps, (id, reason) => counts[id]?.paths[reason]).map((e) => ({
      ...e,
      selected: e.id === selectedEdge,
    }));
  }, [draft, statsQ.data, selectedEdge]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes((nds) => applyNodeChanges(changes, nds));
  }, []);

  const onNodeDragStop = useCallback((_: unknown, node: Node) => {
    edit((d) => node.id === TRIGGER_NODE_ID
      ? { ...d, trigger: { ...d.trigger, position: node.position } }
      : { ...d, steps: d.steps.map((s) => (s.id === node.id ? { ...s, position: node.position } : s)) });
  }, [edit]);

  const onConnect = useCallback((c: Connection) => {
    if (!c.source || !c.target || c.target === TRIGGER_NODE_ID || c.source === c.target) return;
    edit((d) => c.source === TRIGGER_NODE_ID
      ? { ...d, trigger: { ...d.trigger, entryStepId: c.target } }
      : { ...d, steps: d.steps.map((s) => (s.id === c.source ? setPointer(s, c.sourceHandle ?? "next", c.target) : s)) });
  }, [edit]);

  const onEdgesDelete = useCallback((removed: Edge[]) => {
    edit((d) => {
      let next = d;
      for (const e of removed) {
        next = e.source === TRIGGER_NODE_ID
          ? { ...next, trigger: { ...next.trigger, entryStepId: null } }
          : { ...next, steps: next.steps.map((s) => (s.id === e.source ? setPointer(s, e.sourceHandle ?? "next", null) : s)) };
      }
      return next;
    });
    setSelectedEdge(null);
  }, [edit]);

  const deleteStep = useCallback((id: string) => {
    edit((d) => ({ ...d, ...removeStep(d.trigger, d.steps, id) }));
    setSelection(null);
  }, [edit]);

  const onNodesDelete = useCallback((removed: Node[]) => {
    for (const n of removed) if (n.id !== TRIGGER_NODE_ID) deleteStep(n.id);
  }, [deleteStep]);

  /** Add a step under the selected node and wire it in when that output is free. */
  const addStep = (type: StepType) => {
    if (!draft) return;
    const step = defaultStep(type, draft.agentId);
    const anchorId = selection?.kind === "step" ? selection.id : selection?.kind === "trigger" ? TRIGGER_NODE_ID : null;
    const anchor = nodes.find((n) => n.id === anchorId);
    const lowest = nodes.reduce((m, n) => Math.max(m, n.position.y), 0);
    step.position = anchor
      ? { x: anchor.position.x, y: anchor.position.y + 170 }
      : { x: 0, y: lowest + 170 };
    edit((d) => {
      let trigger = d.trigger;
      let steps = d.steps;
      if (!trigger.entryStepId && (anchorId === TRIGGER_NODE_ID || steps.length === 0)) {
        trigger = { ...trigger, entryStepId: step.id };
      } else if (anchorId && anchorId !== TRIGGER_NODE_ID) {
        steps = steps.map((s) => {
          if (s.id !== anchorId) return s;
          const free = pointersOf(s).find((p) => !p.target);
          return free ? setPointer(s, free.handle, step.id) : s;
        });
      }
      return { ...d, trigger, steps: [...steps, step] };
    });
    setSelection({ kind: "step", id: step.id });
  };

  // ── Save / activate ───────────────────────────────────────────────────────
  const save = useMutation({
    mutationFn: (d: Draft) => flowsApi.update(flowId, {
      name: d.name.trim() || "Untitled flow",
      agentId: d.agentId,
      settings: d.settings,
      trigger: d.trigger,
      steps: d.steps,
    }),
    onSuccess: (f) => {
      qc.setQueryData(["flow", flowId], f);
      void qc.invalidateQueries({ queryKey: ["flows"] });
      setDirty(false);
    },
  });

  const saveNow = async (): Promise<Flow | null> => {
    if (!draft) return null;
    try {
      const f = await save.mutateAsync(draft);
      return f;
    } catch (err) {
      toast({ title: "Couldn't save", description: errorMessage(err), variant: "destructive" });
      return null;
    }
  };

  const toggleActive = useMutation({
    mutationFn: async () => {
      if (dirty) {
        const saved = await saveNow();
        if (!saved) throw new Error("Save failed");
      }
      return flow?.status === "active" ? flowsApi.pause(flowId) : flowsApi.activate(flowId);
    },
    onSuccess: (f) => {
      qc.setQueryData(["flow", flowId], f);
      void qc.invalidateQueries({ queryKey: ["flows"] });
      toast({ title: f.status === "active" ? "Flow is live" : "Flow paused" });
    },
    onError: (err) => {
      if (err instanceof Error && err.message === "Save failed") return;
      toast({ title: "Couldn't change status", description: errorMessage(err), variant: "destructive" });
    },
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (dirty) void saveNow();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const ensureSavedThen = async (open: () => void) => {
    if (dirty && !(await saveNow())) return;
    open();
  };

  if (flowQ.isLoading || !draft) {
    return (
      <div className="flex h-full min-h-[60vh] items-center justify-center text-muted-foreground">
        {flowQ.isError ? <p className="text-sm">Flow not found.</p> : <Loader2 className="size-5 animate-spin" />}
      </div>
    );
  }

  const selectedStep = selection?.kind === "step" ? draft.steps.find((s) => s.id === selection.id) : undefined;
  const status = flow?.status ?? "draft";

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
        <Button variant="ghost" size="sm" className="h-8 gap-1 px-2 text-xs" onClick={() => navigate("/app/flows")}>
          <ChevronLeft className="size-4" /> Flows
        </Button>
        <input
          className="min-w-[160px] flex-1 truncate rounded-md bg-transparent px-1.5 py-1 text-[15px] font-semibold outline-none hover:bg-muted/60 focus:bg-muted/60"
          value={draft.name}
          onChange={(e) => edit((d) => ({ ...d, name: e.target.value }))}
          aria-label="Flow name"
        />
        <Badge
          variant="outline"
          className={cn(
            "capitalize",
            status === "active" && "border-emerald-500/40 text-emerald-700 dark:text-emerald-300",
            status === "paused" && "border-amber-500/40 text-amber-700 dark:text-amber-300",
          )}
        >
          {status}
        </Badge>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setRunsOpen(true)}>
            <Users className="size-3.5" /> People
          </Button>
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => void ensureSavedThen(() => setTestOpen(true))}>
            <Play className="size-3.5" /> Test
          </Button>
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => void ensureSavedThen(() => setRunOpen(true))}>
            <Rocket className="size-3.5" /> Run on people
          </Button>
          <Button
            variant={dirty ? "default" : "outline"}
            size="sm"
            className="h-8 gap-1.5 text-xs"
            disabled={!dirty || save.isPending}
            onClick={() => void saveNow()}
          >
            {save.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
            {dirty ? "Save" : "Saved"}
          </Button>
          <Button
            size="sm"
            variant={status === "active" ? "outline" : "default"}
            className="h-8 gap-1.5 text-xs"
            disabled={toggleActive.isPending}
            onClick={() => toggleActive.mutate()}
          >
            {toggleActive.isPending
              ? <Loader2 className="size-3.5 animate-spin" />
              : status === "active" ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
            {status === "active" ? "Pause" : "Activate"}
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-[200px] shrink-0 overflow-y-auto border-r border-border p-3 md:block">
          {(["action", "logic"] as const).map((group) => (
            <div key={group} className="mb-4">
              <p className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {group === "action" ? "Actions" : "Logic"}
              </p>
              {PALETTE.filter((t) => STEP_META[t].group === group).map((t) => {
                const m = STEP_META[t];
                const Icon = m.icon;
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => addStep(t)}
                    className="flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-[12px] font-medium transition-colors hover:bg-muted"
                    title={m.hint}
                  >
                    <span className={cn("flex size-6 items-center justify-center rounded-md", m.tone)}><Icon className="size-3.5" /></span>
                    {m.label}
                  </button>
                );
              })}
            </div>
          ))}
          <p className="px-1 text-[11px] leading-snug text-muted-foreground">
            Click to add under the selected step. Drag from a dot to connect. Select and press Delete to remove.
          </p>
        </aside>

        <div className="relative min-w-0 flex-1">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onNodeDragStop={onNodeDragStop}
            onNodesDelete={onNodesDelete}
            onEdgesDelete={onEdgesDelete}
            onConnect={onConnect}
            onNodeClick={(_, n) => {
              setSelectedEdge(null);
              setSelection(n.id === TRIGGER_NODE_ID ? { kind: "trigger" } : { kind: "step", id: n.id });
            }}
            onEdgeClick={(_, e) => setSelectedEdge(e.id)}
            onPaneClick={() => { setSelection(null); setSelectedEdge(null); }}
            deleteKeyCode={["Backspace", "Delete"]}
            colorMode={theme}
            fitView
            fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
            minZoom={0.2}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={20} size={1} />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable className="!hidden lg:!block" />
          </ReactFlow>
          <Button
            variant="outline"
            size="sm"
            className="absolute right-3 top-3 h-7 gap-1.5 bg-background text-xs"
            onClick={() => edit((d) => ({ ...d, ...autoLayout(d.trigger, d.steps) }))}
          >
            <LayoutGrid className="size-3.5" /> Tidy up
          </Button>
        </div>

        <aside className="w-[320px] shrink-0 overflow-y-auto border-l border-border p-4">
          {selectedStep ? (
            <StepInspector
              key={selectedStep.id}
              step={selectedStep}
              steps={draft.steps}
              agents={agents}
              issues={dirty ? [] : (flow?.validation.issues ?? []).filter((i) => i.stepId === selectedStep.id)}
              onChange={(s) => edit((d) => ({ ...d, steps: d.steps.map((x) => (x.id === s.id ? s : x)) }))}
              onDelete={() => deleteStep(selectedStep.id)}
            />
          ) : selection?.kind === "trigger" ? (
            <TriggerInspector
              trigger={draft.trigger}
              hookUrl={flow?.hookUrl ?? null}
              onChange={(t) => edit((d) => ({ ...d, trigger: t }))}
            />
          ) : (
            <FlowSettingsPanel
              name={draft.name}
              agentId={draft.agentId}
              settings={draft.settings}
              agents={agents}
              issues={dirty ? [] : flow?.validation.issues ?? []}
              errors={dirty ? [] : flow?.validation.errors ?? []}
              steps={draft.steps}
              onChange={(p) => edit((d) => ({ ...d, ...p }))}
              onSelectStep={(id) => setSelection({ kind: "step", id })}
            />
          )}
          {dirty && (
            <p className="mt-4 text-[11px] text-muted-foreground">Unsaved changes — save to re-check the flow.</p>
          )}
        </aside>
      </div>

      <TestRunDialog
        open={testOpen}
        onOpenChange={setTestOpen}
        flowId={flowId}
        onStarted={() => { setRunsOpen(true); void statsQ.refetch(); }}
      />
      <RunOnPeopleDialog
        open={runOpen}
        onOpenChange={setRunOpen}
        flowId={flowId}
        settings={flow?.settings ?? {}}
        onStarted={() => {
          void qc.invalidateQueries({ queryKey: ["flow", flowId] });
          setRunsOpen(true);
          void statsQ.refetch();
        }}
      />
      <RunsSheet open={runsOpen} onOpenChange={setRunsOpen} flowId={flowId} steps={flow?.steps ?? []} />
    </div>
  );
}
