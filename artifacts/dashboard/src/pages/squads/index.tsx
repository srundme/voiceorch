import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation, useParams, useSearch } from "wouter";
import { customFetch, useListAgents } from "@workspace/api-client-react";
import { StripePage } from "@/components/stripe-page";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  UsersRound, Plus, Phone, Trash2, Loader2, ArrowLeftRight,
  CalendarClock, X, PhoneForwarded,
} from "lucide-react";

const API = "/api";

const DEFAULT_HANDOFF_MESSAGE =
  "One moment — I'm connecting you to a teammate who can help with this.";
const DEFAULT_HANDOFF_GREETING =
  "Hi — I've been briefed on your conversation so far. How can I help?";

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
  handoffMessage?: string | null;
  handoffGreeting?: string | null;
  members: SquadMember[];
  connections: {
    phoneNumbers: Array<{ id: number; number: string }>;
    campaigns: Array<{ id: number; name: string; agentId: number | null }>;
  };
  createdAt: string;
  updatedAt: string;
};

type SquadTask = {
  id: number;
  type: "handoff" | "follow_up";
  status: string;
  fromAgentId: number | null;
  fromAgentName: string | null;
  toAgentId: number | null;
  toAgentName: string | null;
  callId: number | null;
  callerPhone: string | null;
  title: string;
  note: string | null;
  contextSummary: string | null;
  dueAt: string | null;
  createdAt: string;
};

type PhoneNumberRow = { id: number; number: string; agentId?: number | null };

type MemberDraft = {
  agentId: string;
  roleName: string;
  instructions: string;
};

function statusColor(status: string) {
  if (["active", "completed", "scheduled"].includes(status)) {
    return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300";
  }
  if (["failed", "cancelled"].includes(status)) {
    return "bg-red-500/15 text-red-700 dark:text-red-300";
  }
  if (status === "pending") {
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
  const [, setLocation] = useLocation();
  const search = useSearch();
  const seedAgentRaw = new URLSearchParams(search).get("seedAgent");
  const seedAgentId = seedAgentRaw && /^\d+$/.test(seedAgentRaw) ? Number(seedAgentRaw) : null;
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    if (seedAgentId == null) return;
    setCreateOpen(true);
  }, [seedAgentId]);

  const clearSeed = () => {
    if (seedAgentId == null) return;
    setLocation("/app/squads", { replace: true });
  };

  const { data: squads = [], isLoading } = useQuery({
    queryKey: ["squads"],
    queryFn: () => customFetch<Squad[]>(`${API}/squads`),
  });

  const { data: agentsData } = useListAgents();
  const agents = agentsData ?? [];

  const createMut = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      customFetch<Squad>(`${API}/squads`, { method: "POST", body: JSON.stringify(body) }),
    onSuccess: (s) => {
      void qc.invalidateQueries({ queryKey: ["squads"] });
      setCreateOpen(false);
      clearSeed();
      toast({ title: "Team created", description: "Members can hand calls to each other mid-conversation." });
      onOpen(s.id);
    },
    onError: (err: Error) => toast({ title: "Create failed", description: err.message, variant: "destructive" }),
  });

  const handleCreateOpenChange = (open: boolean) => {
    setCreateOpen(open);
    if (!open) clearSeed();
  };

  return (
    <StripePage
      title="Squads"
      description="Put your agents on a team. They hand live calls to each other mid-conversation, share what they know about each caller, and schedule follow-up calls for one another."
      actions={
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="w-4 h-4 mr-1.5" /> New team
        </Button>
      }
    >
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-12 justify-center">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading squads…
          </div>
        ) : squads.length === 0 ? (
          <EmptyState
            icon={<UsersRound className="w-6 h-6" />}
            title="No teams yet"
            description="Pick two or more agents you already built — like a Lead Qualifier and a Meeting Scheduler — and they will work as a team automatically."
            action={{
              label: "Create team",
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
                      {s.description || `${s.members.length} agents working together`}
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
              </button>
            ))}
          </div>
        )}

        <div className="rounded-xl border border-border/50 bg-muted/20 p-4 max-w-2xl mt-6">
          <h2 className="text-sm font-semibold mb-2">How teams work</h2>
          <ul className="text-xs text-muted-foreground space-y-1.5">
            <li className="flex gap-2">
              <ArrowLeftRight className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              A caller talking to Agent 1 can be handed to Agent 2 mid-call — same phone call, no redial. Agent 2 receives the conversation so far and continues naturally.
            </li>
            <li className="flex gap-2">
              <UsersRound className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              Teammates share caller memory: whatever Agent 1 learned about a caller, Agent 2 already knows — even when the caller dials Agent 2&apos;s own number directly.
            </li>
            <li className="flex gap-2">
              <CalendarClock className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              Agents create tasks for each other: &quot;have the scheduler call this lead tomorrow at 3&quot; becomes an automatic outbound call with full context.
            </li>
          </ul>
        </div>

      <CreateSquadDialog
        open={createOpen}
        onOpenChange={handleCreateOpenChange}
        agents={agents.map((a) => ({ id: a.id, name: a.name }))}
        seedAgentId={seedAgentId}
        onSubmit={(body) => createMut.mutate(body)}
        saving={createMut.isPending}
      />
    </StripePage>
  );
}

