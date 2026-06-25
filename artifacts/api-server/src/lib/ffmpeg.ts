/**
 * Resolve the ffmpeg binary path for audio transcoding.
 *
 * Why this exists: ffmpeg is present in the Replit dev container (Nix) but NOT
 * in the production runtime images (node:slim Docker / Nixpacks / Railpack all
 * ship without it). That made every uploaded-ambient transcode silently fail in
 * production — `spawn("ffmpeg")` → ENOENT → caught → ambient disabled for the
 * call — while working fine in dev. The `ffmpeg-static` npm package ships a
 * prebuilt static binary that installs via `pnpm install` regardless of which
 * builder Railway uses, so it is the builder-invariant fix.
 *
 * Resolution order:
 *   1. `ffmpeg-static`'s bundled binary, if the file actually exists.
 *   2. `ffmpeg` on PATH (covers the Nix dev container and any image that has it
 *      installed at the OS level, e.g. the Dockerfile apt fallback).
 *
 * The chosen path is resolved once and logged at startup so a future "ffmpeg
 * missing" regression is visible in production logs.
 */

import { existsSync } from "fs";
import { createRequire } from "module";
import { logger } from "./logger.js";

const require = createRequire(import.meta.url);

let cachedPath: string | null = null;

export function resolveFfmpegPath(): string {
  if (cachedPath) return cachedPath;

  let staticPath: string | null = null;
  try {
    // ffmpeg-static's default export is the absolute path to its bundled binary.
    const mod = require("ffmpeg-static") as string | { default?: string } | null;
    staticPath = typeof mod === "string" ? mod : (mod?.default ?? null);
  } catch {
    staticPath = null;
  }

  if (staticPath && existsSync(staticPath)) {
    cachedPath = staticPath;
    logger.info({ ffmpegPath: cachedPath, source: "ffmpeg-static" }, "ffmpeg binary resolved");
    return cachedPath;
  }

  // Fall back to PATH (dev Nix container / OS-installed ffmpeg).
  cachedPath = "ffmpeg";
  logger.warn(
    { ffmpegPath: cachedPath, source: "PATH", staticPath },
    "ffmpeg-static binary not found — falling back to ffmpeg on PATH (uploaded ambient transcode will fail if PATH ffmpeg is also missing)",
  );
  return cachedPath;
}
