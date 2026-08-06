/**
 * Shared release path for phone numbers — used by DELETE /phone-numbers/:id
 * and by the renewal sweep when unpaid past grace.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db, phoneNumbersTable, whatsappChannelsTable } from "@workspace/db";
import { logActivity } from "../lib/activity.js";
import { logger } from "../lib/logger.js";

const VOBIZ_ACCOUNT_BASE = "https://api.vobiz.ai/api/v1/Account";

function getPlatformVobizCreds() {
  const authId = process.env["VOBIZ_AUTH_ID"];
  const authToken = process.env["VOBIZ_AUTH_TOKEN"];
  return { authId, authToken, configured: !!(authId && authToken) };
}

function vobizHeaders(authId: string, authToken: string) {
  const basicCreds = Buffer.from(`${authId}:${authToken}`).toString("base64");
  return {
    Authorization: `Basic ${basicCreds}`,
    "X-Auth-ID": authId,
    "X-Auth-Token": authToken,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

async function releaseVobizNumber(authId: string, authToken: string, e164: string): Promise<void> {
  const plusForm = e164.startsWith("+") ? e164 : `+${e164.replace(/\D/g, "")}`;
  let url = `${VOBIZ_ACCOUNT_BASE}/${authId}/numbers/${encodeURIComponent(plusForm)}`;
  let resp = await fetch(url, {
    method: "DELETE",
    headers: vobizHeaders(authId, authToken),
  });
  if (resp.status === 404) {
    url = `${VOBIZ_ACCOUNT_BASE}/${authId}/numbers/${encodeURIComponent(plusForm.slice(1))}`;
    resp = await fetch(url, {
      method: "DELETE",
      headers: vobizHeaders(authId, authToken),
    });
  }
  if (!resp.ok && resp.status !== 404) {
    const err = await resp.text();
    throw new Error(`Vobiz release error ${resp.status}: ${err}`);
  }
}

export type ReleasePhoneNumberReason = "user_requested" | "renewal_unpaid";

/**
 * Mark a number released locally, deactivate linked WhatsApp channels, and
 * unrent from VoBiz when applicable. Idempotent if already released.
 */
export async function releasePhoneNumberRecord(
  row: typeof phoneNumbersTable.$inferSelect,
  opts: { reason: ReleasePhoneNumberReason; log?: { warn: Function; info: Function; error: Function } } = {
    reason: "user_requested",
  },
): Promise<void> {
  const log = opts.log ?? logger;
  if (row.status === "released") return;

  const clerkId = row.userId;
  const plusForm = row.number.startsWith("+") ? row.number : `+${row.number}`;
  await db
    .update(whatsappChannelsTable)
    .set({
      active: false,
      status: "disconnected",
      lastError:
        opts.reason === "renewal_unpaid"
          ? "The number linked to this WhatsApp channel was released after unpaid renewal"
          : "The number linked to this WhatsApp channel was released",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(whatsappChannelsTable.userId, clerkId),
        inArray(whatsappChannelsTable.phoneE164, [row.number, plusForm]),
      ),
    );

  if (row.service === "whatsapp") {
    log.warn?.({ number: row.number }, "Releasing WhatsApp-service number — voice unrent API skipped");
  } else if (row.provider !== "vobiz") {
    log.info?.({ number: row.number, provider: row.provider }, "Releasing BYO number — carrier unrent skipped");
  } else {
    const { authId, authToken, configured } = getPlatformVobizCreds();
    if (configured) {
      try {
        await releaseVobizNumber(authId!, authToken!, row.number);
      } catch (err) {
        log.error?.({ err, number: row.number }, "Vobiz release failed — marking released in DB anyway");
      }
    }
  }

  await db
    .update(phoneNumbersTable)
    .set({
      status: "released",
      releasedAt: new Date(),
      agentId: null,
      nextRenewalAt: null,
      renewalGraceUntil: null,
    })
    .where(eq(phoneNumbersTable.id, row.id));

  await logActivity({
    userId: clerkId,
    eventType: "phone_number.released",
    resourceType: "phone_number",
    resourceId: String(row.id),
    description:
      opts.reason === "renewal_unpaid"
        ? `Phone number ${row.number} released after unpaid renewal (past grace)`
        : `Phone number ${row.number} released back to inventory`,
  });
}
