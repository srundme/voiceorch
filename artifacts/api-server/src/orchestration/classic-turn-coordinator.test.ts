import { describe, expect, it } from "vitest";
import { ClassicTurnCoordinator } from "./classic-turn-coordinator.js";
import type { ClassicTurnIdSnapshot, CommitRequest, InterruptRequest } from "./classic-turn-ids.js";

function makeCoord(overrides?: {
  responseId?: number;
  valid?: Set<number>;
}) {
  const interrupts: Array<InterruptRequest & ClassicTurnIdSnapshot> = [];
  const hards: Array<InterruptRequest & ClassicTurnIdSnapshot> = [];
  const commits: Array<CommitRequest & ClassicTurnIdSnapshot> = [];
  const valid = overrides?.valid ?? new Set([1, -1]);
  let responseId = overrides?.responseId ?? 1;

  const coord = new ClassicTurnCoordinator({
    callId: "test",
    getMediaEpoch: () => 3,
    getResponseId: () => responseId,
    isResponseValid: (id) => valid.has(id),
    executeConversationalInterrupt: (req) => { interrupts.push(req); },
    executeHardInterrupt: (req) => {
      hards.push(req);
      valid.clear();
      valid.add(-1);
    },
    executeCommit: (req) => { commits.push(req); },
  });

  return {
    coord,
    interrupts,
    hards,
    commits,
    setResponseId: (id: number) => { responseId = id; },
  };
}

describe("ClassicTurnCoordinator", () => {
  it("routes conversational interrupt with id snapshot", () => {
    const { coord, interrupts, hards } = makeCoord();
    coord.noteCallerSpeech();
    coord.requestInterrupt({ trigger: "stt_partial", partial: "hello there" });
    expect(hards).toHaveLength(0);
    expect(interrupts).toHaveLength(1);
    expect(interrupts[0]!.trigger).toBe("stt_partial");
    expect(interrupts[0]!.mediaEpoch).toBe(3);
    expect(interrupts[0]!.utteranceId).toMatch(/^u1-/);
    expect(interrupts[0]!.responseId).toBe(1);
  });

  it("forceHard uses hard executor and clears filler parent", () => {
    const { coord, interrupts, hards } = makeCoord();
    coord.bindFillerToResponse(1);
    expect(coord.fillerParentResponseIdOrNull()).toBe(1);
    coord.requestInterrupt({ trigger: "soft_promote", forceHard: true });
    expect(interrupts).toHaveLength(0);
    expect(hards).toHaveLength(1);
    expect(coord.fillerParentResponseIdOrNull()).toBeNull();
  });

  it("commit clears utterance id and reuses a new one next speech", async () => {
    const { coord, commits } = makeCoord();
    const u1 = coord.noteCallerSpeech();
    await coord.requestCommit({
      source: "stt_final",
      transcript: "I live in Chennai",
      sttLatencyMs: 0,
    });
    expect(commits).toHaveLength(1);
    expect(commits[0]!.utteranceId).toBe(u1);
    expect(commits[0]!.source).toBe("stt_final");
    const u2 = coord.noteCallerSpeech();
    expect(u2).not.toBe(u1);
  });

  it("does not invent a second response counter — uses getResponseId", () => {
    const { coord, commits, setResponseId } = makeCoord({ responseId: 7 });
    setResponseId(7);
    coord.noteCallerSpeech();
    void coord.requestCommit({ source: "batch_stt", transcript: "ok", sttLatencyMs: 12 });
    expect(commits[0]!.responseId).toBe(7);
  });

  it("serializes interrupt then commit without nesting", async () => {
    const order: string[] = [];
    const coord = new ClassicTurnCoordinator({
      getMediaEpoch: () => 1,
      getResponseId: () => 1,
      isResponseValid: () => true,
      executeConversationalInterrupt: () => { order.push("interrupt"); },
      executeHardInterrupt: () => { order.push("hard"); },
      executeCommit: () => { order.push("commit"); },
    });
    coord.requestInterrupt({ trigger: "word_count", partial: "stop please" });
    await coord.requestCommit({ source: "stt_final", transcript: "stop please", sttLatencyMs: 0 });
    expect(order).toEqual(["interrupt", "commit"]);
  });

  it("maps close reasons to commit sources", () => {
    expect(ClassicTurnCoordinator.commitSourceFromCloseReason("force_finalized")).toBe("force_finalized");
    expect(ClassicTurnCoordinator.commitSourceFromCloseReason("coalesced_fragment")).toBe("coalesced_fragment");
    expect(ClassicTurnCoordinator.commitSourceFromCloseReason("stt_final")).toBe("stt_final");
    expect(ClassicTurnCoordinator.commitSourceFromCloseReason(undefined)).toBe("stt_final");
  });

  it("isResponseStillValid delegates to InterruptionManager validity", () => {
    const { coord } = makeCoord({ valid: new Set([2, -1]) });
    expect(coord.isResponseStillValid(2)).toBe(true);
    expect(coord.isResponseStillValid(9)).toBe(false);
  });
});

describe("ClassicTurnCoordinator decision path must stay non-blocking", () => {
  it("requestInterrupt never awaits executeCommit side work", () => {
    let resolveCommit!: () => void;
    const hanging = new Promise<void>((r) => { resolveCommit = r; });
    const coord = new ClassicTurnCoordinator({
      getMediaEpoch: () => 1,
      getResponseId: () => 1,
      isResponseValid: () => true,
      executeConversationalInterrupt: () => { /* sync */ },
      executeHardInterrupt: () => { /* sync */ },
      executeCommit: () => hanging,
    });
    const t0 = Date.now();
    coord.requestInterrupt({ trigger: "vad_speech_start" });
    expect(Date.now() - t0).toBeLessThan(50);
    resolveCommit();
  });
});
