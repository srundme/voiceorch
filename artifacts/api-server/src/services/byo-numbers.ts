// ── BYO (bring-your-own) telephony numbers ───────────────────────────────────
// A user who saves a Plivo telephony provider key (with a `fromNumber` in its
// extra config) gets that number surfaced as a FIRST-CLASS row in
// `phone_numbers` (provider='plivo', free — no renewals). That makes the
// normal Numbers-page assign/reassign flow work for it, and inbound calls are
// resolved by To-number lookup on /api/webhooks/plivo/voice.
//
// We also auto-configure the user's own Plivo account so inbound "just works":
// find-or-create a "SnapServe Inbound" Plivo Application pointing at our
// webhook, then attach the number to it. All Plivo-side steps are best-effort
// (logged, never fatal): outbound + assignment must keep working even when the
// Plivo API is unreachable or the token lacks permissions.

import { db, phoneNumbersTable, providersTable } from "@workspace/db";
import { and, eq, ne } from "drizzle-orm";
import { decryptKey } from "../lib/crypto.js";
import { getSelfBaseUrl } from "../lib/app-domain.js";
import { logger } from "../lib/logger.js";

const PLIVO_BASE = "https://api.plivo.com/v1/Account";
const APP_NAME = "SnapServe Inbound";

interface PlivoCreds { authId: string; authToken: string; fromNumber: string }

/** Extract usable Plivo creds from a provider row (null when incomplete). */
function plivoCredsFromRow(p: { providerType: string; providerName: string; isActive: boolean; apiKey: string; extraConfig: string | null }): PlivoCreds | null {
  if (p.providerType !== "telephony" || p.providerName.toLowerCase() !== "plivo" || !p.isActive) return null;
  let cfg: Record<string, string> = {};
  try { cfg = p.extraConfig ? JSON.parse(p.extraConfig) as Record<string, string> : {}; } catch { return null; }
  const authId = (cfg["authId"] ?? "").trim();
  const fromNumber = (cfg["fromNumber"] ?? "").trim();
  if (!authId || !fromNumber) return null;
  return { authId, authToken: decryptKey(p.apiKey), fromNumber };
}

/** "+91 98765 43210" → "+919876543210"; keeps a single leading +. */
function normalizeE164ish(num: string): string {
  const digits = num.replace(/[^\d]/g, "");
  return digits ? `+${digits}` : "";
}

/** Best-effort country code from an E.164ish number (defaults to "IN"). */
function guessCountry(number: string): string {
  const d = number.replace(/[^\d]/g, "");
  if (d.startsWith("91")) return "IN";
  if (d.startsWith("1")) return "US";
  if (d.startsWith("44")) return "GB";
  return "IN";
}

