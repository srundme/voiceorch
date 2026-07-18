/**
 * Resolve what we charge for vs raw session wall-clock.
 *
 * Telephony sessions can stay open long after talk ends (VoBiz keepalive
 * silence, silence-watchdog near-misses, hangup never arriving) and then get
 * force-closed at agent `maxDuration` (often 480s). Recording / last media
 * reflect the real conversation; wall-clock does not. Billing must follow
 * conversation time, not idle keepalive.
 */

export interface BillableDurationInput {
  /** Answer → endSession wall-clock seconds (non-negative). */
  wallClockSeconds: number;
  /** Epoch ms when billing clock started (carrier answer / session.startedAt). */
  startedAtMs: number;
  /**
   * Epoch ms of the last meaningful media: caller speech energy/transcript or
   * real TTS audio out (not keepalive zeros). Null when unknown.
   */
  lastMediaAtMs: number | null;
  /**
   * Captured recording timeline length in seconds (caller/agent PCM), when
   * available. Keepalive silence is not recorded, so this tracks talk time.
   */
  recordingSeconds: number | null;
  /**
   * Seconds of post-media grace so a clean hangup a few seconds after the last
   * word is not under-counted. Default 10.
   */
  idleGraceSeconds?: number;
}

/**
 * Billable seconds = min(wall-clock, conversation estimate + grace).
 * Falls back to wall-clock when no media/recording signal exists.
 */
export function resolveBillableDurationSeconds(input: BillableDurationInput): number {
  const wall = Math.max(0, Math.floor(input.wallClockSeconds));
  if (wall === 0) return 0;

  const grace = Math.max(0, Math.floor(input.idleGraceSeconds ?? 10));
  const estimates: number[] = [];

  if (input.lastMediaAtMs != null && input.lastMediaAtMs > 0) {
    const mediaSeconds = Math.floor((input.lastMediaAtMs - input.startedAtMs) / 1000) + grace;
    if (Number.isFinite(mediaSeconds) && mediaSeconds > 0) {
      estimates.push(mediaSeconds);
    }
  }

  if (input.recordingSeconds != null && Number.isFinite(input.recordingSeconds)) {
    const rec = Math.floor(input.recordingSeconds) + grace;
    if (rec > 0) estimates.push(rec);
  }

  if (estimates.length === 0) return wall;

  // Prefer the longer conversation signal (recording can trail media slightly,
  // or vice versa), then never exceed wall-clock.
  const conversationSeconds = Math.max(...estimates);
  return Math.min(wall, Math.max(0, conversationSeconds));
}
