/**
 * RecordingBuffer — captures caller and agent PCM audio during a call,
 * then encodes a stereo WAV (left = caller, right = agent) and stores the
 * bytes directly in PostgreSQL (the `call_recordings` table).
 *
 * Usage:
 *   const rec = new RecordingBuffer(16000);   // sampleRate in Hz
 *   rec.addCallerChunk(pcm);                  // on every inbound audio frame
 *   rec.addAgentChunk(pcm);                   // on every outbound TTS frame
 *   const url = await rec.finalize(callId);   // at call end → serving URL
 *
 * Time alignment (audio-cursor primary, wall-clock only for genuine gaps):
 *   Each track (caller / agent) is laid down on a SHARED timeline anchored to
 *   the first chunk seen on EITHER side (`startMs`). The PRIMARY cursor for a
 *   track is the count of audio samples already written to it: back-to-back
 *   streamed frames are appended contiguously with ZERO padding, so a
 *   continuous stream produces gap-free samples.
 *
 *   Wall-clock is consulted only in two cases:
 *     1. A track's FIRST chunk — padded so it begins at its real start offset
 *        relative to the call start (keeps caller/agent in the right relative
 *        positions).
 *     2. A GENUINE idle gap — when this track has not been written for longer
 *        than `GAP_RESYNC_MS` (a real conversational pause, not the sub-frame
 *        jitter of a continuous stream), we re-sync it to the shared wall-clock
 *        timeline by inserting silence up to the current timeline position.
 *
 *   This fixes the buzzing / helicopter / fluttering artifact heard on the
 *   agent (TTS) channel. The agent playback loop paces frames with
 *   `await setTimeout(40)` per 40 ms frame, so each iteration takes slightly
 *   MORE than 40 ms wall-clock while carrying exactly 40 ms of audio. The
 *   previous scheme padded every track to the wall-clock position on EVERY
 *   append, so a few ms of silence was injected before nearly every agent
 *   frame — a periodic ~40 ms-cadence silence chop (~10-25 Hz modulation)
 *   audible only in the recording. Aligning to the track's own audio cursor
 *   removes those per-frame gaps; live playback is untouched.
 *
 *   It also avoids the older bug of padding the *opposite* track on every
 *   append (which serialized overlapping speech): silence is only ever added to
 *   the SAME track, and only on a genuine gap, so talk-over still mixes into
 *   L/R and there is no progressive cross-track drift across a long call (each
 *   genuine gap re-anchors the track to wall-clock).
 *
 * Storing in Postgres (already running in both dev and prod) removes the
 * dependency on Replit Object Storage, which is unavailable in the Railway
 * production deployment.
 */

import { eq } from "drizzle-orm";
import { db, callRecordingsTable } from "@workspace/db";
import { logger } from "../lib/logger.js";

const BYTES_PER_SAMPLE = 2; // LINEAR16

/**
 * A write gap on a track longer than this (ms) is treated as a GENUINE
 * conversational pause and re-synced to the shared wall-clock timeline. Shorter
 * gaps are the sub-frame jitter of a continuous 40 ms-frame stream and are
 * appended contiguously (no padding) — this is what removes the per-frame
 * silence chop that buzzed on the agent track. The value is comfortably above
 * the ~40 ms frame cadence (and ordinary event-loop jitter) yet below a real
 * inter-sentence / inter-turn pause.
 */
const GAP_RESYNC_MS = 120;

/** Per-track capture state. */
interface Track {
  chunks: Buffer[];
  /** Audio samples already written to this track, in bytes (the primary cursor). */
  bytes: number;
  /** Wall-clock time of the last write to this track; null until first write. */
  lastWriteMs: number | null;
}

