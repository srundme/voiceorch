import { Router } from "express";
import multer from "multer";
import { randomUUID } from "crypto";
import { execFile, spawn } from "child_process";
import { promisify } from "util";
import { Storage } from "@google-cloud/storage";
import { db, ambientSoundsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAdmin.js";
import { requireAuth } from "../middlewares/requireAuth.js";
import { logger } from "../lib/logger.js";
import { invalidatePcmCache } from "../orchestration/ambient.js";

const execFileAsync = promisify(execFile);

const SIDECAR = "http://127.0.0.1:1106";

/* eslint-disable @typescript-eslint/no-explicit-any */
function makeGcsClient(): Storage {
  return new Storage({
    credentials: {
      audience: "replit",
      subject_token_type: "access_token",
      token_url: `${SIDECAR}/token`,
      type: "external_account",
      credential_source: {
        url: `${SIDECAR}/credential`,
        format: { type: "json", subject_token_field_name: "access_token" },
      },
      universe_domain: "googleapis.com",
    } as any,
    projectId: "",
  });
}

function getBucket() {
  const bucketId = process.env["DEFAULT_OBJECT_STORAGE_BUCKET_ID"];
  if (!bucketId) throw new Error("DEFAULT_OBJECT_STORAGE_BUCKET_ID not set");
  return makeGcsClient().bucket(bucketId);
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
});

const ALLOWED_MIME = new Set(["audio/mpeg", "audio/mp3", "audio/wav", "audio/wave", "audio/ogg", "audio/x-m4a", "audio/mp4", "audio/aac"]);
const EXT_MAP: Record<string, string> = {
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/wave": "wav",
  "audio/ogg": "ogg",
  "audio/x-m4a": "m4a",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
};

async function getDurationSeconds(buffer: Buffer): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      "-i", "pipe:0",
    ], { input: buffer, encoding: "utf8" } as Parameters<typeof execFileAsync>[2]);
    const d = parseFloat((stdout as string).trim());
    return isNaN(d) ? null : d;
  } catch {
    return null;
  }
}

async function transcode(inputBuffer: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", [
      "-i", "pipe:0",
      "-f", "s16le",
      "-ar", "8000",
      "-ac", "1",
      "pipe:1",
    ], { stdio: ["pipe", "pipe", "pipe"] });

    const chunks: Buffer[] = [];
    let settled = false;
    proc.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    proc.on("error", (err) => { if (!settled) { settled = true; reject(err); } });
    proc.on("close", (code: number | null) => {
      if (settled) return;
      settled = true;
      if (code === 0) {
        resolve(Buffer.concat(chunks));
      } else {
        reject(new Error(`ffmpeg exited with code ${code ?? "null"}`));
      }
    });
    proc.stdin.on("error", () => {});
    try {
      if (proc.stdin.writable) {
        proc.stdin.write(inputBuffer);
        proc.stdin.end();
      }
    } catch {
    }
  });
}

const router = Router();
const userRouter = Router();

// ── Admin routes (require admin token) ───────────────────────────────────────
// Note: requireAdmin is applied per-route so the audio endpoint can use its own
// query-token fallback (browsers cannot set custom headers on <audio> src URLs).

