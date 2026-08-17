/**
 * Email + password authentication routes.
 *
 *   POST /api/auth/register                — create account, returns { token }
 *   POST /api/auth/login                   — sign in, returns { token }
 *   POST /api/auth/password-reset/request  — send OTP email for password reset
 *   POST /api/auth/password-reset/verify   — verify OTP + set new password, returns { token }
 *   GET  /api/auth/google/connect          — redirect to Google OAuth consent screen
 *   GET  /api/auth/google/callback         — handle Google OAuth callback, issue session token
 *
 * The session token is an HS256 JWT. The frontend stores it in
 * localStorage["voiceorch:session"] and sends it as Authorization: Bearer <token>.
 */
import { Router, type IRouter, type Request } from "express";
import { randomBytes } from "node:crypto";
import { promisify } from "node:util";
import { scrypt, timingSafeEqual } from "node:crypto";
import { db, linkLegacyIdentitiesAtLogin } from "@workspace/db";
import { usersTable, walletTransactionsTable, passwordResetOtpsTable, platformSettingsTable, partnersTable } from "@workspace/db/schema";
import { eq, and, isNull, gt, desc, sql } from "drizzle-orm";
import { createSessionToken } from "../lib/session.js";
import { hashPassword, verifyPassword } from "../lib/password.js";
import { logger } from "../lib/logger.js";
import { sendBrevoEmail } from "../services/brevo.js";
import { sendManagedClientEmail } from "../services/partner-mail.js";
import { applyPendingPartnerPromotion } from "../services/partner-promotion.js";
import {
  welcomeEmail,
  welcomeBackEmail,
  passwordResetOtpEmail,
  passwordChangedEmail,
} from "../services/email-templates.js";
import { registerTransientKey } from "../services/rate-limit-cleanup.js";
import { getLoginAuthUrl, exchangeLoginCode } from "../services/auth/google-login.js";
import { trackEvent } from "../services/track-event.js";
import { deriveRedirectUri, dashboardBase, isTrustedOrigin } from "../lib/oauth-redirect.js";
import { SIGNUP_CREDIT_PAISE, formatInr } from "../lib/money-inr.js";
import { resolvePartnerByHost } from "../services/partner-domains.js";
import { normalizeDomain } from "../services/partner-domains-normalize.js";

const OTP_RATE_LIMIT_MAX = parseInt(process.env.OTP_RATE_LIMIT_MAX ?? "3", 10);
const OTP_RATE_LIMIT_WINDOW_MS = parseInt(process.env.OTP_RATE_LIMIT_WINDOW_MS ?? String(15 * 60 * 1000), 10);
const OTP_RATE_LIMIT_PREFIX = "otp_rate_limit:";
const OTP_MAX_ATTEMPTS = parseInt(process.env.OTP_MAX_ATTEMPTS ?? "5", 10);

/** Max failed verification attempts before an OTP is permanently locked out. */
const OTP_MAX_VERIFY_ATTEMPTS = parseInt(process.env.OTP_MAX_VERIFY_ATTEMPTS ?? "5", 10);

registerTransientKey({ prefix: OTP_RATE_LIMIT_PREFIX, windowMs: OTP_RATE_LIMIT_WINDOW_MS });

const router: IRouter = Router();
const scryptAsync = promisify(scrypt);

const FREE_CREDIT_CENTS = SIGNUP_CREDIT_PAISE; // Rs.500 welcome credit

async function hashOtp(otp: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const buf = (await scryptAsync(otp, salt, 32)) as Buffer;
  return `${salt}:${buf.toString("hex")}`;
}

async function verifyOtp(otp: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const buf = (await scryptAsync(otp, salt, 32)) as Buffer;
  const expected = Buffer.from(hash, "hex");
  if (buf.length !== expected.length) return false;
  return timingSafeEqual(buf, expected);
}

function generateApiKey() {
  return `vok_${randomBytes(24).toString("hex")}`;
}
function generateOrgKey() {
  return `voo_${randomBytes(24).toString("hex")}`;
}

