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
  applyBookingEmailToBookArgs,
  applyBookingEmailToSendArgs,
  applyLockedSlotToBookArgs,
  extractEmailsFromText,
  looksLikeEmailRejection,
  markEmailSpelled,
  shouldUpdateBookedEmail,
  shouldForceBookAppointment,
  shouldForceCheckAvailability,
  shouldSpeakEmailSpell,
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
    state = markEmailSpelled(state, "ramsiva97465@gmail.com");
    state = updateBookingFlowFromUserTurn(state, "yes", "Is r a m … @ gmail.com correct?");
    state = { ...state, pendingName: "Ram Siva", emailConfirmed: true, lastSpelledEmail: "ramsiva97465@gmail.com" };

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
    expect(looksLikeEmailConfirmationYes("Oh correct")).toBe(true);
    expect(looksLikeEmailConfirmationYes("Okay correct")).toBe(true);
    expect(looksLikeEmailConfirmationYes("சரி")).toBe(true);
  });

  it("does not confirm an invented email after the caller said a different one (call 17701)", () => {
    let state = emptyBookingFlowState();
    state = updateBookingFlowFromUserTurn(
      state,
      "W A no no it's wrong it's wrong A E R T H I www.karraj@gmail.com",
      "Is KERTHIKWAREJ@gmail.com correct?",
    );
    expect(state.pendingEmail).toBe("karraj@gmail.com");
    expect(state.emailConfirmed).toBe(false);
    expect(shouldSpeakEmailSpell(state)).toBe(true);

    state = updateBookingFlowFromAssistantText(
      state,
      "You said it is <spell>k a r t h i k @ g m a i l . c o m</spell> Is that correct?",
    );
    expect(state.pendingEmail).toBe("karraj@gmail.com");
    expect(state.lastSpelledEmail).toBeNull();

    state = updateBookingFlowFromUserTurn(
      state,
      "Okay correct",
      "You said it is <spell>k a r t h i k @ g m a i l . c o m</spell> Is that correct?",
    );
    expect(state.emailConfirmed).toBe(false);
    expect(canAutoBook({ state: { ...state, pendingName: "Aah Krithika" }, alreadyBooked: false })).toBe(false);

    state = markEmailSpelled(state, "karraj@gmail.com");
    state = updateBookingFlowFromUserTurn(
      state,
      "Okay correct",
      "Let me confirm your email. <spell>k a r r a j @ g m a i l . c o m</spell> Is that correct?",
    );
    expect(state.emailConfirmed).toBe(true);
    expect(state.lastSpelledEmail).toBe("karraj@gmail.com");
  });

  it("replaces the first email after the caller says no and gives a second address", () => {
    let state = emptyBookingFlowState();
    state = updateBookingFlowFromUserTurn(state, "ram@gmail.com", "Please share your email");
    state = markEmailSpelled(state, "ram@gmail.com");
    expect(state.pendingEmail).toBe("ram@gmail.com");

    state = updateBookingFlowFromUserTurn(
      state,
      "no again use siva@gmail.com",
      "Let me confirm your email. <spell>r a m @ g m a i l . c o m</spell> Is that correct?",
    );
    expect(state.pendingEmail).toBe("siva@gmail.com");
    expect(state.emailConfirmed).toBe(false);
    expect(state.lastSpelledEmail).toBeNull();
    expect(shouldSpeakEmailSpell(state)).toBe(true);

    state = markEmailSpelled(state, "ram@gmail.com");
    state = updateBookingFlowFromUserTurn(
      state,
      "no not ram@gmail.com it's siva@gmail.com",
      "Is r a m @ gmail.com correct?",
    );
    expect(state.pendingEmail).toBe("siva@gmail.com");

    state = markEmailSpelled(state, "siva@gmail.com");
    state = updateBookingFlowFromUserTurn(
      state,
      "no",
      "Let me confirm your email. <spell>s i v a @ g m a i l . c o m</spell> Is that correct?",
    );
    expect(state.pendingEmail).toBeNull();
    expect(state.emailConfirmed).toBe(false);
    state = updateBookingFlowFromUserTurn(state, "karraj@gmail.com", "Please say the email again");
    expect(state.pendingEmail).toBe("karraj@gmail.com");
  });

  it("keeps the reconstructed full address, not the STT compact suffix (call 20113)", () => {
    expect(extractEmailsFromText("K I S H O R E K U M A R R 307@gmail.com")).toEqual([
      "kishorekumarr307@gmail.com",
    ]);
    expect(looksLikeEmailRejection("No K I S H O R E K U M A R R 307@gmail.com")).toBe(true);
    expect(looksLikeEmailRejection("Change the mail. I don't need the mail.")).toBe(true);

    let state = emptyBookingFlowState();
    state = updateBookingFlowFromUserTurn(
      state,
      "K I S H O R E K U M A R R 307@gmail.com",
      "And your email address, please?",
    );
    expect(state.pendingEmail).toBe("kishorekumarr307@gmail.com");

    state = markEmailSpelled(state, "307@gmail.com");
    state = { ...state, pendingEmail: "307@gmail.com", lastSpelledEmail: "307@gmail.com" };
    state = updateBookingFlowFromUserTurn(
      state,
      "No K I S H O R E K U M A R R 307@gmail.com",
      "Let me confirm your email. <spell>3 0 7 @ g m a i l . c o m</spell> Is that correct?",
    );
    expect(state.pendingEmail).toBe("kishorekumarr307@gmail.com");
    expect(state.emailConfirmed).toBe(false);

    state = updateBookingFlowFromAssistantText(
      state,
      "Your email address is <spell>k i s h o r e k u m a r r 3 0 7 @ g m a i l . c o m</spell>. Is that correct?",
    );
    expect(state.pendingEmail).toBe("kishorekumarr307@gmail.com");
    expect(state.lastSpelledEmail).toBe("kishorekumarr307@gmail.com");

    state = updateBookingFlowFromUserTurn(
      state,
      "सही है, सही है।",
      "Your email address is <spell>k i s h o r e k u m a r r 3 0 7 @ g m a i l . c o m</spell>. Is that correct?",
    );
    expect(state.emailConfirmed).toBe(true);
    expect(buildAutoBookArgs(state).attendee_email).toBe("kishorekumarr307@gmail.com");
    expect(
      applyBookingEmailToBookArgs(state, { attendee_email: "307@gmail.com" }).attendee_email,
    ).toBe("kishorekumarr307@gmail.com");
    expect(
      applyBookingEmailToSendArgs(state, { to_email: "kishorekumarr307@gmail.com" }).to_email,
    ).toBe("kishorekumarr307@gmail.com");
  });

  it("flags a post-booking email change after the new address is confirmed", () => {
    let state = emptyBookingFlowState();
    state = {
      ...state,
      lastBookingId: 396,
      bookedEmail: "kishorekumarr307@gmail.com",
      pendingEmail: "ramsiva97465@gmail.com",
      lastSpelledEmail: "ramsiva97465@gmail.com",
      emailConfirmed: true,
    };
    expect(shouldUpdateBookedEmail({ state, alreadyBooked: true })).toBe(true);
    expect(shouldUpdateBookedEmail({ state, alreadyBooked: false })).toBe(false);
  });
});
