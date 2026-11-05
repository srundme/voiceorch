// ── BYO (bring-your-own) telephony numbers ───────────────────────────────────
// A user who saves a Plivo or VoBiz telephony provider key (with a `fromNumber`
// in its extra config) gets that number surfaced as a FIRST-CLASS row in
// `phone_numbers` (free — no renewals):
//   - provider='plivo'     → inbound resolved by To-number on /webhooks/plivo/voice
//   - provider='vobiz_byo' → inbound resolved by To-number on /webhooks/vobiz/voice
// That makes the normal Numbers-page assign/reassign flow work for it.
//
// We also auto-configure the user's own carrier account so inbound "just
// works": a SnapServe application pointing at our webhook, with the number
// attached. All carrier-side steps are best-effort (logged, never fatal):
// outbound + assignment must keep working even when the carrier API is
// unreachable or the token lacks permissions.
//
// VoBiz BYO exists so clients can bring a number from a VoBiz account they
// opened and KYC-verified themselves, independent of SnapServe's own VoBiz
// partner account.

import { db, phoneNumbersTable, providersTable } from "@workspace/db";
import { and, eq, ne } from "drizzle-orm";
import { decryptKey } from "../lib/crypto.js";
import { getSelfBaseUrl } from "../lib/app-domain.js";
import { logger } from "../lib/logger.js";
import { configureVobizNumberWebhook } from "./vobiz-account.js";

const PLIVO_BASE = "https://api.plivo.com/v1/Account";
const APP_NAME = "SnapServe Inbound";

/** phone_numbers.provider for a number imported from a client's own VoBiz account. */
export const BYO_VOBIZ_PROVIDER = "vobiz_byo";

interface PlivoCreds { authId: string; authToken: string; fromNumber: string }
type CarrierCreds = PlivoCreds;
type ProviderKeyRow = { providerType: string; providerName: string; isActive: boolean; apiKey: string; extraConfig: string | null };

