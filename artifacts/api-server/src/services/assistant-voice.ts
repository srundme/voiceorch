/** Last-resort Cartesia id if Karthikeyan is not listed yet. */
export const JARVIS_TTS_FALLBACK_VOICE_ID = "a0e99841-438c-4a64-b679-ae501e7d6091";

export type JarvisVoice = {
  voiceId: string;
  voiceName: string;
};

export function looksLikeKarthikeyan(name: string): boolean {
  const n = name.trim().toLowerCase();
  return n.includes("karthikeyan") || n === "karthik" || n.startsWith("karthik ");
}

export function isCartesiaVoiceId(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id.trim());
}
