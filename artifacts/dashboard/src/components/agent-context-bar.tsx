import { Link, useLocation, useSearch } from "wouter";
import { useEffect, useMemo } from "react";
import { Bot, Plus } from "lucide-react";
import {
  getListAgentsQueryKey,
  useListAgents,
  type Agent,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

function agentIdFromSearch(search: string): number | null {
  const raw = new URLSearchParams(search).get("agentId");
  if (!raw) return null;
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? id : null;
}

/**
 * Shared agent selection synced to `?agentId=`.
 * Use on Automation, Meet, Memory, and similar agent-scoped pages.
 */
export function useAgentFromSearch(): {
  agents: Agent[];
  isLoading: boolean;
  selectedId: number | null;
  selectedAgent: Agent | undefined;
  setAgentId: (id: number) => void;
} {
  const [, navigate] = useLocation();
  const search = useSearch();
  const agentsQ = useListAgents({
    query: { queryKey: getListAgentsQueryKey(), staleTime: 20_000 },
  });
  const agents = useMemo(
    () => (Array.isArray(agentsQ.data) ? agentsQ.data : []),
    [agentsQ.data],
  );

  const requestedId = agentIdFromSearch(search);
  const selectedId = useMemo(() => {
    if (requestedId != null && agents.some((a) => a.id === requestedId)) return requestedId;
    return agents[0]?.id ?? null;
  }, [agents, requestedId]);

  useEffect(() => {
    if (selectedId == null) return;
    if (requestedId === selectedId) return;
    const next = new URL(window.location.href);
    next.searchParams.set("agentId", String(selectedId));
    window.history.replaceState(window.history.state, "", `${next.pathname}${next.search}${next.hash}`);
  }, [requestedId, selectedId]);

  const setAgentId = (id: number) => {
    const next = new URL(window.location.href);
    next.searchParams.set("agentId", String(id));
    navigate(`${next.pathname}${next.search}${next.hash}`, { replace: true });
  };

  const selectedAgent = agents.find((a) => a.id === selectedId);

  return {
    agents,
    isLoading: agentsQ.isLoading,
    selectedId,
    selectedAgent,
    setAgentId,
  };
}

/** Agent select + Edit agent — drop into StripePage `actions`. */
export function AgentContextBar({
  agents,
  selectedId,
  onChange,
  showEdit = true,
  showNew = false,
}: {
  agents: Agent[];
  selectedId: number | null;
  onChange: (id: number) => void;
  showEdit?: boolean;
  showNew?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={selectedId != null ? String(selectedId) : undefined}
        onValueChange={(v) => onChange(Number(v))}
      >
        <SelectTrigger className="h-8 w-[180px] bg-background text-xs">
          <SelectValue placeholder="Select agent" />
        </SelectTrigger>
        <SelectContent>
          {agents.map((agent) => (
            <SelectItem key={agent.id} value={String(agent.id)} className="text-xs">
              {agent.name || `Agent ${agent.id}`}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {showNew && (
        <Button asChild variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
          <Link href="/app/agents?create=1">
            <Plus className="size-3.5" />
            New
          </Link>
        </Button>
      )}
      {showEdit && selectedId != null && (
        <Button asChild variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
          <Link href={`/app/agents/${selectedId}`}>
            <Bot className="size-3.5" />
            Edit agent
          </Link>
        </Button>
      )}
    </div>
  );
}
