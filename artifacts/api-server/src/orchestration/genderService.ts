/**
 * Shared helpers for the Voice Analysis (gender) microservice.
 *
 * Single source of truth for resolving the service base URL and for a loud
 * startup reachability probe. On Railway the API server and the Voice Analysis
 * service run in SEPARATE containers, so GENDER_SERVICE_URL MUST be set to the
 * internal service host (e.g. http://gender-service.railway.internal:5000).
 * When it is unset the detectors fall back to http://localhost:5000, which only
 * works in single-VM dev — in production that fetch always fails and the
 * Sir/Ma'am salutation silently never appears. The probe below makes that
 * misconfiguration obvious in the logs instead of silent.
 */

import { logger } from "../lib/logger.js";

/** Resolve the bare gender-service base URL (no trailing slash, no path suffix). */
export function genderServiceBaseUrl(): string {
  return (process.env["GENDER_SERVICE_URL"] ?? "http://localhost:5000").replace(/\/+$/, "");
}

/**
 * One-shot startup probe: logs the resolved URL and whether the service is
 * reachable. Fire-and-forget — never throws, never blocks server startup.
 */
export async function probeGenderService(): Promise<void> {
  const base = genderServiceBaseUrl();
  const url  = `${base}/voice-analysis/health`;
  const configured = process.env["GENDER_SERVICE_URL"];

  if (!configured) {
    logger.warn(
      { resolved: base },
      "GENDER_SERVICE_URL is NOT set — defaulting to http://localhost:5000. On Railway this MUST point at the internal Voice Analysis host (e.g. http://gender-service.railway.internal:5000) or caller gender detection (Sir/Ma'am) will silently fail.",
    );
  } else {
    logger.info({ resolved: base }, "Gender service URL resolved from GENDER_SERVICE_URL");
  }

  try {
    const res = await fetch(url, { method: "GET", signal: AbortSignal.timeout(8_000) });
    if (res.ok) {
      logger.info({ url }, "Gender service reachable at startup (health OK) — caller gender detection is wired up");
    } else {
      logger.warn({ url, status: res.status }, "Gender service health returned non-200 at startup — caller gender detection may fail");
    }
  } catch (err) {
    logger.warn(
      { url, err },
      "Gender service UNREACHABLE at startup — caller gender detection (Sir/Ma'am) will not work until GENDER_SERVICE_URL points at a running Voice Analysis service",
    );
  }
}
