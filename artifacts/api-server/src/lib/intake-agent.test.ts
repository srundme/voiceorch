import { describe, it, expect } from "vitest";

process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:5432/test";

const {
  INTAKE_GREETING,
  INTAKE_LLM_CATALOG,
  INTAKE_LOCKED_AGENT_CONFIG,
  INTAKE_LOCKED_STACK,
  INTAKE_BACKCHANNEL_FILLERS,
  INTAKE_SPEED,
  INTAKE_SYSTEM_PROMPT,
  INTAKE_TTS_CATALOG,
  applyListedCartesiaVoices,
  buildIntakeSttPrompt,
  buildIntakeSystemPrompt,
  defaultIntakeControls,
  applyAdminHostedStack,
  intakeAgentTools,
  intakeCartesiaVoiceId,
  intakeVoiceLabel,
  INTAKE_CARTESIA_INDIAN_VOICE_ID,
  validateIntakeControls,
} = await import("./intake-agent.js");
import {
  INTAKE_DISPOSITION_SCHEMA,
  INTAKE_WRITE_SCHEMA,
} from "./intake-tool-schemas.js";
import { INTAKE_DISPOSITIONS } from "./intake-dispositions.js";

const base = defaultIntakeControls();

describe("applyAdminHostedStack", () => {
  it("uses Sarvam for speech and the brain, and Cartesia for the voice", () => {
    const agent = {
      asrProvider: "irfan_pod",
      asrModel: "whisper-large-v3-turbo",
      llmProvider: "irfan_pod",
      llmModel: "qwen3-32b-awq",
      ttsProvider: "irfan_pod",
      ttsVoice: "sruthi",
      ttsModel: "qwen3-tts-12hz-1.7b-customvoice",
    };
    applyAdminHostedStack(agent);
    expect(agent).toMatchObject({
      asrProvider: "sarvam",
      asrModel: "saaras:v3",
      llmProvider: "sarvam",
      llmModel: "sarvam-105b-conversations",
      ttsProvider: "cartesia",
      ttsModel: "sonic-3.6",
      ttsVoice: INTAKE_CARTESIA_INDIAN_VOICE_ID,
    });
  });
});

