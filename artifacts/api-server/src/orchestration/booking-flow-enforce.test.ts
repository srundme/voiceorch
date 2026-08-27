import { describe, expect, it } from "vitest";
import {
  buildAutoBookArgs,
  canAutoBook,
  emptyBookingFlowState,
  looksLikeDemoOrScheduleIntent,
  looksLikeEmailConfirmationYes,
  looksLikeFalseBookingClaim,
  parseSlotIsoFromAvailabilityResult,
  shouldForceBookAppointment,
  shouldForceCheckAvailability,
  updateBookingFlowFromToolResult,
  updateBookingFlowFromUserTurn,
} from "./booking-flow-enforce.js";

describe("looksLikeDemoOrScheduleIntent", () => {
  it("detects demo and schedule phrases", () => {
    expect(looksLikeDemoOrScheduleIntent("I want a demo tomorrow")).toBe(true);
    expect(looksLikeDemoOrScheduleIntent("call for demo")).toBe(true);
    expect(looksLikeDemoOrScheduleIntent("book a meeting")).toBe(true);
    expect(looksLikeDemoOrScheduleIntent("hello how are you")).toBe(false);
  });
});

describe("booking flow state machine", () => {
  it("forces check on demo intent before availability", () => {
    const state = emptyBookingFlowState();
    expect(
      shouldForceCheckAvailability({
        state,
        userText: "I need a demo",
        hasCheckTool: true,
        alreadyBooked: false,
      }),
    ).toBe(true);
  });

  it("auto-books only when slot + confirmed email + name are ready", () => {
    let state = emptyBookingFlowState();
    state = updateBookingFlowFromToolResult(
      state,
      "check_availability",
      'requested_slot_available: slot="2026-08-28T10:00:00+05:30", label="Fri Aug 28 at 10:00 AM"',
    );
    expect(parseSlotIsoFromAvailabilityResult(
      'requested_slot_available: slot="2026-08-28T10:00:00+05:30", label="x"',
    )).toBe("2026-08-28T10:00:00+05:30");

    state = updateBookingFlowFromUserTurn(state, "ramsiva97465@gmail.com", "Please share your email");
    state = updateBookingFlowFromUserTurn(state, "yes", "Is r a m … @ gmail.com correct?");
    state = { ...state, pendingName: "Ram Siva", emailConfirmed: true };

    expect(canAutoBook({ state, alreadyBooked: false })).toBe(true);
    expect(buildAutoBookArgs(state).email_confirmed).toBe(true);
    expect(
      shouldForceBookAppointment({
        state,
        userText: "yes",
        hasBookTool: true,
        alreadyBooked: false,
      }),
    ).toBe(true);
  });

  it("detects false booking claims and email yes", () => {
    expect(looksLikeFalseBookingClaim("I've booked your meeting")).toBe(true);
    expect(looksLikeFalseBookingClaim("இப்போ book பண்ணிடுறேன்")).toBe(true);
    expect(looksLikeFalseBookingClaim("what time works for you")).toBe(false);
    expect(looksLikeEmailConfirmationYes("yes that's right")).toBe(true);
    expect(looksLikeEmailConfirmationYes("சரி")).toBe(true);
  });
});
