/**
 * Ambient noise synthesis and mixing for voice calls.
 *
 * Generates a synthetic looping PCM8k noise buffer tuned to each "environment"
 * track.  No external audio files are required — everything is computed from
 * a seeded PRNG + simple IIR filter shaping at construction time.
 *
 * Also supports file-based ambient tracks loaded from GCS (FileAmbientNoiseStream).
 * When an ambientNoiseTrack value does NOT match a key in TRACK_PARAMS, it is
 * treated as an uploaded sound ID and loaded from GCS via loadPcmLoop().
 *
 * PCM format throughout: 8 kHz, 16-bit signed little-endian (same as the
 * rest of the pipeline).  mulaw helpers mirror what audio.ts exposes so we
 * keep this file self-contained.
 *
 * Usage:
 *   const stream = new AmbientNoiseStream("office-ambience");
 *   // During silence — send a 20 ms chunk to onAudioOut:
 *   onAudioOut(stream.nextMulawChunk());
 *   // During speech — mix ambient into a TTS mulaw chunk before sending:
 *   onAudioOut(stream.mixIntoMulaw(ttsMulawChunk));
 */

import { linearToMulaw, mulawToLinear } from "./audio.js";
import { Storage } from "@google-cloud/storage";
import { logger } from "../lib/logger.js";

// ── Track configuration ────────────────────────────────────────────────────────

interface TrackParams {
  /** IIR low-pass coefficient α: higher → warmer/bassier, range 0–1 */
  alpha: number;
  /** Second IIR stage alpha (used for a mid-frequency boost in some tracks) */
  alpha2: number;
  /** Blend between stage1 and stage2 output (0 = pure stage1, 1 = pure stage2) */
  blend: number;
  /** Gain applied to shaped noise samples before clipping to Int16 range */
  gain: number;
  /** Volume applied to ambient during *silence* periods (0–1 fraction of gain) */
  silenceVol: number;
  /** Volume applied to ambient when *mixed under TTS speech* (0–1) */
  speechVol: number;
}

export const TRACK_PARAMS: Record<string, TrackParams> = {
  "office-ambience":   { alpha: 0.86, alpha2: 0.50, blend: 0.3, gain: 3800, silenceVol: 0.22, speechVol: 0.10 },
  "cafe":              { alpha: 0.68, alpha2: 0.40, blend: 0.4, gain: 4800, silenceVol: 0.28, speechVol: 0.12 },
  "coffee-shop":       { alpha: 0.70, alpha2: 0.42, blend: 0.4, gain: 4500, silenceVol: 0.26, speechVol: 0.11 },
  "convention-hall":   { alpha: 0.93, alpha2: 0.60, blend: 0.2, gain: 3200, silenceVol: 0.18, speechVol: 0.08 },
  "home":              { alpha: 0.90, alpha2: 0.55, blend: 0.2, gain: 2800, silenceVol: 0.15, speechVol: 0.07 },
  "outdoor":           { alpha: 0.55, alpha2: 0.30, blend: 0.5, gain: 5000, silenceVol: 0.30, speechVol: 0.13 },
  "restaurant":        { alpha: 0.72, alpha2: 0.44, blend: 0.4, gain: 5500, silenceVol: 0.32, speechVol: 0.14 },
};

const DEFAULT_PARAMS: TrackParams = TRACK_PARAMS["office-ambience"]!;

// ── PRNG (xorshift32) — deterministic so the loop is reproducible ─────────────

function makeXorshift(seed: number): () => number {
  let s = seed >>> 0 || 0xdeadbeef;
  return (): number => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    return ((s >>> 0) / 0x100000000) * 2 - 1; // float in (-1, 1)
  };
}

// ── Loop generation ──────────────────────────────────────────────────────────

const LOOP_SECONDS = 8;                          // loop duration
const FS           = 8000;                       // samples per second
const LOOP_SAMPLES = LOOP_SECONDS * FS;          // 64 000 samples
const CHUNK_SAMPLES = 160;                       // 20 ms @ 8 kHz (1 mulaw chunk)

