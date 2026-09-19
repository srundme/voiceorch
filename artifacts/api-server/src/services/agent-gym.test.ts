import { describe, expect, it } from "vitest";
import {
  GYM_LESSONS_HEADING,
  GYM_PERSONAS,
  agentGymSystemPrompt,
  customerGymSystemPrompt,
  formatGymTranscript,
  mergeGymPromptAddendum,
  parseScorecard,
  planGymLlmSource,
  runGymConversation,
  type GymChatFn,
} from "./agent-gym-engine.js";

const busy = GYM_PERSONAS.find((p) => p.id === "busy_interrupter")!;

describe("gym conversation", () => {
  it("records an interrupt tag and stops on END_CALL", async () => {
    const script = [
      "Hello, is this about the gym?",
      `${"[INTERRUPT]"} wait how much is this`,
      "Ok one more thing then I'm done.",
      "END_CALL",
    ];
    const chat: GymChatFn = async ({ system, messages }) => {
      if (system.includes("live phone call. Reply with one spoken turn")) {
        const last = messages[messages.length - 1];
        if (last?.content.includes("[INTERRUPT]")) return "Sorry — the price depends on the plan. Want me to explain quickly?";
        return "Hi, this is Maya from SnapServe.";
      }
      return script.shift() ?? "END_CALL";
    };
    const result = await runGymConversation({
      agentPrompt: "You sell gym memberships. Be brief.",
      greeting: "Hi, this is Maya from SnapServe.",
      persona: busy,
      chat,
    });
    expect(result.interruptCount).toBeGreaterThanOrEqual(1);
    expect(result.endedBy).toBe("customer");
    expect(result.turns.some((t) => t.interrupted)).toBe(true);
    expect(result.turns.some((t) => t.role === "assistant" && t.content.includes("price depends"))).toBe(true);
    expect(formatGymTranscript(result.turns)).toContain("Customer [interrupted]");
  });

  it("caps turns when the customer never hangs up", async () => {
    const persona = { ...busy, maxTurns: 3 };
    const chat: GymChatFn = async ({ system }) => {
      if (system.includes("testing a voice agent")) return "Still here, go on.";
      return "Sure, continuing.";
    };
    const result = await runGymConversation({
      agentPrompt: "Be helpful.",
      greeting: "Hello.",
      persona,
      chat,
    });
    expect(result.endedBy).toBe("max_turns");
    const customerTurns = result.turns.filter((t) => t.role === "user");
    expect(customerTurns).toHaveLength(3);
  });

  it("tells the customer persona to interrupt when the tester is an interrupter", () => {
    expect(customerGymSystemPrompt(busy)).toContain("[INTERRUPT]");
    expect(agentGymSystemPrompt("Be nice.")).toContain("[INTERRUPT]");
  });
});

describe("gym scorecard + prompt apply", () => {
  it("parses JSON even when wrapped in prose", () => {
    const parsed = parseScorecard(`Here you go
\`\`\`json
{"scores":{"interruptRecovery":4,"stayedOnGoal":5,"answeredQuestions":3,"didNotHallucinate":5,"naturalTurnTaking":4},"overall":82,"pass":true,"failures":[],"lessons":["Recover faster after barge-in"],"suggestedPromptAddendum":"If interrupted, finish the interrupted thought in one clause then answer."}
\`\`\``);
    expect(parsed.overall).toBe(82);
    expect(parsed.pass).toBe(true);
    expect(parsed.lessons[0]).toMatch(/barge-in/i);
    expect(parsed.scores.interruptRecovery).toBe(4);
  });

  it("does not duplicate an already-applied gym lesson", () => {
    const first = mergeGymPromptAddendum("You are Maya.", "If interrupted, recover in one sentence.");
    expect(first.applied).toBe(true);
    expect(first.next).toContain(GYM_LESSONS_HEADING);
    const second = mergeGymPromptAddendum(first.next, "If interrupted, recover in one sentence.");
    expect(second.applied).toBe(false);
    expect(second.next).toBe(first.next);
  });
});

describe("gym LLM key plan", () => {
  it("ignores leftover BYO keys on managed agents and uses platform Sarvam", () => {
    const plan = planGymLlmSource({
      agentMode: "managed",
      llmProvider: "sarvam",
      llmModel: "sarvam-105b-conversations",
      hasByopKey: true,
    });
    expect(plan.source).toBe("managed");
    expect(plan.provider).toBe("sarvam");
    expect(plan.managedKeys[0]).toBe("managed_sarvam_key");
  });

  it("uses the owner key only for BYOP agents", () => {
    const plan = planGymLlmSource({
      agentMode: "byop",
      llmProvider: "sarvam",
      llmModel: "sarvam-105b-conversations",
      hasByopKey: true,
    });
    expect(plan.source).toBe("byop");
    expect(plan.managedKeys).toEqual([]);
  });

  it("keeps the agent's provider and model instead of swapping to Groq", () => {
    const sarvam = planGymLlmSource({
      agentMode: "managed",
      llmProvider: "sarvam",
      llmModel: "gemma4",
      hasByopKey: false,
    });
    expect(sarvam.provider).toBe("sarvam");
    expect(sarvam.model).toBe("gemma4");
    expect(sarvam.managedKeys).toEqual(["managed_sarvam_key"]);

    const google = planGymLlmSource({
      agentMode: "managed",
      llmProvider: "google",
      llmModel: "gemini-2.0-flash",
      hasByopKey: false,
    });
    expect(google.provider).toBe("google");
    expect(google.model).toBe("gemini-2.0-flash");
    expect(google.managedKeys).toEqual(["managed_gemini_key"]);
  });
});
