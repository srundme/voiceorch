import { db, activityLogsTable } from "@workspace/db";

export async function logActivity(opts: {
  userId: string;
  eventType: string;
  resourceType?: string;
  resourceId?: string;
  description: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await db.insert(activityLogsTable).values({
      userId: opts.userId,
      eventType: opts.eventType,
      resourceType: opts.resourceType ?? null,
      resourceId: opts.resourceId ?? null,
      description: opts.description,
      metadata: opts.metadata ? JSON.stringify(opts.metadata) : null,
    });
  } catch {
    // Never let logging failures break the caller
  }
}
