/**
 * Long-lived Meta user-token exchange + expiry tracking.
 *
 * System-user (permanent) tokens cannot be exchanged and are left as-is.
 * Short-lived / 60-day user tokens can be swapped via fb_exchange_token when
 * META_APP_ID + META_APP_SECRET (or platform_settings) are configured.
 */

import { eq } from "drizzle-orm";
import { db, platformSettingsTable, whatsappConnectionsTable } from "@workspace/db";
import { decryptKey, encryptKey } from "../../lib/crypto.js";
import { logger } from "../../lib/logger.js";

const GRAPH_OAUTH = "https://graph.facebook.com/v21.0/oauth/access_token";
const GRAPH_DEBUG = "https://graph.facebook.com/v21.0/debug_token";
const REFRESH_WITHIN_MS = 7 * 24 * 60 * 60 * 1000;

async function getSetting(key: string): Promise<string | null> {
  const [row] = await db
    .select({ value: platformSettingsTable.value })
    .from(platformSettingsTable)
    .where(eq(platformSettingsTable.key, key))
    .limit(1);
  return row?.value?.trim() || null;
}

export async function getMetaAppCredentials(): Promise<{ appId: string; appSecret: string } | null> {
  const appId =
    (process.env["META_APP_ID"] ?? "").trim()
    || (await getSetting("managed_meta_app_id"))
    || (await getSetting("meta_app_id"));
  const appSecret =
    (process.env["META_APP_SECRET"] ?? "").trim()
    || (await getSetting("managed_meta_app_secret"))
    || (await getSetting("meta_app_secret"));
  if (!appId || !appSecret) return null;
  return { appId, appSecret };
}

export async function exchangeMetaLongLivedToken(
  shortLived: string,
): Promise<{ accessToken: string; expiresAt: Date | null } | null> {
  const creds = await getMetaAppCredentials();
  if (!creds) return null;
  const url =
    `${GRAPH_OAUTH}?grant_type=fb_exchange_token`
    + `&client_id=${encodeURIComponent(creds.appId)}`
    + `&client_secret=${encodeURIComponent(creds.appSecret)}`
    + `&fb_exchange_token=${encodeURIComponent(shortLived)}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
    const json = (await res.json().catch(() => null)) as {
      access_token?: string;
      expires_in?: number;
      error?: { message?: string };
    } | null;
    if (!res.ok || !json?.access_token) {
      logger.info(
        { status: res.status, error: json?.error?.message },
        "whatsapp-meta: long-lived token exchange skipped",
      );
      return null;
    }
    const expiresAt =
      typeof json.expires_in === "number" && json.expires_in > 0
        ? new Date(Date.now() + json.expires_in * 1000)
        : null;
    return { accessToken: json.access_token, expiresAt };
  } catch (err) {
    logger.warn({ err }, "whatsapp-meta: long-lived token exchange failed");
    return null;
  }
}

export async function inspectMetaTokenExpiry(accessToken: string): Promise<Date | null> {
  const creds = await getMetaAppCredentials();
  if (!creds) return null;
  const appToken = `${creds.appId}|${creds.appSecret}`;
  const url =
    `${GRAPH_DEBUG}?input_token=${encodeURIComponent(accessToken)}`
    + `&access_token=${encodeURIComponent(appToken)}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    const json = (await res.json().catch(() => null)) as {
      data?: { expires_at?: number; data_access_expires_at?: number };
    } | null;
    const unix = json?.data?.expires_at || json?.data?.data_access_expires_at;
    if (typeof unix === "number" && unix > 0) return new Date(unix * 1000);
  } catch (err) {
    logger.warn({ err }, "whatsapp-meta: debug_token failed");
  }
  return null;
}

/**
 * Persist a long-lived token when exchange is possible. No-op for system-user
 * tokens or custom BSP API bases (those are not Graph oauth).
 */
export async function persistRefreshedMetaToken(opts: {
  connectionId: string;
  accessToken: string;
  apiBase?: string | null;
}): Promise<string> {
  if ((opts.apiBase ?? "").trim()) return opts.accessToken;
  const exchanged = await exchangeMetaLongLivedToken(opts.accessToken);
  const token = exchanged?.accessToken ?? opts.accessToken;
  let expiresAt = exchanged?.expiresAt ?? null;
  if (!expiresAt) expiresAt = await inspectMetaTokenExpiry(token);
  try {
    await db.update(whatsappConnectionsTable)
      .set({
        ...(exchanged?.accessToken ? { metaAccessToken: encryptKey(token) } : {}),
        ...(expiresAt ? { metaTokenExpiresAt: expiresAt } : {}),
        updatedAt: new Date(),
      })
      .where(eq(whatsappConnectionsTable.id, opts.connectionId));
  } catch (err) {
    logger.warn({ err, connectionId: opts.connectionId }, "whatsapp-meta: failed to persist refreshed token");
  }
  return token;
}

/**
 * Decrypt the stored token, refreshing it first when it is within 7 days of
 * expiry (or already expired) and Meta app credentials are available.
 */
export async function resolveMetaAccessToken(opts: {
  connectionId: string;
  encryptedToken: string;
  expiresAt?: Date | null;
  apiBase?: string | null;
}): Promise<string> {
  const current = decryptKey(opts.encryptedToken);
  if ((opts.apiBase ?? "").trim()) return current;
  const expiresAt = opts.expiresAt ?? null;
  if (!expiresAt) return current;
  if (expiresAt.getTime() - Date.now() >= REFRESH_WITHIN_MS) return current;
  return persistRefreshedMetaToken({
    connectionId: opts.connectionId,
    accessToken: current,
    apiBase: opts.apiBase,
  });
}
