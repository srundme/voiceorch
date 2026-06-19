import { anonymizeExpiredDpdpCalls } from "./dpdp/index.js";
import { logger } from "../lib/logger.js";

let started = false;

/** Default retention window for DPDP-enabled call PII, in days. */
const DEFAULT_RETENTION_DAYS = 180;

function resolveRetentionDays(): number {
  const raw = process.env["DPDP_RETENTION_DAYS"];
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_RETENTION_DAYS;
}

/**
 * Starts a daily sweep that anonymizes PII on DPDP-enabled calls older than the
 * configured retention window. Best-effort and never blocks anything — this is a
 * background data-minimization job, not part of any call path.
 */
export function startDpdpRetentionSweep(): void {
  if (started) return;
  started = true;

  const retentionDays = resolveRetentionDays();

  // Run once shortly after boot, then once per day.
  const tick = (): void => {
    void anonymizeExpiredDpdpCalls(retentionDays).catch((err) => {
      logger.warn({ err }, "DPDP retention sweep tick failed");
    });
  };

  setTimeout(tick, 60_000);
  setInterval(tick, 24 * 60 * 60 * 1000);

  logger.info({ retentionDays }, "DPDP retention sweep started");
}
