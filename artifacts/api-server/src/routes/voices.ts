import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { platformListedVoicesTable, platformSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

const CARTESIA_BASE_URL = "https://api.cartesia.ai";
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

router.post("/voices/preview", async (req, res): Promise<void> => {
  const { voiceId, text, modelId } = req.body as { voiceId?: string; text?: string; modelId?: string };

  if (!voiceId) {
    res.status(400).json({ error: "voiceId required" });
    return;
  }

  const cartesiaKey = await getCartesiaKey();
  if (!cartesiaKey) {
    res.status(503).json({ error: "Voice preview unavailable — Cartesia key not configured" });
    return;
  }

  const previewText = text?.slice(0, 200) ?? "Hello! I am your AI voice assistant. I am here to help you today. How can I assist you?";
  const model = (modelId && PREVIEW_VALID_MODELS.has(modelId)) ? modelId : "sonic-3.5";

  try {
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
  } catch (err) {
    logger.error({ err }, "Voice preview failed");
    res.status(500).json({ error: "Voice preview failed" });
  }
});

export default router;
