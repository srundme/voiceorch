import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation, useParams } from "wouter";
import { customFetch, useListAgents } from "@workspace/api-client-react";
import { AppPageHeader } from "@/components/app-page-header";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  UsersRound, Plus, ArrowLeft, Play, Phone, Zap, Trash2, Link2, Loader2,
} from "lucide-react";

const API = "/api";

type SquadMember = {
  id?: number;
  agentId: number;
  agentName?: string | null;
  roleName: string;
  roleType: "supervisor" | "specialist";
  instructions?: string | null;
  handoffEnabled: boolean;
  sortOrder: number;
};

type Squad = {
  id: number;
  name: string;
  description: string | null;
  status: string;
  supervisorAgentId: number | null;
  entryMemberId: number | null;
  limits: Record<string, number>;
  handoffGreeting: string | null;
  members: SquadMember[];
  connections: {
    phoneNumbers: Array<{ id: number; number: string }>;
    campaigns: Array<{ id: number; name: string; agentId: number | null }>;
  };
  createdAt: string;
  updatedAt: string;
};

type SquadRun = {
  id: number;
  kind: string;
  status: string;
  goal: string;
  triggeredBy: string;
  activeMemberId: number | null;
  activeCallId: number | null;
  finalResult: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

type SquadRunDetail = SquadRun & {
  context: Record<string, unknown>;
  steps: Array<{
    id: number;
    stepIndex: number;
    type: string;
    status: string;
    memberId: number | null;
    input: Record<string, unknown>;
    output: Record<string, unknown>;
    error: string | null;
  }>;
  events: Array<{
    id: number;
    type: string;
    message: string | null;
    payload: Record<string, unknown> | null;
    createdAt: string;
  }>;
};

function statusColor(status: string) {
  if (status === "active" || status === "completed" || status === "running" || status === "live_call") {
    return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300";
  }
  if (status === "failed" || status === "cancelled") {
    return "bg-red-500/15 text-red-700 dark:text-red-300";
  }
  if (status === "awaiting_approval" || status === "waiting_call") {
    return "bg-amber-500/15 text-amber-700 dark:text-amber-300";
  }
  return "bg-muted text-muted-foreground";
}

export default function SquadsPage() {
  const params = useParams<{ id?: string }>();
  const [, setLocation] = useLocation();
  const id = params.id ? parseInt(params.id, 10) : null;

  if (id && Number.isFinite(id)) {
    return <SquadDetailPage squadId={id} onBack={() => setLocation("/app/squads")} />;
  }
  return <SquadListPage onOpen={(sid) => setLocation(`/app/squads/${sid}`)} />;
}

function SquadListPage({ onOpen }: { onOpen: (id: number) => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);

  const { data: squads = [], isLoading } = useQuery({
    queryKey: ["squads"],
    queryFn: () => customFetch<Squad[]>(`${API}/squads`),
  });

  const { data: templates = [] } = useQuery({
    queryKey: ["squad-templates"],
    queryFn: () => customFetch<Array<{ id: string; name: string; description: string; roles: string[] }>>(
      `${API}/squads/templates`,
    ),
  });

  const { data: agentsData } = useListAgents();
  const agents = agentsData ?? [];

  const createMut = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      customFetch<Squad>(`${API}/squads`, { method: "POST", body: JSON.stringify(body) }),
    onSuccess: (s) => {
      void qc.invalidateQueries({ queryKey: ["squads"] });
      setCreateOpen(false);
      toast({ title: "Squad created" });
      onOpen(s.id);
    },
    onError: (err: Error) => toast({ title: "Create failed", description: err.message, variant: "destructive" }),
  });

  return (
    <div className="flex flex-col h-full">
      <AppPageHeader
        title="Squads"
        description="Teams of agents for task orchestration and live warm handoffs. Connect to inbound numbers and campaigns."
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="w-4 h-4 mr-1.5" /> New Squad
          </Button>
        }
      />

      <div className="px-6 pb-8 space-y-6 overflow-auto">
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-12 justify-center">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading squads…
          </div>
        ) : squads.length === 0 ? (
          <EmptyState
            icon={<UsersRound className="w-6 h-6" />}
            title="No squads yet"
            description="Create a squad with a supervisor and specialists, then attach it to a phone number or campaign."
            action={{
              label: "Create squad",
              onClick: () => setCreateOpen(true),
              icon: <Plus className="w-4 h-4" />,
            }}
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {squads.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => onOpen(s.id)}
                className="text-left rounded-xl border border-border/60 bg-card/40 p-4 hover:border-foreground/20 transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="font-medium text-sm">{s.name}</h3>
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                      {s.description || `${s.members.length} members`}
                    </p>
                  </div>
                  <Badge className={statusColor(s.status)} variant="secondary">{s.status}</Badge>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {s.members.slice(0, 4).map((m, i) => (
                    <span key={i} className="text-[11px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                      {m.roleName}
                    </span>
                  ))}
                </div>
                <div className="mt-3 flex gap-3 text-[11px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <Phone className="w-3 h-3" /> {s.connections.phoneNumbers.length}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Zap className="w-3 h-3" /> {s.connections.campaigns.length}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}

        {templates.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold mb-2">Starter templates</h2>
            <div className="grid gap-2 sm:grid-cols-2">
              {templates.map((t) => (
                <div key={t.id} className="rounded-lg border border-border/50 p-3">
                  <p className="text-sm font-medium">{t.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{t.description}</p>
                  <p className="text-[11px] text-muted-foreground mt-2">{t.roles.join(" → ")}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <CreateSquadDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        agents={agents.map((a) => ({ id: a.id, name: a.name }))}
        onSubmit={(body) => createMut.mutate(body)}
        saving={createMut.isPending}
      />
    </div>
  );
}

function CreateSquadDialog({
  open,
  onOpenChange,
  agents,
  onSubmit,
  saving,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  agents: Array<{ id: number; name: string }>;
  onSubmit: (body: Record<string, unknown>) => void;
  saving: boolean;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [supervisorId, setSupervisorId] = useState<string>("");
  const [specialistId, setSpecialistId] = useState<string>("");

  const canSave = name.trim() && supervisorId && specialistId && supervisorId !== specialistId;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New Squad</DialogTitle>
          <DialogDescription>
            Pick a supervisor and at least one specialist. You can add more members on the next screen.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Lead qualification team" />
          </div>
          <div>
            <Label>Description</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </div>
          <div>
            <Label>Supervisor agent</Label>
            <Select value={supervisorId} onValueChange={setSupervisorId}>
              <SelectTrigger><SelectValue placeholder="Select agent" /></SelectTrigger>
              <SelectContent>
                {agents.map((a) => (
                  <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Specialist agent</Label>
            <Select value={specialistId} onValueChange={setSpecialistId}>
              <SelectTrigger><SelectValue placeholder="Select agent" /></SelectTrigger>
              <SelectContent>
                {agents.map((a) => (
                  <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={!canSave || saving}
            onClick={() => {
              const sid = parseInt(supervisorId, 10);
              const spid = parseInt(specialistId, 10);
              onSubmit({
                name: name.trim(),
                description: description.trim() || null,
                supervisorAgentId: sid,
                status: "active",
                members: [
                  { agentId: sid, roleName: "Supervisor", roleType: "supervisor", handoffEnabled: false, sortOrder: 0 },
                  { agentId: spid, roleName: "Specialist", roleType: "specialist", handoffEnabled: true, sortOrder: 1 },
                ],
              });
            }}
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SquadDetailPage({ squadId, onBack }: { squadId: number; onBack: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [goal, setGoal] = useState("");
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);
  const [connectPhoneId, setConnectPhoneId] = useState("");
  const [connectCampaignId, setConnectCampaignId] = useState("");

  const { data: squad, isLoading } = useQuery({
    queryKey: ["squad", squadId],
    queryFn: () => customFetch<Squad>(`${API}/squads/${squadId}`),
  });

  const { data: runs = [] } = useQuery({
    queryKey: ["squad-runs", squadId],
    queryFn: () => customFetch<SquadRun[]>(`${API}/squads/${squadId}/runs`),
    refetchInterval: 4000,
  });

  const { data: runDetail } = useQuery({
    queryKey: ["squad-run", selectedRunId],
    queryFn: () => customFetch<SquadRunDetail>(`${API}/squad-runs/${selectedRunId}`),
    enabled: selectedRunId != null,
    refetchInterval: 3000,
  });

  const { data: phones = [] } = useQuery({
    queryKey: ["phone-numbers"],
    queryFn: () => customFetch<Array<{ id: number; number: string; squadId?: number | null }>>(`${API}/phone-numbers`),
  });

  const { data: campaigns = [] } = useQuery({
    queryKey: ["campaigns-lite"],
    queryFn: async () => {
      const rows = await customFetch<Array<{ id: number; name: string }>>(`${API}/campaigns`);
      return rows;
    },
  });

  const startRun = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      customFetch<{ runId: number }>(`${API}/squads/${squadId}/runs`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ["squad-runs", squadId] });
      setSelectedRunId(r.runId);
      toast({ title: "Run started" });
    },
    onError: (err: Error) => toast({ title: "Run failed", description: err.message, variant: "destructive" }),
  });

  const connectMut = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      customFetch<Squad>(`${API}/squads/${squadId}/connect`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["squad", squadId] });
      toast({ title: "Connected" });
    },
    onError: (err: Error) => toast({ title: "Connect failed", description: err.message, variant: "destructive" }),
  });

  const approveMut = useMutation({
    mutationFn: (body: { stepId: number; approved: boolean }) =>
      customFetch(`${API}/squad-runs/${selectedRunId}/approve`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["squad-run", selectedRunId] });
      toast({ title: "Updated" });
    },
  });

  const deleteMut = useMutation({
    mutationFn: () => customFetch(`${API}/squads/${squadId}`, { method: "DELETE" }),
    onSuccess: () => {
      toast({ title: "Squad deleted" });
      onBack();
    },
  });

  const waitingStep = useMemo(
    () => runDetail?.steps.find((s) => s.status === "waiting"),
    [runDetail],
  );

  if (isLoading || !squad) {
    return (
      <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 pt-4 pb-2">
        <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2 mb-2">
          <ArrowLeft className="w-4 h-4 mr-1" /> Squads
        </Button>
        <AppPageHeader
          title={squad.name}
          description={squad.description || "Squad builder"}
          actions={
            <div className="flex gap-2">
              <Badge className={statusColor(squad.status)} variant="secondary">{squad.status}</Badge>
              <Button variant="outline" size="sm" onClick={() => deleteMut.mutate()}>
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          }
        />
      </div>

      <div className="px-6 pb-10 grid gap-6 lg:grid-cols-2 overflow-auto">
        <section className="space-y-4">
          <h2 className="text-sm font-semibold">Members</h2>
          <div className="space-y-2">
            {squad.members.map((m) => (
              <div key={m.id ?? m.agentId} className="rounded-lg border border-border/60 p-3">
                <div className="flex justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">{m.roleName}</p>
                    <p className="text-xs text-muted-foreground">{m.agentName ?? `Agent #${m.agentId}`}</p>
                  </div>
                  <div className="flex gap-1.5">
                    <Badge variant="outline" className="text-[10px]">{m.roleType}</Badge>
                    {m.handoffEnabled && <Badge variant="secondary" className="text-[10px]">handoff</Badge>}
                  </div>
                </div>
                {m.instructions && (
                  <p className="text-xs text-muted-foreground mt-2 line-clamp-2">{m.instructions}</p>
                )}
              </div>
            ))}
          </div>

          <h2 className="text-sm font-semibold pt-2">Connect</h2>
          <p className="text-xs text-muted-foreground">
            Primary triggers: attach an inbound number or campaign. Manual tests below are for setup only.
          </p>
          <div className="flex flex-wrap gap-2 items-end">
            <div className="min-w-[160px] flex-1">
              <Label className="text-xs">Phone number</Label>
              <Select value={connectPhoneId} onValueChange={setConnectPhoneId}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  {phones.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>{p.number}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              size="sm"
              variant="secondary"
              disabled={!connectPhoneId || connectMut.isPending}
              onClick={() => connectMut.mutate({ phoneNumberId: parseInt(connectPhoneId, 10) })}
            >
              <Link2 className="w-3.5 h-3.5 mr-1" /> Attach
            </Button>
          </div>
          <div className="flex flex-wrap gap-2 items-end">
            <div className="min-w-[160px] flex-1">
              <Label className="text-xs">Campaign</Label>
              <Select value={connectCampaignId} onValueChange={setConnectCampaignId}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  {campaigns.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              size="sm"
              variant="secondary"
              disabled={!connectCampaignId || connectMut.isPending}
              onClick={() => connectMut.mutate({ campaignId: parseInt(connectCampaignId, 10) })}
            >
              <Link2 className="w-3.5 h-3.5 mr-1" /> Attach
            </Button>
          </div>
          {(squad.connections.phoneNumbers.length > 0 || squad.connections.campaigns.length > 0) && (
            <div className="text-xs text-muted-foreground space-y-1">
              {squad.connections.phoneNumbers.map((p) => (
                <div key={p.id} className="flex items-center gap-2">
                  <Phone className="w-3 h-3" /> {p.number}
                  <button
                    type="button"
                    className="underline"
                    onClick={() => connectMut.mutate({ phoneNumberId: p.id, detach: true })}
                  >
                    detach
                  </button>
                </div>
              ))}
              {squad.connections.campaigns.map((c) => (
                <div key={c.id} className="flex items-center gap-2">
                  <Zap className="w-3 h-3" /> {c.name}
                  <button
                    type="button"
                    className="underline"
                    onClick={() => connectMut.mutate({ campaignId: c.id, detach: true })}
                  >
                    detach
                  </button>
                </div>
              ))}
            </div>
          )}

          <h2 className="text-sm font-semibold pt-2">Test Squad</h2>
          <Textarea
            placeholder="Goal for a task run, e.g. Qualify this lead and summarize next steps"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            rows={3}
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={!goal.trim() || startRun.isPending}
              onClick={() => startRun.mutate({ kind: "task", goal: goal.trim() })}
            >
              <Play className="w-3.5 h-3.5 mr-1" /> Task run
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={startRun.isPending}
              onClick={() => startRun.mutate({ kind: "live_call", goal: goal.trim() || "Live call test" })}
            >
              Live call shell
            </Button>
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-sm font-semibold">Runs</h2>
          <div className="space-y-1 max-h-48 overflow-auto">
            {runs.length === 0 && (
              <p className="text-xs text-muted-foreground">No runs yet.</p>
            )}
            {runs.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setSelectedRunId(r.id)}
                className={`w-full text-left rounded-md border px-3 py-2 text-xs ${
                  selectedRunId === r.id ? "border-foreground/30 bg-muted/40" : "border-border/50"
                }`}
              >
                <div className="flex justify-between gap-2">
                  <span className="font-medium truncate">{r.goal || r.kind}</span>
                  <Badge className={statusColor(r.status)} variant="secondary">{r.status}</Badge>
                </div>
                <div className="text-muted-foreground mt-0.5">
                  {r.kind} · {r.triggeredBy} · #{r.id}
                </div>
              </button>
            ))}
          </div>

          {runDetail && (
            <div className="rounded-xl border border-border/60 p-4 space-y-3">
              <div className="flex justify-between">
                <h3 className="text-sm font-semibold">Run #{runDetail.id}</h3>
                <Badge className={statusColor(runDetail.status)} variant="secondary">{runDetail.status}</Badge>
              </div>
              {runDetail.finalResult && (
                <p className="text-xs bg-muted/40 rounded p-2">{runDetail.finalResult}</p>
              )}
              {runDetail.error && (
                <p className="text-xs text-red-600">{runDetail.error}</p>
              )}
              {waitingStep && (
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => approveMut.mutate({ stepId: waitingStep.id, approved: true })}>
                    Approve step
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => approveMut.mutate({ stepId: waitingStep.id, approved: false })}
                  >
                    Reject
                  </Button>
                </div>
              )}
              <div>
                <p className="text-xs font-medium mb-1">Steps</p>
                <ul className="space-y-1">
                  {runDetail.steps.map((s) => (
                    <li key={s.id} className="text-xs flex justify-between gap-2">
                      <span>{s.stepIndex}. {s.type}</span>
                      <span className="text-muted-foreground">{s.status}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="text-xs font-medium mb-1">Timeline</p>
                <ul className="space-y-1 max-h-40 overflow-auto">
                  {runDetail.events.map((e) => (
                    <li key={e.id} className="text-[11px] text-muted-foreground">
                      <span className="font-medium text-foreground">{e.type}</span>
                      {e.message ? ` — ${e.message}` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
