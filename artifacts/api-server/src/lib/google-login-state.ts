import { logger } from "./logger.js";
import { getRedis } from "./redis.js";

const TTL_MS = 10 * 60 * 1000;
const mem = new Map<string, number>();

function redisKey(state: string): string {
  const host = (process.env["APP_DOMAIN"] ?? "dev").replace(/[^a-z0-9.-]/gi, "");
  return `glogin:${host}:${state}`;
}

export async function saveGoogleLoginState(state: string): Promise<void> {
  mem.set(state, Date.now() + TTL_MS);
  try {
    await getRedis()?.set(redisKey(state), "1", { ex: Math.floor(TTL_MS / 1000) });
  } catch (err) {
    logger.warn({ err }, "google login state redis set failed");
  }
}

/** Returns true once if this state was issued recently. */
export async function takeGoogleLoginState(state: string): Promise<boolean> {
  const exp = mem.get(state);
  mem.delete(state);
  if (exp && exp > Date.now()) {
    try {
      await getRedis()?.del(redisKey(state));
    } catch {
      /* ignore */
    }
    return true;
  }
  const redis = getRedis();
  if (!redis) return false;
  try {
    const v = await redis.get(redisKey(state));
    if (!v) return false;
    await redis.del(redisKey(state));
    return true;
  } catch (err) {
    logger.warn({ err }, "google login state redis get failed");
    return false;
  }
}
