/**
 * Stateless HMAC tokens for attendee self-service cancel / reschedule.
 *
 * Token format (URL-safe):  <bookingId>.<action>.<expiryMs>.<hmacHex>
 *
 * - bookingId  : numeric booking ID
 * - action     : "cancel" | "reschedule"
 * - expiryMs   : Unix timestamp (ms) after which the token is rejected
 * - hmacHex    : HMAC-SHA256 over "bookingId:action:expiryMs" using the
 *                signing key derived from SESSION_SECRET
 *
 * Single-use semantics are enforced at the application layer:
 *   cancel     → rejected if booking.status is already "cancelled" or "rescheduled"
 *   reschedule → rejected if booking.slotStart <= now
 */

import { createHmac, scryptSync } from "node:crypto";
import { APP_SECRET } from "../../lib/app-secret.js";

const SIGNING_KEY = scryptSync(APP_SECRET, "voiceorch-booking-token-salt-v1", 32);

export type TokenAction = "cancel" | "reschedule";

function sign(bookingId: number, action: TokenAction, expiryMs: number): string {
  return createHmac("sha256", SIGNING_KEY)
    .update(`${bookingId}:${action}:${expiryMs}`)
    .digest("hex");
}

/**
 * Issue a token for the given booking and action.
 *
 * Cancel tokens expire far in the future (effectively never) because single-use
 * semantics are enforced by checking booking.status — not by expiry.
 *
 * Reschedule tokens expire at slotStart so attendees cannot reschedule after the
 * meeting has already begun.
 */
export function issueToken(bookingId: number, action: TokenAction, expiryDate: Date): string {
  const expiryMs = expiryDate.getTime();
  const sig = sign(bookingId, action, expiryMs);
  return `${bookingId}.${action}.${expiryMs}.${sig}`;
}

export type VerifiedToken = {
  bookingId: number;
  action: TokenAction;
};

/**
 * Verify and decode a token string.
 * Returns null if the token is malformed, has an invalid signature, or is expired.
 */
export function verifyToken(token: string): VerifiedToken | null {
  const parts = token.split(".");
  if (parts.length !== 4) return null;

  const [idStr, actionStr, expiryStr, providedSig] = parts as [string, string, string, string];

  const bookingId = parseInt(idStr, 10);
  if (isNaN(bookingId) || bookingId <= 0) return null;

  if (actionStr !== "cancel" && actionStr !== "reschedule") return null;
  const action = actionStr as TokenAction;

  const expiryMs = parseInt(expiryStr, 10);
  if (isNaN(expiryMs)) return null;

  if (Date.now() > expiryMs) return null;

  const expectedSig = sign(bookingId, action, expiryMs);
  if (providedSig !== expectedSig) return null;

  return { bookingId, action };
}

/**
 * Build the expiry date for a cancel token: 5 years from now.
 * Single-use semantics are enforced by booking.status, not expiry.
 */
export function cancelTokenExpiry(): Date {
  return new Date(Date.now() + 5 * 365 * 24 * 60 * 60 * 1000);
}

/**
 * Build the expiry date for a reschedule token: the booking's slot start time.
 * Once the slot has begun, the attendee can no longer reschedule.
 */
export function rescheduleTokenExpiry(slotStart: Date): Date {
  return slotStart;
}
