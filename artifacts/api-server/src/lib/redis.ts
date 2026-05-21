import { Redis } from "@upstash/redis";
import { logger } from "./logger.js";

let _redis: Redis | null = null;

/**
 * Returns the singleton Upstash Redis client.
 * Returns null (with a warning) when UPSTASH_REDIS_REST_URL / TOKEN are absent
 * so the rest of the server stays functional without Redis in local dev.
 */
export function getRedis(): Redis | null {
  if (_redis) return _redis;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    logger.warn("UPSTASH_REDIS_REST_URL / TOKEN not set — Redis session backing disabled");
    return null;
  }

  if (!url.startsWith("https://")) {
    logger.warn(
      { urlPrefix: url.slice(0, 12) },
      "UPSTASH_REDIS_REST_URL does not start with https:// — check that URL and TOKEN env vars are not swapped. Redis session backing disabled."
    );
    return null;
  }

  try {
    _redis = new Redis({ url, token });
    logger.info({ url }, "Upstash Redis client initialised");
  } catch (err) {
    logger.warn({ err }, "Upstash Redis client failed to initialise — Redis session backing disabled");
    return null;
  }
  return _redis;
}
