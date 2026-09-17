import { describe, it, expect } from "vitest";
import {
  INTAKE_GREETING,
  INTAKE_LLM_CATALOG,
  INTAKE_LOCKED_AGENT_CONFIG,
  INTAKE_SPEED,
  INTAKE_SYSTEM_PROMPT,
  INTAKE_TTS_CATALOG,
  buildIntakeSttPrompt,
  buildIntakeSystemPrompt,
  defaultIntakeControls,
  intakeAgentTools,
  intakeVoiceLabel,
  validateIntakeControls,
} from "./intake-agent.js";
import {
  INTAKE_DISPOSITION_SCHEMA,
  INTAKE_WRITE_SCHEMA,
} from "./intake-tool-schemas.js";
import { DISPOSITION_MEANINGS, INTAKE_DISPOSITIONS } from "./intake-dispositions.js";

const base = defaultIntakeControls();

describe("validateIntakeControls", () => {
  it("accepts the default selection", () => {
    const { controls, errors } = validateIntakeControls(base);
    expect(errors).toEqual([]);
    expect(controls).toMatchObject({ llmProvider: "groq", ttsProvider: "sarvam" });
  });

  it("only offers Groq and Sarvam for the LLM", () => {
    expect(Object.keys(INTAKE_LLM_CATALOG).sort()).toEqual(["groq", "sarvam"]);
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

  it("only offers Cartesia and Sarvam for TTS", () => {
    expect(INTAKE_TTS_CATALOG.map((p) => p.value).sort()).toEqual(["cartesia", "sarvam"]);
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
  it("ships the three intake tools plus end_call", () => {
    expect(intakeAgentTools().map((t) => t.type)).toEqual([
      "intake_write",
      "intake_disposition",
      "intake_submit",
      "end_call",
    ]);
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
  it("pins the call to English and names the tools it must use", () => {
    expect(INTAKE_SYSTEM_PROMPT).toContain("Speak only English");
    expect(INTAKE_SYSTEM_PROMPT).toContain("save_candidate_details");
    expect(INTAKE_SYSTEM_PROMPT).toContain("set_disposition");
    expect(INTAKE_SYSTEM_PROMPT).toContain("finish_intake");
  });

  it("tells the agent to converse, not interrogate", () => {
    expect(INTAKE_SYSTEM_PROMPT).toContain("This is a conversation");
    expect(INTAKE_SYSTEM_PROMPT).toContain("Do not recite the list in a fixed order");
    expect(INTAKE_SYSTEM_PROMPT).toContain("Hiring zone is decided from the pincode");
    expect(INTAKE_SYSTEM_PROMPT).not.toContain("Keep every reply under 25 words");
  });

  it("bans the per-turn stall that made the agent sound like a machine", () => {
    expect(INTAKE_SYSTEM_PROMPT).toContain("one moment please");
    expect(INTAKE_SYSTEM_PROMPT).toContain("Never stall");
  });

  it("stops the agent asking for gender, phone, or an English self-rating", () => {
    expect(INTAKE_SYSTEM_PROMPT).toContain("Never ask their gender");
    expect(INTAKE_SYSTEM_PROMPT).toContain("Never ask for their phone number");
    expect(INTAKE_SYSTEM_PROMPT).toContain("Never ask them to rate their English");
  });

  it("stops the agent inventing a returning call or an interview slot", () => {
    expect(INTAKE_SYSTEM_PROMPT).toContain("Do not say you have their details from before");
    expect(INTAKE_SYSTEM_PROMPT).toContain("Never invent an interview date or time");
    expect(INTAKE_SYSTEM_PROMPT).toContain("Say their name the way they said it");
  });

  it("says outcomes are mandatory and can stack", () => {
    expect(INTAKE_SYSTEM_PROMPT).toContain("A candidate can have more than one outcome");
    expect(INTAKE_SYSTEM_PROMPT).toContain("A call with no outcome is a failed call");
  });

  it("explains when each outcome applies, not just its name", () => {
    for (const d of INTAKE_DISPOSITIONS) {
      const meaning = DISPOSITION_MEANINGS[d.id]!;
      expect(INTAKE_SYSTEM_PROMPT).toContain(meaning);
    }
  });

  it("frames the opening as facts to talk through rather than a script", () => {
    expect(INTAKE_SYSTEM_PROMPT).toContain("They are facts, not a script");
    expect(INTAKE_SYSTEM_PROMPT).toContain("Two or three facts per turn");
  });

  it("forbids inventing a job or a salary", () => {
    expect(INTAKE_SYSTEM_PROMPT).toContain("Never state a job, company or salary that the matching tool did not return");
  });

  it("lists every disposition the form supports", () => {
    for (const d of INTAKE_DISPOSITIONS) {
      expect(INTAKE_SYSTEM_PROMPT).toContain(d.id);
    }
  });

  it("uses the agent name, never a hardcoded Meera", () => {
    expect(INTAKE_SYSTEM_PROMPT).toContain("{{agent_name}}");
    expect(INTAKE_SYSTEM_PROMPT).not.toContain("Meera");
    expect(INTAKE_GREETING).toContain("{{agent_name}}");
    expect(INTAKE_GREETING).not.toContain("Meera");
    const spoken = buildIntakeSystemPrompt("Irfan");
    expect(spoken).toContain("You are Irfan");
    expect(spoken).not.toContain("{{agent_name}}");
    expect(spoken).toContain("schedule_callback");
  });

  it("redials on a drop", () => {
    expect(INTAKE_LOCKED_AGENT_CONFIG.autoRedial.enabled).toBe(true);
  });

  it("builds the Sarvam STT prompt from the live JD catalog", () => {
    const prompt = buildIntakeSttPrompt();
    expect(prompt.length).toBeGreaterThan(0);
    expect(prompt.length).toBeLessThanOrEqual(500);
    expect(prompt).toMatch(/Concentrix/);
  });
});
