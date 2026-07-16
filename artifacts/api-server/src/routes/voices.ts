import { Router, type IRouter } from "express";
import multer from "multer";
import { db } from "@workspace/db";
import {
  platformListedVoicesTable,
  platformSettingsTable,
  providersTable,
  userClonedVoicesTable,
} from "@workspace/db";
import { eq, and, count, desc } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { decryptKey } from "../lib/crypto.js";
import { requireAuth } from "../middlewares/requireAuth.js";
import { createTTSAdapter } from "../orchestration/adapters/tts/index.js";
import { pcmToWav } from "../orchestration/audio.js";

const router: IRouter = Router();

/** India endpoint by default; override via CARTESIA_BASE_URL env var. */
const CARTESIA_BASE_URL = (process.env["CARTESIA_BASE_URL"] ?? "https://api-india.cartesia.ai").replace(/\/+$/, "");
const CARTESIA_VERSION = "2026-03-01";
const MAX_CLONES_PER_USER = 20;
const CLONE_MAX_BYTES = 10 * 1024 * 1024;

const ALLOWED_CLIP_MIME = new Set([
  "audio/wav", "audio/wave", "audio/x-wav",
  "audio/mpeg", "audio/mp3", "audio/mp4", "audio/m4a", "audio/x-m4a",
  "audio/webm", "audio/ogg", "audio/flac", "video/webm",
]);

const cloneUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: CLONE_MAX_BYTES },
});

async function getCartesiaKey(): Promise<string | null> {
  const [row] = await db
    .select()
    .from(platformSettingsTable)
    .where(eq(platformSettingsTable.key, "managed_cartesia_key"));
  return row?.value ?? null;
}

/** Map SnapServe BCP-47 (hi-IN) → Cartesia base language code (hi). */
function toCartesiaLanguage(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return "en";
  const base = trimmed.split("-")[0] ?? "en";
  return base;
}

function serializeClone(row: typeof userClonedVoicesTable.$inferSelect) {
  return {
    id: row.cartesiaVoiceId,
    dbId: row.id,
    name: row.name,
    language: row.language,
    description: row.description ?? undefined,
    createdAt: row.createdAt.toISOString(),
  };
}

// ── GET /voices/whitelisted ──────────────────────────────────────────────────
// Returns only the admin-whitelisted voices (public, no auth required)

router.get("/voices/whitelisted", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(platformListedVoicesTable)
    .where(eq(platformListedVoicesTable.isListed, true));

  const voices = rows.map(r => ({
    id: r.voiceId,
    name: r.voiceName,
    language: r.language,
    description: r.description,
    isListed: r.isListed,
    // Real, admin-curated gender label from platform_listed_voices (same
    // source vibe-chat's voice picker already uses) — surfaced so every UI
    // that shows this voice agrees on the same gender/avatar bucket.
    gender: r.gender ?? undefined,
  }));

  res.json({ voices });
});

// ── GET /voices/mine ─────────────────────────────────────────────────────────
// Authenticated: list Cartesia clones owned by the current user.

router.get("/voices/mine", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as unknown as { clerkUserId: string }).clerkUserId;
  const rows = await db
    .select()
    .from(userClonedVoicesTable)
    .where(eq(userClonedVoicesTable.userId, userId))
    .orderBy(desc(userClonedVoicesTable.createdAt));

  res.json({ voices: rows.map(serializeClone) });
});

// ── POST /voices/clone ───────────────────────────────────────────────────────
// Authenticated: instant-clone via platform managed Cartesia key.
// multipart fields: clip (file), name, language; optional description.

