import { describe, expect, it } from "vitest";
import { UpdateAgentBody } from "@workspace/api-zod";
import {
  bookingAsksCallerForEmail,
  extractPromptBookingEmails,
  pickKnownBookingEmail,
  promptAsksToCollectEmail,
  resolveBookingAttendeeEmail,
  resolveDefaultBookingEmail,
} from "./booking-email-policy.js";

describe("promptAsksToCollectEmail", () => {
  it("detects collect / ask instructions in the prompt", () => {
    expect(promptAsksToCollectEmail("Collect the email and book the slot.")).toBe(true);
    expect(promptAsksToCollectEmail("Ask for their email address then book.")).toBe(true);
    expect(promptAsksToCollectEmail("You are a receptionist. Book meetings.")).toBe(false);
    expect(promptAsksToCollectEmail("A confirmation email is sent automatically.")).toBe(false);
  });
});

describe("extractPromptBookingEmails", () => {
  it("reads a hardcoded address from the prompt and skips placeholders", () => {
    expect(extractPromptBookingEmails("Always book to ops@acme.com for the invite."))
      .toEqual(["ops@acme.com"]);
    expect(extractPromptBookingEmails("Example: user@example.com — never use this.")).toEqual([]);
  });
});

describe("bookingAsksCallerForEmail", () => {
  it("ignores the old collectAttendeeEmail toggle", () => {
    expect(bookingAsksCallerForEmail(undefined)).toBe(false);
    expect(bookingAsksCallerForEmail({})).toBe(false);
    expect(bookingAsksCallerForEmail({ collectAttendeeEmail: true })).toBe(false);
  });

  it("asks only when the prompt says collect and no email is already known", () => {
    expect(bookingAsksCallerForEmail({}, { prompt: "Collect the email then book." })).toBe(true);
    expect(bookingAsksCallerForEmail({}, {
      prompt: "Collect the email. Book to ops@acme.com.",
    })).toBe(false);
    expect(bookingAsksCallerForEmail({}, {
      prompt: "Collect the email then book.",
      knownEmail: "lead@acme.com",
    })).toBe(false);
  });
});

describe("pickKnownBookingEmail", () => {
  it("reads lead source and prompt-variable keys first", () => {
    expect(pickKnownBookingEmail({ email: "lead@acme.com" })).toBe("lead@acme.com");
    expect(pickKnownBookingEmail({ customer_email: "cust@acme.com" })).toBe("cust@acme.com");
    expect(pickKnownBookingEmail({ patient_email: "pat@clinic.com" })).toBe("pat@clinic.com");
    expect(pickKnownBookingEmail({ name: "Ram", phone: "999" })).toBeNull();
    expect(pickKnownBookingEmail({ email: "test@example.com" })).toBeNull();
  });

  it("falls back to an address written in the prompt", () => {
    expect(pickKnownBookingEmail({ name: "Ram" }, "Invite ops@clinic.com on every booking."))
      .toBe("ops@clinic.com");
  });
});

describe("resolveBookingAttendeeEmail", () => {
  it("uses a lead/variable email without asking the caller", () => {
    expect(resolveBookingAttendeeEmail({
      tool: {},
      args: {},
      callId: 20423,
      knownEmail: "lead@acme.com",
    })).toEqual({ email: "lead@acme.com", fromCaller: false });
  });

  it("uses an email hardcoded in the prompt even when the model omitted args", () => {
    expect(resolveBookingAttendeeEmail({
      tool: {},
      args: {},
      callId: 20423,
      knownSourceText: "Book every meeting to ops@acme.com.\n",
    })).toEqual({ email: "ops@acme.com", fromCaller: false });
  });

  it("uses the caller-spoken address when the prompt says to collect", () => {
    expect(resolveBookingAttendeeEmail({
      tool: {},
      args: { attendee_email: "ram@gmail.com" },
      callId: 1,
      knownSourceText: "Collect the email and book the slot.",
    })).toEqual({ email: "ram@gmail.com", fromCaller: true });
  });

  it("waits for the caller when the prompt says collect and nothing is known", () => {
    expect(resolveBookingAttendeeEmail({
      tool: {},
      args: {},
      callId: 1,
      knownSourceText: "Ask for their email address then book.",
    })).toEqual({ email: "", fromCaller: true });
  });

  it("ignores a hallucinated tool email when the prompt does not collect", () => {
    const r = resolveBookingAttendeeEmail({
      tool: {},
      args: { attendee_email: "invented@gmail.com" },
      callId: 20423,
      knownSourceText: "You are a receptionist. Book meetings.",
    });
    expect(r.fromCaller).toBe(false);
    expect(r.email).toBe("booking-guest+20423@bookings.snapserve.local");
  });

  it("uses a leftover tool default, then a per-call guest address", () => {
    expect(resolveBookingAttendeeEmail({
      tool: { defaultAttendeeEmail: "ops@acme.com" },
      args: {},
      callId: 20423,
    })).toEqual({ email: "ops@acme.com", fromCaller: false });

    const guest = resolveBookingAttendeeEmail({ tool: {}, args: {}, callId: 20423 });
    expect(guest.fromCaller).toBe(false);
    expect(guest.email).toBe("booking-guest+20423@bookings.snapserve.local");
  });
});

describe("resolveDefaultBookingEmail", () => {
  it("rejects a junk default and uses the guest address", () => {
    expect(resolveDefaultBookingEmail({ defaultAttendeeEmail: "not-an-email" }, 9))
      .toBe("booking-guest+9@bookings.snapserve.local");
  });
});

describe("UpdateAgentBody booking email fields", () => {
  it("still accepts leftover collect/default fields so old agents save", () => {
    const parsed = UpdateAgentBody.safeParse({
      name: "x",
      tools: [{
        type: "native_booking",
        name: "book_appointment",
        description: "Book",
        collectAttendeeEmail: false,
        defaultAttendeeEmail: "ops@acme.com",
      }],
    });
    expect(parsed.success, JSON.stringify(parsed)).toBe(true);
    if (!parsed.success) return;
    const tool = parsed.data.tools![0] as {
      collectAttendeeEmail?: boolean;
      defaultAttendeeEmail?: string;
    };
    expect(tool.collectAttendeeEmail).toBe(false);
    expect(tool.defaultAttendeeEmail).toBe("ops@acme.com");
  });
});
