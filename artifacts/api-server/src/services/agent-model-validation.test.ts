import { describe, expect, it } from "vitest";
import { unsupportedAgentModel } from "./agent-model-validation.js";

describe("unsupportedAgentModel", () => {
  it("accepts Google models exposed by the current product", () => {
    expect(unsupportedAgentModel("google", "gemini-2.5-flash")).toBeNull();
    expect(unsupportedAgentModel("google", "gemini-2.5-pro")).toBeNull();
    expect(unsupportedAgentModel("google", "gemini-3.1-flash-live-preview")).toBeNull();
  });

  it("rejects retired or unknown Google model ids before call time", () => {
    expect(unsupportedAgentModel("google", "gemini-3.6-flash")).toBe("gemini-3.6-flash");
    expect(unsupportedAgentModel("google", "made-up-model")).toBe("made-up-model");
  });

  it("does not restrict custom models for other providers", () => {
    expect(unsupportedAgentModel("openrouter", "vendor/custom-model")).toBeNull();
  });
});

