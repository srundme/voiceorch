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

// ── Live diagnostics (admin) ──────────────────────────────────────────────────

/** Build a minimal silent 8 kHz 16-bit mono WAV of `seconds` length for probing. */
function buildSilentWav(seconds = 1): Buffer {
  const sampleRate = 8_000;
  const dataLen = sampleRate * 2 * seconds; // 16-bit mono
  const hdr = Buffer.alloc(44);
  hdr.write("RIFF", 0, "ascii");
  hdr.writeUInt32LE(36 + dataLen, 4);
  hdr.write("WAVE", 8, "ascii");
  hdr.write("fmt ", 12, "ascii");
  hdr.writeUInt32LE(16, 16);
  hdr.writeUInt16LE(1, 20);
  hdr.writeUInt16LE(1, 22);
  hdr.writeUInt32LE(sampleRate, 24);
  hdr.writeUInt32LE(sampleRate * 2, 28);
  hdr.writeUInt16LE(2, 32);
  hdr.writeUInt16LE(16, 34);
  hdr.write("data", 36, "ascii");
  hdr.writeUInt32LE(dataLen, 40);
  return Buffer.concat([hdr, Buffer.alloc(dataLen)]);
}

export interface GenderServiceProbe {
  ok: boolean;
  status?: number;
  body?: unknown;
  error?: string;
  latencyMs: number;
}

export interface GenderServiceDiagnostics {
  /** Resolved base URL the detectors actually use (no trailing slash). */
  resolvedUrl: string;
  /** Whether GENDER_SERVICE_URL is explicitly set vs falling back to localhost. */
  configured: boolean;
  /** GET /voice-analysis/health (liveness). */
  health: GenderServiceProbe;
  /** GET /voice-analysis/ready (wav2vec2 dependency readiness). */
  ready: GenderServiceProbe;
  /** POST probe of each detection endpoint the chained detector uses, in order. */
  detection: Array<{ name: string; path: string } & GenderServiceProbe>;
}

async function probeGet(url: string, timeoutMs: number): Promise<GenderServiceProbe> {
  const t0 = Date.now();
  try {
    const res = await fetch(url, { method: "GET", signal: AbortSignal.timeout(timeoutMs) });
    let body: unknown;
    try { body = await res.json(); } catch { body = undefined; }
    return { ok: res.ok, status: res.status, body, latencyMs: Date.now() - t0 };
  } catch (err) {
    return { ok: false, error: (err as Error)?.name ?? String(err), latencyMs: Date.now() - t0 };
  }
}

async function probeDetection(url: string, wav: Buffer, timeoutMs: number): Promise<GenderServiceProbe> {
  const t0 = Date.now();
  try {
    const ab = wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength) as ArrayBuffer;
    const form = new FormData();
    form.append("file", new Blob([ab], { type: "audio/wav" }), "probe.wav");
    const res = await fetch(url, { method: "POST", body: form, signal: AbortSignal.timeout(timeoutMs) });
    let body: unknown;
    try { body = await res.json(); } catch { body = undefined; }
    return { ok: res.ok, status: res.status, body, latencyMs: Date.now() - t0 };
  } catch (err) {
    return { ok: false, error: (err as Error)?.name ?? String(err), latencyMs: Date.now() - t0 };
  }
}

/**
 * Live diagnostics for the gender-service, used by the admin endpoint so
 * production health can be checked without placing a call. Probes liveness,
 * readiness, and each detection endpoint with a small silent WAV.
 */
export async function diagnoseGenderService(): Promise<GenderServiceDiagnostics> {
  const base = genderServiceBaseUrl();
  const wav = buildSilentWav(1);

  // Generous timeouts: the wav2vec2 model is lazily loaded, so the first probe
  // after a cold start can take ~10 s. This is an on-demand admin check, not a
  // hot path, so favour avoiding false negatives over speed.
  const [health, ready, dv2, dml, dpitch] = await Promise.all([
    probeGet(`${base}/voice-analysis/health`, 5_000),
    probeGet(`${base}/voice-analysis/ready`, 25_000),
    probeDetection(`${base}/voice-analysis/gender-ml-v2`, wav, 25_000),
    probeDetection(`${base}/voice-analysis/gender-ml`, wav, 15_000),
    probeDetection(`${base}/voice-analysis/gender`, wav, 15_000),
  ]);

  return {
    resolvedUrl: base,
    configured: Boolean(process.env["GENDER_SERVICE_URL"]),
    health,
    ready,
    detection: [
      { name: "wav2vec2",        path: "/voice-analysis/gender-ml-v2", ...dv2 },
      { name: "autocorrelation", path: "/voice-analysis/gender-ml",    ...dml },
      { name: "pitch",           path: "/voice-analysis/gender",       ...dpitch },
    ],
  };
}
