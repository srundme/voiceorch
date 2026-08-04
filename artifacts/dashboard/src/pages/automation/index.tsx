/**
 * Automation builder — how leads reach agents (forms, sheets, lists, rules, journeys).
 * Separate from the agent builder, which only configures the agent itself.
 */

import { useEffect, useMemo } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { Bot, Loader2, Plus, Workflow } from "lucide-react";
import {
  getGetAgentQueryKey,
  getListAgentsQueryKey,
  useGetAgent,
  useListAgents,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ReachPanel } from "@/pages/agents/reach-panel";

function agentIdFromSearch(search: string): number | null {
  const raw = new URLSearchParams(search).get("agentId");
  if (!raw) return null;
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export default function AutomationPage() {
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

  const agentQ = useGetAgent(selectedId ?? 0, {
    query: {
      queryKey: getGetAgentQueryKey(selectedId ?? 0),
      enabled: selectedId != null,
      staleTime: 20_000,
    },
  });
  const selectedAgent = agentQ.data ?? agents.find((a) => a.id === selectedId);
  const webhookUrl =
    selectedAgent && typeof (selectedAgent as { webhookUrl?: string }).webhookUrl === "string"
      ? (selectedAgent as { webhookUrl?: string }).webhookUrl
      : null;

  const setAgentId = (id: number) => {
    const next = new URL(window.location.href);
    next.searchParams.set("agentId", String(id));
    navigate(`${next.pathname}${next.search}${next.hash}`, { replace: true });
  };

  if (agentsQ.isLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  if (agents.length === 0) {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center px-6 py-20 text-center">
        <div className="mb-4 flex size-12 items-center justify-center rounded-xl border border-border bg-card">
          <Workflow className="size-5 text-muted-foreground" />
        </div>
        <h1 className="text-lg font-semibold tracking-tight">Build automation</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Create an agent first, then wire forms, sheets, lists, call rules, and after-call journeys here.
        </p>
        <Button asChild className="mt-6 gap-1.5">
          <Link href="/app/agents?create=1">
            <Plus className="size-4" />
            Create agent
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-border/70 bg-background/95 px-4 py-3 sm:px-6">
        <div className="mx-auto flex max-w-[920px] flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">
              Operate
            </p>
            <h1 className="text-[15px] font-semibold tracking-[-0.02em]">Automation</h1>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              Lead sources, dial flows, call rules, and journeys — separate from agent prompt & voice.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={selectedId != null ? String(selectedId) : undefined}
              onValueChange={(v) => setAgentId(Number(v))}
            >
              <SelectTrigger className="h-8 w-[200px] bg-background text-xs">
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
            {selectedId != null && (
              <Button asChild variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
                <Link href={`/app/agents/${selectedId}`}>
                  <Bot className="size-3.5" />
                  Edit agent
                </Link>
              </Button>
            )}
          </div>
        </div>
      </div>

      {selectedId != null && (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[920px]">
            <ReachPanel
              agentId={selectedId}
              agentName={selectedAgent?.name}
              webhookUrl={webhookUrl}
              heading="Sources & sequences"
              onOpenChannels={() => navigate(`/app/channels?agentId=${selectedId}`)}
              onConfigureEmail={() => navigate(`/app/channels?agentId=${selectedId}&channel=email`)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