function generateLoop(track: string): Int16Array {
  const p    = TRACK_PARAMS[track] ?? DEFAULT_PARAMS;
  const prng = makeXorshift(hashStr(track));
  const out  = new Int16Array(LOOP_SAMPLES);

  let y1 = 0; // IIR stage 1 state
  let y2 = 0; // IIR stage 2 state

  // Brief warm-up to settle the IIR state before recording
  for (let i = 0; i < 400; i++) {
    const x = prng();
    y1 = p.alpha * y1 + (1 - p.alpha) * x;
    y2 = p.alpha2 * y2 + (1 - p.alpha2) * x;
  }

  for (let i = 0; i < LOOP_SAMPLES; i++) {
    const x = prng();
    y1 = p.alpha  * y1 + (1 - p.alpha)  * x;
    y2 = p.alpha2 * y2 + (1 - p.alpha2) * x;
    const shaped = y1 * (1 - p.blend) + y2 * p.blend;
    const s = Math.round(shaped * p.gain);
    out[i] = Math.max(-32767, Math.min(32767, s));
  }

  return out;
}

function hashStr(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h;
}

// ── AmbientNoiseStream ────────────────────────────────────────────────────────

export class AmbientNoiseStream {
  private readonly loop: Int16Array;
  private readonly silenceVol: number;
  private readonly speechVol: number;
  private pos = 0;

  constructor(track: string) {
    const key = Object.keys(TRACK_PARAMS).find(k => k === track) ?? "office-ambience";
    const p   = TRACK_PARAMS[key] ?? DEFAULT_PARAMS;
    this.loop       = generateLoop(key);
    this.silenceVol = p.silenceVol;
    this.speechVol  = p.speechVol;
  }

  /**
   * Returns the next 160-sample (20 ms) chunk as a mulaw Buffer, suitable for
   * direct dispatch to onAudioOut during silence periods.
   */
  nextMulawChunk(): Buffer {
    const pcm = this.readPcm(CHUNK_SAMPLES, this.silenceVol);
    return pcmToMulaw(pcm);
  }

  /**
   * Mixes ambient noise under a TTS mulaw chunk at speech-level volume.
   * Decodes the TTS chunk to PCM16, adds scaled ambient, re-encodes to mulaw.
   */
  mixIntoMulaw(ttsMulaw: Buffer): Buffer {
    const ttsLen     = ttsMulaw.length;           // 160 bytes = 160 mulaw samples
    const ambientPcm = this.readPcm(ttsLen, this.speechVol);

    const mixed = Buffer.allocUnsafe(ttsLen * 2); // PCM16 = 2 bytes per sample
    for (let i = 0; i < ttsLen; i++) {
      const ttsSample     = mulawToLinear(ttsMulaw[i]!);
      const ambientSample = ambientPcm.readInt16LE(i * 2);
      const sum           = Math.max(-32767, Math.min(32767, ttsSample + ambientSample));
      mixed.writeInt16LE(sum, i * 2);
    }
    return pcmToMulaw(mixed);
  }

  private readPcm(numSamples: number, vol: number): Buffer {
    const buf = Buffer.allocUnsafe(numSamples * 2);
    for (let i = 0; i < numSamples; i++) {
      const sample = Math.round(this.loop[this.pos]! * vol);
      buf.writeInt16LE(Math.max(-32767, Math.min(32767, sample)), i * 2);
      this.pos = (this.pos + 1) % LOOP_SAMPLES;
    }
    return buf;
  }
}

// ── FileAmbientNoiseStream — uploaded PCM from GCS ────────────────────────────

const SILENCE_VOL = 0.22;
const SPEECH_VOL  = 0.10;

export class FileAmbientNoiseStream {
  private readonly loop: Int16Array;
  private pos = 0;
  private readonly loopSamples: number;

