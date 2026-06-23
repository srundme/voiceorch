/**
 * Adaptive endpointing — replaces the flat VAD_SILENCE_MS constant with a
 * context-sensitive silence window that adapts to what the caller is saying
 * and what the agent last asked for.
 *
 * Used by both pipeline.ts (batch telephony path) and webcall.ts (browser WS).
 *
 * Priority order (highest wins):
 *  1. Digit-collection context  — agent asked for policy/phone/OTP → wait 800 ms+
 *  2. Partial transcript text   — streaming STT supplied a partial to analyse
 *  3. Audio duration proxy      — batch path: short burst → fast, long → base
 *  4. baseSilenceMs fallback    — agent-configured override or module default
 */

// ── Named threshold constants ─────────────────────────────────────────────────
/** Snappy flush: "yes", "no", ends in "." / "?" */
export const ENDPOINT_FAST_MS        = 150;
/** Neutral baseline — snappier default endpointing window (was 250ms). */
export const ENDPOINT_DEFAULT_MS     = 150;
/** Mid-thought: ends in conjunction / filler word ("and", "so", "um"). */
export const ENDPOINT_LONG_MS        = 600;
/** Digit-collection: caller is reading a policy/phone/OTP number. */
export const ENDPOINT_DIGIT_MS       = 800;
/** Digit-collection AND partial transcript ends in a digit (still reading). */
export const ENDPOINT_DIGIT_TRAIL_MS = 900;

export interface EndpointDecision {
  ms: number;
  /** Short label for the turn_latency log — no PII, no raw text. */
  reason: string;
}

// ── Digit-collection keyword list ─────────────────────────────────────────────
// When the AGENT's last utterance contains any of these phrases, we enter
// digit-collection mode: the silence window is held long so the caller can
// read out a number slowly, pausing between digits.
const DIGIT_KEYWORDS = [
  "policy number", "phone number", "mobile number", "contact number",
  "date of birth", "dob", "otp", "one-time password", "pin", "passcode",
  "id number", "account number", "card number", "aadhaar", "aadhar",
  "reference number", "registration number", "vehicle number", "claim number",
  "zip code", "postal code", "passport number", "license number",
  "membership number", "booking id", "ticket number", "pan number", "gstin",
  "vin number", "vehicle identification", "employee id", "student id",
  "order number", "invoice number", "tracking number", "case number",
  "folio number", "application number",
];

/**
 * Returns true when the agent's last utterance appears to be requesting
 * a number the caller will read digit-by-digit.
 */
export function isDigitCollectionContext(lastAgentText: string): boolean {
  const lower = lastAgentText.toLowerCase();
  for (const kw of DIGIT_KEYWORDS) {
    if (lower.includes(kw)) return true;
  }
  return false;
}

// ── Dangling / mid-utterance words ────────────────────────────────────────────
// If the partial transcript ends with one of these the caller is likely
// mid-sentence — wait longer before flushing to STT.
const DANGLING_WORDS = new Set([
  "and", "so", "but", "or", "my", "the", "a", "an", "its", "it's",
  "to", "of", "in", "for", "with", "um", "uh", "er", "like", "i",
  "because", "if", "when", "while", "as", "then", "also", "well",
  "this", "that", "these", "those", "there", "here",
  "we", "you", "they", "he", "she", "is", "was", "are",
  "were", "will", "would", "can", "could", "should",
  "what", "which", "who", "how", "where",
  "plus", "however", "actually", "basically",
]);

// ── Turn safety-net constants (env-configurable) ──────────────────────────────
// These guard against the "Listening…" hang where streaming STT emits partial
// transcripts (or nothing usable) but never delivers a final, so the turn never
// closes. Two independent timers — see TurnSafetyNet below.
function envInt(name: string, def: number): number {
  const raw = process.env[name];
  if (!raw) return def;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : def;
}
/** Tight timer: partials arriving but no final → force-close using the best partial.
 *  Default 1800 ms — above the adaptive computeEndpointMs ceiling (900 ms), well
 *  below carrier drop. Override with env FORCE_FINALIZE_MS. */
export const FORCE_FINALIZE_MS  = envInt("FORCE_FINALIZE_MS", 1800);
/** Loose backstop: no usable transcript at all since we entered "Listening…" →
 *  recovery reprompt (not a hangup). Override with env STALL_BACKSTOP_MS.
 *  Default lowered from 15 000 ms to 10 000 ms so the first reprompt fires
 *  after ~10 s of silence, giving the caller two clear chances (at ~10 s and
 *  ~20 s) before the call ends. */
export const STALL_BACKSTOP_MS  = envInt("STALL_BACKSTOP_MS", 10000);
/** Max consecutive stall reprompts before ending the call. Override with env
 *  STALL_MAX_REPROMPTS. */
export const STALL_MAX_REPROMPTS = envInt("STALL_MAX_REPROMPTS", 2);

