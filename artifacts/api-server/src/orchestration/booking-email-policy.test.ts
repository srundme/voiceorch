import { describe, expect, it } from "vitest";
import { UpdateAgentBody } from "@workspace/api-zod";
import {
  bookingAsksCallerForEmail,
  pickKnownBookingEmail,
  resolveBookingAttendeeEmail,
  resolveDefaultBookingEmail,
} from "./booking-email-policy.js";

describe("bookingAsksCallerForEmail", () => {
  it("is off unless the tool explicitly opts in", () => {
    expect(bookingAsksCallerForEmail(undefined)).toBe(false);
    expect(bookingAsksCallerForEmail({})).toBe(false);
    expect(bookingAsksCallerForEmail({ collectAttendeeEmail: false })).toBe(false);
    expect(bookingAsksCallerForEmail({ collectAttendeeEmail: true })).toBe(true);
  });
});

describe("pickKnownBookingEmail", () => {
  it("reads lead source and prompt-variable keys", () => {
    expect(pickKnownBookingEmail({ email: "lead@acme.com" })).toBe("lead@acme.com");
    expect(pickKnownBookingEmail({ customer_email: "cust@acme.com" })).toBe("cust@acme.com");
    expect(pickKnownBookingEmail({ patient_email: "pat@clinic.com" })).toBe("pat@clinic.com");
    expect(pickKnownBookingEmail({ name: "Ram", phone: "999" })).toBeNull();
    expect(pickKnownBookingEmail({ email: "test@example.com" })).toBeNull();
  });
});

describe("resolveBookingAttendeeEmail", () => {
  it("uses the tool default when the caller is not asked and nothing is known", () => {
    expect(resolveBookingAttendeeEmail({
      tool: { defaultAttendeeEmail: "ops@acme.com" },
      args: {},
      callId: 20423,
    })).toEqual({ email: "ops@acme.com", fromCaller: false });
  });

  it("uses a lead/variable email without asking the caller", () => {
    expect(resolveBookingAttendeeEmail({
      tool: {},
      args: {},
      callId: 20423,
      knownEmail: "lead@acme.com",
    })).toEqual({ email: "lead@acme.com", fromCaller: false });
  });

  it("uses an email the model copied from the prompt / lead context", () => {
    expect(resolveBookingAttendeeEmail({
      tool: {},
      args: { attendee_email: "ram@gmail.com" },
      callId: 20423,
      knownSourceText: "=== LEAD CONTEXT ===\nEmail: ram@gmail.com\n",
    })).toEqual({ email: "ram@gmail.com", fromCaller: false });
  });

  it("ignores a hallucinated tool email that is not in the lead or prompt", () => {
    const r = resolveBookingAttendeeEmail({
      tool: {},
      args: { attendee_email: "invented@gmail.com" },
      callId: 20423,
      knownSourceText: "=== LEAD CONTEXT ===\nName: Ram\n",
    });
    expect(r.fromCaller).toBe(false);
    expect(r.email).toBe("booking-guest+20423@bookings.snapserve.local");
  });

  it("falls back to a per-call guest address when no default is set", () => {
    const r = resolveBookingAttendeeEmail({ tool: {}, args: {}, callId: 20423 });
    expect(r.fromCaller).toBe(false);
    expect(r.email).toBe("booking-guest+20423@bookings.snapserve.local");
  });

  it("uses the spoken address only when collection is on", () => {
    expect(resolveBookingAttendeeEmail({
      tool: { collectAttendeeEmail: true },
      args: { attendee_email: "ram@gmail.com" },
      callId: 1,
    })).toEqual({ email: "ram@gmail.com", fromCaller: true });
  });
});

describe("resolveDefaultBookingEmail", () => {
  it("rejects a junk default and uses the guest address", () => {
    expect(resolveDefaultBookingEmail({ defaultAttendeeEmail: "not-an-email" }, 9))
      .toBe("booking-guest+9@bookings.snapserve.local");
  });
});

describe("UpdateAgentBody booking email fields", () => {
  it("does not strip collectAttendeeEmail or defaultAttendeeEmail", () => {
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
