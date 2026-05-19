import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db, activityLogsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth.js";

const router: IRouter = Router();

router.get("/activity-logs", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const limitRaw = parseInt((req.query as any).limit ?? "100", 10);
  const limit = isNaN(limitRaw) || limitRaw > 500 ? 100 : limitRaw;

  const logs = await db
    .select()
    .from(activityLogsTable)
    .where(eq(activityLogsTable.userId, clerkId))
    .orderBy(desc(activityLogsTable.createdAt))
    .limit(limit);

  res.json(logs.map(l => ({ ...l, createdAt: l.createdAt.toISOString() })));
});

export default router;
