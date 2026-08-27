/**
 * Ambient noise synthesis and mixing for voice calls.
 *
 * Generates a synthetic looping PCM8k noise buffer tuned to each "environment"
 * track.  No external audio files are required — everything is computed from
 * a seeded PRNG + simple IIR filter shaping at construction time.
 *
 * Also supports file-based ambient tracks loaded from Postgres (FileAmbientNoiseStream).
 * When an ambientNoiseTrack value does NOT match a key in TRACK_PARAMS, it is
 * treated as an uploaded sound ID and loaded from the DB via loadPcmLoop().
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

import { linearToMulaw, mulawToLinear, upsample8to16, telephonyBandpass } from "./audio.js";
import { db, ambientSoundsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { spawn } from "child_process";
import { logger } from "../lib/logger.js";
import { resolveFfmpegPath } from "../lib/ffmpeg.js";

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

// α values are deliberately kept low/mid here: the one-pole IIRs are pure
// low-passes, so high α concentrates energy in the sub-300 Hz range that a
// telephony carrier strips out (~300–3400 Hz passband). Lower α pushes the
// noise up into the band that actually survives a phone call while preserving
// each track's relative character (blend/gain still distinguish them). The
// absolute level no longer depends on these — generateLoop normalises every
// track to a target *in-band* RMS afterwards.
export const TRACK_PARAMS: Record<string, TrackParams> = {
  "office-ambience":   { alpha: 0.62, alpha2: 0.34, blend: 0.3, gain: 3800, silenceVol: 0.22, speechVol: 0.10 },
  "cafe":              { alpha: 0.50, alpha2: 0.28, blend: 0.4, gain: 4800, silenceVol: 0.28, speechVol: 0.12 },
  "coffee-shop":       { alpha: 0.52, alpha2: 0.30, blend: 0.4, gain: 4500, silenceVol: 0.26, speechVol: 0.11 },
  "convention-hall":   { alpha: 0.68, alpha2: 0.42, blend: 0.2, gain: 3200, silenceVol: 0.18, speechVol: 0.08 },
  "home":              { alpha: 0.66, alpha2: 0.40, blend: 0.2, gain: 2800, silenceVol: 0.15, speechVol: 0.07 },
  "outdoor":           { alpha: 0.40, alpha2: 0.22, blend: 0.5, gain: 5000, silenceVol: 0.30, speechVol: 0.13 },
  "restaurant":        { alpha: 0.54, alpha2: 0.30, blend: 0.4, gain: 5500, silenceVol: 0.32, speechVol: 0.14 },
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

// Every ambient loop (built-in *and* uploaded) is normalised so that its energy
// *inside the telephony passband* (300–3400 Hz) — i.e. what actually survives a
// phone carrier — hits this RMS. Normalising on the band-limited signal (rather
// than the broadband loop) is the key fix: previously a bass-heavy loop measured
// loud broadband but arrived near-inaudible on a real handset. ~7500 in-band RMS
// ≈ -13 dBFS; combined with the volumes below the caller hears ambient around
// -18 dBFS during silence and -28 dBFS under speech — clearly present yet well
// under the agent's voice. The level is deliberately on the higher side so the
// bed sits above a mobile carrier's VAD/DTX threshold and is not classified as
// suppressible line noise on a real PSTN/mobile leg.
const TARGET_LOOP_RMS = 7500;

// Volume applied to the (normalised) loop. Shared by built-in + uploaded tracks.
const SILENCE_VOL = 0.55; // ambient while the agent is silent  (~-18 dBFS in-band)
const SPEECH_VOL  = 0.18; // ambient mixed under TTS speech      (~-28 dBFS in-band)

/** The mix levels actually applied, exported so callers can log them per call. */
export const AMBIENT_LEVELS = {
  targetLoopRms: TARGET_LOOP_RMS,
  silenceVol: SILENCE_VOL,
  speechVol: SPEECH_VOL,
} as const;

