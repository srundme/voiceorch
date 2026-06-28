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

import { db, scheduledCallbacksTable, agentsTable, providersTable, platformSettingsTable, phoneNumbersTable } from "@workspace/db";
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

/**
 * Resolve telephony credentials for a scheduled callback.
 *
 * Priority:
 *  1. User's own provider row in `providers` (BYOP)
 *  2. Platform managed credentials from `platform_settings` / env vars
 *
 * Mirrors the credential resolution in `campaignCaller.ts` and `calls.ts`
 * so that managed-plan users (no provider row) can receive callbacks.
 */
async function resolveVobizCreds(userId: string | null, agentId: number): Promise<{
  authId:     string;
  authToken:  string;
  fromNumber: string;
  isManaged:  boolean;
} | null> {
  // 1. Try user-scoped BYOP row
  if (userId) {
    const [provRow] = await db
      .select()
      .from(providersTable)
      .where(and(
        eq(providersTable.providerName, "vobiz"),
        eq(providersTable.userId, userId),
      ))
      .limit(1);

    if (provRow) {
      const cfg = provRow.extraConfig
        ? (JSON.parse(provRow.extraConfig) as Record<string, string>)
        : {} as Record<string, string>;
      if (cfg["authId"] && cfg["fromNumber"]) {
        return {
          authId:     cfg["authId"]!,
          authToken:  decryptKey(provRow.apiKey),
          fromNumber: cfg["fromNumber"]!,
          isManaged:  false,
        };
      }
    }
  }

  // 2. Fall back to platform managed credentials
  const [authIdRow, authTokenRow, numbersRow, agentPhoneRow] = await Promise.all([
    db.select({ value: platformSettingsTable.value })
      .from(platformSettingsTable)
      .where(eq(platformSettingsTable.key, "managed_vobiz_auth_id"))
      .then(r => r[0]),
    db.select({ value: platformSettingsTable.value })
      .from(platformSettingsTable)
      .where(eq(platformSettingsTable.key, "managed_vobiz_auth_token"))
      .then(r => r[0]),
    db.select({ value: platformSettingsTable.value })
      .from(platformSettingsTable)
      .where(eq(platformSettingsTable.key, "managed_phone_numbers"))
      .then(r => r[0]),
    // Check if the agent has a dedicated outbound number assigned
    db.select({ number: phoneNumbersTable.number })
      .from(phoneNumbersTable)
      .where(eq(phoneNumbersTable.agentId, agentId))
      .limit(1)
      .then(r => r[0]),
  ]);

  const managedAuthId    = authIdRow?.value    || process.env["VOBIZ_AUTH_ID"]    || "";
  const managedAuthToken = authTokenRow?.value  || process.env["VOBIZ_AUTH_TOKEN"] || "";

  if (!managedAuthId || !managedAuthToken) return null;

  // Prefer the agent's assigned outbound number; fall back to random pool number
  let fromNumber: string | undefined;
  if (agentPhoneRow?.number) {
    fromNumber = agentPhoneRow.number;
  } else {
    const pool: string[] = numbersRow?.value
      ? (JSON.parse(numbersRow.value) as string[])
      : [];
    fromNumber = pool.length > 0 ? pool[Math.floor(Math.random() * pool.length)] : undefined;
  }

  if (!fromNumber) return null;

  return {
    authId:    managedAuthId,
    authToken: managedAuthToken,
    fromNumber,
    isManaged: true,
  };
}

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

    const leadQs = cb.campaignLeadId ? `&campaignLeadId=${cb.campaignLeadId}` : "";
    // Pass cbId + cbSig in the status/hangup URL so no-answer detection
    // can link back to this row and schedule the next retry.
    // cbSig = HMAC(APP_SECRET, "cbid:<id>") lets the status handler verify the
    // URL was issued by our server, preventing forged cbId enumeration.
    const cbSig   = makeCbSig(cb.id);
    const statusQs = `?cbId=${cb.id}&cbSig=${cbSig}`;

    if (provider === "twilio") {
      // Twilio: scope by userId, no managed fallback (users must BYOP for Twilio)
      const [provRow] = await db
        .select()
        .from(providersTable)
        .where(and(
          eq(providersTable.providerName, "twilio"),
          ...(agent.userId ? [eq(providersTable.userId, agent.userId)] : []),
        ))
        .limit(1);
      if (!provRow) throw new Error(`No "twilio" provider configured for this user`);
      const cfg = provRow.extraConfig
        ? (JSON.parse(provRow.extraConfig) as Record<string, string>)
        : {} as Record<string, string>;
      if (!cfg["accountSid"] || !cfg["fromNumber"]) throw new Error("Twilio config missing accountSid or fromNumber");
      await dialTwilio({
        accountSid: cfg["accountSid"]!, authToken: decryptKey(provRow.apiKey),
        fromNumber: cfg["fromNumber"]!, toNumber: cb.toNumber,
        webhookUrl: `${baseUrl}/api/webhooks/twilio/voice?agentId=${cb.agentId}${leadQs}&dir=out`,
        statusCallbackUrl: `${baseUrl}/api/webhooks/twilio/status${statusQs}`,
      });
    } else if (provider === "plivo") {
      // Plivo: scope by userId, no managed fallback
      const [provRow] = await db
        .select()
        .from(providersTable)
        .where(and(
          eq(providersTable.providerName, "plivo"),
          ...(agent.userId ? [eq(providersTable.userId, agent.userId)] : []),
        ))
        .limit(1);
      if (!provRow) throw new Error(`No "plivo" provider configured for this user`);
      const cfg = provRow.extraConfig
        ? (JSON.parse(provRow.extraConfig) as Record<string, string>)
        : {} as Record<string, string>;
      if (!cfg["authId"] || !cfg["fromNumber"]) throw new Error("Plivo config missing authId or fromNumber");
      await dialPlivo({
        authId: cfg["authId"]!, authToken: decryptKey(provRow.apiKey),
        fromNumber: cfg["fromNumber"]!, toNumber: cb.toNumber,
        answerUrl: `${baseUrl}/api/webhooks/plivo/voice?agentId=${cb.agentId}${leadQs}&dir=out`,
      });
    } else if (provider === "vobiz") {
      // VoBiz: try user BYOP row first, fall back to platform managed credentials
      const creds = await resolveVobizCreds(agent.userId ?? null, cb.agentId);
      if (!creds) throw new Error(`No "vobiz" credentials available for this callback (neither BYOP nor managed)`);
      await dialVobiz({
        authId: creds.authId, authToken: creds.authToken,
        fromNumber: creds.fromNumber, toNumber: cb.toNumber,
        answerUrl:  `${baseUrl}/api/webhooks/vobiz/voice?agentId=${cb.agentId}${leadQs}&dir=out`,
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
