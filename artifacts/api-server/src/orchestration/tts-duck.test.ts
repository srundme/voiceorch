import { describe, expect, it } from "vitest";
import {
  TTS_DUCK_DB,
  TTS_DUCK_LINEAR,
  TTS_DUCK_MS,
  applyLinearGainPcm16,
  preferSoftDuckBeforeBarge,
} from "./tts-duck.js";

describe("preferSoftDuckBeforeBarge", () => {
  it("hard-barges clear multi-word STT", () => {
    expect(
      preferSoftDuckBeforeBarge({ trigger: "stt_partial", text: "How many members" }),
    ).toBe("hard_barge");
  });

  it("hard-barges contextual short answers and hard interrupts", () => {
    expect(
      preferSoftDuckBeforeBarge({
        trigger: "word_count",
        text: "Yes",
        shortAnswerAccepted: true,
      }),
    ).toBe("hard_barge");
    expect(
      preferSoftDuckBeforeBarge({ trigger: "stt_partial", text: "stop", hardInterrupt: true }),
    ).toBe("hard_barge");
  });

  it("soft-ducks single-word fragments and VAD starts", () => {
    expect(preferSoftDuckBeforeBarge({ trigger: "word_count", text: "Please" })).toBe("soft_duck");
    expect(preferSoftDuckBeforeBarge({ trigger: "word_count", text: "Hello" })).toBe("soft_duck");
    expect(preferSoftDuckBeforeBarge({ trigger: "vad_speech_start", text: "Hi" })).toBe("soft_duck");
  });
});

describe("applyLinearGainPcm16", () => {
  it("matches −12 dB constants", () => {
    expect(TTS_DUCK_DB).toBe(-12);
    expect(TTS_DUCK_MS).toBe(150);
    expect(TTS_DUCK_LINEAR).toBeCloseTo(0.2512, 3);
  });

  it("attenuates peak amplitude by ~12 dB", () => {
    const pcm = Buffer.alloc(4);
    pcm.writeInt16LE(10000, 0);
    pcm.writeInt16LE(-10000, 2);
    const out = applyLinearGainPcm16(pcm);
    expect(Math.abs(out.readInt16LE(0))).toBeCloseTo(10000 * TTS_DUCK_LINEAR, 0);
    expect(Math.abs(out.readInt16LE(2))).toBeCloseTo(10000 * TTS_DUCK_LINEAR, 0);
  });
});
