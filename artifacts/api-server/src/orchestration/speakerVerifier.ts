/**
 * Speaker verifier — mid-call voice biometric hand-off detection (anti-impersonation).
 *
 * Opt-in, warning-only sidecar that mirrors the gender-detector lifecycle so it
 * adds ZERO latency to the live call:
 *
 *   - addSpeechChunk(pcm8k) — accumulates *qualified* caller audio (energy-gated,
 *     O(1), byte-capped ring buffer). Called on every caller frame, same entry
 *     points as the gender detector.
 *   - runDetection()        — call after each user turn ends (fire-and-forget).
 *
 * Two phases:
 *   1. ENROLLING — collect ~ENROLL_SECONDS of qualified speech, then POST it to
 *      the gender-service /speaker/embed endpoint and cache the returned 192-dim
 *      ECAPA embedding in memory as THIS call's reference voiceprint.
 *   2. VERIFYING — every ~WINDOW_SECONDS of new qualified speech, POST the window
 *      plus the cached reference to /speaker/verify and read back a cosine
 *      similarity. A *sustained* drop (consecutive lows OR rolling average below
 *      a conservative threshold) raises a single, cooled-down `onMismatch` event.
 *
 * Guarantees (by design — never break or slow a live call):
 *   - Never throws (everything wrapped); never awaited by the audio path.
 *   - One request in flight at a time (inFlight guard); skips while busy.
 *   - The reference is fixed at enrollment — it is NEVER adapted toward later
 *     audio, so an impostor cannot "drift" the reference onto themselves.
 *   - Warning-only: it emits a callback; it never changes call control.
 */

import { logger as rootLogger } from "../lib/logger.js";

const SAMPLE_RATE  = 8_000;
const BITS         = 16;
const CHANNELS     = 1;
const SAMPLE_BYTES = BITS / 8;

const _num = (name: string, dflt: number): number => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : dflt;
};

/** Seconds of qualified speech to collect before computing the reference voiceprint. */
const ENROLL_SECONDS = _num("SPEAKER_VERIFY_ENROLL_SECONDS", 8);
/** Seconds of qualified speech per verification window. */
const WINDOW_SECONDS = _num("SPEAKER_VERIFY_WINDOW_SECONDS", 8);

const ENROLL_BYTES = Math.round(ENROLL_SECONDS * SAMPLE_RATE * SAMPLE_BYTES);
const WINDOW_BYTES = Math.round(WINDOW_SECONDS * SAMPLE_RATE * SAMPLE_BYTES);
/** Hard cap on the buffer so a stalled runDetection can never grow memory unbounded. */
const MAX_BUFFER_BYTES = Math.max(ENROLL_BYTES, WINDOW_BYTES) * 2;

/**
 * Conservative cosine-similarity threshold. ECAPA at 8 kHz telephony compresses
 * scores; same-speaker windows (vs this call's own enrollment) sit well above
 * this, a different person drops below. Warning-only, so a slightly-off value
 * only changes sensitivity — it never breaks a call. Env-overridable for tuning.
 */
const THRESHOLD = (() => {
  const v = Number(process.env["SPEAKER_VERIFY_THRESHOLD"]);
  return Number.isFinite(v) && v > 0 && v < 1 ? v : 0.5;
})();

/** Consecutive low windows required to raise a mismatch. Default 1 = one bad window triggers;
 *  raise via SPEAKER_VERIFY_MIN_CONSECUTIVE env var for extra conservatism. */
const MIN_CONSECUTIVE_LOW = Math.round(_num("SPEAKER_VERIFY_MIN_CONSECUTIVE", 1));
/** Minimum gap between repeat mismatch alerts on the same call (anti-spam). */
const COOLDOWN_MS = _num("SPEAKER_VERIFY_COOLDOWN_MS", 45_000);

/**
 * Per-chunk speech-energy gate (mean |sample| on the int16 scale). Frames below
 * this are treated as silence and not buffered, so each window represents actual
 * speech and enrollment quality stays high. Kept low to avoid dropping soft speech.
 */