function generateOtp(): string {
  const bytes = randomBytes(4);
  const num = bytes.readUInt32BE(0) % 1_000_000;
  return num.toString().padStart(6, "0");
}

/** Resolve partner white-label host from request Host / forwarded headers / body. */
async function partnerFromAuthRequest(req: Request, bodyHost?: string) {
  const candidates = [
    typeof bodyHost === "string" ? bodyHost : "",
    (req.headers["x-forwarded-host"] as string | undefined)?.split(",")[0]?.trim() ?? "",
    req.hostname ?? "",
  ];
  for (const raw of candidates) {
    const host = normalizeDomain(raw);
    if (!host) continue;
    const brand = await resolvePartnerByHost(host);
    if (brand) return brand;
  }
  return null;
}

// ── Register ──────────────────────────────────────────────────────────────────

router.post("/auth/register", async (req, res): Promise<void> => {
  const { email, password, name, host: bodyHost } = req.body as {
    email?: string;
    password?: string;
    name?: string;
    host?: string;
  };

  // Partner white-label gateways are invite/provision only — no public self-signup.
  const partnerBrand = await partnerFromAuthRequest(req, bodyHost);
  if (partnerBrand) {
    res.status(403).json({
      error: `Accounts on this portal are created by ${partnerBrand.companyName}. Contact them for access.`,
    });
    return;
  }

  if (!email || !password) {
    res.status(400).json({ error: "Email and password are required." });
    return;
  }
  if (password.length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters." });
    return;
  }

  const normalizedEmail = email.trim().toLowerCase();
  const sub = `email:${normalizedEmail}`;

  try {
    const [existing] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.clerkId, sub));

    // A previously deleted account is a soft-delete (the row is never
    // removed — see `PATCH /admin/users/:clerkId/status`), so its email is
    // still "taken" as far as a raw uniqueness check goes. Product intent is
    // that a deleted account's email should be free to sign up again, so we
    // reactivate the existing row as a fresh account rather than blocking
    // it — the row is reused (id/history unchanged) but the account is
    // usable again exactly like a new signup. Suspended accounts are NOT
    // reactivated this way — that decision stays with support/admin.
    if (existing && existing.status !== "deleted") {
      res.status(409).json({ error: "An account with that email already exists." });
      return;
    }

    const passwordHash = await hashPassword(password);
    const displayName = (name ?? "").trim() || normalizedEmail.split("@")[0];

    let user: typeof usersTable.$inferSelect;
    let reactivated = false;
    if (existing) {
      reactivated = true;
      [user] = await db
        .update(usersTable)
        .set({
          name: displayName,
          passwordHash,
          status: "active",
          suspendedAt: null,
          suspendedReason: null,
        })
        .where(eq(usersTable.id, existing.id))
        .returning();
      logger.info({ sub, email: normalizedEmail }, "Previously deleted account reactivated via register");
      // Password signup can't prove email ownership — any pending partner
      // promotion stays pending for one-click admin approval.
      await applyPendingPartnerPromotion(user, { emailVerified: false });
    } else {
      [user] = await db
        .insert(usersTable)
        .values({
          clerkId: sub,
          email: normalizedEmail,
          name: displayName,
          passwordHash,
          walletBalanceCents: FREE_CREDIT_CENTS,
          freeCreditsGranted: true,
          apiKey: generateApiKey(),
          orgKey: generateOrgKey(),
        })
        .returning();

      await db.insert(walletTransactionsTable).values({
        userId: user.id,
        type: "free_credit",
        amountCents: FREE_CREDIT_CENTS,
        description: `Welcome credit — ${formatInr(FREE_CREDIT_CENTS)} free to get started`,
        status: "completed",
      });

      logger.info({ sub, email: normalizedEmail }, "User registered");

      // Admin may have pre-created a partner account for this email. A
      // password signup can't prove email ownership, so the promotion is NOT
      // auto-applied — it stays pending for one-click admin approval.
      await applyPendingPartnerPromotion(user, { emailVerified: false });
    }

    const token = createSessionToken({ sub, email: normalizedEmail, name: user.name });

    // Welcome / welcome-back email — fire-and-forget, never block the signup response
    if (reactivated) {
      sendBrevoEmail(
        normalizedEmail,
        "Welcome back to SnapServe!",
        welcomeBackEmail(user.name ?? normalizedEmail.split("@")[0]!),
        undefined,
        { emailType: "welcome_back", toUserId: sub, toName: user.name },
      ).catch(err => logger.warn({ err, email: normalizedEmail }, "Welcome-back email send failed"));
    } else {
      sendBrevoEmail(
        normalizedEmail,
        "Welcome to SnapServe! 🎉",
        welcomeEmail(user.name ?? normalizedEmail.split("@")[0]!, FREE_CREDIT_CENTS),
        undefined,
        { emailType: "welcome", toUserId: sub, toName: user.name },
      ).catch(err => logger.warn({ err, email: normalizedEmail }, "Welcome email send failed"));
    }

    res.json({ token });
  } catch (err) {
    logger.error({ err }, "Registration error");
    res.status(500).json({ error: "Registration failed. Please try again." });
  }
});

