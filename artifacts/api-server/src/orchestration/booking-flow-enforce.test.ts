import { describe, expect, it } from "vitest";
import {
  buildAutoBookArgs,
  canAutoBook,
  emptyBookingFlowState,
  looksLikeDemoOrScheduleIntent,
  looksLikeEmailConfirmationYes,
  looksLikeFalseBookingClaim,
  parseSlotIsoFromAvailabilityResult,
  pickSlotIsoFromSpokenTime,
  pickTimeSlotBySpokenClock,
  applyLockedSlotToBookArgs,
  shouldForceBookAppointment,
  shouldForceCheckAvailability,
  updateBookingFlowFromAssistantText,
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

  it("locks the caller's 10 AM slot, not the first free 9 AM (call 17701)", () => {
    const slots =
      'available_slots: next="2026-09-03T09:00:00+05:30 (Thu Sep 3 at 9:00 AM); 2026-09-03T10:00:00+05:30 (Thu Sep 3 at 10:00 AM)"';
    let state = updateBookingFlowFromToolResult(emptyBookingFlowState(), "check_availability", slots);
    expect(state.lastSlotIso).toBe("2026-09-03T09:00:00+05:30");
    expect(state.slotLocked).toBe(false);
    expect(pickSlotIsoFromSpokenTime("10:10 AM 10 AM 10 AM", state.candidateSlots)).toBe(
      "2026-09-03T10:00:00+05:30",
    );
    expect(
      applyLockedSlotToBookArgs(state, { preferred_date: "2026-09-03T09:00:00+05:30" }).preferred_date,
    ).toBe("2026-09-03T09:00:00+05:30");
    state = updateBookingFlowFromUserTurn(state, "10:10 AM 10 AM 10 AM", "Which time works for you?");
    expect(state.lastSlotIso).toBe("2026-09-03T10:00:00+05:30");
    expect(state.slotLocked).toBe(true);
    expect(
      applyLockedSlotToBookArgs(state, { preferred_date: "2026-09-03T09:00:00+05:30" }).preferred_date,
    ).toBe("2026-09-03T10:00:00+05:30");
    const nine = { iso: "2026-09-03T09:00:00+05:30" };
    const ten = { iso: "2026-09-03T10:00:00+05:30" };
    expect(pickTimeSlotBySpokenClock("tomorrow morning 10 AM", [nine, ten], (s) => s.iso)).toEqual(ten);
    expect(pickTimeSlotBySpokenClock("tomorrow morning", [nine, ten], (s) => s.iso)).toBeUndefined();
    state = updateBookingFlowFromAssistantText(
      state,
      "Sir, tomorrow morning we have slots at 9:00 AM, 9:15 AM and 10:00 AM. Which time works for you?",
    );
    expect(state.lastSlotIso).toBe("2026-09-03T10:00:00+05:30");
    state = updateBookingFlowFromAssistantText(state, "Perfect sir, 10:00 AM tomorrow is available.");
    expect(state.lastSlotIso).toBe("2026-09-03T10:00:00+05:30");
  });

  it("detects false booking claims and email yes", () => {
    expect(looksLikeFalseBookingClaim("I've booked your meeting")).toBe(true);
    expect(looksLikeFalseBookingClaim("இப்போ book பண்ணிடுறேன்")).toBe(true);
    expect(looksLikeFalseBookingClaim("what time works for you")).toBe(false);
    expect(looksLikeEmailConfirmationYes("yes that's right")).toBe(true);
    expect(looksLikeEmailConfirmationYes("சரி")).toBe(true);
  });
});
