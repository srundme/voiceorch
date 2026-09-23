import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { Copy, ExternalLink, Loader2, Plus } from "lucide-react";
import { useListAgents } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { intakeProgress, type IntakeDto } from "./intake-contract";

/**
 * Operator console for live candidate intake forms.
 *
 * One row per inbound call. "New intake form" mints a token and the live form
 * URL that goes on the screen the recruiter watches while the agent talks.
 */

const API = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api`;

type IntakeRow = IntakeDto & { formUrl: string };

function pickIntakeAgent(agents: { id: number; name: string; agentType?: string | null }[]) {
  const irfan = (name: string) => /^irfan\b/i.test(name);
  return agents.find((agent) => irfan(agent.name))
    ?? agents.find((agent) => agent.agentType === "intake_inbound")
    ?? null;
}

export default function IntakeListPage() {
  const { toast } = useToast();
  const { data: agents = [] } = useListAgents();
  const intakeAgent = useMemo(
    () => pickIntakeAgent(agents as { id: number; name: string; agentType?: string | null }[]),
    [agents],
  );
  const [rows, setRows] = useState<IntakeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API}/intake/sessions`, { credentials: "include" });
      if (!res.ok) throw new Error(`Could not load intake forms (${res.status})`);
      setRows((await res.json()) as IntakeRow[]);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load intake forms");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    setCreating(true);
    try {
      const res = await fetch(`${API}/intake/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(intakeAgent ? { agentId: intakeAgent.id } : {}),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error || `Could not create the form (${res.status})`);
      }
      const created = (await res.json()) as IntakeRow;
      setRows((current) => [created, ...current]);
      window.open(`${import.meta.env.BASE_URL.replace(/\/$/, "")}/intake/${created.token}`, "_blank");
    } catch (err) {
      toast({
        title: "Could not create the form",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setCreating(false);
    }
  };

  const visible = intakeAgent ? rows.filter((row) => row.agentId == null || row.agentId === intakeAgent.id) : rows;

  const copy = async (url: string) => {
    await navigator.clipboard.writeText(url);
    toast({ title: "Form link copied" });
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Candidate intake</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {intakeAgent
              ? `Live forms ${intakeAgent.name} fills during an inbound call.`
              : "Live forms the Irfan intake agent fills during an inbound call."}
          </p>
        </div>
        <Button onClick={() => void create()} disabled={creating}>
          {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
          New intake form
        </Button>
      </div>

      {loading ? (
        <div className="mt-10 grid place-items-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <p className="mt-8 text-sm text-destructive">{error}</p>
      ) : visible.length === 0 ? (
        <p className="mt-8 text-sm text-muted-foreground">
          No intake forms yet. Create one and open it on the screen you want to watch.
        </p>
      ) : (
        <ul className="mt-6 divide-y rounded-xl border">
          {visible.map((row) => {
            const progress = intakeProgress(row.fields);
            const name = [row.fields.firstName, row.fields.lastName].filter(Boolean).join(" ");
            return (
              <li key={row.token} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{name || "Unnamed candidate"}</span>
                    <Badge variant={row.status === "completed" ? "secondary" : "default"}>
                      {row.status === "completed" ? "Closed" : "In progress"}
                    </Badge>
                  </div>
                  <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                    {progress.filled}/{progress.total} captured · {new Date(row.createdAt).toLocaleString()}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => void copy(row.formUrl)}>
                    <Copy className="mr-1.5 h-3.5 w-3.5" />
                    Copy link
                  </Button>
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/intake/${row.token}`}>
                      <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                      Open
                    </Link>
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
