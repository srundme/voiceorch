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
import { Router, type IRouter } from "express";
import { scrypt, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { db, linkLegacyIdentitiesAtLogin } from "@workspace/db";
import { usersTable, walletTransactionsTable, passwordResetOtpsTable, platformSettingsTable } from "@workspace/db/schema";
import { eq, and, isNull, gt, desc, sql } from "drizzle-orm";
import { createSessionToken } from "../lib/session.js";
import { logger } from "../lib/logger.js";
import { sendBrevoEmail } from "../services/brevo.js";
import {
  welcomeEmail,
  passwordResetOtpEmail,
  passwordChangedEmail,
} from "../services/email-templates.js";
import { registerTransientKey } from "../services/rate-limit-cleanup.js";
import { getLoginAuthUrl, exchangeLoginCode } from "../services/auth/google-login.js";
import { deriveRedirectUri, dashboardBase } from "../lib/oauth-redirect.js";

const OTP_RATE_LIMIT_MAX = parseInt(process.env.OTP_RATE_LIMIT_MAX ?? "3", 10);
const OTP_RATE_LIMIT_WINDOW_MS = parseInt(process.env.OTP_RATE_LIMIT_WINDOW_MS ?? String(15 * 60 * 1000), 10);
const OTP_RATE_LIMIT_PREFIX = "otp_rate_limit:";
const OTP_MAX_ATTEMPTS = parseInt(process.env.OTP_MAX_ATTEMPTS ?? "5", 10);

/** Max failed verification attempts before an OTP is permanently locked out. */
const OTP_MAX_VERIFY_ATTEMPTS = parseInt(process.env.OTP_MAX_VERIFY_ATTEMPTS ?? "5", 10);

registerTransientKey({ prefix: OTP_RATE_LIMIT_PREFIX, windowMs: OTP_RATE_LIMIT_WINDOW_MS });

const router: IRouter = Router();
const scryptAsync = promisify(scrypt);

const FREE_CREDIT_CENTS = 10_000; // $100 welcome credit

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${salt}:${buf.toString("hex")}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  const expected = Buffer.from(hash, "hex");
  if (buf.length !== expected.length) return false;
  return timingSafeEqual(buf, expected);
}

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

// ── Register ──────────────────────────────────────────────────────────────────

router.post("/auth/register", async (req, res): Promise<void> => {
  const { email, password, name } = req.body as {
    email?: string;
    password?: string;
    name?: string;
  };

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
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.clerkId, sub));

    if (existing) {
      res.status(409).json({ error: "An account with that email already exists." });
      return;
    }

    const passwordHash = await hashPassword(password);

    const [user] = await db
      .insert(usersTable)
      .values({
        clerkId: sub,
        email: normalizedEmail,
        name: (name ?? "").trim() || normalizedEmail.split("@")[0],
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
      description: "Welcome credit — $5.00 free to get started",
      status: "completed",
    });

    const token = createSessionToken({ sub, email: normalizedEmail, name: user.name });
    logger.info({ sub, email: normalizedEmail }, "User registered");

    // Welcome email — fire-and-forget, never block the signup response
    sendBrevoEmail(
      normalizedEmail,
      "Welcome to SnapServe! 🎉",
      welcomeEmail(user.name ?? normalizedEmail.split("@")[0]!, FREE_CREDIT_CENTS),
    ).catch(err => logger.warn({ err, email: normalizedEmail }, "Welcome email send failed"));

    res.json({ token });
  } catch (err) {
    logger.error({ err }, "Registration error");
    res.status(500).json({ error: "Registration failed. Please try again." });
  }
});

// ── Login ─────────────────────────────────────────────────────────────────────

router.post("/auth/login", async (req, res): Promise<void> => {
  const { email, password } = req.body as { email?: string; password?: string };

  if (!email || !password) {
    res.status(400).json({ error: "Email and password are required." });
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
      res.status(401).json({ error: "Invalid email or password." });
      return;
    }

    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) {
      res.status(401).json({ error: "Invalid email or password." });
      return;
    }

    const token = createSessionToken({ sub, email: user.email, name: user.name });
    logger.info({ sub, email: normalizedEmail }, "User signed in");
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
      await sendBrevoEmail(
        normalizedEmail,
        "Your SnapServe password reset code",
        passwordResetOtpEmail(otp),
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
    sendBrevoEmail(
      normalizedEmail,
      "Your SnapServe password was changed",
      passwordChangedEmail(user.name ?? normalizedEmail.split("@")[0]!),
    ).catch(err => logger.warn({ err, email: normalizedEmail }, "Password-changed email send failed"));

    res.json({ token });
  } catch (err) {
    logger.error({ err }, "Password reset verify error");
    res.status(500).json({ error: "Failed to reset password. Please try again." });
  }
});

// ── Google Sign-In ────────────────────────────────────────────────────────────

const LOGIN_CALLBACK_PATH = "/api/auth/google/callback";

router.get("/auth/google/connect", (req, res): void => {
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

  const url = getLoginAuthUrl(state, redirectUri);
  logger.info({ redirectUri }, "Google Sign-In: redirecting to consent screen");
  res.redirect(url);
});

router.get("/auth/google/callback", async (req, res): Promise<void> => {
  const { code, error, state } = req.query as { code?: string; error?: string; state?: string };
  const base = dashboardBase(req);
  const errorRedirect = `${base}/?google_error=true`;

  if (error || !code || !state) {
    logger.warn({ error }, "Google Sign-In callback: missing params or user denied access");
    res.redirect(errorRedirect);
    return;
  }

  // Strict cookie-bound CSRF check. cookie-parser is installed and wired in
  // app.ts, so req.cookies is always available here.
  const cookieState = (req as any).cookies?.["google_login_state"] as string | undefined;
  if (!cookieState || cookieState !== state) {
    logger.warn({ hasCookie: !!cookieState }, "Google Sign-In callback: CSRF state mismatch or missing cookie");
    res.redirect(errorRedirect);
    return;
  }

  // Clear the one-time state cookie immediately
  res.clearCookie("google_login_state");

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

    if (!user) {
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
        description: "Welcome credit — $5.00 free to get started",
        status: "completed",
      });

      logger.info({ sub: googleSub, email: normalizedEmail }, "Google Sign-In: new user registered");

      // Welcome email — fire-and-forget
      if (normalizedEmail) {
        sendBrevoEmail(
          normalizedEmail,
          "Welcome to SnapServe! 🎉",
          welcomeEmail(user.name ?? normalizedEmail.split("@")[0]!, FREE_CREDIT_CENTS),
        ).catch(err => logger.warn({ err, email: normalizedEmail }, "Google signup welcome email failed"));
      }
    } else {
      logger.info({ sub: googleSub, email: normalizedEmail }, "Google Sign-In: existing user signed in");
    }

    const token = createSessionToken({
      sub: googleSub,
      email: user.email ?? normalizedEmail,
      name: user.name ?? profile.name,
    });

    // Deliver the token via URL fragment — same pattern as email/password login
    res.redirect(`${base}/#session=${encodeURIComponent(token)}`);
  } catch (err) {
    logger.error({ err }, "Google Sign-In callback: unexpected error");
    res.redirect(errorRedirect);
  }
});

export default router;
