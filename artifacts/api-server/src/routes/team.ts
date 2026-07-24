import { Router, type IRouter } from "express";
import { eq, and, sql } from "drizzle-orm";
import { db, teamMembersTable, usersTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth.js";
import { getAuth } from "../lib/auth-compat.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

let tableEnsured = false;

async function ensureTeamMembersTable(): Promise<void> {
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
        invited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        joined_at TIMESTAMPTZ
      );
    `);
    tableEnsured = true;
  } catch (err) {
    logger.warn({ err }, "Failed to ensure team_members table");
  }
}

/**
 * GET /api/team/members
 * List team members and invitations for the current user's workspace.
 */
router.get("/team/members", requireAuth, async (req, res): Promise<void> => {
  try {
    await ensureTeamMembersTable();
    const auth = getAuth(req);
    const userId = auth.userId;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const members = await db
      .select()
      .from(teamMembersTable)
      .where(eq(teamMembersTable.ownerUserId, userId));

    res.json(members);
  } catch (err) {
    logger.error({ err }, "Failed to fetch team members");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /api/team/invite
 * Invite a new team member by email.
 */
router.post("/team/invite", requireAuth, async (req, res): Promise<void> => {
  try {
    await ensureTeamMembersTable();
    const auth = getAuth(req);
    const ownerUserId = auth.userId;
    if (!ownerUserId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const { email, role, name } = req.body as { email?: string; role?: string; name?: string };
    if (!email || typeof email !== "string" || !email.includes("@")) {
      res.status(400).json({ error: "Valid email address is required" });
      return;
    }

    const memberRole = ["admin", "developer", "member", "viewer"].includes(role ?? "")
      ? (role as string)
      : "member";

    const cleanEmail = email.trim().toLowerCase();

    // Check if already invited
    const [existing] = await db
      .select()
      .from(teamMembersTable)
      .where(and(
        eq(teamMembersTable.ownerUserId, ownerUserId),
        eq(teamMembersTable.email, cleanEmail),
      ));

    if (existing) {
      res.status(409).json({ error: "This email address is already invited or in your team" });
      return;
    }

    // Check if user account already exists for this email
    const [existingUser] = await db
      .select({ id: usersTable.clerkId, name: usersTable.name })
      .from(usersTable)
      .where(eq(usersTable.email, cleanEmail));

    const [created] = await db
      .insert(teamMembersTable)
      .values({
        ownerUserId,
        memberUserId: existingUser?.id ?? null,
        email: cleanEmail,
        name: name?.trim() || existingUser?.name || cleanEmail.split("@")[0],
        role: memberRole,
        status: existingUser ? "active" : "pending",
        joinedAt: existingUser ? new Date() : null,
      })
      .returning();

    res.status(201).json(created);
  } catch (err) {
    logger.error({ err }, "Failed to invite team member");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * DELETE /api/team/members/:id
 * Remove a team member or revoke an invite.
 */
router.delete("/team/members/:id", requireAuth, async (req, res): Promise<void> => {
  try {
    await ensureTeamMembersTable();
    const auth = getAuth(req);
    const userId = auth.userId;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const rawId = req.params["id"];
    const idStr = Array.isArray(rawId) ? rawId[0] : rawId;
    const memberId = parseInt(idStr ?? "0", 10);
    if (!Number.isFinite(memberId) || memberId <= 0) {
      res.status(400).json({ error: "Invalid member ID" });
      return;
    }

    await db
      .delete(teamMembersTable)
      .where(and(
        eq(teamMembersTable.id, memberId),
        eq(teamMembersTable.ownerUserId, userId),
      ));

    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "Failed to remove team member");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
