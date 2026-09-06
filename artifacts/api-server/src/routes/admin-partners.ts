/**
 * admin-partners.ts — Admin management of partner (reseller) accounts.
 *
 * Admin creates partners by upgrading an existing user (by email), controls
 * the base rate the platform charges the partner per client-minute, and can
 * suspend a partner (suspended → clients bill at the standard flat rate and
 * no spread accrues; see services/partner-billing.ts).
 */

import { Router, type Request } from "express";
import {
  db,
  usersTable,
  partnersTable,
  partnerInvitesTable,
  partnerPendingPromotionsTable,
  walletTransactionsTable,
  adminAuditLogsTable,
} from "@workspace/db";
import { and, desc, eq, gte, sql, count, inArray } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAdmin.js";
import { claimPendingAndPromote } from "../services/partner-promotion.js";
import { subdomainHostForSlug } from "../services/partner-domains-normalize.js";

const router: Router = Router();
router.use("/admin/partners", requireAdmin);

const MAX_RATE_CENTS_PER_MIN = 100_000;

/** Public portal URL clients use to sign in (custom domain wins when active). */
function partnerPortalUrl(p: {
  slug: string | null;
  customDomain: string | null;
  customDomainStatus: string | null;
}): string | null {
  if (p.customDomainStatus === "active" && p.customDomain) {
    return `https://${p.customDomain}`;
  }
  if (p.slug) {
    return `https://${subdomainHostForSlug(p.slug)}`;
  }
  return null;
}

