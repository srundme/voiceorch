import { describe, it, expect } from "vitest";
import {
  isSarvamOpenSourceModel,
  normalizeSarvamLlmModel,
  sarvamChatCompletionsUrl,
  SarvamLLM,
} from "./sarvam.js";

describe("Sarvam open-source model routing", () => {
  it("normalizes playground / docs aliases to wire ids", () => {
    expect(normalizeSarvamLlmModel("gemma4")).toBe("gemma4");
    expect(normalizeSarvamLlmModel("gemma-4")).toBe("gemma4");
    expect(normalizeSarvamLlmModel("gemma-4-31b")).toBe("gemma4");
    expect(normalizeSarvamLlmModel("glm5.2")).toBe("glm5.2");
    expect(normalizeSarvamLlmModel("glm-5.2")).toBe("glm5.2");
    expect(normalizeSarvamLlmModel("sarvam-30b")).toBe("sarvam-105b");
    expect(normalizeSarvamLlmModel("sarvam-105b-conversations")).toBe("sarvam-105b-conversations");
    expect(normalizeSarvamLlmModel("sarvam-105b-chat")).toBe("sarvam-105b-conversations");
    expect(normalizeSarvamLlmModel(null)).toBe("sarvam-105b");
  });

  it("routes open-source models to /v2 and Sarvam models to /v1", () => {
    expect(isSarvamOpenSourceModel("gemma4")).toBe(true);
    expect(isSarvamOpenSourceModel("glm5.2")).toBe(true);
    expect(isSarvamOpenSourceModel("sarvam-105b")).toBe(false);
    expect(isSarvamOpenSourceModel("sarvam-105b-conversations")).toBe(false);

    expect(sarvamChatCompletionsUrl("gemma4")).toBe(
      "https://api.sarvam.ai/v2/chat/completions",
    );
    expect(sarvamChatCompletionsUrl("glm5.2")).toBe(
      "https://api.sarvam.ai/v2/chat/completions",
    );
    expect(sarvamChatCompletionsUrl("sarvam-105b")).toBe(
      "https://api.sarvam.ai/v1/chat/completions",
    );
    expect(sarvamChatCompletionsUrl("sarvam-105b-conversations")).toBe(
      "https://api.sarvam.ai/v1/chat/completions",
    );
  });
});

describe("SarvamLLM conversations voice knobs", () => {
  type Internals = {
    buildGenerationBody(): Record<string, unknown>;
  };

  it("disables reasoning by default on sarvam-105b-conversations", () => {
    const llm = new SarvamLLM("test-key", "sarvam-105b-conversations", { maxTokens: 300 });
    const body = (llm as unknown as Internals).buildGenerationBody();
    expect(body["reasoning_effort"]).toBeNull();
  });
});

describe("SarvamLLM gemma4 voice latency knobs", () => {
  type Internals = {
    buildGenerationBody(): Record<string, unknown>;
    cancelInFlight(): void;
    abortController: AbortController | null;
  };

  it("caps gemma4 max_tokens for voice and never sends reasoning_effort", () => {
    const llm = new SarvamLLM("test-key", "gemma4", { maxTokens: 2000, reasoningEffort: "high" });
    const body = (llm as unknown as Internals).buildGenerationBody();
    expect(body["max_tokens"]).toBeLessThanOrEqual(400);
    expect(body["reasoning_effort"]).toBeUndefined();
  });

  it("exposes cancelInFlight so barge-in can abort the SSE stream", () => {
    const llm = new SarvamLLM("test-key", "gemma4");
    const internals = llm as unknown as Internals;
    const ac = new AbortController();
    internals.abortController = ac;
    llm.cancelInFlight();
    expect(ac.signal.aborted).toBe(true);
    expect(internals.abortController).toBeNull();
  });
});
