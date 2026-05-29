import { createHash, randomInt } from "crypto";
import { getRedis } from "../lib/redis.js";
import { logger } from "../lib/logger.js";

const OTP_TTL_SECONDS = 600;     // 10 minutes
const MAX_ATTEMPTS    = 5;

function otpKey(userId: string, phone: string): string {
  const normPhone = phone.replace(/\s+/g, "").toLowerCase();
  return `otp_dest:${userId}:${normPhone}`;
}

function hashOtp(otp: string): string {
  return createHash("sha256").update(otp).digest("hex");
}

export interface OtpStorePayload {
  hash:     string;
  attempts: number;
}

/**
 * Generates a 6-digit OTP, stores it in Redis with a 10-minute TTL,
 * and returns the plaintext OTP to be sent to the user.
 */
export async function generateAndStoreOtp(userId: string, phone: string): Promise<string> {
  const redis = getRedis();
  if (!redis) throw new Error("Redis is not configured — cannot store OTP.");

  const otp     = String(randomInt(100000, 999999));
  const payload: OtpStorePayload = { hash: hashOtp(otp), attempts: 0 };
  const key     = otpKey(userId, phone);

  await redis.set(key, JSON.stringify(payload), { ex: OTP_TTL_SECONDS });
  logger.info({ userId, phone }, "OTP stored in Redis");
  return otp;
}

/**
 * Verifies a user-supplied OTP against the stored hash.
 * Returns true on match, false on mismatch or expiry.
 * Increments attempt counter and deletes key after MAX_ATTEMPTS.
 */
export async function verifyDestinationOtp(userId: string, phone: string, otp: string): Promise<boolean> {
  const redis = getRedis();
  if (!redis) throw new Error("Redis is not configured.");

  const key = otpKey(userId, phone);
  const raw = await redis.get<string>(key);
  if (!raw) return false;

  let payload: OtpStorePayload;
  try {
    payload = typeof raw === "string" ? JSON.parse(raw) as OtpStorePayload : (raw as OtpStorePayload);
  } catch {
    return false;
  }

  payload.attempts += 1;

  if (payload.attempts >= MAX_ATTEMPTS) {
    await redis.del(key);
    logger.warn({ userId, phone }, "OTP max attempts exceeded — deleted");
    return false;
  }

  if (hashOtp(otp.trim()) !== payload.hash) {
    await redis.set(key, JSON.stringify(payload), { ex: OTP_TTL_SECONDS });
    return false;
  }

  await redis.del(key);
  return true;
}