/**
 * Scale an Int16 loop in place so that its *in-band* (telephony passband,
 * 300–3400 Hz) RMS matches `targetInBandRms`, without clipping the broadband
 * signal.
 *
 * Why in-band rather than broadband: a bass-heavy loop can measure loud on the
 * full-band signal yet have almost no energy in the band a phone carrier passes,
 * so it arrives near-inaudible on a real handset. Measuring the level the caller
 * actually hears (post band-pass) and targeting that makes ambient consistently
 * audible across tracks regardless of their low-frequency content.
 *
 * The scale is capped by the *broadband* peak so peaks stay within ~95% of full
 * scale (the in-band level may then sit slightly below target, which is fine —
 * it just avoids introducing distortion).
 */
function normalizeLoopRms(loop: Int16Array, targetInBandRms: number): void {
  if (loop.length === 0) return;

  // Measure the energy that survives the telephony passband.
  const filtered = telephonyBandpass(loop);
  let inBandSumSq = 0;
  for (let i = 0; i < filtered.length; i++) {
    const v = filtered[i]!;
    inBandSumSq += v * v;
  }
  const inBandRms = Math.sqrt(inBandSumSq / filtered.length);
  if (inBandRms < 1) return; // no usable in-band energy — nothing to normalise

  // Broadband peak bounds the scale so we never clip after scaling.
  let peak = 1;
  for (let i = 0; i < loop.length; i++) {
    const a = Math.abs(loop[i]!);
    if (a > peak) peak = a;
  }
  let scale = targetInBandRms / inBandRms;
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

  // Slow amplitude envelope so the bed has natural movement instead of flat,
  // steady-state hiss. A mobile carrier's VAD/DTX classifies *flat* low-level
  // noise as line noise and suppresses it (comfort-noise / discontinuous
  // transmission), which is why a mathematically-loud-enough but steady bed can
  // still arrive inaudible on a real handset while the agent's voice always
  // passes. A moving, speech-band-active bed reads as activity and survives the
  // carrier. The two LFOs run at whole-cycle-per-loop rates so the 8 s loop
  // stays seamless, and ENV_FLOOR keeps the bed continuously present — it never
  // dips toward silence, which would itself give DTX a gap to latch onto.
  const ENV_FLOOR = 0.6;
  const w1 = (2 * Math.PI * 1) / LOOP_SECONDS; // 1 cycle / loop
  const w2 = (2 * Math.PI * 3) / LOOP_SECONDS; // 3 cycles / loop
  for (let i = 0; i < LOOP_SAMPLES; i++) {
    const x = prng();
    y1 = p.alpha  * y1 + (1 - p.alpha)  * x;
    y2 = p.alpha2 * y2 + (1 - p.alpha2) * x;
    const shaped = y1 * (1 - p.blend) + y2 * p.blend;
    const t   = i / FS;
    const lfo = 0.6 * (0.5 + 0.5 * Math.sin(w1 * t))
              + 0.4 * (0.5 + 0.5 * Math.sin(w2 * t + 1.3));
    const env = ENV_FLOOR + (1 - ENV_FLOOR) * lfo;
    const s = Math.round(shaped * p.gain * env);
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

  /**
   * @param track       Built-in track key or uploaded sound ID.
   * @param volumeScale User-configurable multiplier (0–1, default 1.0).
   *                    Scales both silence and speech mix levels uniformly.
   */
  constructor(track: string, volumeScale = 1.0) {
    const scale = Math.max(0, Math.min(1, volumeScale));
    const key = Object.keys(TRACK_PARAMS).find(k => k === track) ?? "office-ambience";
    // Loops are RMS-normalised in generateLoop, so a single shared volume pair
    // yields a consistent, audible background across every built-in track.
    this.loop       = generateLoop(key);
    this.silenceVol = SILENCE_VOL * scale;
    this.speechVol  = SPEECH_VOL  * scale;
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
   * Returns the next 160-sample (20 ms) chunk as raw 8 kHz LINEAR16 LE PCM,
   * for the silence-fill on raw-PCM (web-call) output. Mirrors nextMulawChunk
   * but skips the mulaw encode so it can be sent straight to a web client.
   */
  nextPcmChunk(): Buffer {
    return this.readPcm(CHUNK_SAMPLES, this.silenceVol);
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

  /** Mix ambient under native 8 kHz TTS (Cartesia telephony) without a 16 kHz round-trip. */
  mixIntoPcm8k(speechPcm8k: Buffer): Buffer {
    return mixAmbientIntoPcm8k(speechPcm8k, (n) => this.readPcm(n, this.speechVol));
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

function mixAmbientIntoPcm8k(
  speechPcm8k: Buffer,
  readAmbient8k: (numSamples8k: number) => Buffer,
): Buffer {
  const samples = speechPcm8k.length >> 1;
  const ambient = readAmbient8k(samples);
  const out = Buffer.allocUnsafe(speechPcm8k.length);
  for (let i = 0; i < samples; i++) {
    const speech = speechPcm8k.readInt16LE(i * 2);
    const amb = ambient.readInt16LE(i * 2);
    out.writeInt16LE(Math.max(-32767, Math.min(32767, speech + amb)), i * 2);
  }
  return out;
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

// ── FileAmbientNoiseStream — uploaded PCM from Postgres ──────────────────────
// Shares the equalised SILENCE_VOL / SPEECH_VOL and RMS normalisation used by
// the built-in tracks, so uploaded ambience is audible at the same background
// level regardless of the original file's recording volume.

export class FileAmbientNoiseStream {
  private readonly loop: Int16Array;
  private pos = 0;
  private readonly loopSamples: number;
  private readonly silenceVol: number;
  private readonly speechVol: number;

  /**
   * @param pcmBuffer   Raw s16le 8 kHz mono PCM from Postgres.
   * @param volumeScale User-configurable multiplier (0–1, default 1.0).
   */
  constructor(pcmBuffer: Buffer, volumeScale = 1.0) {
    const scale = Math.max(0, Math.min(1, volumeScale));
    // The PCM buffer is raw s16le 8 kHz mono — convert to Int16Array
    const samples = pcmBuffer.length / 2;
    this.loopSamples = samples;
    this.loop = new Int16Array(samples);
    for (let i = 0; i < samples; i++) {
      this.loop[i] = pcmBuffer.readInt16LE(i * 2);
    }
    // Equalise uploaded-file level to match built-in tracks.
    normalizeLoopRms(this.loop, TARGET_LOOP_RMS);
    this.silenceVol = SILENCE_VOL * scale;
    this.speechVol  = SPEECH_VOL  * scale;
  }

  nextMulawChunk(): Buffer {
    const pcm = this.readPcm(CHUNK_SAMPLES, this.silenceVol);
    return pcmToMulaw(pcm);
  }

  /** See AmbientNoiseStream.nextPcmChunk — raw 8 kHz PCM silence-fill for web calls. */
  nextPcmChunk(): Buffer {
    return this.readPcm(CHUNK_SAMPLES, this.silenceVol);
  }

  mixIntoMulaw(ttsMulaw: Buffer): Buffer {
    const ttsLen     = ttsMulaw.length;
    const ambientPcm = this.readPcm(ttsLen, this.speechVol);

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
    return mixAmbientIntoPcm16k(speechPcm16k, (n) => this.readPcm(n, this.speechVol));
  }

  /** See AmbientNoiseStream.mixIntoPcm8k. */
  mixIntoPcm8k(speechPcm8k: Buffer): Buffer {
    return mixAmbientIntoPcm8k(speechPcm8k, (n) => this.readPcm(n, this.speechVol));
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

// ── PCM cache (Postgres-backed) ──────────────────────────────────────────────

/** In-memory cache: id → PCM Buffer.  Keyed by ambient sound UUID. */
const pcmCache = new Map<string, Buffer>();

/** Sync peek — returns cached PCM without hitting the DB (call-start ambient). */
export function peekCachedPcmLoop(id: string): Buffer | null {
  const hit = pcmCache.get(id);
  return hit ? Buffer.from(hit) : null;
}

/**
 * Load the pre-converted 8 kHz PCM loop for an uploaded ambient sound from the
 * `ambient_sounds.pcm_data` Postgres column. Results are cached in-process for
 * the lifetime of the server process. Call invalidatePcmCache(id) when a sound
 * is deleted.
 *
 * Self-healing: if the `pcm_data` column is missing or empty (e.g. the upload's
 * background transcode failed, or the sound predates PCM generation), the
 * original audio bytes are re-transcoded on demand and written back to
 * `pcm_data` so subsequent calls hit the fast path. Throws (with a logged
 * reason) only when neither the PCM loop nor a usable original can be produced.
 */
export async function loadPcmLoop(id: string): Promise<Buffer> {
  const cached = pcmCache.get(id);
  if (cached) return cached;

  const [row] = await db
    .select({ pcmData: ambientSoundsTable.pcmData })
    .from(ambientSoundsTable)
    .where(eq(ambientSoundsTable.id, id));
  if (!row) throw new Error(`ambient: sound ${id} not found in DB — cannot load PCM loop`);

  // 1. Fast path — the pre-converted PCM loop already lives in the DB.
  if (row.pcmData && row.pcmData.length >= 2) {
    const buf = Buffer.isBuffer(row.pcmData) ? row.pcmData : Buffer.from(row.pcmData as Uint8Array);
    pcmCache.set(id, buf);
    logger.info({ id, bytes: buf.length }, "ambient: PCM loop loaded and cached");
    return buf;
  }
  logger.warn({ id }, "ambient: PCM loop missing or empty in DB — regenerating from original");

  // 2. Self-heal — re-transcode from the stored original bytes.
  const buf = await regeneratePcmLoop(id);
  pcmCache.set(id, buf);
  return buf;
}

/** Re-transcode an uploaded sound's original bytes into the 8 kHz PCM loop. */
async function regeneratePcmLoop(id: string): Promise<Buffer> {
  const [sound] = await db
    .select({ audioData: ambientSoundsTable.audioData })
    .from(ambientSoundsTable)
    .where(eq(ambientSoundsTable.id, id));
  if (!sound) throw new Error(`ambient: sound ${id} not found in DB — cannot regenerate PCM loop`);
  if (!sound.audioData || sound.audioData.length === 0) {
    throw new Error(`ambient: original audio missing in DB (${id}) — cannot regenerate PCM loop`);
  }

  const origBuf = Buffer.isBuffer(sound.audioData) ? sound.audioData : Buffer.from(sound.audioData as Uint8Array);
  logger.info({ id, bytes: origBuf.length }, "ambient: re-transcoding original to regenerate PCM loop");

  const pcmBuf = await transcodeToPcm8k(origBuf);
  if (pcmBuf.length < 2) {
    throw new Error(`ambient: transcode of ${id} produced empty PCM — cannot regenerate PCM loop`);
  }

  // Write the loop back so future calls hit the fast path.
  try {
    await db.update(ambientSoundsTable).set({ pcmData: pcmBuf }).where(eq(ambientSoundsTable.id, id));
    logger.info({ id, bytes: pcmBuf.length }, "ambient: PCM loop regenerated and persisted to DB");
  } catch (saveErr) {
    // Even if persistence fails, return the freshly transcoded buffer for this call.
    logger.warn({ id, saveErr }, "ambient: regenerated PCM loop but failed to persist — using in-memory copy");
  }
  return pcmBuf;
}

/** Transcode an arbitrary audio file buffer to raw s16le 8 kHz mono PCM via ffmpeg. */
function transcodeToPcm8k(inputBuffer: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const proc = spawn(resolveFfmpegPath(), [
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