function CreateSquadDialog({
  open,
  onOpenChange,
  agents,
  seedAgentId,
  onSubmit,
  saving,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  agents: Array<{ id: number; name: string }>;
  seedAgentId?: number | null;
  onSubmit: (body: Record<string, unknown>) => void;
  saving: boolean;
}) {
  const seeded = seedAgentId != null && agents.some((a) => a.id === seedAgentId);
  const seedName = seeded ? agents.find((a) => a.id === seedAgentId)?.name : null;

  const blankDrafts = (): MemberDraft[] => [
    { agentId: "", roleName: "", instructions: "" },
    { agentId: "", roleName: "", instructions: "" },
  ];

  const seededDrafts = (): MemberDraft[] => [
    {
      agentId: String(seedAgentId),
      roleName: seedName ?? "First agent",
      instructions: "Entry point — hand off when a specialist should take over",
    },
    { agentId: "", roleName: "", instructions: "" },
  ];

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [handoffMessage, setHandoffMessage] = useState(DEFAULT_HANDOFF_MESSAGE);
  const [handoffGreeting, setHandoffGreeting] = useState(DEFAULT_HANDOFF_GREETING);
  const [drafts, setDrafts] = useState<MemberDraft[]>(blankDrafts);

  useEffect(() => {
    if (!open) return;
    setName("");
    setDescription("");
    setHandoffMessage(DEFAULT_HANDOFF_MESSAGE);
    setHandoffGreeting(DEFAULT_HANDOFF_GREETING);
    setDrafts(seeded ? seededDrafts() : blankDrafts());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when dialog opens / seed changes
  }, [open, seedAgentId, seeded]);

  const usedIds = new Set(drafts.map((d) => d.agentId).filter(Boolean));
  const filled = drafts.filter((d) => d.agentId);
  const canSave = name.trim() && filled.length >= 2
    && new Set(filled.map((d) => d.agentId)).size === filled.length;

  const setDraft = (i: number, patch: Partial<MemberDraft>) => {
    setDrafts((prev) => prev.map((d, idx) => (idx === i ? { ...d, ...patch } : d)));
  };

  const selectAgent = (i: number, agentId: string) => {
    const agent = agents.find((a) => String(a.id) === agentId);
    setDraft(i, { agentId, roleName: agent?.name?.trim() || "" });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{seeded ? "Assemble your team" : "New team"}</DialogTitle>
          <DialogDescription>
            {seeded
              ? <>{seedName ?? "Your agent"} is ready — add at least one more agent, name the team, and create.</>
              : "Pick agents you already built and give each a role. Handoff tools, shared caller memory, and task creation are wired up automatically."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
          <div>
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Sales team" autoFocus={seeded} />
          </div>
          <div>
            <Label>Description (optional)</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </div>

          {drafts.map((d, i) => (
            <div key={i} className="rounded-lg border border-border/60 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-muted-foreground">
                  {seeded && i === 0 ? "First agent (from create)" : `Agent ${i + 1}`}
                </p>
                {drafts.length > 2 && (
                  <button type="button" onClick={() => setDrafts((prev) => prev.filter((_, idx) => idx !== i))}>
                    <X className="w-3.5 h-3.5 text-muted-foreground" />
                  </button>
                )}
              </div>
              <div className="space-y-1.5">
                <Label className="text-[11px]">Select agent</Label>
                <Select value={d.agentId} onValueChange={(v) => selectAgent(i, v)}>
                  <SelectTrigger><SelectValue placeholder="Select agent" /></SelectTrigger>
                  <SelectContent>
                    {agents.map((a) => (
                      <SelectItem
                        key={a.id}
                        value={String(a.id)}
                        disabled={usedIds.has(String(a.id)) && d.agentId !== String(a.id)}
                      >
                        {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {d.agentId ? (
                <div className="space-y-1.5">
                  <Label className="text-[11px]">Agent Role</Label>
                  <Input
                    value={d.roleName}
                    onChange={(e) => setDraft(i, { roleName: e.target.value })}
                    placeholder="Role for this agent on the team"
                  />
                </div>
              ) : null}
              <Input
                value={d.instructions}
                onChange={(e) => setDraft(i, { instructions: e.target.value })}
                placeholder="What they handle, e.g. qualifying new leads (helps teammates know when to transfer)"
              />
              {i === 0 ? (
                <div className="space-y-1.5 pt-1 border-t border-border/50">
                  <Label className="text-[11px] inline-flex items-center gap-1.5">
                    <PhoneForwarded className="w-3 h-3" /> Handoff announcement
                  </Label>
                  <Textarea
                    value={handoffMessage}
                    onChange={(e) => setHandoffMessage(e.target.value)}
                    rows={2}
                    placeholder={DEFAULT_HANDOFF_MESSAGE}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Spoken by this agent every time before connecting a teammate.
                  </p>
                </div>
              ) : null}
              {i === 1 ? (
                <div className="space-y-1.5 pt-1 border-t border-border/50">
                  <Label className="text-[11px] inline-flex items-center gap-1.5">
                    <PhoneForwarded className="w-3 h-3" /> Receiving agent greeting
                  </Label>
                  <Textarea
                    value={handoffGreeting}
                    onChange={(e) => setHandoffGreeting(e.target.value)}
                    rows={2}
                    placeholder={DEFAULT_HANDOFF_GREETING}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Spoken by this agent after they take over the call.
                  </p>
                </div>
              ) : null}
            </div>
          ))}

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setDrafts((prev) => [...prev, { agentId: "", roleName: "", instructions: "" }])}
          >
            <Plus className="w-3.5 h-3.5 mr-1" /> Add another agent
          </Button>
          {filled.length < 2 && (
            <p className="text-[11px] text-muted-foreground">Add at least two agents to form a team.</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={!canSave || saving}
            onClick={() => {
              onSubmit({
                name: name.trim(),
                description: description.trim() || null,
                status: "active",
                handoffMessage: handoffMessage.trim() || DEFAULT_HANDOFF_MESSAGE,
                handoffGreeting: handoffGreeting.trim() || DEFAULT_HANDOFF_GREETING,
                members: filled.map((d, i) => ({
                  agentId: parseInt(d.agentId, 10),
                  roleName: d.roleName.trim()
                    || agents.find((a) => String(a.id) === d.agentId)?.name
                    || `Agent ${i + 1}`,
                  roleType: "specialist",
                  instructions: d.instructions.trim() || null,
                  handoffEnabled: true,
                  sortOrder: i,
                })),
              });
            }}
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Create team"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditSquadDialog({
  open,
  onOpenChange,
  squad,
  agents,
  onSubmit,
  saving,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  squad: Squad;
  agents: Array<{ id: number; name: string }>;
  onSubmit: (body: Record<string, unknown>) => void;
  saving: boolean;
}) {
  const [name, setName] = useState(squad.name);
  const [description, setDescription] = useState(squad.description ?? "");
  const [handoffMessage, setHandoffMessage] = useState(squad.handoffMessage ?? DEFAULT_HANDOFF_MESSAGE);
  const [handoffGreeting, setHandoffGreeting] = useState(squad.handoffGreeting ?? DEFAULT_HANDOFF_GREETING);
  const [drafts, setDrafts] = useState<MemberDraft[]>([]);

  useEffect(() => {
    if (!open) return;
    setName(squad.name);
    setDescription(squad.description ?? "");
    setHandoffMessage(squad.handoffMessage?.trim() || DEFAULT_HANDOFF_MESSAGE);
    setHandoffGreeting(squad.handoffGreeting?.trim() || DEFAULT_HANDOFF_GREETING);
    setDrafts(
      squad.members.map((m) => ({
        agentId: String(m.agentId),
        roleName: m.roleName,
        instructions: m.instructions ?? "",
      })),
    );
  }, [open, squad]);

  const usedIds = new Set(drafts.map((d) => d.agentId).filter(Boolean));
  const filled = drafts.filter((d) => d.agentId);
  const canSave = name.trim() && filled.length >= 2
    && new Set(filled.map((d) => d.agentId)).size === filled.length;

  const setDraft = (i: number, patch: Partial<MemberDraft>) => {
    setDrafts((prev) => prev.map((d, idx) => (idx === i ? { ...d, ...patch } : d)));
  };

  const selectAgent = (i: number, agentId: string) => {
    const agent = agents.find((a) => String(a.id) === agentId);
    const prev = drafts[i];
    // Keep an existing custom role unless it was empty or still matched the previous agent name.
    const prevAgentName = agents.find((a) => String(a.id) === prev?.agentId)?.name?.trim() ?? "";
    const keepRole = !!(prev?.roleName.trim() && prev.roleName.trim() !== prevAgentName);
    setDraft(i, {
      agentId,
      roleName: keepRole ? prev!.roleName : (agent?.name?.trim() || ""),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit team</DialogTitle>
          <DialogDescription>
            Change name, roles, or members. At least two agents required.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
          <div>
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label>Description (optional)</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </div>
          {drafts.map((d, i) => (
            <div key={i} className="rounded-lg border border-border/60 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-muted-foreground">Agent {i + 1}</p>
                {drafts.length > 2 && (
                  <button type="button" onClick={() => setDrafts((prev) => prev.filter((_, idx) => idx !== i))}>
                    <X className="w-3.5 h-3.5 text-muted-foreground" />
                  </button>
                )}
              </div>
              <div className="space-y-1.5">
                <Label className="text-[11px]">Select agent</Label>
                <Select value={d.agentId} onValueChange={(v) => selectAgent(i, v)}>
                  <SelectTrigger><SelectValue placeholder="Select agent" /></SelectTrigger>
                  <SelectContent>
                    {agents.map((a) => (
                      <SelectItem
                        key={a.id}
                        value={String(a.id)}
                        disabled={usedIds.has(String(a.id)) && d.agentId !== String(a.id)}
                      >
                        {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {d.agentId ? (
                <div className="space-y-1.5">
                  <Label className="text-[11px]">Agent Role</Label>
                  <Input
                    value={d.roleName}
                    onChange={(e) => setDraft(i, { roleName: e.target.value })}
                    placeholder="Role for this agent on the team"
                  />
                </div>
              ) : null}
              <Input
                value={d.instructions}
                onChange={(e) => setDraft(i, { instructions: e.target.value })}
                placeholder="What they handle"
              />
              {i === 0 ? (
                <div className="space-y-1.5 pt-1 border-t border-border/50">
                  <Label className="text-[11px] inline-flex items-center gap-1.5">
                    <PhoneForwarded className="w-3 h-3" /> Handoff announcement
                  </Label>
                  <Textarea
                    value={handoffMessage}
                    onChange={(e) => setHandoffMessage(e.target.value)}
                    rows={2}
                    placeholder={DEFAULT_HANDOFF_MESSAGE}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Spoken by this agent every time before connecting a teammate.
                  </p>
                </div>
              ) : null}
              {i === 1 ? (
                <div className="space-y-1.5 pt-1 border-t border-border/50">
                  <Label className="text-[11px] inline-flex items-center gap-1.5">
                    <PhoneForwarded className="w-3 h-3" /> Receiving agent greeting
                  </Label>
                  <Textarea
                    value={handoffGreeting}
                    onChange={(e) => setHandoffGreeting(e.target.value)}
                    rows={2}
                    placeholder={DEFAULT_HANDOFF_GREETING}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Spoken by this agent after they take over the call.
                  </p>
                </div>
              ) : null}
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setDrafts((prev) => [...prev, { agentId: "", roleName: "", instructions: "" }])}
          >
            <Plus className="w-3.5 h-3.5 mr-1" /> Add another agent
          </Button>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={!canSave || saving}
            onClick={() => {
              onSubmit({
                name: name.trim(),
                description: description.trim() || null,
                handoffMessage: handoffMessage.trim() || DEFAULT_HANDOFF_MESSAGE,
                handoffGreeting: handoffGreeting.trim() || DEFAULT_HANDOFF_GREETING,
                members: filled.map((d, i) => ({
                  agentId: parseInt(d.agentId, 10),
                  roleName: d.roleName.trim()
                    || agents.find((a) => String(a.id) === d.agentId)?.name
                    || `Agent ${i + 1}`,
                  roleType: "specialist",
                  instructions: d.instructions.trim() || null,
                  handoffEnabled: true,
                  sortOrder: i,
                })),
              });
            }}
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save team"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SquadDetailPage({ squadId, onBack }: { squadId: number; onBack: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);

  const { data: squad, isLoading } = useQuery({
    queryKey: ["squad", squadId],
    queryFn: () => customFetch<Squad>(`${API}/squads/${squadId}`),
  });

  const { data: tasks = [] } = useQuery({
    queryKey: ["squad-tasks", squadId],
    queryFn: () => customFetch<SquadTask[]>(`${API}/squads/${squadId}/tasks`),
    refetchInterval: 5000,
  });

  const { data: phones = [] } = useQuery({
    queryKey: ["phone-numbers"],
    queryFn: () => customFetch<PhoneNumberRow[]>(`${API}/phone-numbers`),
  });

  const { data: agentsData } = useListAgents();
  const agents = agentsData ?? [];

  const updateMut = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      customFetch<Squad>(`${API}/squads/${squadId}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["squad", squadId] });
      void qc.invalidateQueries({ queryKey: ["squads"] });
      setEditOpen(false);
      toast({ title: "Team updated" });
    },
    onError: (err: Error) => toast({ title: "Update failed", description: err.message, variant: "destructive" }),
  });

  const cancelTaskMut = useMutation({
    mutationFn: (taskId: number) =>
      customFetch(`${API}/squad-tasks/${taskId}/cancel`, { method: "POST" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["squad-tasks", squadId] });
      toast({ title: "Follow-up cancelled" });
    },
  });

  const deleteMut = useMutation({
    mutationFn: () => customFetch(`${API}/squads/${squadId}`, { method: "DELETE" }),
    onSuccess: () => {
      toast({ title: "Squad deleted" });
      onBack();
    },
  });

  if (isLoading || !squad) {
    return (
      <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…
      </div>
    );
  }

  const phoneByAgent = new Map<number, string>();
  for (const p of phones) {
    if (p.agentId != null && !phoneByAgent.has(p.agentId)) phoneByAgent.set(p.agentId, p.number);
  }

  const isActive = squad.status === "active";

  return (
    <StripePage
      title={squad.name}
      description={squad.description || "Agents on this team hand calls to each other and share caller context."}
      back={{ href: "/app/squads", label: "Squads" }}
      actions={
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Switch
              checked={isActive}
              onCheckedChange={(on) => updateMut.mutate({ status: on ? "active" : "paused" })}
            />
            <span className="text-xs text-muted-foreground">{isActive ? "Active" : "Paused"}</span>
          </div>
          <Button variant="outline" size="sm" onClick={() => deleteMut.mutate()}>
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      }
    >
      <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 px-3.5 py-3 mb-6 text-[12px] text-muted-foreground leading-relaxed">
        <p className="font-medium text-foreground/90">Callback disposition ≠ live handoff</p>
        <p className="mt-0.5">
          A <strong className="text-foreground/80">Callback</strong> outcome means “call later” for analytics / follow-up.
          Live Agent A → Agent B on the open line is a <strong className="text-foreground/80">squad handoff</strong> here.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">Team</h2>
            <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => setEditOpen(true)}>
              Edit team
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Each agent keeps its own prompt and phone number. While the squad is active, every member automatically
            gets transfer tools for teammates, sees what teammates know about each caller, and can schedule
            follow-up calls for one another.
          </p>
          <div className="space-y-2">
            {squad.members.map((m, i) => (
              <div key={m.id ?? m.agentId} className="rounded-lg border border-border/60 p-3">
                <div className="flex justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">{m.roleName}</p>
                    <p className="text-xs text-muted-foreground">{m.agentName ?? `Agent #${m.agentId}`}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    {phoneByAgent.has(m.agentId) ? (
                      <span className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
                        <Phone className="w-3 h-3" /> {phoneByAgent.get(m.agentId)}
                      </span>
                    ) : (
                      <span className="text-[11px] text-amber-600 dark:text-amber-400">no number assigned</span>
                    )}
                    {m.handoffEnabled && (
                      <Badge variant="secondary" className="text-[10px]">receives handoffs</Badge>
                    )}
                  </div>
                </div>
                {m.instructions && (
                  <p className="text-xs text-muted-foreground mt-2 line-clamp-2">Handles: {m.instructions}</p>
                )}
                {i === 0 ? (
                  <div className="mt-3 pt-2 border-t border-border/50">
                    <p className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
                      <PhoneForwarded className="w-3 h-3" /> Handoff announcement
                    </p>
                    <p className="text-xs text-foreground/90 mt-0.5">
                      {squad.handoffMessage?.trim() || DEFAULT_HANDOFF_MESSAGE}
                    </p>
                  </div>
                ) : null}
                {i === 1 ? (
                  <div className="mt-3 pt-2 border-t border-border/50">
                    <p className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
                      <PhoneForwarded className="w-3 h-3" /> Receiving agent greeting
                    </p>
                    <p className="text-xs text-foreground/90 mt-0.5">
                      {squad.handoffGreeting?.trim() || DEFAULT_HANDOFF_GREETING}
                    </p>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">
            Agents without a phone number can still receive in-call handoffs, but cannot make follow-up calls.
          </p>
          <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => setEditOpen(true)}>
            Edit handoff messages
          </Button>
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold">Activity — handoffs &amp; tasks</h2>
          {tasks.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Nothing yet. Call any member&apos;s number — when the conversation needs a teammate, the agent
              transfers the call or schedules a follow-up, and it shows up here.
            </p>
          ) : (
            <div className="space-y-2 max-h-[32rem] overflow-auto">
              {tasks.map((t) => (
                <div key={t.id} className="rounded-lg border border-border/50 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium">
                      {t.type === "handoff"
                        ? <PhoneForwarded className="w-3.5 h-3.5" />
                        : <CalendarClock className="w-3.5 h-3.5" />}
                      {t.type === "handoff" ? "Live handoff" : "Follow-up call"}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <Badge className={statusColor(t.status)} variant="secondary">{t.status}</Badge>
                      {t.type === "follow_up" && ["pending", "scheduled"].includes(t.status) && (
                        <button
                          type="button"
                          title="Cancel follow-up"
                          onClick={() => cancelTaskMut.mutate(t.id)}
                        >
                          <X className="w-3.5 h-3.5 text-muted-foreground" />
                        </button>
                      )}
                    </div>
                  </div>
                  <p className="text-xs mt-1.5">
                    <span className="text-muted-foreground">{t.fromAgentName ?? "Agent"}</span>
                    {" → "}
                    <span className="font-medium">{t.toAgentName ?? "Agent"}</span>
                    {t.callerPhone ? <span className="text-muted-foreground"> · {t.callerPhone}</span> : null}
                  </p>
                  {(t.note || t.title) && (
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{t.note || t.title}</p>
                  )}
                  <p className="text-[11px] text-muted-foreground mt-1">
                    {new Date(t.createdAt).toLocaleString()}
                    {t.dueAt ? ` · calls at ${new Date(t.dueAt).toLocaleString()}` : ""}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <EditSquadDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        squad={squad}
        agents={agents.map((a) => ({ id: a.id, name: a.name }))}
        onSubmit={(body) => updateMut.mutate(body)}
        saving={updateMut.isPending}
      />
    </StripePage>
  );
}
