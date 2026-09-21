import { describe, expect, it } from "vitest";
import {
  canaryStagesStillFresh,
  classifyBargeSource,
  HARD_CONDITION_CANARY,
  pcmSnippetB64,
  voiceCanaryAudioDumpEnabled,
  voiceCanaryAudioTtlMs,
  voiceCanaryBaseFields,
  voiceCanaryEnabled,
} from "./voice-canary.js";

describe("voice-canary", () => {
  it("defaults canary logs on; audio dump off and gated by VOICE_CANARY", () => {
    expect(voiceCanaryEnabled({})).toBe(true);
    expect(voiceCanaryEnabled({ VOICE_CANARY: "0" })).toBe(false);
    expect(voiceCanaryAudioDumpEnabled({})).toBe(false);
    expect(voiceCanaryAudioDumpEnabled({ VOICE_CANARY_AUDIO: "1" })).toBe(true);
    expect(voiceCanaryAudioDumpEnabled({ VOICE_CANARY: "0", VOICE_CANARY_AUDIO: "1" })).toBe(false);
  });

  it("caps audio dump TTL", () => {
    expect(voiceCanaryAudioTtlMs({})).toBe(60_000);
    expect(voiceCanaryAudioTtlMs({ VOICE_CANARY_AUDIO_TTL_MS: "5000" })).toBe(5_000);
    expect(voiceCanaryAudioTtlMs({ VOICE_CANARY_AUDIO_TTL_MS: "9999999" })).toBe(300_000);
  });

  it("expires stale stage PCM", () => {
    const stages = {
      capturedAtMs: Date.now() - 120_000,
      rawPcm8k: Buffer.alloc(0),
      postAecPcm8k: Buffer.alloc(0),
      postQuailPcm8k: Buffer.alloc(0),
    };
    expect(canaryStagesStillFresh(stages, Date.now(), { VOICE_CANARY_AUDIO_TTL_MS: "60000" })).toBe(false);
  });

  it("includes reconstructable base fields", () => {
    const base = voiceCanaryBaseFields({
      callId: 42,
      mediaEpoch: 3,
      carrier: "vobiz",
      route: "vobiz-42-1",
    });
    expect(base.voiceCanary).toBe(true);
    expect(base.callId).toBe(42);
    expect(base.mediaEpoch).toBe(3);
    expect(base.carrier).toBe("vobiz");
    expect(base.route).toBe("vobiz-42-1");
    expect(base.wallTsMs).toBeGreaterThan(0);
    expect(BigInt(base.monoTsNs)).toBeGreaterThan(0n);
  });

  it("classifies barge sources", () => {
    expect(classifyBargeSource("stt_partial")).toBe("stt");
    expect(classifyBargeSource("vad_speech_start")).toBe("vad");
    expect(classifyBargeSource("contextual_short_answer")).toBe("context");
    expect(classifyBargeSource("energy")).toBe("energy");
    expect(classifyBargeSource("silero")).toBe("silero");
  });

  it("documents hard-condition canary bars", () => {
    expect(HARD_CONDITION_CANARY.quietRoom.success).toMatch(/regression/i);
    expect(HARD_CONDITION_CANARY.ambientNoise.condition).toBe("shop_ac_fan");
    expect(HARD_CONDITION_CANARY.doubleTalk.condition).toBe("speakerphone_double_talk");
  });

  it("encodes a short PCM snippet", () => {
    const pcm = Buffer.alloc(320, 1);
    const b64 = pcmSnippetB64(pcm, 200);
    expect(Buffer.from(b64, "base64").length).toBe(320);
  });
});
