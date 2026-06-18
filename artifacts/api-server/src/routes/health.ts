import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { pool } from "@workspace/db";
import { getRedis } from "../lib/redis.js";
import { getAllSessions } from "../orchestration/session.js";
import { getAllCampaignConcurrency } from "../services/batchScheduler.js";

const router: IRouter = Router();

router.get("/healthz", async (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

async function checkDb(): Promise<{ status: string; detail?: string }> {
  const client = await pool.connect();
  try {
    await client.query("SELECT 1");
    return { status: "ok", detail: `pool: ${pool.totalCount} / ${pool.options.max}` };
  } catch (err) {
    return { status: "error", detail: err instanceof Error ? err.message : String(err) };
  } finally {
    client.release();
  }
}

router.get("/healthz/deep", async (_req, res) => {
  const checks: Record<string, { status: string; detail?: string }> = {};
  let overall = "ok";

  // DB connectivity
  checks["db"] = await checkDb();
  if (checks["db"].status === "error") overall = "degraded";

  // Redis
  try {
    const redis = getRedis();
    if (redis) {
      await redis.ping();
      checks["redis"] = { status: "ok" };
    } else {
      checks["redis"] = { status: "warn", detail: "Redis not configured" };
    }
  } catch (err) {
    checks["redis"] = { status: "error", detail: err instanceof Error ? err.message : String(err) };
    overall = "degraded";
  }

  // Active calls — warn at 100, degrade at 150 (informational; Railway uses /healthz not /healthz/deep)
  const activeCalls = getAllSessions().length;
  checks["activeCalls"] = { status: "ok", detail: `${activeCalls} active calls` };
  if (activeCalls > 150) {
    checks["activeCalls"].status = "warn";
    overall = "degraded";
  } else if (activeCalls > 100) {
    checks["activeCalls"].status = "warn";
  }

  // Campaign concurrency
  const campaignConcurrency = getAllCampaignConcurrency();
  const campaignDetails = Array.from(campaignConcurrency.entries()).map(([id, count]) => `${id}:${count}`).join(", ");
  checks["campaignConcurrency"] = { status: "ok", detail: campaignDetails || "none" };

  res.json({ status: overall, checks });
});

export default router;
