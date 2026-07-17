import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { logger } from "./logger.js";

/**
 * Rate limiting middleware for production safety.
 *
 * • IP-based limit: 100 req/min (catches DDoS, abuse)
 * • Auth-based limit: 500 req/min per user (catches API abuse, runaway scripts)
 * • Public routes (healthz, webhook verification) are exempted
 */

export const ipRateLimit = rateLimit({
  windowMs: 60 * 1000,       // 1 minute
  max: 100,                  // 100 requests per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests from this IP. Please slow down." },
  handler: (req, res, _next, options) => {
    logger.warn({ ip: req.ip, userId: (req as any).clerkUserId }, "Rate limit exceeded (IP)");
    res.status(429).json(options.message);
  },
});

export const authRateLimit = rateLimit({
  windowMs: 60 * 1000,       // 1 minute
  max: 500,                  // 500 requests per minute per user
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Use Clerk userId as the rate-limit key; fall back to IP (IPv6-safe)
    const userId = (req as any).clerkUserId;
    return userId ?? ipKeyGenerator(req.ip ?? req.socket?.remoteAddress ?? "unknown");
  },
  message: { error: "Too many requests. Please slow down." },
  handler: (req, res, _next, options) => {
    logger.warn({ userId: (req as any).clerkUserId }, "Rate limit exceeded (auth)");
    res.status(429).json(options.message);
  },
});

// Exempt routes that don't need rate limiting.
// /api/admin/* is excluded: it's already gated by requireAdmin (x-admin-token secret)
// and typically served to a single admin IP — IP-based limiting causes 429s from
// the admin panel's own polling queries (platform, alerts, overview, etc.).
// Scheduling public routes are unauthenticated and reachable from the internet.
// The global IP limit (100/min) still lets an attacker hammer ONE booking page's
// slot-availability lookup or spam bookings under many different emails from the
// same IP. These narrower, route-specific limits sit in front of the global one.
export const schedulingSlotsRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 30, // 30 slot lookups/min per (IP, slug) — generous for real calendar browsing
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const slug = (req.query["slug"] as string | undefined) ?? "unknown";
    return `${ipKeyGenerator(req.ip ?? req.socket?.remoteAddress ?? "unknown")}:${slug}`;
  },
  message: { error: "Too many availability checks for this booking page. Please slow down." },
  handler: (req, res, _next, options) => {
    logger.warn({ ip: req.ip, slug: req.query["slug"] }, "Rate limit exceeded (scheduling slots)");
    res.status(429).json(options.message);
  },
});

export const schedulingBookingRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 5, // 5 booking attempts/min per (IP, attendee email) — blocks spam without blocking retries
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const email = String((req.body as Record<string, unknown> | undefined)?.["attendeeEmail"] ?? "unknown").toLowerCase();
    return `${ipKeyGenerator(req.ip ?? req.socket?.remoteAddress ?? "unknown")}:${email}`;
  },
  message: { error: "Too many booking attempts. Please try again in a minute." },
  handler: (req, res, _next, options) => {
    logger.warn({ ip: req.ip }, "Rate limit exceeded (scheduling booking)");
    res.status(429).json(options.message);
  },
});

// Public workshop feedback form (unauthenticated, internet-facing). Same
// pattern as the scheduling limiters: narrow per-page / per-submitter limits in
// front of the global 100/min IP limit.
export const workshopMetaRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 60, // 60 meta lookups/min per (IP, slug) — generous for form loads/retries
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const slug = (req.params["slug"] as string | undefined) ?? "unknown";
    return `${ipKeyGenerator(req.ip ?? req.socket?.remoteAddress ?? "unknown")}:${slug}`;
  },
  message: { error: "Too many requests for this workshop form. Please slow down." },
  handler: (req, res, _next, options) => {
    logger.warn({ ip: req.ip, slug: req.params["slug"] }, "Rate limit exceeded (workshop meta)");
    res.status(429).json(options.message);
  },
});

export const workshopSubmitRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 5, // 5 submissions/min per (IP, email) — blocks spam without blocking retries
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const email = String((req.body as Record<string, unknown> | undefined)?.["email"] ?? "unknown").toLowerCase();
    return `${ipKeyGenerator(req.ip ?? req.socket?.remoteAddress ?? "unknown")}:${email}`;
  },
  message: { error: "Too many submissions. Please try again in a minute." },
  handler: (req, res, _next, options) => {
    logger.warn({ ip: req.ip }, "Rate limit exceeded (workshop submit)");
    res.status(429).json(options.message);
  },
});

export const exemptPaths = [
  "/api/healthz",
  "/api/campaign-webhook",
  "/api/webhooks",
  "/api/webcall-notify",
  "/api/admin",
];

export function isRateLimitExempt(url: string): boolean {
  return exemptPaths.some((p) => url.startsWith(p));
}
