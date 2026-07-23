import { db, vobizAccountsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { decryptKey } from "../lib/crypto.js";
import { logger } from "../lib/logger.js";

const VOBIZ_MESSAGING_URL = "https://api.vobiz.ai/api/v1/messaging/messages";

export interface SendVobizWhatsappOpts {
  userId?: string | null;
  toPhone: string;
  channelId?: string | null;
  wabaId?: string | null;
  type?: "text" | "template";
  text?: string;
  templateName?: string;
  templateLanguage?: string;
  templateComponents?: any[];
}

export interface SendVobizWhatsappResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Resolves Vobiz auth credentials for a user.
 * Tries user's provisioned sub-account first; falls back to master system env credentials.
 */
async function resolveVobizAuth(userId?: string | null): Promise<{ authId: string; authToken: string }> {
  if (userId) {
    try {
      const [acc] = await db
        .select()
        .from(vobizAccountsTable)
        .where(eq(vobizAccountsTable.userId, userId));
      if (acc?.vobizAuthId && acc?.vobizAuthTokenEncrypted) {
        return {
          authId: acc.vobizAuthId,
          authToken: decryptKey(acc.vobizAuthTokenEncrypted),
        };
      }
    } catch (err) {
      logger.warn({ err, userId }, "Vobiz WhatsApp: failed to fetch sub-account credentials, falling back to master env");
    }
  }
  return {
    authId: process.env["VOBIZ_AUTH_ID"] ?? "",
    authToken: process.env["VOBIZ_AUTH_TOKEN"] ?? "",
  };
}

/**
 * Send a native WhatsApp text or template message via Vobiz Messaging API.
 */
export async function sendVobizWhatsappMessage(opts: SendVobizWhatsappOpts): Promise<SendVobizWhatsappResult> {
  const { authId, authToken } = await resolveVobizAuth(opts.userId);
  if (!authId || !authToken) {
    logger.error({ toPhone: opts.toPhone }, "Vobiz WhatsApp: missing VOBIZ_AUTH_ID or VOBIZ_AUTH_TOKEN");
    return { success: false, error: "Vobiz API credentials not configured" };
  }

  // Format recipient phone number: ensure leading '+'
  let to = opts.toPhone.trim();
  if (!to.startsWith("+")) {
    to = `+${to}`;
  }

  const msgType = opts.type ?? (opts.templateName ? "template" : "text");

  let payload: Record<string, any>;

  if (msgType === "template" && opts.templateName) {
    payload = {
      channel_id: opts.channelId ?? undefined,
      waba_id: opts.wabaId ?? undefined,
      to,
      type: "template",
      template: {
        name: opts.templateName,
        language: { code: opts.templateLanguage ?? "en" },
        ...(opts.templateComponents ? { components: opts.templateComponents } : {}),
      },
    };
  } else {
    payload = {
      channel_id: opts.channelId ?? undefined,
      waba_id: opts.wabaId ?? undefined,
      to,
      type: "text",
      text: { body: opts.text ?? "" },
    };
  }

  try {
    const resp = await fetch(VOBIZ_MESSAGING_URL, {
      method: "POST",
      headers: {
        "X-Auth-ID": authId,
        "X-Auth-Token": authToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      logger.error(
        { status: resp.status, errText, to, type: msgType },
        "Vobiz WhatsApp: API request failed",
      );
      return { success: false, error: `Vobiz WhatsApp API error (${resp.status}): ${errText}` };
    }

    const data = (await resp.json()) as { message_id?: string; id?: string; status?: string };
    const messageId = data.message_id || data.id || "ok";
    logger.info(
      { to, type: msgType, messageId },
      "Vobiz WhatsApp: message sent successfully",
    );
    return { success: true, messageId };
  } catch (err: any) {
    const errMsg = err?.message || String(err);
    logger.error({ err: errMsg, to }, "Vobiz WhatsApp: request exception");
    return { success: false, error: errMsg };
  }
}