async function plivoFetch(creds: PlivoCreds, path: string, init?: RequestInit): Promise<Response> {
  const auth = Buffer.from(`${creds.authId}:${creds.authToken}`).toString("base64");
  return fetch(`${PLIVO_BASE}/${creds.authId}${path}`, {
    ...init,
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}

/**
 * Find-or-create the "SnapServe Inbound" Application on the USER'S Plivo
 * account and attach the number to it, so inbound calls hit our webhook with
 * no manual Plivo-console steps. Returns a short status string for logs/UI.
 */
export async function configurePlivoInbound(creds: PlivoCreds): Promise<{ ok: boolean; detail: string }> {
  const answerUrl = `${getSelfBaseUrl()}/api/webhooks/plivo/voice`;
  try {
    // 1. Find an existing app by name.
    let appId: string | null = null;
    const listRes = await plivoFetch(creds, "/Application/?limit=20");
    if (listRes.ok) {
      const data = await listRes.json() as { objects?: Array<{ app_id: string; app_name: string; answer_url?: string }> };
      const found = (data.objects ?? []).find((a) => a.app_name === APP_NAME);
      if (found) {
        appId = found.app_id;
        if (found.answer_url !== answerUrl) {
          await plivoFetch(creds, `/Application/${appId}/`, {
            method: "POST",
            body: JSON.stringify({ answer_url: answerUrl, answer_method: "POST" }),
          });
        }
      }
    }
    // 2. Create it when missing.
    if (!appId) {
      const createRes = await plivoFetch(creds, "/Application/", {
        method: "POST",
        body: JSON.stringify({ app_name: APP_NAME, answer_url: answerUrl, answer_method: "POST" }),
      });
      if (!createRes.ok) return { ok: false, detail: `app create failed (${createRes.status})` };
      const created = await createRes.json() as { app_id: string };
      appId = created.app_id;
    }
    // 3. Attach the number (Plivo number resource path uses digits, no '+').
    const numberPath = creds.fromNumber.replace(/[^\d]/g, "");
    const attachRes = await plivoFetch(creds, `/Number/${numberPath}/`, {
      method: "POST",
      body: JSON.stringify({ app_id: appId }),
    });
    if (!attachRes.ok) return { ok: false, detail: `number attach failed (${attachRes.status})` };
    return { ok: true, detail: "inbound webhook configured on Plivo" };
  } catch (err) {
    return { ok: false, detail: `Plivo API unreachable: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/**
 * Sync the user's BYO Plivo number(s) into phone_numbers.
 * - Upserts a free provider='plivo' row per active Plivo key fromNumber.
 * - Releases previously-imported plivo rows whose backing key is gone.
 * - Best-effort configures inbound on the user's Plivo account.
 * Never throws — provider save/delete must not fail because of this.
 */
export async function syncByoPlivoNumbers(userId: string, opts?: { configureAll?: boolean }): Promise<void> {
  try {
    const rows = await db.select().from(providersTable).where(eq(providersTable.userId, userId));
    const credsList = rows.map(plivoCredsFromRow).filter((c): c is PlivoCreds => !!c);
    const wanted = new Map<string, PlivoCreds>();
    for (const c of credsList) {
      const num = normalizeE164ish(c.fromNumber);
      if (num) wanted.set(num, c);
    }

    // Release imported rows no longer backed by an active key.
    const existing = await db
      .select()
      .from(phoneNumbersTable)
      .where(and(
        eq(phoneNumbersTable.userId, userId),
        eq(phoneNumbersTable.provider, "plivo"),
        ne(phoneNumbersTable.status, "released"),
      ));
    for (const row of existing) {
      if (!wanted.has(row.number)) {
        await db.update(phoneNumbersTable)
          .set({ status: "released", releasedAt: new Date(), agentId: null })
          .where(eq(phoneNumbersTable.id, row.id));
        logger.info({ userId, number: row.number }, "BYO Plivo number released (key removed/deactivated)");
      }
    }

    for (const [number, creds] of wanted) {
      const [any] = await db.select().from(phoneNumbersTable).where(eq(phoneNumbersTable.number, number));
      if (any && any.userId !== userId) {
        // Number already registered by another account — never steal it.
        logger.warn({ userId, number }, "BYO Plivo number already registered to another account — skipped");
        continue;
      }
      let changed = false;
      if (any) {
        if (any.provider !== "plivo") {
          // Same user already OWNS this number as a platform (paid) DID — never
          // convert it to a free BYO row (that would silently stop renewals).
          logger.warn({ userId, number, provider: any.provider }, "BYO Plivo fromNumber matches an existing platform number — left untouched");
          continue;
        }
        if (any.status === "released") {
          await db.update(phoneNumbersTable)
            .set({ status: "active", releasedAt: null, monthlyRateCents: 0, renewalRateCents: 0, nextRenewalAt: null })
            .where(eq(phoneNumbersTable.id, any.id));
          changed = true;
        }
      } else {
        await db.insert(phoneNumbersTable).values({
          userId,
          number,
          countryCode: guessCountry(number),
          numberType: "local",
          service: "voice",
          provider: "plivo",
          status: "active",
          monthlyRateCents: 0,
          renewalRateCents: 0,
        });
        changed = true;
        logger.info({ userId, number }, "BYO Plivo number imported as phone_numbers row");
      }
      // Plivo-side config is comparatively slow — only touch their account when
      // something changed, or when explicitly asked (assign flow / key save).
      if (changed || opts?.configureAll) {
        const cfg = await configurePlivoInbound(creds);
        logger.info({ userId, number, ...cfg }, "BYO Plivo inbound auto-config");
      }
    }
  } catch (err) {
    logger.error({ userId, err: err instanceof Error ? err.message : String(err) }, "syncByoPlivoNumbers failed");
  }
}
