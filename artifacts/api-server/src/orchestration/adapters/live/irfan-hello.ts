import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const FRAME_BYTES_8K = 320;

/**
 * esbuild bundles this module into dist/index.mjs, so import.meta.url is the
 * bundle, not adapters/live/. Railway only copies dist/ — look next to the
 * bundle and at the copyAssets destination.
 */
export function irfanHelloPcmCandidates(): string[] {
  const here = dirname(fileURLToPath(import.meta.url));
  return [
    resolve(here, "irfan_hello_8k.pcm"),
    resolve(here, "orchestration/adapters/live/irfan_hello_8k.pcm"),
    resolve(here, "adapters/live/irfan_hello_8k.pcm"),
    resolve(process.cwd(), "artifacts/api-server/dist/orchestration/adapters/live/irfan_hello_8k.pcm"),
    resolve(process.cwd(), "artifacts/api-server/dist/irfan_hello_8k.pcm"),
    resolve(process.cwd(), "deploy/personaplex/irfan_hello_8k.pcm"),
    resolve(process.cwd(), "artifacts/api-server/src/orchestration/adapters/live/irfan_hello_8k.pcm"),
  ];
}

let cached: Buffer | null | undefined;
let cachedPath: string | null = null;

/** 8 kHz s16le PCM of "Hello, this is Irfan from JobShop." */
export function loadIrfanHelloPcm(): Buffer | null {
  if (cached !== undefined) return cached;
  for (const path of irfanHelloPcmCandidates()) {
    if (!existsSync(path)) continue;
    try {
      const buf = readFileSync(path);
      if (buf.length >= FRAME_BYTES_8K) {
        cached = buf;
        cachedPath = path;
        return cached;
      }
    } catch {
      /* try next */
    }
  }
  cached = null;
  cachedPath = null;
  return null;
}

export function irfanHelloPcmPath(): string | null {
  loadIrfanHelloPcm();
  return cachedPath;
}

export function irfanHelloFrames(): Buffer[] {
  const pcm = loadIrfanHelloPcm();
  if (!pcm) return [];
  const aligned = pcm.subarray(0, pcm.length - (pcm.length % FRAME_BYTES_8K));
  const frames: Buffer[] = [];
  for (let i = 0; i + FRAME_BYTES_8K <= aligned.length; i += FRAME_BYTES_8K) {
    frames.push(Buffer.from(aligned.subarray(i, i + FRAME_BYTES_8K)));
  }
  return frames;
}

export const IRFAN_HELLO_TEXT = "Hello, this is Irfan from JobShop.";