const ENERGY_GATE = _num("SPEAKER_VERIFY_ENERGY_GATE", 250);

const _SPEAKER_SERVICE_BASE = (process.env["GENDER_SERVICE_URL"] ?? "http://localhost:5000").replace(/\/+$/, "");
const SPEAKER_EMBED_URL  = `${_SPEAKER_SERVICE_BASE}/voice-analysis/speaker/embed`;
const SPEAKER_VERIFY_URL = `${_SPEAKER_SERVICE_BASE}/voice-analysis/speaker/verify`;

// ── WAV builder (8 kHz mono 16-bit, identical to the gender detector) ─────────

function buildWav(pcmData: Buffer): Buffer {
  const dataLen  = pcmData.byteLength;
  const byteRate = SAMPLE_RATE * CHANNELS * SAMPLE_BYTES;
  const hdr      = Buffer.alloc(44);
  hdr.write("RIFF", 0, "ascii");
  hdr.writeUInt32LE(36 + dataLen, 4);
  hdr.write("WAVE", 8, "ascii");
  hdr.write("fmt ", 12, "ascii");
  hdr.writeUInt32LE(16, 16);
  hdr.writeUInt16LE(1, 20); // PCM
  hdr.writeUInt16LE(CHANNELS, 22);
  hdr.writeUInt32LE(SAMPLE_RATE, 24);
  hdr.writeUInt32LE(byteRate, 28);
  hdr.writeUInt16LE(CHANNELS * SAMPLE_BYTES, 32);
  hdr.writeUInt16LE(BITS, 34);
  hdr.write("data", 36, "ascii");
  hdr.writeUInt32LE(dataLen, 40);
  return Buffer.concat([hdr, pcmData]);
}

/** Mean absolute amplitude of an 8 kHz PCM16-LE chunk (cheap speech-presence proxy). */
function chunkEnergy(pcm8k: Buffer): number {
  const n = pcm8k.byteLength >> 1;
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i + 1 < pcm8k.byteLength; i += 2) {
    const s = pcm8k.readInt16LE(i);
    sum += s < 0 ? -s : s;
  }
  return sum / n;
}

export interface SpeakerMismatchInfo {
  similarity: number;
  rollingAverage: number;
  threshold: number;
  /** 1-based index of the verification window that triggered the alert. */
  window: number;
  consecutiveLow: number;
}

export interface SpeakerVerifierOpts {
  /** Raised (at most once per cooldown) when a sustained voice mismatch is detected. */
  onMismatch: (info: SpeakerMismatchInfo) => void;
  /** Optional: notified once the reference voiceprint is enrolled. */
  onEnrolled?: () => void;
  log?: typeof rootLogger;
}

type Phase = "enrolling" | "verifying";

export class SpeakerVerifier {
  /** True once the reference voiceprint has been computed for this call. */
  enrolled = false;
  /** Last cosine similarity observed (for diagnostics), null until first verify. */
  lastSimilarity: number | null = null;

  private phase: Phase = "enrolling";
  private reference: number[] | null = null;

  private chunks: Buffer[] = [];
  private accumulated = 0;
  private inFlight = false;

  private windowCount = 0;
  private firstVerifyEvaluated = false;
  private recentScores: number[] = [];
  private consecutiveLow = 0;
  private lastFlagAt = 0;

  private readonly callId: number;
  private readonly onMismatch: SpeakerVerifierOpts["onMismatch"];
  private readonly onEnrolled?: SpeakerVerifierOpts["onEnrolled"];
  private readonly log: typeof rootLogger;

  constructor(callId: number, opts: SpeakerVerifierOpts) {
    this.callId = callId;
    this.onMismatch = opts.onMismatch;
    this.onEnrolled = opts.onEnrolled;
    this.log = opts.log ?? rootLogger;
  }

