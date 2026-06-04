import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
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
  referralSource?: typeof VALID_REFERRALS[number];
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
  if (b["referralSource"] !== undefined) {
    if (!(VALID_REFERRALS as readonly string[]).includes(b["referralSource"] as string)) return { ok: false, error: "Invalid referralSource" };
    data.referralSource = b["referralSource"] as typeof VALID_REFERRALS[number];
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

  const [user] = await db
    .update(usersTable)
    .set({
      onboardingCompleted: true,
      onboardingData: parsed.data,
      // Backfill name from onboarding if the user record has no name yet
      ...(parsed.data.name ? { name: parsed.data.name } : {}),
    })
    .where(eq(usersTable.clerkId, clerkId))
    .returning();

  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  req.log.info({ clerkId }, "Onboarding completed");
  res.json({
    completed: user.onboardingCompleted,
    data: user.onboardingData ?? null,
  });
});

export default router;