/** Extract usable Auth ID / token / fromNumber creds for `carrier` (null when incomplete). */
function carrierCredsFromRow(p: ProviderKeyRow, carrier: "plivo" | "vobiz"): CarrierCreds | null {
  if (p.providerType !== "telephony" || p.providerName.toLowerCase() !== carrier || !p.isActive) return null;
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
 * Link the number on the USER'S own VoBiz account to a "SnapServe" application
 * pointing at our inbound webhook. Their account's default app is left alone
 * (makeDefault: false), so other numbers they route elsewhere are unaffected.
 */
export async function configureVobizInbound(creds: CarrierCreds): Promise<{ ok: boolean; detail: string }> {
  try {
    const r = await configureVobizNumberWebhook(creds.authId, creds.authToken, creds.fromNumber, getSelfBaseUrl(), { makeDefault: false });
    return { ok: r.verified, detail: r.detail };
  } catch (err) {
    return { ok: false, detail: `VoBiz API unreachable: ${err instanceof Error ? err.message : String(err)}` };
  }
}

type CarrierSpec = {
  /** providers.provider_name of the key. */
  carrier: "plivo" | "vobiz";
  /** phone_numbers.provider for the imported row. */
  rowProvider: string;
  label: string;
  configureInbound: (creds: CarrierCreds) => Promise<{ ok: boolean; detail: string }>;
};

const CARRIERS: CarrierSpec[] = [
  { carrier: "plivo", rowProvider: "plivo", label: "Plivo", configureInbound: configurePlivoInbound },
  { carrier: "vobiz", rowProvider: BYO_VOBIZ_PROVIDER, label: "VoBiz", configureInbound: configureVobizInbound },
];

/**
 * Sync one carrier's BYO number(s) into phone_numbers.
 * - Upserts a free row per active key fromNumber.
 * - Releases previously-imported rows whose backing key is gone.
 * - Best-effort configures inbound on the user's carrier account.
 */
async function syncCarrierNumbers(
  userId: string,
  keyRows: ProviderKeyRow[],
  spec: CarrierSpec,
  opts?: { configureAll?: boolean },
): Promise<void> {
  const wanted = new Map<string, CarrierCreds>();
  for (const row of keyRows) {
    const c = carrierCredsFromRow(row, spec.carrier);
    const num = c ? normalizeE164ish(c.fromNumber) : "";
    if (c && num) wanted.set(num, c);
  }

  // Release imported rows no longer backed by an active key.
  const existing = await db
    .select()
    .from(phoneNumbersTable)
    .where(and(
      eq(phoneNumbersTable.userId, userId),
      eq(phoneNumbersTable.provider, spec.rowProvider),
      ne(phoneNumbersTable.status, "released"),
    ));
  for (const row of existing) {
    if (!wanted.has(row.number)) {
      await db.update(phoneNumbersTable)
        .set({ status: "released", releasedAt: new Date(), agentId: null })
        .where(eq(phoneNumbersTable.id, row.id));
      logger.info({ userId, number: row.number }, `BYO ${spec.label} number released (key removed/deactivated)`);
    }
  }

  for (const [number, creds] of wanted) {
    const [any] = await db.select().from(phoneNumbersTable).where(eq(phoneNumbersTable.number, number));
    if (any && any.userId !== userId) {
      // Number already registered by another account — never steal it.
      logger.warn({ userId, number }, `BYO ${spec.label} number already registered to another account — skipped`);
      continue;
    }
    let changed = false;
    if (any) {
      if (any.provider !== spec.rowProvider) {
        // Same user already OWNS this number as a platform (paid) DID — never
        // convert it to a free BYO row (that would silently stop renewals).
        logger.warn({ userId, number, provider: any.provider }, `BYO ${spec.label} fromNumber matches an existing platform number — left untouched`);
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
        provider: spec.rowProvider,
        status: "active",
        monthlyRateCents: 0,
        renewalRateCents: 0,
      });
      changed = true;
      logger.info({ userId, number }, `BYO ${spec.label} number imported as phone_numbers row`);
    }
    // Carrier-side config is comparatively slow — only touch their account when
    // something changed, or when explicitly asked (assign flow / key save).
    if (changed || opts?.configureAll) {
      const cfg = await spec.configureInbound(creds);
      logger.info({ userId, number, ...cfg }, `BYO ${spec.label} inbound auto-config`);
    }
  }
}

/**
 * Sync the user's BYO Plivo and VoBiz numbers into phone_numbers.
 * Never throws — provider save/delete must not fail because of this.
 */
export async function syncByoNumbers(userId: string, opts?: { configureAll?: boolean }): Promise<void> {
  let keyRows: ProviderKeyRow[];
  try {
    keyRows = await db.select().from(providersTable).where(eq(providersTable.userId, userId));
  } catch (err) {
    logger.error({ userId, err: err instanceof Error ? err.message : String(err) }, "syncByoNumbers: provider load failed");
    return;
  }
  for (const spec of CARRIERS) {
    try {
      await syncCarrierNumbers(userId, keyRows, spec, opts);
    } catch (err) {
      logger.error({ userId, carrier: spec.carrier, err: err instanceof Error ? err.message : String(err) }, "syncByoNumbers failed");
    }
  }
}

/** Configure inbound for one imported VoBiz BYO number (assign flow / repair). */
export async function configureByoVobizNumber(userId: string, number: string): Promise<{ ok: boolean; detail: string }> {
  const keyRows = await db.select().from(providersTable).where(eq(providersTable.userId, userId));
  const want = normalizeE164ish(number);
  for (const row of keyRows) {
    const c = carrierCredsFromRow(row, "vobiz");
    if (c && normalizeE164ish(c.fromNumber) === want) return configureVobizInbound(c);
  }
  return { ok: false, detail: "No active VoBiz key on this account owns this number" };
}
