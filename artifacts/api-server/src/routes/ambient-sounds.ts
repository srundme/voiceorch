import { Router } from "express";
import multer from "multer";
import { randomUUID } from "crypto";
import { spawn } from "child_process";
import { db, ambientSoundsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAdmin.js";
import { requireAuth } from "../middlewares/requireAuth.js";
import { logger } from "../lib/logger.js";
import { invalidatePcmCache, AmbientNoiseStream, TRACK_PARAMS } from "../orchestration/ambient.js";
import { resolveFfmpegPath } from "../lib/ffmpeg.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
});

const ALLOWED_MIME = new Set(["audio/mpeg", "audio/mp3", "audio/wav", "audio/wave", "audio/ogg", "audio/x-m4a", "audio/mp4", "audio/aac"]);

// Transcode output format — raw s16le 8 kHz mono PCM.
const PCM_SAMPLE_RATE = 8000;
const PCM_BYTES_PER_SAMPLE = 2;

/** Exact playback duration of the transcoded 8 kHz mono PCM, in seconds. */
function pcmDurationSeconds(pcm: Buffer): number {
  return pcm.length / PCM_BYTES_PER_SAMPLE / PCM_SAMPLE_RATE;
}

async function transcode(inputBuffer: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const proc = spawn(resolveFfmpegPath(), [
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

/**
 * Stream raw audio bytes (from a Postgres bytea column) with HTTP Range support
 * so <audio> players can seek/scrub. Mirrors the call-recording serving route.
 */
function serveAudioBytes(
  req: { headers: Record<string, string | string[] | undefined> },
  res: import("express").Response,
  audio: Buffer,
  mimeType: string,
  cacheControl: string,
): void {
  const total = audio.length;
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Content-Type", mimeType);
  res.setHeader("Cache-Control", cacheControl);

  const rangeHeader = req.headers["range"];
  const range = Array.isArray(rangeHeader) ? rangeHeader[0] : rangeHeader;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (match) {
      const startStr = match[1] ?? "";
      const endStr = match[2] ?? "";
      let start = startStr ? Number.parseInt(startStr, 10) : 0;
      let end = endStr ? Number.parseInt(endStr, 10) : total - 1;
      if (Number.isNaN(start)) start = 0;
      if (Number.isNaN(end) || end >= total) end = total - 1;
      if (start > end || start >= total) {
        res.status(416).setHeader("Content-Range", `bytes */${total}`);
        res.end();
        return;
      }
      const chunk = audio.subarray(start, end + 1);
      res.status(206);
      res.setHeader("Content-Range", `bytes ${start}-${end}/${total}`);
      res.setHeader("Content-Length", String(chunk.length));
      res.end(chunk);
      return;
    }
  }

  res.setHeader("Content-Length", String(total));
  res.end(audio);
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

    // 1. Store the original audio bytes directly in Postgres and insert the row.
    //    pcmData stays null until the background transcode finishes.
    const [record] = await db
      .insert(ambientSoundsTable)
      .values({
        id,
        name,
        audioData: file.buffer,
        mimeType,
        fileSize: file.size,
      })
      .returning({
        id: ambientSoundsTable.id,
        name: ambientSoundsTable.name,
        mimeType: ambientSoundsTable.mimeType,
        fileSize: ambientSoundsTable.fileSize,
        durationSeconds: ambientSoundsTable.durationSeconds,
        createdAt: ambientSoundsTable.createdAt,
      });

    // 2. Respond immediately — proxy timeout will never be hit.
    res.status(201).json({
      id: record!.id,
      name: record!.name,
      mimeType: record!.mimeType,
      fileSize: record!.fileSize,
      durationSeconds: record!.durationSeconds,
      createdAt: record!.createdAt,
      processing: true,
    });

    // 3. Transcode to 8 kHz PCM in the background; update the row when done.
    //    Duration is derived exactly from the resampled PCM length (the original
    //    and the resample have identical wall-clock length), avoiding ffprobe.
    void (async () => {
      try {
        const pcmBuffer = await transcode(file.buffer);
        await db.update(ambientSoundsTable)
          .set({ pcmData: pcmBuffer, durationSeconds: pcmDurationSeconds(pcmBuffer) })
          .where(eq(ambientSoundsTable.id, id));
        logger.info({ id }, "ambient-sounds: background transcode complete");
      } catch (bgErr) {
        logger.error({ bgErr, id }, "ambient-sounds: background transcode failed");
      }
    })();
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
    const [sound] = await db
      .select({ audioData: ambientSoundsTable.audioData, mimeType: ambientSoundsTable.mimeType })
      .from(ambientSoundsTable)
      .where(eq(ambientSoundsTable.id, id));
    if (!sound) { res.status(404).json({ error: "Not found" }); return; }
    if (!sound.audioData) { res.status(404).json({ error: "Audio data not found" }); return; }
    serveAudioBytes(req, res, sound.audioData, sound.mimeType, "private, max-age=3600");
  } catch (err) {
    req.log.error({ err }, "ambient-sounds: admin audio serve failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/admin/ambient-sounds/:id", requireAdmin, async (req, res): Promise<void> => {
  try {
    const id = req.params["id"] as string;
    const [sound] = await db
      .select({ id: ambientSoundsTable.id })
      .from(ambientSoundsTable)
      .where(eq(ambientSoundsTable.id, id));
    if (!sound) { res.status(404).json({ error: "Not found" }); return; }

    await db.delete(ambientSoundsTable).where(eq(ambientSoundsTable.id, id));
    invalidatePcmCache(id);

    res.status(204).end();
  } catch (err) {
    req.log.error({ err }, "ambient-sounds: delete failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── User-facing routes (mounted after provisionUser — auth enforced) ─────────

/** Build a minimal RIFF/WAV header for mono 16-bit PCM at 8 kHz. */
function makePcmWav(pcm: Buffer): Buffer {
  const header = Buffer.allocUnsafe(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);           // fmt chunk size
  header.writeUInt16LE(1, 20);            // PCM format
  header.writeUInt16LE(1, 22);            // mono
  header.writeUInt32LE(8000, 24);         // sample rate
  header.writeUInt32LE(8000 * 2, 28);     // byte rate (rate × blockAlign)
  header.writeUInt16LE(2, 32);            // block align (1 ch × 2 bytes)
  header.writeUInt16LE(16, 34);           // bits per sample
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/**
 * GET /ambient-sounds/builtin/:track/audio
 * Returns ~5 s of the requested built-in ambient track as a WAV file.
 * Built-in tracks are computed on the fly (no DB/ffmpeg needed).
 */
userRouter.get("/ambient-sounds/builtin/:track/audio", requireAuth, (req, res): void => {
  const track = req.params["track"] as string;
  if (!Object.prototype.hasOwnProperty.call(TRACK_PARAMS, track)) {
    res.status(404).json({ error: "Unknown built-in track" });
    return;
  }
  const PREVIEW_SECONDS = 5;
  const SAMPLES_PER_CHUNK = 160;                           // 20 ms @ 8 kHz
  const TOTAL_CHUNKS = Math.ceil((PREVIEW_SECONDS * 8000) / SAMPLES_PER_CHUNK);
  const stream = new AmbientNoiseStream(track);
  const chunks: Buffer[] = [];
  for (let i = 0; i < TOTAL_CHUNKS; i++) {
    chunks.push(stream.nextPcmChunk());
  }
  const pcm = Buffer.concat(chunks);
  const wav = makePcmWav(pcm);
  res.setHeader("Content-Type", "audio/wav");
  res.setHeader("Content-Length", String(wav.length));
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.end(wav);
});

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
    const [sound] = await db
      .select({ audioData: ambientSoundsTable.audioData, mimeType: ambientSoundsTable.mimeType })
      .from(ambientSoundsTable)
      .where(eq(ambientSoundsTable.id, id));
    if (!sound) { res.status(404).json({ error: "Not found" }); return; }
    if (!sound.audioData) { res.status(404).json({ error: "Audio data not found" }); return; }
    serveAudioBytes(req, res, sound.audioData, sound.mimeType, "public, max-age=3600");
  } catch (err) {
    req.log.error({ err }, "ambient-sounds: audio serve failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
export { userRouter as ambientSoundsUserRouter };