  /**
   * Feed a chunk of caller audio (PCM 8 kHz 16-bit LE mono). O(1): energy-gated,
   * appended, and the buffer is byte-capped (oldest dropped) so it can never grow
   * unbounded even if runDetection() is never called. Detection itself is only
   * triggered by runDetection(), never here.
   */
  addSpeechChunk(pcm8k: Buffer): void {
    try {
      if (pcm8k.byteLength === 0) return;
      if (chunkEnergy(pcm8k) < ENERGY_GATE) return; // skip silence — keeps windows speech-dense
      this.chunks.push(pcm8k);
      this.accumulated += pcm8k.byteLength;
      // Ring-buffer cap: drop oldest chunks once over the hard limit.
      while (this.accumulated > MAX_BUFFER_BYTES && this.chunks.length > 1) {
        const dropped = this.chunks.shift();
        if (dropped) this.accumulated -= dropped.byteLength;
      }
    } catch {
      // never throw from the audio path
    }
  }

  /**
   * Trigger an enrollment or verification attempt (fire-and-forget). Call after
   * each user speech turn ends. No-op while a request is in flight or until
   * enough qualified speech has accumulated for the current phase.
   */
  runDetection(): void {
    try {
      if (this.inFlight) return;
      const need = this.phase === "enrolling" ? ENROLL_BYTES : WINDOW_BYTES;
      if (this.accumulated < need) return;

      // Capture the buffered audio with an O(1) reference swap and reset so the
      // next window collects fresh audio while this one is processed. Snapshot the
      // phase too, so it can't change between scheduling and execution.
      const chunksSnapshot = this.chunks;
      const phase = this.phase;
      this.chunks = [];
      this.accumulated = 0;
      this.inFlight = true;

      // Defer ALL heavy work (Buffer.concat, WAV/FormData build, fetch) to a later
      // event-loop tick. runDetection() runs on the live turn path, so it must add
      // zero CPU here — only the cheap guards above run synchronously.
      setImmediate(() => {
        let work: Promise<void>;
        try {
          const pcm = Buffer.concat(chunksSnapshot);
          work = phase === "enrolling" ? this._enroll(pcm) : this._verify(pcm);
        } catch (err) {
          this.inFlight = false;
          this.log.warn({ callId: this.callId, err }, "SpeakerVerifier background prep threw");
          return;
        }
        work
          .catch((err) => this.log.warn({ callId: this.callId, err }, "SpeakerVerifier runDetection rejected unexpectedly"))
          .finally(() => { this.inFlight = false; });
      });
    } catch (err) {
      this.inFlight = false;
      this.log.warn({ callId: this.callId, err }, "SpeakerVerifier runDetection threw synchronously");
    }
  }

  private async _enroll(pcm: Buffer): Promise<void> {
    try {
      const wavBuf = buildWav(pcm);
      const ab     = wavBuf.buffer.slice(wavBuf.byteOffset, wavBuf.byteOffset + wavBuf.byteLength) as ArrayBuffer;
      const form   = new FormData();
      form.append("file", new Blob([ab], { type: "audio/wav" }), "enroll.wav");

      const res = await fetch(SPEAKER_EMBED_URL, { method: "POST", body: form, signal: AbortSignal.timeout(30_000) });
      if (!res.ok) {
        this.log.warn({ callId: this.callId, status: res.status }, "Speaker embed service returned non-200 — will retry next window");
        return;
      }
      const json = await res.json() as { embedding: number[] | null; dim?: number; error?: string };
      if (!json.embedding || json.embedding.length === 0) {
        this.log.info({ callId: this.callId, error: json.error ?? null }, "Speaker enrollment produced no embedding — will retry next window");
        return;
      }
      this.reference = json.embedding;
      this.enrolled = true;
      this.phase = "verifying";
      this.log.info(
        { callId: this.callId, dim: json.embedding.length, bytes: pcm.byteLength, threshold: THRESHOLD },
        "Speaker verification: reference voiceprint enrolled — now monitoring for hand-offs",
      );
      try { this.onEnrolled?.(); } catch { /* ignore callback errors */ }
    } catch (err) {
      this.log.warn({ callId: this.callId, err }, "Speaker enrollment request failed — will retry next window");
    }
  }