export class RecordingBuffer {
  private readonly sampleRate: number;
  private caller: Track = { chunks: [], bytes: 0, lastWriteMs: null };
  private agent: Track = { chunks: [], bytes: 0, lastWriteMs: null };
  /** Wall-clock anchor for the shared timeline; set by the first chunk seen. */
  private startMs: number | null = null;

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
  }

  /** Byte offset on the shared timeline corresponding to `now`. */
  private timelineBytes(now: number): number {
    if (this.startMs === null) this.startMs = now;
    const samples = Math.round(((now - this.startMs) / 1000) * this.sampleRate);
    return Math.max(0, samples) * BYTES_PER_SAMPLE;
  }

  /**
   * Append a chunk to its track using the track's own audio cursor as the
   * primary position. Silence is inserted ONLY to anchor the track's first
   * chunk to its real start offset, or to re-sync after a genuine idle gap
   * (> {@link GAP_RESYNC_MS}); back-to-back streamed frames are concatenated
   * with zero padding so a continuous stream has no per-frame silence gaps.
   */
  private append(track: Track, pcm: Buffer): void {
    const now = Date.now();
    const target = this.timelineBytes(now); // also seeds startMs on first chunk
    const isFirstWrite = track.lastWriteMs === null;
    const idleMs = isFirstWrite ? Infinity : now - track.lastWriteMs!;

    if ((isFirstWrite || idleMs >= GAP_RESYNC_MS) && target > track.bytes) {
      const pad = target - track.bytes;
      track.chunks.push(Buffer.alloc(pad));
      track.bytes += pad;
    }

    track.chunks.push(pcm);
    track.bytes += pcm.length;
    track.lastWriteMs = now;
  }

  /**
   * Called for every inbound PCM frame from the caller.
   * Captured unconditionally (even while the agent speaks) so talk-over /
   * barge-in / early-reply audio is preserved on the caller channel.
   */
  addCallerChunk(pcm: Buffer): void {
    if (!pcm.length) return;
    this.append(this.caller, pcm);
  }

  /** Called for every outbound PCM frame sent to the caller (TTS audio). */
  addAgentChunk(pcm: Buffer): void {
    if (!pcm.length) return;
    this.append(this.agent, pcm);
  }

  get hasData(): boolean {
    return this.caller.bytes > 0 || this.agent.bytes > 0;
  }

  /**
   * Encodes a stereo WAV from the captured tracks and stores the bytes in the
   * `call_recordings` Postgres table.
   *
   * Returns `{ url, error }`:
   * - On success: `{ url: "/api/storage/recordings/:callId", error: null }`.
   * - When no audio was captured: `{ url: null, error: null }` (nothing to
   *   store — not a failure).
   * - When the DB write throws: `{ url: null, error: <reason> }` so the caller
   *   can persist and surface the failure to the user instead of silently
   *   swallowing it.
   */
  async finalize(callId: number): Promise<RecordingResult> {
    if (!this.hasData) {
      logger.warn({ callId }, "Recording: no audio captured — nothing to store");
      return { url: null, error: null };
    }

    try {
      const callerPcm = Buffer.concat(this.caller.chunks);
      const agentPcm  = Buffer.concat(this.agent.chunks);
      // Tracks may differ in length (e.g. a long agent tail with no caller
      // frames, or vice-versa). Span the longer one; the encoder reads the
      // shorter track as silence past its end.
      const numSamples = Math.max(callerPcm.length, agentPcm.length) >> 1;

      const wav = encodeStereoPcmWav(callerPcm, agentPcm, numSamples, this.sampleRate);

      // Replace any prior recording for this call (idempotent re-finalize).
      await db.delete(callRecordingsTable).where(eq(callRecordingsTable.callId, callId));
      await db.insert(callRecordingsTable).values({
        callId,
        audio: wav,
        contentType: "audio/wav",
        byteSize: wav.length,
        sampleRate: this.sampleRate,
      });

      const url = `/api/storage/recordings/${callId}`;
      logger.info({ callId, bytes: wav.length }, "Recording stored in Postgres");
      return { url, error: null };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.error({ callId, err }, "Recording store failed");
      return { url: null, error };
    }
  }
}

/** Result of {@link RecordingBuffer.finalize}. */
export interface RecordingResult {
  /** Serving URL of the stored recording, or null when none was produced. */
  url: string | null;
  /** Failure reason when recording was attempted but could not be stored. */
  error: string | null;
}

/**
 * Writes a canonical 44-byte RIFF/WAV header followed by interleaved
 * stereo LINEAR16 samples (left = caller, right = agent).
 */
function encodeStereoPcmWav(
  callerPcm: Buffer,
  agentPcm: Buffer,
  numSamples: number,
  sampleRate: number,
): Buffer {
  const channels      = 2;
  const bytesPerSample = 2;
  const dataSize      = numSamples * channels * bytesPerSample;
  const headerSize    = 44;
  const buf           = Buffer.allocUnsafe(headerSize + dataSize);

  // ── RIFF chunk ────────────────────────────────────────────────────────────
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8, "ascii");

  // ── fmt  chunk ────────────────────────────────────────────────────────────
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16);                                    // PCM sub-chunk size
  buf.writeUInt16LE(1, 20);                                     // PCM format
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * channels * bytesPerSample, 28); // byte rate
  buf.writeUInt16LE(channels * bytesPerSample, 32);              // block align
  buf.writeUInt16LE(16, 34);                                    // bits per sample

  // ── data chunk ────────────────────────────────────────────────────────────
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(dataSize, 40);

  // Interleave: [L0, R0, L1, R1, ...]
  let offset = headerSize;
  for (let i = 0; i < numSamples; i++) {
    const byteIdx = i * 2;
    const lSample = byteIdx + 1 < callerPcm.length ? callerPcm.readInt16LE(byteIdx) : 0;
    const rSample = byteIdx + 1 < agentPcm.length  ? agentPcm.readInt16LE(byteIdx)  : 0;
    buf.writeInt16LE(lSample, offset);
    buf.writeInt16LE(rSample, offset + 2);
    offset += 4;
  }

  return buf;
}
