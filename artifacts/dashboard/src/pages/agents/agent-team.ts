/**
 * Shared squad → agent membership helpers for Agent Builder list + chrome.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";

export type SquadMemberRow = {
  agentId: number;
  agentName?: string | null;
  roleName: string;
  sortOrder?: number;
};

export type SquadRow = {
  id: number;
  name: string;
  status: string;
  members: SquadMemberRow[];
};

export type TeammateRef = {
  agentId: number;
  agentName: string;
  roleName: string;
  sortOrder: number;
};

export type AgentTeamMembership = {
  squadId: number;
  squadName: string;
  roleName: string;
  sortOrder: number;
  mates: TeammateRef[];
  members: TeammateRef[];
};

export const SQUADS_QUERY_KEY = ["squads"] as const;

export function buildAgentTeamMap(squads: SquadRow[] | undefined | null): Map<number, AgentTeamMembership> {
  const map = new Map<number, AgentTeamMembership>();
  for (const squad of squads ?? []) {
    const members: TeammateRef[] = (squad.members ?? [])
      .map((m, i) => ({
        agentId: m.agentId,
        agentName: (m.agentName ?? m.roleName ?? `Agent ${m.agentId}`).trim() || `Agent ${m.agentId}`,
        roleName: m.roleName?.trim() || "Member",
        sortOrder: m.sortOrder ?? i,
      }))
      .sort((a, b) => a.sortOrder - b.sortOrder || a.agentName.localeCompare(b.agentName));

    for (const m of members) {
      // First squad wins if an agent is on multiple teams (rare).
      if (map.has(m.agentId)) continue;
      map.set(m.agentId, {
        squadId: squad.id,
        squadName: squad.name,
        roleName: m.roleName,
        sortOrder: m.sortOrder,
        mates: members.filter((x) => x.agentId !== m.agentId),
        members,
      });
    }
  }
  return map;
}

export function useAgentTeamMap() {
  const q = useQuery({
    queryKey: SQUADS_QUERY_KEY,
    queryFn: () => customFetch<SquadRow[]>("/api/squads"),
    staleTime: 30_000,
  });
  const teamByAgentId = useMemo(() => buildAgentTeamMap(q.data), [q.data]);
  return { teamByAgentId, isLoading: q.isLoading, squads: q.data ?? [] };
}

/** Sort so same-team agents sit together; solos keep relative createdAt order. */
export function sortAgentsByTeam<T extends { id: number; name: string; createdAt?: string | null }>(
  agents: T[],
  teamByAgentId: Map<number, AgentTeamMembership>,
): T[] {
  return [...agents].sort((a, b) => {
    const ta = teamByAgentId.get(a.id);
    const tb = teamByAgentId.get(b.id);
    if (ta && tb) {
      if (ta.squadId !== tb.squadId) return ta.squadName.localeCompare(tb.squadName) || ta.squadId - tb.squadId;
      if (ta.sortOrder !== tb.sortOrder) return ta.sortOrder - tb.sortOrder;
      return a.name.localeCompare(b.name);
    }
    if (ta && !tb) return -1;
    if (!ta && tb) return 1;
    const ca = new Date(a.createdAt ?? 0).getTime();
    const cb = new Date(b.createdAt ?? 0).getTime();
    return cb - ca;
  });
}

export function agentPathWithSection(agentId: number, section?: string | null): string {
  const base = `/app/agents/${agentId}`;
  if (!section) return base;
  return `${base}?section=${encodeURIComponent(section)}`;
}
