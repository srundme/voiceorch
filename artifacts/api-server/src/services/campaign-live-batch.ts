/**
 * Daily "Live — {Month Day}" batches for instant-trigger intake
 * (website webhook, Meta ads, CRM, Google Sheets Automatic Calls).
 */

import { db, campaignBatchesTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { logger } from "../lib/logger.js";

export async function getOrCreateLiveBatch(
  campaignId: number,
  timezone = "Asia/Kolkata",
  opts?: {
    leadSource?: string;
    description?: string;
  },
): Promise<typeof campaignBatchesTable.$inferSelect | null> {
  const leadSource = opts?.leadSource ?? "webhook";
  const description = opts?.description
    ?? "Auto-created — incoming website leads are dialled immediately";
  const now = new Date();
  const batchName = `Live — ${now.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: timezone })}`;

  const existing = await db.query.campaignBatchesTable.findFirst({
    where: and(
      eq(campaignBatchesTable.campaignId, campaignId),
      eq(campaignBatchesTable.leadSource, leadSource),
      sql`${campaignBatchesTable.name} = ${batchName}`,
    ),
    orderBy: (t, { desc }) => [desc(t.id)],
  });

  if (existing) {
    if (existing.status !== "running") {
      await db.update(campaignBatchesTable)
        .set({ status: "running" })
        .where(eq(campaignBatchesTable.id, existing.id));
    }
    return { ...existing, status: "running" };
  }

  const [batch] = await db.insert(campaignBatchesTable).values({
    campaignId,
    name: batchName,
    description,
    leadSource,
    callDelaySeconds: 0,
    maxAttempts: 2,
    retryDelayMinutes: 60,
    duplicatePolicy: "skip",
  } as typeof campaignBatchesTable.$inferInsert).returning();

  if (!batch) {
    logger.warn({ campaignId, leadSource }, "Failed to create live batch");
    return null;
  }

  await db.update(campaignBatchesTable)
    .set({ status: "running" })
    .where(eq(campaignBatchesTable.id, batch.id));

  logger.info({ campaignId, batchId: batch.id, batchName, leadSource }, "Auto-created live batch");
  return { ...batch, status: "running" };
}
