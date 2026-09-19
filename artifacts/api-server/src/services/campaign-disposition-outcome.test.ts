import { describe, expect, it } from "vitest";
import { resolveDispositionLabelForCall } from "./campaign-disposition-outcome.js";

describe("voicemail disposition is not overwritten as no pickup", () => {
  it("keeps a normal no-pickup label on a live no-pickup call", () => {
    expect(resolveDispositionLabelForCall({
      incomingLabel: "outcome: no pickup",
      callStatus: "no_pickup",
      lastAttemptStatus: "no_pickup",
    })).toBe("outcome: no pickup");
  });

  it("rewrites no-pickup when the call was already marked voicemail", () => {
    expect(resolveDispositionLabelForCall({
      incomingLabel: "outcome: no pickup",
      callStatus: "voicemail",
      lastAttemptStatus: "voicemail",
    })).toBe("outcome: voicemail");
  });

  it("rewrites from last_attempt_status even if call_status is completed", () => {
    expect(resolveDispositionLabelForCall({
      incomingLabel: "NOT_CONNECTED: no_answer",
      callStatus: "completed",
      lastAttemptStatus: "voicemail",
    })).toBe("outcome: voicemail");
  });

  it("does not clobber a business-ending label", () => {
    expect(resolveDispositionLabelForCall({
      incomingLabel: "outcome: interested",
      callStatus: "voicemail",
      lastAttemptStatus: "voicemail",
    })).toBe("outcome: interested");
  });

  it("keeps an explicit voicemail taxonomy label", () => {
    expect(resolveDispositionLabelForCall({
      incomingLabel: "outcome: voicemail",
      callStatus: "voicemail",
      lastAttemptStatus: "voicemail",
    })).toBe("outcome: voicemail");
  });
});
