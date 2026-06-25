/**
 * VoBiz Master Wallet Monitor
 *
 * Runs every 15 minutes. Computes the recommended minimum VoBiz balance
 * based on total user wallet balances in the platform, then alerts via
 * the existing dispatchAlertNotification channel if VoBiz funds are low.
 *
 * Business rule (from master-costing.md):
 *   VoBiz telephony = 10.8% of user spend → keep 20% buffer
 *   ∴ recommended = totalUserWalletUSD × (thresholdPct / 100) × usdToInrRate
 *
 * Two severity tiers:
 *   warning  — VoBiz balance < recommended minimum
 *   critical — VoBiz balance < 50% of recommended minimum (half-empty)
 *
 * Config keys (platform_settings table, editable from Admin):
 *   vobiz_wallet_threshold_pct  — % of user wallets to keep in VoBiz (default 20)
 *   vobiz_usd_to_inr_rate       — USD→INR exchange rate used for conversion (default 96)
 *
 * Alert cooldown uses a separate in-process timestamp to avoid spamming:
 * one alert every 60 minutes maximum regardless of severity, except when
 * severity escalates from warning → critical.
 */

import { db, usersTable, platformSettingsTable } from "@workspace/db";
import { sql, eq } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { dispatchAlertNotification } from "./alert-notifications.js";

const CHECK_INTERVAL_MS = 15 * 60 * 1000; // every 15 minutes
const ALERT_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour between alerts (same severity)

const THRESHOLD_PCT_KEY   = "vobiz_wallet_threshold_pct";
const USD_TO_INR_KEY      = "vobiz_usd_to_inr_rate";

let _lastAlertAt   = 0;
let _lastSeverity  = "";

async function getConfig(): Promise<{ thresholdPct: number; usdToInr: number }> {
  const [pctRow, rateRow] = await Promise.all([
    db
      .select({ value: platformSettingsTable.value })
      .from(platformSettingsTable)
      .where(eq(platformSettingsTable.key, THRESHOLD_PCT_KEY))
      .then(([r]) => r),
    db
      .select({ value: platformSettingsTable.value })
      .from(platformSettingsTable)
      .where(eq(platformSettingsTable.key, USD_TO_INR_KEY))
      .then(([r]) => r),
  ]);

  const thresholdPct = pctRow?.value ? Number(pctRow.value) : 20;
  const usdToInr     = rateRow?.value ? Number(rateRow.value) : 96;

  return {
    thresholdPct: Number.isFinite(thresholdPct) && thresholdPct > 0 ? thresholdPct : 20,
    usdToInr:     Number.isFinite(usdToInr)     && usdToInr > 0     ? usdToInr     : 96,
  };
}

async function fetchTotalUserWalletCents(): Promise<number> {
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(wallet_balance_cents), 0)` })
    .from(usersTable);
  return Number(row?.total ?? 0);
}

async function fetchVobizBalance(): Promise<{ availableBalance: number; currency: string } | null> {
  const authId    = process.env["VOBIZ_AUTH_ID"];
  const authToken = process.env["VOBIZ_AUTH_TOKEN"];
  if (!authId || !authToken) return null;

  const basicCreds = Buffer.from(`${authId}:${authToken}`).toString("base64");
  const resp = await fetch(
    `https://api.vobiz.ai/api/v1/Account/${authId}/balance/INR`,
    { headers: { Authorization: `Basic ${basicCreds}`, Accept: "application/json" } },
  );

  if (!resp.ok) {
    logger.warn({ status: resp.status }, "VoBiz wallet monitor: balance fetch failed");
    return null;
  }

  const data = (await resp.json()) as Record<string, unknown>;
  const raw = Number(data["available_balance"] ?? data["balance"] ?? 0);
  return { availableBalance: raw, currency: String(data["currency"] ?? "INR") };
}

