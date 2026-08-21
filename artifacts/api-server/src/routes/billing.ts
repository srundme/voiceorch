/**
 * /billing routes — lightweight, authenticated (non-admin) endpoints used
 * by the user dashboard for displaying pricing information.
 */
import { Router } from "express";
import { db, platformSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth.js";
import { resolveBillingRateCentsPerMin } from "../services/minute-rates.js";

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
 * Returns the effective per-minute billing tier (from customer_pricing_rates when set).
 */
router.get("/billing/rates", requireAuth, async (_req, res): Promise<void> => {
  const rate = await resolveBillingRateCentsPerMin();
  const labelInr = `₹${(rate / 100).toFixed(2)}/min`;
  res.json([
    { mode: "managed", rateCentsPerMin: rate, label: `Managed — platform keys (${labelInr})`, currency: "INR" },
    { mode: "byop",    rateCentsPerMin: rate, label: `BYOP — your own keys (${labelInr})`, currency: "INR" },
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
