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
  partnerReferralsTable,
  partnerReferralEarningsTable,
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
        concurrentLimit: partnersTable.concurrentLimit,
        referralCode: partnersTable.referralCode,
        slug: partnersTable.slug,
        customDomain: partnersTable.customDomain,
        customDomainStatus: partnersTable.customDomainStatus,
        maxAgents: partnersTable.maxAgents,
        maxClients: partnersTable.maxClients,
        referralAttributionDays: partnersTable.referralAttributionDays,
        referralCommissionPercent: partnersTable.referralCommissionPercent,
        referralCommissionMonths: partnersTable.referralCommissionMonths,
        referralMinRechargedUsers: partnersTable.referralMinRechargedUsers,
        referralTargetMinutes: partnersTable.referralTargetMinutes,
        referralRewardMinutes: partnersTable.referralRewardMinutes,
        referralCompletedCycles: partnersTable.referralCompletedCycles,
        referralAudienceBonusPercent: partnersTable.referralAudienceBonusPercent,
        referralAudienceFreeMinutes: partnersTable.referralAudienceFreeMinutes,
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

    // Concurrency allocated across clients per partner
    const allocatedConcurrencies = await db
      .select({ partnerId: usersTable.partnerId, total: sql<number>`coalesce(sum(${usersTable.concurrentLimit}), 0)` })
      .from(usersTable)
      .where(sql`${usersTable.partnerId} is not null`)
      .groupBy(usersTable.partnerId);
    const allocatedConcurrencyMap = new Map<number, number>();
    for (const ac of allocatedConcurrencies) {
      if (ac.partnerId != null) allocatedConcurrencyMap.set(ac.partnerId, Number(ac.total));
    }

    // Referral counts per partner
    const referralCounts = await db
      .select({ partnerId: partnerReferralsTable.partnerId, n: count() })
      .from(partnerReferralsTable)
      .groupBy(partnerReferralsTable.partnerId);
    const referralCountMap = new Map<number, number>();
    for (const rc of referralCounts) {
      if (rc.partnerId != null) referralCountMap.set(rc.partnerId, Number(rc.n));
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
        concurrentLimit: p.concurrentLimit ?? 10,
        allocatedConcurrency: allocatedConcurrencyMap.get(p.id) ?? 0,
        clientCount: countMap.get(p.id) ?? 0,
        referredCount: referralCountMap.get(p.id) ?? 0,
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
    const { email, companyName, baseRateCentsPerMin, defaultClientRateCentsPerMin, referralCode, clerkId, concurrentLimit } = (req.body ?? {}) as {
      email?: string;
      companyName?: string;
      baseRateCentsPerMin?: number;
      defaultClientRateCentsPerMin?: number;
      referralCode?: string;
      /** When set (e.g. from user detail), promote this exact account — not another row with the same email. */
      clerkId?: string;
      concurrentLimit?: number;
    };

    const cleanEmail = String(email ?? "").trim().toLowerCase();
    const cleanCompany = String(companyName ?? "").trim().slice(0, 80);
    const cleanRefCode = referralCode ? String(referralCode).trim().toUpperCase() : null;
    const cleanConcurrency = concurrentLimit === undefined ? 10 : Number(concurrentLimit);
    if (!Number.isInteger(cleanConcurrency) || cleanConcurrency < 1 || cleanConcurrency > 10000) {
      res.status(400).json({ error: "concurrentLimit must be an integer between 1 and 10000" });
      return;
    }
    if (cleanRefCode && !/^[A-Z0-9_-]{2,30}$/.test(cleanRefCode)) {
      res.status(400).json({ error: "Referral code must be 2-30 alphanumeric characters" });
      return;
    }
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

    if (cleanRefCode) {
      const [existingCode] = await db
        .select({ id: partnersTable.id })
        .from(partnersTable)
        .where(sql`upper(${partnersTable.referralCode}) = ${cleanRefCode}`)
        .limit(1);
      if (existingCode) {
        res.status(409).json({ error: "Referral code is already taken by another partner" });
        return;
      }
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
          concurrentLimit: cleanConcurrency,
          referralCode: cleanRefCode,
        })
        .returning();
      await logAdminAction(req, {
        action: "partner_pending_create",
        afterValue: { email: cleanEmail, companyName: cleanCompany, baseRate, defaultRate, concurrentLimit: cleanConcurrency, referralCode: cleanRefCode },
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
            afterValue: { partnerId: applied.partner!.id, companyName: cleanCompany, baseRate, defaultRate, referralCode: cleanRefCode, viaPendingRace: true },
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
        concurrentLimit: cleanConcurrency,
        referralCode: cleanRefCode,
      })
      .returning();

    // Consume any pending setup left over for this email so it doesn't linger.
    await db.delete(partnerPendingPromotionsTable).where(eq(partnerPendingPromotionsTable.email, cleanEmail));

    await logAdminAction(req, {
      targetUserId: user.clerkId,
      action: "partner_create",
      afterValue: { partnerId: partner!.id, companyName: cleanCompany, baseRate, defaultRate, concurrentLimit: cleanConcurrency, referralCode: cleanRefCode },
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
        referralCode: pending.referralCode,
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

    const {
      companyName, baseRateCentsPerMin, defaultClientRateCentsPerMin, referralCode,
      status, concurrentLimit, maxAgents, maxClients,
      referralAttributionDays, referralCommissionPercent, referralCommissionMonths,
      referralMinRechargedUsers, referralTargetMinutes, referralRewardMinutes,
      referralAudienceBonusPercent, referralAudienceFreeMinutes,
    } = (req.body ?? {}) as {
      companyName?: string;
      baseRateCentsPerMin?: number;
      defaultClientRateCentsPerMin?: number;
      referralCode?: string | null;
      status?: string;
      concurrentLimit?: number;
      maxAgents?: number | null | "";
      maxClients?: number | null | "";
      referralAttributionDays?: number;
      referralCommissionPercent?: number;
      referralCommissionMonths?: number;
      referralMinRechargedUsers?: number;
      referralTargetMinutes?: number;
      referralRewardMinutes?: number;
      referralAudienceBonusPercent?: number;
      referralAudienceFreeMinutes?: number;
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
    if (referralCode !== undefined) {
      const cleanRef = referralCode ? String(referralCode).trim().toUpperCase() : null;
      if (cleanRef) {
        if (!/^[A-Z0-9_-]{2,30}$/.test(cleanRef)) {
          res.status(400).json({ error: "Referral code must be 2-30 alphanumeric characters" });
          return;
        }
        const [conflict] = await db
          .select({ id: partnersTable.id })
          .from(partnersTable)
          .where(and(sql`upper(${partnersTable.referralCode}) = ${cleanRef}`, sql`${partnersTable.id} != ${id}`))
          .limit(1);
        if (conflict) {
          res.status(409).json({ error: "Referral code is already in use" });
          return;
        }
      }
      set["referralCode"] = cleanRef;
    }
    if (concurrentLimit !== undefined) {
      const n = Number(concurrentLimit);
      if (!Number.isInteger(n) || n < 1 || n > 10000) {
        res.status(400).json({ error: "concurrentLimit must be an integer between 1 and 10000" });
        return;
      }
      set["concurrentLimit"] = n;
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
    if (maxAgents !== undefined) {
      if (maxAgents === null || maxAgents === "") {
        set["maxAgents"] = null;
      } else {
        const parsed = Number(maxAgents);
        if (!Number.isInteger(parsed) || parsed < 0) {
          res.status(400).json({ error: "Agent limit must be a non-negative integer or empty (for unlimited)" });
          return;
        }
        set["maxAgents"] = parsed;
      }
    }
    if (maxClients !== undefined) {
      if (maxClients === null || maxClients === "") {
        set["maxClients"] = null;
      } else {
        const parsed = Number(maxClients);
        if (!Number.isInteger(parsed) || parsed < 0) {
          res.status(400).json({ error: "Client limit must be a non-negative integer or empty (for unlimited)" });
          return;
        }
        set["maxClients"] = parsed;
      }
    }
    if (referralAttributionDays !== undefined) {
      const d = Math.max(1, Math.min(365, Number(referralAttributionDays) || 60));
      set["referralAttributionDays"] = d;
    }
    if (referralCommissionPercent !== undefined) {
      const p = Math.max(0, Math.min(100, Number(referralCommissionPercent) || 10));
      set["referralCommissionPercent"] = p;
    }
    if (referralCommissionMonths !== undefined) {
      const m = Math.max(1, Math.min(60, Number(referralCommissionMonths) || 6));
      set["referralCommissionMonths"] = m;
    }
    if (referralMinRechargedUsers !== undefined) {
      const u = Math.max(0, Math.min(1000, Number(referralMinRechargedUsers) || 10));
      set["referralMinRechargedUsers"] = u;
    }
    if (referralTargetMinutes !== undefined) {
      const tm = Math.max(100, Math.min(1000000, Number(referralTargetMinutes) || 5000));
      set["referralTargetMinutes"] = tm;
    }
    if (referralRewardMinutes !== undefined) {
      const rm = Math.max(10, Math.min(100000, Number(referralRewardMinutes) || 500));
      set["referralRewardMinutes"] = rm;
    }
    if (referralAudienceBonusPercent !== undefined) {
      const b = Math.max(0, Math.min(100, Number(referralAudienceBonusPercent) || 10));
      set["referralAudienceBonusPercent"] = b;
    }
    if (referralAudienceFreeMinutes !== undefined) {
      const mins = Math.max(0, Math.min(10000, Number(referralAudienceFreeMinutes) || 100));
      set["referralAudienceFreeMinutes"] = mins;
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
        referralCode: partner.referralCode,
        status: partner.status,
        maxAgents: partner.maxAgents,
        maxClients: partner.maxClients,
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
        concurrentLimit: usersTable.concurrentLimit,
        referredByCode: usersTable.referredByCode,
        signupSource: usersTable.signupSource,
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

    const referrals = await db
      .select()
      .from(partnerReferralsTable)
      .where(eq(partnerReferralsTable.partnerId, id))
      .orderBy(desc(partnerReferralsTable.createdAt))
      .limit(100);

    // Option A milestone referral calculations
    const [payingStats] = await db
      .select({
        rechargedUsersCount: sql<number>`count(distinct ${partnerReferralsTable.userId})`,
      })
      .from(partnerReferralsTable)
      .where(
        and(
          eq(partnerReferralsTable.partnerId, id),
          sql`(${partnerReferralsTable.rechargeCount} > 0 OR ${partnerReferralsTable.firstRechargeAt} IS NOT NULL)`
        )
      );
    const rechargedUsersCount = Number(payingStats?.rechargedUsersCount ?? 0);

    const [pendingEarn] = await db
      .select({ total: sql<number>`coalesce(sum(${partnerReferralEarningsTable.earnedPaise}), 0)` })
      .from(partnerReferralEarningsTable)
      .where(and(eq(partnerReferralEarningsTable.partnerId, id), eq(partnerReferralEarningsTable.status, "pending")));
    const pendingEarningsCents = Number(pendingEarn?.total ?? 0);

    const [unlockedEarn] = await db
      .select({ total: sql<number>`coalesce(sum(${partnerReferralEarningsTable.earnedPaise}), 0)` })
      .from(partnerReferralEarningsTable)
      .where(and(eq(partnerReferralEarningsTable.partnerId, id), eq(partnerReferralEarningsTable.status, "credited")));
    const unlockedEarningsCents = Number(unlockedEarn?.total ?? 0);

    const baseRatePaise = partner.baseRateCentsPerMin || 500;
    const targetMinutes = partner.referralTargetMinutes ?? 5000;
    const rewardMinutes = partner.referralRewardMinutes ?? 500;
    const completedCycles = partner.referralCompletedCycles ?? 0;
    const totalRechargedPaise = referrals.reduce((sum, r) => sum + (r.totalRechargedPaise ?? 0), 0);
    const totalAudienceMinutes = Math.floor(totalRechargedPaise / baseRatePaise);
    const currentCycleMinutes = totalAudienceMinutes % targetMinutes;
    const minutesRemainingInCycle = Math.max(0, targetMinutes - currentCycleMinutes);

    res.json({
      clients: clients.map(c => ({
        ...c,
        rateCentsPerMin: c.rateCentsPerMin ?? partner.defaultClientRateCentsPerMin,
        concurrentLimit: c.concurrentLimit ?? 10,
      })),
      invites,
      referrals: referrals.map(r => ({
        ...r,
        minutesPurchased: Math.floor((r.totalRechargedPaise ?? 0) / baseRatePaise),
      })),
      rechargedUsersCount,
      targetMinutes,
      rewardMinutes,
      completedCycles,
      totalAudienceMinutes,
      currentCycleMinutes,
      minutesRemainingInCycle,
      pendingEarningsCents,
      unlockedEarningsCents,
      monthEarningsCents,
    });
  } catch (err) {
    req.log.error({ err }, "admin/partners clients GET failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
