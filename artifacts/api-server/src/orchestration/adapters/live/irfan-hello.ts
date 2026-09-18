import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const FRAME_BYTES_8K = 320;

function helloCandidates(): string[] {
  const here = dirname(fileURLToPath(import.meta.url));
  return [
    resolve(here, "irfan_hello_8k.pcm"),
    resolve(here, "../../../../../deploy/personaplex/irfan_hello_8k.pcm"),
    resolve(process.cwd(), "deploy/personaplex/irfan_hello_8k.pcm"),
    resolve(process.cwd(), "artifacts/api-server/src/orchestration/adapters/live/irfan_hello_8k.pcm"),
  ];
}

let cached: Buffer | null | undefined;

/** 8 kHz s16le PCM of "Hello, this is Irfan from JobShop." */
export function loadIrfanHelloPcm(): Buffer | null {
  if (cached !== undefined) return cached;
  for (const path of helloCandidates()) {
    if (!existsSync(path)) continue;
    try {
      const buf = readFileSync(path);
      if (buf.length >= FRAME_BYTES_8K) {
        cached = buf;
        return cached;
      }
    } catch {
      /* try next */
    }
  }
  cached = null;
  return null;
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
