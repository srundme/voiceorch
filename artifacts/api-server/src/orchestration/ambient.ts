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

import { linearToMulaw, mulawToLinear, upsample8to16 } from "./audio.js";
import { Storage } from "@google-cloud/storage";
import { db, ambientSoundsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { spawn } from "child_process";
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

// Every ambient loop (built-in *and* uploaded) is normalised to this RMS at
// construction time so that the silence/speech volume multipliers below produce
// a consistent, audible background regardless of a track's filter shaping or an
// uploaded file's native level. ~5000 RMS ≈ -16 dBFS; with SILENCE_VOL the
// silence-period ambient lands around -27 dBFS and the speech-mixed ambient
// around -33 dBFS — clearly perceptible but well under the agent's voice.
const TARGET_LOOP_RMS = 5000;

// Volume applied to the (normalised) loop. Shared by built-in + uploaded tracks.
const SILENCE_VOL = 0.28; // ambient while the agent is silent  (~-27 dBFS)
const SPEECH_VOL  = 0.14; // ambient mixed under TTS speech      (~-33 dBFS)

/**
 * Scale an Int16 loop in place so its RMS matches `targetRms`, without clipping.
 * If the loudest sample would exceed range after scaling, the scale is capped so
 * peaks stay within ~95% of full scale (the loop may then sit slightly below the
 * target RMS, which is fine — it just avoids introducing distortion).
 */
function normalizeLoopRms(loop: Int16Array, targetRms: number): void {
  if (loop.length === 0) return;
  let sumSq = 0;
  let peak = 1;
  for (let i = 0; i < loop.length; i++) {
    const v = loop[i]!;
    sumSq += v * v;
    const a = Math.abs(v);
    if (a > peak) peak = a;
  }
  const rms = Math.sqrt(sumSq / loop.length);
  if (rms < 1) return; // effectively silent — nothing to normalise
  let scale = targetRms / rms;
  const maxScale = (0.95 * 32767) / peak;
  if (scale > maxScale) scale = maxScale;
  for (let i = 0; i < loop.length; i++) {
    loop[i] = Math.max(-32767, Math.min(32767, Math.round(loop[i]! * scale)));
  }
}

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

  // Equalise the post-filter level so all tracks are audible at the same volume.
  normalizeLoopRms(out, TARGET_LOOP_RMS);

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
    // Loops are RMS-normalised in generateLoop, so a single shared volume pair
    // yields a consistent, audible background across every built-in track.
    this.loop       = generateLoop(key);
    this.silenceVol = SILENCE_VOL;
    this.speechVol  = SPEECH_VOL;
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

  /**
   * Mixes ambient noise under a PCM16/16 kHz speech buffer (the web-call audio
   * format) at speech-level volume.  Ambient is generated at 8 kHz then upsampled
   * to 16 kHz to match the speech sample rate before being summed in.
   */
  mixIntoPcm16k(speechPcm16k: Buffer): Buffer {
    return mixAmbientIntoPcm16k(speechPcm16k, (n) => this.readPcm(n, this.speechVol));
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

/** Shared PCM16/16 kHz ambient mixing helper used by both ambient stream types. */
function mixAmbientIntoPcm16k(
  speechPcm16k: Buffer,
  readAmbient8k: (numSamples8k: number) => Buffer,
): Buffer {
  const samples16k = speechPcm16k.length >> 1;
  const samples8k = Math.ceil(samples16k / 2);
  const ambient8k = readAmbient8k(samples8k);
  const ambient16k = upsample8to16(ambient8k);
  const out = Buffer.allocUnsafe(speechPcm16k.length);
  for (let i = 0; i < samples16k; i++) {
    const speech = speechPcm16k.readInt16LE(i * 2);
    const ambient = i * 2 + 1 < ambient16k.length ? ambient16k.readInt16LE(i * 2) : 0;
    out.writeInt16LE(Math.max(-32767, Math.min(32767, speech + ambient)), i * 2);
  }
  return out;
}

// ── FileAmbientNoiseStream — uploaded PCM from GCS ────────────────────────────
// Shares the equalised SILENCE_VOL / SPEECH_VOL and RMS normalisation used by
// the built-in tracks, so uploaded ambience is audible at the same background
// level regardless of the original file's recording volume.

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
    // Equalise uploaded-file level to match built-in tracks.
    normalizeLoopRms(this.loop, TARGET_LOOP_RMS);
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

  /** See AmbientNoiseStream.mixIntoPcm16k. */
  mixIntoPcm16k(speechPcm16k: Buffer): Buffer {
    return mixAmbientIntoPcm16k(speechPcm16k, (n) => this.readPcm(n, SPEECH_VOL));
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
 *
 * Self-healing: if the `loop.pcm` object is missing or empty (e.g. the upload's
 * background transcode failed, or the sound predates PCM generation), the
 * original file is re-transcoded on demand and the loop is written back to GCS
 * so subsequent calls hit the fast path. Throws (with a logged reason) only when
 * neither the PCM loop nor a usable original can be produced.
 */
export async function loadPcmLoop(id: string): Promise<Buffer> {
  const cached = pcmCache.get(id);
  if (cached) return cached;

  const bucketId = process.env["DEFAULT_OBJECT_STORAGE_BUCKET_ID"];
  if (!bucketId) throw new Error("DEFAULT_OBJECT_STORAGE_BUCKET_ID not set");

  const bucket = makeGcsClient().bucket(bucketId);
  const pcmKey = `ambient-sounds/${id}/loop.pcm`;

  // 1. Fast path — try the pre-converted PCM loop.
  try {
    const [exists] = await bucket.file(pcmKey).exists();
    if (exists) {
      const [data] = await bucket.file(pcmKey).download();
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as Uint8Array);
      if (buf.length >= 2) {
        pcmCache.set(id, buf);
        logger.info({ id, bytes: buf.length }, "ambient: PCM loop loaded and cached");
        return buf;
      }
      logger.warn({ id, pcmKey, bytes: buf.length }, "ambient: PCM loop is empty — regenerating from original");
    } else {
      logger.warn({ id, pcmKey }, "ambient: PCM loop missing in storage — regenerating from original");
    }
  } catch (err) {
    logger.warn({ id, pcmKey, err }, "ambient: PCM loop download failed — attempting regeneration from original");
  }

  // 2. Self-heal — re-transcode from the stored original.
  const buf = await regeneratePcmLoop(id, bucket, pcmKey);
  pcmCache.set(id, buf);
  return buf;
}

/** Re-transcode an uploaded sound's original file into the 8 kHz PCM loop. */
async function regeneratePcmLoop(
  id: string,
  bucket: ReturnType<ReturnType<typeof makeGcsClient>["bucket"]>,
  pcmKey: string,
): Promise<Buffer> {
  const [sound] = await db.select().from(ambientSoundsTable).where(eq(ambientSoundsTable.id, id));
  if (!sound) throw new Error(`ambient: sound ${id} not found in DB — cannot regenerate PCM loop`);

  const originalKey = sound.storageKey;
  const [origExists] = await bucket.file(originalKey).exists();
  if (!origExists) {
    throw new Error(`ambient: original audio missing in storage (${originalKey}) — cannot regenerate PCM loop`);
  }

  logger.info({ id, originalKey }, "ambient: downloading original to regenerate PCM loop");
  const [origData] = await bucket.file(originalKey).download();
  const origBuf = Buffer.isBuffer(origData) ? origData : Buffer.from(origData as Uint8Array);

  const pcmBuf = await transcodeToPcm8k(origBuf);
  if (pcmBuf.length < 2) {
    throw new Error(`ambient: transcode of ${originalKey} produced empty PCM — cannot regenerate PCM loop`);
  }

  // Write the loop back so future calls hit the fast path, and record the key.
  try {
    await bucket.file(pcmKey).save(pcmBuf, { contentType: "audio/pcm" });
    await db.update(ambientSoundsTable).set({ pcmStorageKey: pcmKey }).where(eq(ambientSoundsTable.id, id));
    logger.info({ id, pcmKey, bytes: pcmBuf.length }, "ambient: PCM loop regenerated and persisted to storage");
  } catch (saveErr) {
    // Even if persistence fails, return the freshly transcoded buffer for this call.
    logger.warn({ id, pcmKey, saveErr }, "ambient: regenerated PCM loop but failed to persist — using in-memory copy");
  }
  return pcmBuf;
}

/** Transcode an arbitrary audio file buffer to raw s16le 8 kHz mono PCM via ffmpeg. */
function transcodeToPcm8k(inputBuffer: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", [
      "-i", "pipe:0",
      "-f", "s16le",
      "-ar", "8000",
      "-ac", "1",
      "pipe:1",
    ], { stdio: ["pipe", "pipe", "pipe"] });

    const chunks: Buffer[] = [];
    let settled = false;
    proc.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    proc.on("error", (err) => { if (!settled) { settled = true; reject(err); } });
    proc.on("close", (code: number | null) => {
      if (settled) return;
      settled = true;
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error(`ffmpeg exited with code ${code ?? "null"}`));
    });
    proc.stdin.on("error", () => {});
    try {
      if (proc.stdin.writable) {
        proc.stdin.write(inputBuffer);
        proc.stdin.end();
      }
    } catch {
      /* stdin already closed — close handler resolves/rejects */
    }
  });
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
