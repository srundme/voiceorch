import { describe, it, expect } from "vitest";
import {
  compactPromptCore,
  compilePromptCore,
  hasPromptCore,
  promptCoreToForm,
  linesToList,
} from "@workspace/db/prompt-core";

describe("prompt core compiler", () => {
  it("returns the legacy systemPrompt unchanged when core is empty", () => {
    const fallback = "You are a helpful AI voice assistant.";
    expect(compilePromptCore({ fallbackPrompt: fallback })).toBe(fallback);
    expect(compilePromptCore({ core: {}, fallbackPrompt: fallback })).toBe(fallback);
    expect(compilePromptCore({ core: { identity: { name: "  " } }, fallbackPrompt: fallback })).toBe(fallback);
    expect(hasPromptCore(null)).toBe(false);
  });

  it("compiles identity, purpose, flow, and behaviour", () => {
    const compiled = compilePromptCore({
      agentName: "Irfan",
      agentLanguage: "en-IN",
      core: {
        identity: { role: "Recruitment consultant", company: "XYZ Staffing", persona: "Warm, concise" },
        callContext: {
          direction: "inbound",
          primaryObjective: "Collect profile and recommend openings.",
        },
        flow: [
          { title: "GREETING", objective: "Identify yourself." },
          { title: "PROFILE", objective: "Collect:\n- name\n- location" },
        ],
        instructions: {
          mustDo: ["Ask one question at a time."],
          mustNotDo: ["Never invent salary."],
        },
      },
      fallbackPrompt: "",
    });
    expect(compiled).toContain("IDENTITY");
    expect(compiled).toContain("Name: Irfan");
    expect(compiled).toContain("Role: Recruitment consultant");
    expect(compiled).toContain("CALL PURPOSE");
    expect(compiled).toContain("inbound");
    expect(compiled).toContain("1. GREETING");
    expect(compiled).toContain("2. PROFILE");
    expect(compiled).toContain("BEHAVIOUR");
    expect(compiled).toContain("Never invent salary.");
    expect(compiled).not.toContain("ADDITIONAL SCRIPT");
  });

  it("appends leftover systemPrompt as ADDITIONAL SCRIPT", () => {
    const compiled = compilePromptCore({
      core: { identity: { name: "Meera", role: "Advisor" } },
      fallbackPrompt: "Always greet in Tamil first.",
    });
    expect(compiled).toContain("Name: Meera");
    expect(compiled).toContain("ADDITIONAL SCRIPT");
    expect(compiled).toContain("Always greet in Tamil first.");
  });

  it("does not duplicate fallback that already matches the compiled core", () => {
    const coreOnly = compilePromptCore({
      core: { identity: { name: "Meera" } },
      fallbackPrompt: "",
    });
    const again = compilePromptCore({
      core: { identity: { name: "Meera" } },
      fallbackPrompt: coreOnly,
    });
    expect(again).toBe(coreOnly);
    expect(again.split("ADDITIONAL SCRIPT").length).toBe(1);
  });

  it("compacts form textareas into instruction lists", () => {
    const core = compactPromptCore({
      mustDo: "- Ask one question\n- Keep answers short\n",
      mustNotDo: "Never invent fees",
      flow: [{ title: "  ", objective: "  " }, { title: "CLOSE", objective: "End politely." }],
    });
    expect(core?.instructions?.mustDo).toEqual(["Ask one question", "Keep answers short"]);
    expect(core?.flow).toEqual([{ title: "CLOSE", objective: "End politely." }]);
    expect(linesToList("- a\n* b")).toEqual(["a", "b"]);
  });

  it("round-trips form hydration", () => {
    const form = promptCoreToForm({
      identity: { name: "Irfan" },
      instructions: { behavioural: ["Handle interruptions naturally."] },
    });
    expect(form.identity?.name).toBe("Irfan");
    expect(form.behavioural).toBe("Handle interruptions naturally.");
    expect(compactPromptCore(form)?.identity?.name).toBe("Irfan");
  });

  it("compiles form-shaped instructions without an instructions object", () => {
    const compiled = compilePromptCore({
      core: {
        identity: { name: "Irfan" },
        mustDo: "Ask one question at a time.",
        behavioural: "Handle interruptions naturally.",
      },
      fallbackPrompt: "",
    });
    expect(compiled).toContain("BEHAVIOUR");
    expect(compiled).toContain("Ask one question at a time.");
    expect(compiled).toContain("Handle interruptions naturally.");
  });
});