// ── Login ─────────────────────────────────────────────────────────────────────

router.post("/auth/login", async (req, res): Promise<void> => {
  const { email, password, host: bodyHost } = req.body as {
    email?: string;
    password?: string;
    host?: string;
  };

  if (!email || !password) {
    res.status(400).json({ error: "Email and password are required." });
    return;
  }

  const normalizedEmail = email.trim().toLowerCase();
  const sub = `email:${normalizedEmail}`;
  const partnerBrand = await partnerFromAuthRequest(req, bodyHost);

  try {
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.clerkId, sub));

    if (!user || !user.passwordHash) {
      res.status(401).json({ error: "Invalid email or password." });
      return;
    }

    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) {
      res.status(401).json({ error: "Invalid email or password." });
      return;
    }

    if (user.status !== "active") {
      logger.warn({ sub, status: user.status }, "Login blocked: account is not active");
      res.status(403).json({
        error:
          user.status === "deleted"
            ? "This account has been deleted."
            : "This account has been suspended. Please contact support.",
      });
      return;
    }

    // On a partner white-label host, only that partner's clients (and the
    // partner's own account) may sign in — keeps the gateway tenant-scoped.
    if (partnerBrand) {
      const [owner] = await db
        .select({ userId: partnersTable.userId })
        .from(partnersTable)
        .where(eq(partnersTable.id, partnerBrand.partnerId))
        .limit(1);
      const isOwner = owner?.userId === user.clerkId;
      const isClient = user.partnerId === partnerBrand.partnerId;
      if (!isOwner && !isClient) {
        res.status(403).json({
          error: `This account is not registered with ${partnerBrand.companyName}.`,
        });
        return;
      }
    }

    const token = createSessionToken({ sub, email: user.email, name: user.name });
    logger.info({ sub, email: normalizedEmail, partnerId: partnerBrand?.partnerId ?? null }, "User signed in");
    res.json({ token });
  } catch (err) {
    logger.error({ err }, "Login error");
    res.status(500).json({ error: "Sign in failed. Please try again." });
  }
});

// ── Password Reset: Request OTP ───────────────────────────────────────────────

