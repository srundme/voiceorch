/**
 * /billing routes — lightweight, authenticated (non-admin) endpoints used
 * by the user dashboard for displaying per-agent cost information.
 */
import { Router } from "express";
import { db, providerMinuteRatesTable, platformSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth.js";

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
 * Returns all admin-set per-minute reseller rates. Authenticated users can
 * read these so the dashboard can compute cost/min per agent.
 */
router.get("/billing/rates", requireAuth, async (req, res): Promise<void> => {
  const rows = await db.select().from(providerMinuteRatesTable);
  res.json(
    rows.map((r) => ({
      category:        r.category,
      providerName:    r.providerName,
      rateCentsPerMin: r.rateCentsPerMin,
      label:           r.label,
    })),
  );
});

/**
 * GET /billing/webcall-key-status
 * Returns which managed provider keys are configured so the dashboard can
 * gate the "Start Test Call" button before attempting a WebSocket connection.
 */
router.get("/billing/webcall-key-status", requireAuth, async (_req, res): Promise<void> => {
  const [sarvam, cartesia, gemini, openai, deepgram] = await Promise.all([
    getManagedKey("managed_sarvam_key"),
    getManagedKey("managed_cartesia_key"),
    getManagedKey("managed_gemini_key"),
    getManagedKey("managed_openai_key"),
    getManagedKey("managed_deepgram_key"),
  ]);
  res.json({
    sarvam:   !!sarvam,
    cartesia: !!cartesia,
    gemini:   !!gemini,
    openai:   !!openai,
    deepgram: !!deepgram,
  });
});

export default router;
