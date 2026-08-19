/** Pure helpers for team workspace scope — kept free of DB so unit tests can import them. */

export type TeamScopeRow = {
  ownerUserId: string;
  memberUserId: string | null;
  status: string;
  role: string;
};

export function teamRoleCanWrite(role: string | null | undefined): boolean {
  return (role ?? "member") !== "viewer";
}

/**
 * From team_members rows, collect every user id that belongs to a workspace
 * this person owns or has joined.
 */
export function collectWorkspaceUserIds(selfId: string, rows: TeamScopeRow[]): string[] {
  const ids = new Set<string>([selfId]);
  const owners = new Set<string>();
  for (const r of rows) {
    if (r.ownerUserId === selfId) owners.add(r.ownerUserId);
    if (r.status === "active" && r.memberUserId === selfId) owners.add(r.ownerUserId);
  }
  for (const r of rows) {
    if (!owners.has(r.ownerUserId)) continue;
    ids.add(r.ownerUserId);
    if (r.status === "active" && r.memberUserId) ids.add(r.memberUserId);
  }
  return [...ids];
}