router.post("/auth/password-reset/request", async (req, res): Promise<void> => {
  const { email } = req.body as { email?: string };

  if (!email) {
    res.status(400).json({ error: "Email is required." });
    return;
  }

  const normalizedEmail = email.trim().toLowerCase();
  const sub = `email:${normalizedEmail}`;

  try {
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.clerkId, sub));

    if (!user) {
      res.json({ ok: true });
      return;
    }

    if (!user.passwordHash) {
      res.json({ ok: true, hint: "google_only" });
      return;
    }

    // ── Rate-limit OTP requests per email ────────────────────────────────────
    const rlKey = `${OTP_RATE_LIMIT_PREFIX}${normalizedEmail}`;
    const now = Date.now();

    const [rlRow] = await db
      .select({ value: platformSettingsTable.value })
      .from(platformSettingsTable)
      .where(eq(platformSettingsTable.key, rlKey));

    const rawTimestamps: unknown = rlRow?.value ? JSON.parse(rlRow.value) : [];
    const recentTimestamps = (Array.isArray(rawTimestamps) ? (rawTimestamps as number[]) : []).filter(
      (t) => now - t < OTP_RATE_LIMIT_WINDOW_MS,
    );

    if (recentTimestamps.length >= OTP_RATE_LIMIT_MAX) {
      const retryAfterSec = Math.ceil((OTP_RATE_LIMIT_WINDOW_MS - (now - recentTimestamps[0]!)) / 1000);
      res.setHeader("Retry-After", String(retryAfterSec));
      logger.warn({ email: normalizedEmail }, "OTP rate limit exceeded");
      res.status(429).json({ error: "Too many attempts — please wait a few minutes before requesting another code." });
      return;
    }

    const updatedTimestamps = [...recentTimestamps, now];
    await db
      .insert(platformSettingsTable)
      .values({ key: rlKey, value: JSON.stringify(updatedTimestamps) })
      .onConflictDoUpdate({
        target: platformSettingsTable.key,
        set: { value: JSON.stringify(updatedTimestamps), updatedAt: new Date() },
      });
    // ─────────────────────────────────────────────────────────────────────────

    const otp = generateOtp();
    const otpHash = await hashOtp(otp);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await db
      .delete(passwordResetOtpsTable)
      .where(
        and(
          eq(passwordResetOtpsTable.userId, user.id),
          isNull(passwordResetOtpsTable.usedAt),
        ),
      );

    await db.insert(passwordResetOtpsTable).values({
      userId: user.id,
      otpHash,
      expiresAt,
    });

    try {
      await sendManagedClientEmail(
        user.clerkId,
        normalizedEmail,
        "Your password reset code",
        passwordResetOtpEmail(otp),
        { emailType: "password_reset", toUserId: user.clerkId ?? String(user.id), toName: user.name },
      );
    } catch (emailErr) {
      logger.warn({ emailErr, email: normalizedEmail }, "OTP email send failed");
    }

    logger.info({ email: normalizedEmail }, "Password reset OTP requested");
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Password reset request error");
    res.status(500).json({ error: "Failed to process request. Please try again." });
  }
});

// ── Password Reset: Check OTP (non-consuming) ─────────────────────────────────

