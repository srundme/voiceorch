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

  it("fails open past Smart Turn when the model is missing and the transcript looks finished", () => {
    expect(resolveEouCommit({ eou: "unavailable", textLooksIncomplete: false })).toEqual({
      action: "eligible",
      reason: "eou_unavailable",
    });
  });

  it("fail-open still honours the text veto — it does not skip transcript.final", () => {
    expect(resolveEouCommit({ eou: "unavailable", textLooksIncomplete: true })).toEqual({
      action: "hold",
      reason: "text_incomplete",
    });
  });

  it("is eligible immediately on audio-complete + finished text", () => {
    expect(resolveEouCommit({ eou: "complete", textLooksIncomplete: false })).toEqual({
      action: "eligible",
      reason: "audio_complete",
    });
  });

  it("HOLDs a slow Smart Turn instead of fail-opening as complete", () => {
    expect(resolveEouCommit({ eou: "timeout", textLooksIncomplete: false })).toEqual({
      action: "hold",
      reason: "eou_timeout",
    });
  });

  it("still fail-opens a timed-out short ack so Fast yes/no stays snappy", () => {
    expect(resolveEouCommit({
      eou: "timeout",
      textLooksIncomplete: false,
      snapComplete: true,
    })).toEqual({
      action: "eligible",
      reason: "eou_timeout_ack",
    });
  });

  it("timeout still honours the text veto", () => {
    expect(resolveEouCommit({ eou: "timeout", textLooksIncomplete: true })).toEqual({
      action: "hold",
      reason: "text_incomplete",
    });
  });
});

describe("SemanticTurnGate", () => {
  it("hold timeout waits for transcript.final instead of committing TTS", () => {
    const g = new SemanticTurnGate();
    g.onSpeechStart();
    const { generation } = g.onSpeechEnd();
    expect(g.shouldBlockFinal()).toBe(true);
    expect(g.onEou(generation, { action: "hold", reason: "audio_incomplete" })).toBe("hold");
    expect(g.shouldBlockFinal()).toBe(true);
    expect(g.onStopTimeout(generation)).toBe("await_final");
    expect(g.phase).toBe("awaiting_final");
    expect(g.isAwaitingFinal()).toBe(true);
    expect(g.shouldBlockFinal()).toBe(false);
    expect(g.turnGeneration).toBe(generation);
  });

  it("ignores a stale EOU result after the caller starts talking again", () => {
    const g = new SemanticTurnGate();
    g.onSpeechStart();
    const first = g.onSpeechEnd();
    g.onSpeechStart();
    expect(g.onEou(first.generation, { action: "eligible", reason: "audio_complete" })).toBe("ignore");
    expect(g.phase).toBe("open");
    expect(g.turnGeneration).toBeGreaterThan(first.generation);
  });

  it("cancels a hold when speech resumes and increments turnGeneration", () => {
    const g = new SemanticTurnGate();
    g.onSpeechStart();
    const { generation } = g.onSpeechEnd();
    g.onEou(generation, { action: "hold", reason: "audio_incomplete" });
    const resume = g.onSpeechStart();
    expect(resume.wasHolding).toBe(true);
    expect(resume.cancelEvaluation).toBe(true);
    expect(g.turnGeneration).toBeGreaterThan(generation);
    expect(g.onStopTimeout(generation)).toBe("ignore");
    expect(g.shouldBlockFinal()).toBe(true);
    const next = g.onSpeechEnd();
    expect(next.generation).toBe(g.turnGeneration);
    expect(g.onEou(next.generation, { action: "eligible", reason: "audio_complete" })).toBe("eligible");
    expect(g.phase).toBe("awaiting_final");
    expect(g.shouldBlockFinal()).toBe(false);
  });

  it("keeps one turnGeneration from open through evaluating (speech_end is not a new turn)", () => {
    const g = new SemanticTurnGate();
    const start = g.onSpeechStart();
    expect(start.cancelEvaluation).toBe(false);
    const openGen = g.turnGeneration;
    const first = g.onSpeechEnd();
    expect(first.started).toBe(true);
    expect(first.generation).toBe(openGen);
    const dup = g.onSpeechEnd();
    expect(dup.started).toBe(false);
    expect(dup.generation).toBe(openGen);
    expect(g.onEou(first.generation, { action: "eligible", reason: "audio_complete" })).toBe("eligible");
    g.markCommitted();
    expect(g.phase).toBe("idle");
    expect(g.turnGeneration).toBe(openGen);
  });

  it("does not let an old generation commit after resume from awaiting_final", () => {
    const g = new SemanticTurnGate();
    g.onSpeechStart();
    const { generation } = g.onSpeechEnd();
    expect(g.onEou(generation, { action: "eligible", reason: "audio_complete" })).toBe("eligible");
    g.onSpeechStart();
    expect(g.onStopTimeout(generation)).toBe("ignore");
    expect(g.phase).toBe("open");
  });

  it("belongsTo is false after resume increments turnGeneration", () => {
    const g = new SemanticTurnGate();
    g.onSpeechStart();
    const { generation } = g.onSpeechEnd();
    expect(g.belongsTo(generation)).toBe(true);
    expect(g.onEou(generation, { action: "eligible", reason: "audio_complete" })).toBe("eligible");
    const resume = g.onSpeechStart();
    expect(resume.wasAwaitingFinal).toBe(true);
    expect(g.belongsTo(generation)).toBe(false);
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
