/**
 * Single source of truth for the application signing secret (SESSION_SECRET).
 *
 * Used to derive every key the platform signs or encrypts with:
 *  - session JWTs (lib/session.ts)
 *  - provider API-key encryption (lib/crypto.ts)
 *  - booking action tokens (services/scheduling/booking-tokens.ts)
 *
 * SESSION_SECRET is MANDATORY. There is deliberately no hardcoded fallback: a
 * static default would let anyone forge session tokens and impersonate any
 * account if the env var were ever missing in a real environment. We fail fast
 * at import time instead.
 *
 * The only exception is the test runner (NODE_ENV === "test"), where a fixed
 * placeholder is used so unit tests don't require external configuration.
 */

const fromEnv = process.env["SESSION_SECRET"];

function resolveSecret(): string {
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  if (process.env["NODE_ENV"] === "test") return "test-only-insecure-secret";
  throw new Error(
    "SESSION_SECRET is not set. It is required to sign session tokens and " +
      "encrypt stored secrets. Set SESSION_SECRET before starting the server.",
  );
}

/** The resolved application secret. Throws at startup if unset (outside tests). */
export const APP_SECRET: string = resolveSecret();