router.post(
  "/voices/clone",
  requireAuth,
  cloneUpload.single("clip"),
  async (req, res): Promise<void> => {
    const userId = (req as unknown as { clerkUserId: string }).clerkUserId;
    const file = req.file;
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    const languageRaw = typeof req.body?.language === "string" ? req.body.language : "";
    const description =
      typeof req.body?.description === "string" ? req.body.description.trim() || null : null;

    if (!file?.buffer?.length) {
      res.status(400).json({ error: "Upload or record a short audio clip (field 'clip')." });
      return;
    }
    if (!name || name.length > 80) {
      res.status(400).json({ error: "Provide a voice name (1–80 characters)." });
      return;
    }
    if (!languageRaw.trim()) {
      res.status(400).json({ error: "Select a language for the clone." });
      return;
    }

    const mime = (file.mimetype || "").toLowerCase();
    if (mime && !ALLOWED_CLIP_MIME.has(mime) && !mime.startsWith("audio/")) {
      res.status(400).json({
        error: "Unsupported audio format. Use wav, mp3, m4a, webm, ogg, or flac.",
      });
      return;
    }

    const [{ value: cloneCount } = { value: 0 }] = await db
      .select({ value: count() })
      .from(userClonedVoicesTable)
      .where(eq(userClonedVoicesTable.userId, userId));

    if (Number(cloneCount) >= MAX_CLONES_PER_USER) {
      res.status(400).json({
        error: `You can keep up to ${MAX_CLONES_PER_USER} cloned voices. Delete one to clone again.`,
      });
      return;
    }

    const cartesiaKey = await getCartesiaKey();
    if (!cartesiaKey) {
      res.status(503).json({ error: "Voice cloning unavailable — Cartesia key not configured." });
      return;
    }

    const language = toCartesiaLanguage(languageRaw);
    const form = new FormData();
    const blob = new Blob([new Uint8Array(file.buffer)], { type: file.mimetype || "audio/wav" });
    form.append("clip", blob, file.originalname || "clip.wav");
    form.append("name", name);
    form.append("language", language);
    if (description) form.append("description", description);

    try {
      const cartesiaRes = await fetch(`${CARTESIA_BASE_URL}/voices/clone`, {
        method: "POST",
        headers: {
          "X-API-Key": cartesiaKey,
          "Cartesia-Version": CARTESIA_VERSION,
        },
        body: form,
      });

      const rawText = await cartesiaRes.text();
      if (!cartesiaRes.ok) {
        logger.warn(
          { status: cartesiaRes.status, body: rawText.slice(0, 500), userId },
          "Cartesia voice clone failed",
        );
        let message = "Cartesia could not clone this clip. Try a clearer 3–10 second recording.";
        try {
          const parsed = JSON.parse(rawText) as { error?: string; message?: string };
          message = parsed.error || parsed.message || message;
        } catch { /* keep default */ }
        res.status(502).json({ error: message });
        return;
      }

      let parsed: { id?: string; name?: string; language?: string; description?: string };
      try {
        parsed = JSON.parse(rawText) as typeof parsed;
      } catch {
        res.status(502).json({ error: "Cartesia returned an invalid clone response." });
        return;
      }

      if (!parsed.id) {
        res.status(502).json({ error: "Cartesia did not return a voice id." });
        return;
      }

      const [row] = await db
        .insert(userClonedVoicesTable)
        .values({
          userId,
          cartesiaVoiceId: parsed.id,
          name: parsed.name?.trim() || name,
          language: parsed.language || language,
          description: description ?? parsed.description ?? null,
        })
        .returning();

      logger.info(
        { userId, cartesiaVoiceId: parsed.id, language },
        "Cartesia voice clone created",
      );
      res.status(201).json({ voice: serializeClone(row!) });
    } catch (err) {
      logger.error({ err, userId }, "Voice clone request failed");
      res.status(500).json({ error: "Voice cloning failed. Please try again." });
    }
  },
);

// ── DELETE /voices/mine/:id ──────────────────────────────────────────────────
// :id is the Cartesia voice UUID (same id used as agents.tts_voice).

router.delete("/voices/mine/:id", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as unknown as { clerkUserId: string }).clerkUserId;
  const rawId = req.params["id"];
  const voiceId = (Array.isArray(rawId) ? rawId[0] : rawId)?.trim();
  if (!voiceId) {
    res.status(400).json({ error: "Missing voice id." });
    return;
  }

  const [row] = await db
    .select()
    .from(userClonedVoicesTable)
    .where(
      and(
        eq(userClonedVoicesTable.userId, userId),
        eq(userClonedVoicesTable.cartesiaVoiceId, voiceId),
      ),
    );

  if (!row) {
    res.status(404).json({ error: "Cloned voice not found." });
    return;
  }

  await db
    .delete(userClonedVoicesTable)
    .where(eq(userClonedVoicesTable.id, row.id));

  // Best-effort remote delete — ignore failures so the local row is already gone.
  const cartesiaKey = await getCartesiaKey();
  if (cartesiaKey) {
    try {
      const delRes = await fetch(`${CARTESIA_BASE_URL}/voices/${encodeURIComponent(voiceId)}`, {
        method: "DELETE",
        headers: {
          "X-API-Key": cartesiaKey,
          "Cartesia-Version": CARTESIA_VERSION,
        },
      });
      if (!delRes.ok && delRes.status !== 404) {
        const body = await delRes.text().catch(() => "");
        logger.warn(
          { status: delRes.status, body: body.slice(0, 300), voiceId },
          "Cartesia voice delete failed (local row already removed)",
        );
      }
    } catch (err) {
      logger.warn({ err, voiceId }, "Cartesia voice delete request error");
    }
  }

  res.json({ ok: true });
});

// ── POST /voices/preview ─────────────────────────────────────────────────────

const PREVIEW_VALID_MODELS = new Set([
  "sonic-3.5", "sonic-3.5-2026-05-04", "sonic-latest",
  "sonic-3", "sonic-3-2026-01-12", "sonic-3-latest",
  "sonic-2", "sonic-2-2025-03-07", "sonic-2-2025-04-16", "sonic-2-2025-05-08", "sonic-2-2025-06-11",
  "sonic-turbo", "sonic-turbo-2025-03-07", "sonic-turbo-2025-06-04",
  "sonic-english", "sonic-multilingual",
]);

