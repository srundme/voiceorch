/**
 * Email + password authentication routes.
 *
 *   POST /api/auth/register  — create account, returns { token }
 *   POST /api/auth/login     — sign in, returns { token }
 *
 * The session token is an HS256 JWT. The frontend stores it in
 * localStorage["voiceorch:session"] and sends it as Authorization: Bearer <token>.
 */
import { Router, type IRouter } from "express";
import { scrypt, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { db } from "@workspace/db";
import { usersTable, walletTransactionsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { createSessionToken } from "../lib/session.js";
import { logger } from "../lib/logger.js";

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

function generateApiKey() {
  return `vok_${randomBytes(24).toString("hex")}`;
}
function generateOrgKey() {
  return `voo_${randomBytes(24).toString("hex")}`;
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

export default router;