/** Reason a user turn closed — emitted in the turn_latency log line. */
export type TurnCloseReason = "stt_final" | "force_finalized" | "stall_reprompt";

// Language-aware recovery reprompt spoken when the stall backstop fires.
const RECOVERY_REPROMPTS: Record<string, string> = {
  en: "Sorry, I didn't catch that — could you say that again?",
  hi: "माफ़ कीजिए, मैं समझ नहीं पाया — क्या आप दोबारा कह सकते हैं?",
  ta: "மன்னிக்கவும், எனக்கு புரியவில்லை — மீண்டும் சொல்ல முடியுமா?",
  te: "క్షమించండి, నాకు అర్థం కాలేదు — మళ్ళీ చెప్పగలరా?",
  kn: "ಕ್ಷಮಿಸಿ, ನನಗೆ ಅರ್ಥವಾಗಲಿಲ್ಲ — ಇನ್ನೊಮ್ಮೆ ಹೇಳಬಹುದೇ?",
  mr: "माफ करा, मला समजलं नाही — तुम्ही पुन्हा सांगू शकता का?",
  gu: "માફ કરશો, મને સમજાયું નહીં — ફરી કહી શકશો?",
  bn: "দুঃখিত, আমি বুঝতে পারিনি — আবার বলবেন কি?",
  ml: "ക്ഷമിക്കണം, എനിക്ക് മനസ്സിലായില്ല — ഒന്നുകൂടി പറയാമോ?",
};
/** Recovery reprompt text for a BCP-47 / language code (falls back to English). */
export function recoveryReprompt(lang?: string | null): string {
  const prefix = (lang ?? "en").split("-")[0] ?? "en";
  return RECOVERY_REPROMPTS[prefix] ?? RECOVERY_REPROMPTS["en"]!;
}

export interface TurnSafetyNetOpts {
  forceFinalizeMs?: number;
  stallBackstopMs?: number;
  maxReprompts?: number;
  /** Force-close the current turn using the best partial, treated as a real final. */
  onForceFinalize: (transcript: string) => void;
  /** No usable transcript before the backstop expired — speak a reprompt & re-listen. */
  onStallReprompt: () => void;
  /** Reprompts exhausted — end the call via the existing inactivity path. */
  onStallGiveUp: () => void;
}

/**
 * Two-timer turn safety net, shared by pipeline.ts (telephony) and webcall.ts
 * (browser WS) so both paths behave identically.
 *
 *  • FORCE-FINALIZE (tight): armed on the first non-empty partial, reset on each
 *    subsequent partial. If it expires with a non-empty best-partial, the turn is
 *    force-closed using that text. Empty best-partial → no-op (stall handles it).
 *  • STALL BACKSTOP (loose): armed when we enter "Listening…" (beginListening()),
 *    cleared by a real final (onFinal()) or a successful force-finalize. If it
 *    expires with nothing usable, fire a recovery reprompt; after maxReprompts,
 *    give up and end the call.
 *
 * Callers MUST invoke beginListening() on entering listening, onPartial() per
 * interim, onFinal() on a real final, and clear() on barge-in / teardown.
 */
export class TurnSafetyNet {
  private forceTimer: ReturnType<typeof setTimeout> | null = null;
  private stallTimer: ReturnType<typeof setTimeout> | null = null;
  private bestPartial = "";
  private repromptCount = 0;
  private readonly forceMs: number;
  private readonly stallMs: number;
  private readonly maxReprompts: number;

  constructor(private readonly opts: TurnSafetyNetOpts) {
    this.forceMs = opts.forceFinalizeMs ?? FORCE_FINALIZE_MS;
    this.stallMs = opts.stallBackstopMs ?? STALL_BACKSTOP_MS;
    this.maxReprompts = opts.maxReprompts ?? STALL_MAX_REPROMPTS;
  }

  /** Enter "Listening…" — (re)arm the stall backstop. Idempotent per turn. */
  beginListening(): void {
    this.clearTimers();
    this.bestPartial = "";
    this.stallTimer = setTimeout(() => this.onStallExpire(), this.stallMs);
  }

  /** Non-empty interim arrived — track best partial and (re)arm the tight timer. */
  onPartial(text: string): void {
    const t = text.trim();
    if (!t) return;
    this.bestPartial = t;
    if (this.forceTimer) clearTimeout(this.forceTimer);
    this.forceTimer = setTimeout(() => this.onForceExpire(), this.forceMs);
    // A streaming partial means the caller is ACTIVELY speaking — they are not
    // silent. Push the stall backstop forward and reset the accumulated reprompt
    // count so the give-up path can only ever fire on genuine sustained silence,
    // never while a (slow-to-finalize) caller is still talking. Without this, a
    // caller whose STT streams partials but is slow/never emits a final would be
    // treated as silent: reprompts accumulate and the net ends a live call.
    this.repromptCount = 0;
    if (this.stallTimer) clearTimeout(this.stallTimer);
    this.stallTimer = setTimeout(() => this.onStallExpire(), this.stallMs);
  }

