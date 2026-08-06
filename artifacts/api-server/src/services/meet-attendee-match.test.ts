import { describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({
  db: { select: vi.fn(), update: vi.fn() },
  callsTable: {},
}));

import { matchAttendeeEmail, sanitizeEmail } from "./meet-roster.js";

describe("meet attendee email match", () => {
  it("sanitizes emails", () => {
    expect(sanitizeEmail("  Priya@Example.com ")).toBe("priya@example.com");
    expect(sanitizeEmail("not-an-email")).toBe(null);
  });

  it("fuzzy-matches display name to booking attendee", () => {
    const hints = [
      { name: "Priya Sharma", email: "priya@acme.com" },
      { name: "Other", email: "other@acme.com" },
    ];
    expect(matchAttendeeEmail("Priya S", hints)).toBe("priya@acme.com");
    expect(matchAttendeeEmail("Unknown Guest", hints)).toBe(null);
  });
});
