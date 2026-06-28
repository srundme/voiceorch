/**
 * /admin/gender-service — caller gender-detection (Sir/Ma'am) diagnostics.
 *
 * Lets ops verify the Voice Analysis (gender) microservice is reachable and
 * healthy in production WITHOUT placing a call. On Railway the api-server and
 * the gender-service run in SEPARATE containers wired only by GENDER_SERVICE_URL;
 * if that var is unset/wrong every detection silently falls back to the neutral
 * salutation. This endpoint surfaces the resolved URL, whether the var is
 * explicitly set vs defaulted, live /health + /ready reachability, and a quick
 * probe of each detection endpoint the chained detector uses.
 */
import { Router } from "express";
import { requireAdmin } from "../middlewares/requireAdmin.js";
import { diagnoseGenderService } from "../orchestration/genderService.js";

const router = Router();

router.get("/admin/gender-service/diagnostics", requireAdmin, async (req, res): Promise<void> => {
  try {
    const diag = await diagnoseGenderService();
    const healthy = diag.health.ok;
    const ready = diag.ready.ok;
    const anyDetection = diag.detection.some((d) => d.ok);
    res.json({
      ...diag,
      summary: {
        healthy,
        ready,
        anyDetectionResponds: anyDetection,
        // Overall: the feature can work if liveness is up and at least one
        // detection endpoint responds (the chain falls through the rest).
        ok: healthy && anyDetection,
      },
    });
  } catch (err) {
    req.log.error({ err }, "gender-service diagnostics failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