router.post("/auth/password-reset/check-otp", async (req, res): Promise<void> => {
  const { email, otp } = req.body as { email?: string; otp?: string };

  if (!email || !otp) {
    res.status(400).json({ error: "Email and OTP are required." });
    return;
  }

  const normalizedEmail = email.trim().toLowerCase();
  const sub = `email:${normalizedEmail}`;

  try {
    const [user] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.clerkId, sub));

    if (!user) {
      res.status(400).json({ error: "Invalid or expired code. Please request a new one." });
      return;
    }

    const otpCandidate = otp.trim();
    const now = new Date();

    // SELECT FOR UPDATE serialises concurrent verify attempts for the same OTP
    // row at the DB level, eliminating the TOCTOU race between the attempt-count
    // check and the increment/lockout write.
    const result = await db.transaction(async (tx) => {
      const [otpRow] = await tx
        .select()
        .from(passwordResetOtpsTable)
        .where(
          and(
            eq(passwordResetOtpsTable.userId, user.id),
            isNull(passwordResetOtpsTable.usedAt),
            gt(passwordResetOtpsTable.expiresAt, now),
            gt(sql`${OTP_MAX_VERIFY_ATTEMPTS}`, passwordResetOtpsTable.attempts),
          ),
        )
        .orderBy(desc(passwordResetOtpsTable.createdAt))
        .limit(1)
        .for("update");

      if (!otpRow) return { status: "not_found" } as const;

      const valid = await verifyOtp(otpCandidate, otpRow.otpHash);
      if (!valid) {
        const [updated] = await tx
          .update(passwordResetOtpsTable)
          .set({ attempts: sql`${passwordResetOtpsTable.attempts} + 1` })
          .where(
            and(
              eq(passwordResetOtpsTable.id, otpRow.id),
              sql`${passwordResetOtpsTable.attempts} < ${OTP_MAX_VERIFY_ATTEMPTS}`,
            ),
          )
          .returning({ attempts: passwordResetOtpsTable.attempts });
        const exhausted = !updated || updated.attempts >= OTP_MAX_VERIFY_ATTEMPTS;
        return { status: "invalid", exhausted } as const;
      }

      return { status: "valid" } as const;
    });

    if (result.status === "not_found" || result.status === "invalid") {
      if (result.status === "invalid" && result.exhausted) {
        logger.warn({ userId: user.id }, "OTP locked out after too many failed attempts");
        res.status(400).json({ error: "Too many incorrect attempts. Please request a new code." });
        return;
      }
      res.status(400).json({ error: "Invalid or expired code. Please request a new one." });
      return;
    }

    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "OTP check error");
    res.status(500).json({ error: "Failed to verify code. Please try again." });
  }
});

// ── Password Reset: Verify OTP + Set New Password ─────────────────────────────

router.post("/auth/password-reset/verify", async (req, res): Promise<void> => {
  const { email, otp, newPassword } = req.body as {
    email?: string;
    otp?: string;
    newPassword?: string;
  };

  if (!email || !otp || !newPassword) {
    res.status(400).json({ error: "Email, OTP, and new password are required." });
    return;
  }
  if (newPassword.length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters." });
    return;
  }

  const normalizedEmail = email.trim().toLowerCase();
  const sub = `email:${normalizedEmail}`;

  try {
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.clerkId, sub));

    if (!user || !user.passwordHash) {
      res.status(400).json({ error: "Invalid or expired code. Please request a new one." });
      return;
    }

    // Hash the new password BEFORE entering the transaction so the expensive
    // scrypt call does not hold a row lock while it runs.
    const newHash = await hashPassword(newPassword);

    const otpCandidate = (otp as string).trim();
    const now = new Date();

    const result = await db.transaction(async (tx) => {
      const [otpRow] = await tx
        .select()
        .from(passwordResetOtpsTable)
        .where(
          and(
            eq(passwordResetOtpsTable.userId, user.id),
            isNull(passwordResetOtpsTable.usedAt),
            gt(passwordResetOtpsTable.expiresAt, now),
            gt(sql`${OTP_MAX_VERIFY_ATTEMPTS}`, passwordResetOtpsTable.attempts),
          ),
        )
        .orderBy(desc(passwordResetOtpsTable.createdAt))
        .limit(1)
        .for("update");

      if (!otpRow) return { status: "not_found" } as const;

      const valid = await verifyOtp(otpCandidate, otpRow.otpHash);
      if (!valid) {
        const [updated] = await tx
          .update(passwordResetOtpsTable)
          .set({ attempts: sql`${passwordResetOtpsTable.attempts} + 1` })
          .where(
            and(
              eq(passwordResetOtpsTable.id, otpRow.id),
              sql`${passwordResetOtpsTable.attempts} < ${OTP_MAX_VERIFY_ATTEMPTS}`,
            ),
          )
          .returning({ attempts: passwordResetOtpsTable.attempts });
        const exhausted = !updated || updated.attempts >= OTP_MAX_VERIFY_ATTEMPTS;
        return { status: "invalid", exhausted } as const;
      }

      await tx
        .update(passwordResetOtpsTable)
        .set({ usedAt: now })
        .where(eq(passwordResetOtpsTable.id, otpRow.id));

      await tx
        .update(usersTable)
        .set({ passwordHash: newHash })
        .where(eq(usersTable.id, user.id));

      return { status: "valid" } as const;
    });

    if (result.status === "not_found" || result.status === "invalid") {
      if (result.status === "invalid" && result.exhausted) {
        logger.warn({ userId: user.id }, "OTP locked out after too many failed attempts on verify");
        res.status(400).json({ error: "Too many incorrect attempts. Please request a new code." });
        return;
      }
      res.status(400).json({ error: "Invalid or expired code. Please request a new one." });
      return;
    }

    const token = createSessionToken({ sub, email: user.email, name: user.name });
    logger.info({ email: normalizedEmail }, "Password reset successful");

    // Password-changed confirmation — fire-and-forget
    sendManagedClientEmail(
      user.clerkId,
      normalizedEmail,
      "Your password was changed",
      passwordChangedEmail(user.name ?? normalizedEmail.split("@")[0]!),
      { emailType: "password_changed", toUserId: user.clerkId ?? String(user.id), toName: user.name },
    ).catch(err => logger.warn({ err, email: normalizedEmail }, "Password-changed email send failed"));

    res.json({ token });
  } catch (err) {
    logger.error({ err }, "Password reset verify error");
    res.status(500).json({ error: "Failed to reset password. Please try again." });
  }
});

