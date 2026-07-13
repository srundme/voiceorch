import { describe, it, expect } from "vitest";
import { FILLER_SEQUENCE_ID, InterruptionManager } from "./interruption-manager.js";

describe("InterruptionManager", () => {
  it("beginAgentTurn returns monotonic sequence ids", () => {
    const m = new InterruptionManager();
    const a = m.beginAgentTurn();
    const b = m.beginAgentTurn();
    expect(b).toBe(a + 1);
    expect(m.isValidSequence(a)).toBe(true);
    expect(m.isValidSequence(b)).toBe(true);
  });

  it("invalidateCurrentTurn blocks stale audio for that sequence", () => {
    const m = new InterruptionManager();
    const id = m.beginAgentTurn();
    m.invalidateCurrentTurn();
    expect(m.isValidSequence(id)).toBe(false);
    expect(m.getAudioSendStatus(id, 5)).toBe("BLOCK");
  });

  it("filler sequence id is always valid", () => {
    const m = new InterruptionManager();
    m.beginAgentTurn();
    m.invalidateCurrentTurn();
    expect(m.isValidSequence(FILLER_SEQUENCE_ID)).toBe(true);
    expect(m.getAudioSendStatus(FILLER_SEQUENCE_ID, 5)).toBe("SEND");
  });

  it("WAIT while callee is speaking", () => {
    const m = new InterruptionManager();
    const id = m.beginAgentTurn();
    m.onUserSpeechStart();
    expect(m.getAudioSendStatus(id, 5)).toBe("WAIT");
    m.onUserSpeechEnd();
    expect(m.getAudioSendStatus(id, 5)).toBe("SEND");
  });
});
