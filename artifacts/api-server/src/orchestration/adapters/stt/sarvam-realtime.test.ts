import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildRealtimeConfigUpdate,
  buildRealtimeWsUrl,
  clipRealtimePrompt,
  buildSarvamTerminologyPrompt,
  isLidDriftFinal,
  isSarvamRealtimeModel,
  nextRealtimeLanguageOnSwitch,
  parseRealtimeDetectedLang,
  resolveRealtimeVadDefaults,
  REALTIME_LANGUAGE_CODES,
  resolveRealtimeFinalText,
  resolveRealtimeSocketLanguage,
  resolveRealtimeStreamType,
  shouldBargeOnRealtimeVadStart,
  shouldBargeOnRealtimePartial,
  shouldCommitStreamingEnergyBarge,
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
  it("always pins the configured STT language — never auto, never confidence", () => {
    expect(resolveRealtimeSocketLanguage("hi-IN", false)).toBe("hi-IN");
    expect(resolveRealtimeSocketLanguage("ta-IN", undefined)).toBe("ta-IN");
    expect(resolveRealtimeSocketLanguage("ta-IN", true)).toBe("ta-IN");
    expect(resolveRealtimeSocketLanguage("hi-IN", true)).toBe("hi-IN");
    expect(resolveRealtimeSocketLanguage("en-IN", true)).toBe("en-IN");
    expect(resolveRealtimeSocketLanguage(undefined, false)).toBe("en-IN");
  });
});

describe("nextRealtimeLanguageOnSwitch", () => {
  it("does not pin an auto socket on passive LID (call 13919)", () => {
    expect(nextRealtimeLanguageOnSwitch("auto", "hi-IN")).toBe("auto");
    expect(nextRealtimeLanguageOnSwitch("auto", "kn-IN")).toBe("auto");
    expect(nextRealtimeLanguageOnSwitch("auto", "en-IN", false)).toBe("auto");
  });

  it("pins on an explicit language request (call 20094 Hindi latch)", () => {
    expect(nextRealtimeLanguageOnSwitch("auto", "hi-IN", true)).toBe("hi-IN");
    expect(nextRealtimeLanguageOnSwitch("auto", "ta-IN", true)).toBe("ta-IN");
    expect(nextRealtimeLanguageOnSwitch("hi-IN", "en-IN", true)).toBe("en-IN");
  });

  it("keeps a pinned socket on that pin unless the caller asked (call 26703)", () => {
    expect(nextRealtimeLanguageOnSwitch("hi-IN", "ta-IN")).toBe("hi-IN");
    expect(nextRealtimeLanguageOnSwitch("ta-IN", "en-IN")).toBe("ta-IN");
    expect(nextRealtimeLanguageOnSwitch("en-IN", "od-IN")).toBe("en-IN");
  });
});

describe("resolveRealtimeVadDefaults", () => {
  it("uses the telephony table on 8 kHz PSTN so sidetone does not become VAD (call 26668)", () => {
    expect(resolveRealtimeVadDefaults(8000)).toEqual({
      silenceDurationMs: 500,
      minSpeechDurationMs: 200,
      threshold: 0.7,
    });
  });

  it("uses the cleaner-channel table on 16 kHz WebRTC", () => {
    expect(resolveRealtimeVadDefaults(16000)).toEqual({
      silenceDurationMs: 500,
      minSpeechDurationMs: 250,
      threshold: 0.3,
    });
  });
});

describe("Sarvam realtime mid-call socket close", () => {
  it("reconnects the Saaras socket instead of hanging up the PSTN call", () => {
    const src = readFileSync(new URL("./sarvam-realtime.ts", import.meta.url), "utf8");
    expect(src).toContain("scheduleReconnect");
    expect(src).toContain("do not hang up the PSTN call");
    expect(src).toContain("MAX_RECONNECT = 10");
  });
});