  constructor(pcmBuffer: Buffer) {
    // The PCM buffer is raw s16le 8 kHz mono — convert to Int16Array
    const samples = pcmBuffer.length / 2;
    this.loopSamples = samples;
    this.loop = new Int16Array(samples);
    for (let i = 0; i < samples; i++) {
      this.loop[i] = pcmBuffer.readInt16LE(i * 2);
    }
  }

  nextMulawChunk(): Buffer {
    const pcm = this.readPcm(CHUNK_SAMPLES, SILENCE_VOL);
    return pcmToMulaw(pcm);
  }

  mixIntoMulaw(ttsMulaw: Buffer): Buffer {
    const ttsLen     = ttsMulaw.length;
    const ambientPcm = this.readPcm(ttsLen, SPEECH_VOL);

    const mixed = Buffer.allocUnsafe(ttsLen * 2);
    for (let i = 0; i < ttsLen; i++) {
      const ttsSample     = mulawToLinear(ttsMulaw[i]!);
      const ambientSample = ambientPcm.readInt16LE(i * 2);
      const sum           = Math.max(-32767, Math.min(32767, ttsSample + ambientSample));
      mixed.writeInt16LE(sum, i * 2);
    }
    return pcmToMulaw(mixed);
  }

  private readPcm(numSamples: number, vol: number): Buffer {
    if (this.loopSamples === 0) return Buffer.alloc(numSamples * 2);
    const buf = Buffer.allocUnsafe(numSamples * 2);
    for (let i = 0; i < numSamples; i++) {
      const sample = Math.round(this.loop[this.pos]! * vol);
      buf.writeInt16LE(Math.max(-32767, Math.min(32767, sample)), i * 2);
      this.pos = (this.pos + 1) % this.loopSamples;
    }
    return buf;
  }
}

// ── GCS PCM cache ─────────────────────────────────────────────────────────────

const SIDECAR = "http://127.0.0.1:1106";

/* eslint-disable @typescript-eslint/no-explicit-any */
function makeGcsClient(): Storage {
  return new Storage({
    credentials: {
      audience: "replit",
      subject_token_type: "access_token",
      token_url: `${SIDECAR}/token`,
      type: "external_account",
      credential_source: {
        url: `${SIDECAR}/credential`,
        format: { type: "json", subject_token_field_name: "access_token" },
      },
      universe_domain: "googleapis.com",
    } as any,
    projectId: "",
  });
}

/** In-memory cache: id → PCM Buffer.  Keyed by ambient sound UUID. */
const pcmCache = new Map<string, Buffer>();

/**
 * Download the pre-converted PCM loop for an uploaded ambient sound from GCS.
 * Results are cached in-process for the lifetime of the server process.
 * Call invalidatePcmCache(id) when a sound is deleted.
 */
export async function loadPcmLoop(id: string): Promise<Buffer> {
  const cached = pcmCache.get(id);
  if (cached) return cached;

  const bucketId = process.env["DEFAULT_OBJECT_STORAGE_BUCKET_ID"];
  if (!bucketId) throw new Error("DEFAULT_OBJECT_STORAGE_BUCKET_ID not set");

  const pcmKey = `ambient-sounds/${id}/loop.pcm`;
  logger.info({ id, pcmKey }, "ambient: loading PCM loop from GCS");

  const [data] = await makeGcsClient().bucket(bucketId).file(pcmKey).download();
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as Uint8Array);
  pcmCache.set(id, buf);
  logger.info({ id, bytes: buf.length }, "ambient: PCM loop loaded and cached");
  return buf;
}

/** Remove a cached PCM buffer when the corresponding sound is deleted. */
export function invalidatePcmCache(id: string): void {
  pcmCache.delete(id);
}

// ── Local PCM→mulaw (avoids circular import with audio.ts) ───────────────────

function pcmToMulaw(pcm: Buffer): Buffer {
  const out = Buffer.allocUnsafe(pcm.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = linearToMulaw(pcm.readInt16LE(i * 2));
  }
  return out;
}
