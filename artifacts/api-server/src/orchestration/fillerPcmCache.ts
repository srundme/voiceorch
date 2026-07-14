/**
 * In-memory PCM cache for dead-air / tool fillers.
 * Keyed by TTS identity + phrase so repeat fillers skip network TTS (Bolna preset-WAV feel).
 */

const MAX_ENTRIES = 64;

export type FillerPcmCacheKey = {
  provider: string;
  voice: string;
  model: string;
  text: string;
};

function keyOf(k: FillerPcmCacheKey): string {
  return `${k.provider}|${k.voice}|${k.model}|${k.text}`;
}

const cache = new Map<string, Buffer>();

export function getCachedFillerPcm(k: FillerPcmCacheKey): Buffer | null {
  const hit = cache.get(keyOf(k));
  return hit ? Buffer.from(hit) : null;
}

export function setCachedFillerPcm(k: FillerPcmCacheKey, pcm16k: Buffer): void {
  const id = keyOf(k);
  if (cache.has(id)) cache.delete(id);
  cache.set(id, Buffer.from(pcm16k));
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/** Test helper */
export function clearFillerPcmCache(): void {
  cache.clear();
}

export function fillerPcmCacheSize(): number {
  return cache.size;
}
