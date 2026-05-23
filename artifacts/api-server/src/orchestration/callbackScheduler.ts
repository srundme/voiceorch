/**
 * Scheduled callback poller
 * ─────────────────────────────────────────────────────────────────
 * Runs every 30 s and fires any outbound calls whose scheduledAt has passed.
 * Uses optimistic locking (status = "triggering") to prevent double-fires
 * in case multiple server instances are running.
 */

import { db, scheduledCallbacksTable, agentsTable, providersTable } from "@workspace/db";
import { and, eq, lte } from "drizzle-orm";
import { dialTwilio, dialPlivo, dialVobiz } from "./telephony/dial.js";
import { logger } from "../lib/logger.js";
import { decryptKey } from "../lib/crypto.js";

const POLL_INTERVAL_MS = 30_000;

function resolveBaseUrl(): string {
  const domains = process.env["REPLIT_DOMAINS"];
  if (domains) return `https://${domains.split(",")[0]!.trim()}`;
  return `http://localhost:${process.env["PORT"] ?? "8080"}`;
}

export function startCallbackPoller(): void {
  const baseUrl = resolveBaseUrl();
  logger.info({ baseUrl }, "Callback poller started");
  void pollAndFire(baseUrl);
  setInterval(() => { void pollAndFire(baseUrl); }, POLL_INTERVAL_MS);
}

async function pollAndFire(baseUrl: string): Promise<void> {
  try {
    const due = await db
      .select()
      .from(scheduledCallbacksTable)
      .where(
        and(
          eq(scheduledCallbacksTable.status, "pending"),
          lte(scheduledCallbacksTable.scheduledAt, new Date()),
        ),
      );
    for (const cb of due) void fireCallback(cb, baseUrl);
  } catch (err) {
    logger.error({ err }, "Callback poller error");
  }
}

type CallbackRow = typeof scheduledCallbacksTable.$inferSelect;

async function fireCallback(cb: CallbackRow, baseUrl: string): Promise<void> {
  // Claim it atomically — if another instance already claimed it, skip
  const claimed = await db
    .update(scheduledCallbacksTable)
    .set({ status: "triggering" })
    .where(and(
      eq(scheduledCallbacksTable.id, cb.id),
      eq(scheduledCallbacksTable.status, "pending"),
    ))
    .returning();

  if (claimed.length === 0) return;

  try {
    const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, cb.agentId));
    if (!agent) throw new Error(`Agent ${cb.agentId} not found`);

    const provider = agent.telephonyProvider.toLowerCase();
    const [provRow] = await db
      .select()
      .from(providersTable)
      .where(eq(providersTable.providerName, provider))
      .limit(1);

    if (!provRow) throw new Error(`No "${provider}" provider configured`);
    const cfg = provRow.extraConfig
      ? (JSON.parse(provRow.extraConfig) as Record<string, string>)
      : {} as Record<string, string>;

    if (provider === "twilio") {
      if (!cfg["accountSid"] || !cfg["fromNumber"]) throw new Error("Twilio config missing accountSid or fromNumber");
      await dialTwilio({
        accountSid: cfg["accountSid"]!, authToken: decryptKey(provRow.apiKey),
        fromNumber: cfg["fromNumber"]!, toNumber: cb.toNumber,
        webhookUrl: `${baseUrl}/api/webhooks/twilio/voice?agentId=${cb.agentId}`,
        statusCallbackUrl: `${baseUrl}/api/webhooks/twilio/status`,
      });
    } else if (provider === "plivo") {
      if (!cfg["authId"] || !cfg["fromNumber"]) throw new Error("Plivo config missing authId or fromNumber");
      await dialPlivo({
        authId: cfg["authId"]!, authToken: decryptKey(provRow.apiKey),
        fromNumber: cfg["fromNumber"]!, toNumber: cb.toNumber,
        answerUrl: `${baseUrl}/api/webhooks/plivo/voice?agentId=${cb.agentId}`,
      });
    } else if (provider === "vobiz") {
      if (!cfg["authId"] || !cfg["fromNumber"]) throw new Error("Vobiz config missing authId or fromNumber");
      await dialVobiz({
        authId: cfg["authId"]!, authToken: decryptKey(provRow.apiKey),
        fromNumber: cfg["fromNumber"]!, toNumber: cb.toNumber,
        answerUrl: `${baseUrl}/api/webhooks/vobiz/voice?agentId=${cb.agentId}`,
        hangupUrl:  `${baseUrl}/api/webhooks/vobiz/status`,
      });
    } else {
      throw new Error(`Outbound not supported for provider: ${provider}`);
    }

    await db.update(scheduledCallbacksTable)
      .set({ status: "triggered", triggeredAt: new Date() })
      .where(eq(scheduledCallbacksTable.id, cb.id));

    logger.info(
      { callbackId: cb.id, agentId: cb.agentId, toNumber: cb.toNumber },
      "Scheduled callback triggered successfully",
    );
  } catch (err) {
    logger.error({ callbackId: cb.id, err }, "Scheduled callback failed");
    await db.update(scheduledCallbacksTable)
      .set({ status: "failed" })
      .where(eq(scheduledCallbacksTable.id, cb.id))
      .catch(() => {});
  }
}
