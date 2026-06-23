import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { platformListedVoicesTable, platformSettingsTable, providersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { decryptKey } from "../lib/crypto.js";
import { createTTSAdapter } from "../orchestration/adapters/tts/index.js";
import { pcmToWav } from "../orchestration/audio.js";

const router: IRouter = Router();

/** India endpoint by default; override via CARTESIA_BASE_URL env var. */
const CARTESIA_BASE_URL = (process.env["CARTESIA_BASE_URL"] ?? "https://api-india.cartesia.ai").replace(/\/+$/, "");
const CARTESIA_VERSION = "2026-03-01";

async function getCartesiaKey(): Promise<string | null> {
  const [row] = await db
    .select()
    .from(platformSettingsTable)
    .where(eq(platformSettingsTable.key, "managed_cartesia_key"));
  return row?.value ?? null;
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
  }));

  res.json({ voices });
});

// ── POST /voices/preview ─────────────────────────────────────────────────────
// Returns raw WAV audio for a whitelisted voice (public, no auth required)

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
 * Synthesize a short sample of a Cartesia whitelisted voice using the platform
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

// ── POST /voices/preview ─────────────────────────────────────────────────────
// Returns raw WAV audio for the requested voice.
//
//   - Cartesia (default): uses the platform managed key — public, no auth. This
//     keeps the original whitelisted-voice preview behaviour unchanged.
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
