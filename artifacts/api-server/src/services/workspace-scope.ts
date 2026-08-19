/**
 * Shared workspace scope for Team invites.
 *
 * Agents are stored under the creator's userId. Inviting a teammate used to
 * write a team_members row and email /app/join?token=… but listing still
 * filtered `agents.userId = me`, so the teammate saw an empty Agents page.
 * Resolve the owner + every active member so they share one agent list.
 */
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { db, teamMembersTable, usersTable } from "@workspace/db";
import { logger } from "../lib/logger.js";
import { collectWorkspaceUserIds, teamRoleCanWrite, type TeamScopeRow } from "./workspace-scope-logic.js";

export { collectWorkspaceUserIds, teamRoleCanWrite } from "./workspace-scope-logic.js";

export interface WorkspaceScope {
  /** User ids whose agents this caller may see. Always includes self. */
  userIds: string[];
  /** Workspace owner (self when not a member of someone else's team). */
  ownerUserId: string;
  /** False for the viewer role on a team they do not own. */
  canWrite: boolean;
  isOwner: boolean;
}

let tableEnsured = false;

export async function ensureTeamMembersTable(): Promise<void> {
  if (tableEnsured) return;
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS team_members (
        id SERIAL PRIMARY KEY,
        owner_user_id TEXT NOT NULL,
        member_user_id TEXT,
        email TEXT NOT NULL,
        name TEXT,
        role TEXT NOT NULL DEFAULT 'member',
        status TEXT NOT NULL DEFAULT 'pending',
        token TEXT,
        invited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        joined_at TIMESTAMPTZ
      );
    `);
    await db.execute(sql`ALTER TABLE team_members ADD COLUMN IF NOT EXISTS token TEXT`);
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS team_members_token_unique ON team_members (token)`);
    tableEnsured = true;
  } catch (err) {
    logger.warn({ err }, "Failed to ensure team_members table");
  }
}

/** Bind pending invites addressed to this user's email so login completes the join. */
export async function claimPendingTeamInvites(clerkId: string, email: string | null | undefined): Promise<number> {
  const clean = (email ?? "").trim().toLowerCase();
  if (!clean) return 0;
  const claimed = await db
    .update(teamMembersTable)
    .set({
      memberUserId: clerkId,
      status: "active",
      joinedAt: new Date(),
    })
    .where(and(
      eq(teamMembersTable.email, clean),
      eq(teamMembersTable.status, "pending"),
    ))
    .returning({ id: teamMembersTable.id });
  return claimed.length;
}

export async function resolveWorkspaceScope(clerkId: string): Promise<WorkspaceScope> {
  await ensureTeamMembersTable();

  const [me] = await db
    .select({ email: usersTable.email })
    .from(usersTable)
    .where(eq(usersTable.clerkId, clerkId));
  const claimed = await claimPendingTeamInvites(clerkId, me?.email);
  if (claimed > 0) {
    logger.info({ clerkId, claimed }, "Team invites claimed on workspace resolve");
  }

  const mine = await db
    .select({
      ownerUserId: teamMembersTable.ownerUserId,
      memberUserId: teamMembersTable.memberUserId,
      status: teamMembersTable.status,
      role: teamMembersTable.role,
    })
    .from(teamMembersTable)
    .where(or(
      eq(teamMembersTable.ownerUserId, clerkId),
      eq(teamMembersTable.memberUserId, clerkId),
    ));

  const ownerIds = new Set<string>();
  for (const r of mine) {
    if (r.ownerUserId === clerkId) ownerIds.add(clerkId);
    if (r.status === "active" && r.memberUserId === clerkId) ownerIds.add(r.ownerUserId);
  }

  let rows: TeamScopeRow[] = mine;
  if (ownerIds.size > 0) {
    rows = await db
      .select({
        ownerUserId: teamMembersTable.ownerUserId,
        memberUserId: teamMembersTable.memberUserId,
        status: teamMembersTable.status,
        role: teamMembersTable.role,
      })
      .from(teamMembersTable)
      .where(inArray(teamMembersTable.ownerUserId, [...ownerIds]));
  }

  const userIds = collectWorkspaceUserIds(clerkId, rows);
  const isOwner = ownerIds.has(clerkId);
  let canWrite = isOwner;
  if (!canWrite) {
    const membership = rows.find((r) => r.status === "active" && r.memberUserId === clerkId);
    canWrite = teamRoleCanWrite(membership?.role);
  }

  const ownerUserId = isOwner
    ? clerkId
    : (rows.find((r) => r.status === "active" && r.memberUserId === clerkId)?.ownerUserId ?? clerkId);

  return { userIds, ownerUserId, canWrite, isOwner };
}
