import { Router, type IRouter } from "express";
import { eq, and, sql } from "drizzle-orm";
import { db, teamMembersTable, usersTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth.js";
import { getAuth } from "../lib/auth-compat.js";
import { logger } from "../lib/logger.js";
import { sendBrevoEmail } from "../services/brevo.js";
import { getSelfBaseUrl } from "../lib/app-domain.js";

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

    // Fetch inviter info for email template
    const [inviter] = await db
      .select({ name: usersTable.name, email: usersTable.email })
      .from(usersTable)
      .where(eq(usersTable.clerkId, ownerUserId));

    const inviterName = inviter?.name || inviter?.email?.split("@")[0] || "A colleague";
    const appBase = process.env["APP_BASE_URL"]?.replace(/\/$/, "") || getSelfBaseUrl();
    const inviteUrl = `${appBase}/app/join?teamId=${created?.id}`;
    const roleLabel = memberRole.charAt(0).toUpperCase() + memberRole.slice(1);

    // Send email invitation via Brevo SMTP
    try {
      const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #09090b; color: #f4f4f5; margin: 0; padding: 40px 20px; }
            .container { max-width: 560px; margin: 0 auto; background-color: #18181b; border: 1px solid #27272a; border-radius: 16px; padding: 32px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
            .badge { display: inline-block; padding: 4px 12px; background: rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.3); border-radius: 9999px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 20px; }
            h1 { font-size: 22px; font-weight: 700; color: #ffffff; margin: 0 0 12px 0; }
            p { font-size: 14px; line-height: 1.6; color: #a1a1aa; margin: 0 0 24px 0; }
            .role-card { background: #27272a; border-radius: 8px; padding: 14px 16px; margin-bottom: 24px; font-size: 13px; color: #f4f4f5; }
            .btn { display: inline-block; width: 100%; text-align: center; background-color: #f59e0b; color: #000000; font-weight: 700; font-size: 14px; padding: 14px 24px; text-decoration: none; border-radius: 10px; box-sizing: border-box; }
            .footer { margin-top: 32px; text-align: center; font-size: 11px; color: #71717a; border-top: 1px solid #27272a; padding-top: 20px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="badge">Team Invitation</div>
            <h1>You're invited to join ${inviterName}'s team on SnapServe AI</h1>
            <p>You have been invited to collaborate on <strong>SnapServe Voice & Vision AI</strong> with the <strong>${roleLabel}</strong> role.</p>
            
            <div class="role-card">
              <strong>Assigned Role:</strong> ${roleLabel}
              <br><span style="color: #a1a1aa; font-size: 12px;">Access agents, voice campaigns, squads, and call analytics.</span>
            </div>

            <a href="${inviteUrl}" class="btn">Accept Invitation & Join Team</a>

            <div class="footer">
              If you didn't expect this invitation, you can safely ignore this email.
              <br>© ${new Date().getFullYear()} SnapServe AI. All rights reserved.
            </div>
          </div>
        </body>
        </html>
      `;

      await sendBrevoEmail(
        cleanEmail,
        `${inviterName} invited you to join their team on SnapServe AI`,
        htmlContent,
        undefined,
        { emailType: "team_invite" },
      );
      logger.info({ cleanEmail, ownerUserId }, "Team invite email dispatched via Brevo");
    } catch (emailErr) {
      logger.warn({ emailErr, cleanEmail }, "Failed to send team invite email via Brevo");
    }

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
