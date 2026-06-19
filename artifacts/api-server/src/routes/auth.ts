/**
 * Email + password authentication routes.
 *
 *   POST /api/auth/register                — create account, returns { token }
 *   POST /api/auth/login                   — sign in, returns { token }
 *   POST /api/auth/password-reset/request  — send OTP email for password reset
 *   POST /api/auth/password-reset/verify   — verify OTP + set new password, returns { token }
 *
 * The session token is an HS256 JWT. The frontend stores it in
 * localStorage["voiceorch:session"] and sends it as Authorization: Bearer <token>.
 */
import { Router, type IRouter } from "express";
import { scrypt, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { db } from "@workspace/db";
import { usersTable, walletTransactionsTable, passwordResetOtpsTable } from "@workspace/db/schema";
import { eq, and, isNull, gt, desc } from "drizzle-orm";
import { createSessionToken } from "../lib/session.js";
import { logger } from "../lib/logger.js";
import { sendBrevoEmail } from "../services/brevo.js";

const router: IRouter = Router();
const scryptAsync = promisify(scrypt);

const FREE_CREDIT_CENTS = 500;

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

    const htmlBody = `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px">
        <h2 style="margin:0 0 16px;font-size:1.25rem;color:#111">Reset your password</h2>
        <p style="margin:0 0 24px;color:#444;line-height:1.6">
          Use the code below to reset your SnapServe password. It expires in <strong>10 minutes</strong>.
        </p>
        <div style="background:#f4f4f5;border-radius:10px;padding:20px 24px;text-align:center;margin-bottom:24px">
          <span style="font-size:2rem;font-weight:700;letter-spacing:0.25em;color:#111">${otp}</span>
        </div>
        <p style="margin:0;font-size:0.85rem;color:#888">
          If you didn't request this, you can safely ignore this email.
        </p>
      </div>
    `;

    try {
      await sendBrevoEmail(normalizedEmail, "Your SnapServe password reset code", htmlBody);
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

    const now = new Date();
    const [otpRow] = await db
      .select()
      .from(passwordResetOtpsTable)
      .where(
        and(
          eq(passwordResetOtpsTable.userId, user.id),
          isNull(passwordResetOtpsTable.usedAt),
          gt(passwordResetOtpsTable.expiresAt, now),
        ),
      )
      .orderBy(desc(passwordResetOtpsTable.createdAt))
      .limit(1);

    if (!otpRow) {
      res.status(400).json({ error: "Invalid or expired code. Please request a new one." });
      return;
    }

    const valid = await verifyOtp(otp.trim(), otpRow.otpHash);
    if (!valid) {
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

    const now = new Date();
    const [otpRow] = await db
      .select()
      .from(passwordResetOtpsTable)
      .where(
        and(
          eq(passwordResetOtpsTable.userId, user.id),
          isNull(passwordResetOtpsTable.usedAt),
          gt(passwordResetOtpsTable.expiresAt, now),
        ),
      )
      .orderBy(desc(passwordResetOtpsTable.createdAt))
      .limit(1);

    if (!otpRow) {
      res.status(400).json({ error: "Invalid or expired code. Please request a new one." });
      return;
    }

    const valid = await verifyOtp((otp as string).trim(), otpRow.otpHash);
    if (!valid) {
      res.status(400).json({ error: "Invalid or expired code. Please request a new one." });
      return;
    }

    const newHash = await hashPassword(newPassword);

    await db
      .update(passwordResetOtpsTable)
      .set({ usedAt: now })
      .where(eq(passwordResetOtpsTable.id, otpRow.id));

    await db
      .update(usersTable)
      .set({ passwordHash: newHash })
      .where(eq(usersTable.id, user.id));

    const token = createSessionToken({ sub, email: user.email, name: user.name });
    logger.info({ email: normalizedEmail }, "Password reset successful");
    res.json({ token });
  } catch (err) {
    logger.error({ err }, "Password reset verify error");
    res.status(500).json({ error: "Failed to reset password. Please try again." });
  }
});

export default router;
