/**
 * /billing routes — lightweight, authenticated (non-admin) endpoints used
 * by the user dashboard for displaying pricing information.
 */
import { Router } from "express";
import { db, platformSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth.js";
import { MANAGED_RATE_CENTS_PER_MIN, BYOP_RATE_CENTS_PER_MIN } from "../services/minute-rates.js";

async function getManagedKey(key: string): Promise<string | null> {
  const [row] = await db
    .select({ value: platformSettingsTable.value })
    .from(platformSettingsTable)
    .where(eq(platformSettingsTable.key, key));
  return row?.value?.trim() || null;
}

const router = Router();

/**
 * GET /billing/rates
 * Returns the two flat per-minute billing tiers so the dashboard can display
 * cost/min per agent based on its mode ("managed" vs "byop").
 */
router.get("/billing/rates", requireAuth, async (_req, res): Promise<void> => {
  res.json([
    { mode: "managed", rateCentsPerMin: MANAGED_RATE_CENTS_PER_MIN, label: "Managed — platform keys (₹5/min)", currency: "INR" },
    { mode: "byop",    rateCentsPerMin: BYOP_RATE_CENTS_PER_MIN,    label: "BYOP — your own keys (₹5/min)", currency: "INR" },
  ]);
});

/**
 * GET /billing/webcall-key-status
 * Returns which managed provider keys are configured so the dashboard can
 * gate the "Start Test Call" button before attempting a WebSocket connection.
 */
router.get("/billing/webcall-key-status", requireAuth, async (_req, res): Promise<void> => {
  const [sarvam, cartesia, qwen, openai, deepgram] = await Promise.all([
    getManagedKey("managed_sarvam_key"),
    getManagedKey("managed_cartesia_key"),
    getManagedKey("managed_qwen_key"),
    getManagedKey("managed_openai_key"),
    getManagedKey("managed_deepgram_key"),
  ]);
  res.json({
    sarvam:   !!sarvam,
    cartesia: !!cartesia,
    qwen:     !!qwen,
    groq:     !!qwen,
    openai:   !!openai,
    deepgram: !!deepgram,
  });
});

export default router;
