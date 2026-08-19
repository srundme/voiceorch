import { describe, expect, it } from "vitest";
import {
  buildRealtimeConfigUpdate,
  buildRealtimeWsUrl,
  isSarvamRealtimeModel,
  shouldBargeOnRealtimeVadStart,
  toRealtimeLanguageCode,
} from "./sarvam-realtime.js";

describe("isSarvamRealtimeModel", () => {
  it("never uses realtime for saarika", () => {
    expect(isSarvamRealtimeModel("saarika:v2.5")).toBe(false);
  });

  it("uses realtime for the explicit model id", () => {
    expect(isSarvamRealtimeModel("saaras:v3-realtime")).toBe(true);
  });

  it("uses realtime for saaras:v3 unless disabled", () => {
    const prev = process.env["SARVAM_STT_REALTIME"];
    delete process.env["SARVAM_STT_REALTIME"];
    expect(isSarvamRealtimeModel("saaras:v3")).toBe(true);
    process.env["SARVAM_STT_REALTIME"] = "0";
    expect(isSarvamRealtimeModel("saaras:v3")).toBe(false);
    expect(isSarvamRealtimeModel("saaras:v3-realtime")).toBe(true);
    if (prev === undefined) delete process.env["SARVAM_STT_REALTIME"];
    else process.env["SARVAM_STT_REALTIME"] = prev;
  });
});

describe("toRealtimeLanguageCode", () => {
  it("maps auto-detect and unknown", () => {
    expect(toRealtimeLanguageCode("ta-IN", true)).toBe("auto");
    expect(toRealtimeLanguageCode("unknown", false)).toBe("auto");
  });

  it("maps legacy Odia od-IN to or-IN", () => {
    expect(toRealtimeLanguageCode("od-IN", false)).toBe("or-IN");
  });

  it("keeps Tamil / Hindi BCP-47", () => {
    expect(toRealtimeLanguageCode("ta-IN", false)).toBe("ta-IN");
    expect(toRealtimeLanguageCode("hi", false)).toBe("hi-IN");
  });
});

describe("buildRealtimeWsUrl", () => {
  it("hits the realtime path with millisecond VAD and 8 kHz", () => {
    const url = buildRealtimeWsUrl({
      languageCode: "auto",
      sampleRate: 8000,
      mode: "transcribe",
      silenceDurationMs: 500,
      minSpeechDurationMs: 250,
      threshold: 0.3,
    });
    expect(url).toContain("/speech-to-text-realtime/ws?");
    expect(url).toContain("model=saaras%3Av3-realtime");
    expect(url).toContain("language_code=auto");
    expect(url).toContain("sample_rate=8000");
    expect(url).toContain("stream_type=fast");
    expect(url).toContain("endpointing=vad");
    expect(url).toContain("silence_duration_ms=500");
    expect(url).toContain("min_speech_duration_ms=250");
    expect(url).toContain("encoding=linear16");
    expect(url).not.toContain("high_vad_sensitivity");
  });
});

describe("buildRealtimeConfigUpdate", () => {
  it("sends language and mode without reconnect fields", () => {
    const body = buildRealtimeConfigUpdate({ languageCode: "ta-IN", mode: "transcribe" });
    expect(body).toEqual({
      event: "config.update",
      language_code: "ta-IN",
      mode: "transcribe",
    });
  });
});

describe("shouldBargeOnRealtimeVadStart", () => {
  const base = {
    agentSpeaking: true,
    greetingOrSystem: false,
    inEchoGrace: false,
    isWebcall: false,
    hasUsablePartial: false,
    energyAboveEchoBar: false,
  };

  it("does not barge when the agent is not speaking", () => {
    expect(shouldBargeOnRealtimeVadStart({ ...base, agentSpeaking: false, isWebcall: true })).toBe(false);
  });

  it("barges on webcall VAD alone", () => {
    expect(shouldBargeOnRealtimeVadStart({ ...base, isWebcall: true })).toBe(true);
  });

  it("needs a partial or energy above the echo bar on PSTN", () => {
    expect(shouldBargeOnRealtimeVadStart(base)).toBe(false);
    expect(shouldBargeOnRealtimeVadStart({ ...base, hasUsablePartial: true })).toBe(true);
    expect(shouldBargeOnRealtimeVadStart({ ...base, energyAboveEchoBar: true })).toBe(true);
  });

  it("holds through greeting and echo grace", () => {
    expect(shouldBargeOnRealtimeVadStart({ ...base, isWebcall: true, greetingOrSystem: true })).toBe(false);
    expect(shouldBargeOnRealtimeVadStart({ ...base, isWebcall: true, inEchoGrace: true })).toBe(false);
  });
});