async function logAdminAction(
  req: Request,
  opts: {
    targetUserId?: string | null;
    action: string;
    beforeValue?: unknown;
    afterValue?: unknown;
  },
) {
  try {
    await db.insert(adminAuditLogsTable).values({
      adminId: "admin",
      targetUserId: opts.targetUserId ?? null,
      targetResourceType: "partner",
      action: opts.action,
      beforeValue: opts.beforeValue !== undefined ? (opts.beforeValue as any) : null,
      afterValue: opts.afterValue !== undefined ? (opts.afterValue as any) : null,
      ipAddress: ((req.headers["x-forwarded-for"] as string) ?? req.ip ?? null),
      userAgent: req.headers["user-agent"] ?? null,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to write admin audit log (partners)");
  }
}

router.get("/admin/partners", async (req, res): Promise<void> => {
  try {
    const partners = await db
      .select({
        id: partnersTable.id,
        userId: partnersTable.userId,
        companyName: partnersTable.companyName,
        status: partnersTable.status,
        baseRateCentsPerMin: partnersTable.baseRateCentsPerMin,
        defaultClientRateCentsPerMin: partnersTable.defaultClientRateCentsPerMin,
        slug: partnersTable.slug,
        customDomain: partnersTable.customDomain,
        customDomainStatus: partnersTable.customDomainStatus,
        createdAt: partnersTable.createdAt,
        userName: usersTable.name,
        userEmail: usersTable.email,
        walletBalanceCents: usersTable.walletBalanceCents,
      })
      .from(partnersTable)
      .leftJoin(usersTable, eq(partnersTable.userId, usersTable.clerkId))
      .orderBy(desc(partnersTable.createdAt));

    // Client counts per partner (single grouped query).
    const counts = await db
      .select({ partnerId: usersTable.partnerId, n: count() })
      .from(usersTable)
      .where(sql`${usersTable.partnerId} is not null`)
      .groupBy(usersTable.partnerId);
    const countMap = new Map<number, number>();
    for (const c of counts) {
      if (c.partnerId != null) countMap.set(c.partnerId, Number(c.n));
    }

    // Admin-created partner setups still waiting to be applied. Google
    // signups consume these automatically (verified email); password signups
    // can't prove email ownership, so they wait for explicit admin approval —
    // flag rows whose email now has an account so the UI offers "Approve".
    const pendingRows = await db
      .select()
      .from(partnerPendingPromotionsTable)
      .orderBy(desc(partnerPendingPromotionsTable.createdAt));
    let accountEmails = new Set<string>();
    if (pendingRows.length > 0) {
      const accounts = await db
        .select({ email: usersTable.email })
        .from(usersTable)
        .where(inArray(sql`lower(${usersTable.email})`, pendingRows.map(p => p.email)));
      accountEmails = new Set(accounts.map(a => (a.email ?? "").toLowerCase()));
    }

    res.json({
      partners: partners.map(p => ({
        ...p,
        clientCount: countMap.get(p.id) ?? 0,
        portalUrl: partnerPortalUrl(p),
      })),
      pending: pendingRows.map(p => ({ ...p, hasAccount: accountEmails.has(p.email) })),
    });
  } catch (err) {
    req.log.error({ err }, "admin/partners GET failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/admin/partners", async (req, res): Promise<void> => {
  try {
    const { email, companyName, baseRateCentsPerMin, defaultClientRateCentsPerMin, clerkId } = (req.body ?? {}) as {
      email?: string;
      companyName?: string;
      baseRateCentsPerMin?: number;
      defaultClientRateCentsPerMin?: number;
      /** When set (e.g. from user detail), promote this exact account — not another row with the same email. */
      clerkId?: string;
    };

    const cleanEmail = String(email ?? "").trim().toLowerCase();
    const cleanCompany = String(companyName ?? "").trim().slice(0, 80);
    if (!cleanEmail || !cleanEmail.includes("@")) {
      res.status(400).json({ error: "Valid user email is required" });
      return;
    }
    if (cleanCompany.length < 2) {
      res.status(400).json({ error: "Company name must be at least 2 characters" });
      return;
    }
    const baseRate = baseRateCentsPerMin === undefined ? 500 : Number(baseRateCentsPerMin);
    if (!Number.isInteger(baseRate) || baseRate < 0 || baseRate > MAX_RATE_CENTS_PER_MIN) {
      res.status(400).json({ error: "baseRateCentsPerMin must be an integer between 0 and 100000" });
      return;
    }
    const defaultRate = defaultClientRateCentsPerMin === undefined ? Math.max(baseRate, 500) : Number(defaultClientRateCentsPerMin);
    if (!Number.isInteger(defaultRate) || defaultRate < baseRate || defaultRate > MAX_RATE_CENTS_PER_MIN) {
      res.status(400).json({ error: "defaultClientRateCentsPerMin must be an integer >= baseRateCentsPerMin" });
      return;
    }

    // Case-insensitive: admin edits can store mixed-case emails, and missing
    // an existing user here would wrongly create a pending row instead.
    // Prefer clerkId when provided so duplicate-email accounts (email:… vs Google)
    // don't promote the wrong row.
    const cleanClerkId = typeof clerkId === "string" ? clerkId.trim() : "";
    const [user] = cleanClerkId
      ? await db.select().from(usersTable).where(eq(usersTable.clerkId, cleanClerkId)).limit(1)
      : await db.select().from(usersTable).where(sql`lower(${usersTable.email}) = ${cleanEmail}`).limit(1);
    if (cleanClerkId && user && user.email && user.email.trim().toLowerCase() !== cleanEmail) {
      res.status(400).json({ error: "clerkId does not match the given email" });
      return;
    }
    if (!user) {
      // No account with this email yet — store a pending promotion that is
      // applied automatically the moment this email signs up (see
      // services/partner-promotion.ts, called from every signup path).
      const [alreadyPending] = await db
        .select({ id: partnerPendingPromotionsTable.id })
        .from(partnerPendingPromotionsTable)
        .where(eq(partnerPendingPromotionsTable.email, cleanEmail));
      if (alreadyPending) {
        res.status(409).json({ error: "A pending partner setup already exists for this email" });
        return;
      }
      const [pending] = await db
        .insert(partnerPendingPromotionsTable)
        .values({
          email: cleanEmail,
          companyName: cleanCompany,
          baseRateCentsPerMin: baseRate,
          defaultClientRateCentsPerMin: defaultRate,
        })
        .returning();
      await logAdminAction(req, {
        action: "partner_pending_create",
        afterValue: { email: cleanEmail, companyName: cleanCompany, baseRate, defaultRate },
      });

      // Race close: the user may have signed up between the lookup above and
      // the pending insert — nobody would ever re-check the row. If they
      // appeared and pass the same guards, apply it right now (admin-initiated
      // ⇒ admin-approved).
      const [lateUser] = await db.select().from(usersTable).where(sql`lower(${usersTable.email}) = ${cleanEmail}`);
      if (lateUser && lateUser.status === "active" && !lateUser.partnerId) {
        const applied = await claimPendingAndPromote(pending!.id, lateUser);
        if (applied.status === "promoted") {
          await logAdminAction(req, {
            targetUserId: lateUser.clerkId,
            action: "partner_create",
            afterValue: { partnerId: applied.partner!.id, companyName: cleanCompany, baseRate, defaultRate, viaPendingRace: true },
          });
          res.status(201).json({ partner: applied.partner });
          return;
        }
      }
      res.status(201).json({ pending });
      return;
    }
    if (user.status !== "active") {
      res.status(400).json({ error: `User account is ${user.status} — reactivate it first` });
      return;
    }
    if (user.partnerId) {
      res.status(409).json({ error: "This user is a client of another partner and cannot become a partner" });
      return;
    }
    const [existing] = await db.select({ id: partnersTable.id }).from(partnersTable).where(eq(partnersTable.userId, user.clerkId));
    if (existing) {
      res.status(409).json({ error: "This user is already a partner" });
      return;
    }

    // Email was fixed onto an account after a pending row was created — promote that.
    const [pendingForEmail] = await db
      .select()
      .from(partnerPendingPromotionsTable)
      .where(eq(partnerPendingPromotionsTable.email, cleanEmail))
      .limit(1);
    if (pendingForEmail) {
      const applied = await claimPendingAndPromote(pendingForEmail.id, user);
      if (applied.status === "promoted") {
        await logAdminAction(req, {
          targetUserId: user.clerkId,
          action: "partner_create",
          afterValue: {
            partnerId: applied.partner!.id,
            companyName: pendingForEmail.companyName,
            viaPendingApply: true,
          },
        });
        res.status(201).json({ partner: applied.partner });
        return;
      }
      if (applied.status === "already_partner") {
        res.status(409).json({ error: "This user is already a partner" });
        return;
      }
    }

    const [partner] = await db
      .insert(partnersTable)
      .values({
        userId: user.clerkId,
        companyName: cleanCompany,
        baseRateCentsPerMin: baseRate,
        defaultClientRateCentsPerMin: defaultRate,
      })
      .returning();

    // Consume any pending setup left over for this email so it doesn't linger.
    await db.delete(partnerPendingPromotionsTable).where(eq(partnerPendingPromotionsTable.email, cleanEmail));

    await logAdminAction(req, {
      targetUserId: user.clerkId,
      action: "partner_create",
      afterValue: { partnerId: partner!.id, companyName: cleanCompany, baseRate, defaultRate },
    });
    res.status(201).json({ partner });
  } catch (err) {
    req.log.error({ err }, "admin/partners POST failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/admin/partners/pending/:id", async (req, res): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const [removed] = await db
      .delete(partnerPendingPromotionsTable)
      .where(eq(partnerPendingPromotionsTable.id, id))
      .returning();
    if (!removed) {
      res.status(404).json({ error: "Pending partner not found" });
      return;
    }
    await logAdminAction(req, {
      action: "partner_pending_cancel",
      beforeValue: { email: removed.email, companyName: removed.companyName },
    });
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "admin/partners pending DELETE failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * Approve a pending promotion whose email signed up via password (unverified
 * email ⇒ not auto-applied). Admin confirms it's really their person.
 */
router.post("/admin/partners/pending/:id/apply", async (req, res): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const [pending] = await db
      .select()
      .from(partnerPendingPromotionsTable)
      .where(eq(partnerPendingPromotionsTable.id, id));
    if (!pending) {
      res.status(404).json({ error: "Pending partner not found" });
      return;
    }
    const [user] = await db.select().from(usersTable).where(sql`lower(${usersTable.email}) = ${pending.email}`);
    if (!user) {
      res.status(409).json({ error: "That email hasn't signed up yet" });
      return;
    }
    if (user.status !== "active") {
      res.status(400).json({ error: `User account is ${user.status} — reactivate it first` });
      return;
    }
    if (user.partnerId) {
      res.status(409).json({ error: "This user is a client of another partner and cannot become a partner" });
      return;
    }
    const applied = await claimPendingAndPromote(pending.id, user);
    if (applied.status === "claimed_elsewhere") {
      res.status(409).json({ error: "This pending partner was just applied or cancelled" });
      return;
    }
    if (applied.status === "already_partner") {
      res.status(409).json({ error: "This user is already a partner" });
      return;
    }
    await logAdminAction(req, {
      targetUserId: user.clerkId,
      action: "partner_create",
      afterValue: {
        partnerId: applied.partner!.id,
        companyName: pending.companyName,
        baseRate: pending.baseRateCentsPerMin,
        defaultRate: pending.defaultClientRateCentsPerMin,
        viaPendingApproval: true,
      },
    });
    res.status(201).json({ partner: applied.partner });
  } catch (err) {
    req.log.error({ err }, "admin/partners pending apply failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/admin/partners/:id", async (req, res): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid partner id" });
      return;
    }
    const [partner] = await db.select().from(partnersTable).where(eq(partnersTable.id, id));
    if (!partner) {
      res.status(404).json({ error: "Partner not found" });
      return;
    }

    const { companyName, baseRateCentsPerMin, defaultClientRateCentsPerMin, status } = (req.body ?? {}) as {
      companyName?: string;
      baseRateCentsPerMin?: number;
      defaultClientRateCentsPerMin?: number;
      status?: string;
    };

    const set: Record<string, unknown> = {};
    if (companyName !== undefined) {
      const clean = String(companyName).trim().slice(0, 80);
      if (clean.length < 2) {
        res.status(400).json({ error: "Company name must be at least 2 characters" });
        return;
      }
      set["companyName"] = clean;
    }
    let nextBase = partner.baseRateCentsPerMin;
    if (baseRateCentsPerMin !== undefined) {
      nextBase = Number(baseRateCentsPerMin);
      if (!Number.isInteger(nextBase) || nextBase < 0 || nextBase > MAX_RATE_CENTS_PER_MIN) {
        res.status(400).json({ error: "baseRateCentsPerMin must be an integer between 0 and 100000" });
        return;
      }
      set["baseRateCentsPerMin"] = nextBase;
    }
    if (defaultClientRateCentsPerMin !== undefined) {
      const rate = Number(defaultClientRateCentsPerMin);
      if (!Number.isInteger(rate) || rate < nextBase || rate > MAX_RATE_CENTS_PER_MIN) {
        res.status(400).json({ error: "defaultClientRateCentsPerMin must be an integer >= baseRateCentsPerMin" });
        return;
      }
      set["defaultClientRateCentsPerMin"] = rate;
    } else if (baseRateCentsPerMin !== undefined && partner.defaultClientRateCentsPerMin < nextBase) {
      // Keep the invariant default >= base when the base is raised.
      set["defaultClientRateCentsPerMin"] = nextBase;
    }
    if (status !== undefined) {
      if (!["active", "suspended"].includes(status)) {
        res.status(400).json({ error: "status must be 'active' or 'suspended'" });
        return;
      }
      set["status"] = status;
    }
    if (Object.keys(set).length === 0) {
      res.status(400).json({ error: "Nothing to update" });
      return;
    }

    const [updated] = await db.update(partnersTable).set(set).where(eq(partnersTable.id, id)).returning();
    await logAdminAction(req, {
      targetUserId: partner.userId,
      action: "partner_update",
      beforeValue: {
        companyName: partner.companyName,
        baseRateCentsPerMin: partner.baseRateCentsPerMin,
        defaultClientRateCentsPerMin: partner.defaultClientRateCentsPerMin,
        status: partner.status,
      },
      afterValue: set,
    });
    res.json({ partner: updated });
  } catch (err) {
    req.log.error({ err }, "admin/partners PATCH failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/admin/partners/:id/clients", async (req, res): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid partner id" });
      return;
    }
    const [partner] = await db.select().from(partnersTable).where(eq(partnersTable.id, id));
    if (!partner) {
      res.status(404).json({ error: "Partner not found" });
      return;
    }

    const clients = await db
      .select({
        clerkId: usersTable.clerkId,
        name: usersTable.name,
        email: usersTable.email,
        status: usersTable.status,
        walletBalanceCents: usersTable.walletBalanceCents,
        rateCentsPerMin: usersTable.partnerRateCentsPerMin,
        createdAt: usersTable.createdAt,
      })
      .from(usersTable)
      .where(eq(usersTable.partnerId, id))
      .orderBy(desc(usersTable.createdAt));

    // Lifetime spread earned from this partner's user row this month.
    const [partnerUser] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.clerkId, partner.userId));
    let monthEarningsCents = 0;
    if (partnerUser) {
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      const [earn] = await db
        .select({ total: sql<number>`coalesce(sum(${walletTransactionsTable.amountCents}), 0)` })
        .from(walletTransactionsTable)
        .where(and(
          eq(walletTransactionsTable.userId, partnerUser.id),
          eq(walletTransactionsTable.type, "partner_earning"),
          gte(walletTransactionsTable.createdAt, start),
        ));
      monthEarningsCents = Number(earn?.total ?? 0);
    }

    const invites = await db
      .select({
        id: partnerInvitesTable.id,
        email: partnerInvitesTable.email,
        status: partnerInvitesTable.status,
        invitedAt: partnerInvitesTable.invitedAt,
      })
      .from(partnerInvitesTable)
      .where(eq(partnerInvitesTable.partnerId, id))
      .orderBy(desc(partnerInvitesTable.invitedAt))
      .limit(100);

    res.json({
      clients: clients.map(c => ({
        ...c,
        rateCentsPerMin: c.rateCentsPerMin ?? partner.defaultClientRateCentsPerMin,
      })),
      invites,
      monthEarningsCents,
    });
  } catch (err) {
    req.log.error({ err }, "admin/partners clients GET failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