  /** Real STT final (or otherwise-usable speech) — clear timers, reset reprompts. */
  onFinal(): void {
    this.clearTimers();
    this.bestPartial = "";
    this.repromptCount = 0;
  }

  /** Barge-in / teardown — clear timers without firing anything. */
  clear(): void {
    this.clearTimers();
    this.bestPartial = "";
    this.repromptCount = 0;
  }

  private onForceExpire(): void {
    this.forceTimer = null;
    const best = this.bestPartial.trim();
    if (!best) return;            // empty → let the stall backstop handle it
    this.clearTimers();
    this.bestPartial = "";
    this.repromptCount = 0;
    this.opts.onForceFinalize(best);
  }

  private onStallExpire(): void {
    this.stallTimer = null;
    this.clearTimers();
    this.bestPartial = "";
    if (this.repromptCount >= this.maxReprompts) {
      this.opts.onStallGiveUp();
    } else {
      this.repromptCount++;
      this.opts.onStallReprompt();
    }
  }

  private clearTimers(): void {
    if (this.forceTimer) { clearTimeout(this.forceTimer); this.forceTimer = null; }
    if (this.stallTimer) { clearTimeout(this.stallTimer); this.stallTimer = null; }
  }
}

// ── Affirmation / clearly-complete single words ───────────────────────────────
const AFFIRMATIONS = new Set([
  "yes", "no", "yeah", "nope", "yep", "yup", "sure", "ok", "okay",
  "correct", "right", "true", "false", "done", "bye", "goodbye",
  "thanks", "thank", "fine", "good", "great", "perfect", "proceed",
  "confirm", "confirmed", "agreed", "understood", "hello", "hi", "hey",
  "alright", "alrighty", "roger", "absolutely", "definitely", "certainly",
  "negative", "affirmative", "stop", "cancel", "continue", "ready",
  "received", "noted",
]);

/**
 * Compute the adaptive silence window (ms) to wait before flushing audio to STT.
 */
export function computeEndpointMs(opts: {
  /** Last agent utterance text — used to detect digit-collection context. */
  lastAgentText: string;
  /**
   * Partial transcript from streaming STT, if any.
   * Pass empty string when unavailable (batch STT path).
   */
  partialTranscript: string;
  /** Approximate speech duration in ms derived from accumulated audio bytes. */
  audioBufferMs: number;
  /** Agent-configured base silence window (user override). */
  baseSilenceMs: number;
}): EndpointDecision {
  const { lastAgentText, partialTranscript, audioBufferMs, baseSilenceMs } = opts;

  // ── 1. Digit-collection context (highest priority) ─────────────────────────
  if (isDigitCollectionContext(lastAgentText)) {
    const partial = partialTranscript.trim();
    if (partial.length > 0 && /\d$/.test(partial)) {
      // Still actively reading digits — extend even further
      return { ms: ENDPOINT_DIGIT_TRAIL_MS, reason: "digit-collection:trailing-digit" };
    }
    return { ms: ENDPOINT_DIGIT_MS, reason: "digit-collection" };
  }

  // ── 2. Partial transcript analysis (streaming STT active) ──────────────────
  const partial = partialTranscript.trim().toLowerCase();
  if (partial.length > 0) {
    // Clearly complete: terminal punctuation added by STT smart_format
    if (/[.?!।]$/.test(partial)) {
      return { ms: ENDPOINT_FAST_MS, reason: "terminal-punctuation" };
    }

    // Single-word affirmation ("yes", "okay", "correct", …)
    if (AFFIRMATIONS.has(partial)) {
      return { ms: ENDPOINT_FAST_MS, reason: "affirmation" };
    }

    // Ends in a dangling/filler word — likely mid-utterance
    const lastWord = partial.split(/\s+/).pop() ?? "";
    if (DANGLING_WORDS.has(lastWord)) {
      return { ms: ENDPOINT_LONG_MS, reason: `dangling:${lastWord}` };
    }

    // Very short partial (1–2 words) with short audio — might still be mid-thought
    const wordCount = partial.split(/\s+/).length;
    if (wordCount <= 2 && audioBufferMs < 800) {
      return { ms: Math.max(baseSilenceMs, ENDPOINT_DEFAULT_MS), reason: "short-partial" };
    }
  }

  // ── 3. Audio duration proxy (batch path — no partial transcript available) ─
  if (partial.length === 0) {
    // Short audio burst: likely a quick single-word answer
    if (audioBufferMs > 0 && audioBufferMs < 600) {
      return { ms: ENDPOINT_FAST_MS, reason: "short-audio" };
    }
  }

  // ── 4. Fallback: agent-configured baseline ─────────────────────────────────
  return { ms: baseSilenceMs, reason: "base" };
}
