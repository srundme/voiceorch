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
 * Time alignment (wall-clock anchored, per-track):
 *   Each track (caller / agent) is laid down on a SHARED timeline anchored to
 *   the first chunk seen on EITHER side (`startMs`). When a chunk arrives we
 *   compute where it belongs on its own track from the elapsed wall-clock time
 *   (`(now - startMs) * sampleRate`); if that position is ahead of what we have
 *   already written for that track, we fill the gap with per-track silence,
 *   then append the chunk. Chunks arriving faster than real time (provider
 *   bursts) simply append contiguously.
 *
 *   This replaces the previous scheme that padded the *opposite* track with
 *   silence on every append. That scheme assumed only one side ever appended
 *   at a time; once both sides capture continuously (the caller is now recorded
 *   even while the agent speaks, so talk-over is preserved) it double-stretched
 *   the timeline and serialized overlapping speech instead of mixing it. The
 *   wall-clock model keeps both tracks on one timeline with no progressive
 *   drift, so overlapping caller/agent speech mixes correctly into L/R.
 *
 * Storing in Postgres (already running in both dev and prod) removes the
 * dependency on Replit Object Storage, which is unavailable in the Railway
 * production deployment.
 */

import { eq } from "drizzle-orm";
import { db, callRecordingsTable } from "@workspace/db";
import { logger } from "../lib/logger.js";

const BYTES_PER_SAMPLE = 2; // LINEAR16

export class RecordingBuffer {
  private readonly sampleRate: number;
  private callerChunks: Buffer[] = [];
  private agentChunks: Buffer[] = [];
  private callerBytes = 0;
  private agentBytes = 0;
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
   * Place a chunk on its track at its real wall-clock position, filling any
   * gap since the last write on THIS track with per-track silence. Returns the
   * new byte length of the track.
   */
  private appendAligned(chunks: Buffer[], writtenBytes: number, pcm: Buffer): number {
    const target = this.timelineBytes(Date.now());
    if (target > writtenBytes) {
      const pad = target - writtenBytes;
      chunks.push(Buffer.alloc(pad));
      writtenBytes += pad;
    }
    chunks.push(pcm);
    return writtenBytes + pcm.length;
  }

  /**
   * Called for every inbound PCM frame from the caller.
   * Captured unconditionally (even while the agent speaks) so talk-over /
   * barge-in / early-reply audio is preserved on the caller channel.
   */
  addCallerChunk(pcm: Buffer): void {
    if (!pcm.length) return;
    this.callerBytes = this.appendAligned(this.callerChunks, this.callerBytes, pcm);
  }

  /** Called for every outbound PCM frame sent to the caller (TTS audio). */
  addAgentChunk(pcm: Buffer): void {
    if (!pcm.length) return;
    this.agentBytes = this.appendAligned(this.agentChunks, this.agentBytes, pcm);
  }

  get hasData(): boolean {
    return this.callerBytes > 0 || this.agentBytes > 0;
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
      const callerPcm = Buffer.concat(this.callerChunks);
      const agentPcm  = Buffer.concat(this.agentChunks);
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
