import { useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient, useQuery, useMutation } from "@tanstack/react-query";
import { Eye, Plus, Loader2, Camera } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const TOKEN_KEY = "voiceorch:session";

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem(TOKEN_KEY);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/* ── Types ─────────────────────────────────────────────────────────────────── */

interface VisionAgent {
  id: string;
  name: string;
  description: string | null;
  status: "active" | "draft";
  sessionCount: number;
  createdAt: string;
}

/* ── Query keys ────────────────────────────────────────────────────────────── */

const VISION_AGENTS_KEY = ["vision-agents"] as const;

/* ── API helpers ───────────────────────────────────────────────────────────── */

async function fetchVisionAgents(): Promise<VisionAgent[]> {
  const res = await fetch(`${BASE}/api/vision-agents`, {
    headers: { ...getAuthHeaders() },
  });
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json() as { agents?: VisionAgent[] } | VisionAgent[];
  return Array.isArray(data) ? data : (data as { agents?: VisionAgent[] }).agents ?? [];
}

async function createVisionAgent(payload: { name: string; description?: string }): Promise<VisionAgent> {
  const res = await fetch(`${BASE}/api/vision-agents`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getAuthHeaders() },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<VisionAgent>;
}

/* ── Create modal ──────────────────────────────────────────────────────────── */

function CreateVisionAgentModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const mutation = useMutation({
    mutationFn: createVisionAgent,
    onSuccess: (agent) => {
      void queryClient.invalidateQueries({ queryKey: VISION_AGENTS_KEY });
      toast({ title: "Vision agent created", description: agent.name });
      onClose();
      navigate(`/app/vision-agents/${agent.id}`);
    },
    onError: (err: Error) => {
      toast({ title: "Failed to create agent", description: err.message, variant: "destructive" });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    mutation.mutate({ name: name.trim(), description: description.trim() || undefined });
  };

  const handleClose = () => {
    if (mutation.isPending) return;
    setName("");
    setDescription("");
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New Vision Agent</DialogTitle>
          <DialogDescription>
            Create a vision agent to process images and video using AI.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-1">
          <div className="space-y-1.5">
            <Label htmlFor="va-name">Name</Label>
            <Input
              id="va-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Vision Agent"
              disabled={mutation.isPending}
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="va-desc">Description <span className="text-muted-foreground">(optional)</span></Label>
            <Textarea
              id="va-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What will this agent do?"
              rows={3}
              disabled={mutation.isPending}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleClose} disabled={mutation.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || mutation.isPending}>
              {mutation.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              Create Agent
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ── Agent card ────────────────────────────────────────────────────────────── */

function VisionAgentCard({ agent }: { agent: VisionAgent }) {
  const [, navigate] = useLocation();
  return (
    <div className="rounded-xl border border-border/60 bg-card/50 p-5 space-y-4 hover:border-border transition-colors">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="h-9 w-9 rounded-lg bg-violet-500/10 border border-violet-500/20 flex items-center justify-center shrink-0">
            <Eye className="h-4 w-4 text-violet-400" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground truncate">{agent.name}</p>
            {agent.description && (
              <p className="text-xs text-muted-foreground truncate mt-0.5">{agent.description}</p>
            )}
          </div>
        </div>
        <Badge
          variant="outline"
          className={cn(
            "shrink-0 text-[10px]",
            agent.status === "active"
              ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
              : "bg-zinc-500/10 text-zinc-400 border-zinc-500/20",
          )}
        >
          {agent.status}
        </Badge>
      </div>

      <div className="flex items-center justify-between">
        <div className="text-[11px] text-muted-foreground">
          <span className="font-medium text-foreground tabular-nums">{agent.sessionCount}</span>{" "}
          {agent.sessionCount === 1 ? "session" : "sessions"}
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs px-3"
          onClick={() => navigate(`/app/vision-agents/${agent.id}`)}
        >
          Open Builder
        </Button>
      </div>
    </div>
  );
}

/* ── Empty state ───────────────────────────────────────────────────────────── */

function EmptyVisionAgents({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center max-w-sm mx-auto space-y-5">
      <div className="h-16 w-16 rounded-2xl border border-violet-500/20 bg-violet-500/10 flex items-center justify-center">
        <Camera className="h-7 w-7 text-violet-400" />
      </div>
      <div className="space-y-2">
        <h2 className="text-lg font-semibold">No vision agents yet</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Vision agents analyze images and video using AI — describe, extract structured data,
          verify content, or compare visuals. Great for QC, identity checks, and media intelligence.
        </p>
      </div>
      <Button onClick={onCreate} className="gap-1.5">
        <Plus className="h-3.5 w-3.5" />
        New Vision Agent
      </Button>
    </div>
  );
}

/* ── Page ──────────────────────────────────────────────────────────────────── */

export default function VisionAgentsPage() {
  const [showCreate, setShowCreate] = useState(false);

  const { data: agents = [], isLoading } = useQuery({
    queryKey: VISION_AGENTS_KEY,
    queryFn: fetchVisionAgents,
  });

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2">
            <Eye className="h-5 w-5 text-violet-400" />
            Vision Agents
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            AI agents that analyze images, video, and documents.
          </p>
        </div>
        <Button onClick={() => setShowCreate(true)} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          New Vision Agent
        </Button>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : agents.length === 0 ? (
        <EmptyVisionAgents onCreate={() => setShowCreate(true)} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {agents.map((agent) => (
            <VisionAgentCard key={agent.id} agent={agent} />
          ))}
        </div>
      )}

      <CreateVisionAgentModal open={showCreate} onClose={() => setShowCreate(false)} />
    </div>
  );
}