  private async _verify(pcm: Buffer): Promise<void> {
    if (!this.reference) return;
    try {
      const wavBuf = buildWav(pcm);
      const ab     = wavBuf.buffer.slice(wavBuf.byteOffset, wavBuf.byteOffset + wavBuf.byteLength) as ArrayBuffer;
      const form   = new FormData();
      form.append("file", new Blob([ab], { type: "audio/wav" }), "verify.wav");
      form.append("reference_embedding", JSON.stringify(this.reference));

      const res = await fetch(SPEAKER_VERIFY_URL, { method: "POST", body: form, signal: AbortSignal.timeout(30_000) });
      if (!res.ok) {
        this.log.warn({ callId: this.callId, status: res.status }, "Speaker verify service returned non-200 — skipping this window");
        return;
      }
      const json = await res.json() as { similarity: number | null; error?: string };
      if (json.similarity === null || json.similarity === undefined || !Number.isFinite(json.similarity)) {
        this.log.info({ callId: this.callId, error: json.error ?? null }, "Speaker verify produced no similarity — skipping this window");
        return;
      }

      const sim = json.similarity;
      this.lastSimilarity = sim;
      this.windowCount += 1;

      // Ignore the very first verification window after enrollment — the reference
      // is fresh and a single early window is the most false-positive-prone. Crucially
      // this baseline must NOT pollute the rolling average or consecutive-low count,
      // so bail out before mutating any scoring state.
      if (!this.firstVerifyEvaluated) {
        this.firstVerifyEvaluated = true;
        this.log.info(
          { callId: this.callId, similarity: Number(sim.toFixed(4)), window: this.windowCount },
          "Speaker verification: baseline window (not evaluated for mismatch)",
        );
        return;
      }

      this.recentScores.push(sim);
      if (this.recentScores.length > 3) this.recentScores.shift();
      const rollingAverage = this.recentScores.reduce((a, b) => a + b, 0) / this.recentScores.length;

      const isLow = sim < THRESHOLD;
      this.consecutiveLow = isLow ? this.consecutiveLow + 1 : 0;

      this.log.info(
        { callId: this.callId, similarity: Number(sim.toFixed(4)), rollingAverage: Number(rollingAverage.toFixed(4)), threshold: THRESHOLD, consecutiveLow: this.consecutiveLow, window: this.windowCount },
        "Speaker verification window evaluated",
      );

      const sustained =
        this.consecutiveLow >= MIN_CONSECUTIVE_LOW ||
        (this.recentScores.length >= 3 && rollingAverage < THRESHOLD);
      if (!sustained) return;

      const now = Date.now();
      if (now - this.lastFlagAt < COOLDOWN_MS) return; // anti-spam cooldown
      this.lastFlagAt = now;

      this.log.warn(
        { callId: this.callId, similarity: Number(sim.toFixed(4)), rollingAverage: Number(rollingAverage.toFixed(4)), threshold: THRESHOLD, consecutiveLow: this.consecutiveLow, window: this.windowCount },
        "Speaker verification: possible voice hand-off detected (warning only — call continues)",
      );
      try {
        this.onMismatch({
          similarity: Number(sim.toFixed(4)),
          rollingAverage: Number(rollingAverage.toFixed(4)),
          threshold: THRESHOLD,
          window: this.windowCount,
          consecutiveLow: this.consecutiveLow,
        });
      } catch (err) {
        this.log.warn({ callId: this.callId, err }, "SpeakerVerifier onMismatch callback threw");
      }
    } catch (err) {
      this.log.warn({ callId: this.callId, err }, "Speaker verify request failed — skipping this window");
    }
  }
}
