import { describe, expect, it } from "vitest";
import {
  buildRealtimeConfigUpdate,
  buildRealtimeWsUrl,
  clipRealtimePrompt,
  isLidDriftFinal,
  isSarvamRealtimeModel,
  nextRealtimeLanguageOnSwitch,
  parseRealtimeDetectedLang,
  REALTIME_LANGUAGE_CODES,
  resolveRealtimeFinalText,
  resolveRealtimeSocketLanguage,
  resolveRealtimeStreamType,
  shouldBargeOnRealtimeVadStart,
  shouldBargeOnRealtimePartial,
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

describe("resolveRealtimeSocketLanguage", () => {
  it("pins the agent language when auto-detect is off (short turns need it)", () => {
    expect(resolveRealtimeSocketLanguage("hi-IN", false)).toBe("hi-IN");
    expect(resolveRealtimeSocketLanguage("ta-IN", undefined)).toBe("ta-IN");
    expect(resolveRealtimeSocketLanguage(undefined, false)).toBe("en-IN");
  });

  it("opens with auto LID only when auto-detect is on", () => {
    expect(resolveRealtimeSocketLanguage("hi-IN", true)).toBe("auto");
    expect(resolveRealtimeSocketLanguage("ta-IN", true)).toBe("auto");
  });
});

describe("nextRealtimeLanguageOnSwitch", () => {
  it("does not pin an auto socket to hi-IN mid-call", () => {
    expect(nextRealtimeLanguageOnSwitch("auto", "hi-IN")).toBe("auto");
    expect(nextRealtimeLanguageOnSwitch("auto", "en-IN")).toBe("auto");
  });

  it("still maps a pinned socket to a realtime code", () => {
    expect(nextRealtimeLanguageOnSwitch("hi-IN", "ta-IN")).toBe("ta-IN");
    expect(nextRealtimeLanguageOnSwitch("en-IN", "od-IN")).toBe("or-IN");
  });
});

describe("isLidDriftFinal", () => {
  const tamil = { primaryLanguage: "ta-IN" };

  it("flags a low-confidence English read on a Tamil agent (call 13919)", () => {
    expect(isLidDriftFinal({ ...tamil, detectedLanguage: "en-IN", languageConfidence: 0.23 })).toBe(true);
    expect(isLidDriftFinal({ ...tamil, detectedLanguage: "en-IN", languageConfidence: 0.1 })).toBe(true);
  });

  it("trusts a confident English read — that is a real English caller", () => {
    expect(isLidDriftFinal({ ...tamil, detectedLanguage: "en-IN", languageConfidence: 0.88 })).toBe(false);
    expect(isLidDriftFinal({ ...tamil, detectedLanguage: "en-IN", languageConfidence: undefined })).toBe(false);
  });

  it("never fires for an English or unpinnable agent language", () => {
    expect(isLidDriftFinal({ primaryLanguage: "en-IN", detectedLanguage: "en-IN", languageConfidence: 0.1 })).toBe(false);
    expect(isLidDriftFinal({ primaryLanguage: "auto", detectedLanguage: "en-IN", languageConfidence: 0.1 })).toBe(false);
  });

  it("ignores non-English detections and missing LID", () => {
    expect(isLidDriftFinal({ ...tamil, detectedLanguage: "hi-IN", languageConfidence: 0.2 })).toBe(false);
    expect(isLidDriftFinal({ ...tamil, detectedLanguage: undefined, languageConfidence: 0.2 })).toBe(false);
  });
});

describe("resolveRealtimeFinalText", () => {
  it("keeps a real final", () => {
    expect(resolveRealtimeFinalText("करंट प्राइस।", "करंट प्राइस")).toBe("करंट प्राइस।");
  });

  it("recovers the last partial when the final is empty", () => {
    expect(resolveRealtimeFinalText("", "API integration")).toBe("API integration");
    expect(resolveRealtimeFinalText("   ", "  current price ")).toBe("current price");
  });

  it("returns empty when both are empty", () => {
    expect(resolveRealtimeFinalText("", "")).toBe("");
  });
});

describe("toRealtimeLanguageCode", () => {
  it("maps auto-detect and unknown", () => {
    expect(toRealtimeLanguageCode("ta-IN", true)).toBe("auto");
    expect(toRealtimeLanguageCode("unknown", false)).toBe("auto");
  });

  it("maps legacy Odia od-IN to or-IN", () => {
    expect(toRealtimeLanguageCode("od-IN", false)).toBe("or-IN");
    expect(parseRealtimeDetectedLang("od-IN")).toBe("or-IN");
  });

  it("maps Nepali ne-NP to ne-IN", () => {
    expect(toRealtimeLanguageCode("ne-NP", false)).toBe("ne-IN");
    expect(parseRealtimeDetectedLang("ne-NP")).toBe("ne-IN");
  });

  it("accepts all 24 realtime language_code values", () => {
    expect(REALTIME_LANGUAGE_CODES).toHaveLength(24);
    expect(REALTIME_LANGUAGE_CODES).toContain("auto");
    expect(REALTIME_LANGUAGE_CODES).toContain("or-IN");
    expect(REALTIME_LANGUAGE_CODES).not.toContain("od-IN");
    for (const code of REALTIME_LANGUAGE_CODES) {
      if (code === "auto") continue;
      expect(toRealtimeLanguageCode(code, false)).toBe(code);
    }
  });

  it("maps scheduled-language bare prefixes", () => {
    expect(toRealtimeLanguageCode("kok", false)).toBe("kok-IN");
    expect(toRealtimeLanguageCode("sat", false)).toBe("sat-IN");
    expect(toRealtimeLanguageCode("mni", false)).toBe("mni-IN");
    expect(toRealtimeLanguageCode("doi", false)).toBe("doi-IN");
  });

  it("keeps Tamil / Hindi BCP-47", () => {
    expect(toRealtimeLanguageCode("ta-IN", false)).toBe("ta-IN");
    expect(toRealtimeLanguageCode("hi", false)).toBe("hi-IN");
  });

  it("does not invent a language when LID is absent", () => {
    expect(parseRealtimeDetectedLang(undefined)).toBeUndefined();
    expect(parseRealtimeDetectedLang("xx-XX")).toBeUndefined();
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
    expect(url).toContain("threshold=0.3");
    expect(url).toContain("prefix_padding_ms=300");
    expect(url).toContain("return_timestamps=true");
    expect(url).not.toContain("high_vad_sensitivity");
  });

  it("adds a terminology prompt and never sends a bogus sample rate", () => {
    const url = buildRealtimeWsUrl({
      languageCode: "hi-IN",
      sampleRate: 8000,
      mode: "transcribe",
      silenceDurationMs: 500,
      minSpeechDurationMs: 250,
      threshold: 0.3,
      prompt: "UPI GSTIN",
    });
    expect(url).toContain("prompt=UPI+GSTIN");
    expect(url).toContain("sample_rate=8000");
  });

  it("honours balanced stream_type", () => {
    const url = buildRealtimeWsUrl({
      languageCode: "en-IN",
      sampleRate: 16000,
      mode: "codemix",
      streamType: "balanced",
      silenceDurationMs: 500,
      minSpeechDurationMs: 250,
      threshold: 0.3,
    });
    expect(url).toContain("stream_type=balanced");
  });
});

describe("clipRealtimePrompt", () => {
  it("drops empty and caps at 500", () => {
    expect(clipRealtimePrompt("  ")).toBeUndefined();
    expect(clipRealtimePrompt("ok")).toBe("ok");
    expect(clipRealtimePrompt("x".repeat(600))?.length).toBe(500);
  });
});

describe("resolveRealtimeStreamType", () => {
  it("defaults voice agents to fast", () => {
    expect(resolveRealtimeStreamType(undefined)).toBe("fast");
    expect(resolveRealtimeStreamType("nope")).toBe("fast");
  });

  it("accepts balanced and simulated", () => {
    expect(resolveRealtimeStreamType("balanced")).toBe("balanced");
    expect(resolveRealtimeStreamType("simulated")).toBe("simulated");
    expect(resolveRealtimeStreamType("fast")).toBe("fast");
  });
});

  it("sends silence_duration_ms for mid-call VAD stretch", () => {
    const body = buildRealtimeConfigUpdate({ silenceDurationMs: 700 });
    expect(body).toEqual({
      event: "config.update",
      silence_duration_ms: 700,
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

  it("does not barge on webcall VAD without a usable caller partial", () => {
    expect(shouldBargeOnRealtimeVadStart({ ...base, isWebcall: true })).toBe(false);
  });

  it("barges on webcall VAD when a usable caller partial is present", () => {
    expect(shouldBargeOnRealtimeVadStart({ ...base, isWebcall: true, hasUsablePartial: true })).toBe(true);
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

describe("shouldBargeOnRealtimePartial", () => {
  const base = {
    greetingOrSystem: false,
    inEchoGrace: false,
    isWebcall: false,
    isSelfEcho: false,
    echoBarReady: true,
    energyAboveEchoBar: true,
    charCount: 22,
    minChars: 4,
  };

  it("does not barge greeting echo even when the partial looks like English (call 14227)", () => {
    expect(shouldBargeOnRealtimePartial({ ...base, greetingOrSystem: true })).toBe(false);
    expect(shouldBargeOnRealtimePartial({ ...base, inEchoGrace: true })).toBe(false);
  });

  it("barges a real PSTN talk-over after greeting even if the echo floor is still cold (call 14251)", () => {
    expect(shouldBargeOnRealtimePartial({
      ...base,
      echoBarReady: false,
      energyAboveEchoBar: false,
    })).toBe(true);
  });

  it("does not barge a warm-floor PSTN partial that never rose above the echo bar", () => {
    expect(shouldBargeOnRealtimePartial({
      ...base,
      echoBarReady: true,
      energyAboveEchoBar: false,
    })).toBe(false);
  });

  it("does not barge self-echo or short scraps", () => {
    expect(shouldBargeOnRealtimePartial({ ...base, isSelfEcho: true })).toBe(false);
    expect(shouldBargeOnRealtimePartial({ ...base, charCount: 3, minChars: 4 })).toBe(false);
  });

  it("does not barge an isolated hello while the agent is speaking (call 16832)", () => {
    expect(shouldBargeOnRealtimePartial({
      ...base,
      charCount: 5,
      minChars: 4,
      isGreetingOnly: true,
    })).toBe(false);
  });

  it("barges a real PSTN talk-over once energy is above the echo bar", () => {
    expect(shouldBargeOnRealtimePartial(base)).toBe(true);
  });

  it("barges webcall partials after greeting (browser AEC)", () => {
    expect(shouldBargeOnRealtimePartial({
      ...base,
      isWebcall: true,
      echoBarReady: false,
      energyAboveEchoBar: false,
    })).toBe(true);
  });
});
