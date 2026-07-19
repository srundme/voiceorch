/**
 * Short-lived share tokens for call recordings (safe to put in Google Sheets).
 * Format: callId.expiryMs.hmacHex — verified without a DB round-trip.
 */

import { createHmac, scryptSync, timingSafeEqual } from "node:crypto";
import { APP_SECRET } from "../lib/app-secret.js";
import { getSelfBaseUrl } from "../lib/app-domain.js";

const SIGNING_KEY = scryptSync(APP_SECRET, "voiceorch-recording-share-v1", 32);

/** Default share link lifetime: 30 days. */
export const RECORDING_SHARE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function sign(callId: number, expiryMs: number): string {
  return createHmac("sha256", SIGNING_KEY)
    .update(`recording:${callId}:${expiryMs}`)
    .digest("hex");
}

export function issueRecordingShareToken(callId: number, ttlMs = RECORDING_SHARE_TTL_MS): string {
  const expiryMs = Date.now() + ttlMs;
  return `${callId}.${expiryMs}.${sign(callId, expiryMs)}`;
}

export function verifyRecordingShareToken(token: string): { callId: number } | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [idStr, expiryStr, provided] = parts as [string, string, string];
  const callId = Number.parseInt(idStr, 10);
  const expiryMs = Number.parseInt(expiryStr, 10);
  if (!Number.isFinite(callId) || !Number.isFinite(expiryMs)) return null;
  if (Date.now() > expiryMs) return null;
  const expected = sign(callId, expiryMs);
  try {
    const a = Buffer.from(provided, "hex");
    const b = Buffer.from(expected, "hex");
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  return { callId };
}

/** Absolute shareable recording URL for Sheets (no login required while valid). */
export function shareableRecordingUrl(callId: number): string {
  const token = issueRecordingShareToken(callId);
  const base = getSelfBaseUrl().replace(/\/+$/, "");
  return `${base}/api/storage/recordings/share/${encodeURIComponent(token)}`;
}
