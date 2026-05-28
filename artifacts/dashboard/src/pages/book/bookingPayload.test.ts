import { describe, it, expect } from "vitest";
import { buildBookingPayload } from "./bookingPayload";
import { CreatePublicBookingBody } from "@workspace/api-zod";

const VALID_SLOT = "2026-06-15T14:00:00.000Z";

describe("buildBookingPayload", () => {
  it("produces a valid payload for a basic booking", () => {
    const payload = buildBookingPayload({
      eventTypeSlug: "intro-call",
      slotStart: VALID_SLOT,
      attendeeName: "Jane Smith",
      attendeeEmail: "jane@example.com",
      attendeeNotes: "Looking forward to it",
    });

    const result = CreatePublicBookingBody.safeParse(payload);
    expect(result.success).toBe(true);
    expect(result.data?.eventTypeSlug).toBe("intro-call");
    expect(result.data?.attendeeName).toBe("Jane Smith");
    expect(result.data?.attendeeEmail).toBe("jane@example.com");
    expect(result.data?.attendeeNotes).toBe("Looking forward to it");
  });

  it("omits attendeeNotes when not provided", () => {
    const payload = buildBookingPayload({
      eventTypeSlug: "discovery",
      slotStart: VALID_SLOT,
      attendeeName: "Bob Jones",
      attendeeEmail: "bob@example.com",
    });

    const result = CreatePublicBookingBody.safeParse(payload);
    expect(result.success).toBe(true);
    expect(payload).not.toHaveProperty("attendeeNotes");
  });

  it("omits attendeeNotes when passed as empty string", () => {
    const payload = buildBookingPayload({
      eventTypeSlug: "discovery",
      slotStart: VALID_SLOT,
      attendeeName: "Bob Jones",
      attendeeEmail: "bob@example.com",
      attendeeNotes: "",
    });

    const result = CreatePublicBookingBody.safeParse(payload);
    expect(result.success).toBe(true);
    expect(payload).not.toHaveProperty("attendeeNotes");
  });

  it("rejects an invalid email address", () => {
    const payload = buildBookingPayload({
      eventTypeSlug: "intro-call",
      slotStart: VALID_SLOT,
      attendeeName: "Jane Smith",
      attendeeEmail: "not-an-email",
    });

    const result = CreatePublicBookingBody.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it("currently allows an empty attendeeName (schema uses zod.string() without .min(1))", () => {
    const payload = buildBookingPayload({
      eventTypeSlug: "intro-call",
      slotStart: VALID_SLOT,
      attendeeName: "",
      attendeeEmail: "jane@example.com",
    });

    const result = CreatePublicBookingBody.safeParse(payload);
    // zod.string() accepts empty strings — add .min(1) to the schema to reject them
    expect(result.success).toBe(true);
    expect(result.data?.attendeeName).toBe("");
  });

  it("currently allows an empty eventTypeSlug (schema uses zod.string() without .min(1))", () => {
    const payload = buildBookingPayload({
      eventTypeSlug: "",
      slotStart: VALID_SLOT,
      attendeeName: "Jane Smith",
      attendeeEmail: "jane@example.com",
    });

    const result = CreatePublicBookingBody.safeParse(payload);
    // zod.string() accepts empty strings — add .min(1) to the schema to reject them
    expect(result.success).toBe(true);
    expect(result.data?.eventTypeSlug).toBe("");
  });

  it("accepts a UTC ISO timestamp (timezone edge case)", () => {
    const payload = buildBookingPayload({
      eventTypeSlug: "intro-call",
      slotStart: "2026-12-31T23:30:00.000Z",
      attendeeName: "Jane Smith",
      attendeeEmail: "jane@example.com",
    });

    const result = CreatePublicBookingBody.safeParse(payload);
    expect(result.success).toBe(true);
    expect(result.data?.slotStart).toBeInstanceOf(Date);
    expect((result.data?.slotStart as Date).toISOString()).toBe("2026-12-31T23:30:00.000Z");
  });

  it("accepts an offset-bearing ISO timestamp (non-UTC timezone)", () => {
    const payload = buildBookingPayload({
      eventTypeSlug: "intro-call",
      slotStart: "2026-06-15T10:00:00-04:00",
      attendeeName: "Jane Smith",
      attendeeEmail: "jane@example.com",
    });

    const result = CreatePublicBookingBody.safeParse(payload);
    expect(result.success).toBe(true);
    expect(result.data?.slotStart).toBeInstanceOf(Date);
    expect((result.data?.slotStart as Date).toISOString()).toBe("2026-06-15T14:00:00.000Z");
  });

  it("rejects a completely invalid slotStart", () => {
    const payload = buildBookingPayload({
      eventTypeSlug: "intro-call",
      slotStart: "not-a-date",
      attendeeName: "Jane Smith",
      attendeeEmail: "jane@example.com",
    });

    const result = CreatePublicBookingBody.safeParse(payload);
    expect(result.success).toBe(false);
  });
});
