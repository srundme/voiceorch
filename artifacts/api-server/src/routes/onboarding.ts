import { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import { db, usersTable, partnersTable, partnerReferralsTable, walletTransactionsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth.js";

const router: IRouter = Router();

// Users created before this date are considered pre-existing and skip onboarding
const ONBOARDING_CUTOFF_DATE = new Date("2026-06-04T00:00:00.000Z");

const VALID_ROLES = ["student", "professional"] as const;
const VALID_REFERRALS = ["instagram", "youtube", "reference", "google", "ai_search"] as const;
const VALID_PLATFORMS = ["vapi", "retell", "bolna", "other"] as const;

type OnboardingData = {
  name?: string;
  role?: typeof VALID_ROLES[number];
  referralSource?: string;
  referralCode?: string;
  usedVoiceAgents?: boolean;
  priorPlatforms?: Array<typeof VALID_PLATFORMS[number]>;
};

function parseOnboardingData(body: unknown): { ok: true; data: OnboardingData } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "Body must be an object" };
  const b = body as Record<string, unknown>;

  const data: OnboardingData = {};

  if (b["name"] !== undefined) {
    if (typeof b["name"] !== "string" || !b["name"].trim()) return { ok: false, error: "name must be a non-empty string" };
    data.name = b["name"].trim().slice(0, 200);
  }
  if (b["role"] !== undefined) {
    if (!(VALID_ROLES as readonly string[]).includes(b["role"] as string)) return { ok: false, error: "Invalid role" };
    data.role = b["role"] as typeof VALID_ROLES[number];
  }
  if (b["referralSource"] !== undefined && b["referralSource"] !== null) {
    data.referralSource = String(b["referralSource"]).trim().slice(0, 100);
  }
  if (b["referralCode"] !== undefined && b["referralCode"] !== null) {
    const cleanCode = String(b["referralCode"]).trim().toUpperCase().slice(0, 50);
    if (cleanCode) {
      data.referralCode = cleanCode;
      if (!data.referralSource) data.referralSource = `referral:${cleanCode}`;
    }
  }
  if (b["usedVoiceAgents"] !== undefined) {
    if (typeof b["usedVoiceAgents"] !== "boolean") return { ok: false, error: "usedVoiceAgents must be boolean" };
    data.usedVoiceAgents = b["usedVoiceAgents"];
  }
  if (b["priorPlatforms"] !== undefined) {
    if (!Array.isArray(b["priorPlatforms"])) return { ok: false, error: "priorPlatforms must be an array" };
    const valid = VALID_PLATFORMS as readonly string[];
    if (!(b["priorPlatforms"] as unknown[]).every(p => typeof p === "string" && valid.includes(p))) {
      return { ok: false, error: "Invalid priorPlatforms values" };
    }
    data.priorPlatforms = b["priorPlatforms"] as Array<typeof VALID_PLATFORMS[number]>;
  }

  return { ok: true, data };
}

router.get("/onboarding/status", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  // Pre-existing users (created before the cutoff) bypass onboarding without touching the DB
  if (user.createdAt && user.createdAt < ONBOARDING_CUTOFF_DATE) {
    res.json({ completed: true, data: null });
    return;
  }

  res.json({
    completed: user.onboardingCompleted,
    data: user.onboardingData ?? null,
  });
});

router.post("/onboarding/complete", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const parsed = parseOnboardingData(req.body);
  if (!parsed.ok) {
    res.status(400).json({ error: "Invalid onboarding data", details: parsed.error });
    return;
  }

  const rawCode = parsed.data.referralCode?.trim() || "";
  // Strip formatting artifacts like markdown bold asterisks, hashes, quotes, and symbols
  const sanitizedCode = rawCode.replace(/[^a-zA-Z0-9_-]/g, "").trim();
  const code = sanitizedCode || rawCode;
  let matchedPartnerId: number | null = null;
  let finalReferredCode: string | null = code || null;

  let matchedPartnerAudienceMinutes = 100;

  if (code) {
    // Check if code matches an active partner referral code or slug
    const [partner] = await db
      .select({
        id: partnersTable.id,
        referralCode: partnersTable.referralCode,
        audienceMinutes: partnersTable.referralAudienceFreeMinutes,
      })
      .from(partnersTable)
      .where(
        sql`lower(${partnersTable.referralCode}) = ${code.toLowerCase()} OR lower(${partnersTable.slug}) = ${code.toLowerCase()}`
      )
      .limit(1);

    if (partner) {
      matchedPartnerId = partner.id;
      finalReferredCode = partner.referralCode || code;
      matchedPartnerAudienceMinutes = partner.audienceMinutes || 100;
    }
  }

  const [user] = await db
    .update(usersTable)
    .set({
      onboardingCompleted: true,
      onboardingData: parsed.data,
      ...(parsed.data.name ? { name: parsed.data.name } : {}),
      ...(finalReferredCode ? { referredByCode: finalReferredCode } : {}),
      ...(parsed.data.referralSource ? { signupSource: parsed.data.referralSource } : {}),
    })
    .where(eq(usersTable.clerkId, clerkId))
    .returning();

  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  // Record into partnerReferralsTable if partner matched & grant audience welcome minutes
  if (matchedPartnerId && finalReferredCode) {
    try {
      await db.insert(partnerReferralsTable).values({
        partnerId: matchedPartnerId,
        referralCode: finalReferredCode,
        userId: clerkId,
        userEmail: user.email ?? null,
        userName: user.name ?? parsed.data.name ?? null,
        status: "onboarded",
      });
    } catch (e) {
      req.log.warn({ err: e }, "partnerReferralsTable insert ignored/duplicate");
    }

    // Top up user's wallet to provide full audience welcome minutes (e.g. 100 minutes = Rs.500 = 50,000 paise)
    const targetCreditPaise = matchedPartnerAudienceMinutes * 500;
    const currentBalance = user.walletBalanceCents || 0;
    if (currentBalance < targetCreditPaise) {
      const topupPaise = targetCreditPaise - currentBalance;
      try {
        await db.transaction(async (tx) => {
          await tx.insert(walletTransactionsTable).values({
            userId: user.id,
            type: "free_credit",
            amountCents: topupPaise,
            description: `Audience welcome credit — ${matchedPartnerAudienceMinutes} free calling minutes with code ${finalReferredCode}`,
            status: "completed",
          });
          await tx
            .update(usersTable)
            .set({ walletBalanceCents: targetCreditPaise })
            .where(eq(usersTable.id, user.id));
        });
        req.log.info({ clerkId, topupPaise, matchedPartnerAudienceMinutes }, "Audience referral welcome credit topped up");
      } catch (err) {
        req.log.warn({ err }, "Failed to top up audience referral welcome credit");
      }
    }
  }

  req.log.info({ clerkId, referralCode: finalReferredCode, partnerId: matchedPartnerId }, "Onboarding completed");
  res.json({
    completed: user.onboardingCompleted,
    data: user.onboardingData ?? null,
  });
});

export default router;
