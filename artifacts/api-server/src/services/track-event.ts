import { db, analyticsEventsTable } from "@workspace/db";
import { logger } from "../lib/logger.js";

export async function trackEvent(
  userId: string,
  eventName: string,
  properties: Record<string, unknown> = {},
): Promise<void> {
  try {
    await db.insert(analyticsEventsTable).values({ userId, eventName, properties });
  } catch (err) {
    logger.warn({ err, userId, eventName }, "trackEvent: failed to record event (non-fatal)");
  }
}
