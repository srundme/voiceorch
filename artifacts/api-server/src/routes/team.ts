import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, teamMembersTable, usersTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth.js";
import { getAuth } from "../lib/auth-compat.js";
import { logger } from "../lib/logger.js";
import { sendBrevoEmail } from "../services/brevo.js";
import { getSelfBaseUrl } from "../lib/app-domain.js";
import { ensureTeamMembersTable, claimPendingTeamInvites } from "../services/workspace-scope.js";

const router: IRouter = Router();

async function dispatchInviteEmail(
  email: string,
  ownerUserId: string,
  teamMemberId: number,
  role: string,
): Promise<void> {
  const [inviter] = await db
    .select({ name: usersTable.name, email: usersTable.email })
    .from(usersTable)
    .where(eq(usersTable.clerkId, ownerUserId));

  const inviterName = inviter?.name || inviter?.email?.split("@")[0] || "A colleague";
  const appBase = process.env["APP_BASE_URL"]?.replace(/\/$/, "") || getSelfBaseUrl();
  const inviteUrl = `${appBase}/app/join?teamId=${teamMemberId}`;
  const roleLabel = role.charAt(0).toUpperCase() + role.slice(1);

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
        <p>You have been invited to collaborate on <strong>SnapServe Voice AI</strong> with the <strong>${roleLabel}</strong> role.</p>
        
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
    email,
    `${inviterName} invited you to join their team on SnapServe AI`,
    htmlContent,
    undefined,
    { emailType: "team_invite" },
  );
  logger.info({ email, ownerUserId, teamMemberId }, "Team invite email dispatched via Brevo");
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

    if (members.length > 0) {
      res.json(members);
      return;
    }

    // Teammate view: show the workspace they joined, not an empty owner list.
    const [me] = await db
      .select({ email: usersTable.email })
      .from(usersTable)
      .where(eq(usersTable.clerkId, userId));
    await claimPendingTeamInvites(userId, me?.email);

    const [membership] = await db
      .select()
      .from(teamMembersTable)
      .where(and(
        eq(teamMembersTable.memberUserId, userId),
        eq(teamMembersTable.status, "active"),
      ));

    if (!membership) {
      res.json([]);
      return;
    }

    const workspace = await db
      .select()
      .from(teamMembersTable)
      .where(eq(teamMembersTable.ownerUserId, membership.ownerUserId));
    res.json(workspace);
  } catch (err) {
    logger.error({ err }, "Failed to fetch team members");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /api/team/invite
 * Invite a new team member by email or re-send invite if pending.
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
      if (existing.status === "active") {
        res.status(409).json({ error: "This email address has already accepted the invite and joined your team" });
        return;
      }

      // Existing pending invite — update role/invitedAt and re-send email
      const [updated] = await db
        .update(teamMembersTable)
        .set({
          role: memberRole,
          name: name?.trim() || existing.name,
          invitedAt: new Date(),
        })
        .where(eq(teamMembersTable.id, existing.id))
        .returning();

      try {
        await dispatchInviteEmail(cleanEmail, ownerUserId, existing.id, memberRole);
      } catch (emailErr) {
        logger.warn({ emailErr, cleanEmail }, "Failed to re-send team invite email via Brevo");
      }

      res.status(200).json({ ...updated, reSent: true });
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

    // Dispatch email invitation
    try {
      await dispatchInviteEmail(cleanEmail, ownerUserId, created!.id, memberRole);
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
 * POST /api/team/members/:id/resend
 * Re-send invitation email for a pending team member.
 */
router.post("/team/members/:id/resend", requireAuth, async (req, res): Promise<void> => {
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

    const [member] = await db
      .select()
      .from(teamMembersTable)
      .where(and(
        eq(teamMembersTable.id, memberId),
        eq(teamMembersTable.ownerUserId, userId),
      ));

    if (!member) {
      res.status(404).json({ error: "Team member not found" });
      return;
    }

    await db
      .update(teamMembersTable)
      .set({ invitedAt: new Date() })
      .where(eq(teamMembersTable.id, memberId));

    await dispatchInviteEmail(member.email, userId, member.id, member.role);
    res.json({ success: true, email: member.email });
  } catch (err) {
    logger.error({ err }, "Failed to resend team invite email");
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

/**
 * GET /api/team/invite-preview?teamId=
 * Details for the /app/join page. Auth required so we can check email match.
 */
router.get("/team/invite-preview", requireAuth, async (req, res): Promise<void> => {
  try {
    await ensureTeamMembersTable();
    const auth = getAuth(req);
    const userId = auth.userId;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const teamId = parseInt(String(req.query["teamId"] ?? ""), 10);
    if (!Number.isFinite(teamId) || teamId <= 0) {
      res.status(400).json({ error: "Invalid invitation" });
      return;
    }

    const [invite] = await db
      .select()
      .from(teamMembersTable)
      .where(eq(teamMembersTable.id, teamId));
    if (!invite) {
      res.status(404).json({ error: "Invitation not found" });
      return;
    }

    const [owner] = await db
      .select({ name: usersTable.name, email: usersTable.email })
      .from(usersTable)
      .where(eq(usersTable.clerkId, invite.ownerUserId));
    const [me] = await db
      .select({ email: usersTable.email })
      .from(usersTable)
      .where(eq(usersTable.clerkId, userId));

    const myEmail = (me?.email ?? "").trim().toLowerCase();
    const alreadyJoined = invite.status === "active" && invite.memberUserId === userId;

    res.json({
      id: invite.id,
      email: invite.email,
      role: invite.role,
      status: alreadyJoined ? "accepted" : invite.status,
      ownerName: owner?.name || owner?.email?.split("@")[0] || "A teammate",
      emailMatch: !!myEmail && myEmail === invite.email,
      signedInEmail: me?.email ?? null,
    });
  } catch (err) {
    logger.error({ err }, "Failed to preview team invite");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /api/team/join { teamId }
 * Accept the emailed invite and bind this login to the owner's workspace.
 */
router.post("/team/join", requireAuth, async (req, res): Promise<void> => {
  try {
    await ensureTeamMembersTable();
    const auth = getAuth(req);
    const userId = auth.userId;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const teamId = parseInt(String((req.body as { teamId?: unknown })?.teamId ?? ""), 10);
    if (!Number.isFinite(teamId) || teamId <= 0) {
      res.status(400).json({ error: "Invalid invitation" });
      return;
    }

    const [invite] = await db
      .select()
      .from(teamMembersTable)
      .where(eq(teamMembersTable.id, teamId));
    if (!invite) {
      res.status(404).json({ error: "Invitation not found" });
      return;
    }

    const [me] = await db
      .select({ email: usersTable.email, name: usersTable.name })
      .from(usersTable)
      .where(eq(usersTable.clerkId, userId));
    const myEmail = (me?.email ?? "").trim().toLowerCase();
    if (!myEmail || myEmail !== invite.email) {
      res.status(403).json({
        error: `This invitation was sent to ${invite.email}. Sign in with that email to join.`,
      });
      return;
    }

    if (invite.status === "active" && invite.memberUserId === userId) {
      res.json({ joined: true, already: true, ownerUserId: invite.ownerUserId });
      return;
    }
    if (invite.status === "active" && invite.memberUserId && invite.memberUserId !== userId) {
      res.status(409).json({ error: "This invitation has already been accepted by another account" });
      return;
    }

    await db
      .update(teamMembersTable)
      .set({
        memberUserId: userId,
        name: me?.name || invite.name,
        status: "active",
        joinedAt: invite.joinedAt ?? new Date(),
      })
      .where(eq(teamMembersTable.id, invite.id));

    logger.info({ userId, teamId: invite.id, ownerUserId: invite.ownerUserId }, "Team invite accepted");
    res.json({ joined: true, already: false, ownerUserId: invite.ownerUserId });
  } catch (err) {
    logger.error({ err }, "Failed to accept team invite");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