const DEFAULT_PREVIEW_TEXT =
  "Hello! I am your AI voice assistant. I am here to help you today. How can I assist you?";

/**
 * Synthesize a short sample of a Cartesia voice using the platform
 * managed key. Returns a 22 kHz WAV (unchanged from the original behaviour).
 */
async function previewCartesia(
  res: import("express").Response,
  voiceId: string,
  modelId: string | undefined,
  previewText: string,
): Promise<void> {
  const cartesiaKey = await getCartesiaKey();
  if (!cartesiaKey) {
    res.status(503).json({ error: "Voice preview unavailable — Cartesia key not configured" });
    return;
  }

  const model = (modelId && PREVIEW_VALID_MODELS.has(modelId)) ? modelId : "sonic-3.5";

  const response = await fetch(`${CARTESIA_BASE_URL}/tts/bytes`, {
    method: "POST",
    headers: {
      "X-API-Key": cartesiaKey,
      "Cartesia-Version": CARTESIA_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model_id: model,
      transcript: previewText,
      voice: { mode: "id", id: voiceId },
      output_format: { container: "wav", encoding: "pcm_f32le", sample_rate: 22050 },
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    res.status(502).json({ error: `Cartesia error: ${err}` });
    return;
  }

  const audioBuffer = await response.arrayBuffer();
  res.set("Content-Type", "audio/wav");
  res.send(Buffer.from(audioBuffer));
}

// Returns raw WAV audio for the requested voice.
//
//   - Cartesia (default): uses the platform managed key — public, no auth. This
//     keeps the original whitelisted-voice preview behaviour unchanged (also works
//     for user clones created under the same managed key).
//   - Any other provider: requires an authenticated session and synthesizes
//     using the requesting user's own stored provider API key.
//
// Body: { provider?, voice?/voiceId, model?/modelId, language?, text? }

router.post("/voices/preview", async (req, res): Promise<void> => {
  const body = req.body as {
    provider?: string;
    voice?: string;
    voiceId?: string;
    model?: string;
    modelId?: string;
    language?: string;
    text?: string;
  };

  const provider = (body.provider ?? "cartesia").toLowerCase();
  const voiceId = body.voice ?? body.voiceId;
  const modelId = body.model ?? body.modelId;
  const previewText = body.text?.slice(0, 200) ?? DEFAULT_PREVIEW_TEXT;

  if (!voiceId) {
    res.status(400).json({ error: "Select a voice before previewing." });
    return;
  }

  // ── Cartesia: managed-key path (public, unchanged) ──────────────────────────
  if (provider === "cartesia") {
    try {
      await previewCartesia(res, voiceId, modelId, previewText);
    } catch (err) {
      logger.error({ err }, "Voice preview failed (cartesia)");
      if (!res.headersSent) res.status(500).json({ error: "Voice preview failed" });
    }
    return;
  }

  // ── Other providers: synthesize with the user's own stored key ──────────────
  const userId = (req as unknown as { clerkUserId?: string }).clerkUserId;
  if (!userId) {
    res.status(401).json({ error: "Sign in to preview this provider's voices." });
    return;
  }

  // Resolve the user's active API key for this provider (matches webcall lookup).
  const [providerRow] = await db
    .select()
    .from(providersTable)
    .where(
      and(
        eq(providersTable.userId, userId),
        eq(providersTable.providerName, provider),
        eq(providersTable.isActive, true),
      ),
    );

  if (!providerRow) {
    res.status(400).json({
      error: `No active ${provider} API key found. Add one on the Providers page to preview this voice.`,
    });
    return;
  }

  const apiKey = decryptKey(providerRow.apiKey);
  const language = body.language ?? null;
  const extraConfig = provider === "sarvam"
    ? JSON.stringify({ language: language ?? "en-IN" })
    : (providerRow.extraConfig ?? null);

  try {
    const tts = createTTSAdapter(provider, apiKey, voiceId, modelId ?? null, extraConfig, language);
    const { audio } = await tts.synthesize(previewText);
    // All TTS adapters return raw 16 kHz mono s16le PCM — wrap in a WAV header.
    const wav = pcmToWav(audio, 16000, 1, 16);
    res.set("Content-Type", "audio/wav");
    res.send(wav);
  } catch (err) {
    logger.error({ err, provider }, "Voice preview failed");
    const message = err instanceof Error && err.message.startsWith("Unknown TTS provider")
      ? `Preview is not supported for ${provider}.`
      : `Could not generate a preview. Check that your ${provider} API key and voice are valid.`;
    res.status(502).json({ error: message });
  }
});

export default router;
