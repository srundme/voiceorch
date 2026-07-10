import { Router } from "express";
import { db, usersTable, platformEmailsTable } from "@workspace/db";
import { eq, desc, ilike, or, sql } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAdmin.js";
import { sendBrevoEmail } from "../services/brevo.js";
import { logger } from "../lib/logger.js";

const router = Router();
router.use("/admin", requireAdmin);

// ─── List all platform emails ─────────────────────────────────────────────────

router.get("/admin/emails", async (req, res): Promise<void> => {
  try {
    const page = Math.max(1, parseInt(req.query["page"] as string || "1", 10));
    const pageSize = 50;
    const userId = req.query["userId"] as string | undefined;
    const search = req.query["search"] as string | undefined;

    const whereConditions = [];
    if (userId) {
      whereConditions.push(eq(platformEmailsTable.toUserId, userId));
    }
    if (search) {
      whereConditions.push(
        or(
          ilike(platformEmailsTable.toEmail, `%${search}%`),
          ilike(platformEmailsTable.subject, `%${search}%`),
          ilike(platformEmailsTable.emailType, `%${search}%`),
        ),
      );
    }

    const where = whereConditions.length === 1
      ? whereConditions[0]
      : whereConditions.length > 1
        ? sql`${whereConditions.reduce((a, b) => sql`${a} AND ${b}`)}`
        : undefined;

    const [rows, [{ total }]] = await Promise.all([
      db
        .select({
          id: platformEmailsTable.id,
          toEmail: platformEmailsTable.toEmail,
          toUserId: platformEmailsTable.toUserId,
          toName: platformEmailsTable.toName,
          subject: platformEmailsTable.subject,
          sentBy: platformEmailsTable.sentBy,
          emailType: platformEmailsTable.emailType,
          status: platformEmailsTable.status,
          errorMessage: platformEmailsTable.errorMessage,
          sentAt: platformEmailsTable.sentAt,
        })
        .from(platformEmailsTable)
        .where(where)
        .orderBy(desc(platformEmailsTable.sentAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      db
        .select({ total: sql<number>`count(*)::int` })
        .from(platformEmailsTable)
        .where(where),
    ]);

    res.json({ data: rows, total, page, pageSize });
  } catch (err) {
    req.log.error({ err }, "admin/emails list failed");
    res.status(500).json({ error: "Failed to list emails" });
  }
});

// ─── Get full email body ──────────────────────────────────────────────────────

router.get("/admin/emails/:id", async (req, res): Promise<void> => {
  try {
    const [row] = await db
      .select()
      .from(platformEmailsTable)
      .where(eq(platformEmailsTable.id, parseInt(req.params["id"], 10)));

    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch (err) {
    req.log.error({ err }, "admin/emails/:id failed");
    res.status(500).json({ error: "Failed to fetch email" });
  }
});

// ─── Send manual email ────────────────────────────────────────────────────────

router.post("/admin/emails/send", async (req, res): Promise<void> => {
  const { toEmail, toUserId, toName, subject, htmlBody, emailType } = req.body as {
    toEmail: string;
    toUserId?: string;
    toName?: string;
    subject: string;
    htmlBody: string;
    emailType?: string;
  };

  if (!toEmail || !subject || !htmlBody) {
    res.status(400).json({ error: "toEmail, subject, and htmlBody are required" });
    return;
  }

  let status = "sent";
  let errorMessage: string | null = null;

  try {
    await sendBrevoEmail(toEmail, subject, htmlBody);
    logger.info({ toEmail, subject }, "Manual admin email sent");
  } catch (err) {
    status = "failed";
    errorMessage = String(err);
    logger.warn({ err, toEmail }, "Manual admin email failed");
  }

  try {
    const [logged] = await db
      .insert(platformEmailsTable)
      .values({
        toEmail,
        toUserId: toUserId ?? null,
        toName: toName ?? null,
        subject,
        htmlBody,
        sentBy: "admin",
        emailType: emailType ?? "manual",
        status,
        errorMessage,
      })
      .returning();

    if (status === "failed") {
      res.status(502).json({ error: "Email send failed", detail: errorMessage, logged });
    } else {
      res.json({ success: true, email: logged });
    }
  } catch (err) {
    req.log.error({ err }, "Failed to log email to DB");
    if (status === "failed") {
      res.status(502).json({ error: "Email send failed", detail: errorMessage });
    } else {
      res.json({ success: true });
    }
  }
});

// ─── Quick helper: send to a specific user by clerkId ────────────────────────

router.post("/admin/users/:clerkId/send-email", async (req, res): Promise<void> => {
  const { clerkId } = req.params as { clerkId: string };
  const { subject, htmlBody, emailType } = req.body as {
    subject: string;
    htmlBody: string;
    emailType?: string;
  };

  if (!subject || !htmlBody) {
    res.status(400).json({ error: "subject and htmlBody are required" });
    return;
  }

  try {
    const [user] = await db
      .select({ email: usersTable.email, name: usersTable.name })
      .from(usersTable)
      .where(eq(usersTable.clerkId, clerkId));

    if (!user?.email) {
      res.status(404).json({ error: "User not found or has no email" });
      return;
    }

    let status = "sent";
    let errorMessage: string | null = null;

    try {
      await sendBrevoEmail(user.email, subject, htmlBody);
      logger.info({ toEmail: user.email, subject, clerkId }, "Admin email to user sent");
    } catch (err) {
      status = "failed";
      errorMessage = String(err);
      logger.warn({ err, toEmail: user.email }, "Admin email to user failed");
    }

    const [logged] = await db
      .insert(platformEmailsTable)
      .values({
        toEmail: user.email,
        toUserId: clerkId,
        toName: user.name ?? null,
        subject,
        htmlBody,
        sentBy: "admin",
        emailType: emailType ?? "manual",
        status,
        errorMessage,
      })
      .returning();

    if (status === "failed") {
      res.status(502).json({ error: "Email send failed", detail: errorMessage, logged });
    } else {
      res.json({ success: true, email: logged });
    }
  } catch (err) {
    req.log.error({ err }, "admin/users/:clerkId/send-email failed");
    res.status(500).json({ error: "Internal error" });
  }
});

export default router;
