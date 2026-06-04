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
    return userId ?? ipKeyGenerator(req);
  },
  message: { error: "Too many requests. Please slow down." },
  handler: (req, res, _next, options) => {
    logger.warn({ userId: (req as any).clerkUserId }, "Rate limit exceeded (auth)");
    res.status(429).json(options.message);
  },
});

// Exempt routes that don't need rate limiting
export const exemptPaths = [
  "/api/healthz",
  "/api/campaign-webhook",
  "/api/webhooks",
  "/api/webcall-notify",
];

export function isRateLimitExempt(url: string): boolean {
  return exemptPaths.some((p) => url.startsWith(p));
}