async function checkVobizWallet(): Promise<void> {
  try {
    const [config, totalUserCents, vobiz] = await Promise.all([
      getConfig(),
      fetchTotalUserWalletCents(),
      fetchVobizBalance(),
    ]);

    if (vobiz === null) {
      logger.debug("VoBiz wallet monitor: skipping — VOBIZ_AUTH_ID/TOKEN not set or API error");
      return;
    }

    const totalUserUsd   = totalUserCents / 100;
    const requiredInr    = totalUserUsd * (config.thresholdPct / 100) * config.usdToInr;
    const criticalInr    = requiredInr * 0.5;
    const vobizBalance   = vobiz.availableBalance;

    logger.info(
      {
        totalUserUsd:    totalUserUsd.toFixed(2),
        thresholdPct:    config.thresholdPct,
        usdToInr:        config.usdToInr,
        requiredInr:     requiredInr.toFixed(2),
        vobizBalanceInr: vobizBalance.toFixed(2),
      },
      "VoBiz wallet monitor: check complete",
    );

    if (vobizBalance >= requiredInr) {
      // All good — reset cooldown so next drop triggers immediately
      _lastAlertAt  = 0;
      _lastSeverity = "";
      return;
    }

    const severity = vobizBalance < criticalInr ? "critical" : "warning";
    const now      = Date.now();
    const isEscalation = severity === "critical" && _lastSeverity === "warning";
    if (!isEscalation && _lastAlertAt > 0 && now - _lastAlertAt < ALERT_COOLDOWN_MS) {
      logger.debug({ severity, lastAlertAt: _lastAlertAt }, "VoBiz wallet monitor: alert suppressed by cooldown");
      return;
    }

    const shortfall    = requiredInr - vobizBalance;
    const title        = severity === "critical"
      ? `VoBiz master wallet critically low — ₹${vobizBalance.toFixed(0)} remaining`
      : `VoBiz master wallet low — top up recommended`;

    const message =
      `Total user wallets: $${totalUserUsd.toFixed(2)} USD\n` +
      `Recommended VoBiz balance (${config.thresholdPct}% of user wallets): ₹${requiredInr.toFixed(0)} INR\n` +
      `Current VoBiz available balance:   ₹${vobizBalance.toFixed(0)} INR\n` +
      `Shortfall: ₹${shortfall.toFixed(0)} INR\n\n` +
      (severity === "critical"
        ? `⚠️  CRITICAL: VoBiz balance is below 50% of the safe minimum. ` +
          `Active calls may fail within minutes. Top up immediately.`
        : `VoBiz balance has dropped below the recommended ${config.thresholdPct}% buffer. ` +
          `Top up at least ₹${shortfall.toFixed(0)} INR to restore the safety margin.`);

    await dispatchAlertNotification({
      type:     "platform" as never,
      severity,
      title,
      message,
      service:  "vobiz",
      provider: "vobiz",
    });

    _lastAlertAt  = now;
    _lastSeverity = severity;

    logger.warn(
      { severity, vobizBalance, requiredInr, shortfall },
      `VoBiz wallet monitor: ${severity} alert dispatched`,
    );
  } catch (err) {
    logger.warn({ err }, "VoBiz wallet monitor: unexpected error in checkVobizWallet");
  }
}

export function startVobizWalletMonitor(): void {
  logger.info({ intervalMs: CHECK_INTERVAL_MS }, "VoBiz wallet monitor started");
  void checkVobizWallet();
  setInterval(() => void checkVobizWallet(), CHECK_INTERVAL_MS).unref();
}

/**
 * Returns a one-shot snapshot for the admin dashboard.
 * Does NOT fire alerts — pure read.
 */
export async function getVobizWalletStatus(): Promise<{
  totalUserWalletUsd:  number;
  vobizBalanceInr:     number | null;
  requiredMinInr:      number;
  shortfallInr:        number;
  thresholdPct:        number;
  usdToInr:            number;
  status:              "ok" | "warning" | "critical" | "unknown";
}> {
  const [config, totalUserCents, vobiz] = await Promise.all([
    getConfig(),
    fetchTotalUserWalletCents(),
    fetchVobizBalance(),
  ]);

  const totalUserUsd = totalUserCents / 100;
  const requiredInr  = totalUserUsd * (config.thresholdPct / 100) * config.usdToInr;

  if (vobiz === null) {
    return {
      totalUserWalletUsd: totalUserUsd,
      vobizBalanceInr:    null,
      requiredMinInr:     requiredInr,
      shortfallInr:       0,
      thresholdPct:       config.thresholdPct,
      usdToInr:           config.usdToInr,
      status:             "unknown",
    };
  }

  const shortfall = Math.max(0, requiredInr - vobiz.availableBalance);
  let status: "ok" | "warning" | "critical" = "ok";
  if (vobiz.availableBalance < requiredInr * 0.5) status = "critical";
  else if (vobiz.availableBalance < requiredInr)  status = "warning";

  return {
    totalUserWalletUsd:  totalUserUsd,
    vobizBalanceInr:     vobiz.availableBalance,
    requiredMinInr:      requiredInr,
    shortfallInr:        shortfall,
    thresholdPct:        config.thresholdPct,
    usdToInr:            config.usdToInr,
    status,
  };
}