// ── Google Sign-In ────────────────────────────────────────────────────────────

const LOGIN_CALLBACK_PATH = "/api/auth/google/callback";

router.get("/auth/google/connect", async (req, res): Promise<void> => {
  // Partner white-label portals are email/password only.
  const partnerBrand = await partnerFromAuthRequest(req);
  if (partnerBrand) {
    res.status(403).json({
      error: `Google sign-in is not available on ${partnerBrand.companyName}'s portal. Use email and password.`,
    });
    return;
  }

  if (!process.env["GOOGLE_CLIENT_ID"] || !process.env["GOOGLE_CLIENT_SECRET"]) {
    res.status(503).json({ error: "Google Sign-In is not configured on this platform." });
    return;
  }

  // Opaque random state — bound to this browser via an HttpOnly cookie.
  // The cookie is the binding mechanism; the state in the URL is only used
  // to match it on the callback. No signature needed because without a
  // matching server-issued cookie Google cannot be made to call our callback
  // with an attacker-controlled state.
  const state = randomBytes(24).toString("hex");
  const redirectUri = deriveRedirectUri(req, LOGIN_CALLBACK_PATH);

  res.cookie("google_login_state", state, {
    httpOnly: true,
    secure: process.env["NODE_ENV"] !== "development",
    sameSite: "lax",
    maxAge: 10 * 60 * 1000, // 10 minutes
  });

  // Partner white-label: after OAuth (which always callbacks on the primary
  // app host), send the user back to the brand domain they started on.
  const returnToRaw = typeof req.query["return_to"] === "string" ? req.query["return_to"].trim() : "";
  if (returnToRaw) {
    try {
      const u = new URL(returnToRaw);
      const origin = u.origin;
      if (isTrustedOrigin(origin)) {
        res.cookie("google_login_return", origin, {
          httpOnly: true,
          secure: process.env["NODE_ENV"] !== "development",
          sameSite: "lax",
          maxAge: 10 * 60 * 1000,
        });
      }
    } catch { /* ignore bad return_to */ }
  }

  const url = getLoginAuthUrl(state, redirectUri);
  logger.info({ redirectUri }, "Google Sign-In: redirecting to consent screen");
  res.redirect(url);
});

