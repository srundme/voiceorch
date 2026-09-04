import { describe, expect, it } from "vitest";
import {
  DEFAULT_SQUAD_HANDOFF_GREETING,
  DEFAULT_SQUAD_HANDOFF_MESSAGE,
  spokenSquadHandoffGreeting,
  spokenSquadHandoffMessage,
} from "@workspace/db/schema";

describe("spoken squad handoff lines", () => {
  it("stays silent for empty and stock copy so a second voice is not forced", () => {
    expect(spokenSquadHandoffMessage("")).toBe("");
    expect(spokenSquadHandoffMessage(null)).toBe("");
    expect(spokenSquadHandoffMessage(DEFAULT_SQUAD_HANDOFF_MESSAGE)).toBe("");
    expect(spokenSquadHandoffMessage(
      "One moment — I'm connecting you to a teammate who can help with this.",
    )).toBe("");
    expect(spokenSquadHandoffGreeting("")).toBe("");
    expect(spokenSquadHandoffGreeting(DEFAULT_SQUAD_HANDOFF_GREETING)).toBe("");
    expect(spokenSquadHandoffGreeting(
      "Hi — I've been briefed on your conversation so far. How can I help?",
    )).toBe("");
  });

  it("speaks only operator-written copy", () => {
    expect(spokenSquadHandoffMessage("Hold on, Priya will join.")).toBe("Hold on, Priya will join.");
    expect(spokenSquadHandoffGreeting("This is Priya — I can book that slot.")).toBe(
      "This is Priya — I can book that slot.",
    );
  });
});
