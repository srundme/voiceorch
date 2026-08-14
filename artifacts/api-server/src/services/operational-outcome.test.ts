import { describe, expect, it } from "vitest";
import {
  computeOperationalOutcome,
  DEFAULT_POSITIVE_DISPOSITIONS,
} from "./operational-outcome.js";

const base = {
  callStatus: "completed",
  hasBooking: false,
  hasCompletedTransfer: false,
  hasPendingCallback: false,
  maxAttemptsReached: false,
  isDncBlocked: false,
};

describe("computeOperationalOutcome — positive disposition matching", () => {
  // Leads store "primary: sub", so comparing the whole label against a set of
  // bare values never matched and success rate read 0% on batches full of
  // interested leads.
  it("confirms interest from the sub of a taxonomy label", () => {
    expect(
      computeOperationalOutcome({ ...base, disposition: "outcome: interested" }),
    ).toBe("interest_confirmed");
  });

  it("confirms interest when the category itself carries the meaning", () => {
    expect(
      computeOperationalOutcome({ ...base, disposition: "interested: interested" }),
    ).toBe("interest_confirmed");
  });

  it("tolerates casing and underscore variants", () => {
    expect(
      computeOperationalOutcome({ ...base, disposition: "Outcome: Very_Interested" }),
    ).toBe("interest_confirmed");
  });

  it("still matches a bare label", () => {
    expect(computeOperationalOutcome({ ...base, disposition: "interested" })).toBe(
      "interest_confirmed",
    );
  });

  it("does not confirm interest for a negative disposition", () => {
    expect(
      computeOperationalOutcome({ ...base, disposition: "outcome: not interested" }),
    ).toBe("pending");
  });

  it("does not confirm interest for an unanswered call", () => {
    expect(
      computeOperationalOutcome({ ...base, disposition: "NOT_CONNECTED: no_answer" }),
    ).toBe("pending");
  });

  it("honours an agent's own positive terms", () => {
    expect(
      computeOperationalOutcome({
        ...base,
        disposition: "outcome: phone number purchased",
        positiveDispositions: new Set([
          ...DEFAULT_POSITIVE_DISPOSITIONS,
          "phone number purchased",
        ]),
      }),
    ).toBe("interest_confirmed");
  });

  it("keeps higher-priority outcomes ahead of interest", () => {
    expect(
      computeOperationalOutcome({ ...base, disposition: "outcome: interested", hasBooking: true }),
    ).toBe("booking_created");
    expect(
      computeOperationalOutcome({
        ...base,
        disposition: "outcome: interested",
        hasCompletedTransfer: true,
      }),
    ).toBe("transfer_completed");
  });

  it("returns pending when there is no disposition", () => {
    expect(computeOperationalOutcome({ ...base, disposition: null })).toBe("pending");
  });
});