router.get("/auth/google/callback", async (req, res): Promise<void> => {
  const { code, error, state } = req.query as { code?: string; error?: string; state?: string };
  const returnCookie = (req as any).cookies?.["google_login_return"] as string | undefined;
  const returnBase =
    returnCookie && isTrustedOrigin(returnCookie) ? returnCookie.replace(/\/$/, "") : null;
  const base = returnBase ?? dashboardBase(req);
  const errorRedirect = `${base}/?google_error=true`;

  if (error || !code || !state) {
    logger.warn({ error }, "Google Sign-In callback: missing params or user denied access");
    res.clearCookie("google_login_return");
    res.redirect(errorRedirect);
    return;
  }

  // Strict cookie-bound CSRF check. cookie-parser is installed and wired in
  // app.ts, so req.cookies is always available here.
  const cookieState = (req as any).cookies?.["google_login_state"] as string | undefined;
  if (!cookieState || cookieState !== state) {
    logger.warn({ hasCookie: !!cookieState }, "Google Sign-In callback: CSRF state mismatch or missing cookie");
    res.clearCookie("google_login_return");
    res.redirect(errorRedirect);
    return;
  }

  // Clear the one-time state cookie immediately
  res.clearCookie("google_login_state");
  res.clearCookie("google_login_return");

  try {
    const redirectUri = deriveRedirectUri(req, LOGIN_CALLBACK_PATH);
    const profile = await exchangeLoginCode(code, redirectUri);

    if (!profile.sub) {
      logger.warn("Google Sign-In callback: no sub in profile");
      res.redirect(errorRedirect);
      return;
    }

    // Canonical identity = the bare Google sub (no `google:` prefix). This is
    // exactly what `attachSession` puts on `req.clerkUserId` and what every
    // ownership-scoped query compares against, so the survivor row must be keyed
    // this way. A prefixed form would be a third id format the app never matches.
    const googleSub = profile.sub;
    const normalizedEmail = profile.email?.trim().toLowerCase() ?? null;

    // Link any still-orphaned legacy data onto this Google identity. The
    // Clerk→Google migration left pre-migration data owned by a legacy
    // `user_…` row; merge it (and any duplicate rows) onto the canonical Google
    // sub. Matching is by verified email (Google emails are verified, so this is
    // safe). Shares the exact relink + wallet-merge logic the one-off
    // `merge-user-identities` script uses, so they can never drift apart.
    // Safe to run on every login: a no-op once consolidated.
    if (normalizedEmail) {
      try {
        const linked = await linkLegacyIdentitiesAtLogin(db, {
          email: normalizedEmail,
          canonicalClerkId: googleSub,
          name: profile.name,
        });
        if (linked.merged > 0) {
          logger.info(
            { email: normalizedEmail, merged: linked.merged, createdSurvivor: linked.createdSurvivor },
            "Google Sign-In: linked legacy identities onto Google sub",
          );
        }
      } catch (linkErr) {
        logger.error({ linkErr, email: normalizedEmail }, "Google Sign-In: legacy identity link failed (continuing)");
      }
    }

    // Look up by canonical google sub.
    let [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.clerkId, googleSub));

    if (!user && normalizedEmail) {
      // Legacy/duplicate rows were merged above, so any remaining same-email row
      // is a separate email+password account (kept as a parallel login method).
      const [emailUser] = await db
        .select()
        .from(usersTable)
        .where(eq(usersTable.email, normalizedEmail));

      if (emailUser && !emailUser.passwordHash) {
        // Social-only account on a non-canonical id — adopt the canonical sub.
        await db
          .update(usersTable)
          .set({ clerkId: googleSub })
          .where(eq(usersTable.id, emailUser.id));
        user = { ...emailUser, clerkId: googleSub };
        logger.info({ id: emailUser.id, email: normalizedEmail }, "Google Sign-In: adopted canonical sub for social account");
      } else if (emailUser) {
        // Email+password account — create a separate google row (both login methods allowed).
        logger.info({ email: normalizedEmail }, "Google Sign-In: email+password account found; creating parallel google entry");
      }
    }

    let isNewUser = false;
    if (!user) {
      isNewUser = true;
      // New user — provision with welcome credit
      const displayName = profile.name?.trim() || normalizedEmail?.split("@")[0] || "User";
      const [created] = await db
        .insert(usersTable)
        .values({
          clerkId: googleSub,
          email: normalizedEmail,
          name: displayName,
          walletBalanceCents: FREE_CREDIT_CENTS,
          freeCreditsGranted: true,
          apiKey: generateApiKey(),
          orgKey: generateOrgKey(),
        })
        .returning();
      user = created;

      await db.insert(walletTransactionsTable).values({
        userId: user.id,
        type: "free_credit",
        amountCents: FREE_CREDIT_CENTS,
        description: `Welcome credit — ${formatInr(FREE_CREDIT_CENTS)} free to get started`,
        status: "completed",
      });

      logger.info({ sub: googleSub, email: normalizedEmail }, "Google Sign-In: new user registered");
      void trackEvent(googleSub, "signup", { email: normalizedEmail });

      // Admin may have pre-created a partner account for this email — apply
      // it. Google authenticated this email, so ownership is proven.
      await applyPendingPartnerPromotion(user, { emailVerified: true });

      // Welcome email — fire-and-forget
      if (normalizedEmail) {
        sendBrevoEmail(
          normalizedEmail,
          "Welcome to SnapServe! 🎉",
          welcomeEmail(user.name ?? normalizedEmail.split("@")[0]!, FREE_CREDIT_CENTS),
          undefined,
          { emailType: "welcome", toUserId: googleSub, toName: user.name },
        ).catch(err => logger.warn({ err, email: normalizedEmail }, "Google signup welcome email failed"));
      }
    } else if (user.status === "deleted") {
      // Soft-deleted account — the row is never removed, so the same
      // uniqueness lookup above always finds it. Product intent is that a
      // deleted account's email should be free to sign up again, so treat
      // this as a fresh signup: reactivate the row instead of blocking it.
      // Suspended accounts are intentionally NOT reactivated this way.
      const [reactivatedRow] = await db
        .update(usersTable)
        .set({
          status: "active",
          suspendedAt: null,
          suspendedReason: null,
          name: user.name ?? profile.name?.trim() ?? normalizedEmail?.split("@")[0] ?? "User",
        })
        .where(eq(usersTable.id, user.id))
        .returning();
      user = reactivatedRow;
      logger.info({ sub: googleSub, email: normalizedEmail }, "Google Sign-In: previously deleted account reactivated");

      // Welcome-back email — fire-and-forget, distinct from the first-time welcome email
      if (normalizedEmail) {
        sendBrevoEmail(
          normalizedEmail,
          "Welcome back to SnapServe!",
          welcomeBackEmail(user.name ?? normalizedEmail.split("@")[0]!),
          undefined,
          { emailType: "welcome_back", toUserId: googleSub, toName: user.name },
        ).catch(err => logger.warn({ err, email: normalizedEmail }, "Google reactivation welcome-back email failed"));
      }
    } else if (user.status !== "active") {
      logger.warn({ sub: googleSub, status: user.status }, "Google Sign-In blocked: account is not active");
      res.redirect(`${base}/?google_error=true&reason=account_suspended`);
      return;
    } else {
      logger.info({ sub: googleSub, email: normalizedEmail }, "Google Sign-In: existing user signed in");
      void trackEvent(googleSub, "login");
    }

    const token = createSessionToken({
      sub: googleSub,
      email: user.email ?? normalizedEmail,
      name: user.name ?? profile.name,
    });

    // Deliver the token via URL fragment — same pattern as email/password login.
    // `new_user=1` tells the frontend this redirect is the result of a brand-new
    // account being created (not an existing user logging back in), so it can
    // fire the CompleteRegistration pixel event exactly once, only for signups.
    const newUserFlag = isNewUser ? "&new_user=1" : "";
    res.redirect(`${base}/#session=${encodeURIComponent(token)}${newUserFlag}`);
  } catch (err) {
    logger.error({ err }, "Google Sign-In callback: unexpected error");
    res.redirect(errorRedirect);
  }
});

export default router;
