import { afterEach, describe, expect, it } from "vitest";
import { isVoiceIsolationEnabled, VoiceIsolator, warmVoiceIsolator } from "./voice-isolator.js";

function tone8k(samples = 1600, hz = 440, peak = 8000): Buffer {
  const buf = Buffer.allocUnsafe(samples * 2);
  for (let i = 0; i < samples; i++) {
    const s = Math.round(peak * Math.sin((2 * Math.PI * hz * i) / 8000));
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, s)), i * 2);
  }
  return buf;
}

function rms(buf: Buffer): number {
  if (buf.length < 2) return 0;
  let sum = 0;
  const n = buf.length / 2;
  for (let i = 0; i < n; i++) {
    const s = buf.readInt16LE(i * 2) / 32768;
    sum += s * s;
  }
  return Math.sqrt(sum / n);
}

describe("isVoiceIsolationEnabled", () => {
  it("defaults on", () => {
    expect(isVoiceIsolationEnabled({})).toBe(true);
  });

  it("honors VOICE_ISOLATION=0", () => {
    expect(isVoiceIsolationEnabled({ VOICE_ISOLATION: "0" })).toBe(false);
    expect(isVoiceIsolationEnabled({ VOICE_ISOLATION: "false" })).toBe(false);
  });
});

describe("VoiceIsolator GTCRN", () => {
  afterEach(() => {
    delete process.env["VOICE_ISOLATION"];
  });

  it("keeps a speech-like tone (does not mute the caller)", async () => {
    const ok = await warmVoiceIsolator();
    if (!ok) return; // environment without onnx — skip rather than fail CI
    const iso = new VoiceIsolator("test-tone");
    const out = await iso.process8k(tone8k(3200));
    expect(out).not.toBeNull();
    // First hops include STFT pad; feed a second block so OLA has voice.
    const out2 = await iso.process8k(tone8k(3200));
    const pcm = Buffer.concat([out!.pcm16k, out2!.pcm16k]);
    expect(pcm.length).toBeGreaterThan(1000);
    // Pure tones are not speech — GTCRN may duck them. Just prove we still emit
    // audio rather than muting the caller into digital silence.
    expect(rms(pcm)).toBeGreaterThan(0);
    let peak = 0;
    for (let i = 0; i < pcm.length; i += 2) peak = Math.max(peak, Math.abs(pcm.readInt16LE(i)));
    expect(peak).toBeGreaterThan(50);
  }, 20_000);
});
