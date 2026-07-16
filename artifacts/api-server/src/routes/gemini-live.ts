import { Router, type IRouter } from "express";
import { db, platformSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { pcmToWav } from "../orchestration/audio.js";
import {
  GEMINI_LIVE_VOICES,
  isValidGeminiLiveVoice,
  resolveGeminiLiveVoice,
} from "../orchestration/adapters/live/gemini-live-voices.js";
import { synthesizeGeminiLiveVoicePreview } from "../orchestration/adapters/live/gemini-live-preview.js";

const router: IRouter = Router();

async function getGeminiKey(): Promise<string | null> {
  const [row] = await db
    .select()
    .from(platformSettingsTable)
    .where(eq(platformSettingsTable.key, "managed_gemini_key"));
  return row?.value ?? process.env["GEMINI_API_KEY"] ?? null;
}

/** GET /gemini-live/voices — static catalog of 30 preset voices */
router.get("/gemini-live/voices", (_req, res): void => {
  res.json({
    voices: GEMINI_LIVE_VOICES.map((v) => ({
      name: v.name,
      style: v.style,
      label: `${v.name} — ${v.style}`,
    })),
    defaultVoice: resolveGeminiLiveVoice(null),
  });
});

/** POST /gemini-live/voices/preview — short TTS sample via gemini-3.1-flash-tts-preview */
router.post("/gemini-live/voices/preview", async (req, res): Promise<void> => {
  const body = req.body as { voiceName?: string; text?: string };
  const voiceName = body.voiceName;
  if (!voiceName || !isValidGeminiLiveVoice(voiceName)) {
    res.status(400).json({ error: "Select a valid Gemini Live voice before previewing." });
    return;
  }

  const apiKey = await getGeminiKey();
  if (!apiKey) {
    res.status(503).json({ error: "Voice preview unavailable — Gemini API key not configured" });
    return;
  }

  try {
    const audio = await synthesizeGeminiLiveVoicePreview(apiKey, voiceName, body.text);
    // Interactions TTS may return WAV or raw PCM — detect by RIFF header.
    if (audio.length >= 4 && audio.toString("ascii", 0, 4) === "RIFF") {
      res.set("Content-Type", "audio/wav");
      res.send(audio);
      return;
    }
    const wav = pcmToWav(audio, 24000, 1, 16);
    res.set("Content-Type", "audio/wav");
    res.send(wav);
  } catch (err) {
    logger.error({ err, voiceName }, "Gemini Live voice preview failed");
    if (!res.headersSent) {
      res.status(502).json({ error: "Could not generate Gemini Live voice preview." });
    }
  }
});

export default router;
