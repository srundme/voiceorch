/**
 * Scheduled callback poller
 * ─────────────────────────────────────────────────────────────────
 * Runs every 30 s and fires any outbound calls whose scheduledAt has passed.
 * Uses optimistic locking (status = "triggering") to prevent double-fires
 * in case multiple server instances are running.
 *
 * Fires outbound telephony calls whose scheduledAt has passed.
 *
 * Auto-redial:
 *  After a no_answer call fires, if the outbound dial gets no response the
 *  VoBiz/Twilio status webhook calls scheduleNextRedial() which creates the
 *  next retry row automatically (up to maxAttempts / day).
 */

import { db, scheduledCallbacksTable, agentsTable, providersTable } from "@workspace/db";
import { and, eq, lte } from "drizzle-orm";
import { withDbRetry } from "./db-retry.js";
import { dialTwilio, dialPlivo, dialVobiz } from "./telephony/dial.js";
import { logger } from "../lib/logger.js";
import { decryptKey } from "../lib/crypto.js";
import { createHmac } from "node:crypto";
import { APP_SECRET } from "../lib/app-secret.js";

/** HMAC-SHA256 signature over the callback-row ID.
 *  Embedded in status/hangup callback URLs so the status handler can verify
 *  the URL was issued by our server, not forged by an attacker who guessed cbId. */
function makeCbSig(cbId: number): string {
  return createHmac("sha256", APP_SECRET).update(`cbid:${cbId}`).digest("hex");
}

const POLL_INTERVAL_MS = 30_000;

import { getSelfBaseUrl } from "../lib/app-domain.js";

function resolveBaseUrl(): string {
  return getSelfBaseUrl();
}

export function startCallbackPoller(): void {
  const baseUrl = resolveBaseUrl();
  logger.info({ baseUrl }, "Callback poller started");
  void pollAndFire(baseUrl);
  setInterval(() => { void pollAndFire(baseUrl); }, POLL_INTERVAL_MS);
}

async function pollAndFire(baseUrl: string): Promise<void> {
  try {
    const due = await withDbRetry("callback-poll", () =>
      db.select()
        .from(scheduledCallbacksTable)
        .where(and(
          eq(scheduledCallbacksTable.status, "pending"),
          lte(scheduledCallbacksTable.scheduledAt, new Date()),
        )),
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

    // ── Telephony (outbound phone call) callback ───────────────────────────
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

    const leadQs = cb.campaignLeadId ? `&campaignLeadId=${cb.campaignLeadId}` : "";
    // Pass cbId + cbSig in the status/hangup URL so no-answer detection
    // can link back to this row and schedule the next retry.
    // cbSig = HMAC(APP_SECRET, "cbid:<id>") lets the status handler verify the
    // URL was issued by our server, preventing forged cbId enumeration.
    const cbSig   = makeCbSig(cb.id);
    const statusQs = `?cbId=${cb.id}&cbSig=${cbSig}`;

    if (provider === "twilio") {
      if (!cfg["accountSid"] || !cfg["fromNumber"]) throw new Error("Twilio config missing accountSid or fromNumber");
      await dialTwilio({
        accountSid: cfg["accountSid"]!, authToken: decryptKey(provRow.apiKey),
        fromNumber: cfg["fromNumber"]!, toNumber: cb.toNumber,
        webhookUrl: `${baseUrl}/api/webhooks/twilio/voice?agentId=${cb.agentId}${leadQs}`,
        statusCallbackUrl: `${baseUrl}/api/webhooks/twilio/status${statusQs}`,
      });
    } else if (provider === "plivo") {
      if (!cfg["authId"] || !cfg["fromNumber"]) throw new Error("Plivo config missing authId or fromNumber");
      await dialPlivo({
        authId: cfg["authId"]!, authToken: decryptKey(provRow.apiKey),
        fromNumber: cfg["fromNumber"]!, toNumber: cb.toNumber,
        answerUrl: `${baseUrl}/api/webhooks/plivo/voice?agentId=${cb.agentId}${leadQs}`,
      });
    } else if (provider === "vobiz") {
      if (!cfg["authId"] || !cfg["fromNumber"]) throw new Error("Vobiz config missing authId or fromNumber");
      await dialVobiz({
        authId: cfg["authId"]!, authToken: decryptKey(provRow.apiKey),
        fromNumber: cfg["fromNumber"]!, toNumber: cb.toNumber,
        answerUrl:  `${baseUrl}/api/webhooks/vobiz/voice?agentId=${cb.agentId}${leadQs}`,
        hangupUrl:  `${baseUrl}/api/webhooks/vobiz/status${statusQs}`,
      });
    } else {
      throw new Error(`Outbound not supported for provider: ${provider}`);
    }

    await db.update(scheduledCallbacksTable)
      .set({ status: "triggered", triggeredAt: new Date() })
      .where(eq(scheduledCallbacksTable.id, cb.id));

    logger.info(
      { callbackId: cb.id, agentId: cb.agentId, toNumber: cb.toNumber, reason: cb.reason },
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
