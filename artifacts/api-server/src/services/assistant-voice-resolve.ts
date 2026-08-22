import { db, platformListedVoicesTable, userClonedVoicesTable } from "@workspace/db";
import { logger } from "../lib/logger.js";
import {
  JARVIS_TTS_FALLBACK_VOICE_ID,
  looksLikeKarthikeyan,
  type JarvisVoice,
} from "./assistant-voice.js";

let cache: { voice: JarvisVoice; at: number } | null = null;
const CACHE_MS = 5 * 60 * 1000;

export async function resolveJarvisVoice(): Promise<JarvisVoice> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.voice;
  try {
    const [listed, clones] = await Promise.all([
      db
        .select({
          voiceId: platformListedVoicesTable.voiceId,
          voiceName: platformListedVoicesTable.voiceName,
          isListed: platformListedVoicesTable.isListed,
        })
        .from(platformListedVoicesTable),
      db
        .select({
          voiceId: userClonedVoicesTable.cartesiaVoiceId,
          voiceName: userClonedVoicesTable.name,
        })
        .from(userClonedVoicesTable)
        .limit(80),
    ]);

    const listedHit = listed.find((v) => v.isListed && looksLikeKarthikeyan(v.voiceName));
    const listedAny = listed.find((v) => looksLikeKarthikeyan(v.voiceName));
    const cloneHit = clones.find((v) => looksLikeKarthikeyan(v.voiceName));
    const hit = listedHit ?? listedAny ?? cloneHit;
    const voice: JarvisVoice = hit
      ? { voiceId: hit.voiceId, voiceName: hit.voiceName }
      : { voiceId: JARVIS_TTS_FALLBACK_VOICE_ID, voiceName: "Karthikeyan" };
    cache = { voice, at: Date.now() };
    return voice;
  } catch (err) {
    logger.warn({ err }, "assistant: Karthikeyan voice lookup failed");
    return { voiceId: JARVIS_TTS_FALLBACK_VOICE_ID, voiceName: "Karthikeyan" };
  }
}