describe("validateIntakeControls", () => {
  it("accepts the default selection", () => {
    const { controls, errors } = validateIntakeControls(base);
    expect(errors).toEqual([]);
    expect(controls).toMatchObject({ llmProvider: "groq", ttsProvider: "sarvam" });
  });

  it("offers the GPU pod plus Groq and Sarvam for the LLM", () => {
    expect(Object.keys(INTAKE_LLM_CATALOG).sort()).toEqual(["groq", "irfan_pod", "sarvam"]);
    const { controls, errors } = validateIntakeControls({ ...base, llmProvider: "openai" });
    expect(controls).toBeNull();
    expect(errors.join(" ")).toContain("groq, sarvam");
  });

  it("rejects a model that belongs to the other LLM provider", () => {
    const { controls, errors } = validateIntakeControls({
      ...base,
      llmProvider: "sarvam",
      llmModel: "llama-3.3-70b-versatile",
    });
    expect(controls).toBeNull();
    expect(errors.join(" ")).toContain("not an available sarvam model");
  });

  it("falls back to the provider's first model when none is named", () => {
    const { controls } = validateIntakeControls({ ...base, llmProvider: "sarvam", llmModel: "" });
    expect(controls?.llmModel).toBe("sarvam-105b-conversations");
  });

  it("offers the GPU pod, Cartesia, and Sarvam for TTS", () => {
    expect(INTAKE_TTS_CATALOG.map((p) => p.value).sort()).toEqual(["cartesia", "irfan_pod", "sarvam"]);
    expect(INTAKE_TTS_CATALOG.find((p) => p.value === "cartesia")?.model).toBe("sonic-3.6");
  });

  it("replaces the Cartesia fallback list with admin-whitelisted voices", () => {
    const listed = [
      { value: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", label: "Listed Indian English" },
      { value: "11111111-2222-3333-4444-555555555555", label: "Listed Support" },
    ];
    const catalog = applyListedCartesiaVoices(INTAKE_TTS_CATALOG, listed);
    expect(catalog.find((p) => p.value === "cartesia")?.voices).toEqual(listed);
    expect(catalog.find((p) => p.value === "sarvam")?.voices).toBe(
      INTAKE_TTS_CATALOG.find((p) => p.value === "sarvam")?.voices,
    );
    expect(applyListedCartesiaVoices(INTAKE_TTS_CATALOG, []).find((p) => p.value === "cartesia")?.voices)
      .toBe(INTAKE_TTS_CATALOG.find((p) => p.value === "cartesia")?.voices);
    expect(intakeVoiceLabel("cartesia", listed[0]!.value, listed)).toBe("Listed Indian English");
  });

  it("offers the same Bulbul v3 and Cartesia voices as the agent builder", () => {
    const sarvam = INTAKE_TTS_CATALOG.find((p) => p.value === "sarvam")!.voices.map((v) => v.value);
    const cartesia = INTAKE_TTS_CATALOG.find((p) => p.value === "cartesia")!.voices.map((v) => v.value);
    expect(sarvam).toEqual(expect.arrayContaining([
      "ritu", "roopa", "rupali", "shubh", "ratan", "manan", "sumit", "aayan",
      "ashutosh", "advait", "tarun", "sunny", "mani", "gokul", "mohit", "rehan",
    ]));
    expect(sarvam).toHaveLength(37);
    expect(cartesia).toEqual(expect.arrayContaining([
      "a8adc74b-c9c1-45e0-aae7-9a60ba64bbee",
      "a0e99841-438c-4a64-b679-ae501e7d6091",
      "f9836c38-f195-45be-b41c-91b82a5d59c8",
    ]));
    expect(validateIntakeControls({ ...base, ttsProvider: "sarvam", ttsVoice: "shubh" }).errors).toEqual([]);
  });

  it("rejects a Sarvam speaker name on Cartesia", () => {
    const { controls, errors } = validateIntakeControls({
      ...base,
      ttsProvider: "cartesia",
      ttsVoice: "ritu",
    });
    expect(controls).toBeNull();
    expect(errors.join(" ")).toContain("voice UUID");
  });

  it("rejects a Cartesia voice id on Sarvam", () => {
    const { controls } = validateIntakeControls({
      ...base,
      ttsProvider: "sarvam",
      ttsVoice: "a8adc74b-c9c1-45e0-aae7-9a60ba64bbee",
    });
    expect(controls).toBeNull();
  });

  it("accepts a pasted Cartesia voice UUID that is not in the list", () => {
    const { controls, errors } = validateIntakeControls({
      ...base,
      ttsProvider: "cartesia",
      ttsVoice: "11111111-2222-3333-4444-555555555555",
    });
    expect(errors).toEqual([]);
    expect(controls?.ttsVoice).toBe("11111111-2222-3333-4444-555555555555");
  });

  it("keeps speed inside the supported range", () => {
    expect(validateIntakeControls({ ...base, ttsSpeed: 2.5 }).controls).toBeNull();
    expect(validateIntakeControls({ ...base, ttsSpeed: 0.2 }).controls).toBeNull();
    expect(validateIntakeControls({ ...base, ttsSpeed: INTAKE_SPEED.max }).controls).not.toBeNull();
  });

  it("requires a name", () => {
    expect(validateIntakeControls({ ...base, name: "   " }).controls).toBeNull();
  });

  it("labels voices so the admin list reads as names, not ids", () => {
    expect(intakeVoiceLabel("sarvam", "ritu")).toBe("Ritu (female)");
    expect(intakeVoiceLabel("cartesia", "unknown-id")).toBe("unknown-id");
  });
});

describe("intake agent tool set", () => {
  it("ships match_jobs and end_call — no form tools", () => {
    expect(intakeAgentTools().map((t) => t.type)).toEqual(["match_jobs", "end_call"]);
    const endCall = intakeAgentTools().find((t) => t.type === "end_call");
    expect(endCall).toMatchObject({ type: "end_call" });
    expect(endCall && "goodbyeMessage" in endCall ? endCall.goodbyeMessage : undefined).toBeUndefined();
  });

  it("never exposes the campaign-fixed fields to the model", () => {
    const props = Object.keys(INTAKE_WRITE_SCHEMA.properties);
    expect(props).not.toContain("skillRole");
    expect(props).not.toContain("skill");
    expect(props).not.toContain("industry");
    expect(props).not.toContain("englishCommunication");
    expect(props).toContain("firstName");
    expect(props).toContain("qualification");
    expect(props).toContain("servingNotice");
    expect(props).toContain("wantsWfh");
    expect(props).toContain("pincode");
    expect(props).toContain("lastCompany");
    expect(props).toContain("tenure");
  });

  it("enumerates every disposition id for the outcome tool", () => {
    expect(INTAKE_DISPOSITION_SCHEMA.properties["disposition"]?.enum)
      .toEqual(INTAKE_DISPOSITIONS.map((d) => d.id));
    expect(INTAKE_DISPOSITION_SCHEMA.required).toEqual(["disposition"]);
  });

  it("namespaces follow-up answers so shared field ids stay distinguishable", () => {
    const props = Object.keys(INTAKE_DISPOSITION_SCHEMA.properties);
    expect(props).toContain("busy_call_me_back.callback_date");
    expect(props).toContain("high_salary.expected_salary");
    // `will_relocate` belongs to two outcomes; both have to be addressable.
    expect(props).toContain("non_hiring_zone.will_relocate");
    expect(props).toContain("out_station_candidate.will_relocate");
    expect(props).not.toContain("will_relocate");
  });

  it("never lets the model write gender, phone, or the English rating", () => {
    const props = Object.keys(INTAKE_WRITE_SCHEMA.properties);
    expect(props).not.toContain("gender");
    expect(props).not.toContain("phone");
    expect(props).not.toContain("englishCommunication");
  });
});

describe("intake prompt", () => {
  it("pins the call to English and does not save a form", () => {
    expect(INTAKE_SYSTEM_PROMPT).toContain("Speak only English");
    expect(INTAKE_SYSTEM_PROMPT).toContain("I am filling a form");
    expect(INTAKE_SYSTEM_PROMPT).not.toContain("save_candidate_details");
    expect(INTAKE_SYSTEM_PROMPT).not.toContain("set_disposition");
    expect(INTAKE_SYSTEM_PROMPT).not.toContain("finish_intake");
  });

  it("screens like a Jobshop recruiter, one question at a time", () => {
    expect(INTAKE_SYSTEM_PROMPT).toContain("India's largest BPO recruitment company");
    expect(INTAKE_SYSTEM_PROMPT).toContain("applied for a BPO job on Naukri");
    expect(INTAKE_SYSTEM_PROMPT).toContain("Ask what kind of job they are looking for");
    expect(INTAKE_SYSTEM_PROMPT).toContain("international voice, domestic voice, or non-voice");
    expect(INTAKE_SYSTEM_PROMPT).toContain("face to face in Bangalore");
    expect(INTAKE_SYSTEM_PROMPT).toContain("6-digit pincode");
    expect(INTAKE_SYSTEM_PROMPT).toContain("A finished sentence is the end of a normal answer");
    expect(INTAKE_SYSTEM_PROMPT).not.toContain("Hiring zone is decided from the pincode");
  });

  it("closes non-BPO and outstation calls instead of keeping them", () => {
    expect(INTAKE_SYSTEM_PROMPT).toContain("If they still do not want BPO, close politely and end_call");
    expect(INTAKE_SYSTEM_PROMPT).toContain("If they will not, close politely and end_call");
  });

  it("handles repeat calls and a block request", () => {
    expect(INTAKE_SYSTEM_PROMPT).toContain("Suma, Arbaz, or Riyaz");
    expect(INTAKE_SYSTEM_PROMPT).toContain("9964080000");
    expect(INTAKE_SYSTEM_PROMPT).toContain("Book my Appointment");
  });

  it("bans the per-turn stall that made the agent sound like a machine", () => {
    expect(INTAKE_SYSTEM_PROMPT).toContain("one moment please");
    expect(INTAKE_SYSTEM_PROMPT).toContain("let me note that down");
  });

  it("stops the agent inventing a job", () => {
    expect(INTAKE_SYSTEM_PROMPT).toContain("Never invent a company, a salary, a kilometre figure, or an interview time");
    expect(INTAKE_SYSTEM_PROMPT).toContain("Say their name the way they said it");
    expect(INTAKE_SYSTEM_PROMPT).toContain("call match_jobs");
    expect(INTAKE_SYSTEM_PROMPT).toContain("Speak only those jobs");
  });

  it("does not require an outcome or a saved screen", () => {
    expect(INTAKE_SYSTEM_PROMPT).not.toContain("A call with no outcome is a failed call");
    expect(INTAKE_SYSTEM_PROMPT).not.toContain("save lastCompany and tenure");
  });

  it("closes in words that match this call, not a fixed farewell", () => {
    expect(INTAKE_SYSTEM_PROMPT).toContain("say a short close that matches this call");
    expect(INTAKE_SYSTEM_PROMPT).not.toContain("tell them the team will call back with next steps, thank them");
  });

  it("does not ask gender or an English self-rating", () => {
    expect(INTAKE_SYSTEM_PROMPT).toContain("Never ask their gender");
    expect(INTAKE_SYSTEM_PROMPT).toContain("Decide it from the first name");
    expect(INTAKE_SYSTEM_PROMPT).toContain("Never ask them to rate their English");
    expect(INTAKE_SYSTEM_PROMPT).toContain("Judge it from how they speak on this call");
    expect(INTAKE_SYSTEM_PROMPT).toContain("the outcome is Poor Communication");
  });

  it("reads an education gap from the year of birth", () => {
    expect(INTAKE_SYSTEM_PROMPT).toContain("age at an exam = passing year minus birth year");
    expect(INTAKE_SYSTEM_PROMPT).toContain("Someone born in 2000 finishes 10th in 2015 at 15, in 2016 at 16, or in 2017 at 17");
    expect(INTAKE_SYSTEM_PROMPT).toContain("A 10th year of 2018 or later is a gap");
    expect(INTAKE_SYSTEM_PROMPT).toContain("Born in 2000, that is 2017, 2018, or 2019");
    expect(INTAKE_SYSTEM_PROMPT).toContain("Born in 2000, that is 2020, 2021, or 2022");
    expect(INTAKE_SYSTEM_PROMPT).toContain("12th is two years after 10th");
    expect(INTAKE_SYSTEM_PROMPT).toContain("A diploma is two years after 12th, or three years after 10th");
    expect(INTAKE_SYSTEM_PROMPT).toContain("A degree is three years after 12th");
    expect(INTAKE_SYSTEM_PROMPT).toContain("A postgraduate is two years after the degree");
    expect(INTAKE_SYSTEM_PROMPT).toContain("Age Limit applies only when a job description itself states an age range");
  });

  it("covers shift, salary, notice, and cooling without fake numbers", () => {
    expect(INTAKE_SYSTEM_PROMPT).toContain("five thirty, six thirty, seven thirty, eight thirty");
    expect(INTAKE_SYSTEM_PROMPT).toContain("Never quote a salary you were not given");
    expect(INTAKE_SYSTEM_PROMPT).toContain("thirty-day or ninety-day cooling period");
  });

  it("uses the agent name, never a hardcoded Meera", () => {
    expect(INTAKE_SYSTEM_PROMPT).toContain("{{agent_name}}");
    expect(INTAKE_SYSTEM_PROMPT).not.toContain("Meera");
    expect(INTAKE_GREETING).toContain("{{agent_name}}");
    expect(INTAKE_GREETING).toContain("Jobshop");
    expect(INTAKE_GREETING).toContain("How may I assist you");
    expect(INTAKE_GREETING).not.toContain("Meera");
    expect(INTAKE_GREETING).not.toContain("Could I take your name");
    const spoken = buildIntakeSystemPrompt("Irfan");
    expect(spoken).toContain("You are Irfan");
    expect(spoken).not.toContain("{{agent_name}}");
    expect(spoken).not.toContain("schedule_callback");
  });

  it("redials on a drop and locks Call Engine Balanced turn-taking", () => {
    expect(INTAKE_LOCKED_AGENT_CONFIG.autoRedial.enabled).toBe(true);
    expect(INTAKE_LOCKED_AGENT_CONFIG.wordsForInterruption).toBe(2);
    expect(INTAKE_LOCKED_AGENT_CONFIG.sarvamHighVadSensitivity).toBe(true);
    expect(INTAKE_LOCKED_AGENT_CONFIG.sarvamEndOfSpeechSilenceMs).toBe(400);
    expect(INTAKE_LOCKED_AGENT_CONFIG.semanticTurnStopMs).toBe(1200);
  });

  it("covers reply latency with a single Okay backchannel", () => {
    expect(INTAKE_LOCKED_STACK.backchannelingEnabled).toBe(true);
    expect(INTAKE_LOCKED_STACK.backchannelingFrequency).toBe(1);
    expect(INTAKE_LOCKED_STACK.backchannelPhrases).toBe("Okay.");
    expect([...INTAKE_BACKCHANNEL_FILLERS]).toEqual(["Okay."]);
  });

  it("swaps Western Cartesia voices for Gayathri so English is Indian", () => {
    expect(intakeCartesiaVoiceId("79a125e8-cd45-4c13-8a67-188112f4dd22")).toBe(INTAKE_CARTESIA_INDIAN_VOICE_ID);
    expect(intakeCartesiaVoiceId("")).toBe(INTAKE_CARTESIA_INDIAN_VOICE_ID);
    expect(intakeCartesiaVoiceId("11111111-2222-3333-4444-555555555555"))
      .toBe("11111111-2222-3333-4444-555555555555");
  });

  it("builds the Sarvam STT prompt from voice-process terms, not Executive titles", () => {
    const prompt = buildIntakeSttPrompt();
    expect(prompt.length).toBeGreaterThan(0);
    expect(prompt.length).toBeLessThanOrEqual(500);
    expect(prompt).toMatch(/voice process/i);
    expect(prompt).toMatch(/international voice process/i);
    expect(prompt).toMatch(/Concentrix/);
    expect(prompt).toMatch(/pincode/i);
    expect(prompt).toMatch(/Gmail/);
    expect(prompt).not.toMatch(/vice president/i);
    expect(prompt).not.toMatch(/\bVP\b/);
    expect(prompt).not.toMatch(/Executive —/);
  });

  it("treats VP in the transcript as voice process, not a vice-president job", () => {
    expect(INTAKE_SYSTEM_PROMPT).toContain("If the transcript says VP, vice president, vice-president, vice process, wise process, or wice process, they said \"voice process\"");
    expect(INTAKE_SYSTEM_PROMPT).toContain("Never pitch a VP or senior-management opening");
  });
});
