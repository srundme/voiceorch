import { createHmac } from "crypto";
import { db, webhookEndpointsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { logger } from "../../lib/logger.js";
import { fetchUserConfiguredUrl } from "../../lib/ssrf.js";

export type SchedulingWebhookEvent =
  | "scheduling.booking.created"
  | "scheduling.booking.confirmed"
  | "scheduling.booking.cancelled"
  | "scheduling.booking.rescheduled";

export async function dispatchSchedulingWebhooks(
  userId: string,
  event: SchedulingWebhookEvent,
  payload: Record<string, unknown>,
): Promise<void> {
  const endpoints = await db.select().from(webhookEndpointsTable)
    .where(and(eq(webhookEndpointsTable.userId, userId), eq(webhookEndpointsTable.enabled, true)));

  const body = JSON.stringify({ event, timestamp: new Date().toISOString(), data: payload });

  for (const ep of endpoints) {
    const events: string[] = JSON.parse(ep.events);
    if (!events.includes(event)) continue;

    const sig = ep.secret
      ? createHmac("sha256", ep.secret).update(body).digest("hex")
      : undefined;

    fetchUserConfiguredUrl(ep.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(sig ? { "X-VoiceOrch-Signature": sig } : {}),
        "User-Agent": "VoiceOrch-Webhooks/1.0",
      },
      body,
    }, { timeoutMs: 10_000, retries: 2 }).catch((err) => {
      logger.warn({ err, webhookId: ep.id, event }, "Scheduling webhook delivery failed");
    });
  }
}
