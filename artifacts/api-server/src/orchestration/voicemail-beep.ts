/**
 * Answering-machine / voicemail record-beep detector (Goertzel).
 *
 * Carrier VM beeps are typically a short narrowband tone near 1 kHz (sometimes
 * ~900–1100 Hz or ~1400 Hz). We look for strong energy in that band with a
 * high tone-to-broadband ratio so voiced speech does not false-trigger.
 *
 * Feed 20 ms 8 kHz LINEAR16 frames (same as the pipeline / DTMF detector).
 */

const FS = 8000;
const BLOCK_SAMPLES = 160; // 20 ms
/** Common voicemail / answering-machine beep centers (Hz). */
const BEEP_FREQS = [900, 950, 1000, 1050, 1100, 1400] as const;
/** Minimum Goertzel power at the winning beep bin (normalized samples). */
const POWER_THRESH = Number(process.env["VOICEMAIL_BEEP_POWER"] ?? 30);
/** Winning bin power / frame energy — pure tones score ~80, speech ≪ 1. */
const TONE_DOMINANCE = Number(process.env["VOICEMAIL_BEEP_DOMINANCE"] ?? 15);
/** Consecutive 20 ms hits before reporting a beep (~60–100 ms tone). */
const MIN_HIT_FRAMES = Math.max(2, Number(process.env["VOICEMAIL_BEEP_MIN_FRAMES"] ?? 3));

interface GoertzelCoeff {
  coeff: number;
}

function makeCoeff(freq: number): GoertzelCoeff {
  const k = Math.round((BLOCK_SAMPLES * freq) / FS);
  const omega = (2 * Math.PI * k) / BLOCK_SAMPLES;
  return { coeff: 2 * Math.cos(omega) };
}

function goertzelPower(samples: Int16Array, c: GoertzelCoeff): number {
  let s0 = 0, s1 = 0, s2 = 0;
  for (let i = 0; i < samples.length; i++) {
    s0 = (samples[i]! / 32768) + c.coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  return s2 * s2 + s1 * s1 - c.coeff * s1 * s2;
}

function frameEnergy(samples: Int16Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const x = samples[i]! / 32768;
    sum += x * x;
  }
  return sum;
}

export class VoicemailBeepDetector {
  private readonly coeffs = BEEP_FREQS.map(makeCoeff);
  private hitFrames = 0;
  private fired = false;

  /** Reset between calls / phases. */
  reset(): void {
    this.hitFrames = 0;
    this.fired = false;
  }

  /**
   * Feed one 20 ms PCM16-LE chunk. Returns true once on the first confirmed beep
   * (latched — further feeds stay false until reset()).
   */
  feed(pcm8k: Buffer): boolean {
    if (this.fired || pcm8k.length < BLOCK_SAMPLES * 2) return false;

    const samples = new Int16Array(pcm8k.buffer, pcm8k.byteOffset, BLOCK_SAMPLES);
    const energy = frameEnergy(samples);
    if (energy < 1e-4) {
      this.hitFrames = 0;
      return false;
    }

    let best = 0;
    for (const c of this.coeffs) {
      const p = goertzelPower(samples, c);
      if (p > best) best = p;
    }

    const dominant = best >= POWER_THRESH && best / (energy + 1e-12) >= TONE_DOMINANCE;
    if (dominant) {
      this.hitFrames++;
      if (this.hitFrames >= MIN_HIT_FRAMES) {
        this.fired = true;
        return true;
      }
    } else {
      this.hitFrames = 0;
    }
    return false;
  }
}
