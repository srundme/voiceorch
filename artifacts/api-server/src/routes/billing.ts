/**
 * /billing routes — lightweight, authenticated (non-admin) endpoints used
 * by the user dashboard for displaying per-agent cost information.
 */
import { Router } from "express";
import { db, providerMinuteRatesTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth.js";

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

export default router;
