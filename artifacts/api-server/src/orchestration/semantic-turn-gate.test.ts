import { describe, expect, it } from "vitest";
import {
  SemanticTurnGate,
  clampSemanticTurnStopMs,
  resolveEouCommit,
  resolveSemanticTurnEnabled,
} from "./semantic-turn-gate.js";

describe("resolveEouCommit", () => {
  it("holds when the audio model says the thought is incomplete", () => {
    expect(resolveEouCommit({ eou: "incomplete", textLooksIncomplete: false })).toEqual({
      action: "hold",
      reason: "audio_incomplete",
    });
  });

  it("holds on a text veto even if the audio model says complete (yeah but…)", () => {
    expect(resolveEouCommit({ eou: "complete", textLooksIncomplete: true })).toEqual({
      action: "hold",
      reason: "text_veto",
    });
  });

  it("fails open when the model is missing and the transcript looks finished", () => {
    expect(resolveEouCommit({ eou: "unavailable", textLooksIncomplete: false })).toEqual({
      action: "commit",
      reason: "eou_unavailable",
    });
  });

  it("still holds on text when the model is missing", () => {
    expect(resolveEouCommit({ eou: "unavailable", textLooksIncomplete: true })).toEqual({
      action: "hold",
      reason: "text_incomplete",
    });
  });

  it("commits immediately on audio-complete + finished text", () => {
    expect(resolveEouCommit({ eou: "complete", textLooksIncomplete: false })).toEqual({
      action: "commit",
      reason: "audio_complete",
    });
  });
});

describe("SemanticTurnGate", () => {
  it("blocks finals between speech_end and an incomplete hold, then commits on stop timeout", () => {
    const g = new SemanticTurnGate();
    g.onSpeechStart();
    const { generation } = g.onSpeechEnd();
    expect(g.shouldBlockFinal()).toBe(true);
    expect(g.onEou(generation, { action: "hold", reason: "audio_incomplete" })).toBe("hold");
    expect(g.shouldBlockFinal()).toBe(true);
    expect(g.onStopTimeout(generation)).toBe("commit");
    expect(g.shouldBlockFinal()).toBe(false);
  });

  it("ignores a stale EOU result after the caller starts talking again", () => {
    const g = new SemanticTurnGate();
    g.onSpeechStart();
    const first = g.onSpeechEnd();
    g.onSpeechStart();
    expect(g.onEou(first.generation, { action: "commit", reason: "audio_complete" })).toBe("ignore");
    expect(g.phase).toBe("open");
  });

  it("cancels a hold when speech resumes and keeps blocking until the next commit", () => {
    const g = new SemanticTurnGate();
    g.onSpeechStart();
    const { generation } = g.onSpeechEnd();
    g.onEou(generation, { action: "hold", reason: "audio_incomplete" });
    const resume = g.onSpeechStart();
    expect(resume.wasHolding).toBe(true);
    expect(resume.cancelEvaluation).toBe(true);
    expect(g.onStopTimeout(generation)).toBe("ignore");
    expect(g.shouldBlockFinal()).toBe(true);
    const next = g.onSpeechEnd();
    expect(g.onEou(next.generation, { action: "commit", reason: "audio_complete" })).toBe("commit");
    expect(g.shouldBlockFinal()).toBe(false);
  });

  it("buffers finals for the whole open→evaluating window, not only after Smart Turn returns", () => {
    const g = new SemanticTurnGate();
    g.onSpeechStart();
    expect(g.phase).toBe("open");
    expect(g.shouldBlockFinal()).toBe(true);
    const first = g.onSpeechEnd();
    expect(first.started).toBe(true);
    expect(g.shouldBlockFinal()).toBe(true);
    const dup = g.onSpeechEnd();
    expect(dup.started).toBe(false);
    expect(dup.generation).toBe(first.generation);
    expect(g.onEou(first.generation, { action: "commit", reason: "audio_complete" })).toBe("commit");
    expect(g.shouldBlockFinal()).toBe(false);
  });
});

describe("config helpers", () => {
  it("clamps stop-ms", () => {
    expect(clampSemanticTurnStopMs(50)).toBe(400);
    expect(clampSemanticTurnStopMs(9000)).toBe(4000);
    expect(clampSemanticTurnStopMs("nope")).toBe(1200);
  });

  it("SEMANTIC_TURN=0 disables even when agent config is on", () => {
    const prev = process.env["SEMANTIC_TURN"];
    process.env["SEMANTIC_TURN"] = "0";
    expect(resolveSemanticTurnEnabled(true)).toBe(false);
    if (prev === undefined) delete process.env["SEMANTIC_TURN"];
    else process.env["SEMANTIC_TURN"] = prev;
  });
});
