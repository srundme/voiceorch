/**
 * Bolna-style preset fillers: WAV on disk, sequence_id = -1, no live TTS.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { upsample8to16 } from "./audio.js";

function resolveFillerDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "fillers"),
    join(here, "orchestration", "fillers"),
  ];
  for (const dir of candidates) {
    if (existsSync(join(dir, "en-mmhmm.wav"))) return dir;
  }
  return candidates[0]!;
}

const FILLER_DIR = resolveFillerDir();

const FILE_BY_PHRASE: Record<string, string> = {
  "right": "en-right.wav",
  "okay": "en-okay.wav",
  "ok": "en-okay.wav",
  "mm-hmm": "en-mmhmm.wav",
  "mmhmm": "en-mmhmm.wav",
  "hmm": "en-hmm.wav",
  "i see": "en-hmm.wav",
  "got it": "en-okay.wav",
  "understood": "en-okay.wav",
  "ம்ம்": "ta-mm.wav",
  "ஹ்ம்": "ta-mm.wav",
  "ஆஹா": "ta-aaha.wav",
  "அப்படியா": "ta-aaha.wav",
  "சரி": "ta-sari.wav",
  "சரிங்க": "ta-sari.wav",
  "புரிஞ்சுது": "ta-sari.wav",
  "ஓகே": "ta-oke.wav",
  "ஓகேங்க": "ta-oke.wav",
  "हम्म": "hi-hmm.wav",
  "उम्म": "hi-hmm.wav",
  "अच्छा": "hi-achha.wav",
  "अच्छा जी": "hi-achha.wav",
  "ठीक है": "hi-theek.wav",
  "समझ गया": "hi-theek.wav",
  "ओके": "hi-oke.wav",
};

const cache = new Map<string, Buffer>();

function normalizePhrase(text: string): string {
  return text.trim().toLowerCase().replace(/[.!?…,]+$/g, "").trim();
}

function presetFileFor(text: string): string {
  const key = normalizePhrase(text);
  return FILE_BY_PHRASE[key] ?? "en-mmhmm.wav";
}

function readWavPcm16(fileName: string): Buffer {
  const hit = cache.get(fileName);
  if (hit) return Buffer.from(hit);
  const wav = readFileSync(join(FILLER_DIR, fileName));
  const pcm = pcmFromWav(wav);
  cache.set(fileName, pcm);
  return Buffer.from(pcm);
}

function pcmFromWav(wav: Buffer): Buffer {
  if (wav.toString("ascii", 0, 4) !== "RIFF") {
    throw new Error("filler is not a RIFF WAV");
  }
  let offset = 12;
  while (offset + 8 <= wav.length) {
    const id = wav.toString("ascii", offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    if (id === "data") {
      return wav.subarray(offset + 8, offset + 8 + size);
    }
    offset += 8 + size + (size % 2);
  }
  throw new Error("filler WAV has no data chunk");
}

/** Load the preset WAV for this phrase. Never opens Cartesia. */
export function loadPresetFillerPcm(text: string, sampleRate = 8000): Buffer {
  const pcm8k = readWavPcm16(presetFileFor(text));
  return sampleRate === 16000 ? upsample8to16(pcm8k) : pcm8k;
}

export function presetFillerDurationMs(pcmBytes: number, sampleRate = 8000): number {
  const rate = sampleRate === 16000 ? 16000 : 8000;
  return Math.round((pcmBytes / 2 / rate) * 1000);
}

/** @deprecated murmur path — kept name for one release so imports do not break mid-edit */
export const synthesizeLocalFillerPcm = loadPresetFillerPcm;
export const localFillerDurationMs = presetFillerDurationMs;
export const LOCAL_FILLER_MS = 300;
