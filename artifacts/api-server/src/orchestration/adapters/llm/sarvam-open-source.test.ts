import { describe, it, expect } from "vitest";
import {
  isSarvamOpenSourceModel,
  normalizeSarvamLlmModel,
  sarvamChatCompletionsUrl,
} from "./sarvam.js";

describe("Sarvam open-source model routing", () => {
  it("normalizes playground / docs aliases to wire ids", () => {
    expect(normalizeSarvamLlmModel("gemma4")).toBe("gemma4");
    expect(normalizeSarvamLlmModel("gemma-4")).toBe("gemma4");
    expect(normalizeSarvamLlmModel("gemma-4-31b")).toBe("gemma4");
    expect(normalizeSarvamLlmModel("glm5.2")).toBe("glm5.2");
    expect(normalizeSarvamLlmModel("glm-5.2")).toBe("glm5.2");
    expect(normalizeSarvamLlmModel("sarvam-30b")).toBe("sarvam-105b");
    expect(normalizeSarvamLlmModel(null)).toBe("sarvam-105b");
  });

  it("routes open-source models to /v2 and Sarvam models to /v1", () => {
    expect(isSarvamOpenSourceModel("gemma4")).toBe(true);
    expect(isSarvamOpenSourceModel("glm5.2")).toBe(true);
    expect(isSarvamOpenSourceModel("sarvam-105b")).toBe(false);

    expect(sarvamChatCompletionsUrl("gemma4")).toBe(
      "https://api.sarvam.ai/v2/chat/completions",
    );
    expect(sarvamChatCompletionsUrl("glm5.2")).toBe(
      "https://api.sarvam.ai/v2/chat/completions",
    );
    expect(sarvamChatCompletionsUrl("sarvam-105b")).toBe(
      "https://api.sarvam.ai/v1/chat/completions",
    );
  });
});