describe("isLidDriftFinal", () => {
  it("never retargets the socket from LID confidence", () => {
    expect(isLidDriftFinal({ primaryLanguage: "ta-IN", detectedLanguage: "en-IN", languageConfidence: 0.23 })).toBe(false);
    expect(isLidDriftFinal({ primaryLanguage: "ta-IN", detectedLanguage: "en-IN", languageConfidence: 0.1 })).toBe(false);
    expect(isLidDriftFinal({ primaryLanguage: "hi-IN", detectedLanguage: "en-IN", languageConfidence: 0.2 })).toBe(false);
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
  it.each(["saaras:v4", "saaras:v4-realtime"])("honors configured %s instead of silently downgrading", (model) => {
    const url = new URL(buildRealtimeWsUrl({ model, languageCode: "hi-IN", sampleRate: 8000, mode: "transcribe" }));
    expect(url.searchParams.get("model")).toBe("saaras:v4-realtime");
  });

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
    expect(url).toContain("return_timestamps=true");
    expect(url).not.toContain("high_vad_sensitivity");
    expect(url).not.toContain("prefix_padding_ms");
  });

  it("omits VAD millisecond overlays when unset so Saaras stands alone", () => {
    const url = buildRealtimeWsUrl({
      languageCode: "auto",
      sampleRate: 8000,
      mode: "transcribe",
    });
    expect(url).not.toContain("silence_duration_ms");
    expect(url).not.toContain("min_speech_duration_ms");
    expect(url).not.toContain("threshold");
    expect(url).not.toContain("prefix_padding_ms");
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

describe("buildSarvamTerminologyPrompt", () => {
  it("includes only agent keyterms, not another industry's defaults", () => {
    const prompt = buildSarvamTerminologyPrompt(["TraviYo"], "GSTIN");
    expect(prompt).not.toMatch(/B2B/);
    expect(prompt).not.toMatch(/CRM/);
    expect(buildSarvamTerminologyPrompt(undefined)).toBeUndefined();
    expect(prompt).toMatch(/TraviYo/);
    expect(prompt).toMatch(/GSTIN/);
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

  it("never interrupts from bare speech_start without a usable STT partial", () => {
    expect(shouldBargeOnRealtimeVadStart(base)).toBe(false);
    expect(shouldBargeOnRealtimeVadStart({ ...base, isWebcall: true, hasUsablePartial: false })).toBe(false);
    expect(shouldBargeOnRealtimeVadStart({ ...base, hasUsablePartial: true })).toBe(true);
  });

  it("blocks greeting and echo-grace unless the caller already hard-interrupted", () => {
    expect(shouldBargeOnRealtimeVadStart({ ...base, hasUsablePartial: true, greetingOrSystem: true })).toBe(false);
    expect(shouldBargeOnRealtimeVadStart({ ...base, hasUsablePartial: true, inEchoGrace: true })).toBe(false);
    expect(shouldBargeOnRealtimeVadStart({
      ...base,
      hasUsablePartial: true,
      greetingOrSystem: true,
      isHardInterrupt: true,
    })).toBe(true);
    expect(shouldBargeOnRealtimeVadStart({
      ...base,
      hasUsablePartial: true,
      inEchoGrace: true,
      isHardInterrupt: true,
    })).toBe(true);
  });
});

describe("shouldBargeOnRealtimePartial", () => {
  const base = {
    greetingOrSystem: false,
    inEchoGrace: false,
    isWebcall: false,
    echoBarReady: true,
    energyAboveEchoBar: true,
    charCount: 22,
    minChars: 4,
  };

  it("blocks greeting and echo-grace partials unless the caller hard-interrupted", () => {
    expect(shouldBargeOnRealtimePartial({ ...base, greetingOrSystem: true })).toBe(false);
    expect(shouldBargeOnRealtimePartial({ ...base, inEchoGrace: true })).toBe(false);
    expect(shouldBargeOnRealtimePartial({ ...base, charCount: 3, minChars: 4 })).toBe(true);
    expect(shouldBargeOnRealtimePartial({
      ...base,
      charCount: 5,
      minChars: 4,
      isGreetingOnly: true,
    })).toBe(true);
    expect(shouldBargeOnRealtimePartial({
      ...base,
      greetingOrSystem: true,
      isHardInterrupt: true,
    })).toBe(true);
    expect(shouldBargeOnRealtimePartial({
      ...base,
      inEchoGrace: true,
      isHardInterrupt: true,
    })).toBe(true);
  });

  it("cuts a non-echo partial without extra energy gates", () => {
    expect(shouldBargeOnRealtimePartial({
      ...base,
      echoBarReady: false,
      energyAboveEchoBar: false,
    })).toBe(true);
    expect(shouldBargeOnRealtimePartial({
      ...base,
      echoBarReady: true,
      energyAboveEchoBar: false,
    })).toBe(true);
  });

  it("does not barge empty partials", () => {
    expect(shouldBargeOnRealtimePartial({ ...base, charCount: 0, minChars: 4 })).toBe(false);
  });

  it("barges a real caller partial on PSTN and webcall", () => {
    expect(shouldBargeOnRealtimePartial(base)).toBe(true);
    expect(shouldBargeOnRealtimePartial({ ...base, isHardInterrupt: true })).toBe(true);
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

describe("shouldCommitStreamingEnergyBarge", () => {
  const base = {
    hasUsablePending: true,
    isHardInterrupt: true,
    isBookingAnswer: false,
    echoBarReady: true,
    energyAboveEchoBar: true,
  };

  it("commits when STT already has pending text", () => {
    expect(shouldCommitStreamingEnergyBarge({ ...base, isHardInterrupt: false })).toBe(true);
    expect(shouldCommitStreamingEnergyBarge({ ...base, hasUsablePending: false })).toBe(false);
  });

  it("cuts on stop/wait when energy is above the echo bar", () => {
    expect(shouldCommitStreamingEnergyBarge(base)).toBe(true);
  });

  it("still cuts a booking slot when energy never cleared the echo bar", () => {
    expect(shouldCommitStreamingEnergyBarge({
      ...base,
      isBookingAnswer: true,
      energyAboveEchoBar: false,
    })).toBe(true);
  });
});
