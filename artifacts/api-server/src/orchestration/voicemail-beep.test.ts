import { describe, expect, it } from "vitest";
import { VoicemailBeepDetector } from "./voicemail-beep.js";

function toneFrame(freqHz: number, amp = 0.4, fs = 8000, samples = 160): Buffer {
  const buf = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    const s = Math.sin((2 * Math.PI * freqHz * i) / fs) * amp;
    buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(s * 32767))), i * 2);
  }
  return buf;
}

function noiseFrame(amp = 0.15, samples = 160): Buffer {
  const buf = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    const s = (Math.random() * 2 - 1) * amp;
    buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(s * 32767))), i * 2);
  }
  return buf;
}

describe("VoicemailBeepDetector", () => {
  it("fires on a sustained ~1 kHz beep", () => {
    const d = new VoicemailBeepDetector();
    let hit = false;
    for (let i = 0; i < 8; i++) {
      if (d.feed(toneFrame(1000))) hit = true;
    }
    expect(hit).toBe(true);
  });

  it("does not fire on broadband noise", () => {
    const d = new VoicemailBeepDetector();
    let hit = false;
    for (let i = 0; i < 20; i++) {
      if (d.feed(noiseFrame())) hit = true;
    }
    expect(hit).toBe(false);
  });

  it("latches after first beep", () => {
    const d = new VoicemailBeepDetector();
    let count = 0;
    for (let i = 0; i < 12; i++) {
      if (d.feed(toneFrame(1000))) count++;
    }
    expect(count).toBe(1);
  });
});
