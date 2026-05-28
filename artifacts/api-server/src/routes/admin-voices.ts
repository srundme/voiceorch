import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { platformListedVoicesTable, platformSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAdmin.js";
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

// ── GET /admin/voices/cartesia ────────────────────────────────────────────────
// Fetch all voices live from Cartesia and annotate each with is_listed flag

router.get("/admin/voices/cartesia", requireAdmin, async (_req, res): Promise<void> => {
  const cartesiaKey = await getCartesiaKey();

  if (!cartesiaKey) {
    res.status(503).json({ error: "Cartesia key not configured" });
    return;
  }

  try {
    const [cartesiaRes, listedRows] = await Promise.all([
      fetch(`${CARTESIA_BASE_URL}/voices`, {
        headers: {
          "X-API-Key": cartesiaKey,
          "Cartesia-Version": CARTESIA_VERSION,
        },
      }),
      db.select().from(platformListedVoicesTable),
    ]);

    if (!cartesiaRes.ok) {
      const errText = (await cartesiaRes.text().catch(() => "")).trim();
      logger.warn({ status: cartesiaRes.status, body: errText }, "Cartesia voices fetch failed");
      const snippet = errText.slice(0, 300);
      res.status(502).json({
        error: `Cartesia ${cartesiaRes.status}: ${snippet || cartesiaRes.statusText || "request failed"}`,
      });
      return;
    }

    const raw = await cartesiaRes.json() as any;
    // Cartesia 2026-03-01 wraps voices in { data: [...] }; older versions returned an array
    const arr: any[] = Array.isArray(raw)
      ? raw
      : (Array.isArray(raw?.data) ? raw.data : (Array.isArray(raw?.voices) ? raw.voices : []));

    const listedSet = new Set(
      listedRows.filter(r => r.isListed).map(r => r.voiceId)
    );

    const voices = arr.map((v: any) => ({
      id: v.id as string,
      name: (v.name ?? "") as string,
      gender: (v.gender ?? "Neutral") as string,
      language: (v.language ?? "en") as string,
      description: (v.description ?? "") as string,
      isListed: listedSet.has(v.id as string),
      isOwner: Boolean(v.is_owner ?? v.isOwner ?? false),
    }));

    res.json({ voices });
  } catch (err) {
    logger.error({ err }, "Error in adminGetCartesiaVoices");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /admin/voices/listed ──────────────────────────────────────────────────
// Returns only the whitelisted voices (consumed by the dashboard wizard)

router.get("/admin/voices/listed", requireAdmin, async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(platformListedVoicesTable)
    .where(eq(platformListedVoicesTable.isListed, true));

  const voices = rows.map(r => ({
    id: r.voiceId,
    name: r.voiceName,
    gender: r.gender,
    language: r.language,
    description: r.description,
    isListed: r.isListed,
  }));

  res.json({ voices });
});

// ── POST /admin/voices/preview ────────────────────────────────────────────────
// Returns raw WAV audio for a voice so the admin can audition it before listing

const PREVIEW_VALID_MODELS = new Set([
  "sonic-3.5", "sonic-3.5-2026-05-04", "sonic-latest",
  "sonic-3", "sonic-3-2026-01-12", "sonic-3-latest",
  "sonic-2", "sonic-2-2025-03-07", "sonic-2-2025-04-16", "sonic-2-2025-05-08", "sonic-2-2025-06-11",
  "sonic-turbo", "sonic-turbo-2025-03-07", "sonic-turbo-2025-06-04",
  "sonic-english", "sonic-multilingual",
]);

router.post("/admin/voices/preview", requireAdmin, async (req, res): Promise<void> => {
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
    logger.error({ err }, "Admin voice preview failed");
    res.status(500).json({ error: "Voice preview failed" });
  }
});

// ── PUT /admin/voices/listed ──────────────────────────────────────────────────
// Accept a full list of selected voices and upsert them into the DB.
// Voices not included in the new selection are marked is_listed = false.

router.put("/admin/voices/listed", requireAdmin, async (req, res): Promise<void> => {
  const { voices } = req.body as {
    voices: Array<{
      id: string;
      name: string;
      gender?: string;
      language?: string;
      description?: string;
    }>;
  };

  if (!Array.isArray(voices)) {
    res.status(400).json({ error: "voices array required" });
    return;
  }

  const selectedIds = new Set(voices.map(v => v.id));

  // Fetch current rows
  const existingRows = await db.select().from(platformListedVoicesTable);
  const existingIds = new Set(existingRows.map(r => r.voiceId));

  const upserts: Promise<any>[] = [];

  // Upsert all selected voices (is_listed = true)
  for (const v of voices) {
    upserts.push(
      db
        .insert(platformListedVoicesTable)
        .values({
          voiceId: v.id,
          voiceName: v.name,
          gender: v.gender ?? "Neutral",
          language: v.language ?? "en",
          description: v.description ?? "",
          isListed: true,
        })
        .onConflictDoUpdate({
          target: platformListedVoicesTable.voiceId,
          set: {
            voiceName: v.name,
            gender: v.gender ?? "Neutral",
            language: v.language ?? "en",
            description: v.description ?? "",
            isListed: true,
          },
        })
    );
  }

  // Mark deselected voices as is_listed = false
  for (const row of existingRows) {
    if (!selectedIds.has(row.voiceId)) {
      upserts.push(
        db
          .update(platformListedVoicesTable)
          .set({ isListed: false })
          .where(eq(platformListedVoicesTable.voiceId, row.voiceId))
      );
    }
  }

  await Promise.all(upserts);
  res.json({ saved: voices.length });
});

export default router;
