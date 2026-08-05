import { describe, expect, it } from "vitest";
import { classifyCallPlanPrompt } from "./call-plan-vibe.js";

describe("classifyCallPlanPrompt", () => {
  it("maps sheet + drip language", () => {
    const d = classifyCallPlanPrompt("Call my Google Sheet leads and drip new rows");
    expect(d.leadSource).toBe("sheet");
    expect(d.templateId).toBe("sheet_live");
    expect(d.sheetRunMode).toBe("live");
  });

  it("maps no-answer retry to lead follow-up", () => {
    const d = classifyCallPlanPrompt("If no answer WhatsApp then call again tomorrow");
    expect(d.templateId).toBe("lead_followup");
  });

  it("maps website form leads", () => {
    const d = classifyCallPlanPrompt("Website form leads — call then follow up");
    expect(d.leadSource).toBe("website");
    expect(d.templateId).toBe("form_followup");
  });

  it("maps callback rescue", () => {
    const d = classifyCallPlanPrompt("Schedule a callback if they miss");
    expect(d.templateId).toBe("callback_rescue");
  });
});