router.get("/admin/ambient-sounds", requireAdmin, async (req, res): Promise<void> => {
  try {
    const sounds = await db
      .select({
        id: ambientSoundsTable.id,
        name: ambientSoundsTable.name,
        mimeType: ambientSoundsTable.mimeType,
        fileSize: ambientSoundsTable.fileSize,
        durationSeconds: ambientSoundsTable.durationSeconds,
        createdAt: ambientSoundsTable.createdAt,
      })
      .from(ambientSoundsTable)
      .orderBy(desc(ambientSoundsTable.createdAt));
    res.json(sounds);
  } catch (err) {
    req.log.error({ err }, "ambient-sounds: list failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/admin/ambient-sounds", requireAdmin, upload.single("file"), async (req, res): Promise<void> => {
  try {
    const file = req.file;
    const name = (req.body as Record<string, string>)["name"]?.trim();

    if (!file) { res.status(400).json({ error: "Missing file" }); return; }
    if (!name) { res.status(400).json({ error: "Missing name" }); return; }

    const mimeType = file.mimetype;
    if (!ALLOWED_MIME.has(mimeType)) {
      res.status(400).json({ error: `Unsupported audio type: ${mimeType}. Use MP3, WAV, OGG, or M4A.` });
      return;
    }

    const id = randomUUID();
    const ext = EXT_MAP[mimeType] ?? "mp3";
    const storageKey = `ambient-sounds/${id}/original.${ext}`;
    const pcmStorageKey = `ambient-sounds/${id}/loop.pcm`;

    const bucket = getBucket();

    // Run ffprobe for duration and ffmpeg transcode in parallel with original upload
    const [durationSeconds, pcmBuffer] = await Promise.all([
      getDurationSeconds(file.buffer),
      transcode(file.buffer).catch((err) => {
        logger.error({ err, id }, "ambient-sounds: ffmpeg transcode failed");
        throw new Error(`Audio transcode failed: ${(err as Error).message}`);
      }),
    ]);

    // Upload original + PCM in parallel
    await Promise.all([
      bucket.file(storageKey).save(file.buffer, { contentType: mimeType }),
      bucket.file(pcmStorageKey).save(pcmBuffer, { contentType: "audio/pcm" }),
    ]);

    const [record] = await db
      .insert(ambientSoundsTable)
      .values({
        id,
        name,
        storageKey,
        pcmStorageKey,
        mimeType,
        fileSize: file.size,
        durationSeconds: durationSeconds ?? undefined,
      })
      .returning();

    res.status(201).json({
      id: record!.id,
      name: record!.name,
      mimeType: record!.mimeType,
      fileSize: record!.fileSize,
      durationSeconds: record!.durationSeconds,
      createdAt: record!.createdAt,
    });
  } catch (err) {
    req.log.error({ err }, "ambient-sounds: upload failed");
    const message = err instanceof Error ? err.message : "Upload failed";
    res.status(400).json({ error: message });
  }
});

router.get("/admin/ambient-sounds/:id/audio", async (req, res): Promise<void> => {
  // Also accept token via query param so <audio> elements (which can't set headers) work.
  const qToken = req.query["token"] as string | undefined;
  const adminToken = process.env["ADMIN_TOKEN"];
  if (!adminToken) { res.status(503).json({ error: "Admin access not configured" }); return; }
  const headerToken = req.headers["x-admin-token"] as string | undefined;
  const providedToken = headerToken ?? qToken;
  if (!providedToken || providedToken !== adminToken) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  try {
    const { id } = req.params;
    const [sound] = await db.select().from(ambientSoundsTable).where(eq(ambientSoundsTable.id, id));
    if (!sound) { res.status(404).json({ error: "Not found" }); return; }
    const bucket = getBucket();
    const file = bucket.file(sound.storageKey);
    const [exists] = await file.exists();
    if (!exists) { res.status(404).json({ error: "Audio file not found in storage" }); return; }
    res.setHeader("Content-Type", sound.mimeType);
    res.setHeader("Cache-Control", "private, max-age=3600");
    file.createReadStream().pipe(res);
  } catch (err) {
    req.log.error({ err }, "ambient-sounds: admin audio proxy failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/admin/ambient-sounds/:id", requireAdmin, async (req, res): Promise<void> => {
  try {
    const id = req.params["id"] as string;
    const [sound] = await db.select().from(ambientSoundsTable).where(eq(ambientSoundsTable.id, id));
    if (!sound) { res.status(404).json({ error: "Not found" }); return; }

    const bucket = getBucket();
    await Promise.allSettled([
      bucket.file(sound.storageKey).delete(),
      bucket.file(sound.pcmStorageKey).delete(),
    ]);

    await db.delete(ambientSoundsTable).where(eq(ambientSoundsTable.id, id));
    invalidatePcmCache(id);

    res.status(204).end();
  } catch (err) {
    req.log.error({ err }, "ambient-sounds: delete failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── User-facing routes (mounted after provisionUser — auth enforced) ─────────

userRouter.get("/ambient-sounds", requireAuth, async (req, res): Promise<void> => {
  try {
    const sounds = await db
      .select({ id: ambientSoundsTable.id, name: ambientSoundsTable.name })
      .from(ambientSoundsTable)
      .orderBy(desc(ambientSoundsTable.createdAt));
    res.json(sounds);
  } catch (err) {
    req.log.error({ err }, "ambient-sounds: user list failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

userRouter.get("/ambient-sounds/:id/audio", requireAuth, async (req, res): Promise<void> => {
  try {
    const id = req.params["id"] as string;
    const [sound] = await db.select().from(ambientSoundsTable).where(eq(ambientSoundsTable.id, id));
    if (!sound) { res.status(404).json({ error: "Not found" }); return; }

    const bucket = getBucket();
    const file = bucket.file(sound.storageKey);
    const [exists] = await file.exists();
    if (!exists) { res.status(404).json({ error: "Audio file not found in storage" }); return; }

    res.setHeader("Content-Type", sound.mimeType);
    res.setHeader("Cache-Control", "public, max-age=3600");
    file.createReadStream().pipe(res);
  } catch (err) {
    req.log.error({ err }, "ambient-sounds: audio proxy failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
export { userRouter as ambientSoundsUserRouter };
