import { Router, type IRouter } from "express";
import { db, platformSettingsTable, providersTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { decryptKey } from "../lib/crypto.js";
import { pcmToWav } from "../orchestration/audio.js";
import {
  OPENAI_REALTIME_VOICES,
  isValidOpenAIRealtimeVoice,
  resolveOpenAIRealtimeVoice,
} from "../orchestration/adapters/live/openai-realtime-voices.js";
import { synthesizeOpenAIRealtimeVoicePreview } from "../orchestration/adapters/live/openai-realtime-preview.js";

const router: IRouter = Router();

/** Same order as live calls: the user's own OpenAI key, then Admin → Managed Keys. */
async function getOpenAIKey(userId: string): Promise<string | null> {
  const [row] = await db
    .select()
    .from(providersTable)
    .where(
      and(
        eq(providersTable.userId, userId),
        eq(providersTable.providerName, "openai"),
        eq(providersTable.isActive, true),
      ),
    );
  if (row) {
    try {
      return decryptKey(row.apiKey);
    } catch (err) {
      logger.warn({ err, userId }, "OpenAI Realtime preview: could not decrypt user OpenAI key");
    }
  }
  const [managed] = await db
    .select()
    .from(platformSettingsTable)
    .where(eq(platformSettingsTable.key, "managed_openai_key"));
  return managed?.value?.trim() || null;
}

/** GET /openai-realtime/voices — static catalog of gpt-realtime preset voices */
router.get("/openai-realtime/voices", (_req, res): void => {
  res.json({
    voices: OPENAI_REALTIME_VOICES.map((name) => ({ name, label: name })),
    defaultVoice: resolveOpenAIRealtimeVoice(null),
  });
});

/** POST /openai-realtime/voices/preview — short sample spoken by gpt-realtime */
router.post("/openai-realtime/voices/preview", async (req, res): Promise<void> => {
  const userId = (req as unknown as { clerkUserId?: string }).clerkUserId;
  if (!userId) {
    res.status(401).json({ error: "Sign in to preview GPT Realtime voices." });
    return;
  }
  const body = req.body as { voiceName?: string; text?: string };
  const voiceName = body.voiceName;
  if (!voiceName || !isValidOpenAIRealtimeVoice(voiceName)) {
    res.status(400).json({ error: "Select a valid GPT Realtime voice before previewing." });
    return;
  }

  const apiKey = await getOpenAIKey(userId);
  if (!apiKey) {
    res.status(503).json({ error: "Voice preview unavailable — no OpenAI API key configured." });
    return;
  }

  try {
    const pcm = await synthesizeOpenAIRealtimeVoicePreview(apiKey, voiceName, body.text);
    res.set("Content-Type", "audio/wav");
    res.send(pcmToWav(pcm, 24000, 1, 16));
  } catch (err) {
    logger.error({ err, voiceName }, "OpenAI Realtime voice preview failed");
    if (!res.headersSent) {
      res.status(502).json({ error: "Could not generate GPT Realtime voice preview." });
    }
  }
});

export default router;
